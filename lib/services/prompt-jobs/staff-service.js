/** Authenticated staff trial orchestration. Every HTTP projection is explicit; provider work stays in the worker. */
import { db } from '@vercel/postgres';
import { createPromptJobStore } from './store.js';
import { createProposalSource } from './proposal-source.js';
import { eligibleStaff } from '../board-writeups/config.js';
import { fetchCurrentPrompt } from '../prompt-store.js';
import { getPromptProfiles } from '../admin/prompt-profiles-service.js';
import { canonical, hashProfile, parseExecutionSpec } from './profile.js';
import { PROPOSAL_TASK_KEYS, validateTaskCapability } from './capabilities.js';
import { isGuid } from '../../utils/guid.js';
import { matchesTrialActor, readTrialPolicy, scopeForTrial, trialError } from './trial-policy.js';

export const staffJobStore = createPromptJobStore(db);
export async function authorizeTrialActor(actor) {
  const staff = await eligibleStaff(actor.systemUserId, {admin:true,app:false});
  return staff.profileId === actor.profileId && staff.isSuperuser === true;
}
export const STAFF_JOB_DEPENDENCIES = {
  store:staffJobStore, source:createProposalSource(), policy:readTrialPolicy,
  authorize:authorizeTrialActor, prompt:fetchCurrentPrompt, profiles:getPromptProfiles, now:()=>Date.now(),
};
const TERMINAL = new Set(['validated','failed_pre_dispatch','failed_validation','expired']);
const SAFE_ERRORS = new Set(['dispatch_denied','profile_execution_failed','snapshot_too_large','content_expired',
  'proposal_source_changed','proposal_source_unavailable','proposal_source_too_large','proposal_source_invalid_file','proposal_source_extraction_failed','proposal_source_invalid_snapshot','proposal_source_invalid_manifest','proposal_source_invalid_profile','proposal_source_invalid_scope','provider_rejected','provider_outcome_unknown',
  'profile_response_too_large','profile_response_model_mismatch','claude_output_refused','claude_output_truncated',
  'claude_context_window_exceeded','claude_output_incomplete','claude_output_empty','claude_output_invalid_json',
  'claude_output_missing_field','claude_output_schema_invalid','profile_output_invalid']);
