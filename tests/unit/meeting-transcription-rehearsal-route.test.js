/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/auth', () => ({ requireAuth: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/rehearsal-resources', () => ({
  validateMeetingTranscriptionRehearsalResources: jest.fn(() => ({ ready: true })),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/rehearsal-service', () => ({
  getMeetingTranscriptionRehearsalCollection: jest.fn(async () => ({ jobs: [] })),
  getMeetingTranscriptionRehearsalJob: jest.fn(),
  saveMeetingTranscriptionRehearsalSpeakers: jest.fn(),
  downloadMeetingTranscriptionRehearsal: jest.fn(async () => ({
    bytes: Buffer.from('synthetic'), filename: 'synthetic-meeting-transcript.txt',
    contentType: 'text/plain; charset=utf-8',
  })),
}));

const { sql } = require('@vercel/postgres');
const { requireAuth } = require('../../lib/utils/auth');
const resources = require('../../lib/services/meeting-tracker-transcription/rehearsal-resources');
const rehearsalService = require('../../lib/services/meeting-tracker-transcription/rehearsal-service');
const fixture = require('../../lib/services/meeting-tracker-transcription/rehearsal-fixture');
const { MEETING_TRANSCRIPTION_TEST_PROFILE_ENV, MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
  MEETING_TRANSCRIPTION_TEST_PROJECT_ID, MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV } = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');
const handler = require('../../pages/api/meeting-transcription-rehearsal/[[...path]]').default;

function response() {
  return { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }, setHeader() {} };
}
function request(path, method = 'GET', extra = {}) {
  return { method, query: { path }, headers: {}, ...extra };
}

beforeEach(() => {
  process.env[MEETING_TRANSCRIPTION_TEST_PROFILE_ENV] = MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE;
  process.env.VERCEL_PROJECT_ID = MEETING_TRANSCRIPTION_TEST_PROJECT_ID;
  process.env.VERCEL_ENV = 'preview'; process.env.NODE_ENV = 'production';
  process.env.AUTH_REQUIRED = 'true'; process.env.EMERGENCY_AUTH_BYPASS = 'false';
  process.env.AZURE_AD_CLIENT_ID = 'x'; process.env.AZURE_AD_CLIENT_SECRET = 'x'; process.env.AZURE_AD_TENANT_ID = 'x';
  process.env.NEXTAUTH_SECRET = 'unit-test-secret-long-enough-123456';
  process.env.NEXTAUTH_URL = MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN;
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = `test:${fixture.REHEARSAL_REQUEST_ID}`;
  process.env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV] = 'on';
  requireAuth.mockResolvedValue({ user: { azureId: '893369cc-1925-40ec-bbc6-6f12b0684a31', profileId: 1 } });
  sql.mockResolvedValue({ rows: [{ id: 1, azure_id: '893369cc-1925-40ec-bbc6-6f12b0684a31', is_active: true, needs_linking: false }] });
  jest.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { azureId: '893369cc-1925-40ec-bbc6-6f12b0684a31', profileId: 1 } });
  sql.mockResolvedValue({ rows: [{ id: 1, azure_id: '893369cc-1925-40ec-bbc6-6f12b0684a31', is_active: true, needs_linking: false }] });
});

test('the actual panel download route is accepted; similarly shaped extra routes are denied before auth', async () => {
  const allowed = response();
  await handler(request([fixture.REHEARSAL_JOB_ID, 'download'], 'GET', { query: { path: [fixture.REHEARSAL_JOB_ID, 'download'], format: 'txt' } }), allowed);
  expect(allowed.statusCode).toBe(200);
  expect(requireAuth).toHaveBeenCalledTimes(1);

  requireAuth.mockClear();
  const denied = response();
  await handler(request([fixture.REHEARSAL_JOB_ID, 'download', 'extra'], 'GET', {
    query: { path: [fixture.REHEARSAL_JOB_ID, 'download', 'extra'], format: 'txt' },
  }), denied);
  expect(denied.statusCode).toBe(404);
  expect(requireAuth).not.toHaveBeenCalled();

  const duplicated = response();
  await handler(request([fixture.REHEARSAL_JOB_ID, 'download'], 'GET', {
    query: { path: [fixture.REHEARSAL_JOB_ID, 'download'], format: ['txt', 'vtt'] },
  }), duplicated);
  expect(duplicated.statusCode).toBe(404);
  expect(requireAuth).not.toHaveBeenCalled();
});

test('deployment and resource mismatches fail before authentication or data access', async () => {
  process.env.VERCEL_PROJECT_ID = 'wrong-project';
  const wrongProject = response();
  await handler(request([]), wrongProject);
  expect(wrongProject.statusCode).toBe(404);
  expect(requireAuth).not.toHaveBeenCalled();

  process.env.VERCEL_PROJECT_ID = MEETING_TRANSCRIPTION_TEST_PROJECT_ID;
  resources.validateMeetingTranscriptionRehearsalResources.mockReturnValueOnce({ ready: false });
  const wrongResource = response();
  await handler(request([]), wrongResource);
  expect(wrongResource.statusCode).toBe(503);
  expect(requireAuth).not.toHaveBeenCalled();
  expect(sql).not.toHaveBeenCalled();
});

test('session and fresh database identity must both match, and stale speaker version stays a conflict', async () => {
  requireAuth.mockResolvedValueOnce({ user: { azureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', profileId: 1 } });
  const wrongSession = response();
  await handler(request([]), wrongSession);
  expect(wrongSession.statusCode).toBe(403);
  expect(sql).not.toHaveBeenCalled();

  sql.mockResolvedValueOnce({ rows: [{ id: 1, azure_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_active: true, needs_linking: false }] });
  const wrongDatabaseIdentity = response();
  await handler(request([]), wrongDatabaseIdentity);
  expect(wrongDatabaseIdentity.statusCode).toBe(403);
  expect(rehearsalService.getMeetingTranscriptionRehearsalCollection).not.toHaveBeenCalled();

  rehearsalService.saveMeetingTranscriptionRehearsalSpeakers.mockRejectedValueOnce(
    Object.assign(new Error('job_changed'), { code: 'job_changed', status: 409 }),
  );
  const stale = response();
  await handler(request([fixture.REHEARSAL_JOB_ID, 'speakers'], 'PATCH', {
    query: { path: [fixture.REHEARSAL_JOB_ID, 'speakers'] },
    body: { expectedVersion: 1, speakerNames: { A: 'Dr. Ada Example' } },
  }), stale);
  expect(stale.statusCode).toBe(409);
});
