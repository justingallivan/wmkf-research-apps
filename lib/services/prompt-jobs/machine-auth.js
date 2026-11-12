/**
 * Server-only Entra v2 application identity verification; not request authorization.
 * No route or environment configuration enables this module yet. Callers own the
 * server policy, request grant and reauthorization before each protected operation.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';

const CONFIG_KEYS = ['enabled', 'tenantId', 'audience', 'clientId', 'servicePrincipalId', 'role'];
const MAX_LIFETIME_SECONDS = 7200;
const TOKEN_ERRORS = new Set(['ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS']);
function fail(status) {
  const code = status === 503 ? 'machine_auth_unavailable' : status === 403 ? 'machine_access_denied' : 'machine_auth_invalid';
  throw new ServiceHttpError(code, { httpStatus: status, code, body: { error: code } });
}
function guid(value) {
  return typeof value === 'string' && value === value.trim() && isGuid(value) ? value.toLowerCase() : null;
}
function policy(readPolicy) {
  let raw;
  try { raw = readPolicy(); } catch { fail(503); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.enabled !== true
    || Object.keys(raw).some(k => !CONFIG_KEYS.includes(k))) fail(503);
  const result = { enabled: true };
  for (const key of ['tenantId', 'audience', 'clientId', 'servicePrincipalId']) {
    result[key] = guid(raw[key]);
    if (!result[key]) fail(503);
  }
  if (typeof raw.role !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(raw.role)) fail(503);
  result.role = raw.role;
  return Object.freeze(result);
}
function bearer(header) {
  if (typeof header !== 'string' || header.length > 16384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) fail(401);
  return header.slice(7);
}

/** Dependencies are server-owned; resolver/clock injection is for offline tests. */
export function createMachineAuthenticator({ readPolicy, createKeySet = createRemoteJWKSet, now = () => Date.now() }) {
  // One bounded cache slot. Reconfiguration replaces, never reuses, another tenant's resolver.
  let cachedUrl;
  let cachedKeys;
  return async function authenticate(authorization) {
    const config = policy(readPolicy);
    const fingerprint = JSON.stringify(config);
    const token = bearer(authorization);
    const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
    const url = `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`;
    if (cachedUrl !== url) {
      try {
        cachedKeys = createKeySet(new URL(url), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 });
      } catch { fail(503); }
      cachedUrl = url;
    }
    const keys = cachedKeys;
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        algorithms: ['RS256'], issuer, audience: config.audience, clockTolerance: 0,
        requiredClaims: ['exp', 'nbf', 'iat', 'tid', 'ver', 'azp', 'oid', 'idtyp', 'roles'],
        currentDate: new Date(now()),
      }));
    } catch (error) {
      const code = error?.code;
      if (TOKEN_ERRORS.has(code) || (typeof code === 'string' && /^(ERR_JWS_|ERR_JWT_)/.test(code))) fail(401);
      // Unknown verifier failures are dependency failures, never raw diagnostics.
      fail(503);
    }
    function assertCurrent() {
      if (JSON.stringify(policy(readPolicy)) !== fingerprint) fail(503);
      const seconds = Math.floor(now() / 1000);
      if (!Number.isSafeInteger(seconds) || seconds < payload.nbf || seconds >= payload.exp) fail(401);
    }
    assertCurrent();
    const seconds = Math.floor(now() / 1000);
    if (payload.ver !== '2.0' || payload.tid !== config.tenantId || payload.aud !== config.audience
      || payload.idtyp !== 'app' || Object.hasOwn(payload, 'scp')
      || !['iat', 'nbf', 'exp'].every(k => Number.isSafeInteger(payload[k]) && payload[k] >= 0)
      || payload.iat > seconds || payload.iat >= payload.exp || payload.nbf >= payload.exp
      || payload.exp - payload.iat > MAX_LIFETIME_SECONDS
      || !Array.isArray(payload.roles) || !payload.roles.length || payload.roles.some(r => typeof r !== 'string')) fail(401);
    if (payload.azp !== config.clientId || payload.oid !== config.servicePrincipalId || !payload.roles.includes(config.role)) fail(403);
    return Object.freeze({
      tenantId: config.tenantId, clientId: config.clientId, servicePrincipalId: config.servicePrincipalId,
      principalKey: `app:entra-v2:${config.tenantId}:${config.clientId}:${config.servicePrincipalId}`,
      assertCurrent,
    });
  };
}
