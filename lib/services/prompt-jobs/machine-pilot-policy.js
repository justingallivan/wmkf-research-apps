/** Default-off sandbox machine pilot. Configuration is server-owned, never request data. */
import { validateDestinationGrant } from './machine-destination.js';
import { createHash } from 'node:crypto';
import { classifyDeployment, classifyTarget } from '../../dataverse/core/interlock.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';

const KEYS = ['enabled','pilotId','requestId','sourceEventId','tenantId','audience','clientId','servicePrincipalId','role',
  'promptId','promptVersion','promptHash','profileHash','databaseIdentity','databaseEndpoint','expiresAt'];
const IDS = ['pilotId','requestId','sourceEventId','tenantId','audience','clientId','servicePrincipalId','promptId'];
const HASH = /^[a-f0-9]{64}$/;
export function machinePilotError(code, httpStatus = 503) { return new ServiceHttpError(code, { code, httpStatus, body: { error: code } }); }
export function machineDatabaseEndpoint(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw machinePilotError('machine_pilot_configuration'); }
  const params = [...url.searchParams.entries()];
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 ||
      connectionString.includes('#') || params.length > 1 ||
      params.some(([key, value]) => key !== 'sslmode' || !['require', 'verify-full'].includes(value))) {
    throw machinePilotError('machine_pilot_configuration');
  }
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}`;
}
export function readMachinePilotPolicy(env = process.env, deployment = classifyDeployment()) {
  if (!env.PROMPT_JOB_MACHINE_PILOT) return null;
  let raw;
  try { raw = JSON.parse(env.PROMPT_JOB_MACHINE_PILOT); } catch { throw machinePilotError('machine_pilot_configuration'); }
  const invalid = () => { throw machinePilotError('machine_pilot_configuration'); };
  const hasGrant = raw && Object.hasOwn(raw, 'destinationGrant');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== KEYS.length + (hasGrant ? 1 : 0)
    || KEYS.some(key => !Object.hasOwn(raw,key)) || typeof raw.enabled !== 'boolean') invalid();
  const value = { ...raw };
  if (hasGrant) {
    try { value.destinationGrant = Object.freeze({ ...validateDestinationGrant(raw.destinationGrant) }); } catch { invalid(); }
  }
  for (const key of IDS) {
    if (typeof value[key] !== 'string' || value[key] !== value[key].trim() || !isGuid(value[key])) invalid();
    value[key] = value[key].toLowerCase();
  }
  let target;
  try { target = new URL(env.DYNAMICS_URL); } catch { invalid(); }
  const environment = `${deployment}-${classifyTarget(env.DYNAMICS_URL)}`;
  if (target.protocol !== 'https:' || target.username || target.password || target.port || target.pathname !== '/' || target.search || target.hash
    || (deployment === 'local' && env.NODE_ENV === 'production')
    || !['local-sandbox','preview-sandbox','test-sandbox'].includes(environment)
    || env.DATAVERSE_TARGET_INTERLOCK !== 'on' || env.DATAVERSE_DAL_ENFORCEMENT !== 'on'
    || typeof env.PROMPT_JOB_NONCE_SECRET !== 'string' || Buffer.byteLength(env.PROMPT_JOB_NONCE_SECRET) < 32
    || !Number.isSafeInteger(value.promptVersion) || value.promptVersion < 1
    || !['promptHash','profileHash','databaseIdentity'].every(key => typeof value[key] === 'string' && HASH.test(value[key]))
    || typeof value.role !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value.role)
    || value.databaseEndpoint !== machineDatabaseEndpoint(env.POSTGRES_URL)
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) invalid();
  // Include the actual target and nonce fingerprint in currentness checks. No
  // connection string or secret value is retained in frozen job configuration.
  return Object.freeze({ ...value, environment, targetHost: target.hostname,
    nonceHash: createHash('sha256').update(env.PROMPT_JOB_NONCE_SECRET).digest('hex'),
    authorizationScope: `pa-short-title:${value.pilotId}`,
    principalKey: `app:entra-v2:${value.tenantId}:${value.clientId}:${value.servicePrincipalId}` });
}
export function activeMachinePilot(policy, now = Date.now()) {
  const expiry = Date.parse(policy?.expiresAt);
  return policy?.enabled === true && Number.isFinite(now) && expiry > now && expiry <= now + 7 * 86400000;
}
export function machinePilotScope(policy) {
  return { environment: policy.environment, principalKey: policy.principalKey,
    authorizationScope: policy.authorizationScope, requestId: policy.requestId };
}
export function matchesMachinePilotScope(scope, policy) {
  return Boolean(policy && Object.entries(machinePilotScope(policy)).every(([key,value]) => scope?.[key] === value));
}
export function machineAuthPolicy(policy) {
  if (!activeMachinePilot(policy)) return null;
  return { enabled: true, tenantId: policy.tenantId, audience: policy.audience, clientId: policy.clientId,
    servicePrincipalId: policy.servicePrincipalId, role: policy.role };
}
