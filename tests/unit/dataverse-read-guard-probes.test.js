/**
 * @jest-environment node
 *
 * Q9 Stage 1f: read-side DATAVERSE_DAL_UNIVERSAL probes should observe
 * context coverage for prefs/app-access reads before the transport swap.
 * They live inside each service try/catch so read APIs keep their historical
 * falsy/empty fallback behavior even if the flag is accidentally set to on.
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveProfileToSystemUser: jest.fn(async () => null),
  resolveSystemUserToProfile: jest.fn(),
}));

const { sql } = require('@vercel/postgres');
const prefs = require('../../lib/services/dataverse-prefs-service');
const appAccess = require('../../lib/services/dataverse-app-access-service');

const FLAG = 'DATAVERSE_DAL_UNIVERSAL';
let savedFlag;
let warnSpy;
let errorSpy;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  sql.mockReset().mockResolvedValue({ rows: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedFlag === undefined) {
    delete process.env[FLAG];
  } else {
    process.env[FLAG] = savedFlag;
  }
});

test('warn mode emits read labels for prefs and app-access read APIs', async () => {
  process.env[FLAG] = 'warn';

  await prefs.getUserPreferences(7);
  await prefs.getDecryptedApiKey(7, 'api_key_ncbi');
  await prefs.hasPreference(7, 'some_key');
  await appAccess.listAppKeysForUser(7);
  await appAccess.listAllGrantsForAdmin();

  const messages = warnSpy.mock.calls.map(([message]) => message);
  expect(messages).toEqual([
    '[dal-universal] prefs:read executed without trusted Dataverse context',
    '[dal-universal] prefs:read executed without trusted Dataverse context',
    '[dal-universal] prefs:read executed without trusted Dataverse context',
    '[dal-universal] app-access:read executed without trusted Dataverse context',
    '[dal-universal] app-access:read executed without trusted Dataverse context',
  ]);
});

test('on mode read probes preserve service fallback contracts', async () => {
  process.env[FLAG] = 'on';

  await expect(prefs.getUserPreferences(7)).resolves.toEqual({});
  await expect(prefs.getDecryptedApiKey(7, 'api_key_ncbi')).resolves.toBeNull();
  await expect(prefs.hasPreference(7, 'some_key')).resolves.toBe(false);
  await expect(appAccess.listAppKeysForUser(7)).resolves.toEqual([]);
  await expect(appAccess.listAllGrantsForAdmin()).resolves.toEqual([]);

  expect(errorSpy).toHaveBeenCalled();
});
