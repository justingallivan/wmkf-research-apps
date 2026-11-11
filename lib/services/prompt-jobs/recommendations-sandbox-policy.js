/** Server-owned single-Request recommendation read grant. Unset or invalid disables the route. */
import { createHash } from 'node:crypto';
import { classifyDeployment, classifyTarget } from '../../dataverse/core/interlock.js';
import { configuredSharePointTargetInfo, SHAREPOINT_CANONICAL_SITE_URL } from '../sharepoint-target-registry.js';
import { isGuid } from '../../utils/guid.js';
import { EXPERTISE_SANDBOX_SCOPE_PREFIX } from './capabilities.js';
import { canonical, exact, hashProfile } from './profile.js';

export const RECOMMENDATIONS_SANDBOX_HOST = 'orgd9e66399.crm.dynamics.com';
export const RECOMMENDATIONS_SANDBOX_ORIGIN = `https://${RECOMMENDATIONS_SANDBOX_HOST}`;

export function readRecommendationsSandboxTarget(env = process.env, deployment = classifyDeployment()) {
  if (!['local', 'preview'].includes(deployment)
    || (env.VERCEL_ENV !== undefined && !['development', 'preview'].includes(env.VERCEL_ENV))
    || env.DATAVERSE_DAL_ENFORCEMENT !== 'on' || env.DATAVERSE_TARGET_INTERLOCK !== 'on'
    || env.DYNAMICS_URL !== RECOMMENDATIONS_SANDBOX_ORIGIN || classifyTarget(env.DYNAMICS_URL) !== 'sandbox'
    || (env.DYNAMICS_SANDBOX_URL !== undefined && env.DYNAMICS_SANDBOX_URL !== RECOMMENDATIONS_SANDBOX_ORIGIN)
    || configuredSharePointTargetInfo(env).siteUrl !== SHAREPOINT_CANONICAL_SITE_URL) return null;
  return { environment: `${deployment}-sandbox`, targetHost: RECOMMENDATIONS_SANDBOX_HOST };
}

export function readRecommendationsAccessPolicy(env = process.env, deployment = classifyDeployment()) {
  const target = readRecommendationsSandboxTarget(env, deployment);
  if (!target || typeof env.EXPERTISE_RECOMMENDATIONS_READ_ACCESS !== 'string'
    || env.EXPERTISE_RECOMMENDATIONS_READ_ACCESS.length > 2_048) return null;
  try {
    const grant = JSON.parse(env.EXPERTISE_RECOMMENDATIONS_READ_ACCESS);
    const ids = ['requestId', 'jobId', 'systemUserId', 'applicationId', 'scopeId'];
    exact(grant, [...ids, 'profileId'], 'recommendations access grant');
    if (!ids.every(key => isGuid(grant[key]) && grant[key].length === 36 && grant[key] === grant[key].toLowerCase())
      || !Number.isSafeInteger(grant.profileId) || grant.profileId < 1) return null;
    return Object.freeze({ ...grant, ...target, principalKey: `app:${grant.applicationId}`,
      authorizationScope: `${EXPERTISE_SANDBOX_SCOPE_PREFIX}${grant.scopeId}` });
  } catch { return null; }
}

export const RECOMMENDATIONS_TRIAL_MODEL = 'claude-sonnet-4-6';
export const RECOMMENDATIONS_TRIAL_MAX_TOKENS = 4096;
const RECOMMENDATIONS_TRIAL_MAX_INPUT_BOUND = 195_000;

function exactGuid(value) {
  return isGuid(value) && value.length === 36 && value === value.toLowerCase();
}
function hash(value) {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value);
}
function locationId(value) {
  return typeof value === 'string' && value.length <= 256 && /^[a-zA-Z0-9._!,:-]+$/.test(value);
}

