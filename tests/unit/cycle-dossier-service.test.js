/** @jest-environment node */

jest.mock('crypto', () => ({ ...jest.requireActual('crypto'), randomUUID: jest.fn(() => 'ffffffff-ffff-4fff-8fff-ffffffffffff') }));

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: jest.fn(),
  getById: jest.fn(),
}));
jest.mock('../../lib/services/workbench/program-scope-service.js', () => ({
  resolveWorkbenchProgramScope: jest.fn(async () => ({
    programs: [{ programId: '94cab30b-958f-ee11-8179-000d3a341e8f', name: 'Research' }],
    defaultProgramId: '94cab30b-958f-ee11-8179-000d3a341e8f',
    programId: '94cab30b-958f-ee11-8179-000d3a341e8f',
    programName: 'Research',
  })),
  buildProgramScopeFilter: jest.fn((programId) => `_wmkf_grantprogram_value eq ${programId}`),
}));
jest.mock('../../lib/services/cycle-dossier-generation.js', () => ({
  prepareRequestInput: jest.fn(),
  snapshotConfiguration: jest.fn(),
  estimateGenerationCost: jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-sharepoint.js', () => ({
  resolveDossierDestination: jest.fn(async () => ({ library: 'akoya_request', folder: '1001_GUID', siteId: 'site', driveId: 'drive' })),
}));
jest.mock('../../lib/services/cycle-dossier-storage.js', () => ({
  assertDossierStorageConfigured: jest.fn(),
  dossierDigest: jest.fn((value) => JSON.stringify(value)),
  storeDossierJSON: jest.fn(),
  readDossierJSON: jest.fn(),
  readDossierFile: jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-store.js', () => ({
  dossierError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }),
  assertDossierActor: jest.fn(),
  getDossier: jest.fn(),
  saveDossierSelection: jest.fn(),
  listDossierEntries: jest.fn(),
  listDossierRuns: jest.fn(),
  listDossierEditions: jest.fn(),
  createDossierPreview: jest.fn(),
  readDossierPreview: jest.fn(),
  findDossierLaunch: jest.fn(),
  withDossierTransaction: jest.fn(),
  createDossierRun: jest.fn(),
  reserveDossierEntry: jest.fn(),
  mutateDossierRun: jest.fn(),
  readDossierEdition: jest.fn(),
  getDossierEntry: jest.fn(),
  setDossierOperatorStop: jest.fn(),
  readDossierControl: jest.fn(),
}));

import * as requests from '../../lib/dataverse/adapters/grant-request.js';
import * as generation from '../../lib/services/cycle-dossier-generation.js';
import { resolveDossierDestination } from '../../lib/services/cycle-dossier-sharepoint.js';
import * as storage from '../../lib/services/cycle-dossier-storage.js';
import * as store from '../../lib/services/cycle-dossier-store.js';
import { resolveWorkbenchProgramScope } from '../../lib/services/workbench/program-scope-service.js';
import {
  controlCycleDossier,
  cycleDossierAction,
  downloadCycleDossier,
  getCycleDossierPage,
  launchCycleDossier,
  previewCycleDossier,
} from '../../lib/services/cycle-dossier-service.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PREVIEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ENTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EDITION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const roster = [{ requestId: ID, requestNumber: 'D26-001', title: 'A', institution: 'U', pi: 'PI', programDirector: 'PD' }, { requestId: ID2, requestNumber: 'D26-002', title: 'B', institution: 'U', pi: 'PI', programDirector: 'PD' }];
const promptConfig = { prompts: { researchPlan: { wmkf_ai_promptname: 'cycle-dossier.research-plan', wmkf_promptversion: 2, wmkf_ai_model: 'model-a' }, entry: { wmkf_ai_promptname: 'cycle-dossier.entry', wmkf_promptversion: 3, wmkf_ai_model: 'model-b' } } };

