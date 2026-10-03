/** @jest-environment node */
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  getMeetingTranscriptionJob: jest.fn(), getTranscriptionWorkflowDispatch: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/runtime', () => ({
  getMeetingTranscriptionJobContent: jest.fn(), projectMeetingTranscriptionJob: jest.fn((row) => ({ id: row.id })),
  saveMeetingTranscriptionSpeakerNames: jest.fn(),
}));

const fixture = require('../../lib/services/meeting-tracker-transcription/rehearsal-fixture');
const store = require('../../lib/services/transcription-pilot/store');
const runtime = require('../../lib/services/transcription-pilot/runtime');
const { validateMeetingTranscriptionRehearsalResources } = require('../../lib/services/meeting-tracker-transcription/rehearsal-resources');
const {
  MEETING_TRANSCRIPTION_TEST_PROFILE_ENV, MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
  MEETING_TRANSCRIPTION_TEST_PROJECT_ID, MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV, isMeetingTranscriptionRehearsalReady,
  decideMeetingTranscriptionTestRoute,
} = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');
const {
  assertMeetingTranscriptionRehearsalFixtureRow,
} = require('../../lib/services/meeting-tracker-transcription/rehearsal-service');

const originalEnv = process.env;
function readyEnv() {
  return {
    NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
    [MEETING_TRANSCRIPTION_TEST_PROFILE_ENV]: MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
    [MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV]: 'on',
    MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on',
    MEETING_TRACKER_TRANSCRIPTION_ACCESS: `test:${fixture.REHEARSAL_REQUEST_ID}`,
    AUTH_REQUIRED: 'true', EMERGENCY_AUTH_BYPASS: 'false',
    AZURE_AD_CLIENT_ID: 'configured', AZURE_AD_CLIENT_SECRET: 'configured', AZURE_AD_TENANT_ID: 'configured',
    NEXTAUTH_SECRET: 'fixture-only-secret-long-enough-000000', NEXTAUTH_URL: MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  };
}
function row(overrides = {}) {
  return {
    id: fixture.REHEARSAL_JOB_ID, owner_profile_id: 1,
    request_id: fixture.REHEARSAL_REQUEST_ID,
    site_visit_activity_id: fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID,
    status: 'ready', options_snapshot: { rehearsal_fixture: 'meeting-tracker-speaker-rehearsal-v1' },
    output_pathname: fixture.REHEARSAL_OUTPUT_PATH,
    output_cleanup_pathname: fixture.REHEARSAL_OUTPUT_PATH,
    output_sha256: require('../../scripts/meeting-transcription-rehearsal-fixture').transcriptHash,
    audio_pathname: null, input_cleanup_pathname: null, audio_sha256: null, audio_etag: null,
    verified_content_type: null, verified_bytes: null, provider_upload_ref_ciphertext: null,
    provider_transcript_id: null, callback_candidate_transcript_id: null, conflicting_transcript_id: null,
    attempt_correlation_id: null, submission_intent_at: null, lease_token: null, lease_expires_at: null,
    publication_operation_id: null, diagnostic_pathname: null, diagnostic_cleanup_pathname: null,
    diagnostic_sha256: null, cleanup_requested_at: null,
    content_purged_at: null, provider_id_conflict: false, attempts: 0,
    ...overrides,
  };
}

beforeEach(() => { process.env = readyEnv(); jest.clearAllMocks(); store.getTranscriptionWorkflowDispatch.mockResolvedValue(null); });
afterAll(() => { process.env = originalEnv; });

test('rehearsal readiness requires exact preview, schema, access, and explicit opt-in', () => {
  expect(isMeetingTranscriptionRehearsalReady()).toBe(true);
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  expect(isMeetingTranscriptionRehearsalReady()).toBe(false);
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = `test:${fixture.REHEARSAL_REQUEST_ID}`;
  delete process.env[MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV];
  expect(isMeetingTranscriptionRehearsalReady()).toBe(false);
});

