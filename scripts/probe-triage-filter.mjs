/**
 * probe-triage-filter.mjs — Read-only live validation of the triage dashboard
 * visibility filter (Codex r2 RISK E: the null-drop trap).
 *
 * Confirms against live prod D26 data that:
 *   - a BARE `wmkf_triagestatus ne <SET_ASIDE>` DROPS untriaged (null) rows
 *     (the Dataverse trap — would wrongly hide untriaged proposals);
 *   - the null-inclusive `(eq null or ne <SET_ASIDE>)` clause INCLUDES them;
 *   - Advancing is shown, Set aside is hidden.
 *
 * No writes. Acts against whatever .env.local points at (prod Dataverse).
 *   node scripts/probe-triage-filter.mjs
 */

import fs from 'fs';
import { D26_ALLOWLIST_CYCLE_CODE } from '../shared/config/d26Allowlist.js';
import { TRIAGE_STATUS } from '../shared/config/triageStatus.js';
import { cycleCodeToOdataFilter } from '../lib/utils/cycle-code.js';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-triage-filter');

const SET_ASIDE = TRIAGE_STATUS.SET_ASIDE;
const ADVANCING = TRIAGE_STATUS.ADVANCING;
const cycle = cycleCodeToOdataFilter(D26_ALLOWLIST_CYCLE_CODE);

async function count(label, filter) {
  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestid',
    filter,
  });
  console.log(`  ${String(records.length).padStart(5)}  ${label}`);
  return records.length;
}

console.log(`\n=== Triage filter probe — cycle ${D26_ALLOWLIST_CYCLE_CODE} (${cycle}) ===\n`);
const total = await count('total in cycle', cycle);
const advancing = await count('Advancing (eq 100000000)', `(${cycle}) and wmkf_triagestatus eq ${ADVANCING}`);
const setAside = await count('Set aside (eq 100000001)', `(${cycle}) and wmkf_triagestatus eq ${SET_ASIDE}`);
const untriaged = await count('untriaged (eq null)', `(${cycle}) and wmkf_triagestatus eq null`);
const bareNe = await count('BARE ne Set aside (trap)', `(${cycle}) and wmkf_triagestatus ne ${SET_ASIDE}`);
const nullInclusive = await count('null-inclusive (eq null or ne Set aside)', `(${cycle}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${SET_ASIDE})`);

// Status breakdown of the untriaged rows — to see what "show all non-set-aside"
// would actually surface beyond the Phase-I-Pending proposals.
const { records: untriagedRows } = await DynamicsService.queryAllRecords('akoya_requests', {
  select: 'akoya_requestid,akoya_requeststatus',
  filter: `(${cycle}) and wmkf_triagestatus eq null`,
});
const byStatus = {};
for (const r of untriagedRows) {
  const s = r.akoya_requeststatus || '(none)';
  byStatus[s] = (byStatus[s] || 0) + 1;
}
console.log(`\n--- Untriaged (${untriagedRows.length}) by akoya_requeststatus ---`);
for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}

// DISCONFIRMING check: are any TRIAGED rows something other than Phase I Pending
// (e.g. a concept that wrongly got a triage mark)? If 0, nothing to erase.
const { records: triagedRows } = await DynamicsService.queryAllRecords('akoya_requests', {
  select: 'akoya_requestid,akoya_requeststatus,wmkf_triagestatus',
  filter: `(${cycle}) and (wmkf_triagestatus eq ${ADVANCING} or wmkf_triagestatus eq ${SET_ASIDE})`,
});
const triagedByStatus = {};
for (const r of triagedRows) {
  const s = r.akoya_requeststatus || '(none)';
  triagedByStatus[s] = (triagedByStatus[s] || 0) + 1;
}
const nonPhaseITriaged = triagedRows.filter(r => r.akoya_requeststatus !== 'Phase I Pending' && r.akoya_requeststatus !== 'Phase II Pending');
console.log(`\n--- TRIAGED (${triagedRows.length}) by akoya_requeststatus (should be Phase I/II Pending only) ---`);
for (const [s, n] of Object.entries(triagedByStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}
console.log(`  → triaged rows that are NOT Phase I/II Pending (would need erasing): ${nonPhaseITriaged.length} ${nonPhaseITriaged.length === 0 ? '✅ none' : '❌ ' + nonPhaseITriaged.map(r => r.akoya_requestid).join(', ')}`);

// The EXACT filters the switched dashboard.js builds (S261), validated live.
console.log(`\n--- Dashboard filters as shipped (cycle=${D26_ALLOWLIST_CYCLE_CODE}, scope=all) ---`);
const base = `akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${ADVANCING}`;
const dashDefault = await count('DEFAULT  (Advancing + Phase II Pending, hide Set aside)',
  `(${cycle}) and (${base}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${SET_ASIDE})`);
const dashInclude = await count('includeSetAside=1  (+ Set aside revealed)',
  `(${cycle}) and (${base} or wmkf_triagestatus eq ${SET_ASIDE})`);
// Independent expected values — do NOT assume Phase II Pending = 0 (robust for any cycle).
const baseCount = await count('  base  (Phase II Pending OR Advancing)', `(${cycle}) and (${base})`);
const baseSetAside = await count('  base ∩ Set aside', `(${cycle}) and (${base}) and wmkf_triagestatus eq ${SET_ASIDE}`);
const expectedDefault = baseCount - baseSetAside;              // base minus any set-aside within base
const expectedInclude = baseCount + (setAside - baseSetAside); // base ∪ all set-aside
console.log(`  DEFAULT == base − (base∩SetAside) = ${baseCount} − ${baseSetAside} = ${expectedDefault}? ${dashDefault === expectedDefault ? 'OK ✅' : `MISMATCH (${dashDefault})`}  — concepts/untriaged excluded`);
console.log(`  includeSetAside == base ∪ SetAside = ${expectedInclude}? ${dashInclude === expectedInclude ? 'OK ✅' : `MISMATCH (${dashInclude})`}`);

console.log(`\n--- Analysis ---`);
console.log(`  total = advancing + setAside + untriaged ? ${total} == ${advancing + setAside + untriaged} → ${total === advancing + setAside + untriaged ? 'OK' : 'MISMATCH'}`);
console.log(`  null-inclusive should = total - setAside (Advancing + untriaged): ${nullInclusive} == ${total - setAside} → ${nullInclusive === total - setAside ? 'OK ✅' : 'MISMATCH ❌'}`);
const trapPresent = bareNe < nullInclusive;
console.log(`  bare-ne (${bareNe}) < null-inclusive (${nullInclusive}) → trap ${trapPresent ? 'PRESENT (bare ne drops nulls — null-inclusive clause is REQUIRED) ✅' : 'absent (bare ne kept nulls)'}`);
console.log(`  Set aside hidden by null-inclusive: ${nullInclusive} excludes the ${setAside} Set-aside rows → ${nullInclusive === total - setAside ? 'OK ✅' : 'CHECK'}`);
