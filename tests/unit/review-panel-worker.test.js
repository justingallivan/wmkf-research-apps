/** @jest-environment node */
jest.mock('../../lib/services/review-panel-store');
jest.mock('../../lib/services/review-panel-generation', () => ({
  runSeat: jest.fn(),
  runChair: jest.fn(),
}));
jest.mock('../../lib/services/review-panel-rollout', () => ({
  assertReviewPanelWorkerOpen: jest.fn().mockResolvedValue(undefined),
}));

import * as store from '../../lib/services/review-panel-store';
import { runSeat, runChair } from '../../lib/services/review-panel-generation';
import { assertReviewPanelWorkerOpen } from '../../lib/services/review-panel-rollout';
import { drainReviewPanels, retryFailedEntries, describeEntryFailure } from '../../lib/services/review-panel-worker';

store.reviewPanelError = jest.fn((message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }));

const CONFIG = {
  seats: {
    'seat.claude': { seatKey: 'seat.claude', provider: 'anthropic', model: 'claude-fable-5-1', promptSnapshot: {} },
    'seat.openai': { seatKey: 'seat.openai', provider: 'openai', model: 'gpt-5.6-sol', promptSnapshot: {} },
  },
  chair: { seatKey: 'chair', provider: 'anthropic', model: 'claude-opus-5', promptSnapshot: {} },
};
const RUN = { id: 'run-1', lease_token: 'lease-1', locked_until: new Date(Date.now() + 280000).toISOString(), data: { config: CONFIG } };

let attempts;
let entryState;

function seatSetup({ openaiFails = false } = {}) {
  attempts = [];
  entryState = { id: 'entry-1', run_id: 'run-1', status: 'pending', data: { input: { requestId: 'r1', narrative: { text: 'n' } } }, winners_json: {} };

  store.createAttempt.mockImplementation(async ({ entryId, seatKey }) => {
    const attemptNo = attempts.filter((a) => a.seat_key === seatKey).length + 1;
    const attempt = { id: `${seatKey}-${attemptNo}`, entry_id: entryId, seat_key: seatKey, attempt_no: attemptNo, state: 'pending' };
    attempts.push(attempt);
    return attempt;
  });
  store.markAttemptDispatched.mockImplementation(async (id) => {
    const a = attempts.find((x) => x.id === id);
    a.state = 'dispatched';
    return a;
  });
  store.listAttemptsForEntry.mockImplementation(async () => attempts.slice());
  store.reapExpiredAttempts.mockResolvedValue([]);
  store.selectWinners.mockImplementation(async () => {
    for (const a of attempts) if (a.state === 'completed') entryState.winners_json[a.seat_key] = a.id;
    return entryState;
  });
  store.readReviewPanelEntry.mockImplementation(async () => entryState);
  store.mutateReviewPanelEntry.mockImplementation(async (id, fn) => { await fn(entryState); return entryState; });

  runSeat.mockImplementation(async (input, seatConfig, { attemptId }) => {
    const a = attempts.find((x) => x.id === attemptId);
    if (seatConfig.seatKey === 'seat.openai' && openaiFails) {
      a.state = 'failed';
      a.error_text = 'seat.openai boom';
      throw new Error('seat.openai boom');
    }
    a.state = 'completed';
    a.result_json = { priorWork: `from ${seatConfig.seatKey}` };
    return { outcome: 'finalized' };
  });
  runChair.mockImplementation(async (input, seatReviews, chairConfig, { attemptId }) => {
    const a = attempts.find((x) => x.id === attemptId);
    a.state = 'completed';
    a.result_json = { consensus: [] };
    return { outcome: 'finalized' };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  assertReviewPanelWorkerOpen.mockResolvedValue(undefined);
  store.claimReviewPanelRun.mockResolvedValue(RUN);
  store.releaseReviewPanelRun.mockResolvedValue(undefined);
  seatSetup();
});

test('happy path: both seats run, winners selected, chair runs once, entry completes', async () => {
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  const result = await drainReviewPanels();
  expect(result).toEqual({ claimed: 1, runId: 'run-1' });
  expect(runSeat).toHaveBeenCalledTimes(2);
  expect(runChair).toHaveBeenCalledTimes(1);
  expect(entryState.status).toBe('completed');
  expect(entryState.data.chairResult).toEqual({ consensus: [] });
});

test('an entry with one failed seat fails the entry and never reaches the chair', async () => {
  seatSetup({ openaiFails: true });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(runChair).not.toHaveBeenCalled();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.error).toEqual(expect.stringContaining('seat.openai'));
});

