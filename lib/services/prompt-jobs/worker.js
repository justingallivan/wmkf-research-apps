/** Bounded, single-stage worker. All adapters are server-owned; possession of IDs is not authorization. */
import { isGuid } from '../../utils/guid.js';

import { getTaskCapability, isTaskEnabled } from './capabilities.js';
const TERMINAL = new Set(['validated','failed_pre_dispatch','failed_validation','expired']);
const AUDIT_STATES = new Set(['none','pending','dispatching','delivered','failed','unknown']);
const TASK_STATES = new Set(['queued','dispatching','response_saved','validated','failed_pre_dispatch','failed_validation','unknown','expired']);
const HASH = /^[a-f0-9]{64}$/;
const AUDIT_KEYS = ['wmkf_ai_status','wmkf_ai_runsource','wmkf_ai_model','wmkf_ai_Prompt@odata.bind','wmkf_ai_promptversion','wmkf_ai_Request@odata.bind','wmkf_ai_promptoverridden','wmkf_ai_notes'];
const VALIDATION_CODES = new Set(['profile_response_too_large','profile_response_model_mismatch','claude_output_refused','claude_output_truncated','claude_context_window_exceeded','claude_output_incomplete','claude_output_empty','claude_output_invalid_json','claude_output_missing_field','claude_output_schema_invalid','profile_output_invalid']);
function safeAudit(payload, job, task, status, promptRow) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== AUDIT_KEYS.length || Object.keys(payload).some(k => !AUDIT_KEYS.includes(k))) throw new Error('invalid audit payload');
  const promptBind = payload['wmkf_ai_Prompt@odata.bind'];
  const requestBind = payload['wmkf_ai_Request@odata.bind'];
  const promptId = typeof promptBind === 'string' && promptBind.match(/^\/wmkf_ai_prompts\(([^)]+)\)$/)?.[1];
  const requestId = typeof requestBind === 'string' && requestBind.match(/^\/akoya_requests\(([^)]+)\)$/)?.[1];
  if (payload.wmkf_ai_status !== (status === 'completed' ? 682090000 : 682090001) || ![682090000,682090001,682090002,682090003,682090004,682090005].includes(payload.wmkf_ai_runsource) || typeof payload.wmkf_ai_model !== 'string' || payload.wmkf_ai_model !== task.model || payload.wmkf_ai_model.length > 64 || !isGuid(promptId) || !promptRow || promptId.toLowerCase() !== String(promptRow.wmkf_ai_promptid).toLowerCase() || payload.wmkf_ai_promptversion !== promptRow.wmkf_promptversion || !isGuid(requestId) || requestId.toLowerCase() !== job.request_id.toLowerCase() || !Number.isSafeInteger(payload.wmkf_ai_promptversion) || payload.wmkf_ai_promptversion < 1 || payload.wmkf_ai_promptoverridden !== false || typeof payload.wmkf_ai_notes !== 'string' || !/^profiled=true; outcome=(completed|failed); code=(none|profile_response_too_large|profile_response_model_mismatch|profile_execution_failed|claude_output_refused|claude_output_truncated|claude_context_window_exceeded|claude_output_incomplete|claude_output_empty|claude_output_invalid_json|claude_output_missing_field|claude_output_schema_invalid|profile_output_invalid); stopReason=(end_turn|refusal|max_tokens|model_context_window_exceeded|unknown)$/.test(payload.wmkf_ai_notes) || !payload.wmkf_ai_notes.startsWith(`profiled=true; outcome=${status};`)) throw new Error('invalid audit payload');
  if (status === 'completed' && payload.wmkf_ai_notes !== 'profiled=true; outcome=completed; code=none; stopReason=end_turn') throw new Error('invalid audit payload');
  if (status === 'failed' && payload.wmkf_ai_notes.includes('; code=none;')) throw new Error('invalid audit payload');
  return payload;
}
function ok(value, message) { if (!value) throw new Error(message); return value; }
function status(stage) { return {stage}; }
async function allowed(check, args) { if (typeof check !== 'function' || await check(args) !== true) throw new Error('authorization or freshness denied'); }
function one(items, predicate) { const found = items.filter(predicate); if (found.length !== 1) throw new Error('inconsistent attempt state'); return found[0]; }

async function checkDispatch(authorize, checkFreshness, job, task, configuration, snapshot) {
  const args = {job,task,configuration,snapshot,stage:'dispatch'};
  let permitted;
  try {
    permitted = typeof authorize === 'function' && await authorize(args) === true
      && typeof checkFreshness === 'function' && await checkFreshness(args) === true;
  } catch (cause) {
    throw Object.assign(new Error('dispatch check unavailable', {cause}), {code:'dispatch_check_unavailable'});
  }
  if (!permitted) throw Object.assign(new Error('dispatch denied'), {code:'dispatch_denied'});
}

