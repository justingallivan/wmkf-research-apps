/**
 * @jest-environment node
 *
 * Stage 0 characterization pins (OData Escape Consolidation Plan) for
 * lib/services/dataverse-settings-service.js sites 4 (findRow, via getSetting),
 * 5 (listSettings) and 6 (listSettingsWithMeta): the built $filter doubles an
 * embedded single quote byte-for-byte. encodeURIComponent leaves apostrophes
 * unencoded, so the doubled literal survives in the captured request path.
 */
const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn().mockResolvedValue('tok'),
  createClient: jest.fn(() => ({ get, post, patch })),
}));

const {
  createSettingStrict,
  getSetting,
  getSettingStrict,
  listSettings,
  listSettingsWithMeta,
  listSettingsWithMetaStrict,
  setSettingIfUnchanged,
} = require('../../lib/services/dataverse-settings-service');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  get.mockResolvedValue({ ok: true, body: { value: [] } });
  post.mockResolvedValue({ ok: true, body: {} });
  patch.mockResolvedValue({ ok: true, body: {} });
});

// encodeURIComponent %20/%2C-encodes spaces and commas but leaves apostrophes
// intact, so assert the quoted literal fragment (the doubled '' is the pin).
test("getSetting doubles single quotes in the wmkf_settingkey filter", async () => {
  await getSetting("O'Brien");
  expect(get.mock.calls[0][0]).toContain("'O''Brien'");
});

test("listSettings doubles single quotes in the startswith prefix", async () => {
  await listSettings("pre'fix");
  expect(get.mock.calls[0][0]).toContain("'pre''fix')");
});

test('listSettings follows every Dataverse page', async () => {
  get
    .mockResolvedValueOnce({
      ok: true,
      body: {
        value: [{ wmkf_settingkey: 'feature.one', wmkf_settingvalue: 'enabled' }],
        '@odata.nextLink': 'https://example.crm.dynamics.com/api/data/v9.2/next-page',
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      body: { value: [{ wmkf_settingkey: 'feature.two', wmkf_settingvalue: 'disabled' }] },
    });

  await expect(listSettings('feature.')).resolves.toEqual({
    'feature.one': 'enabled',
    'feature.two': 'disabled',
  });
  expect(get.mock.calls[1][0]).toBe('https://example.crm.dynamics.com/api/data/v9.2/next-page');
  expect(get.mock.calls[1][1]).toEqual(get.mock.calls[0][1]);
});

test("listSettingsWithMeta doubles single quotes in the startswith prefix", async () => {
  await listSettingsWithMeta("pre'fix");
  expect(get.mock.calls[0][0]).toContain("'pre''fix')");
});

test('strict metadata reads preserve immutable revision provenance', async () => {
  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{
      wmkf_appsystemsettingid: 'row-1',
      wmkf_settingkey: 'executor.budgets.v000001',
      wmkf_settingvalue: '{}',
      createdon: '2026-08-29T00:00:00Z',
      modifiedon: '2026-08-29T00:00:00Z',
      _wmkf_updatedby_value: 'actor-1',
      '_wmkf_updatedby_value@OData.Community.Display.V1.FormattedValue': 'Admin User',
    }] },
  });
  await expect(listSettingsWithMetaStrict('executor.budgets.v')).resolves.toEqual({
    'executor.budgets.v000001': expect.objectContaining({
      id: 'row-1',
      value: '{}',
      updatedById: 'actor-1',
      updatedByName: 'Admin User',
    }),
  });
});

