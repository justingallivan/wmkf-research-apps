/** @jest-environment node */

jest.mock('@vercel/blob', () => ({ list: jest.fn() }));

const mockQueryCurrentRows = jest.fn();
jest.mock('../../lib/dataverse/adapters/ai-prompt.js', () => ({
  queryCurrentRows: (...args) => mockQueryCurrentRows(...args),
}));

import {
  buildSmokePlan,
  expectedPrompt,
  fetchPublishedPromptForPreflight,
  defaultReadRoster,
  probeDossierBlobStore,
  runPreflight,
  verifyMigrationContract,
  verifyPromptRow,
} from '../../scripts/check-cycle-dossier-rollout.js';
import * as research from '../../shared/config/prompts/cycle-dossier-research-plan.js';
import * as entry from '../../shared/config/prompts/cycle-dossier-entry.js';
import {
  assertDossierPilotEnabled,
  assertDossierProfileAllowed,
  assertDossierRequestAllowed,
  assertDossierWorkerOpen,
  buildDossierRosterFilter,
  parseDossierRequestAllowlist,
  validateDossierEnvironment,
} from '../../lib/services/cycle-dossier-rollout.js';
import { list } from '@vercel/blob';

const migrationText = `
CREATE TABLE IF NOT EXISTS cycle_dossiers (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_previews (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_entries (id uuid);
  CREATE TABLE IF NOT EXISTS cycle_dossier_runs (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_control (id boolean);
CREATE TABLE IF NOT EXISTS cycle_dossier_editions (id uuid);
`;
const syntheticDossierBlobToken = ['vercel', 'blob', 'rw', 'storealpha', 'secret'].join('_');
const wrongDossierBlobToken = ['vercel', 'blob', 'rw', 'shared', 'secret'].join('_');
const malformedDossierBlobToken = ['invalid', 'blob', 'token'].join('_');

afterEach(() => {
  delete process.env.CYCLE_DOSSIER_ENABLED;
  delete process.env.CYCLE_DOSSIER_OPERATOR_STOP;
  delete process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST;
  delete process.env.CYCLE_DOSSIER_ROLLOUT_MODE;
});

test('migration contract requires manifest inclusion, sorted files, and the control table', () => {
  expect(verifyMigrationContract({ migrationText, manifest: { files: ['001.sql', '038_cycle_dossiers.sql'] } }).ok).toBe(true);
  expect(verifyMigrationContract({ migrationText, manifest: { files: ['038_cycle_dossiers.sql', '001.sql'] } }).ok).toBe(false);
  expect(verifyMigrationContract({ migrationText: migrationText.replace('cycle_dossier_editions', 'wrong'), manifest: { files: ['038_cycle_dossiers.sql'] } }).missingTables).toContain('cycle_dossier_editions');
  expect(verifyMigrationContract({ migrationText: migrationText.replace('cycle_dossier_control', 'wrong'), manifest: { files: ['038_cycle_dossiers.sql'] } }).missingTables).toContain('cycle_dossier_control');
});

test('prompt verification pins every seeded field and current identity', () => {
  const expected = expectedPrompt(research, 3000, 'claude-sonnet-4-6');
  const row = { ...expected, wmkf_ai_promptid: 'prompt-1', wmkf_promptversion: 2, wmkf_ai_iscurrent: true };
  expect(verifyPromptRow(row, expected)).toEqual({ ok: true, mismatches: [] });
  expect(verifyPromptRow({ ...row, wmkf_ai_promptbody: 'changed' }, expected).mismatches).toContain('wmkf_ai_promptbody');
  expect(verifyPromptRow({ ...row, wmkf_ai_iscurrent: false }, expected).mismatches).toContain('wmkf_ai_iscurrent');
});

test('default roster uses the server-owned program scope plus the Workbench visibility predicate', async () => {
  const programId = '94cab30b-958f-ee11-8179-000d3a341e8f';
  const resolveScope = jest.fn(async () => ({ programId, programName: 'Research' }));
  const queryAllRequests = jest.fn(async () => ({ capped: false, records: [{
    akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    akoya_requestnum: 'D26-001',
    akoya_title: 'A',
  }] }));
  await expect(defaultReadRoster({ requestAdapter: { queryAllRequests }, resolveScope })).resolves.toMatchObject([
    { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestNumber: 'D26-001' },
  ]);
  expect(resolveScope).toHaveBeenCalledWith({});
  const expectedFilter = `wmkf_meetingdate ge 2026-12-01T00:00:00Z and wmkf_meetingdate lt 2027-01-01T00:00:00Z and _wmkf_grantprogram_value eq ${programId} and (akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq 100000000) and (wmkf_triagestatus eq null or wmkf_triagestatus ne 100000001)`;
  expect(queryAllRequests).toHaveBeenCalledWith(expect.objectContaining({ filter: expectedFilter }));
  // The service and the preflight must load the same list.
  expect(buildDossierRosterFilter(programId)).toBe(expectedFilter);
});

