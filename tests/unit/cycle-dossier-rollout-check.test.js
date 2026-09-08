/** @jest-environment node */

import {
  buildSmokePlan,
  expectedPrompt,
  runPreflight,
  verifyMigrationContract,
  verifyPromptRow,
} from '../../scripts/check-cycle-dossier-rollout.js';
import * as research from '../../shared/config/prompts/cycle-dossier-research-plan.js';
import * as entry from '../../shared/config/prompts/cycle-dossier-entry.js';
import {
  assertDossierPilotEnabled,
  assertDossierRequestAllowed,
  assertDossierWorkerOpen,
  parseDossierRequestAllowlist,
  validateDossierEnvironment,
} from '../../lib/services/cycle-dossier-rollout.js';

const migrationText = `
CREATE TABLE IF NOT EXISTS cycle_dossiers (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_previews (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_entries (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_runs (id uuid);
CREATE TABLE IF NOT EXISTS cycle_dossier_editions (id uuid);
`;

afterEach(() => {
  delete process.env.CYCLE_DOSSIER_ENABLED;
  delete process.env.CYCLE_DOSSIER_OPERATOR_STOP;
  delete process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST;
});

test('migration contract requires manifest inclusion, sorted files, and all five tables', () => {
  expect(verifyMigrationContract({ migrationText, manifest: { files: ['001.sql', '038_cycle_dossiers.sql'] } }).ok).toBe(true);
  expect(verifyMigrationContract({ migrationText, manifest: { files: ['038_cycle_dossiers.sql', '001.sql'] } }).ok).toBe(false);
  expect(verifyMigrationContract({ migrationText: migrationText.replace('cycle_dossier_editions', 'wrong'), manifest: { files: ['038_cycle_dossiers.sql'] } }).missingTables).toContain('cycle_dossier_editions');
});

test('prompt verification pins every seeded field and current identity', () => {
  const expected = expectedPrompt(research, 3000, 'claude-sonnet-4-6');
  const row = { ...expected, wmkf_ai_promptid: 'prompt-1', wmkf_promptversion: 2, wmkf_ai_iscurrent: true };
  expect(verifyPromptRow(row, expected)).toEqual({ ok: true, mismatches: [] });
  expect(verifyPromptRow({ ...row, wmkf_ai_promptbody: 'changed' }, expected).mismatches).toContain('wmkf_ai_promptbody');
  expect(verifyPromptRow({ ...row, wmkf_ai_iscurrent: false }, expected).mismatches).toContain('wmkf_ai_iscurrent');
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
    dependencies: {
      fetchCurrentPrompt: jest.fn(async name => rows.find(row => row.wmkf_ai_promptname === name)),
      loadDossierRoster: jest.fn(async () => [{ requestId: 'id-1', requestNumber: 'D26-001' }]),
      prepareRequestInput: jest.fn(async () => ({ narrative: { text: 'frozen', contentHash: 'a'.repeat(64) } })),
      resolveDossierDestination: jest.fn(async () => ({ library: 'akoya_request', folder: 'request', siteId: 'site', driveId: 'drive' })),
    },
  });
  expect(result.ok).toBe(true);
  expect(result.live.request.narrativeHash).toHaveLength(64);
  expect(result.smoke).toMatchObject({ writes: false, paidCalls: false, mode: 'readiness-only' });
});

test('smoke plan remains read-only and explicitly requires operator authorization', () => {
  expect(buildSmokePlan({ requestId: 'id', requestNumber: 'D26-001', environment: 'preview', promptVersions: [] })).toMatchObject({ writes: false, paidCalls: false });
});
