import {
  decideTranscriptionPilotRequest as decide,
  decideTranscriptionPilotRoute as route,
  getTranscriptionPilotDeploymentProfile as profile,
  isDedicatedTranscriptionAuthConfigured as authConfigured,
  isLegacyProxyPassThrough,
} from '../../lib/services/transcription-pilot/deployment-policy';

const registry = [{ projectId: 'prj_test_only', authOrigin: 'https://pilot.example.test' }];
const env = { VERCEL_PROJECT_ID: 'prj_test_only', TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: 'transcription-pilot' };

test('source registry rejects even plausible identities until explicitly registered', () => {
  expect(decide({ env, pathname: '/auth/signin' }).allowed).toBe(false);
  expect(profile({ VERCEL_ENV: 'production' }).dedicated).toBe(false);
  expect(profile({ VERCEL_PROJECT_ID: 'prj_test_only' }, registry).dedicated).toBe(true);
  for (const marker of ['', 'wrong', undefined]) {
    expect(decide({ env: { ...env, TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: marker }, registry, pathname: '/auth/signin' }).allowed).toBe(false);
  }
  expect(decide({ env, registry, pathname: '/auth/signin' }).allowed).toBe(true);
});

test.each([
  ['/api/cron/drain-transcriptions', 'GET', 'recovery=1'],
  ['/api/cron/drain-transcriptions', 'GET', 'preflight=1'],
  ['/api/cron/drain-transcriptions', 'POST', 'workflow_probe=1'],
  ['/api/auth/callback/azure-ad', 'GET', 'code=fixture&state=fixture&session_state=fixture'],
  ['/api/user-preferences', 'GET', 'profileId=1'],
  ['/api/admin/alerts', 'GET', 'summary=true'],
  ['/api/admin/transcription-pilot/jobs', 'GET', 'limit=50'],
  ['/api/admin/transcription-pilot/jobs/a/download', 'GET', 'format=vtt'],
  ['/api/webhooks/assemblyai', 'POST', 'attempt=00000000-0000-4000-8000-000000000001'],
  ['/.well-known/workflow/v1/flow', 'POST', ''],
  ['/_next/static/chunks/page.js', 'GET', ''],
  ['/_next/data/build/admin/transcription-pilot.json', 'GET', ''],
])('allows required caller contract %s %s', (pathname, method, searchParams) => {
  expect(route({ pathname, method, searchParams }).allowed).toBe(true);
});

test.each([
  ['/api/cron/unrelated', 'GET', ''], ['/api/irs/verify-ein', 'GET', ''],
  ['/api/auth/callback/azure-ad', 'GET', 'state=a&state=b&code=c'],
  ['/api/auth/callback/external', 'POST', ''], ['/api/auth/providers-extra', 'GET', ''],
  ['/api/admin/alerts', 'GET', 'summary=true&repairContext=1'],
  ['/api/app-access', 'GET', 'all=true'], ['/api/app-access', 'POST', ''],
  ['/api/user-preferences', 'POST', ''], ['/api/user-profiles', 'DELETE', ''],
  ['/api/cron/drain-transcriptions', 'GET', 'recovery=1&preflight=1'],
  ['/_next/image', 'GET', 'url=/api/irs/verify-ein'],
  ['/_next/data/build/admin.json', 'GET', ''], ['/admin', 'GET', ''],
  ['/api/admin/transcription-pilot/jobs/abc/unknown', 'GET', ''],
])('rejects unrelated/sibling/ambiguous contract %s %s', (pathname, method, searchParams) => {
  expect(route({ pathname, method, searchParams }).allowed).toBe(false);
});

test('dedicated auth refuses emergency bypass and missing credentials', () => {
  const safe = { NODE_ENV: 'production', AUTH_REQUIRED: 'true', NEXTAUTH_SECRET: 'x'.repeat(32), AZURE_AD_CLIENT_ID: 'test', AZURE_AD_CLIENT_SECRET: 'test', AZURE_AD_TENANT_ID: 'test' };
  expect(authConfigured(safe)).toBe(true);
  expect(authConfigured({ ...safe, EMERGENCY_AUTH_BYPASS: 'true' })).toBe(false);
  expect(authConfigured({ ...safe, AUTH_REQUIRED: 'false' })).toBe(false);
  expect(authConfigured({ ...safe, NEXTAUTH_SECRET: '' })).toBe(false);
});

test('legacy exceptions remain pass-through without exempting dedicated siblings', () => {
  for (const pathname of ['/api/cron/other', '/api/auth/providers', '/api/irs/verify-ein', '/.well-known/workflow/v1/flow', '/_next/image', '/_next/static/chunk.js', '/favicon.ico']) {
    expect(isLegacyProxyPassThrough(pathname)).toBe(true);
  }
  expect(isLegacyProxyPassThrough('/api/webhooks/billing')).toBe(false);
});
