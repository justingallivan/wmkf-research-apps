/**
 * Reviewer engagement — staff-recorded outcome for an invited reviewer who has
 * not answered (Invite Reviewers "Record outcome…", owner decision
 * 2026-10-31; docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md).
 *
 * Single row. Reads the suggestion fresh, requires that it belongs to the
 * request and is still pending (the same rule as the "no longer needed"
 * release in review-manager/withdraw-sufficient-service.js), then writes
 * applyStaffPendingOutcome bound to that read's ETag, so a reviewer who
 * answers in between makes the write fail with 412 instead of being
 * overwritten.
 *
 * Returns { status }: recorded | not_found | wrong_request | not_pending |
 * honorarium_linked | changed_skipped. Any other write error propagates; the
 * route logs it and returns a fixed message.
 *
 * `outcome` is the normalized dialog choice (normalizeStaffPendingOutcome);
 * the caller has already validated it. Assumes a trusted DAL context.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';

function isStillPending(s) {
  return s.wmkf_invited === true
    && s.wmkf_accepted !== true
    && s.wmkf_declined !== true
    && s.wmkf_responsetype == null;
}

function belongsToRequest(s, requestId) {
  const rowRequestId = String(s?._wmkf_request_value || '').trim().toLowerCase();
  const expected = String(requestId || '').trim().toLowerCase();
  return Boolean(rowRequestId && expected && rowRequestId === expected);
}

export async function recordPendingOutcome({ requestId, suggestionId, outcome, actingUserSystemId }) {
  const s = await suggestionAdapter.findById(suggestionId).catch(() => null);
  if (!s) return { status: 'not_found' };
  // Fail closed: an absent relationship is not evidence of membership.
  if (!belongsToRequest(s, requestId)) return { status: 'wrong_request' };
  if (!isStillPending(s)) return { status: 'not_pending' };
  // Honoraria are created after acceptance; a pending row carrying one is
  // unexpected, so leave it for staff to look at rather than strand it.
  if (s._wmkf_honorariumrequest_value) return { status: 'honorarium_linked' };

  try {
    await suggestionAdapter.applyStaffPendingOutcome(suggestionId, {
      ifMatch: s._etag,
      actingUserSystemId,
      reasonPicklist: outcome.reasonPicklist,
      reasonText: outcome.reasonText,
      endedBy: outcome.endedBy,
    });
  } catch (error) {
    if (error?.status === 412 || /\b412\b/.test(error?.message || '')) return { status: 'changed_skipped' };
    throw error;
  }
  return { status: 'recorded' };
}