test('preflight prompt readback uses the admin current-row projection', async () => {
  const row = { ...expectedPrompt(research, 3000, 'claude-sonnet-4-6'), wmkf_ai_promptid: 'p', wmkf_promptversion: 1, wmkf_ai_iscurrent: true };
  mockQueryCurrentRows.mockResolvedValue({ records: [row] });
  await expect(fetchPublishedPromptForPreflight(research.PROMPT_NAME)).resolves.toEqual(row);
  expect(mockQueryCurrentRows).toHaveBeenCalledWith(research.PROMPT_NAME);
});

test('environment and cohort guards fail closed', () => {
  expect(validateDossierEnvironment({ expected: 'production', vercelEnv: 'preview', nodeEnv: 'production' }).ok).toBe(false);
  expect(validateDossierEnvironment({ expected: 'production', vercelEnv: 'production', nodeEnv: 'production', dynamicsUrl: 'https://orgd9e66399.crm.dynamics.com' }).ok).toBe(false);
  expect(parseDossierRequestAllowlist('D26-001,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toHaveLength(2);
  process.env.CYCLE_DOSSIER_ENABLED = 'true';
  process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST = 'D26-001';
  expect(() => assertDossierPilotEnabled()).not.toThrow();
  expect(() => assertDossierRequestAllowed({ requestNumber: 'D26-001' })).not.toThrow();
  expect(() => assertDossierRequestAllowed({ requestNumber: 'D26-002' })).toThrow(/outside/i);
});

test('pilot mode admits any superuser while smoke mode pins one operator profile', () => {
  expect(() => assertDossierProfileAllowed(99, { CYCLE_DOSSIER_ROLLOUT_MODE: 'pilot' })).not.toThrow();
  expect(() => assertDossierProfileAllowed(7, { CYCLE_DOSSIER_ROLLOUT_MODE: 'smoke', CYCLE_DOSSIER_OPERATOR_PROFILE_ID: '7' })).not.toThrow();
  expect(() => assertDossierProfileAllowed(8, { CYCLE_DOSSIER_ROLLOUT_MODE: 'smoke', CYCLE_DOSSIER_OPERATOR_PROFILE_ID: '7' })).toThrow(/outside/i);
});

test('smoke mode requires one and only one cohort request', () => {
  process.env.CYCLE_DOSSIER_ROLLOUT_MODE = 'smoke';
  process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST = 'D26-001,D26-002';
  expect(() => assertDossierRequestAllowed({ requestNumber: 'D26-001' })).toThrow(/exactly one/i);
});

test('Blob probe authenticates read-only and rejects wrong or malformed store tokens', async () => {
  list.mockResolvedValue({ blobs: [] });
  await expect(probeDossierBlobStore({ DOSSIER_BLOB_READ_WRITE_TOKEN: syntheticDossierBlobToken, DOSSIER_BLOB_STORE_ID: 'store_storealpha' }))
    .resolves.toMatchObject({ authenticated: true, storeId: 'store_storealpha' });
  expect(list).toHaveBeenCalledWith({ prefix: 'cycle-dossier/', limit: 1, token: syntheticDossierBlobToken });
  await expect(probeDossierBlobStore({ DOSSIER_BLOB_READ_WRITE_TOKEN: wrongDossierBlobToken, DOSSIER_BLOB_STORE_ID: 'store_storealpha' })).rejects.toThrow(/dedicated store/i);
  await expect(probeDossierBlobStore({ DOSSIER_BLOB_READ_WRITE_TOKEN: malformedDossierBlobToken, DOSSIER_BLOB_STORE_ID: 'store_storealpha' })).rejects.toThrow(/dedicated store/i);
});

test('worker stop is checked after a run is claimed', async () => {
  process.env.CYCLE_DOSSIER_ENABLED = 'true';
  process.env.CYCLE_DOSSIER_OPERATOR_STOP = 'true';
  await expect(assertDossierWorkerOpen(process.env, async () => ({ stop_requested: false }))).rejects.toThrow(/paused/i);
  delete process.env.CYCLE_DOSSIER_OPERATOR_STOP;
  await expect(assertDossierWorkerOpen(process.env, async () => ({ stop_requested: false }))).resolves.toBeUndefined();
});

test('live preflight verifies both exact prompt rows and one request source/destination without launching', async () => {
  const rows = [
    { ...expectedPrompt(research, 3000, 'claude-sonnet-4-6'), wmkf_ai_promptid: 'r', wmkf_promptversion: 2 },
    { ...expectedPrompt(entry, 12000, 'claude-sonnet-4-6'), wmkf_ai_promptid: 'e', wmkf_promptversion: 3 },
  ];
  const result = await runPreflight({
    root: process.cwd(), expectedEnvironment: 'local', vercelEnv: undefined, nodeEnv: 'development', dynamicsUrl: null,
    liveRead: true, smokeRequest: 'D26-001',
    env: { CYCLE_DOSSIER_ENABLED: 'true', CYCLE_DOSSIER_REQUEST_ALLOWLIST: 'D26-001', CYCLE_DOSSIER_ROLLOUT_MODE: 'smoke', CYCLE_DOSSIER_OPERATOR_PROFILE_ID: '7', DOSSIER_BLOB_READ_WRITE_TOKEN: syntheticDossierBlobToken, DOSSIER_BLOB_STORE_ID: 'store_storealpha', CRON_SECRET: 'cron' },
    dependencies: {
      fetchCurrentPrompt: jest.fn(async name => rows.find(row => row.wmkf_ai_promptname === name)),
      readSchemaState: jest.fn(async () => ({ tables: ['cycle_dossiers', 'cycle_dossier_previews', 'cycle_dossier_entries', 'cycle_dossier_runs', 'cycle_dossier_control', 'cycle_dossier_editions'], migrationApplied: true, control: { stop_requested: false } })),
      readRoster: jest.fn(async () => [{ requestId: 'id-1', requestNumber: 'D26-001' }]),
      withReadContext: jest.fn(async fn => fn()),
      probeBlobStore: jest.fn(async () => ({ authenticated: true, storeId: 'store_storealpha', sampleCount: 0 })),
      prepareRequestInput: jest.fn(async () => ({ narrative: { text: 'frozen', contentHash: 'a'.repeat(64) } })),
      resolveDossierDestination: jest.fn(async () => ({ library: 'akoya_request', folder: 'request', siteId: 'site', driveId: 'drive' })),
    },
  });
  expect(result.ok).toBe(true);
  expect(result.checks.promptContract.status).toBe('ready');
  expect(result.checks.blobAccess.status).toBe('ready');
  expect(result.live.request.narrativeHash).toHaveLength(64);
  expect(result.smoke).toMatchObject({ writes: false, paidCalls: false, mode: 'readiness-only' });
});

test('invalid model or failed Blob identity probe blocks preflight', async () => {
  const result = await runPreflight({
    root: process.cwd(), expectedEnvironment: 'local', nodeEnv: 'development', model: 'gpt-4o', liveRead: true,
    env: { CYCLE_DOSSIER_REQUEST_ALLOWLIST: 'D26-001', DOSSIER_BLOB_READ_WRITE_TOKEN: syntheticDossierBlobToken, DOSSIER_BLOB_STORE_ID: 'store_storealpha', CRON_SECRET: 'cron' },
    dependencies: {
      readSchemaState: jest.fn(async () => ({ tables: ['cycle_dossiers', 'cycle_dossier_previews', 'cycle_dossier_entries', 'cycle_dossier_runs', 'cycle_dossier_control', 'cycle_dossier_editions'], migrationApplied: true, control: { stop_requested: false } })),
      fetchCurrentPrompt: jest.fn(async name => ({ ...expectedPrompt(name.includes('research') ? research : entry, name.includes('research') ? 3000 : 12000, 'gpt-4o'), wmkf_ai_promptid: 'p', wmkf_promptversion: 1 })),
      readRoster: jest.fn(async () => [{ requestId: 'id-1', requestNumber: 'D26-001' }]),
      withReadContext: jest.fn(async fn => fn()),
      probeBlobStore: jest.fn(async () => { throw new Error('wrong store'); }),
      prepareRequestInput: jest.fn(async () => ({ narrative: { text: 'frozen', contentHash: 'a'.repeat(64) } })),
      resolveDossierDestination: jest.fn(async () => ({ library: 'akoya_request', folder: 'request', siteId: 'site', driveId: 'drive' })),
    },
  });
  expect(result.ok).toBe(false);
  expect(result.checks.promptContract.status).toBe('unavailable');
  expect(result.checks.blobAccess.status).toBe('unavailable');
});

test('static preflight reports unavailable live checks and cannot pass', async () => {
  const result = await runPreflight({
    root: process.cwd(), expectedEnvironment: 'local', nodeEnv: 'development',
    env: { CYCLE_DOSSIER_REQUEST_ALLOWLIST: 'D26-001', DOSSIER_BLOB_READ_WRITE_TOKEN: 'blob', CRON_SECRET: 'cron' },
  });
  expect(result.ok).toBe(false);
  expect(result.checks.schema.status).toBe('unavailable');
  expect(result.checks.roster.status).toBe('unavailable');
});

test('smoke plan remains read-only and explicitly requires operator authorization', () => {
  expect(buildSmokePlan({ requestId: 'id', requestNumber: 'D26-001', environment: 'preview', promptVersions: [] })).toMatchObject({ writes: false, paidCalls: false });
});
