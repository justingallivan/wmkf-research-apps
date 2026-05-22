#!/usr/bin/env node

/**
 * Read-only diff: compare the live `phase-i.summary` row in
 * `wmkf_ai_prompts` against what `seed-phase-i-summary-prompt.js --execute`
 * would write. Surfaces any drift between the live row and the seed source —
 * including manual edits Connor or anyone else may have made outside our
 * code-side workflow.
 *
 * No writes. Safe to run any time.
 *
 * Usage:
 *   node scripts/diff-phase-i-summary-prompt.js
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
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = await import(
  '../shared/config/prompts/phase-i-dynamics.js'
);
DynamicsService.bypassRestrictions('diff-phase-i-summary-prompt');

const PROMPT_NAME = 'phase-i.summary';
const ENTITY_SET = 'wmkf_ai_prompts';

// ──────────────────────────────────────────────────────────────────────────
// Seed source — must match scripts/seed-phase-i-summary-prompt.js
// ──────────────────────────────────────────────────────────────────────────
const seedVariables = {
  variables: [
    {
      name: 'proposal_text',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'proposal_text',
      maxChars: 100000,
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

const seedOutputSchema = {
  outputs: [
    {
      name: 'summary',
      type: 'string',
      target: { kind: 'akoya_request', field: 'wmkf_ai_summary' },
      guard: 'skip-if-populated',
    },
  ],
  parseMode: 'raw',
  rawOutputRetention: 'hash',
};

const seedRecord = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: seedVariables,
  wmkf_ai_promptoutputschema: seedOutputSchema,
  // Tier key — resolveModel() maps 'sonnet' to the current Sonnet.
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.3,
  wmkf_ai_maxtokens: 16384,
  // Excluded from diff (always changes / hardcoded):
  //   wmkf_ai_publisheddatetime — bumps every run
  //   wmkf_ai_iscurrent (true), wmkf_promptversion (1), wmkf_ai_promptstatus
  //     (Published 682090001), wmkf_ai_notes — flagged separately below
};

// ──────────────────────────────────────────────────────────────────────────
// Fetch live row
// ──────────────────────────────────────────────────────────────────────────
const live = await DynamicsService.queryRecords(ENTITY_SET, {
  select: [
    'wmkf_ai_promptid',
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
    'wmkf_ai_publisheddatetime',
    'wmkf_ai_notes',
    'modifiedon',
    'createdon',
  ].join(','),
  filter: `wmkf_ai_promptname eq '${PROMPT_NAME}' and wmkf_ai_iscurrent eq true`,
  top: 2,
});

const rows = live?.records || [];
if (rows.length === 0) {
  console.log(`No current row found for "${PROMPT_NAME}". Seed would CREATE.`);
  process.exit(0);
}
if (rows.length > 1) {
  console.error(`✗ Multiple current rows for "${PROMPT_NAME}" — manual cleanup required.`);
  for (const r of rows) console.error('  ', r.wmkf_ai_promptid);
  process.exit(2);
}
const row = rows[0];

console.log(`Comparing live row vs seed source`);
console.log(`  recordId:   ${row.wmkf_ai_promptid}`);
console.log(`  modifiedon: ${row.modifiedon}`);
console.log(`  createdon:  ${row.createdon}`);
console.log('');

// ──────────────────────────────────────────────────────────────────────────
// Diff helpers
// ──────────────────────────────────────────────────────────────────────────
let drift = 0;

function reportSimple(label, liveVal, seedVal) {
  if (liveVal === seedVal) {
    console.log(`  ✓ ${label}: identical`);
    return;
  }
  drift++;
  console.log(`  ✗ ${label}: DRIFT`);
  console.log(`      live: ${JSON.stringify(liveVal)}`);
  console.log(`      seed: ${JSON.stringify(seedVal)}`);
}

function reportText(label, liveText, seedText) {
  liveText = liveText || '';
  if (liveText === seedText) {
    console.log(`  ✓ ${label}: identical (${seedText.length.toLocaleString()} chars)`);
    return;
  }
  drift++;
  console.log(`  ✗ ${label}: DRIFT`);
  console.log(`      live length: ${liveText.length.toLocaleString()}`);
  console.log(`      seed length: ${seedText.length.toLocaleString()}`);
  // Locate first divergence to help spot the change.
  let i = 0;
  const min = Math.min(liveText.length, seedText.length);
  while (i < min && liveText[i] === seedText[i]) i++;
  if (i < min || liveText.length !== seedText.length) {
    const start = Math.max(0, i - 40);
    console.log(`      first diff at char ${i}:`);
    console.log(`        live: …${JSON.stringify(liveText.slice(start, i + 80))}…`);
    console.log(`        seed: …${JSON.stringify(seedText.slice(start, i + 80))}…`);
  }
}

function reportJson(label, liveStr, seedObj) {
  let liveObj;
  try {
    liveObj = liveStr ? JSON.parse(liveStr) : null;
  } catch (e) {
    drift++;
    console.log(`  ✗ ${label}: live row's JSON does not parse — ${e.message}`);
    return;
  }
  const liveCanon = JSON.stringify(liveObj, null, 2);
  const seedCanon = JSON.stringify(seedObj, null, 2);
  if (liveCanon === seedCanon) {
    console.log(`  ✓ ${label}: identical (canonical JSON)`);
    return;
  }
  drift++;
  console.log(`  ✗ ${label}: DRIFT`);
  console.log(`      --- live ---`);
  console.log(liveCanon.split('\n').map(l => `      ${l}`).join('\n'));
  console.log(`      --- seed ---`);
  console.log(seedCanon.split('\n').map(l => `      ${l}`).join('\n'));
}

// ──────────────────────────────────────────────────────────────────────────
// Field-by-field comparison
// ──────────────────────────────────────────────────────────────────────────
console.log('Field-by-field comparison (excluded: publisheddatetime, notes):\n');

reportSimple('promptname',  row.wmkf_ai_promptname,  seedRecord.wmkf_ai_promptname);
reportText  ('systemprompt', row.wmkf_ai_systemprompt, seedRecord.wmkf_ai_systemprompt);
reportText  ('promptbody',   row.wmkf_ai_promptbody,   seedRecord.wmkf_ai_promptbody);
reportJson  ('promptvariables',     row.wmkf_ai_promptvariables,     seedRecord.wmkf_ai_promptvariables);
reportJson  ('promptoutputschema',  row.wmkf_ai_promptoutputschema,  seedRecord.wmkf_ai_promptoutputschema);
reportSimple('model',       row.wmkf_ai_model,       seedRecord.wmkf_ai_model);
reportSimple('temperature', Number(row.wmkf_ai_temperature), seedRecord.wmkf_ai_temperature);
reportSimple('maxtokens',   row.wmkf_ai_maxtokens,   seedRecord.wmkf_ai_maxtokens);

console.log('');
console.log('Status fields (informational — seed always writes these):');
console.log(`  iscurrent:   live=${row.wmkf_ai_iscurrent}    seed=true`);
console.log(`  version:     live=${row.wmkf_promptversion}            seed=1`);
console.log(`  promptstatus:live=${row.wmkf_ai_promptstatus}     seed=682090001 (Published)`);
console.log('');
console.log(`notes (live, first 300 chars):`);
console.log(`  ${(row.wmkf_ai_notes || '').slice(0, 300)}${(row.wmkf_ai_notes || '').length > 300 ? '…' : ''}`);

console.log('');
if (drift === 0) {
  console.log(`✓ No content drift detected. Seed source matches the live row except excluded timestamp/notes fields.`);
  process.exit(0);
} else {
  console.log(`✗ ${drift} field(s) drift between live and seed source.`);
  console.log(`  Inspect each "DRIFT" block above. If any drift is intentional, update the seed source before --execute.`);
  process.exit(1);
}
