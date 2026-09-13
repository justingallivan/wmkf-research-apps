/**
 * Unit tests for lib/services/review-panel-service.js — the real service,
 * with the store/roster/input/generation/storage/rollout dependencies
 * mocked. Covers what review-panel-routes.test.js (which mocks the whole
 * service) cannot: the service's own logic — actor-first ordering, roster
 * membership checks, smoke-mode enforcement, idempotency replay, and that
 * download only ever reads a persisted ref, never anything from the query.
 *
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ queryAllRequests: jest.fn() }));
jest.mock('../../lib/services/workbench/program-scope-service', () => ({
  resolveWorkbenchProgramScope: jest.fn(async () => ({ programId: 'program-1' })),
}));
jest.mock('../../lib/services/review-panel-input', () => ({ prepareReviewPanelInput: jest.fn() }));
jest.mock('../../lib/services/review-panel-generation', () => {
  const actual = jest.requireActual('../../lib/services/review-panel-generation');
  return {
    snapshotConfiguration: jest.fn(),
    estimateReservationCost: jest.fn(() => ({ lowUsd: 1, highUsd: 2 })),
    ReviewPanelGenerationError: actual.ReviewPanelGenerationError,
  };
});
jest.mock('../../lib/services/review-panel-storage', () => ({
  assertReviewPanelStorageConfigured: jest.fn(),
  reviewPanelDigest: jest.fn((value) => JSON.stringify(value)),
  readReviewPanelFile: jest.fn(),
}));
jest.mock('../../lib/services/review-panel-rollout', () => ({
  assertReviewPanelPilotEnabled: jest.fn(),
  assertReviewPanelCohortConfigured: jest.fn(),
  assertReviewPanelRequestAllowed: jest.fn(),
  assertReviewPanelModeValid: jest.fn(() => 'pilot'),
  buildReviewPanelRosterFilter: jest.fn(() => 'filter'),
}));
jest.mock('../../lib/services/review-panel-store', () => ({
  reviewPanelError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }),
  assertReviewPanelActor: jest.fn(),
  createReviewPanel: jest.fn(),
  saveReviewPanelSelection: jest.fn(),
  listReviewPanelRuns: jest.fn(),
  readReviewPanelControl: jest.fn(),
  listReviewPanelEntries: jest.fn(async () => []),
  listEntryAttempts: jest.fn(async () => []),
  findReviewPanelLaunch: jest.fn(async () => null),
  createReviewPanelRun: jest.fn(),
  setReviewPanelOperatorStop: jest.fn(),
  requestReviewPanelRetry: jest.fn(),
  requestReviewPanelCancel: jest.fn(),
  requestReviewPanelRerender: jest.fn(),
  readReviewPanelEntry: jest.fn(),
}));

const requests = require('../../lib/dataverse/adapters/grant-request');
const { prepareReviewPanelInput } = require('../../lib/services/review-panel-input');
const { snapshotConfiguration, ReviewPanelGenerationError } = require('../../lib/services/review-panel-generation');
const { readReviewPanelFile, assertReviewPanelStorageConfigured } = require('../../lib/services/review-panel-storage');
const rollout = require('../../lib/services/review-panel-rollout');
const store = require('../../lib/services/review-panel-store');
const {
  getReviewPanelPage, launchReviewPanel, controlReviewPanel, downloadReviewPanel, projectReviewPanelRun, reviewPanelAction,
} = require('../../lib/services/review-panel-service');

const OWNER = 7;
const REQ_A = '11111111-1111-4111-8111-111111111111';
const REQ_B = '22222222-2222-4222-8222-222222222222';
const LAUNCH_KEY = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const ENTRY_ID = '55555555-5555-4555-8555-555555555555';

function rosterRecord(requestId, requestNumber) {
  return {
    akoya_requestid: requestId, akoya_requestnum: requestNumber, akoya_title: 'Title',
    _akoya_applicantid_value_formatted: 'Inst', _wmkf_projectleader_value_formatted: 'PI', _wmkf_programdirector_value_formatted: 'PD',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  store.assertReviewPanelActor.mockResolvedValue({ profileId: OWNER });
  store.createReviewPanel.mockResolvedValue({ id: 'panel-1', selection: [] });
  store.listReviewPanelRuns.mockResolvedValue([]);
  store.readReviewPanelControl.mockResolvedValue(null);
  store.listReviewPanelEntries.mockResolvedValue([]);
  store.listEntryAttempts.mockResolvedValue([]);
  store.findReviewPanelLaunch.mockResolvedValue(null);
  requests.queryAllRequests.mockResolvedValue({ capped: false, records: [rosterRecord(REQ_A, 'R-1'), rosterRecord(REQ_B, 'R-2')] });
  rollout.assertReviewPanelModeValid.mockReturnValue('pilot');
  snapshotConfiguration.mockResolvedValue({ seats: {}, chair: { provider: 'anthropic', model: 'claude-opus-5' } });
  prepareReviewPanelInput.mockResolvedValue({ requestId: REQ_A, requestNumber: 'R-1', narrative: { text: 'n' } });
  assertReviewPanelStorageConfigured.mockImplementation(() => {}); // configured (no-op) by default
});

describe('getReviewPanelPage surfaces the rollout mode so the page can mirror the server\'s smoke-mode launch rule', () => {
  test('surfaces mode: "smoke"', async () => {
    rollout.assertReviewPanelModeValid.mockReturnValue('smoke');
    const result = await getReviewPanelPage(OWNER);
    expect(result.configuration.mode).toBe('smoke');
  });

  test('surfaces mode: "pilot"', async () => {
    rollout.assertReviewPanelModeValid.mockReturnValue('pilot');
    const result = await getReviewPanelPage(OWNER);
    expect(result.configuration.mode).toBe('pilot');
  });

  test('an invalid mode never breaks the read-only status page — mode comes back null instead of throwing', async () => {
    rollout.assertReviewPanelModeValid.mockImplementation(() => { throw Object.assign(new Error('invalid mode'), { httpStatus: 503 }); });
    const result = await getReviewPanelPage(OWNER);
    expect(result.configuration.mode).toBeNull();
  });
});

describe('getReviewPanelPage surfaces WHY snapshotConfiguration failed, instead of collapsing every failure into one generic sentence', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('a ReviewPanelGenerationError surfaces its message as reason + its code, and is logged', async () => {
    snapshotConfiguration.mockRejectedValue(new ReviewPanelGenerationError('Prompt review-panel.chair must pin a concrete Claude model id at seed time (D8) — got "opus"', 'review_panel_prompt_invalid'));
    const result = await getReviewPanelPage(OWNER);
    expect(result.configuration.ready).toBe(false);
    expect(result.configuration.error).toBe('Published review panel prompts are not ready. Check Admin configuration.');
    expect(result.configuration.reason).toBe('Prompt review-panel.chair must pin a concrete Claude model id at seed time (D8) — got "opus"');
    expect(result.configuration.code).toBe('review_panel_prompt_invalid');
    expect(warnSpy).toHaveBeenCalledWith('[review-panel] configuration not ready', {
      code: 'review_panel_prompt_invalid',
      message: 'Prompt review-panel.chair must pin a concrete Claude model id at seed time (D8) — got "opus"',
    });
  });

  test('a non-ReviewPanelGenerationError failure still surfaces the generic sentence with no reason', async () => {
    snapshotConfiguration.mockRejectedValue(new Error('boom'));
    const result = await getReviewPanelPage(OWNER);
    expect(result.configuration.ready).toBe(false);
    expect(result.configuration.error).toBe('Published review panel prompts are not ready. Check Admin configuration.');
    expect(result.configuration.reason).toBeNull();
    expect(result.configuration.code).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('actor assertion runs BEFORE any store/roster/Blob call', () => {
  function rejectActor() {
    store.assertReviewPanelActor.mockRejectedValue(Object.assign(new Error('An active superuser profile is required.'), { httpStatus: 403 }));
  }

  test('getReviewPanelPage', async () => {
    rejectActor();
    await expect(getReviewPanelPage(OWNER)).rejects.toMatchObject({ httpStatus: 403 });
    expect(store.createReviewPanel).not.toHaveBeenCalled();
    expect(requests.queryAllRequests).not.toHaveBeenCalled();
    expect(snapshotConfiguration).not.toHaveBeenCalled();
  });

  test('launchReviewPanel', async () => {
    rejectActor();
    await expect(launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A], idempotencyKey: LAUNCH_KEY })).rejects.toMatchObject({ httpStatus: 403 });
    expect(requests.queryAllRequests).not.toHaveBeenCalled();
    expect(prepareReviewPanelInput).not.toHaveBeenCalled();
    expect(store.createReviewPanelRun).not.toHaveBeenCalled();
  });

  test('controlReviewPanel', async () => {
    rejectActor();
    await expect(controlReviewPanel(OWNER, { action: 'operator-stop', stop: true })).rejects.toMatchObject({ httpStatus: 403 });
    expect(store.setReviewPanelOperatorStop).not.toHaveBeenCalled();
    expect(store.requestReviewPanelRetry).not.toHaveBeenCalled();
    expect(store.requestReviewPanelCancel).not.toHaveBeenCalled();
    expect(store.requestReviewPanelRerender).not.toHaveBeenCalled();
  });

  test('controlReviewPanel rerender', async () => {
    rejectActor();
    await expect(controlReviewPanel(OWNER, { action: 'rerender', runId: RUN_ID, entryIds: [ENTRY_ID] })).rejects.toMatchObject({ httpStatus: 403 });
    expect(store.requestReviewPanelRerender).not.toHaveBeenCalled();
  });

  test('downloadReviewPanel', async () => {
    rejectActor();
    await expect(downloadReviewPanel(OWNER, { entryId: ENTRY_ID, format: 'pdf' })).rejects.toMatchObject({ httpStatus: 403 });
    expect(store.readReviewPanelEntry).not.toHaveBeenCalled();
    expect(readReviewPanelFile).not.toHaveBeenCalled();
  });
});

describe('launchReviewPanel — Blob store readiness enforced BEFORE the run is created', () => {
  test('fails closed when the D11 store is not configured, before touching the roster or creating the run', async () => {
    assertReviewPanelStorageConfigured.mockImplementation(() => {
      throw Object.assign(new Error('The private review panel document store has not been configured.'), { httpStatus: 503 });
    });
    await expect(launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A], idempotencyKey: LAUNCH_KEY })).rejects.toMatchObject({ httpStatus: 503 });
    expect(requests.queryAllRequests).not.toHaveBeenCalled();
    expect(store.createReviewPanelRun).not.toHaveBeenCalled();
  });
});

describe('launchReviewPanel', () => {
  test('rejects a selected id that is absent from the server roster', async () => {
    await expect(launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A, '99999999-9999-4999-8999-999999999999'], idempotencyKey: LAUNCH_KEY }))
      .rejects.toMatchObject({ httpStatus: 409, message: expect.stringMatching(/roster changed/i) });
    expect(store.createReviewPanelRun).not.toHaveBeenCalled();
  });

  test('smoke mode with more than one selection is rejected with 400', async () => {
    rollout.assertReviewPanelModeValid.mockReturnValue('smoke');
    await expect(launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A, REQ_B], idempotencyKey: LAUNCH_KEY }))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringMatching(/smoke mode requires exactly one/i) });
    expect(store.createReviewPanelRun).not.toHaveBeenCalled();
  });

  test('smoke mode with exactly one selection is allowed through to launch', async () => {
    rollout.assertReviewPanelModeValid.mockReturnValue('smoke');
    store.createReviewPanelRun.mockResolvedValue({ id: RUN_ID, status: 'queued', data: {}, created_at: new Date().toISOString() });
    await expect(launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A], idempotencyKey: LAUNCH_KEY })).resolves.toBeDefined();
    expect(store.createReviewPanelRun).toHaveBeenCalled();
  });

  test('an idempotency replay returns the existing run WITHOUT calling prepareReviewPanelInput or createReviewPanelRun', async () => {
    const existingRun = { id: RUN_ID, status: 'completed', data: {}, created_at: new Date().toISOString() };
    store.findReviewPanelLaunch.mockResolvedValue(existingRun);
    const result = await launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A], idempotencyKey: LAUNCH_KEY });
    expect(result.run.id).toBe(RUN_ID);
    expect(prepareReviewPanelInput).not.toHaveBeenCalled();
    expect(store.createReviewPanelRun).not.toHaveBeenCalled();
    expect(snapshotConfiguration).not.toHaveBeenCalled();
  });

  test('a fresh launch resolves narrative input per selected request and creates the run with pendingEntries', async () => {
    store.createReviewPanelRun.mockResolvedValue({ id: RUN_ID, status: 'queued', data: {}, created_at: new Date().toISOString() });
    const result = await launchReviewPanel(OWNER, { selectedRequestIds: [REQ_A], idempotencyKey: LAUNCH_KEY });
    expect(prepareReviewPanelInput).toHaveBeenCalledWith(REQ_A, { requestNumber: 'R-1' });
    expect(store.createReviewPanelRun).toHaveBeenCalledWith(expect.objectContaining({
      owner: OWNER,
      data: expect.objectContaining({ pendingEntries: [expect.objectContaining({ requestId: REQ_A })] }),
    }));
    expect(result.run.id).toBe(RUN_ID);
  });
});

describe('controlReviewPanel — rerender action', () => {
  test('routes to requestReviewPanelRerender with (runId, owner, entryIds) and projects the resulting run', async () => {
    store.requestReviewPanelRerender.mockResolvedValue({ id: RUN_ID, status: 'queued', data: {}, created_at: new Date().toISOString() });
    const result = await controlReviewPanel(OWNER, { action: 'rerender', runId: RUN_ID, entryIds: [ENTRY_ID] });
    expect(store.requestReviewPanelRerender).toHaveBeenCalledWith(RUN_ID, OWNER, [ENTRY_ID]);
    expect(result.run.id).toBe(RUN_ID);
  });

  test('reviewPanelAction dispatches action:"rerender" through controlReviewPanel the same way as retry/stop/operator-stop', async () => {
    store.requestReviewPanelRerender.mockResolvedValue({ id: RUN_ID, status: 'queued', data: {}, created_at: new Date().toISOString() });
    const result = await reviewPanelAction(OWNER, { action: 'rerender', runId: RUN_ID, entryIds: [ENTRY_ID] });
    expect(store.requestReviewPanelRerender).toHaveBeenCalled();
    expect(result.run.id).toBe(RUN_ID);
  });
});

describe('projectReviewPanelRun — rerender projection', () => {
  const run = { id: RUN_ID, status: 'completed', created_at: '2026-09-13T00:00:00.000Z', data: {} };

  test('entries[].rerender is null when no re-render request is outstanding', () => {
    const entry = { id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'completed', data: { files: { docx: {}, pdf: {} } }, retry_requested_at: null };
    const result = projectReviewPanelRun(run, [entry], []);
    expect(result.entries[0].rerender).toBeNull();
  });

  test('entries[].rerender surfaces requestedAt only — no file refs, since data.files is never touched by the request itself', () => {
    const entry = {
      id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'completed', retry_requested_at: '2026-09-13T10:06:00.000Z',
      data: { files: { docx: {}, pdf: {} }, rerender: { requestedAt: '2026-09-13T10:06:00.000Z', requestedBy: 7 } },
    };
    const result = projectReviewPanelRun(run, [entry], []);
    expect(result.entries[0].rerender).toEqual({ requestedAt: '2026-09-13T10:06:00.000Z' });
    // The CURRENT pair stays live and the entry still reads hasReport:true throughout the wait.
    expect(result.entries[0].hasReport).toBe(true);
  });

  test('entries[].rerenderCount reflects the appended (never overwritten) rerenderHistory length', () => {
    const entry = {
      id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'completed',
      data: { files: { docx: {}, pdf: {} }, rerenderHistory: [{ replacedAt: '2026-09-13T09:00:00.000Z', files: {} }, { replacedAt: '2026-09-13T10:00:00.000Z', files: {} }] },
    };
    const result = projectReviewPanelRun(run, [entry], []);
    expect(result.entries[0].rerenderCount).toBe(2);
  });

  test('entries[].rerenderCount is 0 when rerenderHistory is absent', () => {
    const entry = { id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'completed', data: { files: { docx: {}, pdf: {} } } };
    const result = projectReviewPanelRun(run, [entry], []);
    expect(result.entries[0].rerenderCount).toBe(0);
  });
});

describe('projectReviewPanelRun — per-seat detail for the Progress tab', () => {
  const run = { id: RUN_ID, status: 'running', created_at: '2026-09-13T00:00:00.000Z', data: {} };
  const entry = { id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'running', data: {}, retry_requested_at: null };

  test('a seat with no attempt at all projects as pending, with every other field null', () => {
    const result = projectReviewPanelRun(run, [entry], []);
    expect(result.entries[0].seats).toEqual([
      { seatKey: 'seat.claude', label: 'Claude reviewer', provider: null, model: null, state: 'pending', costCents: null, costState: null, error: null },
      { seatKey: 'seat.openai', label: 'OpenAI reviewer', provider: null, model: null, state: 'pending', costCents: null, costState: null, error: null },
      { seatKey: 'chair', label: 'Chair', provider: null, model: null, state: 'pending', costCents: null, costState: null, error: null },
    ]);
  });

  test('the LATEST attempt_no wins per seat — an earlier failed attempt is superseded by a later completed one', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 1, state: 'failed', provider: 'anthropic', model: 'claude-fable-5-1', cost_cents: null, cost_state: null, error_text: 'first try failed' },
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 2, state: 'completed', provider: 'anthropic', model: 'claude-fable-5-1', cost_cents: 16, cost_state: 'known', error_text: null },
      { entry_id: ENTRY_ID, seat_key: 'seat.openai', attempt_no: 1, state: 'dispatched', provider: 'openai', model: 'gpt-5.6-sol', cost_cents: null, cost_state: null, error_text: null },
    ];
    const result = projectReviewPanelRun(run, [entry], attempts);
    const [claudeSeat, openaiSeat, chairSeat] = result.entries[0].seats;
    expect(claudeSeat).toEqual({ seatKey: 'seat.claude', label: 'Claude reviewer', provider: 'anthropic', model: 'claude-fable-5-1', state: 'completed', costCents: 16, costState: 'known', error: null });
    expect(openaiSeat).toMatchObject({ state: 'dispatched', costCents: null, costState: null });
    expect(chairSeat).toMatchObject({ state: 'pending' });
  });

  test('a failed seat carries its attempt error text', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.openai', attempt_no: 1, state: 'failed', provider: 'openai', model: 'gpt-5.6-sol', cost_cents: null, cost_state: null, error_text: 'The AI service was busy (HTTP 529) for the OpenAI reviewer.' },
    ];
    const result = projectReviewPanelRun(run, [entry], attempts);
    const openaiSeat = result.entries[0].seats.find((s) => s.seatKey === 'seat.openai');
    expect(openaiSeat.error).toBe('The AI service was busy (HTTP 529) for the OpenAI reviewer.');
  });

  test('never carries usage tokens or prompt snapshots — only the explicit projection fields per seat', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 1, state: 'completed', provider: 'anthropic', model: 'claude-fable-5-1', cost_cents: 16, cost_state: 'known', error_text: null,
        // A store row could carry these (SELECT * elsewhere in the store) — the projection must never pass them through even if present on the input row.
        usage_json: { input_tokens: 999 }, prompt_snapshot_json: { text: 'secret narrative' }, result_json: { review: 'text' } },
    ];
    const result = projectReviewPanelRun(run, [entry], attempts);
    const claudeSeat = result.entries[0].seats.find((s) => s.seatKey === 'seat.claude');
    expect(Object.keys(claudeSeat).sort()).toEqual(['costCents', 'costState', 'error', 'label', 'model', 'provider', 'seatKey', 'state'].sort());
    expect(JSON.stringify(result)).not.toMatch(/999|secret narrative|prompt_snapshot|usage_json/);
  });

  test('runs entries through getReviewPanelPage call listEntryAttempts once per run, batched (never per-entry)', async () => {
    store.listReviewPanelRuns.mockResolvedValue([{ id: RUN_ID, status: 'completed', created_at: '2026-09-13T00:00:00.000Z', data: {} }]);
    store.listReviewPanelEntries.mockResolvedValue([entry, { ...entry, id: 'entry-2' }]);
    store.listEntryAttempts.mockResolvedValue([]);
    await getReviewPanelPage(OWNER);
    expect(store.listEntryAttempts).toHaveBeenCalledTimes(1);
    expect(store.listEntryAttempts).toHaveBeenCalledWith([ENTRY_ID, 'entry-2']);
  });
});

describe('projectReviewPanelRun — timeline for the Progress tab', () => {
  const timelineRun = { id: RUN_ID, status: 'running', created_at: '2026-09-13T10:00:00.000Z', data: {} };
  const timelineEntry = {
    id: ENTRY_ID, request_id: REQ_A, request_revision: 1, status: 'completed',
    data: { files: { docx: {}, pdf: {} } }, retry_requested_at: null, updated_at: '2026-09-13T10:05:00.000Z',
  };

  test('orders Launched, worker pickup, per-seat terminal events, and edition completion oldest-first, with correct labels', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 1, state: 'completed', dispatched_at: '2026-09-13T10:01:00.000Z', updated_at: '2026-09-13T10:02:00.000Z' },
      { entry_id: ENTRY_ID, seat_key: 'seat.openai', attempt_no: 1, state: 'failed', dispatched_at: '2026-09-13T10:01:30.000Z', updated_at: '2026-09-13T10:02:30.000Z' },
      { entry_id: ENTRY_ID, seat_key: 'chair', attempt_no: 1, state: 'completed', dispatched_at: '2026-09-13T10:03:00.000Z', updated_at: '2026-09-13T10:04:00.000Z' },
    ];
    const result = projectReviewPanelRun(timelineRun, [timelineEntry], attempts);
    expect(result.timeline).toEqual([
      { at: '2026-09-13T10:00:00.000Z', label: 'Launched' },
      { at: '2026-09-13T10:01:00.000Z', label: 'Worker picked up the run' },
      { at: '2026-09-13T10:02:00.000Z', label: 'Claude reviewer completed' },
      { at: '2026-09-13T10:02:30.000Z', label: 'OpenAI reviewer failed' },
      { at: '2026-09-13T10:03:00.000Z', label: 'Chair dispatched' },
      { at: '2026-09-13T10:04:00.000Z', label: 'Chair completed' },
      { at: '2026-09-13T10:05:00.000Z', label: 'Edition completed' },
      { at: '2026-09-13T10:05:00.000Z', label: 'Report saved' },
    ]);
  });

  test('only the LATEST attempt per seat contributes a terminal event', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 1, state: 'failed', dispatched_at: '2026-09-13T10:01:00.000Z', updated_at: '2026-09-13T10:01:30.000Z' },
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 2, state: 'completed', dispatched_at: '2026-09-13T10:02:00.000Z', updated_at: '2026-09-13T10:03:00.000Z' },
    ];
    const result = projectReviewPanelRun(timelineRun, [timelineEntry], attempts);
    const seatEvents = result.timeline.filter((e) => e.label.startsWith('Claude reviewer'));
    expect(seatEvents).toEqual([{ at: '2026-09-13T10:03:00.000Z', label: 'Claude reviewer completed' }]);
  });

  test('omits edition completion when the entry has no persisted files, even if terminal', () => {
    const bareEntry = { ...timelineEntry, data: {} };
    const result = projectReviewPanelRun(timelineRun, [bareEntry], []);
    expect(result.timeline.some((e) => e.label === 'Edition completed')).toBe(false);
    expect(result.timeline.some((e) => e.label === 'Report saved')).toBe(false);
  });

  test('omits edition completion for a failed entry, even with files present — the label would otherwise lie', () => {
    const failedEntry = { ...timelineEntry, status: 'failed' };
    const result = projectReviewPanelRun(timelineRun, [failedEntry], []);
    expect(result.timeline.some((e) => e.label === 'Edition completed')).toBe(false);
    expect(result.timeline.some((e) => e.label === 'Report saved')).toBe(false);
  });

  test('"Retry requested" appears while retry_requested_at is set, timestamped from it', () => {
    const retryingEntry = { ...timelineEntry, status: 'failed', data: {}, retry_requested_at: '2026-09-13T10:06:00.000Z' };
    const result = projectReviewPanelRun(timelineRun, [retryingEntry], []);
    expect(result.timeline).toContainEqual({ at: '2026-09-13T10:06:00.000Z', label: 'Retry requested' });
  });

  test('omits "Retry requested" once the worker has cleared retry_requested_at (nothing to derive it from)', () => {
    const clearedEntry = { ...timelineEntry, retry_requested_at: null };
    const result = projectReviewPanelRun(timelineRun, [clearedEntry], []);
    expect(result.timeline.some((e) => e.label === 'Retry requested')).toBe(false);
  });

  test('"Re-render requested" (not "Retry requested") appears when the SAME marker carries data.rerender', () => {
    const rerenderingEntry = {
      ...timelineEntry, data: { files: {}, rerender: { requestedAt: '2026-09-13T10:06:00.000Z' } }, retry_requested_at: '2026-09-13T10:06:00.000Z',
    };
    const result = projectReviewPanelRun(timelineRun, [rerenderingEntry], []);
    expect(result.timeline).toContainEqual({ at: '2026-09-13T10:06:00.000Z', label: 'Re-render requested' });
    expect(result.timeline.some((e) => e.label === 'Retry requested')).toBe(false);
  });

  test('"Report saved" prefers the LATER of the two saved files\' own savedAt stamps over entry.updated_at when present', () => {
    const savedEntry = {
      ...timelineEntry,
      data: { files: { docx: { savedAt: '2026-09-13T10:20:00.000Z' }, pdf: { savedAt: '2026-09-13T10:22:00.000Z' } } },
    };
    const result = projectReviewPanelRun(timelineRun, [savedEntry], []);
    expect(result.timeline).toContainEqual({ at: '2026-09-13T10:22:00.000Z', label: 'Report saved' });
  });

  test('"Report saved" falls back to the run\'s own updated_at when the entry has no updated_at', () => {
    const noTimestampEntry = { ...timelineEntry, updated_at: null };
    const runWithUpdatedAt = { ...timelineRun, updated_at: '2026-09-13T10:07:00.000Z' };
    const result = projectReviewPanelRun(runWithUpdatedAt, [noTimestampEntry], []);
    expect(result.timeline).toContainEqual({ at: '2026-09-13T10:07:00.000Z', label: 'Report saved' });
  });

  test('omits "Report saved" rather than inventing a timestamp when neither the entry nor the run has one', () => {
    const noTimestampEntry = { ...timelineEntry, updated_at: null };
    const runWithoutUpdatedAt = { ...timelineRun, updated_at: null };
    const result = projectReviewPanelRun(runWithoutUpdatedAt, [noTimestampEntry], []);
    expect(result.timeline.some((e) => e.label === 'Report saved')).toBe(false);
  });

  test('a chair attempt dispatched but not yet terminal still surfaces "Chair dispatched"', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'chair', attempt_no: 1, state: 'dispatched', dispatched_at: '2026-09-13T10:03:00.000Z', updated_at: '2026-09-13T10:03:00.000Z' },
    ];
    const result = projectReviewPanelRun(timelineRun, [timelineEntry], attempts);
    expect(result.timeline).toContainEqual({ at: '2026-09-13T10:03:00.000Z', label: 'Chair dispatched' });
    expect(result.timeline.some((e) => e.label.startsWith('Chair completed') || e.label.startsWith('Chair failed'))).toBe(false);
  });

  test('never carries usage tokens or prompt text in the timeline', () => {
    const attempts = [
      { entry_id: ENTRY_ID, seat_key: 'seat.claude', attempt_no: 1, state: 'completed', dispatched_at: '2026-09-13T10:01:00.000Z', updated_at: '2026-09-13T10:02:00.000Z', usage_json: { input_tokens: 999 }, prompt_snapshot_json: { text: 'secret' } },
    ];
    const result = projectReviewPanelRun(timelineRun, [timelineEntry], attempts);
    expect(JSON.stringify(result.timeline)).not.toMatch(/999|secret|usage_json|prompt_snapshot/);
  });
});

describe('downloadReviewPanel', () => {
  test('passes exactly entry.data.files[format] to readReviewPanelFile, never anything derived from the query', async () => {
    const ref = { pathname: 'review-panel/entry/report.pdf', sha256: 'a'.repeat(64), size: 10, contentType: 'application/pdf' };
    store.readReviewPanelEntry.mockResolvedValue({
      id: ENTRY_ID, request_id: REQ_A, request_revision: 2,
      data: { input: { requestNumber: 'R-1' }, files: { pdf: ref, docx: { pathname: 'other', sha256: 'b'.repeat(64), size: 1 } } },
    });
    readReviewPanelFile.mockResolvedValue(Buffer.from('bytes'));
    await downloadReviewPanel(OWNER, { entryId: ENTRY_ID, format: 'pdf', pathname: 'attacker-supplied', sha256: 'z'.repeat(64) });
    expect(readReviewPanelFile).toHaveBeenCalledWith(ref);
    expect(readReviewPanelFile).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: 'attacker-supplied' }));
  });

  test('404s when the entry has no ref for the requested format', async () => {
    store.readReviewPanelEntry.mockResolvedValue({ id: ENTRY_ID, request_id: REQ_A, request_revision: 1, data: { files: {} } });
    await expect(downloadReviewPanel(OWNER, { entryId: ENTRY_ID, format: 'docx' })).rejects.toMatchObject({ httpStatus: 404 });
    expect(readReviewPanelFile).not.toHaveBeenCalled();
  });

  test('404s when the entry itself does not exist', async () => {
    store.readReviewPanelEntry.mockResolvedValue(null);
    await expect(downloadReviewPanel(OWNER, { entryId: ENTRY_ID, format: 'docx' })).rejects.toMatchObject({ httpStatus: 404 });
  });
});
