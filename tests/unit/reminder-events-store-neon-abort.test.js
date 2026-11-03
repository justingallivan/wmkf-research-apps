/**
 * Build check from docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md §2: the
 * installed Neon HTTP driver must pass the store's per-query abort signal to
 * its fetch, so the history deadline cancels the request instead of only
 * abandoning the wait. Uses the real driver with its fetch replaced.
 */

const { neonConfig } = require('@neondatabase/serverless');

const SUG = 'aaaaaaaa-1111-4111-8111-111111111111';
const REQ = 'cccccccc-3333-4333-8333-333333333333';

let originalFetchFunction;
let originalUrl;
beforeAll(() => {
  originalFetchFunction = neonConfig.fetchFunction;
  originalUrl = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = 'postgresql://user:password@example-pooler.neon.invalid/db';
});
afterAll(() => {
  neonConfig.fetchFunction = originalFetchFunction;
  if (originalUrl === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = originalUrl;
});

test('a stalled history insert aborts the real driver fetch at the deadline', async () => {
  jest.useFakeTimers();
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  let seenSignal = null;
  neonConfig.fetchFunction = (_url, init) => new Promise((_resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  });
  try {
    const { recordReminderEvent, REMINDER_HISTORY_TIMEOUT_MS } = require('../../lib/services/reviewer-engagement/reminder-events-store');
    const pending = recordReminderEvent({
      row: { wmkf_appreviewersuggestionid: SUG, _wmkf_request_value: REQ, wmkf_invited: true, wmkf_emailsentat: null },
      kind: 'respond',
      recordedAt: '2026-11-03T18:00:00.000Z',
    });
    for (let i = 0; i < 5 && !seenSignal; i += 1) await Promise.resolve();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal.aborted).toBe(false);
    jest.advanceTimersByTime(REMINDER_HISTORY_TIMEOUT_MS);
    expect(seenSignal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ written: false, reason: 'timeout' });
  } finally {
    warnSpy.mockRestore();
    jest.useRealTimers();
  }
});
