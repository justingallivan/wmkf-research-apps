/**
 * Admin — review-question set editor service (Route→Service Consolidation
 * Plan, Stage 5).
 *
 * Holds the business logic for /api/admin/review-questions; the route is a
 * thin shell (method dispatch, superuser gate, DAL context, HTTP mapping).
 * Save flow moved verbatim (Phase C of the staff-editable-questions epic):
 * validate → optimistic baseVersion check → diff by row id → pending audit
 * (HARD-ABORT on failure) → ONE atomic changeset → invalidate fetcher cache →
 * final audit. See the route header for the caller-facing contract.
 *
 * Contract (plan Decision 3): plain argument objects; returns the exact 200
 * envelopes; throws ServiceHttpError with explicit `body` for every historical
 * non-`{ error }` envelope (400 { status:'invalid', errors }, 409
 * { status:'set_changed', ... }, 500 { status:'audit_unavailable', ... },
 * 502 { status:'failed', ... }); the malformed-stored-set 500 keeps the
 * default `{ error }` shape. ASSUMES a trusted DAL context already exists.
 */

import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';
import { runChangeset } from '../../dataverse/core/changeset';
import { normalizeRow, questionSetVersion, invalidate } from '../../external/review-question-fetcher';
import { validateSubmittedSet, buildChangeset, missingParentBoundKeys } from '../../admin/review-question-save';
import { queryActiveQuestions } from '../../dataverse/adapters/review-question';
import { ServiceHttpError } from '../service-http-error';

/**
 * Read the current ACTIVE set as `{ id, ...normalizedField }`, ordered. Throws
 * if a stored row is structurally invalid (same fail-closed contract the
 * reviewer fetcher uses) so a malformed set surfaces an error, not a silent
 * partial editor.
 */
async function readActiveSetWithIds() {
  const { records, totalCount, hasMore } = await queryActiveQuestions();
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

function invalidStoredSetError(err) {
  return new ServiceHttpError(`The stored question set is invalid: ${err.message}`, { httpStatus: 500 });
}

/**
 * GET: the current ACTIVE set (with row ids) + a version token for
 * optimistic-concurrency on save.
 *
 * @returns {Promise<{ questions: Array, version: string }>}
 * @throws {ServiceHttpError} 500 when the stored set is malformed
 */
export async function getQuestionSet() {
  let questions;
  try {
    questions = await readActiveSetWithIds();
  } catch (err) {
    // A malformed stored set can't be safely loaded into the editor.
    throw invalidStoredSetError(err);
  }
  return { questions, version: questionSetVersion(questions) };
}

/**
 * POST: save the FULL ordered set the editor produced.
 *
 * @param {Object} args
 * @param {Array} args.questions - submitted rows
 * @param {string|null} args.baseVersion - optimistic-lock token from GET
 * @param {*} args.profileId
 * @returns {Promise<Object>} the historical 200 envelope
 *   ({ status:'completed', summary, version, noop:true } or
 *    { status:'completed', summary, version, auditWritten })
 * @throws {ServiceHttpError} 400/409/500/502 with the exact historical bodies
 */
export async function saveQuestionSet({ questions, baseVersion: baseVersionArg, profileId }) {
  const baseVersion = typeof baseVersionArg === 'string' ? baseVersionArg : null;

  // 1. Validate the submitted set (pure).
  const validation = validateSubmittedSet(questions);
  if (!validation.ok) {
    throw new ServiceHttpError('invalid question set', {
      httpStatus: 400,
      body: { status: 'invalid', errors: validation.errors },
    });
  }
  const submittedRows = validation.rows;

  // 1a. Require the optimistic-lock token — a client that omits it must not be
  // able to bypass the concurrency check (Codex Phase C P1-1).
  if (!baseVersion) {
    throw new ServiceHttpError('Missing baseVersion', {
      httpStatus: 400,
      body: { status: 'invalid', errors: ['Missing baseVersion (reload the editor and try again).'] },
    });
  }

  // 1b. The four parent-bound keys must stay in the set until Phase E retires
  // their dual-write columns (Codex Phase C P1-3).
  const missing = missingParentBoundKeys(submittedRows);
  if (missing.length > 0) {
    throw new ServiceHttpError('parent-bound keys removed', {
      httpStatus: 400,
      body: {
        status: 'invalid',
        errors: [`These required questions can't be removed yet: ${missing.join(', ')}.`],
      },
    });
  }

  // 2. Re-read live state for the optimistic check + the diff base.
  let currentRows;
  try {
    currentRows = await readActiveSetWithIds();
  } catch (err) {
    throw invalidStoredSetError(err);
  }
  const currentVersion = questionSetVersion(currentRows);

  // 3. Optimistic concurrency — the editor must have loaded against the live set.
  if (baseVersion !== currentVersion) {
    await bestEffortAudit({
      requestId: randomUUID(), profileId, phase: 'final', status: 'set_changed',
      baseVersion, resultVersion: null, summary: null,
      before: currentRows, after: submittedRows, warnings: [],
    });
    throw new ServiceHttpError('question set changed', {
      httpStatus: 409,
      body: {
        status: 'set_changed',
        error: 'The question set changed since you loaded it. Reload to see the current version before saving.',
        currentVersion,
      },
    });
  }

  // 4. Diff → changeset (key-immutability enforced here).
  const plan = buildChangeset(currentRows, submittedRows);
  if (!plan.ok) {
    throw new ServiceHttpError('invalid changeset', {
      httpStatus: 400,
      body: { status: 'invalid', errors: plan.errors },
    });
  }

  // No-op save (editor opened and saved with no changes): nothing to write.
  if (plan.operations.length === 0) {
    return {
      status: 'completed',
      summary: plan.summary,
      version: currentVersion,
      noop: true,
    };
  }

  // 5a. Pending audit — HARD-ABORT if the audit table is unavailable.
  const requestId = randomUUID();
  try {
    await writePendingAudit({ requestId, profileId, baseVersion, after: submittedRows });
  } catch (err) {
    console.error('[admin/review-questions] pending audit write failed:', err);
    throw new ServiceHttpError('Audit table unavailable', {
      httpStatus: 500,
      body: {
        status: 'audit_unavailable',
        error: 'Audit table unavailable; refused to modify the question set.',
      },
    });
  }

  // 5b. One atomic changeset.
  try {
    await runChangeset(plan.operations);
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
      throw new ServiceHttpError('concurrent save', {
        httpStatus: 409,
        body: {
          status: 'set_changed',
          error: 'Another save landed while you were editing. Reload to see the current version before saving.',
        },
      });
    }
    throw new ServiceHttpError('changeset failed', {
      httpStatus: 502,
      body: {
        status: 'failed',
        error: 'Saving the question set failed; no changes were applied.',
      },
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

  return {
    status: 'completed',
    summary: plan.summary,
    version: resultVersion,
    auditWritten,
  };
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
