#!/usr/bin/env node

/**
 * Seed (or update) the `meeting-transcript.presentation-summary` row in `wmkf_ai_prompts`.
 *
 * Site Visit presentation summary (plan:
 * docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md §4.3, §16). Runs through
 * the shared Executor (lib/services/execute-prompt.js): all-override; presentation_transcript
 * (dataClass 'meeting_transcript') and presentation_slides (dataClass 'applicant_material') are
 * declared untrusted so the Executor wraps them + injects the A7 preamble. Plain-text output,
 * single output `summary` with target kind:'none' (returned to the caller, never persisted by the
 * Executor), rawOutputRetention 'none'.
 *
 * Caller: lib/services/post-presentation-materials/transcript-summary-service.js. It passes
 * requireNoPersistence: true and auditRetention: 'content-free', and stores the text only as a
 * staff-reviewed draft (meeting_transcript_summary_drafts) until a program coordinator publishes it.
 *
 * Model: 'sonnet' on the prompt row (owner decision 2026-10-05, plan §16 decision B). The Executor
 * takes the model from the prompt row and has no fallback swap. The output budget is the
 * code-owned standing default in shared/config/executorBudgets.js (Admin-tunable).
 *
 * Governance (lib/services/prompt-seed.js): CREATE-ONLY by default — refuses if the
 * prompt already exists in Dataverse (admin is the governed, versioned edit path; this
 * file is a bootstrap artifact, not the live state). `--force` publishes a recovery
 * VERSION (max+1), never an in-place overwrite.
 *
 * Usage (owner-run; Dataverse writes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD UTC>"):
 *   node scripts/seed-meeting-presentation-summary-prompt.js --dry-run            # plan only
 *   node scripts/seed-meeting-presentation-summary-prompt.js --execute            # bootstrap (refuses if exists)
 *   node scripts/seed-meeting-presentation-summary-prompt.js --execute --force    # publish a recovery version
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   wmkf_ai_promptname = 'meeting-transcript.presentation-summary'.
 * Prompt text source of truth: shared/config/prompts/meeting-presentation-summary.js.
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
const { PROMPT_NAME, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } = await import(
  '../shared/config/prompts/meeting-presentation-summary.js'
);
enterDynamicsBypassForScript('seed-meeting-presentation-summary-prompt');

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
// (shared/config/prompts/meeting-presentation-summary.js), imported above so the live
// wmkf_ai_prompts row cannot drift from the file a unit test pins.
const promptVariables = PROMPT_VARIABLES;
const promptOutputSchema = PROMPT_OUTPUT_SCHEMA;

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier alias (plan §16 decision B) — resolveModel() maps 'sonnet' to the current reviewed
  // Sonnet at call time. Low temperature for a faithful summary; the Executor omits it for
  // reviewed temperature-less models. The standing Executor budget overrides max tokens.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.2,
  wmkf_ai_maxtokens: 16000,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  // wmkf_ai_iscurrent / wmkf_promptversion / wmkf_ai_publisheddatetime are set by
  // seedPromptRow (create-only + version-preserving force) — not here.
  wmkf_ai_notes:
    'Site Visit presentation summary. All-override; presentation_transcript (meeting_transcript) and ' +
    'presentation_slides (applicant_material) untrusted; parseMode raw; output summary target kind:none; ' +
    'rawOutputRetention none. Caller passes requireNoPersistence + auditRetention content-free and keeps the ' +
    'text as a staff-reviewed draft until published. Source: shared/config/prompts/meeting-presentation-summary.js.',
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
