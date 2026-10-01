/**
 * Dedicated deployment identity and route policy for the isolated pilot app.
 *
 * The project registry is intentionally empty until Vercel creates the
 * dedicated project. Runtime code never reads an expected project ID from an
 * environment variable. A deployment-profile marker activates isolation even
 * before registration; a registered project ID activates isolation even if
 * the marker is accidentally omitted.
 */

export const TRANSCRIPTION_PILOT_PROFILE_ENV = 'TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE';
export const TRANSCRIPTION_PILOT_PROFILE_VALUE = 'transcription-pilot';

// Fill only with an owner-verified Vercel project ID and auth origin after
// project creation. An empty registry intentionally keeps new-project checks
// and routes fail-closed for now.
export const DEDICATED_TRANSCRIPTION_PROJECT_REGISTRY = Object.freeze([]);

const AUTH_ROUTE_METHODS = Object.freeze({
  '/api/auth/providers': ['GET'],
  '/api/auth/csrf': ['GET'],
  '/api/auth/signin/azure-ad': ['GET', 'POST'],
  '/api/auth/callback/azure-ad': ['GET', 'POST'],
  '/api/auth/session': ['GET'],
  '/api/auth/signout': ['GET', 'POST'],
  '/api/auth/error': ['GET'],
});

const AZURE_CALLBACK_QUERY_KEYS = new Set([
  'code', 'state', 'session_state', 'error', 'error_description', 'error_uri',
  'error_codes', 'error_subcode', 'timestamp', 'trace_id', 'correlation_id',
  'iss', 'client_info', 'client-request-id',
]);

function registryEntryForProject(projectId, registry) {
  if (!projectId || !Array.isArray(registry)) return null;
  return registry.find((entry) => entry && entry.projectId === projectId) || null;
}

/** Pure helper; the optional registry argument exists for unit fixtures only. */
export function getTranscriptionPilotDeploymentProfile(
  env = process.env,
  registry = DEDICATED_TRANSCRIPTION_PROJECT_REGISTRY
) {
  const markerPresent = Object.prototype.hasOwnProperty.call(env, TRANSCRIPTION_PILOT_PROFILE_ENV);
  const markerValue = env[TRANSCRIPTION_PILOT_PROFILE_ENV];
  const registeredProject = registryEntryForProject(env.VERCEL_PROJECT_ID, registry);
  const dedicated = markerPresent || Boolean(registeredProject);
  const markerValid = !markerPresent || markerValue === TRANSCRIPTION_PILOT_PROFILE_VALUE;
  const identityVerified = Boolean(registeredProject) && markerValid;

  return {
    dedicated,
    markerPresent,
    markerValid,
    identityVerified,
    registeredProject,
  };
}

export function isDedicatedTranscriptionAuthConfigured(env = process.env) {
  return env.NODE_ENV === 'production'
    && env.AUTH_REQUIRED === 'true'
    && env.EMERGENCY_AUTH_BYPASS !== 'true'
    && Boolean(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID)
    && typeof env.NEXTAUTH_SECRET === 'string'
    && env.NEXTAUTH_SECRET.length >= 32;
}

function asSearchParams(searchParams) {
  if (searchParams instanceof URLSearchParams) return searchParams;
  if (typeof searchParams === 'string') return new URLSearchParams(searchParams.replace(/^\?/, ''));
  return new URLSearchParams();
}

function noQuery(params) {
  return [...params.keys()].length === 0;
}

function exactQuery(params, key, value) {
  return [...params.entries()].length === 1 && params.get(key) === value;
}

function onlyQueryKeys(params, allowedKeys, requiredKeys = []) {
  const keys = [...params.keys()];
  return new Set(keys).size === keys.length && keys.every((key) => allowedKeys.has(key))
    && requiredKeys.every((key) => params.has(key));
}

function pilotJobPathDecision(pathname, method, params) {
  if (pathname === '/api/admin/transcription-pilot/jobs') {
    if (method === 'GET') return noQuery(params) || exactQuery(params, 'limit', '50');
    return method === 'POST' && noQuery(params);
  }

  if (pathname === '/api/admin/transcription-pilot/evaluation-export') {
    return method === 'GET' && noQuery(params);
  }

  const match = pathname.match(/^\/api\/admin\/transcription-pilot\/jobs\/([A-Za-z0-9_-]{1,128})(?:\/(start|evaluation|reconcile|abandon|download))?$/);
  if (!match) return false;
  const action = match[2] || '';
  if (!action) return (method === 'GET' && noQuery(params)) || (method === 'DELETE' && noQuery(params));
  if (action === 'start' || action === 'reconcile' || action === 'abandon') return method === 'POST' && noQuery(params);
  if (action === 'evaluation') return method === 'PATCH' && noQuery(params);
  if (action === 'download') return method === 'GET' && exactQuery(params, 'format', 'txt')
    || method === 'GET' && exactQuery(params, 'format', 'vtt');
  return false;
}