function runRow(overrides = {}) {
  return { id: 'run-1', status: 'queued', created_at: '2026-09-07T00:00:00Z', data: { items: [], spentUsd: 0, reservedUsd: 0 }, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CYCLE_DOSSIER_ENABLED = 'true';
  process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST = `${ID},${ID2}`;
  store.assertDossierActor.mockResolvedValue({ profileId: 7 });
  store.getDossier.mockResolvedValue({ id: 'dossier-1', cycle: 'D26', selection: [ID, ID2], latest_edition_id: null });
  store.listDossierEntries.mockResolvedValue([]);
  store.listDossierRuns.mockResolvedValue([]);
  store.listDossierEditions.mockResolvedValue([]);
  requests.queryAllRequests.mockResolvedValue({ capped: false, records: roster.map((r) => ({ akoya_requestid: r.requestId, akoya_requestnum: r.requestNumber, akoya_title: r.title, wmkf_organizationname: r.institution, _wmkf_projectleader_value_formatted: r.pi, _wmkf_programdirector_value_formatted: r.programDirector })) });
  generation.snapshotConfiguration.mockResolvedValue(promptConfig);
  generation.estimateGenerationCost.mockReturnValue({ lowUsd: 1, highUsd: 2 });
  generation.prepareRequestInput.mockResolvedValue({ requestId: ID2, requestNumber: 'D26-002', narrative: { text: 'Frozen narrative' } });
  storage.dossierDigest.mockImplementation((value) => JSON.stringify(value));
  storage.storeDossierJSON.mockResolvedValue('input-ref');
  storage.readDossierJSON.mockResolvedValue({});
  resolveDossierDestination.mockResolvedValue({ library: 'akoya_request', folder: '1001_GUID', siteId: 'site', driveId: 'drive' });
  store.setDossierOperatorStop.mockResolvedValue({ stop_requested: true, reason: 'controlled stop', updated_at: '2026-09-07T00:00:00Z' });
  store.readDossierControl.mockResolvedValue({ stop_requested: false, reason: null, updated_by: 7, updated_at: '2026-09-07T00:00:00Z' });
});

afterEach(() => { delete process.env.CYCLE_DOSSIER_ENABLED; delete process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST; delete process.env.CYCLE_DOSSIER_ROLLOUT_MODE; delete process.env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID; });

test('roster is scoped server-side to the Workbench default program with no caller identity', async () => {
  store.createDossierPreview.mockResolvedValue({ id: PREVIEW, expires_at: '2026-09-07T01:00:00Z', dossier_id: 'dossier-1' });
  const result = await previewCycleDossier(7, { selectedRequestIds: [ID], generateRequestIds: [] });
  expect(result.preview.id).toBe(PREVIEW);
  expect(resolveWorkbenchProgramScope).toHaveBeenCalledWith({});
  expect(requests.queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({
    filter: expect.stringMatching(/^wmkf_meetingdate ge .* and _wmkf_grantprogram_value eq 94cab30b-958f-ee11-8179-000d3a341e8f and \(akoya_requeststatus eq 'Phase II Pending'/),
  }));
});

test('preview returns the selected and generated DTOs and saves the selection', async () => {
  store.listDossierEntries.mockResolvedValue([{ request_id: ID, id: 'entry-existing', revision: 1, created_at: '2026-09-07T00:00:00Z', created_by: 9 }]);
  store.createDossierPreview.mockResolvedValue({ id: PREVIEW, expires_at: '2026-09-07T01:00:00Z', dossier_id: 'dossier-1' });
  const result = await previewCycleDossier(7, { selectedRequestIds: [ID, ID2], generateRequestIds: [ID2] });
  expect(generation.prepareRequestInput).toHaveBeenCalledWith(ID2);
  expect(result.preview).toMatchObject({ id: PREVIEW, estimate: { newCount: 1, reuseCount: 1 } });
  expect(result.preview.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ requestId: ID, reuseId: expect.anything(), status: 'ready' }),
    expect.objectContaining({ requestId: ID2, status: 'queued', fallback: false }),
  ]));
  expect(store.saveDossierSelection).toHaveBeenCalledWith(7, [ID, ID2]);
});

test('empty selection is rejected before a no-cap launch and unknown estimate remains nullable', async () => {
  await expect(previewCycleDossier(7, { selectedRequestIds: [], generateRequestIds: [] })).rejects.toMatchObject({ httpStatus: 400 });
  expect(generation.prepareRequestInput).not.toHaveBeenCalled();
  expect(generation.estimateGenerationCost).not.toHaveBeenCalled();
});

test('disabled pilot rejects preview before any private Blob or Postgres write', async () => {
  process.env.CYCLE_DOSSIER_ENABLED = 'false';
  await expect(previewCycleDossier(7, { selectedRequestIds: [ID], generateRequestIds: [ID] }))
    .rejects.toMatchObject({ httpStatus: 503 });
  expect(requests.queryAllRequests).not.toHaveBeenCalled();
  expect(storage.storeDossierJSON).not.toHaveBeenCalled();
  expect(store.createDossierPreview).not.toHaveBeenCalled();
});

test('disabled pilot rejects selection persistence before Postgres write', async () => {
  process.env.CYCLE_DOSSIER_ENABLED = 'false';
  await expect(cycleDossierAction(7, { action: 'selection', selectedRequestIds: [ID] }))
    .rejects.toMatchObject({ httpStatus: 503 });
  expect(store.saveDossierSelection).not.toHaveBeenCalled();
});

