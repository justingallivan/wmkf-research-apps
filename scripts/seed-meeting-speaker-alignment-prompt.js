#!/usr/bin/env node

/**
 * Seed (or update) the `meeting-transcript.speaker-alignment` row in `wmkf_ai_prompts`.
 *
 * Speaker-identity verifier for the Zoom VTT speaker mapping (plan:
 * docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md, D7/D9, section 3). Runs through the
 * shared Executor (lib/services/execute-prompt.js): all-override, all three variables
 * (speaker_samples, zoom_names, prior) declared untrusted with dataClass 'meeting_transcript' so
 * the Executor wraps them + injects the A7 preamble. JSON output keyed by speaker ID, single
 * output `verdict` with target kind:'none' (returned to the caller, never persisted),
 * rawOutputRetention 'none'.
 *
 * Caller: lib/services/meeting-tracker-transcription/alignment-service.js (stage 5, not yet
 * built). It will pass the options requireNoPersistence: true and auditRetention: 'content-free'.
 * The returned verdict is re-checked by verifyAlignmentVerdict (lib/services/transcription-pilot/zoom-vtt.js).
 *
 * Governance (lib/services/prompt-seed.js): CREATE-ONLY by default — refuses if the
 * prompt already exists in Dataverse (admin is the governed, versioned edit path; this
 * file is a bootstrap artifact, not the live state). `--force` publishes a recovery
 * VERSION (max+1), never an in-place overwrite.
 *
 * Usage:
 *   node scripts/seed-meeting-speaker-alignment-prompt.js --dry-run            # plan only
 *   node scripts/seed-meeting-speaker-alignment-prompt.js --execute            # bootstrap (refuses if exists)
 *   node scripts/seed-meeting-speaker-alignment-prompt.js --execute --force    # publish a recovery version
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   wmkf_ai_promptname = 'meeting-transcript.speaker-alignment'.
 * Prompt text source of truth: shared/config/prompts/meeting-speaker-alignment.js.
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
  '../shared/config/prompts/meeting-speaker-alignment.js'
);
enterDynamicsBypassForScript('seed-meeting-speaker-alignment-prompt');

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
// (shared/config/prompts/meeting-speaker-alignment.js), imported above so the live
// wmkf_ai_prompts row cannot drift from the file a unit test pins.
const promptVariables = PROMPT_VARIABLES;
const promptOutputSchema = PROMPT_OUTPUT_SCHEMA;

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier alias per plan D7 — resolveModel() maps 'sonnet' to the current reviewed Sonnet at
  // call time. Temperature 0 (deterministic verification); the Executor omits it for
  // reviewed temperature-less models.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0,
  wmkf_ai_maxtokens: 16384,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  // wmkf_ai_iscurrent / wmkf_promptversion / wmkf_ai_publisheddatetime are set by
  // seedPromptRow (create-only + version-preserving force) — not here.
  wmkf_ai_notes:
    'Zoom VTT speaker-alignment verifier. All-override; speaker_samples/zoom_names/prior untrusted ' +
    '(dataClass meeting_transcript); parseMode json keyed by speaker ID; output verdict target kind:none; ' +
    'rawOutputRetention none. Caller passes requireNoPersistence + auditRetention content-free. Source: ' +
    'shared/config/prompts/meeting-speaker-alignment.js.',
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
