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
  assertReviewPanelStorageConfigured: jest.fn(),
}));

import * as store from '../../lib/services/review-panel-store';
import { runSeat, runChair } from '../../lib/services/review-panel-generation';
import { assertReviewPanelWorkerOpen } from '../../lib/services/review-panel-rollout';
import { renderReviewPanelEntryDocuments } from '../../lib/services/review-panel-documents';
import { storeReviewPanelFile, assertReviewPanelStorageConfigured } from '../../lib/services/review-panel-storage';
import { drainReviewPanels, retryFailedEntries, rerenderCompletedEntries, describeEntryFailure } from '../../lib/services/review-panel-worker';

store.reviewPanelError = jest.fn((message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }));

const CONFIG = {
  seats: {
    'seat.claude': { seatKey: 'seat.claude', provider: 'anthropic', model: 'claude-fable-5-1', promptSnapshot: {} },
    'seat.openai': { seatKey: 'seat.openai', provider: 'openai', model: 'gpt-5.6-sol', promptSnapshot: {} },
  },
  chair: { seatKey: 'chair', provider: 'anthropic', model: 'claude-opus-5', promptSnapshot: {} },
  projectedQuestionSet: [{ key: 'priorWork', label: 'Prior work', type: 'richtext', order: 1 }],
};
const RUN = { id: 'run-1', owner_profile_id: 42, lease_token: 'lease-1', locked_until: new Date(Date.now() + 280000).toISOString(), data: { config: CONFIG } };

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
  store.assertReviewPanelActor.mockResolvedValue({ profileId: RUN.owner_profile_id });
  store.stopRevokedReviewPanelRun.mockResolvedValue(undefined);
  assertReviewPanelStorageConfigured.mockImplementation(() => {});
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
    docx: { pathname: 'review-panel/fixture', sha256: 'a'.repeat(64), size: 4, savedAt: expect.any(String) },
    pdf: { pathname: 'review-panel/fixture', sha256: 'a'.repeat(64), size: 4, savedAt: expect.any(String) },
  });
  expect(storeReviewPanelFile).toHaveBeenCalledTimes(2);
  // The chair completes and is awaited within THIS same pass (no prior pass
  // ever saw it as already-completed), so nothing else calls selectWinners
  // after the chair finishes except the fix below — assert the winner is
  // actually recorded, not just that the entry completed.
  expect(entryState.winners_json.chair).toBe('chair-1');
});

test('normal (non-retried) completion records winners_json.chair before completing the entry — production defect 2026-09-13: only entries whose chair happened to already be completed on a PRIOR pass ever got this via the earlier selectWinners call; a chair dispatched and completed inline within the SAME pass never did, so requestReviewPanelRerender could not find the entry eligible', async () => {
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  const selectWinnersCallsWhenChairCompleted = [];
  const originalSelectWinners = store.selectWinners.getMockImplementation();
  store.selectWinners.mockImplementation(async (...args) => {
    const chairAttempt = attempts.find((a) => a.seat_key === 'chair');
    if (chairAttempt?.state === 'completed') selectWinnersCallsWhenChairCompleted.push(chairAttempt.id);
    return originalSelectWinners(...args);
  });
  await drainReviewPanels();
  expect(entryState.status).toBe('completed');
  expect(entryState.winners_json.chair).toBe('chair-1');
  // selectWinners must have been called AT LEAST once while the chair
  // attempt was already 'completed' — i.e. after runChair resolved, not only
  // the two calls earlier in processEntry (before the chair attempt exists).
  expect(selectWinnersCallsWhenChairCompleted.length).toBeGreaterThan(0);
});

test('the report passed to renderReviewPanelEntryDocuments carries the pinned question set and seat display labels, so the document renderer never falls back to raw JSON keys', async () => {
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  const [report] = renderReviewPanelEntryDocuments.mock.calls[0];
  expect(report.questions).toEqual(CONFIG.projectedQuestionSet);
  expect(report.seatLabels).toEqual({ 'seat.claude': 'Claude reviewer', 'seat.openai': 'OpenAI reviewer' });
});

test('the per-entry report cost is scoped to THIS entry (sumEntryAttemptCosts), never a run-wide sum — sibling entries in the same run must not affect this report\'s cost line', async () => {
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(store.sumEntryAttemptCosts).toHaveBeenCalledWith('entry-1');
  expect(store.sumAttemptCosts).not.toHaveBeenCalled();
});

