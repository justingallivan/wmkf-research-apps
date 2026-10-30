/**
 * getCycleDatesById: the Grant Cycle row a request links to (D48). A missing
 * row is null (the service's `cycle_missing`); any other failure throws (the
 * service's `calendar_unavailable`).
 */

const fetchWithTimeout = jest.fn();
jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: (...a) => fetchWithTimeout(...a) }));
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { getAccessToken: jest.fn(async () => 'token'), buildHeaders: jest.fn(() => ({})) },
}));

const { getCycleDatesById } = require('../../lib/dataverse/adapters/operations-grant-cycle');

const ID = '27272727-2727-4727-8727-272727272727';

beforeEach(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  fetchWithTimeout.mockReset();
});

test('reads the one row by id with the caller deadline', async () => {
  fetchWithTimeout.mockResolvedValue({ ok: true, status: 200, json: async () => ({ wmkf_cyclecode: 'J27', wmkf_researchreviewsduedate: '2027-03-10' }) });
  await expect(getCycleDatesById(ID, { timeoutMs: 1234 })).resolves.toMatchObject({ wmkf_cyclecode: 'J27' });
  const [url, , timeoutMs] = fetchWithTimeout.mock.calls[0];
  expect(url).toContain(`(${ID})?`);
  expect(decodeURIComponent(url)).toContain('wmkf_researchreviewsduedate');
  expect(timeoutMs).toBe(1234);
});

test('a missing row is null; any other failure throws', async () => {
  fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 404 });
  await expect(getCycleDatesById(ID)).resolves.toBeNull();
  fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(getCycleDatesById(ID)).rejects.toMatchObject({ status: 503 });
});

test('a non-GUID id throws before any request', async () => {
  await expect(getCycleDatesById('J27')).rejects.toThrow(/GUID/);
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});
