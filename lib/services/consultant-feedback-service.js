/**
 * Consultant Feedback slice 1
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3, §4).
 *
 * Staff-recorded informal feedback from retained consultants on a proposal.
 * Postgres (`consultant_feedback`, migration 048) owns the entry; slice 1 has
 * no attachments, so every entry carries a non-empty sanitized body.
 *
 * `writeFeedbackEntry` (insert) and `updateFeedbackEntry` (patch) are the two
 * entry points that can set or change an entry's author (§3.2 "one write
 * primitive", Codex AR-2 finding 4). They stay separate functions — insert
 * establishes the mutation-id replay contract an update never needs, and an
 * update must compare the submitted author against the stored row rather
 * than insert-then-overwrite — but both route through the SAME two guards,
 * `validateAuthorInput` (exactly one of roster id / one-off name) and
 * `assertConsultantEligible` (`is_active = true AND role_type = 'Consultant'`
 * against `expertise_roster`, run inside the caller's own same-client
 * transaction), and nothing else in this file or its callers may insert or
 * reassign an author. Slice 2's finalize step 7 binds an attachment through
 * `updateFeedbackEntry`, not a third write path.
 *
 * Eligibility (§3.2, Codex AR-1 finding 3): a `consultantRosterId` is
 * resolved with `is_active = true AND role_type = 'Consultant'` on create and
 * on any ACTUAL author change (the submitted author differs by value from
 * the stored row — not merely because the client's body included the author
 * fields, which it may resubmit unchanged; see `updateFeedbackEntry`), and rejected
 * with 400 `consultant_not_eligible` otherwise. Reads and author-unchanged
 * edits use an UNFILTERED join so a deactivated consultant's past feedback
 * keeps its name (§3.1).
 *
 * No `expertise_roster` write happens anywhere in this file (CF6): a one-off
 * name/affiliation is stored on the entry itself and never promoted to the
 * roster.
 *
 * Known residual (accepted, not fixed, slice 1): the mutation-id replay
 * receipt lives ON the row it created. If a create's response is lost, a
 * colleague then hard-deletes that row, and the original client retries the
 * same mutation id, the retry finds no row for `(request_id, mutation_id)`
 * and inserts a second entry — the replay guard cannot distinguish "never
 * happened" from "happened and was since deleted" once the receipt itself is
 * gone. Accepted here because the retry window is the open-form lifetime (a
 * user closing and reopening the tab already rotates the mutation id via
 * `closeForm`), so the overlap with an unrelated concurrent hard delete is
 * narrow. Slice 2's `deleting`/terminal status work is where a durable
 * receipt independent of the row would live if the owner wants this closed.
 */
import { db, sql } from '@vercel/postgres';
import { ServiceHttpError } from './service-http-error';
import { isGuid } from '../utils/guid.js';
import { sanitizeReviewHtml, isEffectivelyEmptyHtml } from '../external/sanitize-review-html.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Checked BEFORE sanitizing (raw input length, not the sanitized/stripped
// output) so an oversized payload is rejected up front rather than after
// paying the sanitize-html parse cost.
const MAX_BODY_LENGTH = 200_000;

function badRequest(message, reason) {
  return new ServiceHttpError(message, { httpStatus: 400, body: { error: message, reason } });
}

function notFound(message = 'Consultant feedback entry not found.') {
  return new ServiceHttpError(message, { httpStatus: 404, body: { error: message, reason: 'not_found' } });
}

/**
 * `shared` must be an actual boolean when supplied; a non-boolean (e.g. the
 * string `"false"`) is truthy and would otherwise fail open to shared=true.
 * `allowDefault` lets an absent (`undefined`) value default to `true` (CF2)
 * only at create, where the field is optional; an update's `patch.shared` is
 * only normalized when the caller's body has the key at all, so there is no
 * "absent" case to default there.
 */
function normalizeShared(value, { allowDefault = false } = {}) {
  if (value === undefined && allowDefault) return true;
  if (typeof value !== 'boolean') throw badRequest('shared must be a boolean.', 'invalid_shared');
  return value;
}

/**
 * Strict positive-integer id check for roster ids, entry ids, and actor ids.
 * Ids arrive as either a JSON number or a numeric string (query params are
 * always strings; JSON bodies are usually numbers). `Number.isInteger(Number(x))`
 * is too permissive: `Number(true) === 1`, `Number('') === 0` is rejected only
 * by the `> 0` half, but `Number(' 5 ')` and other coercions can slip through.
 * This accepts only an actual integer number or a `/^\d+$/` string, so
 * `true`, `''`, `1.5`, `'1.5'`, and `' 5'` are all rejected.
 */
function isPositiveInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') return /^\d+$/.test(value) && Number(value) > 0;
  return false;
}

function normalizeReceivedOn(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!DATE_RE.test(trimmed)) throw badRequest('receivedOn must be a YYYY-MM-DD date.', 'invalid_received_on');
  return trimmed;
}

function mapRow(row) {
  return {
    id: String(row.id),
    // received_on is always selected as `to_char(..., 'YYYY-MM-DD')` text (never
    // a pg Date object read back through toISOString(), which shifts a day east
    // of UTC) — see every SELECT/RETURNING in this file.
    receivedOn: String(row.received_on),
    bodyHtml: row.body_html != null ? sanitizeReviewHtml(row.body_html) : null,
    shared: row.shared === true,
    consultant: row.consultant_roster_id != null
      ? { rosterId: row.consultant_roster_id, name: row.roster_name ?? null, affiliation: row.roster_affiliation ?? null }
      : { rosterId: null, name: row.one_off_name ?? null, affiliation: row.one_off_affiliation ?? null },
    oneOff: row.consultant_roster_id == null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/**
 * Active entries for a request, newest `received_on` first, with the live
 * (unfiltered by `is_active`) roster join so a deactivated consultant's past
 * feedback keeps its author name (§3.1).
 */
export async function listConsultantFeedback({ requestId }) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  const { rows } = await sql.query(
    `SELECT cf.id, to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.shared, cf.consultant_roster_id,
            cf.one_off_name, cf.one_off_affiliation, cf.updated_at,
            r.name AS roster_name, r.affiliation AS roster_affiliation
       FROM consultant_feedback cf
       LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
      WHERE cf.request_id = $1 AND cf.status = 'active'
      ORDER BY cf.received_on DESC, cf.id DESC`,
    [requestId],
  );
  return rows.map(mapRow);
}

/** Active `role_type='Consultant'` roster rows for the dropdown source. */
export async function listEligibleConsultants() {
  const { rows } = await sql.query(
    `SELECT id, name, affiliation FROM expertise_roster
      WHERE is_active = true AND role_type = 'Consultant'
      ORDER BY name, id`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, affiliation: row.affiliation ?? null }));
}

/** Throws `consultant_not_eligible` unless the roster row is an active Consultant. Must run inside the caller's transaction/client. */
async function assertConsultantEligible(client, consultantRosterId) {
  const { rows } = await client.query(
    `SELECT id FROM expertise_roster WHERE id = $1 AND is_active = true AND role_type = 'Consultant'`,
    [consultantRosterId],
  );
  if (!rows[0]) {
    // `error` carries the human sentence (matching the badRequest()/notFound()
    // helpers' shape below), never the bare `reason` code — the route ships
    // this `body` verbatim, and the Workbench form surfaces `data.error`
    // straight to staff.
    throw new ServiceHttpError('The selected consultant is not an active roster consultant.', {
      httpStatus: 400,
      body: { error: 'The selected consultant is not an active roster consultant.', reason: 'consultant_not_eligible' },
    });
  }
}

function validateAuthorInput({ consultantRosterId, oneOff }) {
  const hasRoster = consultantRosterId != null;
  const hasOneOff = oneOff != null && typeof oneOff.name === 'string' && oneOff.name.trim().length > 0;
  if (hasRoster === hasOneOff) {
    throw badRequest('Provide exactly one of consultantRosterId or oneOff.name.', 'invalid_author');
  }
  if (hasRoster && !isPositiveInt(consultantRosterId)) {
    throw badRequest('consultantRosterId must be a positive integer.', 'invalid_author');
  }
  return { hasRoster, hasOneOff };
}

/**
 * The insert path (§3.2; see the module docblock for the split with
 * `updateFeedbackEntry`). Validates the request GUID, mutation id,
 * exactly-one-author rule, a non-empty sanitized body (slice 1 has no
 * attachments), and the date; runs eligibility for a roster author; inserts
 * with `ON CONFLICT (request_id, mutation_id) DO NOTHING`, then selects and
 * returns the row for that mutation id (replay-safe), in one explicit
 * same-client transaction.
 */
