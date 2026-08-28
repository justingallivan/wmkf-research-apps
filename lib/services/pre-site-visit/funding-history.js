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
 * - The most recent grant is the newest `akoya_request` row that satisfies the
 *   rollups' own predicate (recovered from their FormulaDefinition on
 *   2026-08-28): applicant match, `wmkf_typeforrollup eq 'Program'`, and
 *   `akoya_grant gt 0`, ordered by `akoya_decisiondate desc`. The account's
 *   `akoya_mostrecentgrant` rollup is NOT used because it is not type-filtered
 *   (max decision date across every award, discretionary included), so it can
 *   disagree with the program-grant count in the same sentence.
 *
 * Callers fail closed: a query error aborts generation rather than rendering
 * "has not previously received" into a board-facing document.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as odata from '../../dataverse/core/odata.js';
import { formatAwardAmount } from '../grantee-document-assembly.js';

export const MOST_RECENT_PROGRAM_GRANT_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_fiscalyear',
  'akoya_decisiondate',
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
 * Newest program grant for an applicant account, or null when none exists.
 * Errors propagate so the caller can fail closed.
 */
export async function findMostRecentProgramGrant(applicantId, { queryRequests } = {
  queryRequests: grantRequestAdapter.queryRequests,
}) {
  const result = await queryRequests({
    select: MOST_RECENT_PROGRAM_GRANT_SELECT,
    filter: programGrantFilter(applicantId),
    orderby: 'akoya_decisiondate desc',
    top: 1,
  });
  return result?.records?.[0] || null;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
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
