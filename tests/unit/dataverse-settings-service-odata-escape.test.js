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
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn().mockResolvedValue('tok'),
  createClient: jest.fn(() => ({ get })),
}));

const {
  getSetting,
  listSettings,
  listSettingsWithMeta,
} = require('../../lib/services/dataverse-settings-service');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  get.mockResolvedValue({ ok: true, body: { value: [] } });
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

test("listSettingsWithMeta doubles single quotes in the startswith prefix", async () => {
  await listSettingsWithMeta("pre'fix");
  expect(get.mock.calls[0][0]).toContain("'pre''fix')");
});
