/**
 * Institutional Funding History for the Pre-Site Visit writeup.
 *
 * Produces the `[[AI:InstitutionalFundingHistory]]` sentence deterministically
 * from Dataverse (no LLM). The complete positive Program-grant population is
 * reconciled against the applicant account rollups before narrowing the history.
 *
 * Owner policy 2026-11-03: count, sum and most recent award all use Request
 * records (wmkf_request_type = 100000001), Type = Program, and either broad
 * Grant Program = Research or internal Program = Undergraduate Education -
 * Science & Engineering. Other undergraduate programs are excluded. The existing
 * exact applicant and positive akoya_grant predicates remain in force.
 *
 * Recency uses akoya_decisiondate, else a Month YYYY akoya_fiscalyear label
 * interpreted as that month's first day. A qualifying undated award, read error,
 * capped scan or rollup disagreement aborts generation. Excluded awards do not
 * affect recency. The account akoya_mostrecentgrant rollup is never used.
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
  'akoya_grant',
  'wmkf_request_type',
  '_wmkf_type_value',
  '_akoya_programid_value',
  '_wmkf_grantprogram_value',
  'wmkf_wmkfprojectdescription',
].join(',');

/** Verified against Production option metadata on 2026-11-03. */
export const FUNDING_HISTORY_REQUEST_TYPE = 100000001;
const RESEARCH_GRANT_PROGRAM_LABEL = 'Research';
const UNDERGRADUATE_SCIENCE_PROGRAM_LABEL = 'Undergraduate Education - Science & Engineering';

/**
 * Narrow the already reconciled Program-grant rows to the writeup policy.
 * Exact formatted lookup labels follow the existing environment-independent
 * Research matching convention. Missing/unrecognized classifications are excluded.
 * Type uses the actual lookup, not just its rollup text copy.
 */
export function qualifyingFundingHistoryGrants(records) {
  return records.filter((row) => (
    row?.wmkf_request_type === FUNDING_HISTORY_REQUEST_TYPE
    && clean(row?._wmkf_type_value_formatted) === 'Program'
    && (
      clean(row?._wmkf_grantprogram_value_formatted) === RESEARCH_GRANT_PROGRAM_LABEL
      || clean(row?._akoya_programid_value_formatted) === UNDERGRADUATE_SCIENCE_PROGRAM_LABEL
    )
  ));
}

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
  const rollupCents = cents(rollupSum);
  if (liveCount === 0) {
    // Empty history is accepted only when the sum rollup agrees (null or 0);
    // a positive sum with a zero count is a rollup mid-refresh, not "no awards".
    return rollupCents === null || rollupCents === 0
      ? { ok: true }
      : { ok: false, reason: `rollup sum ${rollupSum} with zero live rows` };
  }
  if (rollupCents === null || rollupCents !== cents(liveSum)) {
    return { ok: false, reason: `rollup sum ${rollupSum ?? 'null'} != live sum ${liveSum}` };
  }
  return { ok: true };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A "Month YYYY" fiscal-year label as the first day of that month (UTC); anything else is null. */
function fiscalYearLabelTime(label) {
  const match = clean(label)?.match(/^([A-Za-z]+) (\d{4})$/);
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  return month === -1 ? null : Date.UTC(Number(match[2]), month, 1);
}

/** Business recency key: board decision date, else the fiscal-year label as a date. */
export function programGrantRecencyDate(row) {
  const decision = clean(row?.akoya_decisiondate);
  if (decision) {
    const time = Date.parse(decision);
    if (Number.isFinite(time)) return time;
  }
  return fiscalYearLabelTime(row?.akoya_fiscalyear);
}

function compareTieBreak(left, right) {
  // Same date (e.g. two awards at one board meeting): later request number
  // wins, then the GUID — stable regardless of Dataverse row order, so the
  // sentence and the generation fingerprint are deterministic.
  const leftNum = Number(left?.akoya_requestnum);
  const rightNum = Number(right?.akoya_requestnum);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return String(left?.akoya_requestnum || '').localeCompare(String(right?.akoya_requestnum || ''))
    || String(left?.akoya_requestid || '').localeCompare(String(right?.akoya_requestid || ''));
}

/**
 * Pick the newest program grant. Returns null for an empty list and throws when
 * any row lacks a usable recency date — "the most recent grant" cannot be
 * asserted if one candidate is undated. Ties on the date resolve by request
 * number, then id (see compareTieBreak), independent of query row order.
 */
export function selectMostRecentProgramGrant(records) {
  if (!records.length) return null;
  let best = null;
  let bestTime = -Infinity;
  for (const row of records) {
    const time = programGrantRecencyDate(row);
    if (time === null) {
      throw new Error(`Program grant ${row?.akoya_requestnum || row?.akoya_requestid || '(unknown)'} has neither a decision date nor a fiscal year; recency is ambiguous.`);
    }
    if (time > bestTime || (time === bestTime && compareTieBreak(row, best) > 0)) {
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
 * @param {number|string|null} input.programGrantCount  qualifying award count
 * @param {number|string|null} input.programGrantSum    qualifying award sum
 * @param {{ awardedIn: string|null, description: string|null, qualifier?: string|null }|null} input.mostRecentGrant
 *   `awardedIn` is the already-formatted fiscal-year label (e.g. "June 2026");
 *   without it the second sentence is omitted. `qualifier` (e.g. "research")
 *   is inserted before "grant" when the cited award is not the institution's
 *   newest program grant overall, so the sentence stays literally true.
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
  if (!hasCount) return `${name} has not previously received a Research or Undergraduate Education - Science & Engineering program grant from WMKF.`;

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
  const qualifier = clean(mostRecentGrant?.qualifier);
  return `${first} The most recent ${qualifier ? `${qualifier} ` : ''}grant was awarded in ${awardedIn}${purpose}.`;
}
