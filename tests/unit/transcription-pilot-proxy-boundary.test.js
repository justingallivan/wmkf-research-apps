/** @jest-environment node */
jest.mock('next-auth/middleware', () => ({ withAuth: jest.fn(() => jest.fn(() => ({ shared: true }))) }));
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: {
  next: jest.fn(() => ({ passed: true })),
  redirect: jest.fn((url) => ({ redirected: url.toString() })),
} }));
jest.mock('../../lib/services/transcription-pilot/deployment-policy', () => {
  const actual = jest.requireActual('../../lib/services/transcription-pilot/deployment-policy');
  return { ...actual, decideTranscriptionPilotRequest: jest.fn(actual.decideTranscriptionPilotRequest) };
});
import proxy from '../../proxy';
import { withAuth } from 'next-auth/middleware';
import { getToken } from 'next-auth/jwt';
import { decideTranscriptionPilotRequest as decide } from '../../lib/services/transcription-pilot/deployment-policy';

const originalEnv = process.env;
const shared = withAuth.mock.results[0].value;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv, TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: 'transcription-pilot', VERCEL_ENV: 'production', NODE_ENV: 'production', AUTH_REQUIRED: 'true', NEXTAUTH_SECRET: 'test-only-secret-'.repeat(3), AZURE_AD_CLIENT_ID: 'test', AZURE_AD_CLIENT_SECRET: 'test', AZURE_AD_TENANT_ID: 'test' };
  decide.mockImplementation(jest.requireActual('../../lib/services/transcription-pilot/deployment-policy').decideTranscriptionPilotRequest);
});
afterEach(() => { process.env = originalEnv; });
const request = (pathname) => ({ method: 'GET', nextUrl: new URL(pathname, 'https://pilot.example.test'), headers: new Headers() });

test.each(['/auth/signin', '/api/auth/providers', '/api/cron/drain-transcriptions', '/.well-known/workflow/v1/flow', '/_next/static/chunk.js', '/_next/image', '/admin'])('unknown identity rejects %s before NextAuth can exempt it', async (pathname) => {
  expect((await proxy(request(pathname))).status).toBe(404);
  expect(shared).not.toHaveBeenCalled();
  expect(getToken).not.toHaveBeenCalled();
});

test('recognized policy staff data still requires a valid staff token before NextAuth next-data exemption', async () => {
  decide.mockReturnValue({ dedicated: true, identityVerified: true, allowed: true, auth: 'staffSession' });
  getToken.mockResolvedValue({ userType: 'applicant', lastActivity: Date.now(), contactOid: 'test' });
  expect((await proxy(request('/_next/data/build/admin/transcription-pilot.json'))).redirected).toContain('/auth/signin');
  expect(shared).not.toHaveBeenCalled();
  getToken.mockResolvedValue({ azureId: 'test', lastActivity: Date.now() });
  expect(await proxy(request('/admin/transcription-pilot'))).toEqual({ shared: true });
});

test('recognized identity cannot use emergency auth bypass', async () => {
  decide.mockReturnValue({ dedicated: true, identityVerified: true, allowed: true, auth: 'routeAuth' });
  process.env.EMERGENCY_AUTH_BYPASS = 'true';
  expect((await proxy(request('/api/auth/providers'))).status).toBe(404);
});

test('unmarked shared cron preserves pass-through without NextAuth secrets', async () => {
  delete process.env.TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE;
  delete process.env.NEXTAUTH_SECRET;
  expect(await proxy(request('/api/cron/other'))).toEqual({ passed: true });
  expect(shared).not.toHaveBeenCalled();
});
