#!/usr/bin/env node

/**
 * Seed (or update) the `executor.echo-parity` row in `wmkf_ai_prompt`.
 *
 * Purpose: parity oracle between the Vercel `executePrompt()` service and the
 * (forthcoming) PowerAutomate `ExecutePrompt` child flow. See
 * docs/EXECUTOR_CONTRACT.md § "Test oracle":
 *
 *   Both executors must:
 *     1. Invoked with identical requestId and overrideVariables, produce
 *        byte-identical wmkf_ai_rawoutput
 *     2. On second invocation, cacheHit is true regardless of which caller
 *        went first
 *
 * Shape (per contract):
 *   - Two variables: one `dynamics`, one `override`
 *   - System prompt: "Echo the inputs verbatim as JSON."
 *   - Output schema: { echo: string }, target.kind = none
 *
 * Determinism levers:
 *   - temperature = 0
 *   - haiku 4.5 (cheap; smoke test, not a real AI task)
 *   - System prompt pins exact output shape; parseMode=json validates the
 *     'echo' key landed
 *
 * Usage:
 *   node scripts/seed-echo-parity-prompt.js --dry-run
 *   node scripts/seed-echo-parity-prompt.js --execute
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
DynamicsService.bypassRestrictions('seed-echo-parity-prompt');

const PROMPT_NAME = 'executor.echo-parity';
const ENTITY_SET = 'wmkf_ai_prompts';

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// Picklist value (same as seed-phase-i-summary-prompt.js — confirmed Session 109).
const PROMPTSTATUS_PUBLISHED = 682090001;

// ────────────────────────────────────────────────────────────────────────────
// System prompt — keep exactly this string. Change the seed only if both
// executors update in lockstep, otherwise the parity assertion fails.
//
// We instruct Claude to return JSON with one field `echo` whose value is the
// concatenation of the two declared variables. Concatenation (not e.g. an
// object) keeps parseMode=json + single string output simple, while still
// proving variable resolution from BOTH source kinds (dynamics + override).
//
// PADDING NOTE: Anthropic ephemeral prompt caching only engages when the
// cached block crosses a model-specific minimum token count (1024 tokens for
// Sonnet/Opus, 2048 for Haiku). Without crossing that floor, the
// `cache_control` marker is silently ignored and the contract's "cacheHit on
// second invocation" assertion cannot be satisfied. To exercise the cache
// path with a tiny operational prompt, the section below adds stable,
// deterministic filler that pushes the system block past ~1024 tokens. The
// filler is content-free (it explains the oracle's own purpose) — but it is
// CACHE-LOAD-BEARING. Do not strip it: assertion 2 in the contract depends
// on it. If you genuinely shrink the prompt, switch the model to one with a
// lower threshold or document the cache assertion as N/A here.
// ────────────────────────────────────────────────────────────────────────────
const PARITY_FILLER = `

────────────────────────────────────────────────────────────────────────────
Background — why this prompt exists
────────────────────────────────────────────────────────────────────────────
This row is the executor parity oracle described in docs/EXECUTOR_CONTRACT.md
§ "Test oracle". Two implementations of the Executor must remain byte-for-byte
equivalent on identical inputs:

  1. The Vercel \`executePrompt()\` service in lib/services/execute-prompt.js
  2. The PowerAutomate \`ExecutePrompt\` child flow (Phase 1)

When both executors run this prompt against the same (requestId, echo_text)
pair, the resulting wmkf_ai_run rows must satisfy two assertions:

  Assertion 1 (parity): both runs persist identical wmkf_ai_rawoutput strings.
  Assertion 2 (cache): the second run reports cacheHit=true.

Assertion 1 catches behavioral drift between the two implementations: variable
resolution, message composition, request shaping, and output persistence. If
either executor changes its variable interpolation, message format, or output
extraction in a way that changes Claude's input or its persisted output, the
oracle fails fast.

Assertion 2 catches a subtler class of bug: when the system block's content,
position, or cache_control placement differs between executors, Anthropic's
prompt cache treats them as distinct prefixes and the second call pays full
input price. Cache misses on this oracle indicate that one of the executors
is composing the system block differently — even if the rendered text matches
character-for-character, internal whitespace handling or boundary placement
can break alignment.

────────────────────────────────────────────────────────────────────────────
Determinism contract
────────────────────────────────────────────────────────────────────────────
This prompt is configured for maximum reproducibility:

  - temperature = 0 (greedy decoding)
  - haiku/sonnet model (cheap; smoke test, not a real AI task)
  - tiny output (one short JSON object) — minimizes sampling variance
  - identical input variables across runs → identical request bodies

Any deviation in raw output between two invocations on the same inputs
indicates either (a) a non-deterministic call site, (b) a model-side
regression that should be reported to Anthropic, or (c) a bug in one of the
two executor implementations. The first two are exceedingly rare; the third
is the failure mode this oracle is designed to surface.

────────────────────────────────────────────────────────────────────────────
What "byte-identical" means here
────────────────────────────────────────────────────────────────────────────
The comparison is on the persisted wmkf_ai_rawoutput field of the run row,
not on the parsed output object. This catches differences that JSON parsing
would hide: surrounding whitespace, markdown code fences, trailing newlines,
unicode normalization. Both executors must persist the literal Claude
response text, character-for-character, into the run row's rawoutput field.

If your executor does any post-processing on the response text before
persisting (trimming, fence stripping, JSON re-serialization), the parity
assertion will fail even when the underlying behavior is correct. Don't
post-process. Persist raw, parse on read.

────────────────────────────────────────────────────────────────────────────
Operational guidance for callers
────────────────────────────────────────────────────────────────────────────
This prompt is intended to be invoked from automated test harnesses, not from
production code paths. Three call patterns are supported:

  1. Vercel \`executePrompt()\` invoked from scripts/test-echo-parity.js. Pass
     a real \`requestId\` (any populated akoya_request row), an arbitrary
     \`echo_text\` override, and \`runSource: "Vercel Test"\`. Run the script
     twice in succession to exercise both assertions.

  2. PowerAutomate \`ExecutePrompt\` child flow invoked from a Manual or
     scheduled parent flow. Use the same \`requestId\` and \`echo_text\` the
     Vercel harness used. After both sides complete, query wmkf_ai_run rows
     by prompt name and compare the latest two persisted wmkf_ai_rawoutput
     values directly in Dynamics — they must match character-for-character.

  3. CI smoke (future). Once the parity oracle is wired into CI, the harness
     should fail the build when either assertion regresses. The intended
     cadence is "every PR that touches lib/services/execute-prompt.js or the
     PA child flow definition", not "every PR".

────────────────────────────────────────────────────────────────────────────
Failure-mode reference
────────────────────────────────────────────────────────────────────────────
If the oracle fails, this list orders the most likely root causes by
historical frequency in similar test-oracle setups:

  - Variable resolution drift. One executor's \`dynamics\` source resolver
    reads a different field from akoya_request than the other. Verify both
    resolvers use \`akoya_requestnum\` exactly.
  - Override default mismatch. The override variable's default value is
    declared on the prompt row; both executors must read it identically when
    the caller omits the value. Check that PA's lookup of the override
    default reads from \`wmkf_ai_promptvariables\` JSON, not from a separate
    column.
  - Whitespace handling in interpolation. The Vercel implementation uses
    \`String.prototype.replace\` with a regex that strips no whitespace; PA's
    string-replace expression must match this exactly. Trailing/leading
    whitespace on injected values changes Claude's input.
  - System block boundary placement. The \`cache_control\` marker must sit on
    the system block, not on a user-message turn. Both executors must use
    the same anthropic-version header so cache semantics agree.
  - Output persistence post-processing. If either executor trims, fences,
    JSON-re-encodes, or otherwise transforms the response text before
    writing wmkf_ai_rawoutput, parity breaks. Persist raw, transform on read.
  - Model drift. If Anthropic deprecates or upgrades the configured model
    between the two runs, the second invocation may land on a different
    backend with different behavior. The model id is pinned in this row's
    wmkf_ai_model field; do not rely on aliases.

End background. The instruction is the first line of this prompt.
────────────────────────────────────────────────────────────────────────────`;

const SYSTEM_PROMPT = `Echo the inputs verbatim as JSON.

You will receive a user message containing two named values, one per line:
  request_number=<value>
  echo_text=<value>

Return exactly this JSON object — no prose, no markdown fences, no extra keys:
{"echo":"<request_number>|<echo_text>"}

Where <request_number> and <echo_text> are the values from the user message,
copied verbatim. Do not interpret, summarize, or reformat them.${PARITY_FILLER}`;

const PROMPT_BODY = `request_number={{request_number}}
echo_text={{echo_text}}`;

// ────────────────────────────────────────────────────────────────────────────
// Variables — one `dynamics`, one `override` per contract test-oracle spec.
// ────────────────────────────────────────────────────────────────────────────
const promptVariables = {
  variables: [
    {
      name: 'request_number',
      // Stable, almost-always-populated string field on akoya_request.
      // Used for parity (both executors resolve the same row → same value).
      source: { kind: 'dynamics', table: 'akoya_request', field: 'akoya_requestnum' },
      required: true,
      cacheable: false,
      placement: 'user',
    },
    {
      name: 'echo_text',
      // Caller-supplied; default lets Vercel test harness invoke without args.
      source: { kind: 'override', default: 'parity-test' },
      required: false,
      cacheable: false,
      placement: 'user',
    },
  ],
};

// Single output, parseMode=json, target.kind=none — no writeback. The run
// row's wmkf_ai_rawoutput is the artifact the parity oracle compares.
const promptOutputSchema = {
  outputs: [
    {
      name: 'echo',
      type: 'string',
      target: { kind: 'none' },
      // target.kind=none → guard is moot; Executor defaults to always-overwrite.
    },
  ],
  parseMode: 'json',
  jsonSchema: { required: ['echo'] },
  // Tiny output by construction — keep full raw output for byte-level diffing.
  rawOutputRetention: 'full',
};

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: PROMPT_BODY,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  // Pinned CONCRETE id, deliberately NOT the 'sonnet' tier key: this is a
  // PA<->Vercel parity-test prompt and its own body instructs that the model
  // be pinned so both executors run an identical model (a tier alias could
  // resolve differently between the two runs). Bump this id deliberately when
  // re-baselining the parity test. (1024-token cache threshold matches
  // phase-i.summary; the padding above clears it so cache_control engages.)
  wmkf_ai_model: 'claude-sonnet-4-6',
  wmkf_ai_temperature: 0,
  wmkf_ai_maxtokens: 256,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_iscurrent: true,
  wmkf_promptversion: 1,
  wmkf_ai_publisheddatetime: new Date().toISOString(),
  wmkf_ai_notes:
    'Parity oracle for Vercel executePrompt() ↔ PA ExecutePrompt. ' +
    'See docs/EXECUTOR_CONTRACT.md § Test oracle. ' +
    'Do not edit prompt text without lockstep updates to both executors.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length} chars`);
console.log(`  promptbody:   ${PROMPT_BODY.length} chars`);
console.log(`  variables:    ${promptVariables.variables.length} declared (1 dynamics, 1 override)`);
console.log(`  outputs:      ${promptOutputSchema.outputs.length} (parseMode=${promptOutputSchema.parseMode}, target=none)`);
console.log(`  model:        ${recordData.wmkf_ai_model}`);
console.log(`  temperature:  ${recordData.wmkf_ai_temperature}`);
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
  console.log('\n--- wmkf_ai_promptvariables ---');
  console.log(recordData.wmkf_ai_promptvariables);
  console.log('\n--- wmkf_ai_promptoutputschema ---');
  console.log(recordData.wmkf_ai_promptoutputschema);
  console.log('\n--- systemprompt ---');
  console.log(SYSTEM_PROMPT);
  console.log('\n--- promptbody ---');
  console.log(PROMPT_BODY);
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
    ['promptbody.length', (verified.wmkf_ai_promptbody || '').length, PROMPT_BODY.length],
    ['model', verified.wmkf_ai_model, recordData.wmkf_ai_model],
    ['temperature', Number(verified.wmkf_ai_temperature), 0],
    ['maxtokens', verified.wmkf_ai_maxtokens, recordData.wmkf_ai_maxtokens],
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

  try {
    const vars = JSON.parse(verified.wmkf_ai_promptvariables);
    console.log(`  ✓ promptvariables parses as JSON — ${vars.variables.length} variables`);
    const kinds = vars.variables.map(v => v.source?.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify(['dynamics', 'override'])) {
      console.error(`  ✗ expected one dynamics + one override variable, got [${kinds.join(', ')}]`);
      ok = false;
    } else {
      console.log(`  ✓ variable source kinds: dynamics + override (matches contract)`);
    }
  } catch (e) {
    console.error(`  ✗ promptvariables JSON parse failed: ${e.message}`);
    ok = false;
  }
  try {
    const out = JSON.parse(verified.wmkf_ai_promptoutputschema);
    console.log(`  ✓ promptoutputschema parses as JSON — ${out.outputs.length} outputs, parseMode=${out.parseMode}`);
    if (out.outputs[0]?.target?.kind !== 'none') {
      console.error(`  ✗ output target.kind should be 'none' (got '${out.outputs[0]?.target?.kind}')`);
      ok = false;
    }
  } catch (e) {
    console.error(`  ✗ promptoutputschema JSON parse failed: ${e.message}`);
    ok = false;
  }

  if (!ok) {
    console.error('\n✗ Verification had mismatches (see above)');
    process.exit(2);
  }
  console.log('\n✓ All verification checks passed.');
  console.log('\nNext: run executePrompt({ promptName: "executor.echo-parity", requestId, runSource: "Vercel Test" })');
  console.log('twice — second run should report cacheHit=true and byte-identical wmkf_ai_rawoutput.');
} catch (err) {
  console.error('✗ Verification read failed:', err.message);
  process.exit(1);
}
