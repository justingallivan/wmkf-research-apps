/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/client', () => ({ getAccessToken: jest.fn(), createClient: jest.fn() }));
jest.mock('../../lib/services/proposal-ranking/test-policy', () => ({ getRankingTestPolicy: jest.fn() }));
const { sql } = require('@vercel/postgres');
const { getAccessToken, createClient } = require('../../lib/dataverse/client');
const { getRankingTestPolicy } = require('../../lib/services/proposal-ranking/test-policy');
const { resolveProfileToSystemUser, resolveSystemUserToProfile, clearCache } = require('../../lib/services/dataverse-identity-map');
const ID = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7', OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
let profile, actor, client;
beforeEach(() => {
  jest.clearAllMocks(); clearCache();
  process.env.DYNAMICS_URL = 'https://orgd9e66399.crm.dynamics.com';
  getRankingTestPolicy.mockReturnValue({ requested: true, enabled: true });
  profile = { id: 1, azure_id: OID, dynamics_systemuser_id: ID, is_active: true, needs_linking: false };
  actor = { systemuserid: ID, azureactivedirectoryobjectid: OID, isdisabled: false };
  sql.mockImplementation(async () => ({ rows: [profile] }));
  client = { get: jest.fn(async () => ({ ok: true, body: actor })) };
  createClient.mockReturnValue(client); getAccessToken.mockResolvedValue('test');
});
test('fresh forward/reverse map for isolated profile 1 does not inherit production skip', async () => {
  await expect(resolveProfileToSystemUser(1)).resolves.toMatchObject({ systemuserid: ID });
  await expect(resolveSystemUserToProfile(ID)).resolves.toBe(1);
  actor.isdisabled = true;
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  expect(client.get).toHaveBeenCalledTimes(3);
});
test.each([{ is_active: false }, { needs_linking: true }, { azure_id: null }, { dynamics_systemuser_id: 'bad' }])('rejects invalid profile %j', async change => {
  Object.assign(profile, change);
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  expect(client.get).not.toHaveBeenCalled();
});
test.each([{ isdisabled: true }, { azureactivedirectoryobjectid: ID }, { systemuserid: OID }])('rejects mismatched actor %j', async change => {
  Object.assign(actor, change);
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
});
test('duplicate link fails in both directions', async () => {
  sql.mockResolvedValue({ rows: [profile, { ...profile, id: 2 }] });
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  await expect(resolveSystemUserToProfile(ID)).resolves.toBeNull();
});
test('requested invalid mode denies even after valid identity and default cache reads', async () => {
  await resolveProfileToSystemUser(1);
  getRankingTestPolicy.mockReturnValue({ requested: true, enabled: false });
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  await expect(resolveSystemUserToProfile(ID)).resolves.toBeNull();
  expect(client.get).toHaveBeenCalledTimes(1);
});
test('lookup errors fail closed', async () => {
  client.get.mockRejectedValue(new Error('unavailable'));
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
});
test('mode off preserves normal profile1 skip', async () => {
  getRankingTestPolicy.mockReturnValue({ requested: false, enabled: false });
  await expect(resolveProfileToSystemUser(1)).resolves.toBeNull();
  await expect(resolveSystemUserToProfile(ID)).resolves.toBeNull();
});
