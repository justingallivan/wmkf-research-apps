/** Default-off, single-actor/single-Request trial policy. Configuration never grants Dataverse access by itself. */
import { classifyDeployment, classifyTarget } from '../../dataverse/core/interlock.js';
import { isGuid } from '../../utils/guid.js';
import { PROPOSAL_ENVIRONMENTS } from './capabilities.js';
import { ServiceHttpError } from '../service-http-error.js';

export const SOURCE_POLICY = 'ai-materials-proposal-pi-v1';
export function trialError(code, httpStatus = 409) {
  return new ServiceHttpError(code, { code, httpStatus, body: { error: code, code } });
}
export function readTrialPolicy(env = process.env, deployment = classifyDeployment()) {
  const raw = env.PROMPT_JOB_TRIAL_ACCESS;
  if (!raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch { throw trialError('prompt_job_trial_configuration', 503); }
  const environment = `${deployment}-${classifyTarget(env.DYNAMICS_URL)}`;
  const keys = ['trialId','requestId','profileId','systemUserId','sourcePolicy'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
      || Object.keys(value).some(key => !keys.includes(key)) || !PROPOSAL_ENVIRONMENTS.includes(environment)
      || !['trialId','requestId','systemUserId'].every(key => isGuid(value[key]) && value[key] === value[key].toLowerCase())
      || !Number.isSafeInteger(value.profileId) || value.profileId < 1 || value.sourcePolicy !== SOURCE_POLICY
      || env.DYNAMICS_IMPERSONATION_ENABLED !== 'true'
      || typeof env.PROMPT_JOB_NONCE_SECRET !== 'string' || Buffer.byteLength(env.PROMPT_JOB_NONCE_SECRET) < 32) {
    throw trialError('prompt_job_trial_configuration', 503);
  }
  return Object.freeze({...value,environment,authorizationScope:`proposal-trial:${value.trialId}`,principalKey:`profile:${value.profileId}`});
}
export function matchesTrialActor(policy, actor, requestId) {
  return Boolean(policy && requestId === policy.requestId && actor?.profileId === policy.profileId
    && typeof actor?.systemUserId === 'string' && actor.systemUserId.toLowerCase() === policy.systemUserId);
}
export function scopeForTrial(policy) {
  return {environment:policy.environment,principalKey:policy.principalKey,authorizationScope:policy.authorizationScope,requestId:policy.requestId};
}
