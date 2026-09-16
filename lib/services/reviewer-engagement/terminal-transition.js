/**
 * Review Manager — fail-closed post-accept terminal transition service.
 *
 * Terminal statuses are intentionally isolated from the generic reviewers
 * PATCH. Every row is freshly read, state-checked, and conditionally written
 * with that read's ETag. A concurrent review submission therefore wins and
 * the terminal transition reports changed_skipped instead of overwriting it.
 *
 * "Withdrew" is also the staff-recorded equivalent of a post-accept reviewer
 * decline: it corrects accepted/declined response state and atomically deletes
 * the exact linked honorarium request. "Released" records that sufficient
 * reviews were received, retains and withdraws any open honorarium request,
 * and can send reviewed thank-you copy. Both revoke external access.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById, getHonorariumCancellationState } from '../../dataverse/adapters/grant-request';
import { getById as getSystemUserById } from '../../dataverse/adapters/system-user';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../../dataverse/adapters/potential-reviewer';
import { DynamicsService } from '../dynamics-service';
import { resolveSignatureForRequest } from '../email-signature';
import { readRequiredEmailDefaults } from '../email-defaults';
import { buildWithdrawSufficientBodyText } from '../../external/reviewer-withdraw-email';
import { renderPlainTextEmailHtml } from '../../external/plain-text-email-html';
import { TERMINAL_REVIEW_STATUS_VALUES, isTerminalReviewStatus } from '../../../shared/config/reviewerStatus';
import { ACCEPTED_RELEASE_REASONS, ACCEPTED_RELEASE_REASON_VALUES } from '../../../shared/config/reviewerLifecycle';
import { ServiceHttpError } from '../service-http-error';
import { cancelReviewerAcceptanceJobsForSuggestion } from '../reviewer-acceptance-job-service';
import { classifyEmailDispatchError } from '../../../shared/utils/email-send-outcome';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';

const ALLOWED_SOURCE_VALUES = new Set([
  suggestionAdapter.REVIEW_STATUS_MAP.accepted,
  suggestionAdapter.REVIEW_STATUS_MAP.materials_sent,
  suggestionAdapter.REVIEW_STATUS_MAP.under_review,
]);
const TERMINAL_SOURCE_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));
const RELEASE_SUBJECT_KEY = 'email.reviewer_release.subject';
const RELEASE_BODY_KEY = 'email.reviewer_release.body';
const MAX_INTERNAL_NOTE_LENGTH = 2000;

export class TerminalTransitionError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'TerminalTransitionError';
  }
}

function rowStatus(row) {
  if (row.wmkf_declined === true) return 'already_declined';
  if (row.wmkf_accepted !== true) return 'not_accepted';
  if (row.wmkf_reviewreceivedat) return 'review_received';
  if (row.wmkf_completedat) return 'completed';
  // Stage 2A acceptance durably sets wmkf_accepted but does not stamp the
  // review-status picklist. Treat that exact persisted null as the accepted
  // source state; missing/unknown values still fail closed below.
  const effectiveReviewStatus = row.wmkf_reviewstatus === null
    ? suggestionAdapter.REVIEW_STATUS_MAP.accepted
    : row.wmkf_reviewstatus;
  if (TERMINAL_SOURCE_VALUES.has(effectiveReviewStatus)) return 'already_terminal';
  if (!ALLOWED_SOURCE_VALUES.has(effectiveReviewStatus)) return 'invalid_source';
  if (!row._etag) return 'missing_etag';
  return null;
}

function belongsToRequest(row, requestId) {
  return String(row?._wmkf_request_value || '').toLowerCase() === String(requestId || '').toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNote(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function releaseOverride(overrides, suggestionId) {
  const value = overrides?.[suggestionId];
  if (!value || typeof value.expectedNotes !== 'string') return null;
  return value;
}

async function findSuggestionForPreview(suggestionId) {
  try {
    return await suggestionAdapter.findById(suggestionId);
  } catch (error) {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  }
}

async function resolveReleaseContext(requestId) {
  let request;
  try {
    request = await getRequestById(requestId, {
      select: 'akoya_requestid,akoya_title,_wmkf_programdirector_value',
    });
  } catch (error) {
    if (isDataverseRecordNotFound(error)) {
      throw new TerminalTransitionError(`No request found for ${requestId}`, 404);
    }
    throw error;
  }
  if (!request?.akoya_requestid) {
    throw new TerminalTransitionError(`No request found for ${requestId}`, 404);
  }
  const pd = request._wmkf_programdirector_value
    ? await getSystemUserById(request._wmkf_programdirector_value).catch(() => null)
    : null;
  const canEmail = Boolean(pd?.isdisabled === false && pd?.internalemailaddress && pd?.systemuserid);
  const signatureBlock = await resolveSignatureForRequest(requestId).catch(() => null);
  return { request, pd, canEmail, signatureBlock };
}

async function reviewerContact(row) {
  const person = row?._wmkf_potentialreviewer_value
    ? await getReviewerByIdWithSelect(row._wmkf_potentialreviewer_value, {
      select: 'wmkf_name,wmkf_emailaddress',
    }).catch(() => null)
    : null;
  const rowName = [row?.wmkf_reviewerfirstname, row?.wmkf_reviewerlastname].filter(Boolean).join(' ').trim();
  return {
    name: rowName || person?.wmkf_name || null,
    email: row?.wmkf_revieweremail || person?.wmkf_emailaddress || null,
  };
}

function honorariumDisposition(row) {
  const paid = Number(row?.akoya_paid || 0);
  if (row?.wmkf_authorizationtoremitpaymentflag === true) return { ok: false, status: 'honorarium_authorized' };
  if (Number.isFinite(paid) && paid > 0) return { ok: false, status: 'honorarium_paid' };
  if (row?.akoya_requeststatus === 'Withdrawn') return { ok: true, alreadyWithdrawn: true };
  if (row?.akoya_requeststatus !== 'Pending') return { ok: false, status: 'honorarium_not_open' };
  if (!row?._etag) return { ok: false, status: 'honorarium_missing_etag' };
  return {
    ok: true,
    cancelHonorarium: { id: row.akoya_requestid, ifMatch: row._etag },
  };
}

async function releaseHonorariumDisposition(row) {
  const honorariumRequestId = row?._wmkf_honorariumrequest_value || null;
  if (!honorariumRequestId) return { ok: true, linked: false };
  const honorariumRow = await getHonorariumCancellationState(honorariumRequestId)
    .catch(() => null);
  if (!honorariumRow) return { ok: false, status: 'honorarium_read_failed' };
  return {
    ...honorariumDisposition(honorariumRow),
    linked: true,
  };
}

/** Pure preview for the accepted-reviewer release dialog. */
export async function renderAcceptedReleasePreviews({ requestId, suggestionIds }) {
  const { request, pd, canEmail, signatureBlock } = await resolveReleaseContext(requestId);
  let emailDefaults = null;
  const drafts = [];
  for (const suggestionId of suggestionIds) {
    const row = await findSuggestionForPreview(suggestionId);
    if (!row) { drafts.push({ suggestionId, status: 'not_found' }); continue; }
    if (!belongsToRequest(row, requestId)) { drafts.push({ suggestionId, status: 'wrong_request' }); continue; }
    const rejected = rowStatus(row);
    if (rejected) { drafts.push({ suggestionId, status: rejected }); continue; }
    const base = {
      suggestionId,
      expectedNotes: row.wmkf_notes || '',
      existingNotes: row.wmkf_notes || '',
    };
    const honorarium = await releaseHonorariumDisposition(row);
    if (!honorarium.ok) { drafts.push({ ...base, status: honorarium.status }); continue; }
    const reviewer = await reviewerContact(row);
    base.name = reviewer.name;
    base.honorariumDisposition = honorarium.linked
      ? (honorarium.alreadyWithdrawn ? 'already_withdrawn' : 'will_withdraw')
      : 'none';
    if (!canEmail) { drafts.push({ ...base, status: 'no_pd' }); continue; }
    if (!reviewer.email) { drafts.push({ ...base, status: 'no_email' }); continue; }
    if (!emailDefaults) {
      emailDefaults = await readRequiredEmailDefaults([RELEASE_SUBJECT_KEY, RELEASE_BODY_KEY], {
        source: 'review-manager/terminal-transition:release-preview',
      });
    }
    if (!emailDefaults.ok) { drafts.push({ ...base, status: 'defaults_unavailable' }); continue; }
    drafts.push({
      ...base,
      status: 'ok',
      to: reviewer.email,
      from: pd.internalemailaddress,
      senderId: pd.systemuserid,
      subject: emailDefaults.values[RELEASE_SUBJECT_KEY],
      bodyText: buildWithdrawSufficientBodyText({
        bodyTemplate: emailDefaults.values[RELEASE_BODY_KEY],
        reviewerName: reviewer.name,
        title: request.akoya_title || null,
        signatureBlock,
      }),
    });
  }
  return { ok: true, reason: ACCEPTED_RELEASE_REASONS.sufficient_reviews_received, drafts };
}

