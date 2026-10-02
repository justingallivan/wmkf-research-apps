/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn(),
  createClient: jest.fn(),
}));

const { sql } = require('@vercel/postgres');
const { getAccessToken, createClient } = require('../../lib/dataverse/client');
const {
  resolveProfileToSystemUser,
  resolveSystemUserToProfile,
  clearCache,
} = require('../../lib/services/dataverse-identity-map');

const OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const POLICY_ENV = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB',
  MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: 'meeting-transcription-test',
  MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED: 'on',
  DYNAMICS_URL: ORIGIN,
  DYNAMICS_SANDBOX_URL: ORIGIN,
  MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on',
  MEETING_TRACKER_TRANSCRIPTION_ACCESS: 'test:4236c2b3-b053-f111-bec7-6045bd015cb0',
  POST_PRESENTATION_MATERIALS_SCHEMA_READY: 'on',
  POST_PRESENTATION_MATERIALS_ACCESS: 'test:4236c2b3-b053-f111-bec7-6045bd015cb0',
  AUTH_REQUIRED: 'true',
  EMERGENCY_AUTH_BYPASS: 'false',
  AZURE_AD_CLIENT_ID: 'configured',
  AZURE_AD_CLIENT_SECRET: 'configured',
  AZURE_AD_TENANT_ID: 'configured',
  NEXTAUTH_SECRET: 'unit-test-secret-that-is-long-enough',
  NEXTAUTH_URL: 'https://wmkf-meeting-transcription-test.vercel.app',
  TRANSCRIPTION_PILOT_ENABLED: 'false',
  TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
};
const originalEnv = process.env;
const validProfile = () => ({
  id: 1,
  azure_id: OID,
  is_active: true,
  needs_linking: false,
  dynamics_systemuser_id: ACTOR,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  process.env = { ...originalEnv, ...POLICY_ENV };
  sql.mockResolvedValue({ rows: [validProfile()] });
  getAccessToken.mockResolvedValue('sandbox-token');
  createClient.mockReturnValue({ get: jest.fn().mockResolvedValue({
    ok: true,
    body: {
      systemuserid: ACTOR,
      azureactivedirectoryobjectid: OID,
      isdisabled: false,
      fullname: 'Test Operator',
    },
  }) });
});

afterAll(() => {
  process.env = originalEnv;
});

test('mode-off app-grant opt-in preserves the legacy profile 1 skip and mapping call sequence', async () => {
  process.env.MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED = 'off';
  sql.mockResolvedValue({ rows: [validProfile(), { id: 7, azure_email: 'other@example.org', is_active: true }] });
  const client = { get: jest.fn().mockResolvedValue({ ok: true, body: { value: [{ systemuserid: ACTOR, fullname: 'Other' }] } }) };
  createClient.mockReturnValue(client);

  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();
  await expect(resolveProfileToSystemUser(7)).resolves.toMatchObject({ systemuserid: ACTOR });
  await expect(resolveSystemUserToProfile(ACTOR)).resolves.toBe(7);
  expect(client.get).toHaveBeenCalledTimes(1);
  expect(client.get.mock.calls.every(([url]) => url.includes('internalemailaddress'))).toBe(true);
  expect(getAccessToken).toHaveBeenCalledTimes(1);
  expect(sql).toHaveBeenCalledTimes(1);
});

test('explicit supervised read validates the existing profile and exact enabled sandbox actor, caches forward-only', async () => {
  const client = { get: jest.fn().mockResolvedValue({ ok: true, body: {
    systemuserid: ACTOR.toUpperCase(),
    azureactivedirectoryobjectid: OID.toUpperCase(),
    isdisabled: false,
    fullname: 'Test Operator',
  } }) };
  createClient.mockReturnValue(client);

  const resolved = await resolveProfileToSystemUser(1, { allowSupervisedTestRead: true });
  expect(resolved).toMatchObject({
    systemuserid: ACTOR,
    fullname: 'Test Operator',
    identitySource: 'supervised-test-profile-guid',
  });
  expect(getAccessToken).toHaveBeenCalledWith(ORIGIN);
  expect(sql).toHaveBeenCalledTimes(1);
  expect(client.get).toHaveBeenCalledWith(
    `/systemusers(${ACTOR})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled`,
  );

  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  await expect(resolveSystemUserToProfile(ACTOR)).resolves.toBeNull();
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBe(resolved);
  expect(sql).toHaveBeenCalledTimes(2);
  expect(client.get).toHaveBeenCalledTimes(1);
});