test('crash recovery: a stale dispatched attempt (worker died mid-call) is reaped and its seat re-attempted, not left stuck forever', async () => {
  // Simulate a prior crash: seat.claude already has a stale 'dispatched'
  // attempt from a worker that died mid-call — no 'completed'/'failed' ever
  // landed for it. Without reaping BEFORE computing seatsNeedingRun, this
  // seat would look "already in flight" forever and the entry would never
  // progress (store.reapExpiredAttempts is what actually converts it).
  attempts.push({ id: 'seat.claude-1', seat_key: 'seat.claude', attempt_no: 1, state: 'dispatched' });
  store.reapExpiredAttempts.mockImplementation(async () => {
    const stale = attempts.filter((a) => a.state === 'dispatched');
    for (const a of stale) a.state = 'unknown_outcome';
    return stale;
  });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(store.reapExpiredAttempts).toHaveBeenCalled();
  // seat.claude got a FRESH attempt (attempt_no 2) after its stale one was reaped.
  const claudeAttempts = attempts.filter((a) => a.seat_key === 'seat.claude');
  expect(claudeAttempts.some((a) => a.attempt_no === 2 && a.state === 'completed')).toBe(true);
  expect(entryState.status).toBe('completed');
});

test('the chair is never dispatched twice for one entry: a second drain pass with a completed chair attempt already present is a no-op', async () => {
  // First pass: seats run + winners selected + chair runs.
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(runChair).toHaveBeenCalledTimes(1);
  const chairAttemptCountAfterFirstPass = attempts.filter((a) => a.seat_key === 'chair').length;
  expect(chairAttemptCountAfterFirstPass).toBe(1);

  // Second pass over the SAME (now completed) entry must not create another chair attempt.
  entryState.status = 'pending'; // simulate the drain re-selecting a not-yet-terminal-status entry
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(runChair).toHaveBeenCalledTimes(1); // still 1 — guarded
  expect(attempts.filter((a) => a.seat_key === 'chair').length).toBe(1);
});

test('retryFailedEntries only re-arms entries whose seats/chair still lack a winner; a subsequent drain re-attempts only the seat that lacked a winner', async () => {
  seatSetup({ openaiFails: true });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(entryState.status).toBe('failed');
  expect(entryState.winners_json['seat.claude']).toBeTruthy();
  expect(entryState.winners_json['seat.openai']).toBeUndefined();

  await retryFailedEntries(RUN, ['entry-1']);
  expect(entryState.status).toBe('running');

  // Next drain pass: seat.claude already has a completed attempt (skipped); only seat.openai gets a new attempt.
  seatSetup.openaiFails = false;
  runSeat.mockImplementation(async (input, seatConfig, { attemptId }) => {
    const a = attempts.find((x) => x.id === attemptId);
    a.state = 'completed';
    a.result_json = { priorWork: `retry ${seatConfig.seatKey}` };
  });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(attempts.filter((a) => a.seat_key === 'seat.claude').length).toBe(1); // never re-attempted
  expect(attempts.filter((a) => a.seat_key === 'seat.openai').length).toBe(2); // exactly one retry attempt
  expect(entryState.status).toBe('completed');
});

test('operator stop set between seats: subsequent paid calls are skipped and the signal is aborted', async () => {
  let call = 0;
  assertReviewPanelWorkerOpen.mockImplementation(async () => {
    call += 1;
    if (call === 1) return undefined; // drainReviewPanels' own top-of-loop check
    if (call === 2) return undefined; // first seat's check
    const error = Object.assign(new Error('Review panel work is paused by the rollout operator.'), { interrupted: true });
    throw error; // second seat's check
  });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  const result = await drainReviewPanels();
  expect(result).toEqual({ claimed: 1, paused: true });
  expect(runSeat).toHaveBeenCalledTimes(1);
  expect(store.releaseReviewPanelRun).toHaveBeenCalled();
  const signalPassedToTheOneSeatThatRan = runSeat.mock.calls[0][2].signal;
  expect(signalPassedToTheOneSeatThatRan.aborted).toBe(true);
});

describe('describeEntryFailure', () => {
  test('names the failing seat/chair in plain language', () => {
    expect(describeEntryFailure({ message: 'x' }, 'seat.openai')).toContain('seat.openai');
    expect(describeEntryFailure({}, 'chair')).toContain('chair synthesis');
  });
});
