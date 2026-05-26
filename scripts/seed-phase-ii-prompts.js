#!/usr/bin/env node

/**
 * Seed (or update) the four `phase-ii.*` rows in `wmkf_ai_prompt`:
 *   - phase-ii.summarize
 *   - phase-ii.extract-structured
 *   - phase-ii.qa
 *   - phase-ii.refine
 *
 * Migrates the four live Claude prompts shared by the `phase-ii-writeup`
 * and `batch-proposal-summaries` apps into Dynamics-resident storage.
 * Live routes (process.js, qa.js, refine.js) still use the legacy
 * function-based generators in shared/config/prompts/proposal-summarizer.js
 * (and the inline REFINEMENT_PROMPT in refine.js) until the post-cycle
 * route refactor.
 *
 * Usage:
 *   node scripts/seed-phase-ii-prompts.js --dry-run
 *   node scripts/seed-phase-ii-prompts.js --execute
 *   node scripts/seed-phase-ii-prompts.js --dry-run --only=summarize
 *
 * Source of truth for prompt text:
 *   shared/config/prompts/phase-ii-dynamics.js
 *
 * Phase 0 design choices match prior seeds:
 *   parseMode=raw for summarize/qa/refine (free-form output);
 *   parseMode=raw for extract-structured too — Claude is asked to
 *   return JSON but we pass it through unparsed so the route owns
 *   JSON.parse + error handling, matching today's process.js behavior.
 *   target.kind=none for all (route persists separately).
 *   All variables placement=user / source=override.
 *   System prompt empty across the board (route uses body string in
 *   either system or user slot per its own logic).
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
const {
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_USER_PROMPT_TEMPLATE,
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_USER_PROMPT_TEMPLATE,
  QA_SYSTEM_PROMPT,
  QA_USER_PROMPT_TEMPLATE,
  REFINE_SYSTEM_PROMPT,
  REFINE_USER_PROMPT_TEMPLATE,
} = await import('../shared/config/prompts/phase-ii-dynamics.js');
enterDynamicsBypassForScript('seed-phase-ii-prompts');

const ENTITY_SET = 'wmkf_ai_prompts';
const PROMPTSTATUS_PUBLISHED = 682090001;
const MODEL = 'sonnet'; // tier key — resolveModel() maps to the current Sonnet (matches all 4 baseConfig entries)

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyFilter = onlyArg ? onlyArg.split('=')[1] : null;

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

const overrideVar = (name, def) => ({
  name,
  source: def === undefined ? { kind: 'override' } : { kind: 'override', default: def },
  required: def === undefined,
  cacheable: false,
  placement: 'user',
});

// ── Row definitions ──
const rows = [
  {
    promptName: 'phase-ii.summarize',
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    body: SUMMARIZE_USER_PROMPT_TEMPLATE,
    model: MODEL,
    temperature: 0.3, // BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE
    maxTokens: 16384, // BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS
    variables: {
      variables: [
        // Caller pre-truncates to ~100k chars and appends "..." suffix if truncated.
        { ...overrideVar('proposal_text'), required: true, cacheable: true },
        // Caller-derived: summaryLength * 400 (legacy default summaryLength=2 → 800).
        overrideVar('detailed_word_target', 800),
      ],
    },
    outputSchema: {
      outputs: [{ name: 'response_text', type: 'string', target: { kind: 'none' } }],
      parseMode: 'raw',
    },
    notes:
      'Phase 0 seed (Session 112). Two-part proposal writeup (PART 1 summary page + PART 2 detailed). ' +
      'Source of truth: shared/config/prompts/phase-ii-dynamics.js. ' +
      'Live routes still use createSummarizationPrompt until post-cycle refactor.',
  },
  {
    promptName: 'phase-ii.extract-structured',
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    body: EXTRACT_USER_PROMPT_TEMPLATE,
    model: MODEL,
    temperature: 0.1, // matches inline value in process.js
    maxTokens: 1000,  // matches inline value in process.js
    variables: {
      variables: [
        { ...overrideVar('proposal_text'), required: true, cacheable: true },
        { ...overrideVar('filename'), required: true, cacheable: false },
      ],
    },
    outputSchema: {
      // Claude is asked to return JSON, but route owns JSON.parse so we
      // pass the raw response through. parseMode=raw keeps Phase 0 contract
      // simple; if the row is later upgraded to parseMode=json, the
      // declared output shape can be filled in then.
      outputs: [{ name: 'response_text', type: 'string', target: { kind: 'none' } }],
      parseMode: 'raw',
    },
    notes:
      'Phase 0 seed (Session 112). JSON metadata extraction (PI, institution, methods, etc.). ' +
      'Claude returns JSON; route does JSON.parse. parseMode=raw for now; promote to ' +
      'parseMode=json + structured outputs in a later upgrade.',
  },
  {
    promptName: 'phase-ii.qa',
    systemPrompt: QA_SYSTEM_PROMPT,
    body: QA_USER_PROMPT_TEMPLATE,
    model: MODEL,
    temperature: 0.4, // matches inline value in qa.js
    maxTokens: 4096,  // matches inline value in qa.js
    variables: {
      variables: [
        { ...overrideVar('filename'), required: true, cacheable: false },
        // Pre-truncated to ~80k by caller; truncation notice appended if applied.
        { ...overrideVar('proposal_text'), required: true, cacheable: true },
        // "[No summary available]" sentinel acceptable.
        { ...overrideVar('summary_text'), required: true, cacheable: true },
      ],
    },
    outputSchema: {
      outputs: [{ name: 'response_text', type: 'string', target: { kind: 'none' } }],
      parseMode: 'raw',
    },
    notes:
      'Phase 0 seed (Session 112). System prompt for streaming Q&A chat (route consumes ' +
      'body string in system slot with cache_control: ephemeral). ' +
      'Source of truth: shared/config/prompts/phase-ii-dynamics.js.',
  },
  {
    promptName: 'phase-ii.refine',
    systemPrompt: REFINE_SYSTEM_PROMPT,
    body: REFINE_USER_PROMPT_TEMPLATE,
    model: MODEL,
    temperature: 0.3, // matches inline value in refine.js
    maxTokens: 3000,  // matches inline value in refine.js
    variables: {
      variables: [
        { ...overrideVar('current_summary'), required: true, cacheable: false },
        { ...overrideVar('user_feedback'), required: true, cacheable: false },
      ],
    },
    outputSchema: {
      outputs: [{ name: 'response_text', type: 'string', target: { kind: 'none' } }],
      parseMode: 'raw',
    },
    notes:
      'Phase 0 seed (Session 112). Refine writeup based on user feedback. ' +
      'Live prompt is the inline REFINEMENT_PROMPT in pages/api/refine.js (NOT the dead ' +
      'createRefinementPrompt export in proposal-summarizer.js). Captured byte-for-byte.',
  },
];

const rowsToProcess = rows.filter((r) => {
  if (!onlyFilter) return true;
  const short = r.promptName.split('.').slice(1).join('.');
  return short === onlyFilter;
});

if (rowsToProcess.length === 0) {
  console.error(`--only=${onlyFilter} matched nothing. Valid: ${rows.map((r) => r.promptName.split('.').slice(1).join('.')).join(', ')}.`);
  process.exit(2);
}

for (const row of rowsToProcess) {
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`Seed: ${row.promptName}`);
  console.log(`══════════════════════════════════════════════════════════`);
  console.log(`  systemprompt: ${row.systemPrompt.length.toLocaleString()} chars`);
  console.log(`  promptbody:   ${row.body.length.toLocaleString()} chars`);
  console.log(`  variables:    ${row.variables.variables.length} declared`);
  console.log(`  outputs:      ${row.outputSchema.outputs.length} (parseMode=${row.outputSchema.parseMode})`);
  console.log(`  model:        ${row.model}`);
  console.log(`  maxTokens:    ${row.maxTokens}`);
  console.log(`  temperature:  ${row.temperature}`);
  console.log('');

  const recordData = {
    wmkf_ai_promptname: row.promptName,
    wmkf_ai_systemprompt: row.systemPrompt,
    wmkf_ai_promptbody: row.body,
    wmkf_ai_promptvariables: JSON.stringify(row.variables, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(row.outputSchema, null, 2),
    wmkf_ai_model: row.model,
    wmkf_ai_temperature: row.temperature,
    wmkf_ai_maxtokens: row.maxTokens,
    wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
    wmkf_ai_iscurrent: true,
    wmkf_promptversion: 1,
    wmkf_ai_publisheddatetime: new Date().toISOString(),
    wmkf_ai_notes: row.notes,
  };

  const existing = await DynamicsService.queryRecords(ENTITY_SET, {
    select: 'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent',
    filter: `wmkf_ai_promptname eq '${row.promptName}' and wmkf_ai_iscurrent eq true`,
    top: 2,
  });

  const matches = existing?.records || [];
  if (matches.length > 1) {
    console.error(`✗ Multiple current rows found for ${row.promptName} — aborting. Resolve manually.`);
    for (const m of matches) console.error('  ', m.wmkf_ai_promptid, 'v=' + m.wmkf_promptversion);
    process.exit(1);
  }

  const existingId = matches[0]?.wmkf_ai_promptid || null;

  if (DRY) {
    console.log('--- DRY RUN ---');
    console.log(existingId ? `Would UPDATE wmkf_ai_prompts(${existingId})` : 'Would CREATE new wmkf_ai_prompts row');
    console.log('\n--- wmkf_ai_promptvariables (pretty) ---');
    console.log(recordData.wmkf_ai_promptvariables);
    console.log('\n--- promptbody preview (first 300) ---');
    console.log(row.body.substring(0, 300) + (row.body.length > 300 ? '…' : ''));
    continue;
  }

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
        const rb = await DynamicsService.queryRecords(ENTITY_SET, {
          select: 'wmkf_ai_promptid',
          filter: `wmkf_ai_promptname eq '${row.promptName}' and wmkf_ai_iscurrent eq true`,
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
      ['promptname', verified.wmkf_ai_promptname, row.promptName],
      ['promptbody.length', (verified.wmkf_ai_promptbody || '').length, row.body.length],
      ['model', verified.wmkf_ai_model, row.model],
      ['maxTokens', verified.wmkf_ai_maxtokens, row.maxTokens],
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
      console.error(`\n✗ Verification had mismatches for ${row.promptName} (see above)`);
      process.exit(2);
    }
    console.log(`\n✓ All verification checks passed for ${row.promptName}.`);
  } catch (err) {
    console.error('✗ Verification read failed:', err.message);
    process.exit(1);
  }
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`Done. ${rowsToProcess.length} row(s) processed.`);
console.log('══════════════════════════════════════════════════════════');
