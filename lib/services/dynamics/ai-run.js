// @ts-check
/**
 * DynamicsService decomposition — Stage 9 module (Checkpoint F, AI run logging).
 *
 * Moved verbatim from lib/services/dynamics-service.js: `AI_RUN_TASK_TYPES`,
 * `AI_RUN_STATUSES`, `logAiRun`, `_truncateForMemo`.
 *
 * C1 "known trap" (plan doc): `logAiRun` reads `AI_RUN_TASK_TYPES`/
 * `AI_RUN_STATUSES` as STATIC PROPERTY reads (`this.AI_RUN_TASK_TYPES[taskType]`),
 * not calls. The svc-dispatch rewrite still applies to non-call property reads
 * per C1, so these become `svc.AI_RUN_TASK_TYPES`/`svc.AI_RUN_STATUSES` — the
 * facade MUST keep re-exposing the frozen objects exported here as its own
 * static properties (`static AI_RUN_TASK_TYPES = AI_RUN_TASK_TYPES` imported
 * from this module) or `svc.AI_RUN_TASK_TYPES` dereferences to `undefined` and
 * every taskType is rejected as "unknown". `logAiRun`'s call to
 * `this._truncateForMemo(...)` is a CALL edge, rewritten to `svc._truncateForMemo`
 * per the same rule — the facade keeps a thin wrapper for exact-surface parity
 * even though `_truncateForMemo` has zero external refs.
 *
 * `_truncateForMemo` carries no `this`, so it stays a module function taking no
 * `svc` parameter (same convention as `_withCallerId`/`_writeFetch` in
 * write-core.js).
 *
 * Deps: ai-run-retention (`applyRawOutputRetention`). Reaches the write path via
 * `svc.createRecord` (C1), not a direct write-core import.
 */

import { applyRawOutputRetention } from '../../utils/ai-run-retention.js';

/**
 * The DynamicsService facade receiver (C1 svc-dispatch). Typed `any` here on
 * purpose: the facade's own typed coverage is deferred to the decomposition's
 * facade-finalize checkpoint. See docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md.
 * @typedef {any} Svc
 */

/**
 * Choice → numeric mapping for wmkf_ai_run Picklist fields.
 * See docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md. Numeric values are the
 * contract — Dynamics API does not accept labels.
 */
export const AI_RUN_TASK_TYPES = Object.freeze({
  summary: 682090000,
  report: 682090001,
  'check-in': 682090002,
  pd_assignment: 682090003,
});

export const AI_RUN_STATUSES = Object.freeze({
  completed: 682090000,
  failed: 682090001,
  needs_review: 682090002,
});

/**
 * Write a row to the wmkf_ai_run audit/replay table. Non-critical — callers
 * should treat failures as logged warnings, not user-visible errors. The AI
 * produced its output before this runs; the run log is supplementary.
 *
 * @param {Svc} svc
 * @param {object} opts
 * @param {string} opts.requestGuid - akoya_request GUID this run was for
 * @param {string} opts.taskType - One of AI_RUN_TASK_TYPES keys
 * @param {string} opts.model - Claude model ID (e.g. 'claude-sonnet-4')
 * @param {number} [opts.promptVersion] - Integer; bumped on prompt text changes
 * @param {string} opts.status - One of AI_RUN_STATUSES keys
 * @param {object|string} [opts.rawOutput] - Full structured payload; stringified if object unless rawOutputRetention narrows it
 * @param {string|object} [opts.rawOutputRetention='full'] - full | hash | none
 * @param {string} [opts.notes] - Failure messages / retry context
 * @param {string} [opts.actingUserSystemId] - When set, the run row is
 *   attributed to the staff member rather than the service principal.
 * @returns {Promise<{ runId: string, runNum: string }>} IDs of the created row
 */
export async function logAiRun(svc, { requestGuid, taskType, model, promptVersion, status, rawOutput, rawOutputRetention = 'full', notes, actingUserSystemId }) {
  if (!requestGuid) throw new Error('logAiRun: requestGuid is required');

  const taskTypeValue = /** @type {Record<string, number>} */ (svc.AI_RUN_TASK_TYPES)[taskType];
  if (taskTypeValue === undefined) {
    throw new Error(`logAiRun: unknown taskType "${taskType}" (expected one of: ${Object.keys(svc.AI_RUN_TASK_TYPES).join(', ')})`);
  }

  const statusValue = /** @type {Record<string, number>} */ (svc.AI_RUN_STATUSES)[status];
  if (statusValue === undefined) {
    throw new Error(`logAiRun: unknown status "${status}" (expected one of: ${Object.keys(svc.AI_RUN_STATUSES).join(', ')})`);
  }

  // Navigation property name is wmkf_ai_Request (capitalized R) — discovered
  // via EntityDefinitions expand on ManyToOneRelationships. Case matters.
  /** @type {Record<string, any>} */
  const payload = {
    'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestGuid})`,
    wmkf_ai_tasktype: taskTypeValue,
    wmkf_ai_status: statusValue,
  };
  if (model) payload.wmkf_ai_model = String(model).slice(0, 64);
  if (promptVersion !== undefined && promptVersion !== null) payload.wmkf_ai_promptversion = Number(promptVersion);
  if (rawOutput !== undefined && rawOutput !== null) {
    // wmkf_ai_rawoutput cap raised to 1,000,000 chars (2026-04-14, Connor).
    // Truncation here is a safety valve only — real payloads are 5-15k.
    const retainedRawOutput = applyRawOutputRetention(rawOutput, /** @type {any} */ (rawOutputRetention));
    const serialized = typeof retainedRawOutput === 'string' ? retainedRawOutput : JSON.stringify(retainedRawOutput);
    payload.wmkf_ai_rawoutput = svc._truncateForMemo(serialized, 1_000_000);
  }
  if (notes) payload.wmkf_ai_notes = svc._truncateForMemo(String(notes), 2000);

  const created = /** @type {Record<string, any>} */ (await svc.createRecord('wmkf_ai_runs', payload, { actingUserSystemId }));
  return {
    runId: created.wmkf_ai_runid,
    runNum: created.wmkf_ai_runnum,
  };
}

/**
 * Truncate a string to fit in a Dataverse Memo field. Appends a visible
 * marker so readers can tell the content was cut off.
 * @param {string} s
 * @param {number} maxChars
 */
export function _truncateForMemo(s, maxChars) {
  if (!s || s.length <= maxChars) return s;
  const marker = `\n…[truncated ${s.length - maxChars + 0} chars]`;
  return s.slice(0, maxChars - marker.length) + marker;
}
