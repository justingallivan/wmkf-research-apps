#!/usr/bin/env node

/**
 * Seed (or update) the `review-synthesis.generate` row in `wmkf_ai_prompts`.
 *
 * Synthesizes a proposal's submitted peer reviews (workbench Reviews tab
 * Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md) into consensus points,
 * disagreements, key concerns/risks, and a per-rating-question score-
 * distribution summary. Runs through the shared Executor
 * (lib/services/execute-prompt.js): all-override (`reviews_digest`, declared
 * untrusted — reviewer-authored text); output target
 * `akoya_request.wmkf_reviewsynthesisjson` with `guard: 'always-overwrite'`
 * (the caller route, not the Executor, gates regeneration).
 *
 * Governance (lib/services/prompt-seed.js): CREATE-ONLY by default — refuses if
 * the prompt already exists in Dataverse (admin is the governed, versioned edit
 * path; this file is a bootstrap artifact, not the live state). `--force`
 * publishes a recovery VERSION (max+1), never an in-place overwrite.
 *
 * Usage:
 *   node scripts/seed-review-synthesis-prompt.js --dry-run            # plan only
 *   node scripts/seed-review-synthesis-prompt.js --execute            # bootstrap (refuses if exists)
 *   node scripts/seed-review-synthesis-prompt.js --execute --force    # publish a recovery version
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   wmkf_ai_promptname = 'review-synthesis.generate'.
 * Prompt text source of truth: shared/config/prompts/review-synthesis.js.
 *
 * NOT run against any live environment by this session — see the plan doc for
 * the pending-provisioning status. The dependent schema column
 * (lib/dataverse/schema/wave11-review-synthesis/) must be applied BEFORE this
 * seed's target is usable — selecting/writing a not-yet-created column 400s.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { seedPromptRow, planSeed, SeedRefused } = await import('../lib/services/prompt-seed.js');
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } = await import(
  '../shared/config/prompts/review-synthesis.js'
);
enterDynamicsBypassForScript('seed-review-synthesis-prompt');

const PROMPT_NAME = 'review-synthesis.generate';

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
// Create-only by default; --force publishes a recovery version (max+1) instead of
// overwriting. See lib/services/prompt-seed.js for the governance contract.
const FORCE = process.argv.includes('--force');
if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// Picklist value for Published (confirmed Session 109 schema probe; reused by
// the other seed scripts).
const PROMPTSTATUS_PUBLISHED = 682090001;

// Variable + output declarations are the prompt config's single source of truth
// (shared/config/prompts/review-synthesis.js), imported above so the live
// wmkf_ai_prompts row cannot drift from what a unit test pins.
const promptVariables = PROMPT_VARIABLES;
const promptOutputSchema = PROMPT_OUTPUT_SCHEMA;

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier key — resolveModel() maps 'sonnet' to the current Sonnet at call time.
  // Synthesis requires holding several reviews' worth of narrative in context
  // and reasoning about agreement/disagreement — Sonnet, not Haiku.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.2,
  wmkf_ai_maxtokens: 2000,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  // wmkf_ai_iscurrent / wmkf_promptversion / wmkf_ai_publisheddatetime are set by
  // seedPromptRow (create-only + version-preserving force) — not here.
  wmkf_ai_notes:
    'AI synthesis of a proposal\'s submitted peer reviews (workbench Reviews tab Phase 4). All-override ' +
    '(reviews_digest, untrusted), parseMode json with validationSchema, output target ' +
    'akoya_request.wmkf_reviewsynthesisjson (guard always-overwrite — the caller route gates regeneration). ' +
    'Source: shared/config/prompts/review-synthesis.js.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`  promptbody:   ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode})`);
console.log(`  model:        ${recordData.wmkf_ai_model} (temp ${recordData.wmkf_ai_temperature})`);
console.log('');

if (DRY) {
  console.log('--- DRY RUN ---');
  try {
    const plan = await planSeed({ promptName: PROMPT_NAME, force: FORCE });
    const verb = {
      create: 'Would CREATE v1 (bootstrap — no rows exist)',
      republish: `Would PUBLISH v${plan.targetVersion} (force; flips the current v${plan.current[0]?.wmkf_promptversion} down)`,
      recover: `Would RECOVER as v${plan.targetVersion} (force; rows exist but none current)`,
      refuse: `Would REFUSE — ${plan.rows.length} row(s) exist (create-only). Edit via /admin, or pass --force to publish a recovery version.`,
      'refuse-duplicate': `Would REFUSE — ${plan.current.length} current rows (duplicate-current). Resolve in Dynamics.`,
    }[plan.action];
    console.log(verb);
    console.log('\n--- wmkf_ai_promptvariables ---');
    console.log(recordData.wmkf_ai_promptvariables);
    console.log('\n--- wmkf_ai_promptoutputschema ---');
    console.log(recordData.wmkf_ai_promptoutputschema);
    process.exit(0);
  } catch (err) {
    console.error('✗ Dry-run plan failed:', err.message);
    process.exit(1);
  }
}

try {
  const result = await seedPromptRow({ promptName: PROMPT_NAME, recordData, force: FORCE });
  console.log(`✓ ${result.action} → v${result.version} (current row ${result.id})`);
  console.log('\n✓ Seed complete (exactly one current row verified).');
  process.exit(0);
} catch (err) {
  if (err instanceof SeedRefused) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
  console.error('✗ Seed failed:', err.message);
  if (err.response) console.error('  response:', err.response);
  process.exit(1);
}
