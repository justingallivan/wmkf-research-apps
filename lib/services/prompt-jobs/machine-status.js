/** Content-free status from an already authorized, consistent prompt-job store view. */
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getTaskCapability } from './capabilities.js';

const ACTIVE_GENERATION = new Set(['queued', 'dispatching', 'response_saved']);
const INITIALIZE_WRITEBACK = {
  queued: ['pending'],
  dispatching: ['pending'],
  response_saved: ['pending'],
  validated: ['pending', 'applied', 'conflict', 'unknown', 'expired'],
  failed_pre_dispatch: ['blocked'],
  failed_validation: ['blocked'],
  unknown: ['pending'],
  expired: ['expired'],
};
const OPTIONAL_ATTEMPT = new Set(['failed_pre_dispatch', 'expired']);
const AUDIT_STATES = new Set(['none', 'pending', 'dispatching', 'delivered', 'failed', 'unknown']);
const REQUIRED_AUDIT = new Set(['validated', 'failed_validation']);
const AUDIT_ACTIVE = new Set(['pending', 'dispatching']);
const AUDIT_ATTENTION = new Set(['failed', 'unknown']);
const PUBLICATION_ACTIVE = new Set(['ready', 'dispatching']);
const PUBLICATION_ATTENTION = new Set(['conflict', 'unknown', 'expired']);
const RESPONSE_CHECKPOINT = new Set(['response_saved', 'validated', 'failed_validation']);
const HASH = /^[a-f0-9]{64}$/;
const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;
const SAFE_ERRORS = new Set([
  'protected_staff_content', 'dispatch_denied', 'profile_execution_failed', 'snapshot_too_large', 'content_expired',
  'proposal_source_changed', 'proposal_source_unavailable', 'proposal_source_too_large', 'proposal_source_invalid_file',
  'proposal_source_extraction_failed', 'proposal_source_invalid_snapshot', 'proposal_source_invalid_manifest',
  'proposal_source_invalid_profile', 'proposal_source_invalid_scope', 'proposal_source_missing',
  'proposal_source_ambiguous', 'trial_inputs_changed', 'provider_rejected', 'provider_outcome_unknown',
  'profile_inputs_changed_after_dispatch', 'profile_checkpoint_mismatch', 'profile_response_too_large',
  'profile_response_model_mismatch', 'claude_output_refused', 'claude_output_truncated',
  'claude_context_window_exceeded', 'claude_output_incomplete', 'claude_output_empty',
  'claude_output_invalid_json', 'claude_output_missing_field', 'claude_output_schema_invalid', 'profile_output_invalid',
]);

function inconsistent() {
  const code = 'job_state_inconsistent';
  throw new ServiceHttpError(code, { code, httpStatus: 503, body: { error: code } });
}

function uuid(value) {
  if (typeof value !== 'string' || value !== value.trim() || !isGuid(value)) inconsistent();
  return value.toLowerCase();
}

function expiryMillis(value) {
  const millis = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(millis)) inconsistent();
  return millis;
}

function attemptByTask(attempts) {
  const byTask = new Map();
  const attemptIds = new Set();
  for (const attempt of attempts) {
    const taskId = uuid(attempt?.task_id);
    const attemptId = uuid(attempt?.id);
    // The current worker only creates attempt #1 and updates it in place.
    if (byTask.has(taskId) || attemptIds.has(attemptId) || attempt.attempt_number !== 1
      || !AUDIT_STATES.has(attempt.audit_state)) inconsistent();
    byTask.set(taskId, attempt);
    attemptIds.add(attemptId);
  }
  return byTask;
}

function checkCheckpoint(contentId, hash) {
  uuid(contentId);
  if (typeof hash !== 'string' || !HASH.test(hash)) inconsistent();
}

function auditForTask(task, attempt) {
  if (!attempt) {
    if (task.state !== 'queued' && !OPTIONAL_ATTEMPT.has(task.state)) inconsistent();
    return 'none';
  }
  if (task.state === 'queued' || attempt.state !== task.state) inconsistent();
  if (RESPONSE_CHECKPOINT.has(task.state)) checkCheckpoint(attempt.response_content_id, attempt.response_hash);
  const audit = attempt.audit_state;
  if (REQUIRED_AUDIT.has(task.state) && audit === 'none') inconsistent();
  // The sandbox recommendations trial can retain an audit for provider
  // rejection or an unknown provider outcome. Expiry and active generation
  // always lack a deferred audit in the current store.
  if ((ACTIVE_GENERATION.has(task.state) || task.state === 'expired') && audit !== 'none') inconsistent();
  return audit;
}

