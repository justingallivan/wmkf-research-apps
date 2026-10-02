/** Isolated, sign-in-only policy for the Meeting Tracker test Preview project. */

import rehearsalFixture from './rehearsal-fixture.js';

export const MEETING_TRANSCRIPTION_TEST_PROFILE_ENV = 'MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE';
export const MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE = 'meeting-transcription-test';
export const MEETING_TRANSCRIPTION_TEST_PROJECT_ID = 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB';
export const MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN = 'https://wmkf-meeting-transcription-test.vercel.app';
export const MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV = 'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED';
export const MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_VALUE = 'on';
export const MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV = 'MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED';
export const MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID = '4236c2b3-b053-f111-bec7-6045bd015cb0';
export const MEETING_TRANSCRIPTION_SUPERVISED_TEST_SITE_VISIT_ID = '38bf47c0-c1aa-46fc-b9d0-167aa76ad962';
export const MEETING_TRANSCRIPTION_SUPERVISED_TEST_DYNAMICS_ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const REHEARSAL_REQUEST_ID = rehearsalFixture.REHEARSAL_REQUEST_ID;
const { REHEARSAL_JOB_ID } = rehearsalFixture;

const NEXTAUTH_CALLBACK_QUERY_KEYS = new Set([
  'code', 'state', 'session_state', 'error', 'error_description', 'error_uri',
  'error_codes', 'error_subcode', 'timestamp', 'trace_id', 'correlation_id',
  'iss', 'client_info', 'client-request-id',
]);

const NEXTAUTH_PAGE_ERRORS = new Set([
  'AccessDenied', 'Callback', 'Configuration', 'Default', 'EmailCreateAccount',
  'OAuthAccountNotLinked', 'OAuthCallback', 'OAuthCreateAccount', 'OAuthSignin',
  'SessionRequired', 'Verification',
]);

const NEXTAUTH_ROUTE_METHODS = Object.freeze({
  '/api/auth/providers': ['GET'],
  '/api/auth/csrf': ['GET'],
  '/api/auth/signin/azure-ad': ['GET', 'POST'],
  '/api/auth/callback/azure-ad': ['GET', 'POST'],
  '/api/auth/session': ['GET'],
  '/api/auth/signout': ['GET', 'POST'],
});

export function getMeetingTranscriptionTestDeploymentProfile(env = process.env) {
  const markerPresent = Object.prototype.hasOwnProperty.call(env, MEETING_TRANSCRIPTION_TEST_PROFILE_ENV);
  const markerValid = !markerPresent || env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV] === MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE;
  const registeredProject = env.VERCEL_PROJECT_ID === MEETING_TRANSCRIPTION_TEST_PROJECT_ID;
  const dedicated = markerPresent || registeredProject;
  const identityVerified = registeredProject && markerValid;
  const authenticationReady = env.VERCEL_ENV === 'preview'
    && env.NODE_ENV === 'production'
    && env.AUTH_REQUIRED === 'true'
    && env.EMERGENCY_AUTH_BYPASS !== 'true'
    && Boolean(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID)
    && typeof env.NEXTAUTH_SECRET === 'string'
    && env.NEXTAUTH_SECRET.length >= 32
    && env.NEXTAUTH_URL === MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN;

  return {
    dedicated,
    markerPresent,
    markerValid,
    registeredProject,
    identityVerified,
    authenticationReady,
    enabled: dedicated && identityVerified && authenticationReady,
  };
}

/** Explicit project/deployment opt-in; kept independent from transcription/provider flags. */
export function isMeetingTranscriptionRehearsalReady(env = process.env) {
  const profile = getMeetingTranscriptionTestDeploymentProfile(env);
  return profile.enabled && env.VERCEL_ENV === 'preview'
    && env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV] === MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_VALUE
    && env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY === 'on'
    && env.MEETING_TRACKER_TRANSCRIPTION_ACCESS === `test:${REHEARSAL_REQUEST_ID}`;
}

/**
 * The supervised test is a separate, fail-closed mode of the dedicated
 * Preview. An absent or explicit `off` flag preserves existing behavior;
 * any other present value claims the mode and must validate completely.
 */
