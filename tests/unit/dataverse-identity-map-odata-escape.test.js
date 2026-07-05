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
