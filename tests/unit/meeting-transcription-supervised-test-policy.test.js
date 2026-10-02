const {
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED_ENV,
  MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV,
  MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID,
  MEETING_TRANSCRIPTION_SUPERVISED_TEST_SITE_VISIT_ID,
  MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  MEETING_TRANSCRIPTION_TEST_PROFILE_ENV,
  MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
  MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
  assertMeetingTranscriptionSupervisedTestBinding,
  decideMeetingTranscriptionTestRequest,
  getMeetingTranscriptionSupervisedTestPolicy,
} = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');

const REQUEST_ID = MEETING_TRANSCRIPTION_SUPERVISED_TEST_REQUEST_ID;
const VISIT_ID = MEETING_TRANSCRIPTION_SUPERVISED_TEST_SITE_VISIT_ID;
const ACCESS = `test:${REQUEST_ID}`;

function readyEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: MEETING_TRANSCRIPTION_TEST_PROJECT_ID,
    [MEETING_TRANSCRIPTION_TEST_PROFILE_ENV]: MEETING_TRANSCRIPTION_TEST_PROFILE_VALUE,
    [MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV]: 'on',
    DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com',
    MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on',
    MEETING_TRACKER_TRANSCRIPTION_ACCESS: ACCESS,
    POST_PRESENTATION_MATERIALS_SCHEMA_READY: 'on',
    POST_PRESENTATION_MATERIALS_ACCESS: ACCESS,
    AUTH_REQUIRED: 'true',
    EMERGENCY_AUTH_BYPASS: 'false',
    AZURE_AD_CLIENT_ID: 'configured',
    AZURE_AD_CLIENT_SECRET: 'configured',
    AZURE_AD_TENANT_ID: 'configured',
    NEXTAUTH_SECRET: 'unit-test-secret-that-is-long-enough',
    NEXTAUTH_URL: MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
    TRANSCRIPTION_PILOT_ENABLED: 'false',
    TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
    ...overrides,
  };
}

function decide(path, method = 'GET', query = '', overrides = {}) {
  return decideMeetingTranscriptionTestRequest({
    env: readyEnv(overrides),
    pathname: path,
    method,
    searchParams: query,
    origin: MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN,
  });
}

