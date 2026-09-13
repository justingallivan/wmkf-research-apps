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
jest.mock('../../lib/services/review-panel-generation', () => ({
  snapshotConfiguration: jest.fn(),
  estimateReservationCost: jest.fn(() => ({ lowUsd: 1, highUsd: 2 })),
}));
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
  findReviewPanelLaunch: jest.fn(async () => null),
  createReviewPanelRun: jest.fn(),
  setReviewPanelOperatorStop: jest.fn(),
  requestReviewPanelRetry: jest.fn(),
  requestReviewPanelCancel: jest.fn(),
  readReviewPanelEntry: jest.fn(),
}));

const requests = require('../../lib/dataverse/adapters/grant-request');
const { prepareReviewPanelInput } = require('../../lib/services/review-panel-input');
const { snapshotConfiguration } = require('../../lib/services/review-panel-generation');
const { readReviewPanelFile } = require('../../lib/services/review-panel-storage');
const rollout = require('../../lib/services/review-panel-rollout');
const store = require('../../lib/services/review-panel-store');
const {
  getReviewPanelPage, launchReviewPanel, controlReviewPanel, downloadReviewPanel,
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
  store.findReviewPanelLaunch.mockResolvedValue(null);
  requests.queryAllRequests.mockResolvedValue({ capped: false, records: [rosterRecord(REQ_A, 'R-1'), rosterRecord(REQ_B, 'R-2')] });
  rollout.assertReviewPanelModeValid.mockReturnValue('pilot');
  snapshotConfiguration.mockResolvedValue({ seats: {}, chair: { provider: 'anthropic', model: 'claude-opus-5' } });
  prepareReviewPanelInput.mockResolvedValue({ requestId: REQ_A, requestNumber: 'R-1', narrative: { text: 'n' } });
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
  });

  test('downloadReviewPanel', async () => {
    rejectActor();
    await expect(downloadReviewPanel(OWNER, { entryId: ENTRY_ID, format: 'pdf' })).rejects.toMatchObject({ httpStatus: 403 });
    expect(store.readReviewPanelEntry).not.toHaveBeenCalled();
    expect(readReviewPanelFile).not.toHaveBeenCalled();
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
