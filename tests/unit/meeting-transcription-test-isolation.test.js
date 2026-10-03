/** @jest-environment node */
jest.mock('next-auth/middleware', () => ({ withAuth: jest.fn(() => jest.fn(() => ({ shared: true }))) }));
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: {
  next: jest.fn(() => ({ passed: true })),
  redirect: jest.fn((url) => ({ redirected: url.toString() })),
} }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/app-access-service', () => ({ grantApps: jest.fn() }));
jest.mock('../../lib/services/notification-service', () => ({ notifyNewUser: jest.fn() }));
jest.mock('../../lib/services/dynamics-identity-service', () => ({ reconcileProfile: jest.fn() }));
jest.mock('next-auth', () => jest.fn(() => ({})));
jest.mock('next-auth/providers/azure-ad', () => jest.fn(() => ({})));

const { getToken } = require('next-auth/jwt');
const { sql } = require('@vercel/postgres');
const { grantApps } = require('../../lib/services/app-access-service');
const { notifyNewUser } = require('../../lib/services/notification-service');
const { reconcileProfile } = require('../../lib/services/dynamics-identity-service');
const proxy = require('../../proxy').default;
const { authOptions } = require('../../pages/api/auth/[...nextauth].js');
const {
  MEETING_TRANSCRIPTION_TEST_PROFILE_ENV,
  MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
  MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
  MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  decideMeetingTranscriptionTestRequest,
} = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');

const originalEnv = process.env;
const azureId = 'a652a292-2572-434c-ae6f-aa01f61d82ad';
function testEnv() {
  return {
    ...originalEnv,
    [MEETING_TRANSCRIPTION_TEST_PROFILE_ENV]: MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
    VERCEL_PROJECT_ID: MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
    VERCEL_ENV: 'preview', NODE_ENV: 'production', AUTH_REQUIRED: 'true',
    EMERGENCY_AUTH_BYPASS: 'false', NEXTAUTH_SECRET: 'unit-test-secret-that-is-long-enough',
    NEXTAUTH_URL: MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
    AZURE_AD_CLIENT_ID: 'configured', AZURE_AD_CLIENT_SECRET: 'configured', AZURE_AD_TENANT_ID: 'configured',
  };
}
function request(path, method = 'GET') {
  return { method, nextUrl: new URL(path, MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN), headers: new Headers() };
}

beforeEach(() => { jest.clearAllMocks(); process.env = testEnv(); });
afterAll(() => { process.env = originalEnv; });

describe('Meeting Tracker test deployment boundary', () => {
  test('registered project remains isolated even without its marker', () => {
    delete process.env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV];
    expect(decideMeetingTranscriptionTestRequest({ pathname: '/api/cron/x' })).toMatchObject({ dedicated: true, allowed: false });
  });

  test('marker on an unknown project, malformed marker, and wrong environment fail closed', () => {
    process.env.VERCEL_PROJECT_ID = 'unknown';
    expect(decideMeetingTranscriptionTestRequest({ pathname: '/auth/signin' })).toMatchObject({ dedicated: true, identityVerified: false, allowed: false });
    process.env.VERCEL_PROJECT_ID = MEETING_TRANSCRIPTION_TEST_PROJECT_ID;
    process.env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV] = 'transcription-pilot';
    expect(decideMeetingTranscriptionTestRequest({ pathname: '/auth/signin' }).enabled).toBe(false);
    process.env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV] = MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE;
    process.env.VERCEL_ENV = 'production';
    expect(decideMeetingTranscriptionTestRequest({ pathname: '/auth/signin' }).enabled).toBe(false);
  });

  test.each([
    ['/api/auth/status', 'GET', true], ['/api/auth/session', 'GET', true],
    ['/api/auth/session', 'POST', false], ['/api/auth/signout', 'POST', true],
    ['/api/cron/drain-transcriptions', 'GET', false], ['/api/meeting-tracker', 'GET', false],
    ['/.well-known/workflow/v1/flow', 'POST', false], ['/api/auth/status?x=1', 'GET', false],
    ['/auth/signin?callbackUrl=https%3A%2F%2Fwmkf-meeting-transcription-test.vercel.app%2F&error=OAuthSignin', 'GET', true],
    ['/auth/signin?callbackUrl=https%3A%2F%2Fevil.example%2F', 'GET', false],
  ])('policy handles %s %s as expected', (path, method, allowed) => {
    const url = new URL(path, MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN);
    expect(decideMeetingTranscriptionTestRequest({ pathname: url.pathname, method, searchParams: url.searchParams }).allowed).toBe(allowed);
  });

  test('proxy rejects denied routes and redirects the authenticated root to session', async () => {
    expect((await proxy(request('/api/cron/foo'))).status).toBe(404);
    getToken.mockResolvedValue({ azureId, userType: 'staff', lastActivity: Date.now() });
    expect((await proxy(request('/'))).redirected).toContain('/api/auth/session');
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  test('test sign-in accepts only one active existing staff identity without provisioning effects', async () => {
    const account = { provider: 'azure-ad' };
    const identity = { user: { id: azureId, email: 'staff@example.org' }, account, profile: { oid: azureId } };
    sql.mockResolvedValueOnce({ rows: [{ id: 'profile-1', is_active: true }] }).mockResolvedValueOnce({ rows: [{ id: 'profile-1' }] });
    expect(await authOptions.callbacks.signIn(identity)).toBe(true);
    sql.mockResolvedValueOnce({ rows: [] });
    expect(await authOptions.callbacks.signIn({ ...identity, profile: { oid: 'b652a292-2572-434c-ae6f-aa01f61d82ad' } })).toBe(false);
    sql.mockResolvedValueOnce({ rows: [{ id: 'profile-2', is_active: false }] });
    expect(await authOptions.callbacks.signIn({ ...identity, profile: { oid: 'c652a292-2572-434c-ae6f-aa01f61d82ad' } })).toBe(false);
    sql.mockResolvedValueOnce({ rows: [{ id: 'profile-3', is_active: true }] }).mockResolvedValueOnce({ rows: [] });
    expect(await authOptions.callbacks.signIn({ ...identity, profile: { oid: 'd652a292-2572-434c-ae6f-aa01f61d82ad' } })).toBe(false);
    expect(await authOptions.callbacks.signIn({ ...identity, account: { provider: 'entra-external' } })).toBe(false);
    expect(grantApps).not.toHaveBeenCalled();
    expect(notifyNewUser).not.toHaveBeenCalled();
    expect(reconcileProfile).not.toHaveBeenCalled();
  });
});