/** Local, explicitly enabled operator trial. This grant confers no HTTP access. */
export function readRecommendationsTrialPolicy(env = process.env) {
  if (env.EXPERTISE_RECOMMENDATIONS_TRIAL !== 'on' || env.VERCEL !== undefined
    || env.VERCEL_ENV !== undefined || env.NODE_ENV === 'production') return null;
  const target = readRecommendationsSandboxTarget(env, 'local');
  if (!target || typeof env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS !== 'string'
    || env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS.length > 4096) return null;
  try {
    const grant = JSON.parse(env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS);
    const ids = ['requestId', 'systemUserId', 'azureId', 'applicationId', 'scopeId', 'idempotencyKey', 'promptId'];
    exact(grant, [...ids, 'profileId', 'promptHash', 'profileHash', 'sourceSiteId', 'sourceDriveId', 'sourceHash', 'databaseIdentity'], 'recommendations trial grant');
    if (!ids.every(key => exactGuid(grant[key])) || env.DYNAMICS_CLIENT_ID !== grant.applicationId
      || !Number.isSafeInteger(grant.profileId) || grant.profileId < 1
      || !hash(grant.promptHash) || !hash(grant.profileHash) || !hash(grant.sourceHash) || !hash(grant.databaseIdentity)
      || !locationId(grant.sourceSiteId) || !locationId(grant.sourceDriveId)) return null;
    return Object.freeze({ ...grant, ...target, principalKey: `app:${grant.applicationId}`,
      authorizationScope: `${EXPERTISE_SANDBOX_SCOPE_PREFIX}${grant.scopeId}` });
  } catch { return null; }
}

export function recommendationsTrialCommandHash(policy) {
  return createHash('sha256').update(canonical({ kind: 'expertise-recommendations-trial-v1', policy })).digest('hex');
}

export function matchesRecommendationsTrialScope(scope, policy) {
  return Boolean(policy && scope?.environment === policy.environment && scope?.requestId === policy.requestId
    && scope?.authorizationScope === policy.authorizationScope);
}

export function matchesRecommendationsTrialDefinition(promptRow, profile, policy) {
  if (!policy || promptRow?.wmkf_ai_promptid !== policy.promptId || promptRow.wmkf_ai_model !== RECOMMENDATIONS_TRIAL_MODEL
    || promptRow.wmkf_ai_maxtokens !== RECOMMENDATIONS_TRIAL_MAX_TOKENS || profile?.documentRoles?.length !== 1
    || profile.documentRoles[0] !== 'proposal') return false;
  const normalized = { ...promptRow, wmkf_ai_systemprompt: promptRow.wmkf_ai_systemprompt ?? '' };
  return createHash('sha256').update(canonical(normalized)).digest('hex') === policy.promptHash && hashProfile(profile) === policy.profileHash;
}

/** Bound input by encoded UTF-8 bytes, including message framing. */
export function profiledInputUpperBound(composed, outputSchema) {
  return Buffer.byteLength(canonical({ system: composed.system, messages: composed.userContent, outputSchema })) + 4096;
}

export function recommendationsTrialBudget(inputUpperBound, maxTokens) {
  if (!Number.isSafeInteger(inputUpperBound) || inputUpperBound < 1 || inputUpperBound > RECOMMENDATIONS_TRIAL_MAX_INPUT_BOUND
    || maxTokens !== RECOMMENDATIONS_TRIAL_MAX_TOKENS) throw new Error('recommendations trial context or output exceeds budget');
  // Leave 5,000 tokens of headroom below the reviewed context threshold.
  // Per-million USD rates yield microdollars for raw token counts. Assume a
  // 1-hour cache write, US-only multiplier and an additional 20% margin.
  const costCeilingMicros = Math.ceil(((inputUpperBound + 5000) * 6 + maxTokens * 15) * 132 / 100);
  if (costCeilingMicros > 10_000_000) throw new Error('recommendations trial spend exceeds budget');
  return { inputUpperBound, maxTokens, costCeilingMicros };
}