export function getMeetingTranscriptionSupervisedTestPolicy(env = process.env, requestOrigin = null) {
  const raw = env[MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV];
  const requested = raw !== undefined && raw !== 'off';
  if (!requested) return { requested: false, enabled: false };

  const profile = getMeetingTranscriptionTestDeploymentProfile(env);
  const matchesDynamicsOrigin = (value) => {
    try {
      const url = new URL(value);
      return url.origin === MEETING_TRANSCRIPTION_SUPERVISED_TEST_DYNAMICS_ORIGIN
        && (url.pathname === '' || url.pathname === '/')
        && !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
  };
  const dynamicsReady = matchesDynamicsOrigin(env.DYNAMICS_URL)
    && (env.DYNAMICS_SANDBOX_URL === undefined || matchesDynamicsOrigin(env.DYNAMICS_SANDBOX_URL));
  const requestAccess = `test:${MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID}`;
  const exclusive = env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV] === undefined
    || env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV] === 'off';
  const enabled = raw === 'on'
    && profile.enabled
    && env.VERCEL_ENV === 'preview'
    && env.VERCEL_PROJECT_ID === MEETING_TRANSCRIPTION_TEST_PROJECT_ID
    && (requestOrigin === null || requestOrigin === MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN)
    && dynamicsReady
    && env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY === 'on'
    && env.MEETING_TRACKER_TRANSCRIPTION_ACCESS === requestAccess
    && env.POST_PRESENTATION_MATERIALS_SCHEMA_READY === 'on'
    && env.POST_PRESENTATION_MATERIALS_ACCESS === requestAccess
    && (env.TRANSCRIPTION_CALLBACK_URL === undefined || env.TRANSCRIPTION_CALLBACK_URL === MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN)
    && exclusive
    && env.TRANSCRIPTION_PILOT_ENABLED !== 'true'
    && env.TRANSCRIPTION_SUBMISSIONS_ENABLED !== 'true';
  return {
    requested: true,
    enabled,
    requestId: MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID,
    siteVisitActivityId: MEETING_TRANSCRIPTION_SUPERVISED_TEST_SITE_VISIT_ID,
  };
}

export function assertMeetingTranscriptionSupervisedTestBinding(requestId, siteVisitActivityId, env = process.env) {
  const policy = getMeetingTranscriptionSupervisedTestPolicy(env);
  if (!policy.requested) return false;
  if (!policy.enabled) {
    const error = new Error('The supervised transcription test is not configured for this Preview.');
    error.code = 'meeting_transcription_supervised_test_misconfigured';
    error.httpStatus = 503;
    throw error;
  }
  if (String(requestId || '').toLowerCase() !== policy.requestId
      || (siteVisitActivityId != null
        && String(siteVisitActivityId).toLowerCase() !== policy.siteVisitActivityId)) {
    const error = new Error('The request or Site Visit is outside the supervised transcription test.');
    error.code = 'meeting_transcription_supervised_test_binding_mismatch';
    error.httpStatus = 404;
    throw error;
  }
  return true;
}

function paramsOf(searchParams) {
  if (searchParams instanceof URLSearchParams) return searchParams;
  if (typeof searchParams === 'string') return new URLSearchParams(searchParams.replace(/^\?/, ''));
  return new URLSearchParams();
}

function noQuery(params) {
  return params.size === 0;
}

function uniqueAllowedKeys(params, allowed, required = []) {
  const keys = [...params.keys()];
  return new Set(keys).size === keys.length
    && keys.every((key) => allowed.has(key))
    && required.every((key) => params.has(key));
}

function validPageQuery(pathname, params) {
  if (noQuery(params)) return true;
  if (pathname === '/auth/signin') {
    if (!uniqueAllowedKeys(params, new Set(['callbackUrl', 'error']))) return false;
    const callbackUrl = params.get('callbackUrl');
    const error = params.get('error');
    const canonicalCallback = callbackUrl === null || callbackUrl === '/'
      || callbackUrl === MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN
      || callbackUrl === `${MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN}/`;
    return canonicalCallback
      && (error === null || NEXTAUTH_PAGE_ERRORS.has(error));
  }
  return pathname === '/auth/error'
    && uniqueAllowedKeys(params, new Set(['error']), ['error'])
    && NEXTAUTH_PAGE_ERRORS.has(params.get('error'));
}

function exactQuery(params, expected) {
  const entries = [...params.entries()];
  return entries.length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => params.getAll(key).length === 1 && params.get(key) === value);
}

