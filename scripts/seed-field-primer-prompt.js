#!/usr/bin/env node

/**
 * Seed (or update) the `field-primer.generate` row in `wmkf_ai_prompts`.
 *
 * The field primer is a standalone, staff-facing overview of a proposal's
 * RESEARCH FIELD (not an evaluation, not a reviewer recommendation). It runs
 * through the shared Executor (lib/services/execute-prompt.js): an all-override
 * prompt (no requestId required), proposal_text declared untrusted so the
 * Executor wraps it + injects the A7 preamble, output target kind:'none' so the
 * primer is RETURNED to the caller and never written back to akoya_request.
 *
 * Knowledge-only v1 (no web/literature access). A web-grounded literature-search
 * increment is a next-cycle follow-up. The primer MAY name experts because it is
 * never a reviewer-candidate source — see shared/config/prompts/field-primer.js.
 *
 * Usage:
 *   node scripts/seed-field-primer-prompt.js --dry-run
 *   node scripts/seed-field-primer-prompt.js --execute
 *
 * Target (prod Dynamics — via .env.local): entity wmkf_ai_prompts,
 *   key wmkf_ai_promptname = 'field-primer.generate' AND wmkf_ai_iscurrent = true.
 * Prompt text source of truth: shared/config/prompts/field-primer.js.
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
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = await import(
  '../shared/config/prompts/field-primer.js'
);
enterDynamicsBypassForScript('seed-field-primer-prompt');

const PROMPT_NAME = 'field-primer.generate';
const ENTITY_SET = 'wmkf_ai_prompts';

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// Picklist value for Published (confirmed Session 109 schema probe; reused by
// seed-phase-i-summary-prompt.js).
const PROMPTSTATUS_PUBLISHED = 682090001;

const promptVariables = {
  variables: [
    {
      name: 'proposal_text',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      // Data classification + payload boundary. Proposal text is grantee-authored
      // → untrusted: the Executor wraps it in nonce sentinels (wrapUntrustedContent)
      // and injects the hardening preamble so embedded instructions cannot hijack
      // the primer. `untrusted: true` REQUIRES dataClass + maxChars (the wrapper
      // needs a cap) — see lib/services/execute-prompt.js applyVariableBoundaries.
      dataClass: 'proposal_text',
      maxChars: 100000,
      untrusted: true,
    },
    {
      // Optional staff steer, e.g. " Focus especially on the materials-science
      // angle." (leading space — concatenated into the user prompt). Default ''.
      name: 'focus_hint',
      source: { kind: 'override', default: '' },
      required: false,
      cacheable: false,
      placement: 'user',
    },
  ],
};

const SECTION_KEYS = [
  'field_overview',
  'subareas',
  'key_methods',
  'frontiers',
  'communities',
  'venues',
  'experts',
  'proposal_placement',
  'caveats',
];

const promptOutputSchema = {
  // Single pass-through output: the parsed primer object is RETURNED to the
  // caller (result.parsed) and never persisted. `outputs` only drives
  // persistence; kind:'none' is skipped, so no akoya_request writeback and no
  // requestId is required. The parsed object itself is the full primer (the
  // section keys below), enforced by jsonSchema.required.
  outputs: [{ name: 'primer', type: 'object', target: { kind: 'none' } }],
  parseMode: 'json',
  jsonSchema: {
    type: 'object',
    required: SECTION_KEYS,
    properties: {
      field_overview: { type: 'string' },
      subareas: { type: 'array', items: { type: 'object' } },
      key_methods: { type: 'array', items: { type: 'object' } },
      frontiers: { type: 'array', items: { type: 'object' } },
      communities: { type: 'array', items: { type: 'object' } },
      venues: { type: 'array', items: { type: 'string' } },
      experts: { type: 'array', items: { type: 'object' } },
      proposal_placement: { type: 'string' },
      caveats: { type: 'string' },
    },
  },
  // No akoya_request writeback, so keep the full primer in the run log for
  // audit/replay (the primer is not persisted anywhere else).
  rawOutputRetention: 'full',
};

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier key — resolveModel() maps 'sonnet' to the current Sonnet at call time.
  // Sonnet (not opus): the current Opus tier REJECTS the `temperature` parameter
  // ("deprecated for this model", live 400 on first run S248), and the Executor
  // sends the row's temperature unconditionally. Sonnet accepts temperature and
  // handles this structured-synthesis task well. Revisit opus only if the
  // Executor is taught to omit temperature for temperature-less models.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.3,
  wmkf_ai_maxtokens: 16384,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_iscurrent: true,
  wmkf_promptversion: 1,
  wmkf_ai_publisheddatetime: new Date().toISOString(),
  wmkf_ai_notes:
    'Field primer (S248). Standalone staff field overview; all-override (no requestId), ' +
    'proposal_text untrusted, output target kind:none (returned, not persisted). ' +
    'Knowledge-only v1; web-grounded literature search is a next-cycle follow-up. ' +
    'Source: shared/config/prompts/field-primer.js.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`  promptbody:   ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode}, ${SECTION_KEYS.length} required keys)`);
console.log(`  model:        ${recordData.wmkf_ai_model}`);
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
    console.log(`  ✓ round-trip: ${vars.variables.length} variables, ${out.outputs.length} outputs (parseMode=${out.parseMode})`);
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
