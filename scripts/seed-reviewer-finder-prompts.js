#!/usr/bin/env node

/**
 * Seed (or update) the two `reviewer-finder.*` rows in `wmkf_ai_prompt`:
 *   - reviewer-finder.analyze
 *   - reviewer-finder.score-candidates
 *
 * These migrate the live Reviewer Finder Claude prompts into Dynamics-resident
 * storage ahead of the route refactor (Session 112+). Until that refactor,
 * the live routes still use the legacy function-based prompts in
 * `shared/config/prompts/reviewer-finder.js`. Seeding now puts the templates
 * in front of staff for review/edit and lets the post-cycle refactor become
 * pure wiring.
 *
 * Usage:
 *   node scripts/seed-reviewer-finder-prompts.js --dry-run
 *   node scripts/seed-reviewer-finder-prompts.js --execute
 *   node scripts/seed-reviewer-finder-prompts.js --dry-run --only=analyze
 *
 * Target (prod Dynamics — wmkf.crm.dynamics.com via .env.local):
 *   Entity: wmkf_ai_prompts
 *   Key:    wmkf_ai_promptname IN ('reviewer-finder.analyze', 'reviewer-finder.score-candidates')
 *           AND wmkf_ai_iscurrent = true
 *
 * Source of truth for prompt text:
 *   shared/config/prompts/reviewer-finder-dynamics.js
 *   — byte-identical to what `createAnalysisPrompt` / `createDiscoveredReasoningPrompt`
 *   produce today, with conditional sections converted to caller-formatted
 *   `{{var_block}}` slots. See that file's header for the conversion rules.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Phase 0 design choices (mirroring `phase-i.summary`)
 * ──────────────────────────────────────────────────────────────────────────
 * - parseMode: "raw" — Claude emits delimited text, not JSON. Single output
 *   `response_text` with `target.kind: "none"` (route persists separately to
 *   Postgres, eventually Dataverse Wave 2).
 * - All variables `placement: "user"` (Phase 0 constraint). System prompt is
 *   intentionally empty: legacy code sends a single user message with no
 *   system block, so we preserve that exactly to avoid behavioral drift.
 *   (Future improvement: split the static role-setting opener into the
 *   system block for cache wins. Not Phase 0.)
 * - All variables `source.kind: "override"` — the route owns input plumbing
 *   (uploads, external API results, conditional formatting). No `dynamics`
 *   or `sharepoint` source kinds needed today.
 * - Conditional sections become caller-formatted blocks: `additional_notes_block`
 *   and `excluded_names_block` are full strings (or "") rather than booleans
 *   plus content. Same pattern as `summary_length_suffix` in phase-i.summary.
 * - Model + token + temperature mirror live `ClaudeReviewerService` defaults.
 *   `analyze` uses MAX_TOKENS=4096; `score-candidates` uses 1024 per batch.
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
const {
  ANALYZE_SYSTEM_PROMPT,
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_SYSTEM_PROMPT,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} = await import('../shared/config/prompts/reviewer-finder-dynamics.js');
DynamicsService.bypassRestrictions('seed-reviewer-finder-prompts');

const ENTITY_SET = 'wmkf_ai_prompts';
const PROMPTSTATUS_PUBLISHED = 682090001; // confirmed Session 109 schema probe
const REVIEWER_FINDER_MODEL = 'sonnet'; // tier key — resolveModel() maps to the current Sonnet (matches baseConfig['reviewer-finder'])

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyFilter = onlyArg ? onlyArg.split('=')[1] : null; // 'analyze' | 'score-candidates'

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────────────
// reviewer-finder.analyze definition
// ────────────────────────────────────────────────────────────────────────────
const analyzeRow = {
  promptName: 'reviewer-finder.analyze',
  systemPrompt: ANALYZE_SYSTEM_PROMPT,
  body: ANALYZE_USER_PROMPT_TEMPLATE,
  model: REVIEWER_FINDER_MODEL,
  temperature: 0.3,
  maxTokens: 4096,
  variables: {
    variables: [
      {
        name: 'proposal_text',
        // Pre-truncated by route to 100,000 chars (legacy did this inline).
        source: { kind: 'override' },
        required: true,
        cacheable: true,
        placement: 'user',
      },
      {
        name: 'reviewer_count',
        source: { kind: 'override', default: 12 },
        required: false,
        cacheable: false,
        placement: 'user',
      },
      {
        name: 'additional_notes_block',
        // Either "" or "**ADDITIONAL CONTEXT FROM USER:**\n<text>\n".
        // Route formats; Phase 0 Executor doesn't render conditionals.
        source: { kind: 'override', default: '' },
        required: false,
        cacheable: false,
        placement: 'user',
      },
      {
        name: 'excluded_names_block',
        // Either "" or "\n**EXCLUDED NAMES (conflicts of interest - do NOT suggest these):**\n<csv>\n".
        source: { kind: 'override', default: '' },
        required: false,
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
        // Route post-parses via parseAnalysisResponse and persists to Postgres
        // (proposal_searches / reviewer_suggestions). No Dynamics writeback.
        target: { kind: 'none' },
      },
    ],
    parseMode: 'raw',
  },
  notes:
    'Phase 0 seed (Session 111). Combined analyze+suggest+queries prompt. ' +
    'Source of truth: shared/config/prompts/reviewer-finder-dynamics.js. ' +
    'Live routes still use legacy createAnalysisPrompt until route refactor.',
};

// ────────────────────────────────────────────────────────────────────────────
// reviewer-finder.score-candidates definition
// ────────────────────────────────────────────────────────────────────────────
const scoreRow = {
  promptName: 'reviewer-finder.score-candidates',
  systemPrompt: SCORE_CANDIDATES_SYSTEM_PROMPT,
  body: SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
  model: REVIEWER_FINDER_MODEL,
  temperature: 0.3,
  maxTokens: 1024, // matches per-batch budget in claude-reviewer-service.js
  variables: {
    variables: [
      {
        name: 'proposal_summary',
        // Built by caller via createProposalSummary(proposalInfo).
        source: { kind: 'override' },
        required: true,
        cacheable: true,
        placement: 'user',
      },
      {
        name: 'candidates_list',
        // Numbered list of up to 10 candidates with name/affiliation/recent pubs.
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
    'Phase 0 seed (Session 111). Per-batch (10 candidates) relevance scoring. ' +
    'Source of truth: shared/config/prompts/reviewer-finder-dynamics.js. ' +
    'Live routes still use legacy createDiscoveredReasoningPrompt until route refactor.',
};

const rowsToProcess = [analyzeRow, scoreRow].filter((r) => {
  if (!onlyFilter) return true;
  const short = r.promptName.split('.')[1];
  return short === onlyFilter;
});

if (rowsToProcess.length === 0) {
  console.error(`--only=${onlyFilter} matched nothing. Valid: analyze, score-candidates.`);
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────────────
// Process each row
// ────────────────────────────────────────────────────────────────────────────
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

  // Look for an existing current row by name.
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

  // Execute path
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
