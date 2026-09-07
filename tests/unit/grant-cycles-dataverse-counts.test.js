/**
 * @jest-environment node
 *
 * Proposal counts must follow the persisted meeting date and conserve rows in
 * the explicit unmatched bucket; legacy fiscal-year text is intentionally not
 * part of the aggregation contract.
 */
const get = jest.fn();
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn().mockResolvedValue('tok'),
  createClient: jest.fn(() => ({ get })),
}));

const { fetchCounts } = require('../../lib/services/grant-cycles-dataverse');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
});

test('counts proposal rows by meeting month, excludes non-proposals, and conserves unmatched rows', async () => {
  get
    .mockResolvedValueOnce({
      ok: true,
      body: {
        value: [
          // Fiscal-year text is absent/malformed in this aggregate by design.
          { year: 2026, month: 6, count: 2 },
          { year: 2026, month: 3, count: 1 },
          { year: null, month: null, count: 1 },
        ],
      },
    })
    .mockResolvedValueOnce({ ok: true, body: { value: [] } });

  const result = await fetchCounts([
    { name: 'June 2026', fiscalYearCode: 'June 2026' },
    { name: 'Invalid cycle name', fiscalYearCode: 'Invalid cycle name' },
  ]);

  expect(result.proposalCountsByFiscalYear.get('June 2026')).toBe(2);
  expect(result.proposalCountsByFiscalYear.get('Invalid cycle name')).toBe(0);
  expect(result.unassignedProposalCount).toBe(2);
  const requestUrl = get.mock.calls[0][0];
  expect(requestUrl).toContain('fetchXml=');
  expect(decodeURIComponent(requestUrl)).toContain('wmkf_request_type');
  expect(decodeURIComponent(requestUrl)).toContain('wmkf_meetingdate');
  expect(decodeURIComponent(requestUrl)).not.toContain('akoya_fiscalyear');
});