async function failBeforeDispatch(store, fence, task, error) {
  if (error?.code === 'dispatch_check_unavailable') return status('waiting');
  const errorCode = error?.code === 'dispatch_denied' ? 'dispatch_denied' : 'profile_execution_failed';
  ok(await store.markAttemptFailed({...fence,taskId:task.id,attemptId:null,outcome:'failed_pre_dispatch',errorCode}), 'pre-dispatch failure fenced');
  return status('failed_pre_dispatch');
}

/**
 * Each tick claims one job and runs at most one preparation, execution, audit,
 * or publication stage. Adapters must enforce current authorization, exact source
 * comparison, lease fencing, transactional checkpoints and immutable receipts.
 * The writer must issue at most the one frozen conditional operation.
 */
export async function advanceJob({jobId, store, executePrompt, authorize, checkFreshness, prepareSnapshot, readTarget, writer, audit, nonceSecret, leaseMs = 60000}) {
  if (!isGuid(jobId) || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || typeof executePrompt !== 'function') throw new Error('invalid worker arguments');
  const claim = await store.claim({jobId,leaseMs});
  if (!claim) return status('unavailable');
  const {job,tasks,attempts,publication,leaseToken} = claim;
  const fence = {jobId,leaseToken};
  try {
    if (!isGuid(job.request_id) || !['initialize','generate-draft'].includes(job.operation) || !Array.isArray(tasks) || !tasks.length || tasks.length > 8 || !Array.isArray(attempts) || tasks.some(t => !isTaskEnabled(t.task_key,{environment:job.environment,authorizationScope:job.authorization_scope}) || (getTaskCapability(t.task_key)?.kind === 'proposal' && job.operation !== 'generate-draft') || !TASK_STATES.has(t.state)) || attempts.some(a => !AUDIT_STATES.has(a.audit_state)) || (job.operation === 'initialize' && job.target_etag && (typeof job.target_etag !== 'string' || job.target_etag === '*' || job.target_etag.trim() !== job.target_etag || /[\r\n]/.test(job.target_etag)))) throw new Error('unsupported job');
    await allowed(authorize, {job,stage:'read'});
    if (!job.snapshot_content_id) {
      const queued = tasks.filter(task => task.state === 'queued');
      if (!queued.length) return status('needs_attention');
      await allowed(authorize, {job,stage:'prepare'});
      if (typeof prepareSnapshot !== 'function') return status('snapshot_unavailable');
      try {
        const configuration = await store.readContent({...fence,contentId:tasks[0].configuration_content_id,expectedHash:tasks[0].configuration_hash});
        if (!configuration) throw Object.assign(new Error('configuration expired'), {code:'content_expired'});
        const snapshot = await prepareSnapshot({job,tasks,configuration});
        ok(await store.saveSnapshot({...fence,snapshot}), 'snapshot save fenced');
      } catch (error) {
        if (error?.isTransient || !['snapshot_too_large','content_expired','proposal_source_changed','proposal_source_unavailable','proposal_source_too_large','proposal_source_invalid_file','proposal_source_extraction_failed','proposal_source_invalid_snapshot','proposal_source_invalid_manifest','proposal_source_invalid_profile','proposal_source_invalid_scope'].includes(error?.code)) throw error;
        for (const task of queued) {
          ok(await store.markAttemptFailed({...fence,taskId:task.id,outcome:'failed_pre_dispatch',errorCode:error.code}), 'snapshot failure fenced');
        }
        return status('failed_pre_dispatch');
      }
      return status('snapshot_saved');
    }
    if (job.operation === 'initialize' && !job.target_etag) {
      await allowed(authorize, {job,stage:'capture_target'});
      if (typeof readTarget !== 'function') return status('target_unavailable');
      const target = await readTarget({job,tasks});
      if (!target || typeof target.etag !== 'string' || !target.etag || target.etag.trim() !== target.etag || target.etag === '*' || /[\r\n]/.test(target.etag) || !target.fields || tasks.some(t => !target.fields[t.destination_field] || typeof target.fields[t.destination_field].blank !== 'boolean' || !HASH.test(target.fields[t.destination_field].sha256 || ''))) throw new Error('invalid target baseline');
      try { ok(await store.captureTarget({...fence,...target}), 'target capture fenced'); }
      catch (error) { if (error?.code === 'prompt_job_request_publication_pending') return status('waiting'); throw error; }
      return status('target_captured');
    }
    const hasUnknownTask = tasks.some(t => t.state === 'unknown');
    const task = tasks.find(t => t.state === 'response_saved') || (!hasUnknownTask && tasks.find(t => t.state === 'queued'));
    if (task) {
      if (task.state === 'response_saved') await allowed(authorize, {job,task,stage:'recover'});
      const snapshot = await store.readContent({...fence,contentId:job.snapshot_content_id,expectedHash:job.snapshot_hash});
      const config = await store.readContent({...fence,contentId:task.configuration_content_id,expectedHash:task.configuration_hash});
      if (!snapshot || !config) {
        const attempt = task.state === 'response_saved' ? one(attempts,a => a.task_id === task.id && a.state === 'response_saved') : null;
        ok(await store.markAttemptFailed({...fence,taskId:task.id,attemptId:attempt?.id || null,outcome:'expired',errorCode:'content_expired'}), 'expiry fenced');
        return status('expired');
      }
      if (!config.promptRow || !config.profile || !config.scope || config.scope.environment !== job.environment || typeof job.authorization_scope !== 'string' || !job.authorization_scope || config.scope.authorizationScope !== job.authorization_scope || snapshot.scope?.authorizationScope !== job.authorization_scope || config.scope.requestId !== job.request_id || config.promptRow.wmkf_ai_promptname !== task.task_key || config.promptRow.wmkf_ai_model !== task.model || typeof config.runSource !== 'string') throw new Error('invalid frozen configuration');
      if (task.state === 'queued') {
        try { await checkDispatch(authorize, checkFreshness, job, task, config, snapshot); }
        catch (error) { return await failBeforeDispatch(store, fence, task, error); }
      }
      let attempt = task.state === 'response_saved' ? one(attempts,a => a.task_id === task.id && a.state === 'response_saved') : null;
      let checkpointSaved = Boolean(attempt);
      let responseCheckpoint;
      if (attempt) {
        responseCheckpoint = await store.readContent({...fence,contentId:attempt.response_content_id,expectedHash:attempt.response_hash});
        if (!responseCheckpoint) { ok(await store.markAttemptFailed({...fence,taskId:task.id,attemptId:attempt.id,outcome:'expired',errorCode:'content_expired'}), 'expiry fenced'); return status('expired'); }
      }
      const leaseEnd = new Date(claim.lease_expires_at).getTime();
      const deadlineMs = leaseEnd - 5000;
      if (!Number.isFinite(leaseEnd) || deadlineMs <= Date.now()) throw new Error('lease deadline unavailable');
      let result;
      try {
        result = await executePrompt({promptName:task.task_key,requestId:job.request_id,runSource:config.runSource,promptSnapshot:config.promptRow,profiledContext:{profile:config.profile,snapshot,scope:config.scope,nonceSecret},requireNoPersistence:true,auditMode:'deferred',auditRetention:'content-free',deadlineMs,...(attempt ? {responseCheckpoint} : {
          onDispatch:async () => { if (attempt) throw new Error('duplicate dispatch'); await checkDispatch(authorize, checkFreshness, job, task, config, snapshot); if (Date.now() >= deadlineMs) throw Object.assign(new Error('lease deadline elapsed'), {code:'dispatch_check_unavailable'}); attempt = ok(await store.markDispatching({...fence,taskId:task.id}), 'dispatch fenced'); if (!isGuid(attempt.id) || !isGuid(attempt.audit_run_id)) throw new Error('invalid attempt identity'); },
          onResponse:async checkpoint => { if (!attempt || checkpointSaved) throw new Error('invalid checkpoint sequence'); ok(await store.saveResponse({...fence,taskId:task.id,attemptId:attempt.id,response:checkpoint}), 'checkpoint fenced'); checkpointSaved = true; },
        })});
        if (!attempt || !checkpointSaved) throw new Error('executor skipped checkpoint');
      } catch (error) {
        if (!attempt) return await failBeforeDispatch(store, fence, task, error);
        if (checkpointSaved && VALIDATION_CODES.has(error?.code)) {
          try {
            const deferredAudit = safeAudit(error.deferredAudit,job,task,'failed',config.promptRow);
            ok(await store.markAttemptFailed({...fence,taskId:task.id,attemptId:attempt.id,outcome:'failed_validation',errorCode:error.code,deferredAudit}), 'validation failure fenced');
            return status('failed_validation');
          } catch { return status('needs_attention'); }
        }
        if (!checkpointSaved) {
          if (error?.providerRejected === true && error.code === 'profile_provider_rejected') {
            const revoked = await store.markAttemptFailed({...fence,taskId:task.id,attemptId:attempt.id,outcome:'failed_pre_dispatch',errorCode:'provider_rejected'});
            return status(revoked ? 'failed_pre_dispatch' : 'needs_attention');
          }
          const marked = await store.markAttemptFailed({...fence,taskId:task.id,attemptId:attempt.id,outcome:'unknown',errorCode:'provider_outcome_unknown'});
          return status(marked ? 'unknown' : 'needs_attention');
        }
        return status('needs_attention');
      }
      try {
        const value = result?.parsed?.[getTaskCapability(task.task_key).outputName];
        if (typeof value !== 'string') throw new Error('invalid validated result');
        const deferredAudit = safeAudit(result.deferredAudit,job,task,'completed',config.promptRow);
        ok(await store.saveValidated({...fence,taskId:task.id,attemptId:attempt.id,result:value,deferredAudit}), 'result save fenced');
        return status('validated');
      } catch {
        // Preserve the response for explicit recovery; do not report false progress.
        return status('needs_attention');
      }
    }
    const pendingAudit = attempts.find(a => a.audit_state === 'pending');
    if (pendingAudit) {
      if (typeof audit !== 'function') return status('audit_pending');
      if (!isGuid(pendingAudit.audit_run_id)) throw new Error('invalid audit identity');
      const taskForAudit = one(tasks,t => t.id === pendingAudit.task_id);
      const payload = await store.readContent({...fence,contentId:pendingAudit.audit_content_id,expectedHash:pendingAudit.audit_hash});
      if (!payload) return status('audit_content_expired');
      const auditConfig = await store.readContent({...fence,contentId:taskForAudit.configuration_content_id,expectedHash:taskForAudit.configuration_hash});
      if (!auditConfig?.promptRow) return status('audit_content_expired');
      safeAudit(payload,job,taskForAudit,pendingAudit.state === 'validated' ? 'completed' : 'failed',auditConfig.promptRow);
      await allowed(authorize, {job,task:taskForAudit,configuration:auditConfig,stage:'audit'});
      ok(await store.markAuditDispatching({...fence,taskId:taskForAudit.id,attemptId:pendingAudit.id}), 'audit dispatch fenced');
      try { await audit({runId:pendingAudit.audit_run_id,payload,job,task:taskForAudit}); }
      catch (error) {
        const outcome = error?.definitive === true ? 'failed' : 'unknown';
        ok(await store.markAudit({...fence,taskId:taskForAudit.id,attemptId:pendingAudit.id,outcome}), 'audit fenced');
        return status(outcome === 'failed' ? 'audit_failed' : 'audit_unknown');
      }
      ok(await store.markAudit({...fence,taskId:taskForAudit.id,attemptId:pendingAudit.id,outcome:'delivered'}), 'audit fenced');
      return status('audit_delivered');
    }
    if (hasUnknownTask || attempts.some(a => ['dispatching','failed','unknown'].includes(a.audit_state))) return status('needs_attention');
    const needsAttention = tasks.some(t => t.state !== 'validated');
    if (job.operation === 'generate-draft') return status(tasks.every(t => TERMINAL.has(t.state)) ? (needsAttention ? 'needs_attention' : 'complete') : 'waiting');
    if (publication && publication.state !== 'ready') return status(publication.state === 'applied' && !needsAttention ? 'complete' : 'needs_attention');
    if (!tasks.every(t => TERMINAL.has(t.state))) return status('waiting');
    if (!tasks.some(t => t.state === 'validated')) return status('needs_attention');
    await allowed(authorize, {job,stage:'publish'}); await allowed(checkFreshness, {job,stage:'publish'});
    const pub = publication || ok(await store.freezePublication(fence), 'publication freeze fenced');
    if (pub.state !== 'ready' || pub.expected_etag !== job.target_etag) throw new Error('invalid publication baseline');
    const fields = await store.readContent({...fence,contentId:pub.payload_content_id,expectedHash:pub.payload_hash});
    if (!fields) { ok(await store.finishPublication({...fence,operationId:pub.id,outcome:'expired'}), 'publication expiry fenced'); return status('expired'); }
    if (typeof writer !== 'function') return status('publication_ready');
    await allowed(authorize, {job,stage:'publish'}); await allowed(checkFreshness, {job,stage:'publish'});
    ok(await store.markPublicationDispatched({...fence,operationId:pub.id}), 'publication dispatch fenced');
    let outcome;
    try { outcome = await writer({job,operationId:pub.id,expectedEtag:pub.expected_etag,fields}); }
    catch (error) { outcome = error?.status === 412 ? 'conflict' : 'unknown'; }
    if (!['applied','conflict','unknown'].includes(outcome)) outcome = 'unknown';
    ok(await store.finishPublication({...fence,operationId:pub.id,outcome}), 'publication completion fenced');
    return status(outcome === 'applied' ? 'published' : outcome);
  } finally {
    await store.releaseClaim(fence);
  }
}
