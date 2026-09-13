#!/usr/bin/env node
/**
 * Governed bootstrap for the two Virtual Review Panel Phase A Executor prompts
 * (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.3).
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/seed-review-panel-prompts.js --dry-run
 *   Add --execute instead of --dry-run to create/publish rows; add --force only
 *   for explicitly reviewed versioned recovery. No flag defaults to dry-run.
 *
 * --execute performs Dataverse writes. It never overwrites a prompt row in
 * place: prompt-seed creates a new version and flips the prior current row by
 * ETag. The target interlock must be enforcing before --execute.
 *
 * Both rows are seeded with a Claude model (D8: publishing stays Claude-only)
 * — the seat row's seeded `wmkf_ai_model` is `seat.claude`'s default model
 * from shared/config/reviewPanelSeats.js, not the eventual per-seat model.
 * The seat prompt is provider-agnostic text (no seat identity in the prompt);
 * review-panel-generation.js's snapshotConfiguration replaces `wmkf_ai_model`
 * with each seat's admin-resolved model at launch time and grafts on the
 * question-set-derived `validationSchema`. The chair is always Anthropic, at
 * launch time and at seed time alike.
 *
 * This module's plan/execute logic (`planReviewPanelSeed` / `executeReview-
 * PanelSeed`) is dependency-injected and side-effect-free: importing this file
 * never touches Dataverse or the network. Only `main()`, gated to run ONLY
 * when this file is executed directly (never on import), reads .env files,
 * checks the target interlock, and calls the real prompt-seed/model-review-
 * validation services. Unit tests exercise the dry-run path with `planSeed`
 * mocked; never run this script's --dry-run directly against `.env.local`
 * (it points at PRODUCTION Dataverse) outside that mocked path.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { REVIEW_PANEL_SEATS } from '../shared/config/reviewPanelSeats.js';
import * as seatDefinition from '../shared/config/prompts/review-panel-seat.js';
import * as chairDefinition from '../shared/config/prompts/review-panel-chair.js';

export const PROMPTSTATUS_PUBLISHED = 682090001;

// The seat row's seeded pin. Never invented: the seat.claude entry already
// exists in the reviewed seat registry.
const SEAT_CLAUDE_DEFAULT_MODEL = REVIEW_PANEL_SEATS.find((s) => s.key === 'seat.claude')?.defaultModel;

export const DEFINITIONS = Object.freeze([
  { definition: seatDefinition, maxTokens: 12000, notes: 'Virtual Review Panel Phase A seat prompt; provider-agnostic, per-seat model swapped at launch time. Headroom only: SEAT_ANSWER_MAX_CHARS (lib/services/review-panel-questions.js) is the real control keeping output within the seat ceiling.' },
  { definition: chairDefinition, maxTokens: 12000, notes: 'Virtual Review Panel Phase A chair synthesis prompt; always Anthropic.' },
]);

export function validateDefinition(definition, { validateReviewedClaudeModelValue, model }) {
  const { PROMPT_NAME, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, VARIABLES, OUTPUT_SCHEMA } = definition;
  if (!/^review-panel\.(seat|chair)$/.test(PROMPT_NAME)) throw new Error(`Invalid review-panel prompt name: ${PROMPT_NAME}`);
  if (!SYSTEM_PROMPT || !USER_PROMPT_TEMPLATE || !VARIABLES?.variables?.length) throw new Error(`Incomplete prompt definition: ${PROMPT_NAME}`);
  if (OUTPUT_SCHEMA?.outputs?.some((output) => output.target?.kind !== 'none')) throw new Error(`Review panel prompt ${PROMPT_NAME} must be pass-through only`);
  if (OUTPUT_SCHEMA?.parseMode !== 'json') throw new Error(`Review panel prompt ${PROMPT_NAME} must use JSON parsing`);
  for (const variable of VARIABLES.variables) {
    if (!variable.name || variable.source?.kind !== 'override' || variable.placement !== 'user') throw new Error(`Invalid variable declaration in ${PROMPT_NAME}`);
    if (variable.untrusted && (!variable.dataClass || !Number.isInteger(variable.maxChars))) {
      throw new Error(`Variable "${variable.name}" in ${PROMPT_NAME} declares untrusted:true but is missing dataClass/maxChars`);
    }
  }
  const modelValidation = validateReviewedClaudeModelValue(model);
  if (!modelValidation.valid || modelValidation.kind !== 'claude' || modelValidation.capabilities.supportsStructuredOutput !== true) {
    throw new Error(`Bootstrap model ${model} is not a reviewed structured-output Claude model.`);
  }
}

export function recordData(definition, maxTokens, notes, model) {
  return {
    wmkf_ai_promptname: definition.PROMPT_NAME,
    wmkf_ai_systemprompt: definition.SYSTEM_PROMPT,
    wmkf_ai_promptbody: definition.USER_PROMPT_TEMPLATE,
    wmkf_ai_promptvariables: JSON.stringify(definition.VARIABLES, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(definition.OUTPUT_SCHEMA, null, 2),
    wmkf_ai_model: model,
    wmkf_ai_temperature: 0.2,
    wmkf_ai_maxtokens: maxTokens,
    wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
    wmkf_ai_notes: `Virtual Review Panel Phase A bootstrap (app: review-panel). ${notes} Source: shared/config/prompts/${definition.PROMPT_NAME.replace('review-panel.', 'review-panel-')}.js.`,
  };
}

/** Dry-run plan for both rows. `planSeed` is dependency-injected — never imports prompt-seed.js at module scope, so importing this file cannot reach Dataverse. */
export async function planReviewPanelSeed({ planSeed, model = SEAT_CLAUDE_DEFAULT_MODEL, force = false, validateReviewedClaudeModelValue } = {}) {
  const results = [];
  for (const item of DEFINITIONS) {
    validateDefinition(item.definition, { validateReviewedClaudeModelValue, model });
    const plan = await planSeed({ promptName: item.definition.PROMPT_NAME, force });
    results.push({ name: item.definition.PROMPT_NAME, plan });
  }
  return results;
}

