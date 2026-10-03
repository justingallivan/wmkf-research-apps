/** @jest-environment node */
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
// Keep unrelated CRM/DAL integrations out of this auth-boundary test while
// exercising the real requireAuth implementation and its Origin validator.
jest.mock('../../lib/services/app-access-service', () => ({ listAppKeysForUser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/rehearsal-resources', () => ({
  validateMeetingTranscriptionRehearsalResources: jest.fn(() => ({ ready: true })),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/rehearsal-service', () => ({
  getMeetingTranscriptionRehearsalCollection: jest.fn(),
  getMeetingTranscriptionRehearsalJob: jest.fn(),
  saveMeetingTranscriptionRehearsalSpeakers: jest.fn(async () => ({ saved: true, version: 2 })),
  downloadMeetingTranscriptionRehearsal: jest.fn(),
}));

const { getServerSession } = require('next-auth/next');
const { sql } = require('@vercel/postgres');
const { listAppKeysForUser } = require('../../lib/services/app-access-service');
const { withDalContext } = require('../../lib/dataverse/core/context');
const rehearsalService = require('../../lib/services/meeting-tracker-transcription/rehearsal-service');
const fixture = require('../../lib/services/meeting-tracker-transcription/rehearsal-fixture');
const {
  MEETING_TRANSCRIPTION_TEST_PROFILE_ENV,
  MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
  MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
  MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV,
} = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');
const handler = require('../../pages/api/meeting-transcription-rehearsal/[[...path]]').default;

const EXPECTED_AZURE_OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    setHeader() {},
  };
}

function patchRequest(headers = {}) {
  return {
    method: 'PATCH',
    query: { path: [fixture.REHEARSAL_JOB_ID, 'speakers'] },
    headers,
    body: { expectedVersion: 1, speakerNames: { A: 'Synthetic PI' } },
  };
}

beforeEach(() => {
  process.env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV] = MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE;
  process.env.VERCEL_PROJECT_ID = MEETING_TRANSCRIPTION_TEST_PROJECT_ID;
  process.env.VERCEL_ENV = 'preview';
  process.env.NODE_ENV = 'production';
  process.env.AUTH_REQUIRED = 'true';
  process.env.EMERGENCY_AUTH_BYPASS = 'false';
  process.env.AZURE_AD_CLIENT_ID = 'test-client';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant';
  process.env.NEXTAUTH_SECRET = 'unit-test-secret-long-enough-123456';
  process.env.NEXTAUTH_URL = MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN;
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = `test:${fixture.REHEARSAL_REQUEST_ID}`;
  process.env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV] = 'on';

  getServerSession.mockResolvedValue({ user: {
    azureId: EXPECTED_AZURE_OID,
    profileId: fixture.REHEARSAL_OWNER_PROFILE_ID,
  } });
  sql.mockResolvedValue({ rows: [{
    id: fixture.REHEARSAL_OWNER_PROFILE_ID,
    azure_id: EXPECTED_AZURE_OID,
    is_active: true,
    needs_linking: false,
  }] });
  rehearsalService.saveMeetingTranscriptionRehearsalSpeakers.mockClear();
  getServerSession.mockClear();
  sql.mockClear();
  // Restore after clearing, as the accepted-origin test exercises both the
  // real auth profile check and the route's additional exact-profile pin.
  getServerSession.mockResolvedValue({ user: {
    azureId: EXPECTED_AZURE_OID,
    profileId: fixture.REHEARSAL_OWNER_PROFILE_ID,
  } });
  sql.mockResolvedValue({ rows: [{
    id: fixture.REHEARSAL_OWNER_PROFILE_ID,
    azure_id: EXPECTED_AZURE_OID,
    is_active: true,
    needs_linking: false,
  }] });
});

test('rejects a cross-origin speaker PATCH before session, database, or rehearsal runtime access', async () => {
  const res = response();
  await handler(patchRequest({
    origin: 'https://attacker.invalid',
    cookie: 'next-auth.session-token=present',
  }), res);

  expect(res.statusCode).toBe(403);
  expect(getServerSession).not.toHaveBeenCalled();
  expect(sql).not.toHaveBeenCalled();
  expect(listAppKeysForUser).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
  expect(rehearsalService.saveMeetingTranscriptionRehearsalSpeakers).not.toHaveBeenCalled();
});

test('rejects a cookie-bearing speaker PATCH with no Origin or Referer before runtime access', async () => {
  const res = response();
  await handler(patchRequest({ cookie: 'next-auth.session-token=present' }), res);

  expect(res.statusCode).toBe(403);
  expect(getServerSession).not.toHaveBeenCalled();
  expect(sql).not.toHaveBeenCalled();
  expect(listAppKeysForUser).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
  expect(rehearsalService.saveMeetingTranscriptionRehearsalSpeakers).not.toHaveBeenCalled();
});

test('accepts the configured origin through real requireAuth and saves only the pinned synthetic speakers', async () => {
  const res = response();
  await handler(patchRequest({
    origin: MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
    cookie: 'next-auth.session-token=present',
  }), res);

  expect(res.statusCode).toBe(200);
  expect(getServerSession).toHaveBeenCalledTimes(1);
  expect(sql).toHaveBeenCalledTimes(2);
  expect(rehearsalService.saveMeetingTranscriptionRehearsalSpeakers).toHaveBeenCalledWith({
    jobId: fixture.REHEARSAL_JOB_ID,
    actorProfileId: fixture.REHEARSAL_OWNER_PROFILE_ID,
    expectedVersion: 1,
    speakerNames: { A: 'Synthetic PI' },
  });
});