test('accepts a canonical hexadecimal Dataverse actor GUID without RFC version-bit assumptions', async () => {
  const actorId = 'f1111111-1111-f111-8111-111111111111';
  sql.mockResolvedValue({ rows: [{ ...validProfile(), dynamics_systemuser_id: actorId }] });
  const client = { get: jest.fn().mockResolvedValue({ ok: true, body: {
    systemuserid: actorId,
    azureactivedirectoryobjectid: OID,
    isdisabled: false,
  } }) };
  createClient.mockReturnValue(client);

  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true }))
    .resolves.toMatchObject({ systemuserid: actorId });
  expect(client.get).toHaveBeenCalledWith(
    `/systemusers(${actorId})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled`,
  );
});

test.each([
  ['inactive profile', { is_active: false }],
  ['linking profile', { needs_linking: true }],
  ['different Azure identity', { azure_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  ['malformed stored actor GUID', { dynamics_systemuser_id: 'not-a-guid' }],
])('fails closed for %s before Dataverse lookup', async (_label, overrides) => {
  sql.mockResolvedValue({ rows: [{ ...validProfile(), ...overrides }] });
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();
  expect(createClient).not.toHaveBeenCalled();
  expect(getAccessToken).not.toHaveBeenCalled();
});

test.each([
  ['wrong GUID', { systemuserid: '55555555-5555-4555-8555-555555555555' }],
  ['wrong Azure OID', { azureactivedirectoryobjectid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  ['disabled actor', { isdisabled: true }],
  ['unknown disabled state', { isdisabled: null }],
])('fails closed for %s from the resolved sandbox', async (_label, overrides) => {
  createClient.mockReturnValue({ get: jest.fn().mockResolvedValue({ ok: true, body: {
    systemuserid: ACTOR,
    azureactivedirectoryobjectid: OID,
    isdisabled: false,
    ...overrides,
  } }) });
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();
});

test.each([
  ['wrong sandbox override', { DYNAMICS_SANDBOX_URL: 'https://other.crm.dynamics.com' }],
  ['wrong Dynamics origin', { DYNAMICS_URL: 'https://other.crm.dynamics.com', DYNAMICS_SANDBOX_URL: undefined }],
  ['supervised mode off', { MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED: 'off' }],
])('does not issue the dedicated profile-1 lookup for %s', async (_label, overrides) => {
  Object.assign(process.env, overrides);
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();
  expect(sql).toHaveBeenCalledTimes(1);
  expect(sql.mock.calls[0][0].join('')).toContain('SELECT id, azure_email, is_active');
  expect(sql.mock.calls[0][0].join('')).not.toContain('azure_id =');
  expect(getAccessToken).toHaveBeenCalledTimes(1);
  expect(createClient.mock.results[0].value.get).not.toHaveBeenCalled();
});

test('a supervised lookup failure is contained to profile 1 and cannot break another profile map', async () => {
  sql.mockRejectedValueOnce(new Error('isolated profile read failed'))
    .mockResolvedValueOnce({ rows: [validProfile(), { id: 7, azure_email: 'other@example.org', is_active: true }] });
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();

  const client = { get: jest.fn().mockResolvedValue({ ok: true, body: { value: [{ systemuserid: ACTOR, fullname: 'Other' }] } }) };
  createClient.mockReturnValue(client);
  await expect(resolveProfileToSystemUser(7)).resolves.toMatchObject({ systemuserid: ACTOR });
  expect(client.get).toHaveBeenCalledTimes(1);
});

test.each([
  ['non-success HTTP response', { ok: false, status: 503 }],
  ['successful response with no actor', { ok: true, body: null }],
])('skips only profile 1 on a %s', async (_label, response) => {
  const client = { get: jest.fn().mockResolvedValue(response) };
  createClient.mockReturnValue(client);
  await expect(resolveProfileToSystemUser(1, { allowSupervisedTestRead: true })).resolves.toBeNull();
  expect(client.get).toHaveBeenCalledTimes(1);

  sql.mockResolvedValueOnce({ rows: [{ id: 7, azure_email: 'other@example.org', is_active: true }] });
  client.get.mockResolvedValueOnce({ ok: true, body: { value: [{ systemuserid: ACTOR, fullname: 'Other' }] } });
  await expect(resolveProfileToSystemUser(7)).resolves.toMatchObject({ systemuserid: ACTOR });
});
