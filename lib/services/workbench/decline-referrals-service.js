/**
 * Workbench — decline-referral surfacing service.
 *
 * When a reviewer declines an invitation via the external portal, the decline
 * form captures up to four structured Name / Institution / Email rows in a
 * versioned envelope persisted to `wmkf_declinereferral` on the
 * `wmkf_appreviewersuggestion` row. Older free-text values remain readable as
 * legacy referrals. This service returns one staff-actionable DTO per person,
 * with the declining reviewer's name resolved.
 *
 * Deliberately independent of `review-manager/reviewers-service.js`: that
 * service filters to accepted reviewers and early-returns when none are
 * accepted, so a request where every invitee declined (with referrals) before
 * anyone accepted would surface nothing there. This reader works regardless of
 * accepted count.
 *
 * ASSUMES a trusted DAL context already exists — never establishes one (the
 * route wraps the call in withDalContext).
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { queryReviewers } from '../../dataverse/adapters/potential-reviewer';
import { chunk as chunked } from '../../utils/chunk.js';
import {
  parseStoredDeclineReferral,
  referralDisplayText,
} from '../../../shared/utils/decline-referrals';

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Resolve `wmkf_name` for a set of potential-reviewer ids. Mirrors the batch
 * shape used by reviewers-service.fetchPotentialReviewers (25-id OR chains).
 */
async function fetchReviewerNames(ids) {
  if (!ids?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(ids, CHUNK)) {
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p;
  }
  return out;
}

/**
 * List decline-referrals for a single request.
 *
 * @param {{ requestId: string }} args - requestId is the akoya_request GUID
 *   (the route GUID-validates before calling; findByRequest also fails closed
 *   on a non-GUID).
 * @returns {Promise<{ success: true, referrals: Array<{
 *   referralId: string, suggestionId: string, reviewerName: string|null,
 *   referralName: string|null, institution: string|null, email: string|null,
 *   referralText: string, legacy: boolean, declinedAt: string|null }> }>}
 */
export async function getDeclineReferrals({ requestId }) {
  // Declines are archived from the active proposal pool (selected=false), but
  // their alternate-reviewer suggestions remain actionable historical data.
  const rows = await suggestionAdapter.findByRequest(requestId, { selectedOnly: false });
  const declinedWithReferral = rows.filter(
    (r) => r.wmkf_declined === true && hasText(r.wmkf_declinereferral),
  );

  if (declinedWithReferral.length === 0) {
    return { success: true, referrals: [] };
  }

  const personIds = [
    ...new Set(declinedWithReferral.map((r) => r._wmkf_potentialreviewer_value).filter(Boolean)),
  ];
  const nameById = await fetchReviewerNames(personIds);

  const referrals = declinedWithReferral.flatMap((r) => (
    parseStoredDeclineReferral(r.wmkf_declinereferral).map((referral, index) => ({
      referralId: referral.structured
        ? `${r.wmkf_appreviewersuggestionid}:${index}`
        : r.wmkf_appreviewersuggestionid,
      suggestionId: r.wmkf_appreviewersuggestionid,
      reviewerName: nameById[r._wmkf_potentialreviewer_value]?.wmkf_name || null,
      referralName: referral.structured ? referral.name : null,
      institution: referral.structured ? (referral.institution || null) : null,
      email: referral.structured ? (referral.email || null) : null,
      referralText: referralDisplayText(referral),
      legacy: !referral.structured,
      declinedAt: r.wmkf_responsereceivedat || null,
    }))
  ));

  return { success: true, referrals };
}
