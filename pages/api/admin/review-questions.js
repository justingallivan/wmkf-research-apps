/**
 * API Route: /api/admin/review-questions  (superuser only)
 *
 * The staff editor for the external-reviewer review question set
 * (wmkf_reviewquestion). Phase C of the staff-editable-questions epic.
 *
 * GET  — the current ACTIVE set (rows WITH their wmkf_reviewquestionid so the
 *        editor can update/reorder by identity) + a `version` token
 *        (questionSetVersion) for optimistic-concurrency on save.
 * POST — save the FULL ordered set the editor produced. Body:
 *        { questions: [{ id?, key, label, type, required, maxLength?, hint?, options? }], baseVersion }
 *
 * Save flow:
 *   1. requireSuperuser.
 *   2. validate the submitted set (pure: review-question-save.js).
 *   3. re-read the live active set; if `baseVersion` != its current version →
 *      409 set_changed (another superuser saved meanwhile; the editor reloads).
 *   4. diff submitted vs current BY ROW ID → one executeChangeset operation list
 *      (create / update / soft-delete). Key-immutability is enforced here.
 *   5. if there are ops: write a 'pending' audit row (HARD-ABORT if the audit
 *      table is unavailable — audit is a precondition), run the ONE atomic
 *      changeset, invalidate the fetcher cache, write the 'final' audit row.
 *
 * The atomic changeset means a partial save can't leave the set inconsistent —
 * either the whole edit lands or none of it does (DynamicsService.executeChangeset
 * throws unless every sub-op is 2xx).
 */

import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';
import { requireSuperuser } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { normalizeRow, questionSetVersion, invalidate } from '../../../lib/external/review-question-fetcher';
import { validateSubmittedSet, buildChangeset, missingParentBoundKeys, ENTITY_SET } from '../../../lib/admin/review-question-save';

const SELECT = [
  'wmkf_reviewquestionid',
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_required',
  'wmkf_maxlength',
  'wmkf_hint',
  'wmkf_options',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await bypassDynamicsRestrictions('admin-review-questions', async () => {
      if (req.method === 'GET') return await handleGet(req, res);
      return await handlePost(req, res, gate.profileId);
    });
  } catch (err) {
    console.error('[admin/review-questions] unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

/**
 * Read the current ACTIVE set as `{ id, ...normalizedField }`, ordered. Throws
 * if a stored row is structurally invalid (same fail-closed contract the
 * reviewer fetcher uses) so a malformed set surfaces an error, not a silent
 * partial editor.
 */
async function readActiveSetWithIds() {
  const { records, totalCount, hasMore } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: SELECT,
    filter: 'statecode eq 0',
    orderby: 'wmkf_questionorder',
    top: 100,
  });
  // Same 100-row fail-closed contract the reviewer fetcher enforces: never show
  // the editor a truncated set (it would soft-delete the unseen rows on save).
  if (hasMore || (Number.isFinite(totalCount) && totalCount > (records || []).length)) {
    throw new Error(`active question set exceeds the 100-row fetch cap (count=${totalCount})`);
  }
  return (records || []).map((row) => ({
    id: row.wmkf_reviewquestionid,
    etag: row._etag || null, // row-version for per-op If-Match on save
    ...normalizeRow(row),
  }));
}

async function handleGet(req, res) {
  let questions;
  try {
    questions = await readActiveSetWithIds();
  } catch (err) {
    // A malformed stored set can't be safely loaded into the editor.
    return res.status(500).json({ error: `The stored question set is invalid: ${err.message}` });
  }
  return res.json({ questions, version: questionSetVersion(questions) });
}

