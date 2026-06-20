#!/usr/bin/env node

/**
 * Seed (or update) the `grantee-title.generate` row in `wmkf_ai_prompts`.
 *
 * Distills an applicant's project title (`akoya_request.akoya_title`) + abstract
 * (`akoya_request.wmkf_abstract`) into a single house-style one-line objective
 * for the Board Book / award summary (Grantee Deliverables Portal, S269). Runs
 * through the shared Executor (lib/services/execute-prompt.js): all-override (no
 * requestId required); BOTH source_title and source_abstract declared untrusted
 * so the Executor wraps them + injects the A7 preamble; output target kind:'none'
 * so the one-liner is RETURNED to the caller (the chunk-7 cron writes it to
 * wmkf_wmkfprojectdescription ONLY when empty — see docs/GRANTEE_PORTAL_BUILD_PLAN.md).
 *
 * Plain one-line output → parseMode:'raw', a single output `edited_title`. Raw
 * mode ignores jsonSchema, so none is declared.
 *
 * Usage:
 *   node scripts/seed-grantee-title-prompt.js --dry-run
 *   node scripts/seed-grantee-title-prompt.js --execute
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   key wmkf_ai_promptname = 'grantee-title.generate' AND wmkf_ai_iscurrent = true.
 * Prompt text source of truth: shared/config/prompts/grantee-title.js.
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

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } = await import(
  '../shared/config/prompts/grantee-title.js'
);
enterDynamicsBypassForScript('seed-grantee-title-prompt');

const PROMPT_NAME = 'grantee-title.generate';
const ENTITY_SET = 'wmkf_ai_prompts';

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// Picklist value for Published (confirmed Session 109 schema probe; reused by
// the other seed scripts).
const PROMPTSTATUS_PUBLISHED = 682090001;

// Variable + output declarations are the prompt config's single source of truth
// (shared/config/prompts/grantee-title.js), imported above so the live
// wmkf_ai_prompts row cannot drift from the file a unit test pins. Both
// source_title and source_abstract are untrusted (Executor wraps them + injects
// the A7 preamble); output is raw, one pass-through `edited_title` (kind:'none' →
// returned), no jsonSchema.
const promptVariables = PROMPT_VARIABLES;
const promptOutputSchema = PROMPT_OUTPUT_SCHEMA;

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier key — resolveModel() maps 'sonnet' to the current Sonnet at call time.
  // Sonnet (validated S269 against 12 J26 answer keys): materially better than
  // Haiku on this distillation, and the Opus tier REJECTS the `temperature`
  // parameter the Executor sends unconditionally. temperature 0.1 for run-to-run
  // consistency (the residual length variance is sampling, not the prompt).
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.1,
  wmkf_ai_maxtokens: 100,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_iscurrent: true,
  wmkf_promptversion: 1,
  wmkf_ai_publisheddatetime: new Date().toISOString(),
  wmkf_ai_notes:
    'Grantee edited-title (board-summary objective) generation (S269). All-override (no requestId), ' +
    'source_title + source_abstract untrusted, parseMode raw, output target kind:none (returned, not ' +
    'persisted — the chunk-7 cron writes wmkf_wmkfprojectdescription when empty). Source: ' +
    'shared/config/prompts/grantee-title.js.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`  promptbody:   ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode})`);
console.log(`  model:        ${recordData.wmkf_ai_model} (temp ${recordData.wmkf_ai_temperature})`);
console.log('');

const existing = await DynamicsService.queryRecords(ENTITY_SET, {
  select: 'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent',
  filter: `wmkf_ai_promptname eq '${PROMPT_NAME}' and wmkf_ai_iscurrent eq true`,
  top: 2,
});
const matches = existing?.records || [];
if (matches.length > 1) {
  console.error(`✗ Multiple current rows found for ${PROMPT_NAME} — aborting. Resolve manually.`);
  process.exit(1);
}
const existingId = matches[0]?.wmkf_ai_promptid || null;

if (DRY) {
  console.log('--- DRY RUN ---');
  console.log(existingId ? `Would UPDATE wmkf_ai_prompts(${existingId})` : 'Would CREATE new wmkf_ai_prompts row');
  console.log('\n--- wmkf_ai_promptvariables ---');
  console.log(recordData.wmkf_ai_promptvariables);
  console.log('\n--- wmkf_ai_promptoutputschema ---');
  console.log(recordData.wmkf_ai_promptoutputschema);
  process.exit(0);
}

let recordId;
try {
  if (existingId) {
    console.log(`Updating existing row: wmkf_ai_prompts(${existingId})`);
    await DynamicsService.updateRecord(ENTITY_SET, existingId, recordData);
    recordId = existingId;
  } else {
    console.log('Creating new row in wmkf_ai_prompts');
    const created = await DynamicsService.createRecord(ENTITY_SET, recordData);
    recordId = created?.wmkf_ai_promptid || created?.id || null;
    if (!recordId) {
      const rb = await DynamicsService.queryRecords(ENTITY_SET, {
        select: 'wmkf_ai_promptid',
        filter: `wmkf_ai_promptname eq '${PROMPT_NAME}' and wmkf_ai_iscurrent eq true`,
        top: 1,
      });
      recordId = (rb?.records || [])[0]?.wmkf_ai_promptid;
    }
  }
  console.log(`✓ Wrote row: ${recordId}`);
} catch (err) {
  console.error('✗ Write failed:', err.message);
  if (err.response) console.error('  response:', err.response);
  process.exit(1);
}

try {
  const verified = await DynamicsService.getRecord(ENTITY_SET, recordId, {
    select: ['wmkf_ai_promptname', 'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model', 'wmkf_ai_iscurrent'].join(','),
  });
  let ok = verified.wmkf_ai_promptname === PROMPT_NAME && verified.wmkf_ai_iscurrent === true;
  try {
    const vars = JSON.parse(verified.wmkf_ai_promptvariables);
    const out = JSON.parse(verified.wmkf_ai_promptoutputschema);
    console.log(`  ✓ round-trip: ${vars.variables.length} variable(s), ${out.outputs.length} output(s) (parseMode=${out.parseMode})`);
  } catch (e) {
    console.error(`  ✗ JSON round-trip failed: ${e.message}`);
    ok = false;
  }
  console.log(ok ? '\n✓ All verification checks passed.' : '\n✗ Verification mismatch.');
  process.exit(ok ? 0 : 2);
} catch (err) {
  console.error('✗ Verification read failed:', err.message);
  process.exit(1);
}
