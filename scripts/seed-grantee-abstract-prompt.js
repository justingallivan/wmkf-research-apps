#!/usr/bin/env node

/**
 * Seed (or update) the `grantee-abstract.generate` row in `wmkf_ai_prompts`.
 *
 * Rewrites the applicant-authored abstract (`akoya_request.wmkf_abstract`) into
 * the Foundation house style for the Grantee Deliverables Portal. Runs through
 * the shared Executor (lib/services/execute-prompt.js): all-override (no
 * requestId required), `source_abstract` declared untrusted so the Executor
 * wraps it + injects the A7 preamble, output target kind:'none' so the rewritten
 * abstract is RETURNED to the caller (the caller writes wmkf_abstractformatted
 * with an idempotent lease — see docs/GRANTEE_PORTAL_BUILD_PLAN.md chunk 3).
 *
 * Plain-prose output → parseMode:'raw', a single output `abstract_formatted`.
 * Raw mode ignores jsonSchema, so none is declared (Codex chunk-2 review).
 *
 * Governance (lib/services/prompt-seed.js): CREATE-ONLY by default — refuses if the
 * prompt already exists in Dataverse (admin is the governed, versioned edit path; this
 * file is a bootstrap artifact, not the live state). `--force` publishes a recovery
 * VERSION (max+1), never an in-place overwrite. NOTE: this prompt is already seeded in
 * prod, so a plain `--execute` now refuses by design.
 *
 * Usage:
 *   node scripts/seed-grantee-abstract-prompt.js --dry-run            # plan only
 *   node scripts/seed-grantee-abstract-prompt.js --execute            # bootstrap (refuses if exists)
 *   node scripts/seed-grantee-abstract-prompt.js --execute --force    # publish a recovery version
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   wmkf_ai_promptname = 'grantee-abstract.generate'.
 * Prompt text source of truth: shared/config/prompts/grantee-abstract.js.
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
  '../shared/config/prompts/grantee-abstract.js'
);
enterDynamicsBypassForScript('seed-grantee-abstract-prompt');

const PROMPT_NAME = 'grantee-abstract.generate';

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
// seed-field-primer-prompt.js / seed-phase-i-summary-prompt.js).
const PROMPTSTATUS_PUBLISHED = 682090001;

// Variable + output declarations are the prompt config's single source of truth
// (shared/config/prompts/grantee-abstract.js), imported above so the live
// wmkf_ai_prompts row cannot drift from the file a unit test pins. source_abstract
// is untrusted (Executor wraps it + injects the A7 preamble); output is raw, one
// pass-through `abstract_formatted` (kind:'none' → returned), no jsonSchema.
const promptVariables = PROMPT_VARIABLES;
const promptOutputSchema = PROMPT_OUTPUT_SCHEMA;

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier key — resolveModel() maps 'sonnet' to the current Sonnet at call time.
  // Sonnet (not opus): the current Opus tier REJECTS the `temperature` parameter
  // and the Executor sends the row's temperature unconditionally (field-primer
  // precedent). Sonnet accepts temperature and handles this structured rewrite well.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.3,
  wmkf_ai_maxtokens: 4096,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  // wmkf_ai_iscurrent / wmkf_promptversion / wmkf_ai_publisheddatetime are set by
  // seedPromptRow (create-only + version-preserving force) — not here.
  wmkf_ai_notes:
    'Grantee abstract house-style rewrite (S268). All-override (no requestId), source_abstract ' +
    'untrusted, parseMode raw, output target kind:none (returned, not persisted — caller writes ' +
    'wmkf_abstractformatted with an idempotent lease, chunk 3). Source: shared/config/prompts/grantee-abstract.js.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`  promptbody:   ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode})`);
console.log(`  model:        ${recordData.wmkf_ai_model}`);
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
