/**
 * Reviewer engagement — response correction command
 * (Reviewer Lifecycle Stage 3D: extracted from the `hasLifecycle` branch of
 * `patchMyCandidates` in `lib/services/reviewer-finder/my-candidates-service.js`,
 * which now calls this module at the same point in its per-suggestion PATCH
 * flow — lifecycle write, then the nonfatal accepted-token follow-up, then
 * (back in the old file) person/researcher edits).
 *
 * `MyCandidatesError` lives in the neutral leaf `./errors.js` — `correctionError`
 * (below) constructs it, and the old file also needs it for its non-correction
 * throws without pulling in this module's adapter/token-lifecycle dependencies.
 * `instanceof` and reference identity (`toBe`) hold across all three import
 * paths. `manualInviteError` and the rest of `patchMyCandidates`
 * (bulk-by-request, restore, manual-invite-sent, person/researcher edits, the
 * duplicate-email 409) stay in the old file.
 */

import { isGuid } from '../../utils/guid';
import { isConcreteEtag } from '../../utils/etag';
import { ServiceHttpError } from '../service-http-error';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { ensureToken } from '../../external/token-lifecycle';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors.js';
import { APPLICANT_DISPOSITION_EXCLUDED, RESPONSE_TYPE_MAP } from '../../../shared/config/reviewerLifecycle.js';
import {
  isClosedEngagementRow,
  isInvitationCorrectionSourceRow,
  isInvitedRow,
} from '../../../shared/utils/reviewer-engagement-policy.js';
import { MyCandidatesError } from './errors';
import {
  isFirstManualInvitation,
  screenFirstManualInvitationInstitutionCOI,
} from '../reviewer-first-manual-invitation-coi';

function correctionError(message, code, httpStatus = 409) {
  return new MyCandidatesError(message, httpStatus, { error: message, code });
}

/**
 * Apply an approved response-only lifecycle correction to one reviewer
 * suggestion, then (nonfatally) mint the external-reviewer token when the
 * correction flips the reviewer to accepted.
 *
 * Preserves the caller's order: lifecycle write (ETag-conditional, guarded by
 * the authorized-request binding, applicant-exclusion, closed-engagement and
 * invitation-correction-source checks) completes and only then does the
 * best-effort token follow-up run — a token-mint failure is logged and does
 * NOT fail the correction.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID-validated by the caller (`my-candidates-service.js`)
 * @param {Object} args.lifecycle - single-update lifecycle fields (non-empty, built by the caller)
 * @param {string} args.authorizedRequestId - the request GUID the caller authorized this correction against
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<void>}
 */
// A correction never erases what protects Remove and Restore
// (INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31, writer matrix). On a contacted
// row it may not clear the invited flag or sent time. On a row whose answer
// ended the engagement (Declined, No Response, no longer needed) it may not
// change that answer, except a decline corrected to Accepted. Additive
// corrections stay allowed (e.g. Accepted on a row whose review arrived);
// terminal statuses are already refused by isInvitationCorrectionSourceRow.
const ENDING_RESPONSE_TYPES = new Set([
  RESPONSE_TYPE_MAP.declined, RESPONSE_TYPE_MAP.no_response, RESPONSE_TYPE_MAP.withdrawn_sufficient,
]);
const ANSWER_KEYS = ['accepted', 'declined', 'responseType', 'responseReceivedAt'];

