/**
 * getBoardSetupDatesByCode and the Board setup's calendar reader (D47): the
 * Board Meeting Date is the meeting's end date, the Board Mailing Date its
 * materials deadline. A failed read is `board_calendar_unavailable`, never a
 * guessed or blank date.
 */

const fetchWithTimeout = jest.fn();
const checkRestriction = jest.fn();
jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: (...a) => fetchWithTimeout(...a) }));
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { getAccessToken: jest.fn(async () => 'token'), buildHeaders: jest.fn(() => ({})), checkRestriction: (...a) => checkRestriction(...a) },
}));

const { getBoardSetupDatesByCode } = require('../../lib/dataverse/adapters/operations-grant-cycle');
const { cycleDates, cycleDatesOrError } = require('../../lib/services/board-writeups/calendar');

const ok = value => ({ ok: true, status: 200, json: async () => ({ value }) });

beforeEach(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  fetchWithTimeout.mockReset();
  checkRestriction.mockReset();
});

test('reads one exact-code row with both Board dates and the caller deadline', async () => {
  fetchWithTimeout.mockResolvedValue(ok([{ wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10T00:00:00Z', wmkf_boardmailingdate: '2027-05-27T00:00:00Z' }]));
  await expect(getBoardSetupDatesByCode('J27', { timeoutMs: 1234 })).resolves.toMatchObject({ wmkf_cyclecode: 'J27' });
  const [url, , timeoutMs] = fetchWithTimeout.mock.calls[0];
  expect(new URL(url).searchParams.get('$filter')).toBe("wmkf_cyclecode eq 'J27'");
  expect(decodeURIComponent(url)).toContain('wmkf_boardmailingdate');
  expect(timeoutMs).toBe(1234);
  expect(checkRestriction).toHaveBeenCalledWith('wmkf_grantcycle', 'wmkf_cyclecode,wmkf_meetingdate,wmkf_boardmailingdate');
});

test('no row is null; a failed read, a duplicate code or a bad code throws', async () => {
  fetchWithTimeout.mockResolvedValueOnce(ok([]));
  await expect(getBoardSetupDatesByCode('J27')).resolves.toBeNull();
  fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(getBoardSetupDatesByCode('J27')).rejects.toMatchObject({ status: 503 });
  fetchWithTimeout.mockResolvedValueOnce(ok([{ wmkf_cyclecode: 'J27' }, { wmkf_cyclecode: 'J27' }]));
  await expect(getBoardSetupDatesByCode('J27')).rejects.toThrow(/more than one/);
  await expect(getBoardSetupDatesByCode('June2027')).rejects.toThrow(/modern/);
});

test('cycleDates maps the calendar columns to the setup meanings as Pacific calendar days', async () => {
  const read = jest.fn(async () => ({ wmkf_meetingdate: '2026-12-10T00:00:00Z', wmkf_boardmailingdate: null }));
  await expect(cycleDates('D26', { read })).resolves.toEqual({ boardEnds: '2026-12-10', materialsDue: null });
  expect(read).toHaveBeenCalledWith('D26', { timeoutMs: expect.any(Number) });
  await expect(cycleDates('D26', { read: async () => null })).resolves.toEqual({ boardEnds: null, materialsDue: null });
});

test('a failed read is board_calendar_unavailable; the view helper reports it instead of "Not set"', async () => {
  const read = async () => { throw new Error('timeout'); };
  await expect(cycleDates('D26', { read })).rejects.toMatchObject({ code: 'board_calendar_unavailable', httpStatus: 503 });
  await expect(cycleDatesOrError('D26', { cycleDates: cycle => cycleDates(cycle, { read }) })).resolves.toEqual({ boardEnds: null, materialsDue: null, unavailable: true });
  await expect(cycleDates('nope', { read })).rejects.toMatchObject({ code: 'board_cycle_invalid' });
});

test('a read that never settles (token or body) expires as board_calendar_unavailable', async () => {
  const read = jest.fn(() => new Promise(() => {}));
  await expect(cycleDates('D26', { read, timeoutMs: 20 })).rejects.toMatchObject({ code: 'board_calendar_unavailable' });
  await expect(cycleDatesOrError('D26', { cycleDates: cycle => cycleDates(cycle, { read, timeoutMs: 20 }) })).resolves.toMatchObject({ unavailable: true });
});
