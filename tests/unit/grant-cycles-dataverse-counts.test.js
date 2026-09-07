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
    .mockResolvedValueOnce({ ok: true, body: { value: [{ count: 4 }] } })
    .mockResolvedValueOnce({ ok: true, body: { value: [] } });

  const result = await fetchCounts([
    { id: 'cycle-j26', name: 'June 2026', fiscalYearCode: 'June 2026' },
    { name: 'Invalid cycle name', fiscalYearCode: 'Invalid cycle name' },
  ]);

  expect(result.proposalCountsByFiscalYear.get('June 2026')).toBe(2);
  expect(result.proposalCountsByFiscalYear.get('Invalid cycle name')).toBe(0);
  expect(result.unassignedProposalCount).toBe(2);
  expect(result.proposalCountsByCycleId.get('cycle-j26')).toBe(2);
  const requestUrl = get.mock.calls[0][0];
  expect(requestUrl).toContain('fetchXml=');
  expect(decodeURIComponent(requestUrl)).toContain('wmkf_request_type');
  expect(decodeURIComponent(requestUrl)).toContain('wmkf_meetingdate');
  expect(decodeURIComponent(requestUrl)).not.toContain('akoya_fiscalyear');
});

test('assigns a duplicate cycle date to only the first cycle row', async () => {
  get
    .mockResolvedValueOnce({ ok: true, body: { value: [{ year: 2026, month: 6, count: 40 }] } })
    .mockResolvedValueOnce({ ok: true, body: { value: [{ count: 40 }] } })
    .mockResolvedValueOnce({ ok: true, body: { value: [] } });

  const result = await fetchCounts([
    { id: 'active-j26', name: 'June 2026', fiscalYearCode: null },
    { id: 'archived-j26', name: 'June 2026', fiscalYearCode: null },
  ]);

  expect(result.proposalCountsByCycleId.get('active-j26')).toBe(40);
  expect(result.proposalCountsByCycleId.has('archived-j26')).toBe(false);
  expect(result.unassignedProposalCount).toBe(0);
  expect([...result.proposalCountsByCycleId.values()].reduce((sum, n) => sum + n, 0)
    + result.unassignedProposalCount).toBe(40);
});

test('falls back to a valid fiscal-year code when display name is malformed', async () => {
  get
    .mockResolvedValueOnce({ ok: true, body: { value: [{ year: 2026, month: 6, count: 3 }] } })
    .mockResolvedValueOnce({ ok: true, body: { value: [{ count: 3 }] } })
    .mockResolvedValueOnce({ ok: true, body: { value: [] } });

  const result = await fetchCounts([
    { id: 'cycle-j26', name: 'J26 Board Cycle', fiscalYearCode: 'June 2026' },
  ]);

  expect(result.proposalCountsByCycleId.get('cycle-j26')).toBe(3);
  expect(result.unassignedProposalCount).toBe(0);
});
