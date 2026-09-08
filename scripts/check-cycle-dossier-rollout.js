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
import { parseDossierRequestAllowlist, validateDossierEnvironment } from '../lib/services/cycle-dossier-rollout.js';

export const MIGRATION_FILE = '038_cycle_dossiers.sql';
export const PROMPTS = [
  { definition: research, maxTokens: 3000 },
  { definition: entry, maxTokens: 12000 },
];
export const REQUIRED_TABLES = [
  'cycle_dossiers', 'cycle_dossier_previews', 'cycle_dossier_entries',
  'cycle_dossier_runs', 'cycle_dossier_editions',
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

export async function runPreflight({
  root = resolve(fileURLToPath(new URL('..', import.meta.url))),
  expectedEnvironment,
  vercelEnv = process.env.VERCEL_ENV,
  nodeEnv = process.env.NODE_ENV,
  dynamicsUrl = process.env.DYNAMICS_URL,
  model = process.env.CYCLE_DOSSIER_PROMPT_MODEL || 'claude-sonnet-4-6',
  liveRead = false,
  smokeRequest = null,
  dependencies = {},
} = {}) {
  const migrationText = await readFile(resolve(root, 'lib/db/migrations', MIGRATION_FILE), 'utf8').catch(() => null);
  const manifest = JSON.parse(await readFile(resolve(root, 'lib/db/migrations-manifest.json'), 'utf8').catch(() => '{}'));
  const migration = verifyMigrationContract({ migrationText, manifest });
  const environment = validateDossierEnvironment({ expected: expectedEnvironment, vercelEnv, nodeEnv, dynamicsUrl });
  const modelCheck = validateReviewedClaudeModelValue(model);
  const promptContract = { ok: modelCheck.valid && modelCheck.kind === 'claude' && modelCheck.capabilities?.supportsStructuredOutput === true, model };
  const allowlist = parseDossierRequestAllowlist(process.env.CYCLE_DOSSIER_REQUEST_ALLOWLIST || '');
  const result = { ok: migration.ok && environment.ok && promptContract.ok, migration, environment, promptContract,
    cohort: { configured: allowlist.length > 0, values: allowlist }, prompts: [], live: null, smoke: null };
  if (liveRead) {
    if (!environment.ok) throw new Error(environment.reason);
    const fetchCurrentPrompt = dependencies.fetchCurrentPrompt || (await import('../lib/services/prompt-store.js')).fetchCurrentPrompt;
    for (const item of PROMPTS) {
      const row = await fetchCurrentPrompt(item.definition.PROMPT_NAME);
      const check = verifyPromptRow(row, expectedPrompt(item.definition, item.maxTokens, model));
      result.prompts.push({ name: item.definition.PROMPT_NAME, version: row.wmkf_promptversion, ...check });
      if (!check.ok) result.ok = false;
    }
    const loadRoster = dependencies.loadDossierRoster || (await import('../lib/services/cycle-dossier-service.js')).loadDossierRoster;
    const roster = await loadRoster();
    if (!roster.length) throw new Error('The controlled D26 roster is empty.');
    result.live = { rosterCount: roster.length };
    if (smokeRequest) {
      const wanted = String(smokeRequest).toLowerCase();
      const item = roster.find(row => row.requestId === wanted || String(row.requestNumber).toLowerCase() === wanted);
      if (!item) throw new Error(`Smoke request ${smokeRequest} is outside the live controlled cohort.`);
      const prepare = dependencies.prepareRequestInput || (await import('../lib/services/cycle-dossier-generation.js')).prepareRequestInput;
      const destination = dependencies.resolveDossierDestination || (await import('../lib/services/cycle-dossier-sharepoint.js')).resolveDossierDestination;
      const input = await prepare(item.requestId);
      const target = await destination(item.requestId, item.requestNumber);
      if (!input?.narrative?.contentHash || !input?.narrative?.text) throw new Error('The exact Proposal Narrative source is missing or unhashable.');
      result.live.request = { requestId: item.requestId, requestNumber: item.requestNumber, narrativeHash: input.narrative.contentHash, narrativeChars: input.narrative.text.length };
      result.smoke = buildSmokePlan({ requestId: item.requestId, requestNumber: item.requestNumber, environment: expectedEnvironment, promptVersions: result.prompts.map(p => ({ name: p.name, version: p.version })), destination: target });
    }
  } else if (smokeRequest) {
    result.smoke = buildSmokePlan({ requestId: null, requestNumber: smokeRequest, environment: expectedEnvironment, promptVersions: [], destination: null });
    result.smoke.blocked = 'Use --live-read with --smoke-request to prove the exact roster/source/folder before operator authorization.';
  }
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
