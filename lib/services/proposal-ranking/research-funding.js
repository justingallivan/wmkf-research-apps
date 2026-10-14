/**
 * Institution history context only; never an input to scoring or ordering.
 * Owner policy / read-only D26 audit, 2026-10-11: ordinary Research grants,
 * excluding directed, capital/endowment/teaching, Special and Young Scholars.
 * The dated record exceptions below reconcile misleading legacy support tags;
 * they do not hard-code institution totals. Read failures/caps reject preview.
 */
import { RESEARCH_PROGRAM_IDS } from '../../../shared/config/researchPrograms.js';

const EXCLUDED_SUPPORT = new Set([100000000, 100000001, 100000003, 100000009, 100000012, 100000013, 100000014, 100000015, 100000023, 100000024, 100000025, 100000035, 100000036]);
const CAPITAL_REQUESTS = new Set([
  '800308', // Building planning, incorrectly tagged Research.
  '860843', // Physical facilities master plan, tagged Research.
  '963245', // Renovation/equipment award; no supported dollar allocation.
]);
const REVIEW_REQUESTS = new Set([
  '881024', '860892', // Mixed facilities/research support.
  '840727', '870929', '975108', // General fellowships: project-specific scope unresolved.
]);
// These blank support tags were individually read in the 2026-10-11 audit;
// descriptions identify research projects. Unreviewed blank/new tags stay unknown.
const REVIEWED_UNTAGGED = new Set(['992973', '1002305', '1001565', '1000987', '993425', '997140', '1001469', '997111', '993353', '997106']);
const RESEARCH_SUPPORT = new Set([100000004, 100000005, 100000007, 100000008, 100000011, 100000016, 100000017, 100000021, 100000022, 100000026, 100000027, 100000029, 100000033, 100000037, 100000038, 100000039]);
const AWARDED = new Set(['Approved', 'Active', 'Closed']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function unavailableResearchFunding() {
  return { status: 'unavailable', latestAwardYear: null, qualifyingGrantCount: null, totalAmountMinorUnits: null };
}

/** Award-cycle label wins over later administrative decision stamps. */
function awardCycle(row) {
  const fiscal = String(row.akoya_fiscalyear || '').trim();
  const match = fiscal.match(/^([A-Za-z]+) (\d{4})$/);
  if (match && MONTHS.includes(match[1])) return `${match[2]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, '0')}`;
  for (const value of [row.wmkf_meetingdate, row.akoya_decisiondate]) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value))) return value.slice(0, 7);
  }
  return null;
}

export function summarizeResearchFunding(records, account, currencyById) {
  if (!account || !Array.isArray(records)) return unavailableResearchFunding();
  // Cross-check the complete Program population before deriving the narrower bucket.
  const programRows = records.filter((row) => row.wmkf_typeforrollup === 'Program');
  const count = Number(account.wmkf_countofprogramgrants ?? 0);
  const rollup = Number(account.wmkf_sumofprogramgrants ?? 0);
  const programTotal = programRows.reduce((sum, row) => sum + Math.round(Number(row.akoya_grant) * 100), 0);
  if (!Number.isFinite(count) || !Number.isFinite(rollup) || count !== programRows.length
    || Math.round(rollup * 100) !== programTotal) return unavailableResearchFunding();

  let totalCents = 0;
  let lastAwardCycle = null;
  let qualifyingGrantCount = 0;
  let provisional = false;
  for (const row of programRows) {
    const internal = String(row._akoya_programid_value || '').toLowerCase();
    const broad = row._wmkf_grantprogram_value_formatted;
    // Missing taxonomy must not manufacture a first-time institution.
    if (!internal || !broad) return unavailableResearchFunding();
    if (!RESEARCH_PROGRAM_IDS.includes(internal) || broad !== 'Research') continue;
    if (!AWARDED.has(row.akoya_requeststatus)) return unavailableResearchFunding();
    const support = String(row.wmkf_supporttype2 ?? '').split(',').filter(Boolean).map(Number);
    if (support.some((value) => !Number.isInteger(value) || value < 100000000 || value > 100000040)
      || (!support.length && !REVIEWED_UNTAGGED.has(String(row.akoya_requestnum)))) return unavailableResearchFunding();
    if (support.some((value) => EXCLUDED_SUPPORT.has(value)) || CAPITAL_REQUESTS.has(String(row.akoya_requestnum))) continue;
    const currency = currencyById.get(String(row._transactioncurrencyid_value || '').toLowerCase());
    const amount = Number(row.akoya_grant);
    const cycle = awardCycle(row);
    if (currency?.isocurrencycode !== 'USD' || !Number.isFinite(amount) || amount <= 0 || !cycle
      || !Number.isSafeInteger(Math.round(amount * 100))) return unavailableResearchFunding();
    totalCents += Math.round(amount * 100);
    if (!Number.isSafeInteger(totalCents)) return unavailableResearchFunding();
    qualifyingGrantCount += 1;
    if (!lastAwardCycle || cycle > lastAwardCycle) lastAwardCycle = cycle;
    if (REVIEW_REQUESTS.has(String(row.akoya_requestnum)) || support.some((value) => !RESEARCH_SUPPORT.has(value))) provisional = true;
  }
  return { status: provisional ? 'provisional' : 'available', latestAwardYear: lastAwardCycle ? Number(lastAwardCycle.slice(0, 4)) : null, qualifyingGrantCount, totalAmountMinorUnits: totalCents };
}
