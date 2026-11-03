/**
 * Reviewer reminder history — one Postgres row per reminder recorded
 * (`reviewer_reminder_events`, migration 095).
 *
 * The reviewer suggestion in Dataverse keeps only the latest reminder stamp of
 * each kind and a review-due count. This store keeps every reminder's date so
 * the Activity history drawer can list them. It is history only: the
 * Dataverse claim in `reviewer-reminder-sweep.js` `sendOneReminder` stays the
 * at-most-once guard, and nothing here decides eligibility or sending.
 *
 * Contract (docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md §2–§4):
 * - Written only for invited suggestions (`isInvitedRow`). Invited suggestions
 *   are never reset (`reviewer-suggestion.js` `restore` and staff re-select
 *   refuse them), so a row always belongs to its suggestion's one engagement.
 *   The test tool `scripts/reset-reviewer-for-testing.js` deletes rows itself.
 * - Never throws and never blocks a send. Every query is cancelled after
 *   REMINDER_HISTORY_TIMEOUT_MS through the Neon HTTP driver's per-query
 *   abort signal (not just an abandoned wait).
 * - A history session is a request-local circuit breaker: after the first
 *   failure or timeout, the rest of that session skips history calls. Create
 *   one per sweep run, send batch, manual reminder or listing; never keep one
 *   in module state across invocations.
 * - A cancelled insert may still commit server-side. That row is still a true
 *   record of a claimed reminder, so the outcome is "unknown, fine either way".
 */

import { neon } from '@neondatabase/serverless';
import { isInvitedRow } from '../../../shared/utils/reviewer-engagement-policy.js';

export const REMINDER_HISTORY_TIMEOUT_MS = 2000;
export const REMINDER_EVENT_KINDS = Object.freeze(['respond', 'review_due']);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedClient = null;
let cachedConnectionString = null;

function getClient() {
  const connectionString = process.env.POSTGRES_URL;
  if (!cachedClient || cachedConnectionString !== connectionString) {
    cachedClient = neon(connectionString);
    cachedConnectionString = connectionString;
  }
  return cachedClient;
}

/** A fresh request-local breaker. */
export function createReminderHistorySession() {
  return { tripped: false, skipped: 0, failure: null };
}

async function boundedQuery(text, params, session) {
  if (session.tripped) {
    session.skipped += 1;
    return { ok: false, reason: 'skipped' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMINDER_HISTORY_TIMEOUT_MS);
  try {
    const rows = await getClient()(text, params, { fetchOptions: { signal: controller.signal } });
    return { ok: true, rows };
  } catch (error) {
    const reason = controller.signal.aborted ? 'timeout' : 'error';
    session.tripped = true;
    session.failure = reason;
    return { ok: false, reason, error };
  } finally {
    clearTimeout(timer);
  }
}

function warn(message, error) {
  console.warn(`[reminder-history] ${message}${error ? `: ${String(error.message || error).slice(0, 200)}` : ''}`);
}

/**
 * Record one reminder. Resolves to `{ written: boolean, reason?: string }`
 * and never throws.
 *
 * @param {object} args
 * @param {object} args.row - the suggestion row the writer holds; must carry
 *   `wmkf_appreviewersuggestionid`, `_wmkf_request_value`, `wmkf_invited`
 *   and `wmkf_emailsentat`
 * @param {'respond'|'review_due'} args.kind
 * @param {string} args.recordedAt - the same ISO time written to the Dataverse stamp
 * @param {object} [args.session] - from createReminderHistorySession()
 */
export async function recordReminderEvent({ row, kind, recordedAt, session = createReminderHistorySession() } = {}) {
  try {
    if (!REMINDER_EVENT_KINDS.includes(kind)) {
      warn(`unknown reminder kind ${String(kind)}`);
      return { written: false, reason: 'invalid_kind' };
    }
    const suggestionId = row?.wmkf_appreviewersuggestionid;
    const requestId = row?._wmkf_request_value;
    if (!GUID_RE.test(String(suggestionId || '')) || !GUID_RE.test(String(requestId || ''))) {
      warn('row is missing its suggestion or request id');
      return { written: false, reason: 'invalid_row' };
    }
    if (!Number.isFinite(Date.parse(recordedAt))) {
      warn(`invalid recordedAt for ${suggestionId}`);
      return { written: false, reason: 'invalid_time' };
    }
    if (!isInvitedRow(row)) return { written: false, reason: 'not_invited' };

    const result = await boundedQuery(
      `INSERT INTO reviewer_reminder_events (suggestion_id, request_id, kind, recorded_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (suggestion_id, kind, recorded_at) DO NOTHING`,
      [suggestionId.toLowerCase(), requestId.toLowerCase(), kind, new Date(recordedAt).toISOString()],
      session,
    );
    if (!result.ok) {
      if (result.reason !== 'skipped') warn(`insert ${result.reason} for ${suggestionId}`, result.error);
      return { written: false, reason: result.reason };
    }
    return { written: true };
  } catch (error) {
    // isInvitedRow throws on a row without its guard fields; never let history
    // break the caller.
    warn('could not record reminder history', error);
    return { written: false, reason: 'error' };
  }
}

/**
 * Read the reminder history for many suggestions in one query.
 *
 * @param {string[]} suggestionIds
 * @param {object} [session]
 * @returns {Promise<Map<string, Array<{kind: string, recordedAt: string}>>|null>}
 *   keyed by lower-case suggestion id, newest first; `null` when the read failed
 *   or timed out (callers fall back to the Dataverse stamps alone).
 */
export async function readReminderHistory(suggestionIds, session = createReminderHistorySession()) {
  try {
    const ids = [...new Set((suggestionIds || [])
      .filter((id) => GUID_RE.test(String(id || '')))
      .map((id) => id.toLowerCase()))];
    const byId = new Map();
    if (ids.length === 0) return byId;
    const result = await boundedQuery(
      `SELECT suggestion_id, kind, recorded_at
         FROM reviewer_reminder_events
        WHERE suggestion_id = ANY($1::uuid[])
        ORDER BY recorded_at DESC, id DESC`,
      [ids],
      session,
    );
    if (!result.ok) {
      if (result.reason !== 'skipped') warn(`read ${result.reason}`, result.error);
      return null;
    }
    for (const row of result.rows || []) {
      if (!REMINDER_EVENT_KINDS.includes(row.kind)) continue;
      const at = new Date(row.recorded_at);
      if (Number.isNaN(at.getTime())) continue;
      const key = String(row.suggestion_id).toLowerCase();
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key).push({ kind: row.kind, recordedAt: at.toISOString() });
    }
    return byId;
  } catch (error) {
    warn('could not read reminder history', error);
    return null;
  }
}
