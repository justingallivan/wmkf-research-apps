/**
 * Institutional Funding History for the Pre-Site Visit writeup.
 *
 * Produces the `[[AI:InstitutionalFundingHistory]]` sentence deterministically
 * from Dataverse (no LLM), matching the Power Automate template staff used
 * before:
 *
 *   "<AKA> has received <N> awards totaling $<X> million from WMKF. The most
 *    recent grant was awarded in <fiscal year> <WMKF project description>."
 *
 * Sources (all read-only):
 * - Count/sum come from the applicant account rollups
 *   `wmkf_countofprogramgrants` / `wmkf_sumofprogramgrants` — the same fields
 *   the AkoyaGO Organization form's "Award History" panel shows.
 * - Those rollups are cross-checked against the live `akoya_request` rows that
 *   satisfy the rollups' own predicate (recovered from their FormulaDefinition
 *   on 2026-08-28): applicant match, `wmkf_typeforrollup eq 'Program'`, and
 *   `akoya_grant gt 0`. Count and sum must agree or the caller fails closed
 *   (rollups refresh on a schedule and can lag a fresh award).
 * - The most recent grant is chosen in code by `akoya_decisiondate`, falling
 *   back to `wmkf_meetingdate` (decision dates are missing on ~10% of native
 *   awards; a server-side `desc` sort would push those rows last). A candidate
 *   with neither date makes recency ambiguous → fail closed. The account's
 *   `akoya_mostrecentgrant` rollup is NOT used because it is not type-filtered.
 *
 * Callers fail closed: a query error, a capped query, a rollup mismatch, or an
 * ambiguous recency aborts generation rather than rendering a wrong sentence
 * into a board-facing document.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as odata from '../../dataverse/core/odata.js';
import { formatAwardAmount } from '../grantee-document-assembly.js';

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export const PROGRAM_GRANT_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_fiscalyear',
  'akoya_decisiondate',
  'wmkf_meetingdate',
  'akoya_grant',
  'wmkf_wmkfprojectdescription',
].join(',');

/** OData filter mirroring the account program-grant rollup predicate. */
export function programGrantFilter(applicantId) {
  return odata.and([
    odata.eqGuid('_akoya_applicantid_value', applicantId),
    odata.eq('wmkf_typeforrollup', 'Program'),
    'akoya_grant gt 0',
  ]);
}

/**
 * Every program grant for an applicant account (the same row set the account
 * rollups aggregate). Institutions hold at most a few dozen, so the full list
 * is fetched and count/sum/recency are derived in code rather than trusting a
 * scheduled rollup or a server-side sort that puts null dates last. Errors
 * propagate so the caller can fail closed; `capped` is surfaced for the same
 * reason.
 */
export async function loadProgramGrants(applicantId, { queryAllRequests } = {
  queryAllRequests: grantRequestAdapter.queryAllRequests,
}) {
  const result = await queryAllRequests({
    select: PROGRAM_GRANT_SELECT,
    filter: programGrantFilter(applicantId),
  });
  return { records: result?.records || [], capped: result?.capped === true };
}

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Compare the live program-grant rows against the account rollups. Rollups
 * recalculate on a schedule, so a mismatch means the account form and a live
 * query disagree; the caller fails closed until they agree.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function reconcileProgramGrantRollups({ records, rollupCount, rollupSum }) {
  const liveCount = records.length;
  const liveSum = records.reduce((total, row) => total + (Number(row.akoya_grant) || 0), 0);
  const count = Number(rollupCount);
  const normalizedRollupCount = Number.isFinite(count) ? count : 0;
  if (normalizedRollupCount !== liveCount) {
    return { ok: false, reason: `rollup count ${normalizedRollupCount} != live count ${liveCount}` };
  }
  if (liveCount === 0) return { ok: true };
  const rollupCents = cents(rollupSum);
  if (rollupCents === null || rollupCents !== cents(liveSum)) {
    return { ok: false, reason: `rollup sum ${rollupSum ?? 'null'} != live sum ${liveSum}` };
  }
  return { ok: true };
}

/** Business recency key: board decision date, else meeting date. */
export function programGrantRecencyDate(row) {
  const value = clean(row?.akoya_decisiondate) || clean(row?.wmkf_meetingdate);
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Pick the newest program grant. Returns null for an empty list and throws when
 * any row lacks a usable recency date — "the most recent grant" cannot be
 * asserted if one candidate is undated.
 */
export function selectMostRecentProgramGrant(records) {
  if (!records.length) return null;
  let best = null;
  let bestTime = -Infinity;
  for (const row of records) {
    const time = programGrantRecencyDate(row);
    if (time === null) {
      throw new Error(`Program grant ${row?.akoya_requestnum || row?.akoya_requestid || '(unknown)'} has neither a decision date nor a meeting date; recency is ambiguous.`);
    }
    if (time > bestTime) {
      best = row;
      bestTime = time;
    }
  }
  return best;
}

/** "$9.15 million" at or above $1M (trailing zeros trimmed); "$750,000" below. */
export function formatAwardTotal(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1_000_000) return formatAwardAmount(n);
  const millions = (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '');
  return `$${millions} million`;
}

/**
 * "To develop chemical tools." → "to develop chemical tools" so it reads after
 * "awarded in June 2026". The first letter is lowered only when the second is
 * lowercase, which leaves acronyms ("NMR-guided …") alone.
 */
function inlineDescription(value) {
  const text = clean(value);
  if (!text) return null;
  const trimmed = text.replace(/[.\s]+$/, '');
  if (!trimmed) return null;
  if (trimmed.length > 1 && /[A-Z]/.test(trimmed[0]) && /[a-z]/.test(trimmed[1])) {
    return `${trimmed[0].toLowerCase()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

/**
 * Build the Word-ready sentence(s).
 *
 * @param {object} input
 * @param {string} input.institutionName  applicant AKA/name (required)
 * @param {number|string|null} input.programGrantCount  account rollup
 * @param {number|string|null} input.programGrantSum    account rollup
 * @param {{ awardedIn: string|null, description: string|null }|null} input.mostRecentGrant
 *   `awardedIn` is the already-formatted fiscal-year label (e.g. "June 2026");
 *   without it the second sentence is omitted.
 * @returns {string}
 */
export function formatInstitutionalFundingHistory({
  institutionName,
  programGrantCount,
  programGrantSum,
  mostRecentGrant,
}) {
  const name = clean(institutionName);
  if (!name) throw new Error('Institutional funding history requires the institution name.');

  const count = Number(programGrantCount);
  const hasCount = Number.isFinite(count) && count > 0;
  if (!hasCount) return `${name} has not previously received a program grant from WMKF.`;

  const total = formatAwardTotal(programGrantSum);
  const first = total
    ? `${name} has received ${count} award${count === 1 ? '' : 's'} totaling ${total} from WMKF.`
    : `${name} has received ${count} award${count === 1 ? '' : 's'} from WMKF.`;

  // Sentence 2 needs the award date to read correctly ("awarded in June 2026
  // to develop…"); without it the description alone is ungrammatical, so omit.
  const awardedIn = clean(mostRecentGrant?.awardedIn);
  if (!awardedIn) return first;
  const description = inlineDescription(mostRecentGrant?.description);
  const purpose = description ? ` ${description}` : '';
  return `${first} The most recent grant was awarded in ${awardedIn}${purpose}.`;
}
