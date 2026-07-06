/**
 * @jest-environment node
 *
 * Q9 Stage 1f/3: read-side DATAVERSE_DAL_UNIVERSAL probes still observe the
 * not-yet-migrated app-access reads. Prefs probes were removed when prefs moved
 * to the DynamicsService adapter in Stage 3.
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveProfileToSystemUser: jest.fn(async () => null),
  resolveSystemUserToProfile: jest.fn(),
}));

const { sql } = require('@vercel/postgres');
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

test('warn mode emits read labels for app-access read APIs', async () => {
  process.env[FLAG] = 'warn';

  await appAccess.listAppKeysForUser(7);
  await appAccess.listAllGrantsForAdmin();

  const messages = warnSpy.mock.calls.map(([message]) => message);
  expect(messages).toEqual([
    '[dal-universal] app-access:read executed without trusted Dataverse context',
    '[dal-universal] app-access:read executed without trusted Dataverse context',
  ]);
});

test('on mode app-access read probes preserve service fallback contracts', async () => {
  process.env[FLAG] = 'on';

  await expect(appAccess.listAppKeysForUser(7)).resolves.toEqual([]);
  await expect(appAccess.listAllGrantsForAdmin()).resolves.toEqual([]);

  expect(errorSpy).toHaveBeenCalled();
});