function assertCorrectionKeepsHistory(current, lifecycle = {}) {
  // Any supplied invited value other than true clears the flag (false, null).
  const clearsInvitation = (lifecycle.invited !== undefined && lifecycle.invited !== true)
    || (lifecycle.emailSentAt !== undefined && (lifecycle.emailSentAt === null || String(lifecycle.emailSentAt).trim() === ''));
  if (clearsInvitation && isInvitedRow(current)) {
    throw correctionError('This reviewer was invited; that record cannot be cleared.', 'correction_erases_history');
  }
  const endedByAnswer = current.wmkf_declined === true || ENDING_RESPONSE_TYPES.has(current.wmkf_responsetype);
  if (!endedByAnswer || !ANSWER_KEYS.some((key) => lifecycle[key] !== undefined)) return;
  // A recorded decline may be corrected to Accepted from any open status:
  // pre-materials it mirrors the reviewer's own re-acceptance, and later it
  // repairs a decline contradicted by delivered materials or a received
  // review (the existing correction contract). Terminal statuses never reach
  // here (isInvitationCorrectionSourceRow).
  const correctableDecline = current.wmkf_declined === true || current.wmkf_responsetype === RESPONSE_TYPE_MAP.declined;
  const reAccept = lifecycle.accepted === true
    && (lifecycle.responseType === undefined || lifecycle.responseType === 'accepted')
    && lifecycle.declined !== true;
  if (!(correctableDecline && reAccept)) {
    throw correctionError(
      'This reviewer’s recorded response cannot be changed here. The only change allowed is a decline corrected to accepted.',
      'correction_erases_history',
    );
  }
}

export async function correctResponse({ suggestionId, lifecycle, authorizedRequestId, actingUserSystemId }) {
  if (!isGuid(authorizedRequestId)) {
    throw correctionError('An authorized request is required for this correction.', 'correction_missing_authorized_request', 400);
  }
  try {
    const current = await suggestionAdapter.findById(suggestionId);
    if (!current) {
      throw correctionError('Reviewer suggestion was not found.', 'correction_not_found', 404);
    }
    if (current.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED) {
      throw correctionError('An applicant-excluded reviewer cannot be corrected.', 'correction_excluded');
    }
    if (String(current._wmkf_request_value || '').toLowerCase() !== authorizedRequestId.toLowerCase()) {
      throw correctionError('The reviewer moved to another request. Reload before correcting it.', 'correction_request_changed');
    }
    if (isClosedEngagementRow(current)) {
      throw correctionError('Closed reviewer invitation and response history cannot be changed here.', 'correction_closed');
    }
    if (!isInvitationCorrectionSourceRow(current)) {
      throw correctionError('The reviewer state could not be verified. Reload before correcting it.', 'correction_state_unavailable');
    }
    if (!isConcreteEtag(current._etag)) {
      throw correctionError('The reviewer version could not be verified. Reload before correcting it.', 'correction_version_unavailable');
    }
    assertCorrectionKeepsHistory(current, lifecycle);
    const hasEmailSentAt = lifecycle?.emailSentAt !== undefined
      && lifecycle?.emailSentAt !== null
      && String(lifecycle.emailSentAt).trim() !== '';
    if ((lifecycle?.invited === true || hasEmailSentAt) && isFirstManualInvitation(current)) {
      await screenFirstManualInvitationInstitutionCOI({
        suggestionId,
        expectedRequestId: authorizedRequestId,
        expectedPersonId: current._wmkf_potentialreviewer_value,
      });
    }
    await suggestionAdapter.updateLifecycle(suggestionId, lifecycle, {
      actingUserSystemId,
      ifMatch: current._etag,
    });
  } catch (error) {
    if (error instanceof ServiceHttpError) throw error;
    if (isDataverseRecordNotFound(error)) {
      throw correctionError('Reviewer suggestion was not found.', 'correction_not_found', 404);
    }
    if (error?.status === 412) {
      throw correctionError('The reviewer changed while the correction was being saved. Reload and try again.', 'correction_conflict');
    }
    if (['correction_closed', 'correction_state_unavailable', 'correction_version_unavailable', 'correction_erases_history'].includes(error?.code)) {
      throw correctionError(error.message, error.code);
    }
    if (/applicant-excluded/i.test(error?.message || '')) {
      throw correctionError('An applicant-excluded reviewer cannot be corrected.', 'correction_excluded');
    }
    throw error;
  }

  // Auto-mint the external-reviewer magic-link token when the
  // reviewer flips to accepted. ensureToken is idempotent — no-op
  // if a usable token already exists, so re-flipping accepted on/off
  // doesn't churn URLs. Failures are logged but don't fail the PATCH
  // — staff can always generate the link manually from Review Manager.
  if (lifecycle.accepted === true) {
    try {
      await ensureToken(suggestionId, { actingUserSystemId });
    } catch (e) {
      console.error(`[correct-response] auto-mint failed for ${suggestionId}: ${e.message}`);
    }
  }
}
