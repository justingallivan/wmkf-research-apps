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
import { normalizeReviewerName } from '../../utils/reviewer-name-match';
import { reviewerEngagementProjection } from '../../../shared/utils/reviewer-engagement';
import {
  parseStoredDeclineReferral,
  referralDisplayText,
} from '../../../shared/utils/decline-referrals';

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Resolve the identity fields needed to compare a structured referral with a
 * durable referred candidate. Mirrors the batch
 * shape used by reviewers-service.fetchPotentialReviewers (25-id OR chains).
 */
async function fetchReviewerPeople(ids) {
  if (!ids?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(ids, CHUNK)) {
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p;
  }
  return out;
}

function splitSources(value) {
  return String(value || '').split(',').map((token) => token.trim()).filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isResolvedReferredCandidate(row) {
  if (!splitSources(row?.wmkf_sources).includes('referred')) return false;
  const engagement = reviewerEngagementProjection(row);
  // A declined/archived copy still requires the explicit Restore workflow. All
  // other selected or engaged candidates prove that the referral was already
  // carried into this request through the existing referral provenance path.
  return row.wmkf_declined !== true
    && (row.wmkf_selected === true || engagement.handled === true);
}

function structuredReferralAlreadyAdded(referral, candidateRows, personById) {
  if (!referral?.structured) return false;
  const referralName = normalizeReviewerName(referral.name);
  const referralEmail = normalizeEmail(referral.email);
  if (!referralName) return false;
  return candidateRows.some((row) => {
    const person = personById[row._wmkf_potentialreviewer_value];
    if (normalizeReviewerName(person?.wmkf_name) !== referralName) return false;
    // When the reviewer supplied an email, require that exact high-value anchor.
    // A name-only referral intentionally falls back to exact normalized name,
    // matching the existing manual-add/dedupe contract.
    return !referralEmail || normalizeEmail(person?.wmkf_emailaddress) === referralEmail;
  });
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

  const resolvedCandidateRows = rows.filter(isResolvedReferredCandidate);
  const personIds = [
    ...new Set(
      [...declinedWithReferral, ...resolvedCandidateRows]
        .map((r) => r._wmkf_potentialreviewer_value)
        .filter(Boolean),
    ),
  ];
  const personById = await fetchReviewerPeople(personIds);

  const referrals = declinedWithReferral.flatMap((r) => (
    parseStoredDeclineReferral(r.wmkf_declinereferral).flatMap((referral, index) => {
      if (referral.resolved === true) return [];
      if (structuredReferralAlreadyAdded(referral, resolvedCandidateRows, personById)) return [];
      return [{
        referralId: referral.structured
          ? `${r.wmkf_appreviewersuggestionid}:${index}`
          : r.wmkf_appreviewersuggestionid,
        suggestionId: r.wmkf_appreviewersuggestionid,
        referralIndex: index,
        reviewerName: personById[r._wmkf_potentialreviewer_value]?.wmkf_name || null,
        referralName: referral.structured ? referral.name : null,
        institution: referral.structured ? (referral.institution || null) : null,
        email: referral.structured ? (referral.email || null) : null,
        referralText: referralDisplayText(referral),
        legacy: !referral.structured,
        declinedAt: r.wmkf_responsereceivedat || null,
      }];
    })
  ));

  return { success: true, referrals };
}

export async function dismissLegacyDeclineReferral({
  requestId,
  suggestionId,
  actingUserSystemId,
}) {
  const result = await suggestionAdapter.dismissLegacyDeclineReferral(
    { requestId, suggestionId },
    { actingUserSystemId },
  );
  return { success: true, ...result };
}