function decideSupervisedTestRoute(pathname, verb, params) {
  const request = MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID;
  const requestPath = (suffix = '') => new RegExp(`^/api/meeting-tracker/visits/${request}${suffix}$`, 'i');
  const job = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const isRequestPage = new RegExp(`^/meeting-tracker/visits/${request}$`, 'i');
  const isWorkbenchPage = new RegExp(`^/workbench/${request}$`, 'i');
  const trackerQuery = () => {
    const allowed = new Set(['n']);
    const entries = [...params.entries()];
    return entries.every(([key, value]) => allowed.has(key) && (key !== 'n' || value === '1000334'))
      && new Set(entries.map(([key]) => key)).size === entries.length;
  };
  const workbenchQuery = () => exactQuery(params, { tab: 'staff-deliberations', n: '1000334' });
  const requestQuery = () => exactQuery(params, { requestId: request });
  const requestBodylessPath = (path) => path.test(pathname) && params.size === 0;

  if (pathname === '/' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession', redirectTo: `/meeting-tracker/visits/${request}?n=1000334` };
  }
  if (pathname.startsWith('/_next/static/') && ['GET', 'HEAD'].includes(verb) && params.size === 0) {
    return { allowed: true, auth: 'public' };
  }
  if (isRequestPage.test(pathname) && verb === 'GET' && trackerQuery()) {
    return { allowed: true, auth: 'staffSession' };
  }
  if (isWorkbenchPage.test(pathname) && verb === 'GET' && workbenchQuery()) {
    return { allowed: true, auth: 'staffSession' };
  }
  const requestData = new RegExp(`^/_next/data/[A-Za-z0-9_-]+/meeting-tracker/visits/${request}\\.json$`, 'i');
  const workbenchData = new RegExp(`^/_next/data/[A-Za-z0-9_-]+/workbench/${request}\\.json$`, 'i');
  if (requestData.test(pathname) && verb === 'GET' && trackerQuery()) return { allowed: true, auth: 'staffSession' };
  if (workbenchData.test(pathname) && verb === 'GET' && workbenchQuery()) return { allowed: true, auth: 'staffSession' };

  if (requestBodylessPath(new RegExp(`^/api/meeting-tracker/visits/${request}$`, 'i')) && verb === 'GET') return { allowed: true, auth: 'routeAuth' };
  if (pathname === '/api/meeting-tracker/recipients' && verb === 'GET' && params.size === 0) return { allowed: true, auth: 'routeAuth' };
  if (requestPath('/transcriptions').test(pathname) && params.size === 0 && ['GET', 'POST'].includes(verb)) return { allowed: true, auth: 'routeAuth' };
  const jobPath = requestPath(`/transcriptions/${job}`);
  if (jobPath.test(pathname) && params.size === 0 && verb === 'GET') return { allowed: true, auth: 'routeAuth' };
  const speakerPath = requestPath(`/transcriptions/${job}/speakers`);
  if (speakerPath.test(pathname) && params.size === 0 && verb === 'PATCH') return { allowed: true, auth: 'routeAuth' };
  const startPath = requestPath(`/transcriptions/${job}/start`);
  if (startPath.test(pathname) && params.size === 0 && verb === 'POST') return { allowed: true, auth: 'routeAuth' };
  const publishPath = requestPath(`/transcriptions/${job}/publish`);
  if (publishPath.test(pathname) && params.size === 0 && verb === 'POST') return { allowed: true, auth: 'routeAuth' };
  const draftDownload = requestPath(`/transcriptions/${job}/download`);
  const publishedDownload = requestPath(`/transcriptions/materials/${job}/download`);
  if ((draftDownload.test(pathname) || publishedDownload.test(pathname)) && verb === 'GET'
      && params.getAll('format').length === 1 && params.size === 1
      && ['txt', 'vtt'].includes(params.get('format'))) return { allowed: true, auth: 'routeAuth' };

  if (pathname === '/api/workbench/resolve-request' && verb === 'GET' && requestQuery()) return { allowed: true, auth: 'routeAuth' };
  if (['/api/workbench/pre-site-visit', '/api/workbench/pre-rp-brief',
    '/api/workbench/pre-site-visit/distribution/history', '/api/workbench/site-visit/logistics']
    .includes(pathname) && verb === 'GET' && requestQuery()) return { allowed: true, auth: 'routeAuth' };
  if (pathname === '/api/workbench/site-visit/recipients' && verb === 'GET' && params.size === 0) return { allowed: true, auth: 'routeAuth' };
  if (['/api/user-profiles', '/api/app-access'].includes(pathname) && verb === 'GET' && params.size === 0) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname === '/api/user-preferences' && verb === 'GET' && exactQuery(params, { profileId: '1' })) {
    return { allowed: true, auth: 'routeAuth' };
  }

  // Vercel Workflow's combined flow endpoint dispatches both workflow and step deliveries.
  if (pathname === '/.well-known/workflow/v1/flow' && verb === 'POST' && params.size === 0) return { allowed: true, auth: 'routeAuth' };
  if (pathname === '/api/webhooks/assemblyai' && verb === 'POST'
      && params.getAll('attempt').length === 1 && params.size === 1
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get('attempt'))) {
    return { allowed: true, auth: 'routeAuth' };
  }
  return { allowed: false, auth: 'deny' };
}

