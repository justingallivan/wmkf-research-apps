import { ContactParser } from '../utils/contact-parser.js';
import { withDalContext } from '../dataverse/core/context.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { getHonorariumCancellationState } from '../dataverse/adapters/grant-request.js';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle.js';
import { resolveProgramDirectorEmailForRequest } from './program-director-resolver.js';
import NotificationService from './notification-service.js';
import {
  parseStoredDeclineReferral,
  referralDisplayText,
} from '../../shared/utils/decline-referrals.js';

// Staff-ended statuses whose linked honorarium is kept and marked Withdrawn
// rather than deleted (owner decision 2026-10-31). A reviewer's own portal
// decline before materials still deletes it.
const STAFF_ENDED_REVIEW_STATUSES = new Set([
  REVIEW_STATUS_MAP.withdrew,
  REVIEW_STATUS_MAP.did_not_submit,
]);

async function readCancellableHonorarium(honorariumRequestId, readHonorarium, code) {
  const honorarium = await readHonorarium(honorariumRequestId);
  if (honorarium?.akoya_requeststatus === 'Withdrawn') return { alreadyWithdrawn: true, honorarium };
  const paid = Number(honorarium?.akoya_paid || 0);
  if (honorarium?.akoya_requeststatus !== 'Pending'
      || honorarium?.wmkf_authorizationtoremitpaymentflag === true
      || (Number.isFinite(paid) && paid > 0)
      || !honorarium?._etag) {
    const error = new Error('late reviewer honorarium is not safely cancellable');
    error.code = code;
    error.retryable = false;
    throw error;
  }
  return { alreadyWithdrawn: false, honorarium };
}

/**
 * Late-honorarium compensation for a declined row. Staff-ended rows (Withdrew,
 * Did not submit) keep the honorarium and mark it Withdrawn; any other decline
 * (the reviewer's own, before materials) deletes it as before.
 */
export async function deleteLateHonorariumForWithdrawnReviewer(
  suggestionId,
  deps = {},
) {
  const suggestions = deps.suggestions || suggestionAdapter;
  const readHonorarium = deps.readHonorarium || getHonorariumCancellationState;
  const current = await suggestions.getForAcceptanceDrain(suggestionId);
  if (current?.wmkf_accepted === true || current?.wmkf_declined !== true) {
    return { deleted: false, reason: 'not_declined' };
  }
  const honorariumRequestId = current?._wmkf_honorariumrequest_value || null;
  if (!honorariumRequestId) {
    return { deleted: false, reason: 'no_linked_honorarium' };
  }
  if (STAFF_ENDED_REVIEW_STATUSES.has(current?.wmkf_reviewstatus)) {
    const { alreadyWithdrawn, honorarium } = await readCancellableHonorarium(
      honorariumRequestId,
      readHonorarium,
      'ended_reviewer_honorarium_not_cancellable',
    );
    if (alreadyWithdrawn) return { deleted: false, withdrawn: false, reason: 'already_withdrawn', honorariumRequestId };
    await suggestions.withdrawLinkedHonorariumForEndedSuggestion(
      suggestionId,
      honorariumRequestId,
      { ifMatch: current._etag, honorariumIfMatch: honorarium._etag },
    );
    return { deleted: false, withdrawn: true, honorariumRequestId };
  }
  await suggestions.deleteLinkedHonorariumForDeclinedSuggestion(
    suggestionId,
    honorariumRequestId,
    { ifMatch: current._etag || undefined },
  );
  return { deleted: true, honorariumRequestId };
}

export async function cancelLateHonorariumForReleasedReviewer(
  suggestionId,
  deps = {},
) {
  const suggestions = deps.suggestions || suggestionAdapter;
  const readHonorarium = deps.readHonorarium || getHonorariumCancellationState;
  const current = await suggestions.getForAcceptanceDrain(suggestionId);
  if (current?.wmkf_reviewstatus !== suggestionAdapter.REVIEW_STATUS_MAP.released) {
    return { cancelled: false, reason: 'not_released' };
  }
  const honorariumRequestId = current?._wmkf_honorariumrequest_value || null;
  if (!honorariumRequestId) return { cancelled: false, reason: 'no_linked_honorarium' };
  const { alreadyWithdrawn, honorarium } = await readCancellableHonorarium(
    honorariumRequestId,
    readHonorarium,
    'released_reviewer_honorarium_not_cancellable',
  );
  if (alreadyWithdrawn) return { cancelled: false, reason: 'already_withdrawn', honorariumRequestId };
  await suggestions.withdrawLinkedHonorariumForReleasedSuggestion(
    suggestionId,
    honorariumRequestId,
    { ifMatch: current._etag, honorariumIfMatch: honorarium._etag },
  );
  return { cancelled: true, honorariumRequestId };
}

export async function notifyProgramDirectorOfReviewerWithdrawal({
  suggestion,
  request,
  reviewer,
  decline,
  honorariumDeleted,
}) {
  const requestId = request?.akoya_requestid || suggestion?._wmkf_request_value || null;
  const reviewerName = ContactParser.normalizeDisplayName(reviewer?.wmkf_name)
    || [suggestion?.wmkf_reviewerfirstname, suggestion?.wmkf_reviewerlastname].filter(Boolean).join(' ')
    || 'Reviewer';
  const reviewerEmail = suggestion?.wmkf_revieweremail || reviewer?.wmkf_emailaddress || null;
  const reason = decline?.reasonPicklist || decline?.reasonText || 'No reason provided';
  const details = decline?.reasonText && decline.reasonText !== reason
    ? ` Additional detail: ${decline.reasonText}`
    : '';
  const referralRows = parseStoredDeclineReferral(decline?.referral);
  const referral = referralRows.length
    ? referralRows.map(referralDisplayText).join('; ')
    : 'No alternate reviewer suggestions were provided.';

  return withDalContext('external-reviewer-withdrawal-notify', async () => {
    const pdEmail = requestId
      ? await resolveProgramDirectorEmailForRequest(requestId).catch(() => null)
      : null;
    return NotificationService.notify({
      type: 'reviewer_self_withdrawn',
      severity: 'info',
      title: `Reviewer withdrew from ${request?.akoya_requestnum || 'a proposal review'}`,
      message:
        `${reviewerName}${reviewerEmail ? ` (${reviewerEmail})` : ''} withdrew from reviewing `
        + `${request?.akoya_title || request?.akoya_requestnum || requestId || 'a proposal'} before materials were released. `
        + `Reason: ${reason}.${details} Alternate suggestions: ${referral} `
        + `The linked honorarium request was ${honorariumDeleted ? 'removed automatically' : 'not present'}.`,
      metadata: {
        requestId,
        requestNumber: request?.akoya_requestnum || null,
        suggestionId: suggestion?.wmkf_appreviewersuggestionid || null,
        reviewerName,
        reviewerEmail,
        decline: decline || {},
        honorariumDeleted: honorariumDeleted === true,
      },
      source: 'external-reviewer-withdrawal',
      emailAdmins: true,
      explicitRecipients: pdEmail ? [pdEmail] : [],
    });
  });
}