test('supervised mode needs exact dedicated Preview, sandbox, request, schema, and auth configuration', () => {
  expect(getMeetingTranscriptionSupervisedTestPolicy(readyEnv(), MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN))
    .toMatchObject({ requested: true, enabled: true, requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID });

  for (const override of [
    { VERCEL_PROJECT_ID: 'other-project' },
    { VERCEL_ENV: 'production' },
    { DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' },
    { MEETING_TRACKER_TRANSCRIPTION_ACCESS: 'on' },
    { POST_PRESENTATION_MATERIALS_ACCESS: 'on' },
    { MEETING_TRANSCRIPTION_REHEARSAL_ENABLED: 'on' },
    { TRANSCRIPTION_PILOT_ENABLED: 'true' },
    { TRANSCRIPTION_CALLBACK_URL: 'https://wrong-preview.vercel.app' },
  ]) {
    expect(getMeetingTranscriptionSupervisedTestPolicy(readyEnv(override), MEETING_TRANSCRIPTION_TEST_AUTH_ORIGIN).enabled)
      .toBe(false);
  }
  expect(getMeetingTranscriptionSupervisedTestPolicy(readyEnv(), 'https://branch-preview.example').enabled).toBe(false);
  expect(getMeetingTranscriptionSupervisedTestPolicy(readyEnv({ [MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV]: 'yes' })).enabled)
    .toBe(false);
});

test('absent or off supervised flag preserves the legacy policy, while active mode pins both server identities', () => {
  const env = readyEnv();
  delete env[MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV];
  expect(getMeetingTranscriptionSupervisedTestPolicy(env).requested).toBe(false);
  env[MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED_ENV] = 'off';
  expect(getMeetingTranscriptionSupervisedTestPolicy(env).requested).toBe(false);

  expect(assertMeetingTranscriptionSupervisedTestBinding(REQUEST_ID, VISIT_ID, readyEnv())).toBe(true);
  expect(() => assertMeetingTranscriptionSupervisedTestBinding('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', VISIT_ID, readyEnv()))
    .toThrow(expect.objectContaining({ code: 'meeting_transcription_supervised_test_binding_mismatch' }));
  expect(() => assertMeetingTranscriptionSupervisedTestBinding(REQUEST_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', readyEnv()))
    .toThrow(expect.objectContaining({ code: 'meeting_transcription_supervised_test_binding_mismatch' }));
  expect(() => assertMeetingTranscriptionSupervisedTestBinding(REQUEST_ID, VISIT_ID, readyEnv({ DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' })))
    .toThrow(expect.objectContaining({ code: 'meeting_transcription_supervised_test_misconfigured' }));
});

test('supervised route allowlist is request-bound, method-specific, and rejects unrelated write paths', () => {
  expect(decide('/', 'GET').redirectTo).toBe(`/meeting-tracker/visits/${REQUEST_ID}?n=1000334`);
  expect(decide('/meeting-tracker/visits/' + REQUEST_ID, 'GET', 'n=1000334').allowed).toBe(true);
  expect(decide(`/_next/data/build123/meeting-tracker/visits/${REQUEST_ID}.json`, 'GET', 'n=1000334').allowed).toBe(true);
  expect(decide('/workbench/' + REQUEST_ID, 'GET', 'tab=staff-deliberations&n=1000334').allowed).toBe(true);
  expect(decide(`/_next/data/build123/workbench/${REQUEST_ID}.json`, 'GET', 'tab=staff-deliberations&n=1000334').allowed).toBe(true);
  expect(decide('/api/auth/session', 'GET').allowed).toBe(true);
  expect(decide('/api/auth/callback/azure-ad', 'GET', 'state=abc').allowed).toBe(true);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions`, 'POST').allowed).toBe(true);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/start`, 'POST').allowed).toBe(true);
  const publishedDocumentId = '599509e5-b9be-f111-aaad-70a8a5b1c1c6';
  const publishedDownload = `/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions/materials/${publishedDocumentId}/download`;
  expect(decide(publishedDownload, 'GET', 'format=txt').allowed).toBe(true);
  expect(decide(publishedDownload.replace(publishedDocumentId, '599509e5-b9be-x111-aaad-70a8a5b1c1c6'), 'GET', 'format=txt').allowed).toBe(false);
  const jobPath = `/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  expect(decide(jobPath, 'DELETE').allowed).toBe(true);
  expect(decide(jobPath, 'DELETE', 'cleanup=1').allowed).toBe(false);
  expect(decide(jobPath.replace(REQUEST_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'DELETE').allowed).toBe(false);
  expect(decide(jobPath.replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-faaa-baaa-aaaaaaaaaaaa'), 'DELETE').allowed).toBe(false);
  expect(decide(`/api/workbench/site-visit/logistics`, 'GET', `requestId=${REQUEST_ID}`).allowed).toBe(true);
  for (const path of ['/api/user-profiles', '/api/app-access']) {
    expect(decide(path, 'GET').allowed).toBe(true);
    expect(decide(path, 'POST').allowed).toBe(false);
    expect(decide(path, 'GET', `requestId=${REQUEST_ID}`).allowed).toBe(false);
  }
  expect(decide('/api/user-preferences', 'GET', 'profileId=1').allowed).toBe(true);
  expect(decide('/api/user-preferences', 'GET').allowed).toBe(false);
  expect(decide('/api/user-preferences', 'GET', 'profileId=2').allowed).toBe(false);
  expect(decide('/api/user-preferences', 'POST', 'profileId=1').allowed).toBe(false);
  expect(decide('/.well-known/workflow/v1/flow', 'POST').allowed).toBe(true);
  expect(decide('/api/webhooks/assemblyai', 'POST', 'attempt=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').allowed).toBe(true);

  expect(decide('/meeting-tracker/visits/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GET', 'n=1000334').allowed).toBe(false);
  expect(decide(`/api/workbench/site-visit/logistics`, 'GET', `requestId=${REQUEST_ID}&requestId=${REQUEST_ID}`).allowed).toBe(false);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/presentation-uploads`, 'POST').allowed).toBe(false);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions`, 'DELETE').allowed).toBe(false);
  expect(decide('/api/admin/transcription-pilot/jobs', 'GET').allowed).toBe(false);
  expect(decide('/.well-known/workflow/v1/step', 'POST').allowed).toBe(false);
  expect(decide('/api/webhooks/assemblyai', 'POST', 'attempt=bad&x=1').allowed).toBe(false);
  expect(decide('/api/meeting-tracker/visits/' + REQUEST_ID, 'PATCH', '').allowed).toBe(false);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/download`, 'GET', 'format=pdf').allowed).toBe(false);
  expect(decide(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/download`, 'GET', 'format=txt&x=1').allowed).toBe(false);
  expect(decide('/api/auth/session', 'GET', '', { VERCEL_PROJECT_ID: 'wrong' }).allowed).toBe(false);
});