async function handlePost(req, res, profileId) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const baseVersion = typeof body.baseVersion === 'string' ? body.baseVersion : null;

  // 1. Validate the submitted set (pure).
  const validation = validateSubmittedSet(body.questions);
  if (!validation.ok) {
    return res.status(400).json({ status: 'invalid', errors: validation.errors });
  }
  const submittedRows = validation.rows;

  // 1a. Require the optimistic-lock token — a client that omits it must not be
  // able to bypass the concurrency check (Codex Phase C P1-1).
  if (!baseVersion) {
    return res.status(400).json({ status: 'invalid', errors: ['Missing baseVersion (reload the editor and try again).'] });
  }

  // 1b. The four parent-bound keys must stay in the set until Phase E retires
  // their dual-write columns (Codex Phase C P1-3).
  const missing = missingParentBoundKeys(submittedRows);
  if (missing.length > 0) {
    return res.status(400).json({
      status: 'invalid',
      errors: [`These required questions can't be removed yet: ${missing.join(', ')}.`],
    });
  }

  // 2. Re-read live state for the optimistic check + the diff base.
  let currentRows;
  try {
    currentRows = await readActiveSetWithIds();
  } catch (err) {
    return res.status(500).json({ error: `The stored question set is invalid: ${err.message}` });
  }
  const currentVersion = questionSetVersion(currentRows);

  // 3. Optimistic concurrency — the editor must have loaded against the live set.
  if (baseVersion !== currentVersion) {
    await bestEffortAudit({
      requestId: randomUUID(), profileId, phase: 'final', status: 'set_changed',
      baseVersion, resultVersion: null, summary: null,
      before: currentRows, after: submittedRows, warnings: [],
    });
    return res.status(409).json({
      status: 'set_changed',
      error: 'The question set changed since you loaded it. Reload to see the current version before saving.',
      currentVersion,
    });
  }

  // 4. Diff → changeset (key-immutability enforced here).
  const plan = buildChangeset(currentRows, submittedRows);
  if (!plan.ok) {
    return res.status(400).json({ status: 'invalid', errors: plan.errors });
  }

  // No-op save (editor opened and saved with no changes): nothing to write.
  if (plan.operations.length === 0) {
    return res.status(200).json({
      status: 'completed',
      summary: plan.summary,
      version: currentVersion,
      noop: true,
    });
  }

  // 5a. Pending audit — HARD-ABORT if the audit table is unavailable.
  const requestId = randomUUID();
  try {
    await writePendingAudit({ requestId, profileId, baseVersion, after: submittedRows });
  } catch (err) {
    console.error('[admin/review-questions] pending audit write failed:', err);
    return res.status(500).json({
      status: 'audit_unavailable',
      error: 'Audit table unavailable; refused to modify the question set.',
    });
  }

  // 5b. One atomic changeset.
  try {
    await DynamicsService.executeChangeset(plan.operations);
  } catch (err) {
    console.error('[admin/review-questions] changeset failed:', err);
    // A 412 means a concurrent save touched a row between our version read and
    // the changeset (the per-op If-Match guard fired). The whole changeset rolled
    // back; tell the client to reload, same as a version mismatch (Codex P1-1).
    const concurrency = err.status === 412;
    await bestEffortAudit({
      requestId, profileId, phase: 'final', status: concurrency ? 'set_changed' : 'failed',
      baseVersion, resultVersion: null, summary: plan.summary,
      before: currentRows, after: submittedRows,
      warnings: [concurrency ? 'concurrent_write_412' : `changeset_error:${err.message}`],
    });
    if (concurrency) {
      return res.status(409).json({
        status: 'set_changed',
        error: 'Another save landed while you were editing. Reload to see the current version before saving.',
      });
    }
    return res.status(502).json({
      status: 'failed',
      error: 'Saving the question set failed; no changes were applied.',
    });
  }

  // 5c. Success — drop the fetcher cache so this process serves the new set now.
  invalidate();
  const resultVersion = questionSetVersion(submittedRows);

  const auditWritten = await bestEffortAudit({
    requestId, profileId, phase: 'final', status: 'completed',
    baseVersion, resultVersion, summary: plan.summary,
    before: currentRows, after: submittedRows, warnings: [],
  });

  return res.status(200).json({
    status: 'completed',
    summary: plan.summary,
    version: resultVersion,
    auditWritten,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Audit (mirrors policy_publish_audit; see migration 022)
// ─────────────────────────────────────────────────────────────────────────

async function writePendingAudit({ requestId, profileId, baseVersion, after }) {
  await sql`
    INSERT INTO review_question_audit
      (request_id, profile_id, phase, status, base_version, after_json)
    VALUES
      (${requestId}, ${profileId || null}, 'pending', 'pending', ${baseVersion || null},
       ${JSON.stringify(after)}::jsonb)
  `;
}

async function bestEffortAudit({ requestId, profileId, phase, status, baseVersion, resultVersion, summary, before, after, warnings }) {
  try {
    await sql`
      INSERT INTO review_question_audit
        (request_id, profile_id, phase, status, base_version, result_version,
         summary_json, before_json, after_json, warnings_json)
      VALUES
        (${requestId}, ${profileId || null}, ${phase}, ${status},
         ${baseVersion || null}, ${resultVersion || null},
         ${summary ? JSON.stringify(summary) : null}::jsonb,
         ${before ? JSON.stringify(before) : null}::jsonb,
         ${after ? JSON.stringify(after) : null}::jsonb,
         ${JSON.stringify(warnings || [])}::jsonb)
    `;
    return true;
  } catch (err) {
    console.error('[admin/review-questions] audit write failed:', err);
    try {
      await sql`
        INSERT INTO system_alerts (alert_type, severity, title, message, source, metadata)
        VALUES (
          'review_question_audit_failed', 'error',
          'Review question audit write failed',
          ${`Audit write (${phase}/${status}) failed for request ${requestId}.`},
          'admin/review-questions',
          ${JSON.stringify({ requestId, phase, status, error: err.message })}::jsonb
        )
      `;
    } catch (alertErr) {
      console.error('[admin/review-questions] system_alerts insert also failed:', alertErr.message);
    }
    return false;
  }
}