/**
 * Pure exact route allowlist. `staffSession` means NextAuth must authorize the
 * request; `routeAuth` means the handler/SDK owns its existing credential.
 */
export function decideTranscriptionPilotRoute({ pathname, method = 'GET', searchParams = '' }) {
  const params = asSearchParams(searchParams);
  const verb = String(method).toUpperCase();
  if (pathname === '/' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession', redirectTo: '/admin/transcription-pilot' };
  }
  if ((verb === 'GET' || verb === 'HEAD') && (pathname.startsWith('/_next/static/')
      || pathname === '/favicon.ico' || /^\/apple-touch-icon(?:-[^/]*)?\.png$/.test(pathname))) {
    return { allowed: true, auth: 'public' };
  }
  if (pathname === '/admin/transcription-pilot' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (['/auth/signin', '/auth/error'].includes(pathname) && verb === 'GET') {
    return { allowed: true, auth: 'public' };
  }
  if (pathname === '/api/auth/status' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'public' };
  }
  if (AUTH_ROUTE_METHODS[pathname]?.includes(verb) && noQuery(params)) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname === '/api/auth/callback/azure-ad' && ['GET', 'POST'].includes(verb)
      && onlyQueryKeys(params, AZURE_CALLBACK_QUERY_KEYS, ['state'])) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname === '/api/user-profiles' && ['GET', 'PATCH'].includes(verb) && noQuery(params)) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (pathname === '/api/user-preferences') {
    const allowedGetQuery = noQuery(params)
      || ([...params.keys()].length === 1 && /^\d+$/.test(params.get('profileId') || '') && params.has('profileId'));
    if (verb === 'GET' && allowedGetQuery) {
      return { allowed: true, auth: 'staffSession' };
    }
  }
  if (pathname === '/api/app-access' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (pathname === '/api/admin/alerts' && verb === 'GET' && exactQuery(params, 'summary', 'true')) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (pilotJobPathDecision(pathname, verb, params)) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (pathname === '/api/webhooks/assemblyai' && verb === 'POST'
      && [...params.keys()].length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get('attempt') || '')
      && params.has('attempt')) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname === '/api/cron/drain-transcriptions' && verb === 'GET'
      && (noQuery(params) || exactQuery(params, 'recovery', '1') || exactQuery(params, 'preflight', '1'))
      || pathname === '/api/cron/drain-transcriptions' && verb === 'POST'
        && exactQuery(params, 'workflow_probe', '1')) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname.startsWith('/.well-known/workflow/v1/')) {
    return { allowed: true, auth: 'routeAuth' };
  }

  // Next serves page data separately from the HTML; allow only the pilot page's
  // generated data object, not data for the rest of the multi-app site.
  if (/^\/_next\/data\/[A-Za-z0-9_-]+\/admin\/transcription-pilot\.json$/.test(pathname)
      && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession' };
  }
  return { allowed: false, auth: 'deny' };
}

/** Pure request classifier used by proxy and unit tests. */
export function decideTranscriptionPilotRequest({
  env = process.env,
  pathname = '/',
  method = 'GET',
  searchParams = '',
  registry = DEDICATED_TRANSCRIPTION_PROJECT_REGISTRY,
} = {}) {
  const profile = getTranscriptionPilotDeploymentProfile(env, registry);
  if (!profile.dedicated) return { dedicated: false, identityVerified: false, allowed: true, auth: 'legacy' };
  const route = decideTranscriptionPilotRoute({ pathname, method, searchParams });
  return {
    dedicated: true,
    identityVerified: profile.identityVerified,
    allowed: profile.identityVerified && route.allowed,
    auth: profile.identityVerified ? route.auth : 'deny',
    redirectTo: profile.identityVerified ? route.redirectTo : undefined,
  };
}

/** Exact legacy routes intentionally bypass the shared NextAuth proxy. */
export function isLegacyProxyPassThrough(pathname = '') {
  return pathname.startsWith('/api/auth')
    || pathname.startsWith('/_next/static')
    || pathname.startsWith('/_next/image')
    || pathname.startsWith('/favicon.ico')
    || pathname.startsWith('/apple-touch-icon')
    || pathname.startsWith('/api/cron')
    || pathname.startsWith('/api/irs')
    || pathname.startsWith('/.well-known/workflow/')
    || pathname === '/api/webhooks/bill'
    || pathname === '/api/webhooks/vercel-log-drain'
    || pathname === '/api/webhooks/assemblyai'
    || pathname === '/api/bill/onboard-reviewer';
}