export async function writeFeedbackEntry({
  requestId, actorProfileId, mutationId, consultantRosterId = null, oneOff = null, bodyHtml, receivedOn, shared,
}) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  // mutationId is a client-generated UUID (not a Dataverse GUID), but the
  // wire shape is identical, so the same validator applies.
  if (!isGuid(mutationId)) throw badRequest('mutationId must be a UUID.', 'invalid_mutation_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  const { hasRoster } = validateAuthorInput({ consultantRosterId, oneOff });
  if (typeof bodyHtml === 'string' && bodyHtml.length > MAX_BODY_LENGTH) {
    throw badRequest('bodyHtml is too long.', 'body_too_long');
  }
  const sanitizedBody = typeof bodyHtml === 'string' ? sanitizeReviewHtml(bodyHtml) : null;
  if (!sanitizedBody || isEffectivelyEmptyHtml(sanitizedBody)) {
    // Slice 1 has no attachments; an entry with no attachment must carry a body.
    throw badRequest('bodyHtml is required.', 'body_required');
  }
  const normalizedReceivedOn = normalizeReceivedOn(receivedOn);
  const isShared = normalizeShared(shared, { allowDefault: true });
  const oneOffName = hasRoster ? null : String(oneOff.name).trim();
  const oneOffAffiliation = hasRoster ? null : (oneOff.affiliation != null ? String(oneOff.affiliation).trim() || null : null);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (hasRoster) await assertConsultantEligible(client, Number(consultantRosterId));
    await client.query(
      `INSERT INTO consultant_feedback
         (request_id, consultant_roster_id, one_off_name, one_off_affiliation, body_html,
          received_on, shared, mutation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (request_id, mutation_id) DO NOTHING`,
      [requestId, hasRoster ? Number(consultantRosterId) : null, oneOffName, oneOffAffiliation,
        sanitizedBody, normalizedReceivedOn, isShared, mutationId, Number(actorProfileId)],
    );
    const { rows } = await client.query(
      `SELECT cf.id, to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.shared, cf.consultant_roster_id,
              cf.one_off_name, cf.one_off_affiliation, cf.updated_at,
              r.name AS roster_name, r.affiliation AS roster_affiliation
         FROM consultant_feedback cf
         LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
        WHERE cf.request_id = $1 AND cf.mutation_id = $2`,
      [requestId, mutationId],
    );
    // Checked BEFORE COMMIT: if this ever fires, the transaction still rolls
    // back cleanly in the catch below instead of the catch issuing a ROLLBACK
    // against an already-committed transaction (a no-op at best, an error at
    // worst, and either way not what "something went wrong" should mean here).
    if (!rows[0]) throw new ServiceHttpError('Consultant feedback entry could not be created.', { httpStatus: 500 });
    await client.query('COMMIT');
    return mapRow(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Body/receivedOn/shared/author edits. The client may resubmit the current
 * author fields on every save, so a `consultantRosterId`/`oneOff` key
 * being PRESENT in `patch` does not by itself mean the author changed:
 * eligibility re-runs only when the submitted author differs BY VALUE from
 * the stored row. A same-value resubmission (e.g. editing only the body of
 * an entry whose roster consultant was since deactivated) is treated as
 * author-unchanged and never re-checked (§3.2).
 */
export async function updateFeedbackEntry({ id, requestId, actorProfileId, patch = {} }) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isPositiveInt(id)) throw badRequest('id is required.', 'invalid_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  const patchHasAuthorKey = Object.prototype.hasOwnProperty.call(patch, 'consultantRosterId')
    || Object.prototype.hasOwnProperty.call(patch, 'oneOff');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT id, consultant_roster_id, one_off_name, one_off_affiliation, body_html,
              to_char(received_on, 'YYYY-MM-DD') AS received_on, requestdocument_id, shared
         FROM consultant_feedback WHERE id = $1 AND request_id = $2 AND status = 'active' FOR UPDATE`,
      [Number(id), requestId],
    );
    const existing = existingRows[0];
    if (!existing) throw notFound();

    let consultantRosterId = existing.consultant_roster_id;
    let oneOffName = existing.one_off_name;
    let oneOffAffiliation = existing.one_off_affiliation;
    if (patchHasAuthorKey) {
      const nextConsultantRosterId = Object.prototype.hasOwnProperty.call(patch, 'consultantRosterId') ? patch.consultantRosterId : null;
      const nextOneOff = Object.prototype.hasOwnProperty.call(patch, 'oneOff') ? patch.oneOff : null;
      const { hasRoster } = validateAuthorInput({ consultantRosterId: nextConsultantRosterId, oneOff: nextOneOff });
      const nextRosterId = hasRoster ? Number(nextConsultantRosterId) : null;
      const nextOneOffName = hasRoster ? null : String(nextOneOff.name).trim();
      const nextOneOffAffiliation = hasRoster ? null : (nextOneOff.affiliation != null ? String(nextOneOff.affiliation).trim() || null : null);
      // The submitted author is compared by VALUE against the stored row, not
      // by whether the client happened to include the key: the client may
      // resubmit the current author fields on every save, so key presence
      // alone would treat every body/date/share-only edit as an author change
      // and needlessly re-run eligibility (§3.2 — a body-only edit must not
      // fail for an entry whose consultant was since deactivated).
      const authorUnchanged = nextRosterId === existing.consultant_roster_id
        && nextOneOffName === existing.one_off_name
        && nextOneOffAffiliation === existing.one_off_affiliation;
      if (!authorUnchanged && hasRoster) await assertConsultantEligible(client, nextRosterId);
      consultantRosterId = nextRosterId;
      oneOffName = nextOneOffName;
      oneOffAffiliation = nextOneOffAffiliation;
    }

    let bodyHtml = existing.body_html;
    if (Object.prototype.hasOwnProperty.call(patch, 'bodyHtml')) {
      if (typeof patch.bodyHtml === 'string' && patch.bodyHtml.length > MAX_BODY_LENGTH) {
        throw badRequest('bodyHtml is too long.', 'body_too_long');
      }
      const sanitizedBody = typeof patch.bodyHtml === 'string' ? sanitizeReviewHtml(patch.bodyHtml) : null;
      if (!sanitizedBody || isEffectivelyEmptyHtml(sanitizedBody)) {
        // Slice 1: no attachment means the body may never become empty.
        if (existing.requestdocument_id == null) throw badRequest('bodyHtml is required.', 'body_required');
      }
      bodyHtml = sanitizedBody;
    }

    const receivedOn = Object.prototype.hasOwnProperty.call(patch, 'receivedOn')
      ? normalizeReceivedOn(patch.receivedOn)
      : existing.received_on;
    const shared = Object.prototype.hasOwnProperty.call(patch, 'shared') ? normalizeShared(patch.shared) : existing.shared;

    const { rows } = await client.query(
      `UPDATE consultant_feedback
          SET consultant_roster_id = $1, one_off_name = $2, one_off_affiliation = $3,
              body_html = $4, received_on = $5, shared = $6, updated_by = $7, updated_at = now()
        WHERE id = $8
      RETURNING id, to_char(received_on, 'YYYY-MM-DD') AS received_on, body_html, shared, consultant_roster_id, one_off_name, one_off_affiliation, updated_at`,
      [consultantRosterId, oneOffName, oneOffAffiliation, bodyHtml, receivedOn, shared, Number(actorProfileId), existing.id],
    );
    await client.query('COMMIT');
    const row = rows[0];
    let rosterName = null;
    let rosterAffiliation = null;
    if (row.consultant_roster_id != null) {
      const rosterRows = (await sql.query('SELECT name, affiliation FROM expertise_roster WHERE id = $1', [row.consultant_roster_id])).rows;
      rosterName = rosterRows[0]?.name ?? null;
      rosterAffiliation = rosterRows[0]?.affiliation ?? null;
    }
    return mapRow({ ...row, roster_name: rosterName, roster_affiliation: rosterAffiliation });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Hard delete where `status = 'active'` (CF5; slice 1 has no supersede-first lifecycle). */
export async function deleteFeedbackEntry({ id, requestId, actorProfileId }) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isPositiveInt(id)) throw badRequest('id is required.', 'invalid_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  const { rows } = await sql.query(
    `DELETE FROM consultant_feedback WHERE id = $1 AND request_id = $2 AND status = 'active' RETURNING id`,
    [Number(id), requestId],
  );
  if (!rows[0]) throw notFound();
  return { id: String(rows[0].id) };
}

/**
 * Briefing read model (§3.3). Catches query errors and returns `unavailable`
 * with a structured log instead of throwing, so a fault on this table alone
 * never fails the whole briefing context.
 */
export async function loadSharedConsultantFeedbackForBriefing(requestId) {
  try {
    if (!isGuid(requestId)) return { status: 'ok', items: [] };
    const { rows } = await sql.query(
      `SELECT to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.consultant_roster_id, cf.one_off_name, cf.one_off_affiliation,
              r.name AS roster_name, r.affiliation AS roster_affiliation
         FROM consultant_feedback cf
         LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
        WHERE cf.request_id = $1 AND cf.status = 'active' AND cf.shared = true
        ORDER BY cf.received_on DESC, cf.id DESC`,
      [requestId],
    );
    return {
      status: 'ok',
      items: rows.map((row) => ({
        name: row.consultant_roster_id != null ? (row.roster_name ?? null) : (row.one_off_name ?? null),
        affiliation: row.consultant_roster_id != null ? (row.roster_affiliation ?? null) : (row.one_off_affiliation ?? null),
        receivedOn: String(row.received_on),
        bodyHtml: row.body_html != null ? sanitizeReviewHtml(row.body_html) : null,
      })),
    };
  } catch (error) {
    console.error('[consultant-feedback] briefing read failed', { requestId, message: error?.message });
    return { status: 'unavailable', items: [] };
  }
}

