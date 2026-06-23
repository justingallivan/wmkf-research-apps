/**
 * probe-held-reviewers.mjs — READ-ONLY. Counts reviewer-suggestion rows by
 * wmkf_responsetype (and selected state), to decide whether retiring the hold
 * step would strand any reviewer parked in the `held` state.
 *
 * No writes. Same .env.local + script-bypass pattern as reset-request-reviewers.
 *   node scripts/probe-held-reviewers.mjs
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { RESPONSE_TYPE_BY_VALUE, RESPONSE_TYPE_MAP } = await import('../lib/dataverse/adapters/reviewer-suggestion.js');

enterDynamicsBypassForScript('probe-held-reviewers');

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const HELD = RESPONSE_TYPE_MAP.held; // 100000004

console.log('\n=== probe-held-reviewers (READ-ONLY) ===\n');

// Pull every row carrying a responsetype, plus a few orienting fields. The table
// is small (per-request reviewer ledger), so an unfiltered select of the slim
// projection is fine.
const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
  select: [
    'wmkf_appreviewersuggestionid',
    'wmkf_responsetype',
    'wmkf_selected',
    'wmkf_accepted',
    'wmkf_invited',
    'wmkf_reviewstatus',
    'wmkf_reviewerfirstname',
    'wmkf_reviewerlastname',
    'wmkf_heldat',
    '_wmkf_request_value',
  ].join(','),
  filter: 'wmkf_responsetype ne null',
  top: 5000,
});

const all = records || [];
const byType = {};
for (const r of all) {
  const code = RESPONSE_TYPE_BY_VALUE[r.wmkf_responsetype] ?? `unknown(${r.wmkf_responsetype})`;
  byType[code] = byType[code] || { total: 0, selected: 0, unselected: 0 };
  byType[code].total += 1;
  if (r.wmkf_selected === true) byType[code].selected += 1; else byType[code].unselected += 1;
}

console.log(`Rows with a responsetype set: ${all.length}\n`);
console.log('By responsetype (selected = still in a PD working list):');
for (const [code, c] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${code.padEnd(22)} total=${String(c.total).padStart(4)}  selected=${String(c.selected).padStart(4)}  unselected=${String(c.unselected).padStart(4)}`);
}

const held = all.filter((r) => r.wmkf_responsetype === HELD);
const heldSelected = held.filter((r) => r.wmkf_selected === true);
console.log(`\nHELD (${HELD}): ${held.length} total, ${heldSelected.length} selected.`);
if (heldSelected.length > 0) {
  console.log('\n  Selected HELD rows (these would need cutover handling):');
  const byReq = {};
  for (const r of heldSelected) {
    const req = r._wmkf_request_value || '(no request)';
    byReq[req] = byReq[req] || [];
    byReq[req].push(r);
  }
  for (const [req, rows] of Object.entries(byReq)) {
    console.log(`    request ${req}: ${rows.length} held`);
    for (const r of rows) {
      const nm = `${r.wmkf_reviewerfirstname || ''} ${r.wmkf_reviewerlastname || ''}`.trim() || '(unnamed)';
      console.log(`      - ${nm.padEnd(28)} accepted=${r.wmkf_accepted ?? 'null'} invited=${r.wmkf_invited ?? 'null'} heldat=${r.wmkf_heldat ?? 'null'} status=${r.wmkf_reviewstatus ?? 'null'}`);
    }
  }
} else {
  console.log('  → No selected HELD rows. Retiring the hold path strands no one.');
}

console.log('\n=== done ===\n');
process.exit(0);