/** Apply both rows. Throws SeedRefused (re-exported by the caller's prompt-seed module) if a plan refuses. Readback-verifies wmkf_ai_promptid/version/model after each write, mirroring the dossier seeder. */
export async function executeReviewPanelSeed({ planSeed, seedPromptRow, fetchCurrentPrompt, SeedRefused, model = SEAT_CLAUDE_DEFAULT_MODEL, force = false, validateReviewedClaudeModelValue } = {}) {
  const results = [];
  for (const item of DEFINITIONS) {
    const name = item.definition.PROMPT_NAME;
    validateDefinition(item.definition, { validateReviewedClaudeModelValue, model });
    const plan = await planSeed({ promptName: name, force });
    if (plan.action === 'refuse' || plan.action === 'refuse-duplicate') {
      throw new SeedRefused(`Cannot seed ${name}: existing prompt state requires Admin publication or --force.`, plan);
    }
    const result = await seedPromptRow({ promptName: name, recordData: recordData(item.definition, item.maxTokens, item.notes, model), force });
    const current = await fetchCurrentPrompt(name);
    if (current.wmkf_ai_promptid !== result.id || Number(current.wmkf_promptversion) !== result.version || current.wmkf_ai_model !== model) {
      throw new Error(`Readback mismatch after seeding ${name}`);
    }
    results.push({ name, action: result.action, version: result.version, id: result.id });
  }
  return results;
}

function loadDotEnvOnce() {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index < 0) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    } catch { /* file may not exist */ }
  }
}

async function main() {
  loadDotEnvOnce();
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(['--dry-run', '--execute', '--force']);
  for (const arg of args) {
    if (!allowed.has(arg)) { console.error(`Unknown argument: ${arg}`); process.exit(2); }
  }
  if (args.has('--dry-run') && args.has('--execute')) { console.error('Choose exactly one of --dry-run or --execute.'); process.exit(2); }
  const EXECUTE = args.has('--execute');
  const FORCE = args.has('--force');
  if (FORCE && !EXECUTE) { console.error('--force requires --execute.'); process.exit(2); }

  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { resolveInterlockMode } = await import('../lib/dataverse/core/interlock.js');
  const { planSeed, seedPromptRow, SeedRefused } = await import('../lib/services/prompt-seed.js');
  const { validateReviewedClaudeModelValue } = await import('../lib/services/model-review-validation.js');
  const { fetchCurrentPrompt } = await import('../lib/services/prompt-store.js');

  const model = process.env.REVIEW_PANEL_PROMPT_MODEL || SEAT_CLAUDE_DEFAULT_MODEL;
  if (EXECUTE && resolveInterlockMode() !== 'on') {
    throw new Error('Refusing --execute: DATAVERSE_TARGET_INTERLOCK must be exactly "on".');
  }
  enterDynamicsBypassForScript('seed-review-panel-prompts');

  console.log(`Review panel prompt seed (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) model=${model}`);
  if (!EXECUTE) {
    const plans = await planReviewPanelSeed({ planSeed, model, force: FORCE, validateReviewedClaudeModelValue });
    for (const { name, plan } of plans) {
      console.log(`  ${name}: action=${plan.action}${plan.targetVersion ? ` version=${plan.targetVersion}` : ''}, rows=${plan.rows.length}`);
      console.log(`    would ${plan.action === 'create' ? 'create' : plan.action === 'republish' || plan.action === 'recover' ? 'publish a new version' : 'refuse'}`);
    }
    console.log('Dry run complete. Re-run with --execute only after reviewing the planned rows.');
    return;
  }
  const results = await executeReviewPanelSeed({ planSeed, seedPromptRow, fetchCurrentPrompt, SeedRefused, model, force: FORCE, validateReviewedClaudeModelValue });
  for (const { name, action, version, id } of results) console.log(`    ✓ ${name}: ${action} → v${version} (${id})`);
}

// Only run the CLI entrypoint when this file is the process's actual entry
// script (never on import — see the module docstring above).
const isDirectRun = typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('seed-review-panel-prompts.js');
if (isDirectRun) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
