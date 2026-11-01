/**
 * Review Manager — fail-closed post-accept terminal transition service.
 *
 * Terminal statuses are intentionally isolated from the generic reviewers
 * PATCH. Every row is freshly read, state-checked, and conditionally written
 * with that read's ETag. A concurrent review submission therefore wins and
 * the terminal transition reports changed_skipped instead of overwriting it.
 *
 * "Withdrew" is also the staff-recorded equivalent of a post-accept reviewer
 * decline: it corrects accepted/declined response state. "Released" records
 * that sufficient reviews were received and can send reviewed thank-you copy.
 * "Did not submit" records that an accepted reviewer never delivered:
 * declined, Ended by "Reviewer after accepting". All three revoke external
 * access and keep any linked honorarium request, marking an open one
 * Withdrawn in the same changeset; a paid, authorized, non-Pending, unreadable
 * or unversioned honorarium blocks the transition (owner decision 2026-10-31:
 * honoraria are withdrawn, never deleted, by staff-ended engagements). Each
 * status has its own explicit branch; an unknown one throws.
 *
 * A non-412 write failure reports status 'write_failed' with a `failure`
 * code (write_interlocked, dataverse_forbidden, not_found,
 * dataverse_unavailable, unknown) classified from the discarded write
 * error's shape — see classifyWriteFailure. The raw upstream message is
 * never forwarded to the client.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById, getHonorariumCancellationState } from '../../dataverse/adapters/grant-request';
import { getById as getSystemUserById } from '../../dataverse/adapters/system-user';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../../dataverse/adapters/potential-reviewer';
import { DynamicsService } from '../dynamics-service';
import { resolveSignatureForRequest } from '../email-signature';
import { readRequiredEmailDefaults } from '../email-defaults';
import { resolveSenderReleaseTemplate } from '../reviewer-release-personalization';
import { buildWithdrawSufficientBodyText } from '../../external/reviewer-withdraw-email';
import { renderPlainTextEmailHtml } from '../../external/plain-text-email-html';
import { TERMINAL_REVIEW_STATUS_VALUES, isTerminalReviewStatus } from '../../../shared/config/reviewerStatus';
import { ACCEPTED_RELEASE_REASONS, ACCEPTED_RELEASE_REASON_VALUES } from '../../../shared/config/reviewerLifecycle';
import { ServiceHttpError } from '../service-http-error';
import { cancelReviewerAcceptanceJobsForSuggestion } from '../reviewer-acceptance-job-service';
import { classifyEmailDispatchError } from '../../../shared/utils/email-send-outcome';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { assertReviewerDirectedEmailBound } from '../test-requests/reviewer-directed-email';

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

// Classifies a discarded write error into a fixed, client-safe code — mirrors
// lib/services/reviewer-engagement/close-review.js mapWriteError and
// lib/services/review-manager/withdraw-sufficient-service.js
// classifyWriteFailure. The raw error message (which can contain interlock
// hostnames or other upstream detail) is never forwarded to the client.
function classifyWriteFailure(error) {
  if (/^\[dataverse-interlock\] denied/.test(error?.message || '')) {
    return 'write_interlocked';
  }
  const upstreamStatus = Number(error?.status ?? error?.response?.status);
  if (upstreamStatus === 401 || upstreamStatus === 403) return 'dataverse_forbidden';
  if (upstreamStatus === 404) return 'not_found';
  if (upstreamStatus >= 500) return 'dataverse_unavailable';
  if (!Number.isFinite(upstreamStatus)
    && /network|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(`${error?.message || ''} ${error?.code || ''}`)) {
    return 'dataverse_unavailable';
  }
  return 'unknown';
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
  if (row?.akoya_requeststatus !== 'Withdrawn' && row?.akoya_requeststatus !== 'Pending') {
    return { ok: false, status: 'honorarium_not_open' };
  }
  if (!row?._etag) return { ok: false, status: 'honorarium_missing_etag' };
  // An already-Withdrawn honorarium is still bound into the changeset with its
  // ETag (status re-asserted, withdrawal date kept), so a concurrent reopen or
  // authorization by Finance fails the whole transition instead of slipping by.
  if (row.akoya_requeststatus === 'Withdrawn') {
    return {
      ok: true,
      alreadyWithdrawn: true,
      cancelHonorarium: { id: row.akoya_requestid, ifMatch: row._etag, alreadyWithdrawn: true },
    };
  }
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
  let wording = null;
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
    // Start from the sending PD's saved wording; Admin copy when absent or unreadable.
    if (!wording) {
      wording = await resolveSenderReleaseTemplate(pd.systemuserid, 'release', {
        subject: emailDefaults.values[RELEASE_SUBJECT_KEY],
        body: emailDefaults.values[RELEASE_BODY_KEY],
      });
    }
    drafts.push({
      ...base,
      status: 'ok',
      to: reviewer.email,
      from: pd.internalemailaddress,
      senderId: pd.systemuserid,
      subject: wording.template.subject,
      bodyText: buildWithdrawSufficientBodyText({
        bodyTemplate: wording.template.body,
        reviewerName: reviewer.name,
        title: request.akoya_title || null,
        signatureBlock,
      }),
      templateSource: wording.templateSource,
      ...(wording.templateNotice ? { templateNotice: wording.templateNotice } : {}),
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
  withdrawal = null,
}) {
  if (!isTerminalReviewStatus(terminalStatus)) {
    throw new TerminalTransitionError('terminalStatus must be withdrew, released or did_not_submit', 400);
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
        const currentRecipient = normalizeEmail(reviewer.email);
        if (!currentRecipient || currentRecipient !== normalizeEmail(reviewedOverride.to)) {
          results.push({ suggestionId, status: 'recipient_changed' });
          continue;
        }
        if (typeof reviewedOverride.subject !== 'string' || !reviewedOverride.subject.trim()
            || typeof reviewedOverride.bodyText !== 'string' || !reviewedOverride.bodyText.trim()) {
          results.push({ suggestionId, status: 'invalid_override' });
          continue;
        }
      }
    }
    if (row._wmkf_honorariumrequest_value) {
      honorarium = await releaseHonorariumDisposition(row);
      if (!honorarium.ok) {
        results.push({ suggestionId, status: honorarium.status });
        continue;
      }
    }

    try {
      if (terminalStatus === 'withdrew') {
        await suggestionAdapter.applyStaffReviewerWithdrawal(
          suggestionId,
          {
            actingUserSystemId,
            ifMatch: row._etag,
            cancelHonorarium: honorarium?.cancelHonorarium || null,
            // The route validated this with normalizeStaffWithdrawal; a
            // missing value keeps the pre-dialog defaults in the adapter.
            ...(withdrawal ? {
              reasonPicklist: withdrawal.reasonPicklist,
              reasonText: withdrawal.reasonText,
              endedBy: withdrawal.endedBy,
            } : {}),
          },
        );
      } else if (terminalStatus === 'did_not_submit') {
        await suggestionAdapter.applyStaffReviewerDidNotSubmit(
          suggestionId,
          {
            actingUserSystemId,
            ifMatch: row._etag,
            cancelHonorarium: honorarium?.cancelHonorarium || null,
          },
        );
      } else if (terminalStatus === 'released') {
        await suggestionAdapter.applyStaffReviewerRelease(
          suggestionId,
          {
            actingUserSystemId,
            ifMatch: row._etag,
            notes: note,
            cancelHonorarium: honorarium?.cancelHonorarium || null,
          },
        );
      } else {
        throw new TerminalTransitionError(`No terminal writer for ${terminalStatus}`, 500);
      }
      transitioned += 1;
      const result = { suggestionId, status: 'transitioned', terminalStatus };
      if (terminalStatus === 'withdrew' || terminalStatus === 'did_not_submit') {
        result.honorariumWithdrawn = Boolean(honorarium?.cancelHonorarium && !honorarium.alreadyWithdrawn);
        result.honorariumAlreadyWithdrawn = Boolean(honorarium?.alreadyWithdrawn);
        try {
          const cancelledJobs = await cancelReviewerAcceptanceJobsForSuggestion(
            suggestionId,
            terminalStatus === 'withdrew'
              ? 'program_director_recorded_reviewer_withdrawal'
              : 'program_director_recorded_reviewer_did_not_submit',
          );
          result.acceptanceJobsCancelled = cancelledJobs.length;
        } catch (cancelError) {
          // The Dataverse transition is already committed. A leased acceptance
          // worker re-reads the declined state and compensates any late
          // honorarium itself; expose the cleanup warning without converting a
          // successful reviewer removal into a false failure.
          result.warning = 'acceptance_job_cancellation_failed';
          console.warn(
            `[terminal transition] acceptance-job cancellation after staff ${terminalStatus} failed:`,
            cancelError?.message || cancelError,
          );
        }
      }
      if (terminalStatus === 'released') {
        result.releaseReason = releaseReason;
        result.reviewOutcome = 'not_received';
        result.honorariumCancelled = Boolean(honorarium?.cancelHonorarium && !honorarium.alreadyWithdrawn);
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
          let dispatchAttempted = false;
          try {
            await assertReviewerDirectedEmailBound({
              suggestionId,
              requestId,
              recipients: [reviewer.email],
            });
            dispatchAttempted = true;
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
            const classification = dispatchAttempted ? classifyEmailDispatchError(emailError) : { outcome: 'failed' };
            result.status = classification.outcome === 'uncertain'
              ? 'released_email_unconfirmed'
              : 'released_email_failed';
          }
        }
      }
      results.push(result);
    } catch (error) {
      const changed = error?.status === 412 || /\b412\b/.test(error?.message || '');
      results.push(changed
        ? { suggestionId, status: 'changed_skipped' }
        : { suggestionId, status: 'write_failed', failure: classifyWriteFailure(error) });
    }
  }

  return { ok: true, transitioned, results };
}

export const _terminalTransitionInternals = { rowStatus };
