/** @jest-environment node */
jest.mock('../../lib/services/review-panel-store');
jest.mock('../../lib/services/review-panel-generation', () => ({
  runSeat: jest.fn(),
  runChair: jest.fn(),
}));
jest.mock('../../lib/services/review-panel-rollout', () => ({
  assertReviewPanelWorkerOpen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/services/review-panel-documents', () => ({
  renderReviewPanelEntryDocuments: jest.fn().mockResolvedValue({ docx: Buffer.from('docx'), pdf: Buffer.from('pdf'), docxSha256: 'docx-sha', pdfSha256: 'pdf-sha' }),
}));
jest.mock('../../lib/services/review-panel-storage', () => ({
  storeReviewPanelFile: jest.fn().mockResolvedValue({ pathname: 'review-panel/fixture', sha256: 'a'.repeat(64), size: 4 }),
}));

import * as store from '../../lib/services/review-panel-store';
import { runSeat, runChair } from '../../lib/services/review-panel-generation';
import { assertReviewPanelWorkerOpen } from '../../lib/services/review-panel-rollout';
import { renderReviewPanelEntryDocuments } from '../../lib/services/review-panel-documents';
import { storeReviewPanelFile } from '../../lib/services/review-panel-storage';
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
  store.listRetryRequestedEntries.mockResolvedValue([]);
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
  expect(entryState.data.files).toEqual({
    docx: { pathname: 'review-panel/fixture', sha256: 'a'.repeat(64), size: 4 },
    pdf: { pathname: 'review-panel/fixture', sha256: 'a'.repeat(64), size: 4 },
  });
  expect(storeReviewPanelFile).toHaveBeenCalledTimes(2);
});

test('the per-entry report cost is scoped to THIS entry (sumEntryAttemptCosts), never a run-wide sum — sibling entries in the same run must not affect this report\'s cost line', async () => {
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(store.sumEntryAttemptCosts).toHaveBeenCalledWith('entry-1');
  expect(store.sumAttemptCosts).not.toHaveBeenCalled();
});

test('when the report cannot be saved (e.g. the D11 Blob store is not yet provisioned), the entry is FAILED rather than silently completed with no report; the chair result is preserved for visibility', async () => {
  storeReviewPanelFile.mockRejectedValueOnce(Object.assign(new Error('The private review panel document store has not been configured.'), { httpStatus: 503 }));
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.chairResult).toEqual({ consensus: [] });
  expect(entryState.data.error).toMatch(/report could not be saved/i);
  expect(entryState.data.files).toBeUndefined();
});

test('an entry with one failed seat fails the entry and never reaches the chair', async () => {
  seatSetup({ openaiFails: true });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(runChair).not.toHaveBeenCalled();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.error).toEqual(expect.stringContaining('seat.openai'));
});

test('crash recovery: a stale dispatched attempt (worker died mid-call) is reaped to unknown_outcome and the entry fails visibly — it is NEVER auto-retried with a fresh paid call', async () => {
  // Simulate a prior crash: seat.claude already has a stale 'dispatched'
  // attempt from a worker that died mid-call — no 'completed'/'failed' ever
  // landed for it. reapExpiredAttempts converts it to 'unknown_outcome'
  // (an ambiguous paid call); the worker must fail the entry outright
  // rather than silently spending another paid call on the same seat.
  attempts.push({ id: 'seat.claude-1', seat_key: 'seat.claude', attempt_no: 1, state: 'dispatched' });
  store.reapExpiredAttempts.mockImplementation(async () => {
    const stale = attempts.filter((a) => a.state === 'dispatched');
    for (const a of stale) a.state = 'unknown_outcome';
    return stale;
  });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(store.reapExpiredAttempts).toHaveBeenCalled();
  // No fresh attempt was ever created for seat.claude, and no seat ran at all.
  expect(attempts.filter((a) => a.seat_key === 'seat.claude').length).toBe(1);
  expect(runSeat).not.toHaveBeenCalled();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.error).toEqual(expect.stringContaining('reserved'));
});