function checkPublication(publication, job, jobId, tasks) {
  const validated = tasks.filter(task => task.generationState === 'validated');
  if (publication === null) {
    if (job.operation === 'initialize' && validated.some(task => task.writebackState !== 'pending')) inconsistent();
    return;
  }
  if (job.operation !== 'initialize' || uuid(publication?.job_id) !== jobId
    || !job.target_etag || publication.expected_etag !== job.target_etag
    || !Array.isArray(publication.task_ids) || publication.task_ids.length !== validated.length || !validated.length
    || tasks.some(task => ACTIVE_GENERATION.has(task.generationState) || task.generationState === 'unknown')
    || tasks.some(task => !['none', 'delivered'].includes(task.audit))) inconsistent();
  uuid(publication.id);
  const selected = new Set(publication.task_ids.map(uuid));
  if (selected.size !== validated.length) inconsistent();
  const expectedWriteback = PUBLICATION_ACTIVE.has(publication.state) ? 'pending' : publication.state;
  if (!PUBLICATION_ACTIVE.has(publication.state) && !PUBLICATION_ATTENTION.has(publication.state)
    && publication.state !== 'applied') inconsistent();
  if (validated.some(task => !selected.has(task.taskId) || task.writebackState !== expectedWriteback)) inconsistent();
}

function aggregate(job, publication, tasks, expired, active) {
  if (PUBLICATION_ATTENTION.has(publication?.state) || tasks.some(task =>
    task.generationState === 'unknown' || task.writebackState === 'expired' || AUDIT_ATTENTION.has(task.audit)
    || (expired && (task.audit === 'pending'
      || (task.generationState === 'validated' && task.writebackState === 'pending' && publication?.state !== 'dispatching'))))) {
    return 'needs_attention';
  }
  if (tasks.every(task => task.generationState === 'queued') && job.snapshot_content_id === null && job.target_etag === null) {
    return 'queued';
  }
  if (active || tasks.some(task => task.generationState === 'validated' && task.writebackState === 'pending')) return 'running';
  const delivered = tasks.filter(task => task.generationState === 'validated' && task.audit === 'delivered'
    && (job.operation === 'generate-draft' || task.writebackState === 'applied')).length;
  if (delivered === tasks.length) return 'succeeded';
  return delivered ? 'partial' : 'failed';
}

/**
 * Version tracks ledger mutations. observedAt also captures changes due to retention.
 * needs_attention can still carry a poll hint while ledger work remains active.
 */
export function projectMachineJob(view, now = Date.now()) {
  const { job, tasks, attempts, publication } = view || {};
  if (!job || !['initialize', 'generate-draft'].includes(job.operation)
    || !Number.isSafeInteger(job.version) || job.version < 1
    || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8 || !Array.isArray(attempts)
    || attempts.length > tasks.length || !Number.isFinite(now) || Math.abs(now) > 8.64e15) inconsistent();
  const jobId = uuid(job.id);
  uuid(job.request_id);
  if (job.snapshot_content_id !== null) uuid(job.snapshot_content_id);
  if (job.target_etag !== null && (job.operation !== 'initialize' || typeof job.target_etag !== 'string'
    || job.target_etag.length > 200 || !ETAG.test(job.target_etag))) inconsistent();
  const expired = now >= expiryMillis(job.result_expires_at);
  const byTask = attemptByTask(attempts);
  const taskIds = new Set();
  const taskKeys = new Set();
  const fields = new Set();
  const projected = Array.from(tasks, task => {
    const taskId = uuid(task?.id);
    const capability = typeof task.task_key === 'string' ? getTaskCapability(task.task_key) : null;
    if (uuid(task.job_id) !== jobId || taskIds.has(taskId) || taskKeys.has(task.task_key) || !capability
      || typeof task.state !== 'string' || !Object.hasOwn(INITIALIZE_WRITEBACK, task.state)) inconsistent();
    taskIds.add(taskId);
    taskKeys.add(task.task_key);
    if (job.operation === 'initialize') {
      if (!capability.destinationField || task.destination_field !== capability.destinationField
        || fields.has(task.destination_field) || !INITIALIZE_WRITEBACK[task.state].includes(task.writeback_state)) inconsistent();
      fields.add(task.destination_field);
    } else if (task.destination_field !== null || task.writeback_state !== 'not_requested') inconsistent();
    if (task.state === 'validated') checkCheckpoint(task.result_content_id, task.result_hash);
    const audit = auditForTask(task, byTask.get(taskId));
    byTask.delete(taskId);
    return {
      taskId, taskKey: task.task_key, generationState: task.state, writebackState: task.writeback_state,
      errorCode: task.error_code == null ? null : SAFE_ERRORS.has(task.error_code) ? task.error_code : 'prompt_job_failed',
      resultAvailable: false, recoveryActions: [], audit,
    };
  });
  if (byTask.size > 0) inconsistent();
  checkPublication(publication, job, jobId, projected);
  const active = PUBLICATION_ACTIVE.has(publication?.state) || projected.some(task =>
    ACTIVE_GENERATION.has(task.generationState) || AUDIT_ACTIVE.has(task.audit));
  const state = aggregate(job, publication, projected, expired, active);
  return {
    jobId, version: job.version, observedAt: new Date(now).toISOString(), state,
    pollAfterSeconds: active || state === 'running' ? 5 : null,
    tasks: projected.map(({ audit, ...task }) => task),
  };
}
