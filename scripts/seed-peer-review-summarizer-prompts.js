#!/usr/bin/env node

/**
 * Seed (or update) the two `peer-review-summarizer.*` rows in `wmkf_ai_prompt`:
 *   - peer-review-summarizer.analyze
 *   - peer-review-summarizer.questions
 *
 * Seeds the Dynamics-resident rows used by the live peer-review summarizer
 * Executor path. The route no longer uses the legacy prompt generators.
 *
 * Usage:
 *   node scripts/seed-peer-review-summarizer-prompts.js --dry-run
 *   node scripts/seed-peer-review-summarizer-prompts.js --execute
 *   node scripts/seed-peer-review-summarizer-prompts.js --dry-run --only=analyze
 *
 * Source of truth for prompt text:
 *   shared/config/prompts/peer-reviewer-dynamics.js
 *
 * Phase 0 design choices match prior seeds (phase-i.summary, reviewer-finder.*):
 *   parseMode=raw, target.kind=none, system prompt empty, all variables
 *   placement=user / source=override.
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
  ANALYZE_SYSTEM_PROMPT,
  ANALYZE_USER_PROMPT_TEMPLATE,
  QUESTIONS_SYSTEM_PROMPT,
  QUESTIONS_USER_PROMPT_TEMPLATE,
} = await import('../shared/config/prompts/peer-reviewer-dynamics.js');
enterDynamicsBypassForScript('seed-peer-review-summarizer-prompts');

const ENTITY_SET = 'wmkf_ai_prompts';
const PROMPTSTATUS_PUBLISHED = 682090001;
const MODEL = 'sonnet'; // tier key — resolveModel() maps to the current Sonnet (matches baseConfig['peer-review-summarizer'])

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyFilter = onlyArg ? onlyArg.split('=')[1] : null; // 'analyze' | 'questions'

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

const analyzeRow = {
  promptName: 'peer-review-summarizer.analyze',
  systemPrompt: ANALYZE_SYSTEM_PROMPT,
  body: ANALYZE_USER_PROMPT_TEMPLATE,
  model: MODEL,
  temperature: 0.3, // BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE
  maxTokens: 2500,  // BASE_CONFIG.MODEL_PARAMS.REFINEMENT_MAX_TOKENS
  variables: {
    variables: [
      {
        name: 'review_count',
        source: { kind: 'override' },
        required: true,
        cacheable: false,
        placement: 'user',
      },
      {
        name: 'review_count_suffix',
        // "s" if review_count > 1 else "". Caller-derived (Phase 0 Executor
        // has no derived variables). Same pattern as summary_length_suffix.
        source: { kind: 'override', default: '' },
        required: false,
        cacheable: false,
        placement: 'user',
      },
      {
        name: 'reviews_block',
        // Pre-joined "**Review 1:**\n<text>\n\n---\n**Review 2:**\n..." string.
        source: { kind: 'override' },
        required: true,
        cacheable: true,
        placement: 'user',
      },
      {
        name: 'a7_preamble',
        // A7 untrusted-content preamble, built by the route from the per-review
        // nonces (S344). reviews_block is passed already-wrapped, so the Executor
        // does NOT auto-inject a preamble — the route must. required:true with NO
        // default so a missing preamble fails closed (execute-prompt.js resolveOne
        // throws) instead of silently dropping A7. Interpolated into the system
        // prompt ({{a7_preamble}}). See peer-reviewer-dynamics.js header.
        source: { kind: 'override' },
        required: true,
        cacheable: false,
        placement: 'user',
      },
    ],
  },
  outputSchema: {
    outputs: [
      {
        name: 'response_text',
        type: 'string',
        target: { kind: 'none' }, // route splits markdown into summary/questions
      },
    ],
    parseMode: 'raw',
  },
  notes:
    'Phase 0 seed (Session 111). Combined SUMMARY + QUESTIONS pass. ' +
    'Source of truth: shared/config/prompts/peer-reviewer-dynamics.js. ' +
    'Live route executes this prompt through executePrompt.',
};

const questionsRow = {
  promptName: 'peer-review-summarizer.questions',
  systemPrompt: QUESTIONS_SYSTEM_PROMPT,
  body: QUESTIONS_USER_PROMPT_TEMPLATE,
  model: MODEL,
  temperature: 0.3,
  maxTokens: 16384, // BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS
  variables: {
    variables: [
      {
        name: 'review_count',
        source: { kind: 'override' },
        required: true,
        cacheable: false,
        placement: 'user',
      },
      {
        name: 'reviews_block',
        source: { kind: 'override' },
        required: true,
        cacheable: true,
        placement: 'user',
      },
      {
        name: 'a7_preamble',
        // A7 untrusted-content preamble (route-built from per-review nonces, S344).
        // required:true / no default → fail closed if omitted. Interpolated into
        // the system prompt. See analyze row + peer-reviewer-dynamics.js header.
        source: { kind: 'override' },
        required: true,
        cacheable: false,
        placement: 'user',
      },
    ],
  },
  outputSchema: {
    outputs: [
      {
        name: 'response_text',
        type: 'string',
        target: { kind: 'none' },
      },
    ],
    parseMode: 'raw',
  },
  notes:
    'Phase 0 seed (Session 111). Fallback questions-only extraction; route ' +
    'invokes when analyze-pass produces <50 chars of questions content. ' +
    'Source of truth: shared/config/prompts/peer-reviewer-dynamics.js.',
};

const rowsToProcess = [analyzeRow, questionsRow].filter((r) => {
  if (!onlyFilter) return true;
  const short = r.promptName.split('.')[1];
  return short === onlyFilter;
});

if (rowsToProcess.length === 0) {
  console.error(`--only=${onlyFilter} matched nothing. Valid: analyze, questions.`);
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
    console.log('\n--- wmkf_ai_promptoutputschema (pretty) ---');
    console.log(recordData.wmkf_ai_promptoutputschema);
    console.log('\n--- promptbody preview (first 400) ---');
    console.log(row.body.substring(0, 400) + (row.body.length > 400 ? '…' : ''));
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
        console.warn('⚠ Create returned but no id field — attempting read-back by name');
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
      ['systemprompt.length', (verified.wmkf_ai_systemprompt || '').length, row.systemPrompt.length],
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
