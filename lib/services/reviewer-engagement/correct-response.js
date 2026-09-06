/**
 * Reviewer engagement — response correction command
 * (Reviewer Lifecycle Stage 3D: extracted from the `hasLifecycle` branch of
 * `patchMyCandidates` in `lib/services/reviewer-finder/my-candidates-service.js`,
 * which now calls this module at the same point in its per-suggestion PATCH
 * flow — lifecycle write, then the nonfatal accepted-token follow-up, then
 * (back in the old file) person/researcher edits).
 *
 * `MyCandidatesError` moved here too: `correctionError` (below) constructs
 * it, and moving only the function would create a circular import
 * (`reviewer-engagement/` → `reviewer-finder/`). The old file re-exports it
 * for compatibility — `instanceof` and reference identity (`toBe`) hold
 * across both import paths. `manualInviteError` and the rest of
 * `patchMyCandidates` (bulk-by-request, restore, manual-invite-sent, person/
 * researcher edits, the duplicate-email 409) stay in the old file.
 */

import { isGuid } from '../../utils/guid';
import { ServiceHttpError } from '../service-http-error';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { ensureToken } from '../../external/token-lifecycle';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors.js';
import { APPLICANT_DISPOSITION_EXCLUDED } from '../../../shared/config/reviewerLifecycle.js';
import {
  isClosedEngagementRow,
  isInvitationCorrectionSourceRow,
} from '../../../shared/utils/reviewer-engagement-policy.js';

/**
 * Domain error; `body` set explicitly where the historical envelope carries
 * more than `{ error }` (rejected-fields 400, duplicate-key 409, sanitized
 * proposals-mode 500).
 */
export class MyCandidatesError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'MyCandidatesError';
  }
}

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
 * @param {string} args.suggestionId - GUID-validated by the shell
 * @param {Object} args.lifecycle - single-update lifecycle fields (non-empty, built by the caller)
 * @param {string} args.authorizedRequestId - the request GUID the caller authorized this correction against
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<void>}
 */
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
    if (typeof current._etag !== 'string'
        || current._etag !== current._etag.trim()
        || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(current._etag)) {
      throw correctionError('The reviewer version could not be verified. Reload before correcting it.', 'correction_version_unavailable');
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
    if (['correction_closed', 'correction_state_unavailable', 'correction_version_unavailable'].includes(error?.code)) {
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
      console.error(`[my-candidates] auto-mint failed for ${suggestionId}: ${e.message}`);
    }
  }
}
