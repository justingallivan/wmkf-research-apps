/**
 * Review Manager — one-row human reviewer closeout.
 *
 * A lead PD/superuser is authorized by the route before this service runs. The
 * service then freshly verifies the received-review state and writes the status,
 * completion timestamp, honorarium-eligibility disposition, and closeout notes
 * in one ETag-bound suggestion PATCH. Notes are required for Not eligible and
 * optional otherwise. It never writes the linked honorarium request.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion.js';
import {
  isHonorariumEligibility,
} from '../../../shared/config/reviewerLifecycle.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors.js';

function closeoutError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, {
    httpStatus,
    body: { error: message, code },
  });
}

function assertDispositionFits(row, disposition) {
  const optedOut = row.wmkf_honorariumoptout === true;
  const hasHonorarium = Boolean(row._wmkf_honorariumrequest_value);

  if (disposition === 'eligible' && (optedOut || !hasHonorarium)) {
    throw closeoutError(
      optedOut
        ? 'A reviewer who opted out cannot be marked eligible.'
        : 'Eligible requires a linked honorarium request.',
      optedOut ? 'eligible_opted_out' : 'eligible_missing_honorarium',
    );
  }
  if (disposition === 'not_applicable' && !optedOut && hasHonorarium) {
    throw closeoutError(
      'Not applicable requires an honorarium opt-out or no linked honorarium request.',
      'not_applicable_conflict',
    );
  }
  if (disposition === 'not_eligible' && (optedOut || !hasHonorarium)) {
    throw closeoutError(
      'No honorarium decision is needed when the reviewer opted out or no honorarium is linked.',
      'not_eligible_not_applicable',
    );
  }
}

function assertCommonPrerequisites(row) {
  if (!row) throw closeoutError('Reviewer suggestion was not found.', 'not_found', 404);
  if (suggestionAdapter.isExcluded(row)) {
    throw closeoutError('An applicant-excluded reviewer cannot be closed.', 'excluded');
  }
  if (row.wmkf_selected !== true) {
    throw closeoutError('The reviewer is no longer selected for this request.', 'not_selected');
  }
  if (row.wmkf_accepted !== true) {
    throw closeoutError('The reviewer has not accepted this assignment.', 'not_accepted');
  }
  if (!row.wmkf_reviewreceivedat) {
    throw closeoutError('A received review is required before closeout.', 'review_not_received');
  }
  if (!row._etag) {
    throw closeoutError('The reviewer row has no concurrency version. Reload and try again.', 'missing_etag');
  }
}

function mapWriteError(error) {
  if (error?.status === 412 || /\b412\b|precondition failed/i.test(error?.message || '')) {
    return closeoutError(
      'The reviewer changed while closeout was being saved. Reload and try again.',
      'conflict',
    );
  }
  if (/refusing to complete|closeout eligibility|received-review timestamp/i.test(error?.message || '')) {
    return closeoutError(
      'The reviewer is no longer eligible for closeout. Reload and try again.',
      'state_changed',
    );
  }
  return error;
}

function normalizeCloseoutNotes(notes) {
  if (notes === undefined) return undefined;
  if (typeof notes !== 'string' || notes.length > 2000) {
    throw closeoutError(
      'notes must be a string of 2000 characters or fewer.',
      'invalid_notes',
      400,
    );
  }
  return notes.trim() || null;
}

/**
 * @returns {Promise<{success:true,status:'closed'|'unchanged'|'corrected',suggestionId:string,disposition:string,completedAt:string|null}>}
 */
export async function closeReview({ suggestionId, disposition, notes, actingUserSystemId, authorizedRequestId }) {
  if (!isHonorariumEligibility(disposition)) {
    throw closeoutError(
      'disposition must be eligible, not_eligible, or not_applicable.',
      'invalid_disposition',
      400,
    );
  }
  if (!authorizedRequestId) {
    throw closeoutError('An authorized request is required for closeout.', 'missing_authorized_request', 400);
  }
  const normalizedNotes = normalizeCloseoutNotes(notes);
  if (disposition === 'not_eligible' && !normalizedNotes) {
    throw closeoutError(
      'A closeout note is required when no honorarium should be paid.',
      'notes_required',
      400,
    );
  }

  let row;
  try {
    row = await suggestionAdapter.findById(suggestionId);
  } catch (error) {
    if (isDataverseRecordNotFound(error)) {
      throw closeoutError('Reviewer suggestion was not found.', 'not_found', 404);
    }
    if (/applicant-excluded/i.test(error?.message || '')) {
      throw closeoutError('An applicant-excluded reviewer cannot be closed.', 'excluded');
    }
    throw error;
  }
  assertCommonPrerequisites(row);
  if (String(row._wmkf_request_value || '').toLowerCase()
      !== String(authorizedRequestId).toLowerCase()) {
    throw closeoutError(
      'The reviewer moved to another request while authorization was being verified. Reload and try again.',
      'request_changed',
    );
  }
  assertDispositionFits(row, disposition);

  const currentStatus = row.wmkf_reviewstatus;
  const completeValue = suggestionAdapter.REVIEW_STATUS_MAP.complete;
  const receivedValue = suggestionAdapter.REVIEW_STATUS_MAP.review_received;

  if (currentStatus === completeValue) {
    const currentDisposition = row.wmkf_honorariumeligibility == null
      ? null
      : suggestionAdapter.HONORARIUM_ELIGIBILITY_BY_VALUE[row.wmkf_honorariumeligibility];
    if (row.wmkf_honorariumeligibility != null && !currentDisposition) {
      throw closeoutError(
        'The existing closeout disposition is not recognized. Technical repair is required.',
        'unknown_existing_disposition',
      );
    }
    const currentNotes = row.wmkf_notes?.trim() || null;
    const notesChanged = normalizedNotes !== undefined && normalizedNotes !== currentNotes;
    if (currentDisposition === disposition && !notesChanged) {
      return {
        success: true,
        status: 'unchanged',
        suggestionId,
        disposition,
        completedAt: row.wmkf_completedat || null,
      };
    }
    const updates = {};
    if (currentDisposition !== disposition) updates.honorariumEligibility = disposition;
    if (notesChanged) updates.notes = normalizedNotes;
    try {
      await suggestionAdapter.updateLifecycle(
        suggestionId,
        updates,
        { actingUserSystemId, ifMatch: row._etag },
      );
    } catch (error) {
      throw mapWriteError(error);
    }
    return {
      success: true,
      status: 'corrected',
      suggestionId,
      disposition,
      completedAt: row.wmkf_completedat || null,
    };
  }

  if (currentStatus !== receivedValue) {
    throw closeoutError(
      'Only a reviewer in Review Received status can be closed.',
      'invalid_source_status',
    );
  }

  const completedAt = new Date().toISOString();
  try {
    await suggestionAdapter.updateLifecycle(
      suggestionId,
      {
        reviewStatus: 'complete',
        completedAt,
        honorariumEligibility: disposition,
        ...(normalizedNotes !== undefined ? { notes: normalizedNotes } : {}),
      },
      { actingUserSystemId, ifMatch: row._etag },
    );
  } catch (error) {
    throw mapWriteError(error);
  }

  return {
    success: true,
    status: 'closed',
    suggestionId,
    disposition,
    completedAt,
  };
}

export const _closeReviewInternals = {
  assertCommonPrerequisites,
  assertDispositionFits,
  normalizeCloseoutNotes,
};

export { ServiceHttpError };