test('smoke mode with a request-number allowlist accepts the matching GUID selection', async () => {
  process.env.CYCLE_DOSSIER_ROLLOUT_MODE = 'smoke';
  process.env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID = '7';
  process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST = 'D26-001';
  store.saveDossierSelection.mockResolvedValue({ id: 'dossier-1', cycle: 'D26', selection: [ID], latest_edition_id: null });
  await expect(cycleDossierAction(7, { action: 'selection', selectedRequestIds: [ID] })).resolves.toBeTruthy();
  expect(store.saveDossierSelection).toHaveBeenCalledWith(7, [ID]);
});

test('a selection outside the roster cohort is rejected before persistence', async () => {
  process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST = 'D26-001';
  await expect(cycleDossierAction(7, { action: 'selection', selectedRequestIds: [ID2] }))
    .rejects.toMatchObject({ httpStatus: 400 });
  expect(store.saveDossierSelection).not.toHaveBeenCalled();
});

test('resume rejects a cap below what the run has already spent or reserved', async () => {
  const RUN_ID = '33333333-3333-4333-8333-333333333333';
  const run = runRow({ id: RUN_ID, status: 'paused', lease_token: null, data: { items: [], spentUsd: 3, reservedUsd: 2, cutPending: false, cutCounter: 0, budgetUsd: 10 } });
  store.mutateDossierRun.mockImplementation(async (_id, fn) => { await fn(run); return run; });
  await expect(cycleDossierAction(7, { action: 'resume', runId: RUN_ID, budgetUsd: 4 })).rejects.toMatchObject({ httpStatus: 400 });
  expect(run.status).toBe('paused');
  await expect(cycleDossierAction(7, { action: 'resume', runId: RUN_ID, budgetUsd: 5 })).resolves.toBeTruthy();
  expect(run.status).toBe('queued');
  expect(run.data.budgetUsd).toBe(5);
});

test('smoke mode rejects multi-request selection before persistence', async () => {
  process.env.CYCLE_DOSSIER_ROLLOUT_MODE = 'smoke';
  process.env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID = '7';
  await expect(cycleDossierAction(7, { action: 'selection', selectedRequestIds: [ID, ID2] }))
    .rejects.toMatchObject({ httpStatus: 503 });
  expect(store.saveDossierSelection).not.toHaveBeenCalled();
});

test('launch without a cap accepts a complete preview and returns a queued run', async () => {
  storage.dossierDigest.mockReturnValue('same-roster');
  store.readDossierPreview.mockResolvedValue({ id: PREVIEW, dossier_id: 'dossier-1', data: { rosterHash: 'same-roster', items: [{ requestId: ID, reuseId: 'entry-1' }] } });
  store.findDossierLaunch.mockResolvedValue(null);
  store.withDossierTransaction.mockImplementation(async (fn) => fn({ query: jest.fn(async (sql) => sql.startsWith('SELECT * FROM cycle_dossier_runs') ? { rows: [] } : { rows: [] }) }));
  store.reserveDossierEntry.mockResolvedValue({ id: 'entry-1', revision: 1 });
  store.createDossierRun.mockResolvedValue(runRow());
  const result = await launchCycleDossier(7, { previewId: PREVIEW, idempotencyKey: KEY, budgetUsd: null });
  expect(result.run).toMatchObject({ id: 'run-1', status: 'queued' });
  expect(store.createDossierRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ budgetUsd: null }) }), expect.anything());
});

test('launch accepts a captured-at change with the same content hash and rejects a changed hash before enqueue', async () => {
  storage.dossierDigest.mockImplementation((value) => {
    if (Array.isArray(value)) return 'roster-hash';
    if (value?.narrative) return value.narrative.contentHash;
    if (value?.folder) return value.folder;
    return JSON.stringify(value);
  });
  store.readDossierPreview.mockResolvedValue({ id: PREVIEW, dossier_id: 'dossier-1', data: { rosterHash: 'roster-hash', items: [{ requestId: ID, requestNumber: 'D26-001', inputRef: 'input-ref', inputHash: 'hash-a', destination: { library: 'akoya_request', folder: '1001_GUID', siteId: 'site', driveId: 'drive' } }] } });
  store.findDossierLaunch.mockResolvedValue(null);
  store.withDossierTransaction.mockImplementation(async (fn) => fn({ query: jest.fn(async () => ({ rows: [] })) }));
  store.createDossierRun.mockResolvedValue(runRow());
  generation.prepareRequestInput.mockResolvedValue({ requestId: ID, requestNumber: 'D26-001', narrative: { text: 'Frozen narrative', contentHash: 'hash-a', capturedAt: 'T2' } });
  await expect(launchCycleDossier(7, { previewId: PREVIEW, idempotencyKey: KEY, budgetUsd: null })).resolves.toMatchObject({ run: { id: 'run-1' } });
  const callsAfterStable = store.createDossierRun.mock.calls.length;

  store.findDossierLaunch.mockResolvedValue(null);
  generation.prepareRequestInput.mockResolvedValue({ requestId: ID, requestNumber: 'D26-001', narrative: { text: 'Changed narrative', contentHash: 'hash-b', capturedAt: 'T2' } });
  await expect(launchCycleDossier(7, { previewId: PREVIEW, idempotencyKey: '11111111-1111-4111-8111-111111111111', budgetUsd: null })).rejects.toThrow(/sources changed/i);
  expect(store.createDossierRun).toHaveBeenCalledTimes(callsAfterStable);
});

