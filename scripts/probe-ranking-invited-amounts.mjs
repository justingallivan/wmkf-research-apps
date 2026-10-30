/**
 * probe-ranking-invited-amounts.mjs — READ-ONLY comparison of invited
 * (`wmkf_invitedamount`) and requested (`akoya_request`) amounts for the
 * proposals Proposal Ranking would load for a cycle.
 *
 * Selects proposals the same way `readProposalRankingSource` does: exact cycle,
 * SE/MR research programs, ordinary (non-test) requests, the trial cutoff, and
 * Phase II Pending. Test requests are always excluded, as production does, and
 * listed separately. Prints every proposal whose amounts differ or whose invited
 * amount is blank, then a summary.
 *
 *   node scripts/probe-ranking-invited-amounts.mjs --cycle=D26
 *
 * Acts against whatever .env.local points at.
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const cycleCode = (process.argv.find((a) => a.startsWith('--cycle=')) || '').slice('--cycle='.length).trim();
if (!cycleCode) { console.error('Give --cycle=<code>, e.g. --cycle=D26'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { TEST_REQUEST_ISOLATION_FIELDS } = await import('../lib/services/test-requests/isolation.js');
const { parseCycleCode } = await import('../lib/utils/cycle-code.js');
const { linkedCycleFilter, linkedCycleExpand } = await import('../lib/dataverse/adapters/operations-grant-cycle.js');
const { RESEARCH_PROGRAM_IDS } = await import('../shared/config/researchPrograms.js');
const { PHASE_II_PENDING } = await import('../shared/config/workbenchVisibility.js');
const { applyProposalRankingTrialCutoff } = await import('../lib/services/proposal-ranking/trial-cutoff.js');

if (!parseCycleCode(cycleCode)) { console.error(`Not a valid funding cycle: ${cycleCode}`); process.exit(2); }
const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;
const money = (v) => (v == null ? '(blank)' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

await bypassDynamicsRestrictions('probe-ranking-invited-amounts', async () => {
  console.log(`host: ${new URL(process.env.DYNAMICS_URL).host}`);
  const result = await DynamicsService.queryAllRecords('akoya_requests', {
    select: `akoya_requestid,akoya_requestnum,akoya_title,akoya_request,wmkf_invitedamount,akoya_requeststatus,_akoya_programid_value,${TEST_REQUEST_ISOLATION_FIELDS.marker},${TEST_REQUEST_ISOLATION_FIELDS.runId}`,
    expand: linkedCycleExpand(),
    filter: `${linkedCycleFilter(cycleCode.trim().toUpperCase())} and ${programFilter}`,
    orderby: 'akoya_requestnum asc,akoya_requestid asc',
  });
  if (result.capped) { console.error('Request scan was capped; results would be incomplete.'); process.exit(1); }
  // Same predicate as TEST_REQUEST_ORDINARY_OData_FILTER, applied here so excluded test requests can be listed.
  const isTest = (row) => row[TEST_REQUEST_ISOLATION_FIELDS.marker] === true || row[TEST_REQUEST_ISOLATION_FIELDS.runId] != null;
  const { requests } = applyProposalRankingTrialCutoff(result.records.filter((row) => !isTest(row)));
  const eligible = requests.filter((row) => row.akoya_requeststatus === PHASE_II_PENDING);
  const tests = result.records.filter((row) => isTest(row) && row.akoya_requeststatus === PHASE_II_PENDING);

  const differ = [];
  const blank = [];
  for (const row of eligible) {
    const program = row._akoya_programid_value?.toLowerCase() === RESEARCH_PROGRAM_IDS[0] ? 'SE' : 'MR';
    const line = `  #${row.akoya_requestnum} ${program} | requested ${money(row.akoya_request)} | invited ${money(row.wmkf_invitedamount)} | ${row.akoya_title || ''}`;
    if (row.wmkf_invitedamount == null) blank.push(line);
    else if (Number(row.wmkf_invitedamount) !== Number(row.akoya_request)) {
      const delta = Number(row.wmkf_invitedamount) - Number(row.akoya_request ?? 0);
      differ.push(`${line} | invited − requested ${delta < 0 ? '−' : '+'}${money(Math.abs(delta))}`);
    }
  }

  console.log(`\n${cycleCode}: ${eligible.length} Phase II Pending proposals ranking would load`);
  console.log(`\n== Invited differs from requested: ${differ.length}`);
  differ.forEach((l) => console.log(l));
  console.log(`\n== Invited amount blank (ranking falls back to requested): ${blank.length}`);
  blank.forEach((l) => console.log(l));
  console.log(`\n== Invited equals requested: ${eligible.length - differ.length - blank.length}`);
  console.log(`\n== Excluded Phase II Pending test requests: ${tests.length}`);
  tests.forEach((row) => console.log(`  #${row.akoya_requestnum} | ${row.akoya_title || ''}`));
});
