#!/usr/bin/env node
/**
 * Read-only Cycle Dossier rollout preflight.
 *
 * Default mode checks the tracked migration/prompt contracts and the named
 * environment without network access. `--live-read` additionally verifies the
 * current prompt rows, filtered D26 cohort, exact Proposal Narrative source,
 * and pinned SharePoint destination. `--smoke-request <id-or-number>` only
 * prepares a guarded one-request smoke plan; it never launches generation or
 * performs a write. The operator must separately authorize preview, launch,
 * and the cron tick after reviewing this output.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReviewedClaudeModelValue } from '../lib/services/model-review-validation.js';
import * as research from '../shared/config/prompts/cycle-dossier-research-plan.js';
import * as entry from '../shared/config/prompts/cycle-dossier-entry.js';
import { parseDossierRequestAllowlist, validateDossierEnvironment, dossierRolloutConfig, buildDossierRosterFilter } from '../lib/services/cycle-dossier-rollout.js';

export const MIGRATION_FILE = '038_cycle_dossiers.sql';
export const PROMPTS = [
  { definition: research, maxTokens: 3000 },
  { definition: entry, maxTokens: 12000 },
];
export const REQUIRED_TABLES = [
  'cycle_dossiers', 'cycle_dossier_previews', 'cycle_dossier_entries',
  'cycle_dossier_runs', 'cycle_dossier_control', 'cycle_dossier_editions',
];

export function expectedPrompt(definition, maxTokens, model) {
  return {
    wmkf_ai_promptname: definition.PROMPT_NAME,
    wmkf_ai_systemprompt: definition.SYSTEM_PROMPT,
    wmkf_ai_promptbody: definition.USER_PROMPT_TEMPLATE,
    wmkf_ai_promptvariables: JSON.stringify(definition.VARIABLES, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(definition.OUTPUT_SCHEMA, null, 2),
    wmkf_ai_model: model,
    wmkf_ai_temperature: 0.2,
    wmkf_ai_maxtokens: maxTokens,
    wmkf_ai_promptstatus: 682090001,
  };
}

export function verifyPromptRow(row, expected) {
  const mismatches = [];
  for (const field of Object.keys(expected)) {
    const left = row?.[field];
    const right = expected[field];
    if (['wmkf_ai_temperature', 'wmkf_ai_maxtokens', 'wmkf_promptversion'].includes(field)) {
      if (Number(left) !== Number(right)) mismatches.push(field);
    } else if (left !== right) mismatches.push(field);
  }
  if (!row?.wmkf_ai_promptid) mismatches.push('wmkf_ai_promptid');
  if (!Number.isInteger(Number(row?.wmkf_promptversion)) || Number(row.wmkf_promptversion) < 1) mismatches.push('wmkf_promptversion');
  if (row?.wmkf_ai_iscurrent === false || row?.wmkf_ai_iscurrent === 0) mismatches.push('wmkf_ai_iscurrent');
  return { ok: mismatches.length === 0, mismatches };
}

export function verifyMigrationContract({ migrationText, manifest }) {
  const files = manifest?.files;
  const missingTables = REQUIRED_TABLES.filter(table => !new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(migrationText || ''));
  const ok = typeof migrationText === 'string'
    && Array.isArray(files)
    && files.includes(MIGRATION_FILE)
    && [...files].sort().every((file, index) => file === files[index])
    && missingTables.length === 0;
  return { ok, migrationListed: Array.isArray(files) && files.includes(MIGRATION_FILE), missingTables };
}

export function buildSmokePlan({ requestId, requestNumber, environment, promptVersions, destination }) {
  return {
    mode: 'readiness-only',
    request: { requestId: requestId || null, requestNumber: requestNumber || null },
    environment,
    promptVersions,
    destination: destination || null,
    writes: false,
    paidCalls: false,
    nextSteps: [
      'Review this frozen request/source/destination evidence.',
      'Authorize one preview and launch with a budget covering the reported high bound.',
      'Run exactly one authenticated drain-cycle-dossiers tick and capture its run id.',
      'Verify both private downloads and the exact AI Artifacts SharePoint files before enabling a wider cohort.',
    ],
  };
}

export function readinessCheck(ok, reason = null) {
  return ok ? { status: 'ready' } : { status: reason ? 'unavailable' : 'not-ready', reason: reason || 'Check did not pass.' };
}

function dossierStoreIdFromToken(token) {
  const parts = String(token || '').split('_');
  return parts.length >= 4 && parts[0] === 'vercel' && parts[1] === 'blob' && parts[2] === 'rw' ? parts[3] : null;
}

function normalizeDossierStoreId(value) {
  return String(value || '').replace(/^store_/, '').toLowerCase();
}

export async function probeDossierBlobStore(env = process.env) {
  const token = String(env.DOSSIER_BLOB_READ_WRITE_TOKEN || '').trim();
  const configuredStoreId = String(env.DOSSIER_BLOB_STORE_ID || '').trim();
  const tokenStoreId = dossierStoreIdFromToken(token);
  if (!tokenStoreId || !configuredStoreId || normalizeDossierStoreId(tokenStoreId) !== normalizeDossierStoreId(configuredStoreId)) {
    throw new Error('The dossier Blob token does not identify the configured dedicated store.');
  }
  const { list } = await import('@vercel/blob');
  const result = await list({ prefix: 'cycle-dossier/', limit: 1, token });
  if (!result || !Array.isArray(result.blobs)) throw new Error('The dedicated dossier Blob store returned an invalid read response.');
  const expectedHost = `${normalizeDossierStoreId(configuredStoreId)}.private.blob.vercel-storage.com`;
  for (const blob of result.blobs) {
    let hostname;
    try { hostname = new URL(blob.url).hostname.toLowerCase(); } catch { throw new Error('The dedicated dossier Blob store returned an invalid object URL.'); }
    if (hostname !== expectedHost) throw new Error('The dossier Blob read returned an object from a different store.');
  }
  return { authenticated: true, storeId: configuredStoreId, sampleCount: result.blobs.length };
}

async function defaultReadSchemaState() {
  const { sql } = await import('@vercel/postgres');
  const tables = (await sql.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])`, [REQUIRED_TABLES])).rows.map(row => row.table_name);
  const migrations = (await sql.query(`SELECT name FROM schema_migrations WHERE name=$1`, [MIGRATION_FILE])).rows;
  const control = (await sql.query('SELECT stop_requested FROM cycle_dossier_control WHERE id=TRUE')).rows[0] || null;
  return { tables, migrationApplied: migrations.length === 1, control };
}

export async function defaultReadRoster({ requestAdapter = null, resolveScope = null } = {}) {
  const requests = requestAdapter || await import('../lib/dataverse/adapters/grant-request.js');
  const resolveProgramScope = resolveScope || (await import('../lib/services/workbench/program-scope-service.js')).resolveWorkbenchProgramScope;
  // Same server-owned program scope as loadDossierRoster: the preflight must
  // prove the list the pilot will actually load.
  const programScope = await resolveProgramScope({});
  const result = await requests.queryAllRequests({
    select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_organizationname,_wmkf_projectleader_value,_wmkf_programdirector_value',
    filter: buildDossierRosterFilter(programScope.programId),
    orderby: 'akoya_requestnum asc',
  });
  if (result.capped || !Array.isArray(result.records)) throw new Error('The ungated D26 roster is incomplete or capped.');
  return result.records.map(row => ({ requestId: String(row.akoya_requestid).toLowerCase(), requestNumber: row.akoya_requestnum,
    title: row.akoya_title || '', institution: row.wmkf_organizationname || '', pi: row._wmkf_projectleader_value_formatted || '',
    programDirector: row._wmkf_programdirector_value_formatted || 'Unassigned', programDirectorId: row._wmkf_programdirector_value || null }));
}

export async function fetchPublishedPromptForPreflight(promptName, queryCurrentRows = null) {
  const query = queryCurrentRows || (await import('../lib/dataverse/adapters/ai-prompt.js')).queryCurrentRows;
  const result = await query(promptName);
  const rows = Array.isArray(result?.records) ? result.records : [];
  if (rows.length === 0) throw new Error(`No current prompt found for name "${promptName}".`);
  if (rows.length > 1) throw new Error(`Multiple current prompts found for name "${promptName}".`);
  return rows[0];
}

export async function runPreflight({
  root = resolve(fileURLToPath(new URL('..', import.meta.url))),
  expectedEnvironment,
  vercelEnv = process.env.VERCEL_ENV,
  nodeEnv = process.env.NODE_ENV,
  dynamicsUrl = process.env.DYNAMICS_URL,
  model = process.env.CYCLE_DOSSIER_PROMPT_MODEL || 'claude-sonnet-4-6',
  liveRead = false,
  smokeRequest = null,
  env = process.env,
  dependencies = {},
} = {}) {
  const migrationText = await readFile(resolve(root, 'lib/db/migrations', MIGRATION_FILE), 'utf8').catch(() => null);
  const manifest = JSON.parse(await readFile(resolve(root, 'lib/db/migrations-manifest.json'), 'utf8').catch(() => '{}'));
  const migration = verifyMigrationContract({ migrationText, manifest });
  const environment = validateDossierEnvironment({ expected: expectedEnvironment, vercelEnv, nodeEnv, dynamicsUrl });
  const modelCheck = validateReviewedClaudeModelValue(model);
  const promptContract = { ok: modelCheck.valid && modelCheck.kind === 'claude' && modelCheck.capabilities?.supportsStructuredOutput === true, model };
  const config = dossierRolloutConfig(env);
  const allowlist = parseDossierRequestAllowlist(env.CYCLE_DOSSIER_REQUEST_ALLOWLIST || '');
  const checks = {
    migration: readinessCheck(migration.ok, 'Migration 038 is missing, unlisted, unsorted, or incomplete.'),
    environment: readinessCheck(environment.ok, environment.reason),
    cohort: readinessCheck(allowlist.length > 0 && (config.mode !== 'smoke' || allowlist.length === 1), config.mode === 'smoke' ? 'Smoke mode requires exactly one allowlisted request.' : 'CYCLE_DOSSIER_REQUEST_ALLOWLIST is empty or malformed.'),
    promptContract: readinessCheck(promptContract.ok, 'The configured dossier model is not an approved structured-output Claude model.'),
    blob: readinessCheck(Boolean(String(env.DOSSIER_BLOB_READ_WRITE_TOKEN || '').trim() && String(env.DOSSIER_BLOB_STORE_ID || '').trim()), 'DOSSIER_BLOB_READ_WRITE_TOKEN and DOSSIER_BLOB_STORE_ID are required.'),
    blobAccess: readinessCheck(false, 'The dedicated Blob store was not authenticated with a read-only probe.'),
    cron: readinessCheck(Boolean(String(env.CRON_SECRET || '').trim()), 'CRON_SECRET is unavailable.'),
    operator: readinessCheck(config.mode === 'pilot' || (config.mode === 'smoke' && Number.isInteger(config.operatorProfileId) && config.operatorProfileId > 0), 'Smoke mode requires CYCLE_DOSSIER_OPERATOR_PROFILE_ID; mode must be pilot or smoke.'),
    schema: readinessCheck(false, 'Live schema/control state was not checked.'),
    prompts: readinessCheck(false, 'Live published prompt rows were not checked.'),
    roster: readinessCheck(false, 'Live ungated D26 roster was not checked.'),
    source: readinessCheck(false, 'An exact request source was not checked.'),
    destination: readinessCheck(false, 'An exact request destination was not checked.'),
  };
  const result = { ok: Object.values(checks).every(check => check.status === 'ready'), checks, migration, environment, promptContract,
    cohort: { configured: allowlist.length > 0, values: allowlist, mode: config.mode, operatorProfileId: config.operatorProfileId }, prompts: [], live: null, smoke: null };
  if (liveRead) {
    if (!environment.ok) throw new Error(environment.reason);
    const runRead = dependencies.withReadContext || (async fn => {
      const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
      enterDynamicsBypassForScript('cycle-dossier-rollout-preflight');
      return fn();
    });
    await runRead(async () => {
      try {
        const state = await (dependencies.readSchemaState || defaultReadSchemaState)();
        const schemaReady = REQUIRED_TABLES.every(table => state.tables?.includes(table)) && state.migrationApplied && state.control && state.control.stop_requested === false;
        checks.schema = readinessCheck(schemaReady, schemaReady ? null : 'Migration 038, all dossier tables, and an un-stopped control row are required.');
      } catch (error) { checks.schema = readinessCheck(false, `Schema/control check unavailable: ${error.message}`); }
      try {
        const fetchCurrentPrompt = dependencies.fetchCurrentPrompt || fetchPublishedPromptForPreflight;
        for (const item of PROMPTS) {
          const row = await fetchCurrentPrompt(item.definition.PROMPT_NAME);
          const check = verifyPromptRow(row, expectedPrompt(item.definition, item.maxTokens, model));
          result.prompts.push({ name: item.definition.PROMPT_NAME, version: row.wmkf_promptversion, ...check });
          if (!check.ok) result.ok = false;
        }
        checks.prompts = readinessCheck(result.prompts.length === PROMPTS.length && result.prompts.every(prompt => prompt.ok), 'Published prompt readback did not match the seeded contract.');
      } catch (error) { checks.prompts = readinessCheck(false, `Prompt check unavailable: ${error.message}`); }
      try {
        const probe = dependencies.probeBlobStore || probeDossierBlobStore;
        await probe(env);
        checks.blobAccess = readinessCheck(true);
      } catch (error) { checks.blobAccess = readinessCheck(false, `Dedicated Blob read probe unavailable: ${error.message}`); }
      try {
        const readRoster = dependencies.readRoster || defaultReadRoster;
        const roster = await readRoster();
        checks.roster = readinessCheck(roster.length > 0, 'The ungated D26 roster is empty.');
        result.live = { rosterCount: roster.length };
        if (smokeRequest) {
          const wanted = String(smokeRequest).toLowerCase();
          const item = roster.find(row => row.requestId === wanted || String(row.requestNumber).toLowerCase() === wanted);
          if (!item) throw new Error(`Smoke request ${smokeRequest} is outside the live controlled cohort.`);
          if (!allowlist.includes(String(item.requestId).toLowerCase()) && !allowlist.includes(String(item.requestNumber).toLowerCase())) throw new Error(`Smoke request ${smokeRequest} is not named in CYCLE_DOSSIER_REQUEST_ALLOWLIST.`);
          const prepare = dependencies.prepareRequestInput || (await import('../lib/services/cycle-dossier-generation.js')).prepareRequestInput;
          const destination = dependencies.resolveDossierDestination || (await import('../lib/services/cycle-dossier-sharepoint.js')).resolveDossierDestination;
          const input = await prepare(item.requestId);
          const target = await destination(item.requestId, item.requestNumber);
          checks.source = readinessCheck(Boolean(input?.narrative?.contentHash && input?.narrative?.text), 'The exact Proposal Narrative source is missing or unhashable.');
          checks.destination = readinessCheck(Boolean(target?.siteId && target?.driveId && target?.folder && target?.library), 'The authoritative SharePoint destination is incomplete.');
          result.live.request = { requestId: item.requestId, requestNumber: item.requestNumber, narrativeHash: input?.narrative?.contentHash || null, narrativeChars: input?.narrative?.text?.length || 0 };
          result.smoke = buildSmokePlan({ requestId: item.requestId, requestNumber: item.requestNumber, environment: expectedEnvironment, promptVersions: result.prompts.map(p => ({ name: p.name, version: p.version })), destination: target });
        }
      } catch (error) {
        checks.roster = readinessCheck(false, `Roster/source/destination check unavailable: ${error.message}`);
      }
    });
  } else if (smokeRequest) {
    result.smoke = buildSmokePlan({ requestId: null, requestNumber: smokeRequest, environment: expectedEnvironment, promptVersions: [], destination: null });
    result.smoke.blocked = 'Use --live-read with --smoke-request to prove the exact roster/source/folder before operator authorization.';
  }
  result.ok = Object.values(checks).every(check => check.status === 'ready');
  return result;
}

function parseArgs(argv) {
  const args = { liveRead: false, smokeRequest: null, expectedEnvironment: null, model: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live-read') args.liveRead = true;
    else if (arg === '--environment') args.expectedEnvironment = argv[++i];
    else if (arg === '--smoke-request') args.smokeRequest = argv[++i];
    else if (arg === '--model') args.model = argv[++i];
    else if (arg === '--help') return null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.expectedEnvironment) throw new Error('--environment local|preview|production is required.');
  if (args.smokeRequest && !args.liveRead) throw new Error('--smoke-request requires --live-read.');
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2));
      if (!args) {
        console.log('Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/check-cycle-dossier-rollout.js --environment <local|preview|production> [--live-read] [--smoke-request <request-id-or-number>]');
        return;
      }
      const result = await runPreflight(args);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Cycle Dossier preflight blocked: ${error.message}`);
      process.exitCode = 1;
    }
  })();
}
