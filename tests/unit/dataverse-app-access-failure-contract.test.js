/**
 * @jest-environment node
 *
 * Q9 acceptance safety: app-access batch operations report completed work on
 * partial failure, and strict admin reads never collapse a transport failure
 * into an empty grant snapshot.
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn(),
  createClient: jest.fn(),
}));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveProfileToSystemUser: jest.fn(),
  resolveSystemUserToProfile: jest.fn(),
}));

const { sql } = require('@vercel/postgres');
const { getAccessToken, createClient } = require('../../lib/dataverse/client');
const {
  resolveProfileToSystemUser,
} = require('../../lib/services/dataverse-identity-map');
const { withDalContext } = require('../../lib/dataverse/core/context');
const {
  grantApps,
  listAllGrantsForAdmin,
  revokeApps,
} = require('../../lib/services/dataverse-app-access-service');

const SYSTEM_USER_ID = '11111111-1111-1111-1111-111111111111';
const GRANTER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DATAVERSE_DAL_UNIVERSAL = 'on';
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  getAccessToken.mockResolvedValue('test-token');
  resolveProfileToSystemUser.mockImplementation(async (profileId) => (
    profileId === 7
      ? { systemuserid: SYSTEM_USER_ID }
      : { systemuserid: GRANTER_ID }
  ));
  sql.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DATAVERSE_DAL_UNIVERSAL;
  delete process.env.DYNAMICS_URL;
});

test('grantApps returns the completed prefix when a later grant fails', async () => {
  const client = {
    get: jest.fn()
      .mockResolvedValueOnce({ ok: true, body: { value: [] } })
      .mockResolvedValueOnce({ ok: true, body: { value: [] } }),
    post: jest.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 503, text: 'unavailable' }),
  };
  createClient.mockReturnValue(client);

  const result = await withDalContext('q9-acceptance-grant', () =>
    grantApps(7, ['dynamics-explorer', 'literature-analyzer'], 9));

  expect(result).toEqual({
    granted: ['dynamics-explorer'],
    error: 'grant failed (literature-analyzer): 503 unavailable',
  });
});

test('revokeApps returns the completed prefix when a later revoke fails', async () => {
  const client = {
    get: jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        body: { value: [{ wmkf_appuserappaccessid: 'grant-1' }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        body: { value: [{ wmkf_appuserappaccessid: 'grant-2' }] },
      }),
    delete_: jest.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 503 }),
  };
  createClient.mockReturnValue(client);

  const result = await withDalContext('q9-acceptance-revoke', () =>
    revokeApps(7, ['dynamics-explorer', 'literature-analyzer']));

  expect(result).toEqual({
    revoked: ['dynamics-explorer'],
    error: 'revoke failed (literature-analyzer): 503',
  });
});

test('strict admin list rejects instead of returning a false-empty snapshot', async () => {
  createClient.mockReturnValue({
    get: jest.fn().mockResolvedValue({ ok: false, status: 503 }),
  });

  await expect(withDalContext('q9-acceptance-list', () =>
    listAllGrantsForAdmin({ throwOnError: true })))
    .rejects.toThrow('list all grants failed: 503');
});
