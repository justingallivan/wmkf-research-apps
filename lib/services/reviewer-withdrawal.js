import { ContactParser } from '../utils/contact-parser.js';
import { withDalContext } from '../dataverse/core/context.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { resolveProgramDirectorEmailForRequest } from './program-director-resolver.js';
import NotificationService from './notification-service.js';
import {
  parseStoredDeclineReferral,
  referralDisplayText,
} from '../../shared/utils/decline-referrals.js';

export async function deleteLateHonorariumForWithdrawnReviewer(
  suggestionId,
  deps = {},
) {
  const suggestions = deps.suggestions || suggestionAdapter;
  const current = await suggestions.getForAcceptanceDrain(suggestionId);
  if (current?.wmkf_accepted === true || current?.wmkf_declined !== true) {
    return { deleted: false, reason: 'not_declined' };
  }
  const honorariumRequestId = current?._wmkf_honorariumrequest_value || null;
  if (!honorariumRequestId) {
    return { deleted: false, reason: 'no_linked_honorarium' };
  }
  await suggestions.deleteLinkedHonorariumForDeclinedSuggestion(
    suggestionId,
    honorariumRequestId,
    { ifMatch: current._etag || undefined },
  );
  return { deleted: true, honorariumRequestId };
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