export function projectStaffJob(view, results, now = Date.now()) {
  const {job,tasks,attempts} = view;
  const expired = new Date(job.result_expires_at).getTime() <= now;
  const attention = tasks.some(t=>t.state==='unknown') || attempts.some(a=>['failed','unknown'].includes(a.audit_state));
  const settled = tasks.every(t=>TERMINAL.has(t.state)) && !attempts.some(a=>['pending','dispatching'].includes(a.audit_state));
  const status = expired ? 'expired' : attention ? 'needs_attention' : settled
    ? (tasks.every(t=>t.state==='validated') ? 'complete' : 'needs_attention')
    : tasks.every(t=>t.state==='queued') && !job.snapshot_content_id ? 'queued' : 'running';
  return {id:job.id,requestId:job.request_id,version:Number(job.version),createdAt:job.created_at,status,
    tasks:tasks.map(t=>({taskKey:t.task_key,state:t.state,
      resultAvailable:!expired && t.state==='validated' && results?.results.some(r=>r.taskKey===t.task_key && r.status==='available') === true,
      errorCode:SAFE_ERRORS.has(t.error_code) ? t.error_code : t.error_code ? 'profile_execution_failed' : null}))};
}
async function context(args, deps, allowDisabled = false) {
  if (!isGuid(args.requestId)) throw trialError('invalid_request_id',400);
  const requestId = args.requestId.toLowerCase();
  const policy = deps.policy();
  if (!matchesTrialActor(policy,args.actor,requestId)) {
    if (allowDisabled) return null;
    throw trialError('prompt_job_trial_unavailable',403);
  }
  if (await deps.authorize(args.actor) !== true) throw trialError('prompt_job_access_denied',403);
  return {policy,scope:scopeForTrial(policy)};
}
async function dto(view, scope, deps) {
  const result = await deps.store.readValidatedResults({...scope,jobId:view.job.id});
  if (!result || Number(result.version) !== Number(view.job.version)) throw trialError('prompt_job_changed',409);
  return projectStaffJob(view,result,deps.now());
}
export async function listStaffJobs(args, deps = STAFF_JOB_DEPENDENCIES) {
  const c = await context(args,deps,true);
  if (!c) return {enabled:false,jobs:[]};
  const views = await deps.store.listJobs({...c.scope,limit:5});
  const jobs = [];
  for (const view of views) jobs.push(await dto(view,c.scope,deps));
  return {enabled:true,jobs};
}
async function scopedView(args, deps) {
  if (!isGuid(args.jobId)) throw trialError('invalid_prompt_job_id',400);
  const c = await context(args,deps);
  const view = (await deps.store.listJobs({...c.scope,limit:5})).find(v=>v.job.id===args.jobId.toLowerCase());
  if (!view) throw trialError('prompt_job_not_found',404);
  return {...c,view};
}
export async function readStaffJob(args, deps = STAFF_JOB_DEPENDENCIES) {
  const c = await scopedView(args,deps);
  return {job:await dto(c.view,c.scope,deps)};
}
export async function readStaffResults(args, deps = STAFF_JOB_DEPENDENCIES) {
  const c = await scopedView(args,deps);
  const value = await deps.store.readValidatedResults({...c.scope,jobId:c.view.job.id});
  if (!value) throw trialError('prompt_job_not_found',404);
  return {jobId:value.jobId,version:value.version,expiresAt:value.expiresAt,
    results:value.results.map(r=>({taskKey:r.taskKey,status:r.status,...(r.status==='available'?{text:r.text}:{})}))};
}
export async function admitStaffJob(args, deps = STAFF_JOB_DEPENDENCIES) {
  if (!isGuid(args.idempotencyKey)) throw trialError('invalid_idempotency_key',400);
  const c = await context(args,deps);
  const command = {...c.scope,operation:'generate-draft',idempotencyKey:args.idempotencyKey.toLowerCase(),tasks:PROPOSAL_TASK_KEYS.map(taskKey=>({taskKey}))};
  // Resolve a lost POST before reading mutable prompts or sources. Store replays
  // the same command under its transaction locks and verifies its payload hash.
  const existing = await deps.store.listJobs({...c.scope,limit:5});
  if (existing.some(v=>v.job.idempotency_key===command.idempotencyKey)) {
    const view = await deps.store.admit(command);
    return {job:await dto(view,c.scope,deps)};
  }
  if (existing.length) throw trialError('prompt_job_trial_limit');
  const manifest = await deps.source.inspect({requestId:c.scope.requestId});
  const catalog = await deps.profiles();
  const tasks = [];
  for (const taskKey of PROPOSAL_TASK_KEYS) {
    const promptRow = await deps.prompt(taskKey);
    validateTaskCapability(promptRow,c.scope);
    const spec = parseExecutionSpec(promptRow);
    const matches = catalog.profiles.filter(row=>row.profile.key===spec.profile.key && row.profile.revision===spec.profile.revision && row.sha256===spec.profile.sha256 && hashProfile(row.profile)===row.sha256);
    if (matches.length!==1) throw trialError('prompt_job_profile_unavailable');
    const profile = matches[0].profile;
    if (canonical(profile.documentRoles)!==canonical(['proposal']) || canonical(profile.recordNames)!==canonical(['pi_name'])
      || spec.variables.filter(v=>v.source.kind==='frozen_record').length!==1
      || !spec.variables.some(v=>v.name==='pi_name' && v.source.kind==='frozen_record' && v.required===true)) throw trialError('prompt_job_source_contract');
    tasks.push({taskKey,configuration:{promptRow,profile,scope:{environment:c.scope.environment,authorizationScope:c.scope.authorizationScope,requestId:c.scope.requestId},
      runSource:'Vercel User',manifest,actor:{profileId:c.policy.profileId,systemUserId:c.policy.systemUserId}}});
  }
  if (await deps.authorize(args.actor)!==true || canonical(deps.policy())!==canonical(c.policy)) throw trialError('prompt_job_access_denied',403);
  const now = deps.now();
  const view = await deps.store.admit({...command,tasks,sourceExpiresAt:new Date(now+86400000),resultExpiresAt:new Date(now+7*86400000)});
  return {job:await dto(view,c.scope,deps)};
}