export function decideMeetingTranscriptionTestRoute({ pathname, method = 'GET', searchParams = '', env = process.env, origin = null } = {}) {
  const params = paramsOf(searchParams);
  const verb = String(method).toUpperCase();
  const supervised = getMeetingTranscriptionSupervisedTestPolicy(env, origin);

  if (supervised.requested && !supervised.enabled) return { allowed: false, auth: 'deny' };
  if (supervised.requested && pathname === '/' && verb === 'GET' && noQuery(params)) {
    return decideSupervisedTestRoute(pathname, verb, params);
  }

  if (pathname === '/' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'staffSession', redirectTo: isMeetingTranscriptionRehearsalReady(env)
      ? '/meeting-tracker/transcription-rehearsal' : '/api/auth/session' };
  }
  if ((verb === 'GET' || verb === 'HEAD') && noQuery(params)
      && (pathname.startsWith('/_next/static/') || pathname === '/favicon.ico'
        || /^\/apple-touch-icon(?:-[^/]*)?\.png$/.test(pathname))) {
    return { allowed: true, auth: 'public' };
  }
  if ((pathname === '/auth/signin' || pathname === '/auth/error')
      && verb === 'GET' && validPageQuery(pathname, params)) {
    return { allowed: true, auth: 'public' };
  }

  if (pathname === '/api/auth/callback/azure-ad' && ['GET', 'POST'].includes(verb)
      && uniqueAllowedKeys(params, NEXTAUTH_CALLBACK_QUERY_KEYS, ['state'])) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (NEXTAUTH_ROUTE_METHODS[pathname]?.includes(verb) && noQuery(params)) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if (pathname === '/api/auth/status' && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'routeAuth' };
  }
  if ((pathname === '/api/auth/error') && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'routeAuth' };
  }
  // Next.js may fetch page data while hydrating these two public sign-in pages.
  if (/^\/_next\/data\/[A-Za-z0-9_-]+\/auth\/(?:signin|error)\.json$/.test(pathname)
      && verb === 'GET' && noQuery(params)) {
    return { allowed: true, auth: 'public' };
  }

  if (supervised.requested) return decideSupervisedTestRoute(pathname, verb, params);

  if (isMeetingTranscriptionRehearsalReady(env)) {
    if (pathname === '/meeting-tracker/transcription-rehearsal' && verb === 'GET' && noQuery(params)) {
      return { allowed: true, auth: 'staffSession' };
    }
    if (/^\/_next\/data\/[A-Za-z0-9_-]+\/meeting-tracker\/transcription-rehearsal\.json$/.test(pathname)
        && verb === 'GET' && noQuery(params)) {
      return { allowed: true, auth: 'staffSession' };
    }
    const base = '/api/meeting-transcription-rehearsal';
    if (pathname === base && verb === 'GET' && noQuery(params)) {
      return { allowed: true, auth: 'routeAuth' };
    }
    if (pathname === `${base}/${REHEARSAL_JOB_ID}` && verb === 'GET' && noQuery(params)) {
      return { allowed: true, auth: 'routeAuth' };
    }
    if (pathname === `${base}/${REHEARSAL_JOB_ID}/speakers` && verb === 'PATCH' && noQuery(params)) {
      return { allowed: true, auth: 'routeAuth' };
    }
    if (pathname === `${base}/${REHEARSAL_JOB_ID}/download` && verb === 'GET'
        && [...params.entries()].length === 1 && ['txt', 'vtt'].includes(params.get('format') || '')
        && params.has('format')) {
      return { allowed: true, auth: 'routeAuth' };
    }
  }
  return { allowed: false, auth: 'deny' };
}

export function decideMeetingTranscriptionTestRequest({
  env = process.env,
  pathname = '/',
  method = 'GET',
  searchParams = '',
  origin = null,
} = {}) {
  const supervised = getMeetingTranscriptionSupervisedTestPolicy(env, origin);
  if (supervised.requested && !supervised.enabled) {
    return { dedicated: true, identityVerified: false, enabled: false, allowed: false, auth: 'deny' };
  }
  const profile = getMeetingTranscriptionTestDeploymentProfile(env);
  if (!profile.dedicated) {
    return { dedicated: false, identityVerified: false, enabled: false, allowed: true, auth: 'legacy' };
  }
  const route = decideMeetingTranscriptionTestRoute({ pathname, method, searchParams, env, origin });
  const enabled = profile.enabled && (!supervised.requested || supervised.enabled);
  return {
    dedicated: true,
    identityVerified: profile.identityVerified,
    enabled,
    allowed: enabled && route.allowed,
    auth: enabled ? route.auth : 'deny',
    redirectTo: enabled
      ? (pathname === '/' && isMeetingTranscriptionRehearsalReady(env)
        ? '/meeting-tracker/transcription-rehearsal' : route.redirectTo)
      : undefined,
  };
}

export function isMeetingTranscriptionTestStaffIdentity({ account, profile, user } = {}) {
  if (account?.provider !== 'azure-ad') return null;
  const azureId = profile?.oid || user?.id;
  return typeof azureId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(azureId)
    ? azureId
    : null;
}