/**
 * @returns {Promise<{ok: true, transitioned: number, results: Array}>}
 */
export async function transitionReviewersTerminal({
  requestId,
  suggestionIds,
  terminalStatus,
  actingUserSystemId,
  releaseReason,
  internalNotes = {},
  sendEmail = false,
  overrides = null,
}) {
  if (!isTerminalReviewStatus(terminalStatus)) {
    throw new TerminalTransitionError('terminalStatus must be withdrew or released', 400);
  }
  if (terminalStatus === 'released' && !ACCEPTED_RELEASE_REASON_VALUES.includes(releaseReason)) {
    throw new TerminalTransitionError('releaseReason must be sufficient_reviews_received', 400);
  }

  const releaseContext = terminalStatus === 'released'
    ? await resolveReleaseContext(requestId)
    : null;

  const results = [];
  let transitioned = 0;

  for (const suggestionId of suggestionIds) {
    let row;
    try {
      row = await suggestionAdapter.findById(suggestionId);
    } catch (error) {
      results.push({
        suggestionId,
        status: 'read_failed',
        error: String(error?.message || error).slice(0, 200),
      });
      continue;
    }
    if (!row) {
      results.push({ suggestionId, status: 'not_found' });
      continue;
    }
    if (!belongsToRequest(row, requestId)) {
      results.push({ suggestionId, status: 'wrong_request' });
      continue;
    }

    const rejected = rowStatus(row);
    if (rejected) {
      results.push({ suggestionId, status: rejected });
      continue;
    }

    let reviewedOverride = null;
    let reviewer = null;
    let note = undefined;
    let honorarium = null;
    if (terminalStatus === 'released') {
      reviewedOverride = releaseOverride(overrides, suggestionId);
      if (!reviewedOverride) {
        results.push({ suggestionId, status: 'invalid_override' });
        continue;
      }
      if ((row.wmkf_notes || '') !== reviewedOverride.expectedNotes) {
        results.push({ suggestionId, status: 'notes_changed' });
        continue;
      }
      note = normalizeNote(internalNotes?.[suggestionId]);
      if (internalNotes?.[suggestionId] !== undefined
          && note === null && typeof internalNotes[suggestionId] !== 'string') {
        results.push({ suggestionId, status: 'invalid_note' });
        continue;
      }
      if (typeof note === 'string' && note.length > MAX_INTERNAL_NOTE_LENGTH) {
        results.push({ suggestionId, status: 'invalid_note' });
        continue;
      }
      if (sendEmail) {
        if (!releaseContext.canEmail
            || normalizeId(releaseContext.pd.systemuserid) !== normalizeId(reviewedOverride.senderId)
            || normalizeEmail(releaseContext.pd.internalemailaddress) !== normalizeEmail(reviewedOverride.from)) {
          results.push({ suggestionId, status: 'sender_changed' });
          continue;
        }
        reviewer = await reviewerContact(row);
        if (normalizeEmail(reviewer.email) !== normalizeEmail(reviewedOverride.to)) {
          results.push({ suggestionId, status: 'recipient_changed' });
          continue;
        }
        if (typeof reviewedOverride.subject !== 'string' || !reviewedOverride.subject.trim()
            || typeof reviewedOverride.bodyText !== 'string' || !reviewedOverride.bodyText.trim()) {
          results.push({ suggestionId, status: 'invalid_override' });
          continue;
        }
      }
      if (row._wmkf_honorariumrequest_value) {
        honorarium = await releaseHonorariumDisposition(row);
        if (!honorarium.ok) {
          results.push({ suggestionId, status: honorarium.status });
          continue;
        }
      }
    }

    try {
      if (terminalStatus === 'withdrew') {
        await suggestionAdapter.applyStaffReviewerWithdrawal(
          suggestionId,
          {
            actingUserSystemId,
            ifMatch: row._etag,
            deleteHonorariumRequestId: row._wmkf_honorariumrequest_value || null,
          },
        );
      } else {
        await suggestionAdapter.applyStaffReviewerRelease(
          suggestionId,
          {
            actingUserSystemId,
            ifMatch: row._etag,
            notes: note,
            cancelHonorarium: honorarium?.cancelHonorarium || null,
          },
        );
      }
      transitioned += 1;
      const result = { suggestionId, status: 'transitioned', terminalStatus };
      if (terminalStatus === 'withdrew') {
        result.honorariumDeleted = Boolean(row._wmkf_honorariumrequest_value);
        try {
          const cancelledJobs = await cancelReviewerAcceptanceJobsForSuggestion(
            suggestionId,
            'program_director_recorded_reviewer_withdrawal',
          );
          result.acceptanceJobsCancelled = cancelledJobs.length;
        } catch (cancelError) {
          // The Dataverse transition is already committed. A leased acceptance
          // worker re-reads the declined state and compensates any late
          // honorarium itself; expose the cleanup warning without converting a
          // successful reviewer removal into a false failure.
          result.warning = 'acceptance_job_cancellation_failed';
          console.warn(
            '[terminal transition] acceptance-job cancellation after staff withdrawal failed:',
            cancelError?.message || cancelError,
          );
        }
      }
      if (terminalStatus === 'released') {
        result.releaseReason = releaseReason;
        result.reviewOutcome = 'not_received';
        result.honorariumCancelled = Boolean(honorarium?.cancelHonorarium);
        result.honorariumAlreadyWithdrawn = Boolean(honorarium?.alreadyWithdrawn);
        try {
          const cancelledJobs = await cancelReviewerAcceptanceJobsForSuggestion(
            suggestionId,
            'program_director_released_reviewer_sufficient_reviews',
          );
          result.acceptanceJobsCancelled = cancelledJobs.length;
        } catch (cancelError) {
          result.warning = 'acceptance_job_cancellation_failed';
          console.warn('[terminal transition] acceptance-job cancellation after release failed:', cancelError?.message || cancelError);
        }

        if (!sendEmail) {
          result.status = 'released_no_email_by_choice';
        } else {
          try {
            await DynamicsService.createAndSendEmail({
              subject: reviewedOverride.subject,
              body: renderPlainTextEmailHtml(reviewedOverride.bodyText),
              from: releaseContext.pd.internalemailaddress,
              to: reviewer.email,
              regardingId: requestId,
              regardingType: 'akoya_request',
              actingUserSystemId: releaseContext.pd.systemuserid,
              noFallback: true,
            });
            result.status = 'released_emailed';
          } catch (emailError) {
            const classification = classifyEmailDispatchError(emailError);
            result.status = classification.outcome === 'uncertain'
              ? 'released_email_unconfirmed'
              : 'released_email_failed';
          }
        }
      }
      results.push(result);
    } catch (error) {
      const changed = error?.status === 412 || /\b412\b/.test(error?.message || '');
      results.push({
        suggestionId,
        status: changed ? 'changed_skipped' : 'write_failed',
        error: String(error?.message || error).slice(0, 200),
      });
    }
  }

  return { ok: true, transitioned, results };
}

export const _terminalTransitionInternals = { rowStatus };
