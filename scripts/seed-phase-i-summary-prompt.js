#!/usr/bin/env node

/**
 * Seed (or update) the `phase-i.summary` row in `wmkf_ai_prompt`.
 *
 * This is the first real row in the new prompt table — the one the Phase 0
 * Executor (Session 110+) will resolve by name. See docs/EXECUTOR_CONTRACT.md.
 *
 * Usage:
 *   node scripts/seed-phase-i-summary-prompt.js --dry-run
 *   node scripts/seed-phase-i-summary-prompt.js --execute
 *
 * Target (prod Dynamics — wmkf.crm.dynamics.com via .env.local):
 *   Entity: wmkf_ai_prompts
 *   Key:    wmkf_ai_promptname = 'phase-i.summary' AND wmkf_ai_iscurrent = true
 *
 * Note: there is no separate "AI sandbox" Dynamics environment. The sandbox
 * at orgd9e66399.crm.dynamics.com is for schema-migration work (Wave 1+);
 * AI prompt rows + per-request writebacks are reversible enough to author
 * directly in prod. wmkf_ai_prompt was built by Connor on prod.
 *
 * Prompt text source of truth:
 *   shared/config/prompts/phase-i-dynamics.js (SYSTEM_PROMPT + USER_PROMPT_TEMPLATE)
 *   — byte-identical to what Session 103 summarize-v2.js ships today.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PHASE 0 COMPROMISE — read before changing variable declarations
 * ──────────────────────────────────────────────────────────────────────────
 * The contract (EXECUTOR_CONTRACT.md § Metadata shapes) states that in v0,
 * every variable must declare `placement: "user"`. Strict reading: the system
 * prompt should be fully static and all {{var}} slots should live in
 * wmkf_ai_promptbody.
 *
 * Reality for phase-i.summary: the canonical text (unchanged since v2 shipped
 * in Session 103) puts {{summary_length}}, {{summary_length_suffix}}, and
 * {{audience_description}} inside the SYSTEM prompt. Three of the four
 * variables are actually system-interpolated.
 *
 * We chose Option B (see Session 110 hand-off): keep the text as-is to avoid
 * prompt-quality drift a week before cycle start. All four variables are
 * declared with `placement: "user"` anyway (the only legal Phase 0 value),
 * and the Phase 0 Executor interpolates {{var}} across BOTH system and body.
 *
 * Consequence: within-prompt cache alignment still works (same three values
 * across reruns → cache hit), but the declaration does not reflect physical
 * placement. Phase 2 `placement: "system"` will reconcile this cleanly when
 * context blocks arrive; at that point the right call is probably a real
 * restructure that moves the three parameter vars into user, leaving system
 * truly static.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Output schema — single raw-text output for Phase 0
 * ──────────────────────────────────────────────────────────────────────────
 * The contract example shows multi-output JSON (summary + keywords). For
 * phase-i.summary v1 we keep it single-output, raw-text: Claude returns the
 * summary directly (no JSON wrapping, no keywords extraction). This matches
 * what summarize-v2.js ships today and keeps the prompt-text unchanged.
 *
 * We signal this with `"parseMode": "raw"` on the output schema — a Phase 0
 * extension the Executor will honor: when parseMode is raw and there's
 * exactly one output, the full Claude response text becomes that output's
 * value, no jsonSchema validation performed.
 *
 * Future prompts (e.g., phase-i.compliance) that need structured output will
 * set parseMode to "json" (the default) and request JSON from Claude.
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
  '../shared/config/prompts/phase-i-dynamics.js'
);
enterDynamicsBypassForScript('seed-phase-i-summary-prompt');

const PROMPT_NAME = 'phase-i.summary';
const ENTITY_SET = 'wmkf_ai_prompts';

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// Picklist value for Published — confirmed in Session 109 schema probe.
// (If this ever drifts, re-query: EntityDefinitions(LogicalName='wmkf_ai_prompt')
//  /Attributes(LogicalName='wmkf_ai_promptstatus')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata)
const PROMPTSTATUS_PUBLISHED = 682090001;

// ────────────────────────────────────────────────────────────────────────────
// Variable declarations — all placement: user (Phase 0 constraint).
// See "PHASE 0 COMPROMISE" header comment above for why three of these are
// actually interpolated into the system block despite being declared user.
// ────────────────────────────────────────────────────────────────────────────
const promptVariables = {
  variables: [
    {
      name: 'proposal_text',
      // Phase 0: callers (summarize-v2.js, future PA flows that pre-load
      // files) pass the proposal text in via overrideVariables. The route
      // owns file-source ambiguity (uploads vs. user-picked SharePoint vs.
      // future drag-drop) and hands the Executor a single string. Phase 1+
      // can add `source.kind: "sharepoint"` with auto-discovery for PA
      // flows that trigger autonomously from Dynamics state.
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      // Data classification + payload boundary (added 2026-05-04). The
      // Executor applies a payload boundary uniformly when both fields
      // are declared. Source string in audit logs / prompts:
      //   executor.phase-i.summary.proposal_text
      // Cap matches BATCH_PHASE_I_PROPOSAL_MAX_CHARS so callers no longer
      // need to apply their own substring before passing the value.
      dataClass: 'proposal_text',
      maxChars: 100000,
      // A7 Part 2: the proposal is grantee-authored — untrusted. The Executor
      // wraps it in nonce-bearing sentinels (wrapUntrustedContent) and injects
      // the hardening preamble into the system prompt so embedded instructions
      // in the proposal cannot hijack the summarization. Re-run this seed with
      // --execute to push the declaration to the live wmkf_ai_prompts row.
      untrusted: true,
    },
    {
      name: 'summary_length',
      source: { kind: 'override', default: 1 },
      required: false,
      cacheable: false,
      placement: 'user',
    },
    {
      name: 'summary_length_suffix',
      // Derived from summary_length (> 1 ? 's' : '').
      // Phase 0 Executor doesn't support derived variables, so the caller
      // supplies this. When summarize-v2.js becomes the reference call site,
      // it computes and passes it via overrideVariables.
      source: { kind: 'override', default: '' },
      required: false,
      cacheable: false,
      placement: 'user',
    },
    {
      name: 'audience_description',
      source: {
        kind: 'override',
        default:
          'a technical non-expert audience, using some technical terms but explaining complex concepts clearly',
      },
      required: false,
      cacheable: false,
      placement: 'user',
    },
  ],
};

const promptOutputSchema = {
  outputs: [
    {
      name: 'summary',
      type: 'string',
      target: { kind: 'akoya_request', field: 'wmkf_ai_summary' },
      // Default Phase 0 guard for human-curated narrative fields.
      // Executor preflights this field; if populated and caller did not pass
      // forceOverwrite=true, run is blocked before Claude is called.
      // See EXECUTOR_CONTRACT.md § Output guards.
      guard: 'skip-if-populated',
    },
  ],
  // Phase 0 extension: Executor treats the full Claude response text as the
  // value of the single output. No JSON wrapping, no schema validation.
  // See header comment "Output schema — single raw-text output for Phase 0".
  parseMode: 'raw',
  // The summary is already written to akoya_request.wmkf_ai_summary. Keep
  // wmkf_ai_run useful for audit/replay correlation without duplicating the
  // full generated narrative in the raw-output log.
  rawOutputRetention: 'hash',
};

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Tier key, not a concrete id — the Executor's resolveModel() maps 'sonnet'
  // to the current Sonnet (claude-sonnet-4-6), so the row never goes stale.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.3,
  wmkf_ai_maxtokens: 16384,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_iscurrent: true,
  wmkf_promptversion: 1,
  wmkf_ai_publisheddatetime: new Date().toISOString(),
  wmkf_ai_notes:
    'Phase 0 seed (Session 110). See docs/EXECUTOR_CONTRACT.md. ' +
    'NOTE: three of four declared user-placement variables are physically ' +
    'interpolated into the system prompt — intentional Phase 0 compromise; ' +
    'see seed-phase-i-summary-prompt.js for rationale.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`  promptbody:   ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode})`);
console.log(`  model:        ${recordData.wmkf_ai_model}`);
console.log(`  version:      ${recordData.wmkf_promptversion}`);
console.log('');

// Look for an existing current row by name.
const existing = await DynamicsService.queryRecords(ENTITY_SET, {
  select: 'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent',
  filter: `wmkf_ai_promptname eq '${PROMPT_NAME}' and wmkf_ai_iscurrent eq true`,
  top: 2,
});

const matches = existing?.records || [];
if (matches.length > 1) {
  console.error(`✗ Multiple current rows found for ${PROMPT_NAME} — aborting. Resolve manually.`);
  for (const m of matches) console.error('  ', m.wmkf_ai_promptid, 'v=' + m.wmkf_promptversion);
  process.exit(1);
}

const existingId = matches[0]?.wmkf_ai_promptid || null;

if (DRY) {
  console.log('--- DRY RUN ---');
  console.log(existingId ? `Would UPDATE wmkf_ai_prompts(${existingId})` : 'Would CREATE new wmkf_ai_prompts row');
  console.log('\n--- wmkf_ai_promptvariables (pretty) ---');
  console.log(recordData.wmkf_ai_promptvariables);
  console.log('\n--- wmkf_ai_promptoutputschema (pretty) ---');
  console.log(recordData.wmkf_ai_promptoutputschema);
  console.log('\n--- systemprompt preview (first 300) ---');
  console.log(SYSTEM_PROMPT.substring(0, 300) + '…');
  console.log('\n--- promptbody preview (first 300) ---');
  console.log(USER_PROMPT_TEMPLATE.substring(0, 300) + (USER_PROMPT_TEMPLATE.length > 300 ? '…' : ''));
  process.exit(0);
}

// ── Execute ──
let recordId;
try {
  if (existingId) {
    console.log(`Updating existing row: wmkf_ai_prompts(${existingId})`);
    await DynamicsService.updateRecord(ENTITY_SET, existingId, recordData);
    recordId = existingId;
  } else {
    console.log(`Creating new row in wmkf_ai_prompts`);
    const created = await DynamicsService.createRecord(ENTITY_SET, recordData);
    recordId = created?.wmkf_ai_promptid || created?.id || null;
    if (!recordId) {
      console.warn('⚠ Create returned but no id field — attempting read-back by name');
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

// Verify round-trip.
try {
  const verified = await DynamicsService.getRecord(ENTITY_SET, recordId, {
    select: [
      'wmkf_ai_promptname',
      'wmkf_ai_systemprompt',
      'wmkf_ai_promptbody',
      'wmkf_ai_promptvariables',
      'wmkf_ai_promptoutputschema',
      'wmkf_ai_model',
      'wmkf_ai_temperature',
      'wmkf_ai_maxtokens',
      'wmkf_ai_iscurrent',
      'wmkf_promptversion',
      'wmkf_ai_promptstatus',
    ].join(','),
  });

  const checks = [
    ['promptname', verified.wmkf_ai_promptname, PROMPT_NAME],
    ['systemprompt.length', (verified.wmkf_ai_systemprompt || '').length, SYSTEM_PROMPT.length],
    ['promptbody.length', (verified.wmkf_ai_promptbody || '').length, USER_PROMPT_TEMPLATE.length],
    ['model', verified.wmkf_ai_model, recordData.wmkf_ai_model],
    ['iscurrent', verified.wmkf_ai_iscurrent, true],
    ['version', verified.wmkf_promptversion, 1],
    ['promptstatus', verified.wmkf_ai_promptstatus, PROMPTSTATUS_PUBLISHED],
  ];

  let ok = true;
  for (const [label, got, want] of checks) {
    const match = got === want;
    console.log(`  ${match ? '✓' : '✗'} ${label}: ${got}${match ? '' : ` (expected ${want})`}`);
    if (!match) ok = false;
  }

  // JSON round-trip checks
  try {
    const vars = JSON.parse(verified.wmkf_ai_promptvariables);
    console.log(`  ✓ promptvariables parses as JSON — ${vars.variables.length} variables`);
  } catch (e) {
    console.error(`  ✗ promptvariables JSON parse failed: ${e.message}`);
    ok = false;
  }
  try {
    const out = JSON.parse(verified.wmkf_ai_promptoutputschema);
    console.log(`  ✓ promptoutputschema parses as JSON — ${out.outputs.length} outputs, parseMode=${out.parseMode}`);
  } catch (e) {
    console.error(`  ✗ promptoutputschema JSON parse failed: ${e.message}`);
    ok = false;
  }

  if (!ok) {
    console.error('\n✗ Verification had mismatches (see above)');
    process.exit(2);
  }
  console.log('\n✓ All verification checks passed.');
} catch (err) {
  console.error('✗ Verification read failed:', err.message);
  process.exit(1);
}
