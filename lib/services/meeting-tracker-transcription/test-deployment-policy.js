/** Isolated, sign-in-only policy for the Meeting Tracker test Preview project. */

import rehearsalFixture from './rehearsal-fixture.js';

export const MEETING_TRANSCRIPTION_TEST_PROFILE_ENV = 'MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE';
export const MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE = 'meeting-transcription-test';
export const MEETING_TRANSCRIPTION_TEST_PROJECT_ID = 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB';
export const MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN = 'https://wmkf-meeting-transcription-test.vercel.app';
export const MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV = 'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED';
export const MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_VALUE = 'on';
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

export function decideMeetingTranscriptionTestRoute({ pathname, method = 'GET', searchParams = '', env = process.env } = {}) {
  const params = paramsOf(searchParams);
  const verb = String(method).toUpperCase();

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
} = {}) {
  const profile = getMeetingTranscriptionTestDeploymentProfile(env);
  if (!profile.dedicated) {
    return { dedicated: false, identityVerified: false, enabled: false, allowed: true, auth: 'legacy' };
  }
  const route = decideMeetingTranscriptionTestRoute({ pathname, method, searchParams, env });
  const enabled = profile.enabled;
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