test('a format already saved on the entry (e.g. a prior pass\'s docx succeeded, pdf then failed) is never re-rendered or re-uploaded — only the missing format is', async () => {
  const existingDocxRef = { pathname: 'review-panel/entry-1/report.docx', sha256: 'b'.repeat(64), size: 9 };
  entryState.data = { ...entryState.data, files: { docx: existingDocxRef } };
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(renderReviewPanelEntryDocuments).toHaveBeenCalledWith(expect.anything(), { formats: ['pdf'] });
  expect(storeReviewPanelFile).toHaveBeenCalledTimes(1);
  expect(storeReviewPanelFile).toHaveBeenCalledWith('review-panel/entry-1/report.pdf', expect.anything(), 'application/pdf');
  expect(storeReviewPanelFile).not.toHaveBeenCalledWith(expect.stringContaining('.docx'), expect.anything(), expect.anything());
  expect(entryState.data.files.docx).toBe(existingDocxRef); // untouched
  expect(entryState.status).toBe('completed');
});

test('when both editions are already saved (a stale re-entry), the entry is settled to completed without touching storage at all', async () => {
  const files = {
    docx: { pathname: 'review-panel/entry-1/report.docx', sha256: 'b'.repeat(64), size: 9 },
    pdf: { pathname: 'review-panel/entry-1/report.pdf', sha256: 'c'.repeat(64), size: 7 },
  };
  entryState.data = { ...entryState.data, files };
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(renderReviewPanelEntryDocuments).not.toHaveBeenCalled();
  expect(storeReviewPanelFile).not.toHaveBeenCalled();
  expect(entryState.status).toBe('completed');
  expect(entryState.data.files).toEqual(files);
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

test('a report render throw stores a bounded reportError detail and the user-facing copy includes the message', async () => {
  renderReviewPanelEntryDocuments.mockRejectedValueOnce(new Error('WinAnsi cannot encode "→" (0x2192)'));
  store.listReviewPanelEntries.mockResolvedValue([entryState]);
  await drainReviewPanels();
  expect(entryState.status).toBe('failed');
  expect(entryState.data.reportError).toEqual({
    name: 'Error',
    message: 'WinAnsi cannot encode "→" (0x2192)',
    at: expect.any(String),
  });
  expect(entryState.data.error).toContain('WinAnsi cannot encode "→" (0x2192)');
  expect(entryState.data.error).toMatch(/report could not be saved/i);
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

test('retryFailedEntries clears retry_requested_at (via mutateReviewPanelEntry) for an entry that is no longer failed, instead of leaving a stale marker forever', async () => {
  entryState.status = 'completed'; // moved on since the route queued the retry request
  store.mutateReviewPanelEntry.mockClear();
  await retryFailedEntries(RUN, ['entry-1']);
  expect(store.mutateReviewPanelEntry).toHaveBeenCalledWith('entry-1', expect.any(Function), 'lease-1');
  expect(store.createAttempt).not.toHaveBeenCalled();
  expect(entryState.status).toBe('completed'); // untouched by the no-op mutation
});

describe('rerenderCompletedEntries (via drainReviewPanels) — re-render makes NO model calls', () => {
  function setUpCompletedEntryForRerender() {
    attempts.push(
      { id: 'seat.claude-1', entry_id: 'entry-1', seat_key: 'seat.claude', attempt_no: 1, state: 'completed', result_json: { priorWork: 'a' } },
      { id: 'seat.openai-1', entry_id: 'entry-1', seat_key: 'seat.openai', attempt_no: 1, state: 'completed', result_json: { priorWork: 'b' } },
      { id: 'chair-1', entry_id: 'entry-1', seat_key: 'chair', attempt_no: 1, state: 'completed', result_json: { consensus: [] } },
    );
    entryState.status = 'completed';
    entryState.winners_json = { 'seat.claude': 'seat.claude-1', 'seat.openai': 'seat.openai-1', chair: 'chair-1' };
    const previousFiles = { docx: { pathname: 'review-panel/entry-1/report.docx' }, pdf: { pathname: 'review-panel/entry-1/report.pdf' } };
    entryState.data = { ...entryState.data, files: previousFiles, rerender: { requestedAt: '2026-09-13T00:00:00.000Z', requestedBy: 7 } };
    store.listRetryRequestedEntries.mockResolvedValue(['entry-1']);
    store.listReviewPanelEntries.mockResolvedValue([entryState]);
    return previousFiles;
  }

  test('data.files (the current pair) stays completely untouched throughout render/upload — downloads keep resolving to it — and is only swapped in atomically on full success, with the superseded pair appended (never overwritten) to rerenderHistory', async () => {
    seatSetup();
    const previousFiles = setUpCompletedEntryForRerender();
    entryState.data.error = 'stale from a prior failed re-render'; // must never survive a SUCCESSFUL re-render
    entryState.data.reportError = { name: 'Error', message: 'stale', at: '2026-09-13T00:00:00.000Z' };

    let filesDuringRender;
    storeReviewPanelFile
      .mockImplementationOnce(async (pathname) => { filesDuringRender = entryState.data.files; return { pathname, sha256: 'a'.repeat(64), size: 4 }; })
      .mockImplementationOnce(async (pathname) => ({ pathname, sha256: 'a'.repeat(64), size: 4 }));

    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, runId: 'run-1' });
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(runSeat).not.toHaveBeenCalled();
    expect(runChair).not.toHaveBeenCalled();

    // Snapshot taken mid-render (inside the first storeReviewPanelFile call):
    // still the OLD pair — nothing was swapped in until BOTH formats landed.
    expect(filesDuringRender).toEqual(previousFiles);

    expect(entryState.status).toBe('completed');
    expect(entryState.data.rerender).toBeUndefined();
    expect(entryState.data.error).toBeNull();
    expect(entryState.data.reportError).toBeNull();

    expect(storeReviewPanelFile).toHaveBeenCalledTimes(2);
    const pathnames = storeReviewPanelFile.mock.calls.map((c) => c[0]);
    expect(pathnames.every((p) => /^review-panel\/entry-1\/report-.+\.(docx|pdf)$/.test(p))).toBe(true);
    expect(pathnames).not.toContain('review-panel/entry-1/report.docx');
    expect(pathnames).not.toContain('review-panel/entry-1/report.pdf');

    expect(entryState.data.files.docx.pathname).not.toBe(previousFiles.docx.pathname);
    expect(entryState.data.files.docx.savedAt).toEqual(expect.any(String));
    expect(entryState.data.files.pdf.savedAt).toEqual(expect.any(String));
    expect(entryState.data.rerenderHistory).toEqual([{ replacedAt: expect.any(String), files: previousFiles }]);
  });

  test('backfills winners_json.chair for a legacy entry (completed before the normal-completion fix, so winners_json never got chair) — the completed chair attempt alone makes it eligible, and selectWinners records it before the chair lookup', async () => {
    seatSetup();
    const previousFiles = setUpCompletedEntryForRerender();
    // Simulate a legacy entry: completed via the OLD normal-completion path,
    // so winners_json lacks chair even though a completed chair attempt
    // exists (the same shape requestReviewPanelRerender's eligibility check
    // now accepts).
    entryState.winners_json = { 'seat.claude': 'seat.claude-1', 'seat.openai': 'seat.openai-1' };

    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, runId: 'run-1' });
    expect(runChair).not.toHaveBeenCalled(); // still no model calls
    expect(renderReviewPanelEntryDocuments).toHaveBeenCalled(); // the render actually ran — not the "unreachable" clear-and-skip branch
    expect(entryState.winners_json.chair).toBe('chair-1'); // backfilled
    expect(entryState.status).toBe('completed');
    expect(entryState.data.rerender).toBeUndefined();
    expect(entryState.data.files.docx.pathname).not.toBe(previousFiles.docx.pathname);
  });

  test('a mixed-pair upload (docx lands, pdf fails) never goes live: data.files stays the PREVIOUS pair, never left failed, and the orphaned new docx ref is recorded (never silently lost) without becoming live', async () => {
    seatSetup();
    const previousFiles = setUpCompletedEntryForRerender();

    const newDocxRef = { pathname: 'review-panel/entry-1/report-stamp123.docx', sha256: 'b'.repeat(64), size: 5 };
    storeReviewPanelFile
      .mockResolvedValueOnce(newDocxRef)
      .mockRejectedValueOnce(new Error('pdf upload boom'));

    await drainReviewPanels();
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(runSeat).not.toHaveBeenCalled();
    expect(runChair).not.toHaveBeenCalled();
    expect(entryState.status).toBe('completed'); // never left `failed` — the old pair is still live
    expect(entryState.data.files).toEqual(previousFiles); // untouched: no partial pair ever goes live
    expect(entryState.data.error).toMatch(/re-rendered report could not be saved/i);
    expect(entryState.data.reportError.orphanedFiles.docx.pathname).toBe(newDocxRef.pathname);
    expect(entryState.data.reportError.orphanedFiles.pdf).toBeUndefined();
    expect(entryState.data.rerender).toBeUndefined();
    expect(entryState.data.rerenderHistory).toBeUndefined(); // no swap ever happened
  });

  test('a lease-expiry (409) on the rollback write itself is safe: data.files was never touched by the rerender path, so the previous pair is still the persisted, live pair', async () => {
    seatSetup();
    const previousFiles = setUpCompletedEntryForRerender();
    storeReviewPanelFile.mockRejectedValueOnce(Object.assign(new Error('The private review panel document store has not been configured.'), { httpStatus: 503 }));
    // The marker-clear mutate (the first mutateReviewPanelEntry call inside
    // rerenderCompletedEntries) must still succeed — only the ROLLBACK write
    // after the render failure hits the expired lease.
    let mutateCalls = 0;
    store.mutateReviewPanelEntry.mockImplementation(async (id, fn) => {
      mutateCalls += 1;
      if (mutateCalls === 2) throw Object.assign(new Error('Worker lease expired.'), { httpStatus: 409 });
      await fn(entryState);
      return entryState;
    });

    await drainReviewPanels();
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(runSeat).not.toHaveBeenCalled();
    expect(runChair).not.toHaveBeenCalled();
    // data.files was never written by this code path at all (only ever
    // read), so it is still the previous pair regardless of the rollback
    // write's own failure.
    expect(entryState.data.files).toEqual(previousFiles);
  });

  test('an entry whose marker no longer matches (moved on before this pass consumed it) just gets the marker cleared, without creating any attempt', async () => {
    seatSetup();
    entryState.status = 'failed'; // moved on since the route queued the re-render request
    entryState.data = { ...entryState.data, rerender: undefined };
    store.mutateReviewPanelEntry.mockClear();
    await rerenderCompletedEntries(RUN, CONFIG, ['entry-1']);
    expect(store.mutateReviewPanelEntry).toHaveBeenCalledWith('entry-1', expect.any(Function), 'lease-1');
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(runSeat).not.toHaveBeenCalled();
    expect(runChair).not.toHaveBeenCalled();
  });
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
  test('names the failing seat/chair by its display label, never the raw seat key', () => {
    expect(describeEntryFailure({ message: 'x' }, 'seat.openai')).toContain('OpenAI reviewer');
    expect(describeEntryFailure({ message: 'x' }, 'seat.openai')).not.toContain('seat.openai');
    expect(describeEntryFailure({ message: 'x' }, 'seat.claude')).toContain('Claude reviewer');
    expect(describeEntryFailure({}, 'chair')).toContain('Chair');
  });

  test('starts with a capital letter', () => {
    expect(describeEntryFailure({ message: 'x' }, 'seat.openai')[0]).toBe(describeEntryFailure({ message: 'x' }, 'seat.openai')[0].toUpperCase());
  });

  test('an Executor refusal is mapped to plain "declined to review" copy, naming the seat that refused', () => {
    const message = describeEntryFailure({ message: 'Claude refused the request; no output was persisted' }, 'seat.claude');
    expect(message).toBe('The Claude reviewer declined to review this proposal (the model returned a refusal); no review was produced.');
  });

  test('a refusal is recognized from the persisted error_text alone (no error.code available), matching failEntryForProblem\'s call shape', () => {
    // failEntryForProblem only ever passes { message: attempt.error_text } — never a `code` — so the
    // refusal mapping must key off the message text, not error.code, or a refusal falls through to the
    // generic fallback (the bug this fix addresses).
    expect(describeEntryFailure({ message: 'Claude refused the request; no output was persisted' }, 'seat.openai')).toContain('declined to review this proposal');
  });

  test('an executor deadline/timeout error is mapped to plain "time budget" copy', () => {
    expect(describeEntryFailure({ code: 'executor_deadline_exhausted' }, 'chair')).toBe("The Chair did not finish within the time budget.");
    expect(describeEntryFailure({ message: 'timeout after 30000ms' }, 'seat.openai')).toBe('The OpenAI reviewer did not finish within the time budget.');
  });

  test('an abort is mapped to plain "time budget" copy', () => {
    expect(describeEntryFailure({ name: 'AbortError', message: 'aborted' }, 'seat.claude')).toBe('The Claude reviewer did not finish within the time budget.');
  });

  test('anything else falls back to a generic message carrying an excerpt of the underlying error, plus the retry sentence', () => {
    const message = describeEntryFailure({ message: 'some odd provider-specific failure' }, 'seat.claude');
    expect(message).toBe('The Claude reviewer hit an unexpected problem: some odd provider-specific failure. Saved work is kept; Retry failed entries re-runs only the seats and chair that did not complete.');
  });

  test('a message with no text (e.g. failEntryForProblem\'s chair-with-no-attempt fallback) never produces an empty ": ." excerpt', () => {
    expect(describeEntryFailure({}, 'chair')).toBe('The Chair hit an unexpected problem. Saved work is kept; Retry failed entries re-runs only the seats and chair that did not complete.');
  });

  test('a message that already ends in a period never doubles up the punctuation', () => {
    const message = describeEntryFailure({ message: 'The AI service was busy (HTTP 529) for the OpenAI reviewer.' }, 'seat.openai');
    expect(message).toBe('The OpenAI reviewer hit an unexpected problem: The AI service was busy (HTTP 529) for the OpenAI reviewer. Saved work is kept; Retry failed entries re-runs only the seats and chair that did not complete.');
  });
});