test('strict metadata reads follow every Dataverse page', async () => {
  get
    .mockResolvedValueOnce({
      ok: true,
      body: {
        value: [{ wmkf_settingkey: 'executor.budgets.v000001', wmkf_settingvalue: '{}' }],
        '@odata.nextLink': 'https://example.crm.dynamics.com/api/data/v9.2/next-page',
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      body: { value: [{ wmkf_settingkey: 'executor.budgets.v000002', wmkf_settingvalue: '{}' }] },
    });
  await expect(listSettingsWithMetaStrict('executor.budgets.v')).resolves.toEqual({
    'executor.budgets.v000001': expect.objectContaining({ value: '{}' }),
    'executor.budgets.v000002': expect.objectContaining({ value: '{}' }),
  });
  expect(get.mock.calls[1][0]).toBe('https://example.crm.dynamics.com/api/data/v9.2/next-page');
  expect(get.mock.calls[0][0]).not.toContain('$top=5000');
  expect(get.mock.calls[0][1]).toEqual({
    Prefer: 'odata.maxpagesize=5000,odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
  });
  expect(get.mock.calls[1][1]).toEqual(get.mock.calls[0][1]);
});

test('createSettingStrict is create-only and surfaces alternate-key conflicts', async () => {
  await expect(createSettingStrict('executor.budgets.v000001', '{}')).resolves.toBe(true);
  expect(post).toHaveBeenCalledWith('/wmkf_appsystemsettings', {
    wmkf_settingkey: 'executor.budgets.v000001',
    wmkf_settingvalue: '{}',
  });

  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{ wmkf_appsystemsettingid: 'existing', wmkf_settingvalue: '{}' }] },
  });
  await expect(createSettingStrict('executor.budgets.v000001', '{}'))
    .rejects.toMatchObject({ code: 'setting_exists', status: 409 });
  expect(post).toHaveBeenCalledTimes(1);
});

test('createSettingStrict normalizes a Dataverse alternate-key 412 to setting_exists', async () => {
  post.mockResolvedValueOnce({ ok: false, status: 412, text: 'duplicate alternate key' });
  await expect(createSettingStrict('executor.budgets.v000001', '{}'))
    .rejects.toMatchObject({ code: 'setting_exists', status: 409 });
});

test('strict setting reads return the Dataverse row revision', async () => {
  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{
      wmkf_appsystemsettingid: 'row-1',
      wmkf_settingvalue: '{}',
      '@odata.etag': 'W/"17"',
    }] },
  });
  await expect(getSettingStrict('final_writeup.matrix_audiences')).resolves.toEqual({
    found: true,
    value: '{}',
    revision: 'W/"17"',
  });
});

test('conditional setting writes carry the loaded revision as If-Match', async () => {
  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{
      wmkf_appsystemsettingid: 'row-1',
      wmkf_settingvalue: '{}',
      '@odata.etag': 'W/"17"',
    }] },
  });
  await expect(setSettingIfUnchanged(
    'final_writeup.matrix_audiences',
    '{"version":1}',
    'W/"17"',
  )).resolves.toBe(true);
  expect(patch).toHaveBeenCalledWith(
    '/wmkf_appsystemsettings(row-1)',
    { wmkf_settingvalue: '{"version":1}' },
    { 'If-Match': 'W/"17"' },
  );
});

test('conditional setting writes reject stale reads before PATCH', async () => {
  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{
      wmkf_appsystemsettingid: 'row-1',
      wmkf_settingvalue: '{}',
      '@odata.etag': 'W/"18"',
    }] },
  });
  await expect(setSettingIfUnchanged(
    'final_writeup.matrix_audiences',
    '{"version":1}',
    'W/"17"',
  )).rejects.toMatchObject({ code: 'setting_conflict', status: 409 });
  expect(patch).not.toHaveBeenCalled();
});

test('conditional setting writes fail closed when an existing row has no revision', async () => {
  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{
      wmkf_appsystemsettingid: 'row-1',
      wmkf_settingvalue: '{}',
    }] },
  });
  await expect(setSettingIfUnchanged(
    'final_writeup.matrix_audiences',
    '{"version":1}',
    null,
  )).rejects.toMatchObject({ code: 'setting_revision_unavailable', status: 503 });
  expect(patch).not.toHaveBeenCalled();
});

test.each([409, 412])(
  'conditional setting create normalizes a concurrent alternate-key %s to setting_conflict',
  async (status) => {
    post.mockResolvedValueOnce({ ok: false, status, text: 'duplicate alternate key' });
    await expect(setSettingIfUnchanged(
      'final_writeup.matrix_audiences',
      '{"version":1}',
      null,
    )).rejects.toMatchObject({ code: 'setting_conflict', status: 409 });
    expect(patch).not.toHaveBeenCalled();
  },
);