test('launch replay returns the immutable run and conflicts when the budget changes', async () => {
  storage.dossierDigest.mockImplementation((value) => JSON.stringify(value));
  const replay = runRow({ launch_hash: JSON.stringify({ previewId: PREVIEW, budgetUsd: null }) });
  store.findDossierLaunch.mockResolvedValue(replay);
  await expect(launchCycleDossier(7, { previewId: PREVIEW, idempotencyKey: KEY, budgetUsd: null })).resolves.toMatchObject({ run: { id: 'run-1' } });
  await expect(launchCycleDossier(7, { previewId: PREVIEW, idempotencyKey: KEY, budgetUsd: 5 })).rejects.toMatchObject({ httpStatus: 409 });
});

test('retry starts a new run with a fresh budget and no carried charges', async () => {
  const source = runRow({ id: 'run-old', status: 'failed', dossier_id: 'dossier-1', owner_profile_id: 7, data: { spentUsd: 18, reservedUsd: 4, budgetUsd: 20, items: [{ requestId: ID, status: 'ready' }, { requestId: ID2, status: 'failed', inputRef: 'input-ref', error: 'old' }] } });
  const client = { query: jest.fn().mockResolvedValue({ rows: [source] }) };
  store.withDossierTransaction.mockImplementation(async (fn) => fn(client));
  store.createDossierRun.mockImplementation(async ({ data }) => runRow({ id: 'run-new', data }));
  const result = await controlCycleDossier(7, { action: 'retry', runId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', budgetUsd: 6 });
  expect(result.run.id).toBe('run-new');
  expect(store.createDossierRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ spentUsd: 0, reservedUsd: 0, budgetUsd: 6 }) }), client);
  expect(store.createDossierRun.mock.calls[0][0].data.items).toEqual(expect.arrayContaining([expect.objectContaining({ requestId: ID, status: 'ready' }), expect.objectContaining({ requestId: ID2, status: 'queued', error: null })]));
});

test('entry revisions are shared across superusers while editions remain owner-private', async () => {
  store.getDossierEntry.mockResolvedValue({ id: ENTRY, ready: true, cycle: 'D26', revision: 2, data: { files: { docx: { path: 'docx-ref', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, pdf: { path: 'pdf-ref', contentType: 'application/pdf' } }, request: { requestNumber: 'D26-001' } } });
  storage.readDossierFile.mockResolvedValue(Buffer.from('file'));
  await expect(downloadCycleDossier(7, { entryId: ENTRY, format: 'pdf' })).resolves.toMatchObject({ contentType: expect.stringContaining('pdf') });
  store.readDossierEdition.mockRejectedValue(Object.assign(new Error('Edition not found.'), { httpStatus: 404 }));
  await expect(downloadCycleDossier(7, { editionId: EDITION, format: 'pdf' })).rejects.toMatchObject({ httpStatus: 404 });
  expect(store.readDossierEdition).toHaveBeenCalledWith(7, EDITION);
});

test('missing superuser role fails closed on page reads', async () => {
  store.assertDossierActor.mockRejectedValue(Object.assign(new Error('An active superuser profile is required.'), { httpStatus: 403 }));
  await expect(getCycleDossierPage(7)).rejects.toMatchObject({ httpStatus: 403 });
  expect(store.listDossierEntries).not.toHaveBeenCalled();
});

test('operator stop persists a global stop without requiring a run id', async () => {
  await expect(controlCycleDossier(7, { action: 'operator-stop', stop: true, reason: 'controlled rehearsal complete' }))
    .resolves.toEqual({ control: { stopRequested: true, reason: 'controlled stop', updatedAt: '2026-09-07T00:00:00Z' } });
  expect(store.setDossierOperatorStop).toHaveBeenCalledWith(7, true, 'controlled rehearsal complete');
});
