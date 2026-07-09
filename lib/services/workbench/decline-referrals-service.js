/**
 * Workbench — decline-referral surfacing service.
 *
 * When a reviewer declines an invitation via the external portal, the decline
 * form captures a free-text "Anyone you'd suggest instead?" answer, persisted
 * to `wmkf_declinereferral` on the `wmkf_appreviewersuggestion` row
 * (`lib/dataverse/adapters/reviewer-suggestion.js` decline writer). The CAPTURE
 * has been live; nothing READ it — the suggested names sat unseen in Dataverse.
 * This service is the staff-side reader: it returns, for one request, every
 * declined suggestion that carries a non-empty referral, with the declining
 * reviewer's name resolved.
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
 *   suggestionId: string, reviewerName: string|null,
 *   referralText: string, declinedAt: string|null }> }>}
 */
export async function getDeclineReferrals({ requestId }) {
  const rows = await suggestionAdapter.findByRequest(requestId, { selectedOnly: true });
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

  const referrals = declinedWithReferral.map((r) => ({
    suggestionId: r.wmkf_appreviewersuggestionid,
    reviewerName: nameById[r._wmkf_potentialreviewer_value]?.wmkf_name || null,
    referralText: r.wmkf_declinereferral.trim(),
    declinedAt: r.wmkf_responsereceivedat || null,
  }));

  return { success: true, referrals };
}
