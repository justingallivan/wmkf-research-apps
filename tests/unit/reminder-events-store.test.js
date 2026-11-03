/**
 * reviewer_reminder_events store (docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md §2–§4).
 * The Neon HTTP client is replaced so each test controls what a query does and
 * can see the abort signal the store passes through `fetchOptions`.
 */

const mockQuery = jest.fn();
jest.mock('@neondatabase/serverless', () => ({
  neon: jest.fn(() => (...args) => mockQuery(...args)),
}));

const {
  REMINDER_HISTORY_TIMEOUT_MS,
  createReminderHistorySession,
  recordReminderEvent,
  readReminderHistory,
} = require('../../lib/services/reviewer-engagement/reminder-events-store');

const SUG = 'AAAAAAAA-1111-4111-8111-111111111111';
const SUG2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const REQ = 'CCCCCCCC-3333-4333-8333-333333333333';
const AT = '2026-11-03T18:04:05.678Z';

function invitedRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    wmkf_invited: true,
    wmkf_emailsentat: '2026-10-01T00:00:00Z',
    ...over,
  };
}

// A query that only ends when its abort signal fires, like a stalled fetch.
function stalledUntilAborted() {
  mockQuery.mockImplementation((_text, _params, opts) => new Promise((_resolve, reject) => {
    opts.fetchOptions.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  }));
}

let warnSpy;
beforeEach(() => {
  jest.useRealTimers();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([]);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('recordReminderEvent', () => {
  test('inserts one row with lower-case ids, the kind and the exact time, idempotently', async () => {
    const result = await recordReminderEvent({ row: invitedRow(), kind: 'review_due', recordedAt: AT });
    expect(result).toEqual({ written: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [text, params, opts] = mockQuery.mock.calls[0];
    expect(text).toMatch(/INSERT INTO reviewer_reminder_events/);
    expect(text).toMatch(/ON CONFLICT \(suggestion_id, kind, recorded_at\) DO NOTHING/);
    expect(params).toEqual([SUG.toLowerCase(), REQ.toLowerCase(), 'review_due', AT]);
    expect(opts.fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  test('writes nothing for a never-invited row (follow-up to a candidate, then Remove → Restore)', async () => {
    const result = await recordReminderEvent({
      row: invitedRow({ wmkf_invited: false, wmkf_emailsentat: null }),
      kind: 'review_due',
      recordedAt: AT,
    });
    expect(result).toEqual({ written: false, reason: 'not_invited' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('an invitation date alone counts as invited', async () => {
    const result = await recordReminderEvent({ row: invitedRow({ wmkf_invited: false }), kind: 'respond', recordedAt: AT });
    expect(result.written).toBe(true);
  });

  test('a row without the invitation fields is refused without throwing', async () => {
    const { wmkf_invited: _i, wmkf_emailsentat: _e, ...bare } = invitedRow();
    const result = await recordReminderEvent({ row: bare, kind: 'respond', recordedAt: AT });
    expect(result).toEqual({ written: false, reason: 'error' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each([
    ['unknown kind', { kind: 'thankyou' }, 'invalid_kind'],
    ['bad suggestion id', { row: invitedRow({ wmkf_appreviewersuggestionid: 'nope' }) }, 'invalid_row'],
    ['bad time', { recordedAt: 'not a date' }, 'invalid_time'],
  ])('%s → no query', async (_label, over, reason) => {
    const result = await recordReminderEvent({ row: invitedRow(), kind: 'respond', recordedAt: AT, ...over });
    expect(result).toEqual({ written: false, reason });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a database error resolves (never throws) and trips the session breaker', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const session = createReminderHistorySession();
    const first = await recordReminderEvent({ row: invitedRow(), kind: 'respond', recordedAt: AT, session });
    expect(first).toEqual({ written: false, reason: 'error' });
    expect(session.tripped).toBe(true);
    const second = await recordReminderEvent({ row: invitedRow({ wmkf_appreviewersuggestionid: SUG2 }), kind: 'respond', recordedAt: AT, session });
    expect(second).toEqual({ written: false, reason: 'skipped' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(session.skipped).toBe(1);
  });

  test('a stalled insert is cancelled at the deadline: the signal aborts and the call resolves as timeout', async () => {
    jest.useFakeTimers();
    stalledUntilAborted();
    const session = createReminderHistorySession();
    const pending = recordReminderEvent({ row: invitedRow(), kind: 'review_due', recordedAt: AT, session });
    await Promise.resolve();
    const signal = mockQuery.mock.calls[0][2].fetchOptions.signal;
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(REMINDER_HISTORY_TIMEOUT_MS);
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ written: false, reason: 'timeout' });
    expect(session).toMatchObject({ tripped: true, failure: 'timeout' });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('the deadline timer is cleared when the query settles', async () => {
    jest.useFakeTimers();
    await recordReminderEvent({ row: invitedRow(), kind: 'respond', recordedAt: AT });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('separate sessions do not share a tripped breaker', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    await recordReminderEvent({ row: invitedRow(), kind: 'respond', recordedAt: AT, session: createReminderHistorySession() });
    const result = await recordReminderEvent({ row: invitedRow(), kind: 'respond', recordedAt: AT, session: createReminderHistorySession() });
    expect(result).toEqual({ written: true });
  });
});

describe('readReminderHistory', () => {
  test('groups rows by lower-case suggestion id in the returned order and skips unknown kinds', async () => {
    mockQuery.mockResolvedValueOnce([
      { suggestion_id: SUG.toLowerCase(), kind: 'review_due', recorded_at: new Date('2026-11-02T10:00:00Z') },
      { suggestion_id: SUG.toLowerCase(), kind: 'respond', recorded_at: new Date('2026-10-20T10:00:00Z') },
      { suggestion_id: SUG2, kind: 'mystery', recorded_at: new Date('2026-10-20T10:00:00Z') },
    ]);
    const byId = await readReminderHistory([SUG, SUG2, SUG, 'not-a-guid']);
    const [text, params] = mockQuery.mock.calls[0];
    expect(text).toMatch(/WHERE suggestion_id = ANY\(\$1::uuid\[\]\)/);
    expect(params).toEqual([[SUG.toLowerCase(), SUG2]]);
    expect(byId.get(SUG.toLowerCase())).toEqual([
      { kind: 'review_due', recordedAt: '2026-11-02T10:00:00.000Z' },
      { kind: 'respond', recordedAt: '2026-10-20T10:00:00.000Z' },
    ]);
    expect(byId.has(SUG2)).toBe(false);
  });

  test('no ids → empty map without a query', async () => {
    const byId = await readReminderHistory([]);
    expect(byId).toEqual(new Map());
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a failed read returns null', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation "reviewer_reminder_events" does not exist'));
    await expect(readReminderHistory([SUG])).resolves.toBeNull();
  });

  test('a stalled read is cancelled at the deadline and returns null', async () => {
    jest.useFakeTimers();
    stalledUntilAborted();
    const pending = readReminderHistory([SUG]);
    await Promise.resolve();
    jest.advanceTimersByTime(REMINDER_HISTORY_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(mockQuery.mock.calls[0][2].fetchOptions.signal.aborted).toBe(true);
  });
});
