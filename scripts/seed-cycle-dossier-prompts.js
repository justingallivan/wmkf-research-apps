#!/usr/bin/env node
/**
 * Governed bootstrap for the two Cycle Dossier Executor prompts.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/seed-cycle-dossier-prompts.js --dry-run
 *   Add --apply instead of --dry-run to create/publish rows; add --force only
 *   for explicitly reviewed versioned recovery. No flag defaults to dry-run.
 *
 * --apply performs Dataverse writes. It never overwrites a prompt row in place:
 * prompt-seed creates a new version and flips the prior current row by ETag.
 * The target interlock must be enforcing before --apply.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  } catch {}
}

const args = new Set(process.argv.slice(2));
const allowed = new Set(['--dry-run', '--apply', '--force']);
for (const arg of args) {
  if (!allowed.has(arg)) {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}
if (args.has('--dry-run') && args.has('--apply')) {
  console.error('Choose exactly one of --dry-run or --apply.');
  process.exit(2);
}
const APPLY = args.has('--apply');
const FORCE = args.has('--force');
if (FORCE && !APPLY) {
  console.error('--force requires --apply.');
  process.exit(2);
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { resolveInterlockMode } = await import('../lib/dataverse/core/interlock.js');
const { planSeed, seedPromptRow, SeedRefused } = await import('../lib/services/prompt-seed.js');
const { validateReviewedClaudeModelValue } = await import('../lib/services/model-review-validation.js');
const { fetchCurrentPrompt } = await import('../lib/services/prompt-store.js');
const research = await import('../shared/config/prompts/cycle-dossier-research-plan.js');
const entry = await import('../shared/config/prompts/cycle-dossier-entry.js');

const PROMPTSTATUS_PUBLISHED = 682090001;
const MODEL = process.env.CYCLE_DOSSIER_PROMPT_MODEL || 'claude-sonnet-4-6';
const definitions = [
  { definition: research, maxTokens: 3000, notes: 'Bounded literature query planner; pass-through only.' },
  { definition: entry, maxTokens: 12000, notes: 'Private five-section scientific briefing; pass-through only.' },
];

function validateDefinition(definition) {
  const { PROMPT_NAME, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, VARIABLES, OUTPUT_SCHEMA } = definition;
  if (!/^cycle-dossier\.(research-plan|entry)$/.test(PROMPT_NAME)) throw new Error(`Invalid dossier prompt name: ${PROMPT_NAME}`);
  if (!SYSTEM_PROMPT || !USER_PROMPT_TEMPLATE || !VARIABLES?.variables?.length) throw new Error(`Incomplete prompt definition: ${PROMPT_NAME}`);
  if (OUTPUT_SCHEMA?.outputs?.some((output) => output.target?.kind !== 'none')) throw new Error(`Dossier prompt ${PROMPT_NAME} must be pass-through only`);
  if (OUTPUT_SCHEMA?.parseMode !== 'json') throw new Error(`Dossier prompt ${PROMPT_NAME} must use JSON parsing`);
  for (const variable of VARIABLES.variables) {
    if (!variable.name || variable.source?.kind !== 'override' || variable.placement !== 'user') throw new Error(`Invalid variable declaration in ${PROMPT_NAME}`);
  }
  const modelValidation = validateReviewedClaudeModelValue(MODEL);
  if (!modelValidation.valid || modelValidation.kind !== 'claude' || modelValidation.capabilities.supportsStructuredOutput !== true) {
    throw new Error(`Bootstrap model ${MODEL} is not a reviewed structured-output Claude model.`);
  }
}

function recordData(definition, maxTokens, notes) {
  return {
    wmkf_ai_promptname: definition.PROMPT_NAME,
    wmkf_ai_systemprompt: definition.SYSTEM_PROMPT,
    wmkf_ai_promptbody: definition.USER_PROMPT_TEMPLATE,
    wmkf_ai_promptvariables: JSON.stringify(definition.VARIABLES, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(definition.OUTPUT_SCHEMA, null, 2),
    wmkf_ai_model: MODEL,
    wmkf_ai_temperature: 0.2,
    wmkf_ai_maxtokens: maxTokens,
    wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
    wmkf_ai_notes: `Cycle Dossier D26 bootstrap. ${notes} Source: shared/config/prompts/${definition.PROMPT_NAME.replace('cycle-dossier.', 'cycle-dossier-')}.js.`,
  };
}

for (const item of definitions) validateDefinition(item.definition);
if (APPLY && resolveInterlockMode() !== 'on') {
  throw new Error('Refusing --apply: DATAVERSE_TARGET_INTERLOCK must be exactly "on".');
}
enterDynamicsBypassForScript('seed-cycle-dossier-prompts');

console.log(`Cycle Dossier prompt seed (${APPLY ? 'APPLY' : 'DRY RUN'}) model=${MODEL}`);
for (const item of definitions) {
  const name = item.definition.PROMPT_NAME;
  const plan = await planSeed({ promptName: name, force: FORCE });
  console.log(`  ${name}: action=${plan.action}${plan.targetVersion ? ` version=${plan.targetVersion}` : ''}, rows=${plan.rows.length}`);
  if (!APPLY) {
    console.log(`    would ${plan.action === 'create' ? 'create' : plan.action === 'republish' || plan.action === 'recover' ? 'publish a new version' : 'refuse'}`);
    continue;
  }
  if (plan.action === 'refuse' || plan.action === 'refuse-duplicate') {
    throw new SeedRefused(`Cannot seed ${name}: existing prompt state requires Admin publication or --force.`, plan);
  }
  const result = await seedPromptRow({
    promptName: name,
    recordData: recordData(item.definition, item.maxTokens, item.notes),
    force: FORCE,
  });
  const current = await fetchCurrentPrompt(name);
  if (current.wmkf_ai_promptid !== result.id || Number(current.wmkf_promptversion) !== result.version || current.wmkf_ai_model !== MODEL) {
    throw new Error(`Readback mismatch after seeding ${name}`);
  }
  console.log(`    ✓ ${result.action} → v${result.version} (${result.id})`);
}
if (!APPLY) console.log('Dry run complete. Re-run with --apply only after reviewing the planned rows.');