test('resource pin validates the dedicated Neon host/project and private Blob token prefix', () => {
  const env = {
    NEON_PROJECT_ID: 'dawn-paper-09421078',
    POSTGRES_URL: 'postgres://fixture:fixture@ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require',
    DATABASE_URL: 'postgres://fixture:fixture@ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require',
    UPLOADS_BLOB_RW_TOKEN: 'vercel_blob_rw_G5ZrBn1kcxzaBkyI_fixture-only',
  };
  expect(validateMeetingTranscriptionRehearsalResources(env)).toMatchObject({ ready: true, databaseReady: true, blobReady: true });
  expect(validateMeetingTranscriptionRehearsalResources({ ...env, DATABASE_URL: 'postgres://x:y@other.example/neondb?sslmode=require' }).ready).toBe(false);
  expect(validateMeetingTranscriptionRehearsalResources({ ...env, UPLOADS_BLOB_RW_TOKEN: 'vercel_blob_rw_G5ZrBn1kcxzaBkyI_' }).ready).toBe(false);
});

test('API policy accepts the panel download URL only with txt or vtt format', () => {
  const base = `/api/meeting-transcription-rehearsal/${fixture.REHEARSAL_JOB_ID}/download`;
  expect(decideMeetingTranscriptionTestRoute({ pathname: base, searchParams: 'format=txt' }).allowed).toBe(true);
  expect(decideMeetingTranscriptionTestRoute({ pathname: base, searchParams: 'format=pdf' }).allowed).toBe(false);
  expect(decideMeetingTranscriptionTestRoute({ pathname: `${base}/extra`, searchParams: 'format=txt' }).allowed).toBe(false);
  expect(decideMeetingTranscriptionTestRoute({ pathname: `/api/meeting-transcription-rehearsal/${fixture.REHEARSAL_JOB_ID}`, searchParams: 'format=txt' }).allowed).toBe(false);
});

test('raw row guard accepts the fixed marked synthetic fixture and rejects drift before dispatch/content access', async () => {
  await expect(assertMeetingTranscriptionRehearsalFixtureRow(row())).resolves.toMatchObject({ id: fixture.REHEARSAL_JOB_ID });
  expect(store.getTranscriptionWorkflowDispatch).toHaveBeenCalledWith({ jobId: fixture.REHEARSAL_JOB_ID });
  store.getTranscriptionWorkflowDispatch.mockClear();
  await expect(assertMeetingTranscriptionRehearsalFixtureRow(row({ owner_profile_id: 2 })))
    .rejects.toMatchObject({ code: 'rehearsal_fixture_mismatch' });
  expect(store.getTranscriptionWorkflowDispatch).not.toHaveBeenCalled();
  await expect(assertMeetingTranscriptionRehearsalFixtureRow(row({ output_pathname: 'other/path' })))
    .rejects.toMatchObject({ code: 'rehearsal_fixture_mismatch' });
  await expect(assertMeetingTranscriptionRehearsalFixtureRow(row({ provider_transcript_id: 'provider-ref' })))
    .rejects.toMatchObject({ code: 'rehearsal_fixture_mismatch' });
  await expect(assertMeetingTranscriptionRehearsalFixtureRow(row({ options_snapshot: {} })))
    .rejects.toMatchObject({ code: 'rehearsal_fixture_mismatch' });
  store.getMeetingTranscriptionJob.mockResolvedValue(row({ output_pathname: 'foreign/path' }));
  await expect(require('../../lib/services/meeting-tracker-transcription/rehearsal-service')
    .getMeetingTranscriptionRehearsalJob(fixture.REHEARSAL_JOB_ID))
    .rejects.toMatchObject({ code: 'rehearsal_fixture_mismatch' });
  expect(runtime.getMeetingTranscriptionJobContent).not.toHaveBeenCalled();
});