describe('the run owner is re-asserted at claim time and again immediately before every paid dispatch', () => {
  test('owner demoted between claim and dispatch: runSeat is never called, and the run is marked failed with plain copy — no dispatch happens', async () => {
    store.assertReviewPanelActor.mockRejectedValue(Object.assign(new Error('An active superuser profile is required.'), { httpStatus: 403 }));
    store.listReviewPanelEntries.mockResolvedValue([entryState]);
    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, ownerRevoked: true });
    expect(runSeat).not.toHaveBeenCalled();
    expect(runChair).not.toHaveBeenCalled();
    expect(store.stopRevokedReviewPanelRun).toHaveBeenCalledWith('run-1', 'lease-1', expect.stringMatching(/no longer has superuser access/i));
    expect(store.releaseReviewPanelRun).toHaveBeenCalled(); // still released, unconditionally, in `finally`
  });

  test('owner still valid at claim but demoted before the first seat dispatch: runSeat is never called for that seat, the run fails', async () => {
    let calls = 0;
    store.assertReviewPanelActor.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { profileId: RUN.owner_profile_id }; // the claim-time check passes
      throw Object.assign(new Error('An active superuser profile is required.'), { httpStatus: 403 }); // dispatch-time check fails
    });
    store.listReviewPanelEntries.mockResolvedValue([entryState]);
    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, ownerRevoked: true });
    expect(runSeat).not.toHaveBeenCalled();
    expect(store.createAttempt).not.toHaveBeenCalled(); // no attempt minted once the owner check fails
    expect(store.stopRevokedReviewPanelRun).toHaveBeenCalled();
  });

  test('three entries in flight, 403 on the first: no dispatched attempt remains, no running entry remains, run fails, lease released', async () => {
    // A single-seat config keeps each entry's runOneSeat call count to exactly
    // one, so the three entries' assertReviewPanelActor calls land in a
    // predictable order after the claim-time call: A (rejects), then B, C
    // (both still succeed — the owner check is per-call, not sticky).
    const SINGLE_SEAT_CONFIG = { seats: { 'seat.claude': CONFIG.seats['seat.claude'] }, chair: CONFIG.chair };
    const run3 = { ...RUN, data: { config: SINGLE_SEAT_CONFIG } };
    store.claimReviewPanelRun.mockResolvedValue(run3);

    const attemptsByEntry = { 'entry-A': [], 'entry-B': [], 'entry-C': [] };
    const entries = ['A', 'B', 'C'].map((k) => ({
      id: `entry-${k}`, run_id: 'run-1', status: 'running',
      data: { input: { requestId: `r-${k}`, narrative: { text: 'n' } } }, winners_json: {},
    }));
    store.listReviewPanelEntries.mockResolvedValue(entries);
    store.listAttemptsForEntry.mockImplementation(async (entryId) => attemptsByEntry[entryId].slice());
    store.reapExpiredAttempts.mockResolvedValue([]);
    store.selectWinners.mockImplementation(async (entryId) => entries.find((e) => e.id === entryId));
    store.createAttempt.mockImplementation(async ({ entryId, seatKey }) => {
      const attempt = { id: `${entryId}-${seatKey}-1`, entry_id: entryId, seat_key: seatKey, attempt_no: 1, state: 'pending' };
      attemptsByEntry[entryId].push(attempt);
      return attempt;
    });
    store.markAttemptDispatched.mockImplementation(async (id) => {
      for (const list of Object.values(attemptsByEntry)) {
        const a = list.find((x) => x.id === id);
        if (a) { a.state = 'dispatched'; return a; }
      }
      return null;
    });
    store.reapAllDispatchedAttempts.mockImplementation(async () => {
      const reaped = [];
      for (const list of Object.values(attemptsByEntry)) {
        for (const a of list) if (a.state === 'dispatched') { a.state = 'unknown_outcome'; reaped.push(a); }
      }
      return reaped;
    });
    store.mutateReviewPanelEntry.mockImplementation(async (entryId, fn) => {
      const entry = entries.find((e) => e.id === entryId);
      await fn(entry);
      return entry;
    });

    let actorCalls = 0;
    store.assertReviewPanelActor.mockImplementation(async () => {
      actorCalls += 1;
      if (actorCalls === 1) return { profileId: run3.owner_profile_id }; // claim-time
      if (actorCalls === 2) throw Object.assign(new Error('An active superuser profile is required.'), { httpStatus: 403 }); // first entry into the pool
      return { profileId: run3.owner_profile_id }; // the other two entries' checks still succeed — the race is the point
    });

    // Simulates a genuinely in-flight paid call: never resolves on its own,
    // only reacts to the shared operatorStop abort (fired by the first 403)
    // — exactly what the fix relies on to stop siblings from hanging while
    // the pool is drained to settlement.
    runSeat.mockImplementation((input, seatConfig, { signal }) => new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error('aborted mid-call'), {}));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }));

    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, ownerRevoked: true });

    const allAttempts = Object.values(attemptsByEntry).flat();
    expect(allAttempts.some((a) => a.state === 'dispatched')).toBe(false);
    expect(entries.some((e) => e.status === 'running')).toBe(false);
    expect(entries.every((e) => e.status === 'failed')).toBe(true);
    expect(store.reapAllDispatchedAttempts).toHaveBeenCalledWith('run-1', 'lease-1');
    expect(store.stopRevokedReviewPanelRun).toHaveBeenCalledWith('run-1', 'lease-1', expect.stringMatching(/no longer has superuser access/i));
    expect(store.releaseReviewPanelRun).toHaveBeenCalledWith('run-1', 'lease-1');
  });
});

describe('D11 storage readiness is re-checked immediately before every paid dispatch', () => {
  test('storage unconfigured before the first seat dispatch of an entry: runSeat is never called, drain returns paused (not a permanent run failure)', async () => {
    assertReviewPanelStorageConfigured.mockImplementation(() => {
      throw Object.assign(new Error('The private review panel document store has not been configured.'), { httpStatus: 503 });
    });
    store.listReviewPanelEntries.mockResolvedValue([entryState]);
    const result = await drainReviewPanels();
    expect(result).toEqual({ claimed: 1, paused: true });
    expect(runSeat).not.toHaveBeenCalled();
    expect(store.createAttempt).not.toHaveBeenCalled();
    expect(store.stopRevokedReviewPanelRun).not.toHaveBeenCalled(); // storage readiness is not an owner-revocation
    expect(store.releaseReviewPanelRun).toHaveBeenCalled();
  });
});