test('a lost chair attempt (unknown_outcome) fails the entry outright and is never auto-retried', async () => {
  // Both seats already won; the chair's own prior attempt was reaped to
  // unknown_outcome (worker crashed mid-call) before this pass began.
  store.selectWinners.mockImplementation(async () => {
    for (const a of attempts) if (a.state === 'completed') entryState.winners_json[a.seat_key] = a.id;
    return entryState;
  });
  attempts.push({ id: 'seat.claude-1', seat_key: 'seat.claude', attempt_no: 1, state: 'completed', result_json: {} });
  attempts.push({ id: 'seat.openai-1', seat_key: 'seat.openai', attempt_no: 1, state: 'completed', result_json: {} });
  entryState.winners_json = { 'seat.claude': 'seat.claude-1', 'seat.openai': 'seat.openai-1' };
  attempts.push({ id: 'chair-1', seat_key: 'chair', attempt_no: 1, state: 'unknown_outcome' });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(runChair).not.toHaveBeenCalled();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.error).toEqual(expect.stringContaining('reserved'));
  expect(attempts.filter((a) => a.seat_key === 'chair').length).toBe(1); // no fresh chair attempt was minted
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

test('drainReviewPanels consumes retry_requested_at entries under its lease: retryFailedEntries runs and the marker clears via mutateReviewPanelEntry, so a second drain before completion never mints duplicate attempts', async () => {
  seatSetup({ openaiFails: true });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(entryState.status).toBe('failed');
  expect(entryState.winners_json['seat.openai']).toBeUndefined();

  // The route (requestReviewPanelRetry) would have set this on the entry row;
  // the worker mock surfaces it via listRetryRequestedEntries.
  store.listRetryRequestedEntries.mockResolvedValue(['entry-1']);
  runSeat.mockImplementation(async (input, seatConfig, { attemptId }) => {
    const a = attempts.find((x) => x.id === attemptId);
    a.state = 'completed';
    a.result_json = { priorWork: `retry ${seatConfig.seatKey}` };
  });
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(entryState.status).toBe('completed');
  expect(attempts.filter((a) => a.seat_key === 'seat.openai').length).toBe(2); // exactly one fresh attempt from the retry

  // A second POST worth of drain (marker already cleared by mutateReviewPanelEntry
  // inside retryFailedEntries) must not mint another attempt for either seat.
  store.listRetryRequestedEntries.mockResolvedValue([]);
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(attempts.filter((a) => a.seat_key === 'seat.claude').length).toBe(1);
  expect(attempts.filter((a) => a.seat_key === 'seat.openai').length).toBe(2);
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

describe('materializePendingEntries (via drainReviewPanels)', () => {
  test('creates a real entry for each request parked in run.data.pendingEntries by the launch route, then clears the list', async () => {
    const runWithPending = { ...RUN, data: { ...RUN.data, pendingEntries: [{ requestId: 'req-1', input: { requestId: 'req-1', narrative: { text: 'n' } }, requestNumber: 'R-1' }] }, owner_profile_id: 42 };
    store.claimReviewPanelRun.mockResolvedValue(runWithPending);
    store.listReviewPanelEntries.mockResolvedValueOnce([]); // materialization check: nothing exists yet
    store.createReviewPanelEntry.mockResolvedValue({ id: 'entry-1', run_id: 'run-1', request_id: 'req-1', status: 'pending', data: {}, winners_json: {} });
    store.mutateReviewPanelRun.mockResolvedValue(runWithPending);
    store.listReviewPanelEntries.mockResolvedValueOnce([]); // the drain's own pending/running scan after materialization: nothing to process this pass in this test
    store.listReviewPanelEntries.mockResolvedValueOnce([]); // finalizeRunStatusIfSettled's read

    await drainReviewPanels();

    expect(store.createReviewPanelEntry).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', requestId: 'req-1', leaseToken: 'lease-1', createdBy: 42,
      data: { input: { requestId: 'req-1', narrative: { text: 'n' } }, requestNumber: 'R-1' },
    }));
    const clearCall = store.mutateReviewPanelRun.mock.calls.find(([id]) => id === 'run-1');
    expect(clearCall).toBeTruthy();
    const row = { data: { pendingEntries: [{ requestId: 'req-1' }] } };
    clearCall[1](row);
    expect(row.data.pendingEntries).toEqual([]);
  });

  test('never re-creates an entry for a requestId that already has one — a crash between create and clear is safe on the next pass', async () => {
    const runWithPending = { ...RUN, data: { ...RUN.data, pendingEntries: [{ requestId: 'req-1', input: {}, requestNumber: 'R-1' }] }, owner_profile_id: 42 };
    store.claimReviewPanelRun.mockResolvedValue(runWithPending);
    store.listReviewPanelEntries.mockResolvedValue([{ id: 'entry-1', run_id: 'run-1', request_id: 'req-1', status: 'completed' }]);

    await drainReviewPanels();

    expect(store.createReviewPanelEntry).not.toHaveBeenCalled();
  });
});

describe('finalizeRunStatusIfSettled (via drainReviewPanels)', () => {
  test('writes the run status to completed once every entry has completed', async () => {
    store.listReviewPanelEntries.mockResolvedValue([entryState]); // entryState.status is 'completed' after seatSetup's happy path
    await drainReviewPanels();
    const statusCall = store.mutateReviewPanelRun.mock.calls.find(([id]) => id === 'run-1');
    expect(statusCall).toBeTruthy();
    const row = { status: 'running' };
    statusCall[1](row);
    expect(row.status).toBe('completed');
  });

  test('never writes a run status while any entry is still in flight (both seats already dispatched, neither settled)', async () => {
    attempts = [
      { id: 'seat.claude-1', entry_id: 'entry-1', seat_key: 'seat.claude', attempt_no: 1, state: 'dispatched' },
      { id: 'seat.openai-1', entry_id: 'entry-1', seat_key: 'seat.openai', attempt_no: 1, state: 'dispatched' },
    ];
    entryState.status = 'running';
    entryState.winners_json = {};
    store.listAttemptsForEntry.mockImplementation(async () => attempts.slice());
    store.reapExpiredAttempts.mockResolvedValue([]);
    store.selectWinners.mockImplementation(async () => entryState); // no completed attempts yet, so no winners recorded
    store.readReviewPanelEntry.mockImplementation(async () => entryState);
    store.listReviewPanelEntries.mockResolvedValue([entryState]);
    store.mutateReviewPanelRun.mockClear();

    await drainReviewPanels();

    expect(entryState.status).toBe('running'); // processEntry returned early: not every seat has a winner yet
    expect(store.mutateReviewPanelRun).not.toHaveBeenCalled();
  });
});

describe('describeEntryFailure', () => {
  test('names the failing seat/chair in plain language', () => {
    expect(describeEntryFailure({ message: 'x' }, 'seat.openai')).toContain('seat.openai');
    expect(describeEntryFailure({}, 'chair')).toContain('chair synthesis');
  });
});
