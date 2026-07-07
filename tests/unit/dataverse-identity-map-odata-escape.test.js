/**
 * @jest-environment node
 *
 * Stage 0 characterization pin (OData Escape Consolidation Plan) for
 * lib/services/dataverse-identity-map.js site 7 (buildMap): the systemusers
 * $filter doubles an embedded single quote in the azure_email literal.
 */
const get = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn().mockResolvedValue('tok'),
  createClient: jest.fn(() => ({ get })),
}));

const { sql } = require('@vercel/postgres');
const {
  resolveProfileToSystemUser,
  clearCache,
} = require('../../lib/services/dataverse-identity-map');

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  sql.mockResolvedValue({
    rows: [{ id: 2, azure_email: "o'brien@example.com", is_active: true }],
  });
  get.mockResolvedValue({ ok: true, body: { value: [{ systemuserid: 'S1', fullname: 'X' }] } });
});

test("buildMap doubles single quotes in the internalemailaddress filter", async () => {
  await resolveProfileToSystemUser(2);
  expect(get.mock.calls[0][0]).toContain("internalemailaddress eq 'o''brien@example.com'");
});

test('buildMap propagates non-2xx systemusers lookup errors without caching a partial map', async () => {
  get.mockResolvedValueOnce({ ok: false, status: 503 });

  await expect(resolveProfileToSystemUser(2)).rejects.toThrow(
    'Dataverse systemusers lookup failed with status 503',
  );
  expect(sql).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(1);

  get.mockResolvedValueOnce({
    ok: true,
    body: { value: [{ systemuserid: 'S2', fullname: 'Recovered User' }] },
  });

  await expect(resolveProfileToSystemUser(2)).resolves.toEqual({
    systemuserid: 'S2',
    fullname: 'Recovered User',
    remappedFromId: null,
  });
  expect(sql).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(2);
});
