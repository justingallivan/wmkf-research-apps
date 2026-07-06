/**
 * @jest-environment node
 *
 * Q9 Stage 3 characterization for lib/services/dataverse-prefs-service.js.
 * These assertions pin the public behavior and DynamicsService adapter call
 * shapes after the prefs transport swap.
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(),
    queryAllRecords: jest.fn(),
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    deleteRecord: jest.fn(),
  },
}));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveProfileToSystemUser: jest.fn(),
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const { resolveProfileToSystemUser } = require('../../lib/services/dataverse-identity-map');
const { decrypt, encrypt, maskValue } = require('../../lib/utils/encryption');
const prefs = require('../../lib/services/dataverse-prefs-service');

const PROFILE_ID = 7;
const SYSTEM_USER_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_SET = 'wmkf_appuserpreferences';
const FIND_SELECT = 'wmkf_appuserpreferenceid,wmkf_preferencevalue,wmkf_isencrypted';
const LIST_SELECT = 'wmkf_preferencekey,wmkf_preferencevalue,wmkf_isencrypted';

function ownerFilter() {
  return `_ownerid_value eq ${SYSTEM_USER_ID}`;
}

function ownerAndKeyFilter(key) {
  return `${ownerFilter()} and wmkf_preferencekey eq '${String(key).replace(/'/g, "''")}'`;
}

beforeEach(() => {
  process.env.USER_PREFS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  delete process.env.DYNAMICS_SANDBOX_URL;
  delete process.env.DATAVERSE_DAL_UNIVERSAL;
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  resolveProfileToSystemUser.mockResolvedValue({ systemuserid: SYSTEM_USER_ID });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DYNAMICS_SANDBOX_URL;
  delete process.env.USER_PREFS_ENCRYPTION_KEY;
  delete process.env.DATAVERSE_DAL_UNIVERSAL;
});

test('getUserPreferences lists all rows with exact select/filter and masks encrypted values by default', async () => {
  const encrypted = encrypt('secret-value-123');
  DynamicsService.queryAllRecords.mockResolvedValueOnce({
    records: [
      { wmkf_preferencekey: 'plain', wmkf_preferencevalue: 'hello', wmkf_isencrypted: false },
      { wmkf_preferencekey: 'api_key_ncbi', wmkf_preferencevalue: encrypted, wmkf_isencrypted: true },
    ],
  });

  const result = await prefs.getUserPreferences(PROFILE_ID, false);

  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(ENTITY_SET, {
    select: LIST_SELECT,
    filter: ownerFilter(),
  });
  expect(result).toEqual({
    plain: 'hello',
    api_key_ncbi: maskValue('secret-value-123'),
  });
});

test('getUserPreferences can return decrypted encrypted values and does not truncate over 25 rows', async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    wmkf_preferencekey: `key-${index}`,
    wmkf_preferencevalue: `value-${index}`,
    wmkf_isencrypted: false,
  }));
  rows.push({
    wmkf_preferencekey: 'api_key_ncbi',
    wmkf_preferencevalue: encrypt('secret-value-123'),
    wmkf_isencrypted: true,
  });
  DynamicsService.queryAllRecords.mockResolvedValueOnce({ records: rows });

  const result = await prefs.getUserPreferences(PROFILE_ID, true);

  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(ENTITY_SET, {
    select: LIST_SELECT,
    filter: ownerFilter(),
  });
  expect(Object.keys(result)).toHaveLength(31);
  expect(result['key-29']).toBe('value-29');
  expect(result.api_key_ncbi).toBe('secret-value-123');
});

test('setUserPreference creates a new non-encrypted row with owner bind and no caller-id options', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [] });
  DynamicsService.createRecord.mockResolvedValueOnce({ wmkf_appuserpreferenceid: 'pref-1' });

  const result = await prefs.setUserPreference(PROFILE_ID, "plain'key", 'hello', false);

  expect(result).toBe(true);
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith(ENTITY_SET, {
    select: FIND_SELECT,
    filter: ownerAndKeyFilter("plain'key"),
    top: 1,
  });
  expect(DynamicsService.createRecord).toHaveBeenCalledWith(ENTITY_SET, {
    wmkf_preferencekey: "plain'key",
    wmkf_preferencevalue: 'hello',
    wmkf_isencrypted: false,
    'ownerid@odata.bind': `/systemusers(${SYSTEM_USER_ID})`,
  });
});

test('setUserPreference updates an existing auto-encrypted key with no caller-id options', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({
    records: [{ wmkf_appuserpreferenceid: 'pref-1', wmkf_preferencevalue: 'old', wmkf_isencrypted: true }],
  });
  DynamicsService.updateRecord.mockResolvedValueOnce({});

  const result = await prefs.setUserPreference(PROFILE_ID, 'api_key_ncbi', 'secret-value-123');

  expect(result).toBe(true);
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
  const [entitySet, id, body, options] = DynamicsService.updateRecord.mock.calls[0];
  expect(entitySet).toBe(ENTITY_SET);
  expect(id).toBe('pref-1');
  expect(options).toBeUndefined();
  expect(body.wmkf_isencrypted).toBe(true);
  expect(body.wmkf_preferencevalue).not.toBe('secret-value-123');
  expect(decrypt(body.wmkf_preferencevalue)).toBe('secret-value-123');
});

test('setUserPreferences skips undefined values and writes each defined key independently', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [] })
    .mockResolvedValueOnce({ records: [] });
  DynamicsService.createRecord
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({});

  const result = await prefs.setUserPreferences(PROFILE_ID, {
    first: 'one',
    skipped: undefined,
    second: 'two',
  });

  expect(result).toBe(true);
  expect(DynamicsService.createRecord).toHaveBeenCalledTimes(2);
  expect(DynamicsService.createRecord.mock.calls.map(([, body]) => body.wmkf_preferencekey)).toEqual([
    'first',
    'second',
  ]);
});

test('deleteUserPreference treats an absent row as success and avoids delete transport', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [] });

  const result = await prefs.deleteUserPreference(PROFILE_ID, 'missing');

  expect(result).toBe(true);
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith(ENTITY_SET, {
    select: FIND_SELECT,
    filter: ownerAndKeyFilter('missing'),
    top: 1,
  });
  expect(DynamicsService.deleteRecord).not.toHaveBeenCalled();
});

test('deleteUserPreference deletes an existing row by id', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({
    records: [{ wmkf_appuserpreferenceid: 'pref-1' }],
  });
  DynamicsService.deleteRecord.mockResolvedValueOnce({});

  const result = await prefs.deleteUserPreference(PROFILE_ID, 'plain');

  expect(result).toBe(true);
  expect(DynamicsService.deleteRecord).toHaveBeenCalledWith(ENTITY_SET, 'pref-1');
});

test('getDecryptedApiKey returns plaintext for encrypted rows', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({
    records: [{
      wmkf_appuserpreferenceid: 'pref-1',
      wmkf_preferencevalue: encrypt('secret-value-123'),
      wmkf_isencrypted: true,
    }],
  });

  const result = await prefs.getDecryptedApiKey(PROFILE_ID, 'api_key_ncbi');

  expect(DynamicsService.queryRecords).toHaveBeenCalledWith(ENTITY_SET, {
    select: FIND_SELECT,
    filter: ownerAndKeyFilter('api_key_ncbi'),
    top: 1,
  });
  expect(result).toBe('secret-value-123');
});

test('hasPreference is true only for a present non-empty value', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [{ wmkf_preferencevalue: 'x' }] })
    .mockResolvedValueOnce({ records: [{ wmkf_preferencevalue: '' }] })
    .mockResolvedValueOnce({ records: [] });

  await expect(prefs.hasPreference(PROFILE_ID, 'present')).resolves.toBe(true);
  await expect(prefs.hasPreference(PROFILE_ID, 'empty')).resolves.toBe(false);
  await expect(prefs.hasPreference(PROFILE_ID, 'missing')).resolves.toBe(false);
});

test('unmapped profiles return historical falsy/empty values', async () => {
  resolveProfileToSystemUser.mockResolvedValueOnce(null);
  await expect(prefs.getUserPreferences(PROFILE_ID)).resolves.toEqual({});

  resolveProfileToSystemUser.mockResolvedValueOnce(null);
  await expect(prefs.setUserPreference(PROFILE_ID, 'key', 'value')).resolves.toBe(false);

  resolveProfileToSystemUser.mockResolvedValueOnce(null);
  await expect(prefs.deleteUserPreference(PROFILE_ID, 'key')).resolves.toBe(false);

  resolveProfileToSystemUser.mockResolvedValueOnce(null);
  await expect(prefs.getDecryptedApiKey(PROFILE_ID, 'key')).resolves.toBeNull();

  resolveProfileToSystemUser.mockResolvedValueOnce(null);
  await expect(prefs.hasPreference(PROFILE_ID, 'key')).resolves.toBe(false);
});

test('transport failures log and return historical falsy/empty values', async () => {
  DynamicsService.queryAllRecords.mockRejectedValue(new Error('list failed'));
  DynamicsService.queryRecords.mockRejectedValue(new Error('find failed'));

  await expect(prefs.getUserPreferences(PROFILE_ID)).resolves.toEqual({});
  await expect(prefs.setUserPreference(PROFILE_ID, 'key', 'value')).resolves.toBe(false);
  await expect(prefs.deleteUserPreference(PROFILE_ID, 'key')).resolves.toBe(false);
  await expect(prefs.getDecryptedApiKey(PROFILE_ID, 'key')).resolves.toBeNull();
  await expect(prefs.hasPreference(PROFILE_ID, 'key')).resolves.toBe(false);
  expect(console.error).toHaveBeenCalled();
});
