/** Server-owned single-Request recommendation read grant. Unset or invalid disables the route. */
import { classifyDeployment, classifyTarget } from '../../dataverse/core/interlock.js';
import { configuredSharePointTargetInfo, SHAREPOINT_CANONICAL_SITE_URL } from '../sharepoint-target-registry.js';
import { isGuid } from '../../utils/guid.js';
import { EXPERTISE_SANDBOX_SCOPE_PREFIX } from './capabilities.js';
import { exact } from './profile.js';

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
