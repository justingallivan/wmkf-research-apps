import {
  ensureAcceptedReviewerContact,
  ensureHonorariumOnboarding,
} from '../bill/honorarium-onboard-orchestrator.js';
import { captureSelfReportedReviewerOrcid } from './capture-self-reported-orcid.js';
import { captureSelfReportedReviewerIdentity } from './capture-self-reported-reviewer-identity.js';
import { syncReviewerNameTitleToContact } from './sync-reviewer-name-title-to-contact.js';
import { alertReviewerEmailMismatch } from './alert-reviewer-email-mismatch.js';
import {
  alertReviewerAffiliationMismatch,
  resolveReviewerAffiliationMismatch,
} from './alert-reviewer-affiliation-mismatch.js';
import { autoLinkReviewerContactAccount } from './auto-link-reviewer-contact-account.js';
import { maybeNotifyQuotaReached } from './reviewer-quota.js';
import NotificationService from './notification-service.js';
import OperationalEventService from './operational-event-service.js';
import { normalizeOrcid } from '../utils/orcid-normalize.js';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import {
  prepareAcceptanceConfirmationEmail,
  sendPreparedAcceptanceConfirmationEmail,
  prepareMaterialsAcceptanceEmail,
  finalizeMaterialsAcceptanceMessage,
} from './reviewer-acceptance-email.js';
import * as materialsReleaseStore from './reviewer-engagement/materials-release-store.js';
import { recordDeliveredEmail } from './reviewer-engagement/record-email-outcome.js';
import { materialsPreflight } from './review-manager/materials-preflight-service.js';
import { cycleCodesByGrantCycleId, loadCycleConfigs } from './review-manager/cycle-config-loader.js';
import { loadCycleMaterialsAttachments } from './review-manager/cycle-materials-attachments.js';
import { emailConfidence } from '../utils/reviewer-invite.js';
import { assertReviewerDirectedEmailBound } from './test-requests/reviewer-directed-email.js';
import { computeReviewerTokenExpiry } from '../external/reviewer-token-ttl.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { isConcreteEtag } from '../utils/etag.js';
import * as requestAdapter from '../dataverse/adapters/grant-request.js';
import AlertService from './alert-service.js';
import { isGuid } from '../utils/guid.js';
import * as jobStore from './reviewer-acceptance-job-service.js';
import encryption from '../utils/encryption.js';
import { buildExternalUrl, buildSendTimeExternalUrlPlaceholder, mintAndStore, SEND_TIME_TOKEN_PLACEHOLDER_JWT } from '../external/token-lifecycle.js';
import {
  cancelLateHonorariumForReleasedReviewer,
  deleteLateHonorariumForWithdrawnReviewer,
} from './reviewer-withdrawal.js';
import { classifyEmailDispatchError } from '../../shared/utils/email-send-outcome.js';
import {
  reviewerAcceptanceSwitchesReady,
  testRequestIsolationEnabled,
} from './test-requests/isolation.js';
import { resolveRequestTestState } from './test-requests/request-test-state.js';

const { decrypt } = encryption;

const DEFAULT_BATCH_LIMIT = 5;
const DEFAULT_LOCK_SECONDS = 300;
const ACCEPT_COMMIT_GRACE_MS = 10 * 60 * 1000;
const LEASE_LOST_CODE = 'reviewer_acceptance_lease_lost';
const REVIEWER_ACCOUNT_SCAN_CAPPED_ALERT_KEY = 'reviewer-contact-account-scan-capped';

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return payload;
}

function selfReportedOrcidOf(payload, suggestion) {
  return payload?.acceptOrcidRaw
    || payload?.body?.contactEdits?.orcid
    || suggestion?.wmkf_reviewerorcid
    || null;
}

function withAcceptedOrcid(reviewer, rawOrcid) {
  const acceptOrcidNorm = normalizeOrcid(rawOrcid);
  if (acceptOrcidNorm.state !== 'valid' || !reviewer) return reviewer;
  return {
    ...reviewer,
    wmkf_orcid: acceptOrcidNorm.id,
  };
}

function withPersistedSelfReport(reviewer, captureResult) {
  if (!reviewer || captureResult?.persisted !== true) return reviewer;
  return { ...reviewer, wmkf_identitystatus: 'confirmed' };
}

async function readCurrentSuggestion(suggestions, suggestionId) {
  return suggestions.getForAcceptanceDrain(suggestionId);
}

async function readCurrentReviewer(payloadReviewer, suggestion, potentialReviewers) {
  const reviewerId = payloadReviewer?.wmkf_potentialreviewersid
    || suggestion?._wmkf_potentialreviewer_value
    || null;
  if (!reviewerId) return payloadReviewer || null;
  try {
    const current = await potentialReviewers.getById(reviewerId);
    return { ...(payloadReviewer || {}), ...(current || {}) };
  } catch (err) {
    console.warn('[reviewer acceptance drain] reviewer re-read failed; using payload snapshot:', err?.message || err);
    return payloadReviewer || null;
  }
}

function makeRetryable(message, { delaySeconds = 60 } = {}) {
  const err = new Error(message);
  err.retryable = true;
  err.delaySeconds = delaySeconds;
  return err;
}

function leaseLost(job, operation) {
  const err = new Error(`reviewer acceptance lease lost before ${operation} for job ${job?.id}`);
  err.code = LEASE_LOST_CODE;
  err.retryable = true;
  return err;
}

function requireLeaseMutation(row, job, operation) {
  if (!row) throw leaseLost(job, operation);
  return row;
}

function timestampMs(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function canonicalJobTimestamp(value) {
  const ms = timestampMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function jobAgeMs(job) {
  const createdAt = timestampMs(job?.created_at);
  return createdAt === null ? ACCEPT_COMMIT_GRACE_MS + 1 : Date.now() - createdAt;
}

function acceptedTimestampStatus(job, payload, currentSuggestion) {
  const responseReceivedAt = currentSuggestion?.wmkf_responsereceivedat || null;
  if (!responseReceivedAt) {
    return { ok: true, reason: 'response_timestamp_missing' };
  }
  const jobAcceptedAt = job?.accepted_at || payload?.acceptedAt || null;
  const responseMs = timestampMs(responseReceivedAt);
  const jobMs = timestampMs(jobAcceptedAt);
  if (responseMs === null || jobMs === null) {
    return {
      ok: false,
      reason: 'accepted_timestamp_unparseable',
      responseReceivedAt,
      jobAcceptedAt,
    };
  }
  return {
    ok: Math.abs(responseMs - jobMs) <= 1000,
    reason: 'accepted_timestamp_mismatch',
    responseReceivedAt,
    jobAcceptedAt,
  };
}

async function notifyHonorariumDeferred({ honResult, suggestion, request, isAcceptRepeat, notify }) {
  if (honResult?.status !== 'deferred') return;
  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  let notifyArgs = null;
  if (honResult.addressCaptureError) {
    notifyArgs = {
      type: 'honorarium_capture_failed',
      severity: 'warning',
      emailAdmins: true,
      autoResolveKey: `honorarium_capture_failed:${suggestionId}`,
      title: 'Reviewer honorarium: mailing address NOT captured',
      message:
        'Reviewer accepted with the honorarium pipeline deferred, but writing the ' +
        'mailing address to the contact failed - staff must capture the payment ' +
        `address manually. Error: ${honResult.addressCaptureError}`,
      metadata: {
        suggestionId,
        requestNumber: request?.akoya_requestnum || null,
        contactId: honResult?.contactId || null,
      },
      source: 'reviewer-acceptance-drain',
      category: 'spend',
    };
  } else if (honResult.partialDiscriminatorConfig) {
    notifyArgs = {
      type: 'honorarium_discriminator_partial_config',
      severity: 'warning',
      emailAdmins: true,
      autoResolveKey: 'honorarium_discriminator_partial_config',
      title: 'Honorarium discriminators only partially configured',
      message:
        'Some but not all of HONORARIUM_PROGRAM_ID / HONORARIUM_GRANTPROGRAM_ID / ' +
        'HONORARIUM_TYPE_ID are set, and HONORARIUM_ONBOARDING_DEFERRED is not set. ' +
        'Reviewers are being captured in capture-only mode instead of having ' +
        'honorarium records created. Set all three GUIDs to go live, or set ' +
        'HONORARIUM_ONBOARDING_DEFERRED=true to defer intentionally.',
      metadata: {
        suggestionId,
        requestNumber: request?.akoya_requestnum || null,
      },
      source: 'reviewer-acceptance-drain',
      category: 'spend',
    };
  } else if (!isAcceptRepeat) {
    notifyArgs = {
      type: 'honorarium_capture_only',
      severity: 'info',
      emailAdmins: false,
      title: 'Reviewer honorarium captured (onboarding deferred)',
      message:
        'Reviewer accepted and provided payment-contact info; the honorarium ' +
        'payment record and BILL onboarding are deferred and must be completed ' +
        'manually once the pipeline is enabled.',
      metadata: {
        suggestionId,
        requestNumber: request?.akoya_requestnum || null,
        contactId: honResult?.contactId || null,
      },
      source: 'reviewer-acceptance-drain',
      category: 'spend',
    };
  }
  if (!notifyArgs) return;
  try {
    await notify(notifyArgs);
  } catch (notifyErr) {
    console.warn('[reviewer acceptance drain] honorarium deferred notice failed (non-fatal):', notifyErr?.message || notifyErr);
  }
}

async function notifyHonorariumFailure({ error, suggestion, request, notify, job }) {
  console.error('[reviewer acceptance drain] honorarium onboarding failed (non-fatal):', error?.message || error);
  try {
    await notify({
      type: 'honorarium_onboard_failed',
      severity: 'warning',
      emailAdmins: true,
      title: 'Honorarium onboarding failed after reviewer accept',
      message: error?.message || String(error),
      metadata: {
        suggestionId: suggestion.wmkf_appreviewersuggestionid,
        requestNumber: request?.akoya_requestnum || null,
        code: error?.code || null,
      },
      autoResolveKey: `honorarium_onboard_failed:${suggestion.wmkf_appreviewersuggestionid}`,
      source: 'reviewer-acceptance-drain',
      category: 'spend',
      // Durable operational event with the structured-error context the alert
      // row can't hold. Job completion marks it recovered; withdrawal
      // cancellation marks it superseded (see settleOperationalFollowupEvents).
      operationalEvent: {
        stage: 'honorarium_onboard',
        transient: typeof error?.isTransient === 'boolean' ? error.isTransient : null,
        requestNumber: request?.akoya_requestnum || null,
        entityRefs: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          jobId: job?.id ?? null,
        },
        metadata: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          requestNumber: request?.akoya_requestnum || null,
          code: error?.code || null,
          serviceName: error?.serviceName || null,
          status: error?.status ?? null,
          causeKind: error?.causeKind || null,
          noResponse: error?.noResponse === true,
          attempts: job?.attempts ?? null,
        },
      },
    });
  } catch (notifyErr) {
    console.error('[reviewer acceptance drain] honorarium alert failed:', notifyErr?.message || notifyErr);
  }
}

/**
 * Settle the durable operational events for a job's follow-up failures once
 * the job reaches a terminal state: 'recovered' when every follow-up finally
 * succeeded (completion), 'superseded' when the work no longer applies
 * (reviewer withdrew). Best-effort — never affects the job outcome.
 */
async function settleOperationalFollowupEvents({ suggestionId, reviewerId, outcome, note }) {
  try {
    const keys = [
      `honorarium_onboard_failed:${suggestionId}`,
      `accepted-reviewer-contact-failed:${reviewerId || suggestionId}`,
    ];
    for (const key of keys) {
      if (outcome === 'recovered') {
        await OperationalEventService.markRecovered(key, { note });
      } else {
        await OperationalEventService.markSuperseded(key, { note });
      }
    }
  } catch (settleErr) {
    console.warn('[reviewer acceptance drain] operational-event settle failed (non-fatal):', settleErr?.message || settleErr);
  }
}

async function notifyAcceptedContactFailure({
  error,
  suggestion,
  request,
  reviewer,
  optedOut,
  notify,
  job,
}) {
  if (error?.staffAlerted) return;
  try {
    await notify({
      type: 'accepted_reviewer_contact_promotion_failed',
      severity: 'warning',
      emailAdmins: true,
      title: 'Accepted reviewer contact promotion failed',
      message: error?.message || String(error),
      metadata: {
        suggestionId: suggestion.wmkf_appreviewersuggestionid,
        requestNumber: request?.akoya_requestnum || null,
        potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
        optedOut,
        code: error?.code || null,
      },
      source: 'reviewer-acceptance-drain',
      category: 'reviewers',
      autoResolveKey: `accepted-reviewer-contact-failed:${reviewer?.wmkf_potentialreviewersid || suggestion.wmkf_appreviewersuggestionid}`,
      // Durable operational event so this failure class reaches the store the
      // completion/withdrawal settle path already targets (Codex adversarial
      // finding, cycle 2, 2026-08-19). recoveryKey derives from autoResolveKey
      // in notify(), matching settleOperationalFollowupEvents' key shape.
      operationalEvent: {
        stage: 'accepted_contact_promotion',
        transient: typeof error?.isTransient === 'boolean' ? error.isTransient : null,
        requestNumber: request?.akoya_requestnum || null,
        entityRefs: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
          jobId: job?.id ?? null,
        },
        metadata: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          requestNumber: request?.akoya_requestnum || null,
          potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
          optedOut,
          code: error?.code || null,
          serviceName: error?.serviceName || null,
          status: error?.status ?? null,
          causeKind: error?.causeKind || null,
          noResponse: error?.noResponse === true,
          attempts: job?.attempts ?? null,
        },
      },
    });
  } catch (notifyErr) {
    console.error('[reviewer acceptance drain] accepted-contact failure alert failed:', notifyErr?.message || notifyErr);
  }
}

async function notifyReviewerAccountScanCapped({ autoLinkResult, notify }) {
  try {
    await notify({
      type: 'reviewer_contact_account_scan_capped',
      severity: 'warning',
      emailAdmins: true,
      title: 'Reviewer institution auto-link Account scan reached its limit',
      message:
        'The active Dataverse Account scan was incomplete, so reviewer institution auto-linking ' +
        'abstained without changing the Contact. Acceptance follow-up and the reviewer-specific ' +
        'affiliation check continued. Increase or replace the bounded Account retrieval before ' +
        'relying on automatic institution links.',
      metadata: {
        scannedCount: autoLinkResult?.scannedCount || 0,
        totalCount: autoLinkResult?.totalCount || null,
      },
      source: 'reviewer-acceptance-drain',
      category: 'reviewers',
      autoResolveKey: REVIEWER_ACCOUNT_SCAN_CAPPED_ALERT_KEY,
    });
  } catch (notifyError) {
    console.warn('[reviewer acceptance drain] capped Account-scan alert failed (non-fatal):', notifyError?.message || notifyError);
  }
}

async function captureReviewerSelfReportedOrcid({ reviewer, contactId, rawOrcid, bindingEventAt, captureOrcid }) {
  if (!rawOrcid) return;
  return captureOrcid({
    potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
    rawOrcid,
    contactId: contactId || null,
    bindingEventAt: bindingEventAt || null,
  });
}

async function captureBoardIdentity({ reviewer, suggestion, request, body, captureIdentity, notify }) {
  try {
    await captureIdentity({
      potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
      academicRank: body?.boardIdentity?.academicRank,
      primaryDepartment: body?.boardIdentity?.primaryDepartment,
      mainInstitution: body?.boardIdentity?.mainInstitution,
    });
  } catch (identityErr) {
    console.error('[reviewer acceptance drain] board-identity capture failed (non-fatal):', identityErr?.message || identityErr);
    try {
      await notify({
        type: 'board_identity_capture_failed',
        severity: 'warning',
        emailAdmins: true,
        title: 'Board-writeup identity capture failed after reviewer accept',
        message: identityErr?.message || String(identityErr),
        metadata: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
          requestNumber: request?.akoya_requestnum || null,
        },
        source: 'reviewer-acceptance-drain',
        category: 'reviewer',
      });
    } catch (notifyErr) {
      console.error('[reviewer acceptance drain] board-identity alert failed:', notifyErr?.message || notifyErr);
    }
  }
}

async function cancelAfterHonorariumIfNeeded({ currentSuggestion, suggestionId, reviewer, job, suggestions, jobs,
  deleteLateHonorarium, cancelLateReleasedHonorarium }) {
  if (currentSuggestion?.wmkf_reviewstatus === suggestionAdapter.REVIEW_STATUS_MAP.released) {
    await cancelLateReleasedHonorarium(suggestionId, { suggestions });
    const cancelled = await jobs.cancelReviewerAcceptanceJob(
      job.id,
      'reviewer_released_during_acceptance_followup',
      { leaseToken: job.lease_token },
    );
    await settleOperationalFollowupEvents({
      suggestionId,
      reviewerId: reviewer?.wmkf_potentialreviewersid || null,
      outcome: 'superseded',
      note: 'reviewer released during acceptance follow-up',
    });
    return {
      jobId: job.id,
      status: 'cancelled',
      reason: cancelled ? 'reviewer_released_during_acceptance_followup' : 'acceptance_job_already_cancelled',
    };
  }
  if (currentSuggestion?.wmkf_declined === true || currentSuggestion?.wmkf_accepted !== true) {
    await deleteLateHonorarium(suggestionId, { suggestions });
    const cancelled = await jobs.cancelReviewerAcceptanceJob(
      job.id,
      'reviewer_withdrew_during_acceptance_followup',
      { leaseToken: job.lease_token },
    );
    // The public withdrawal path may already have cancelled and cleared this
    // lease. Either way, this worker must stop after cleanup.
    await settleOperationalFollowupEvents({
      suggestionId,
      reviewerId: reviewer?.wmkf_potentialreviewersid || null,
      outcome: 'superseded',
      note: 'reviewer withdrew during acceptance follow-up',
    });
    return {
      jobId: job.id,
      status: 'cancelled',
      reason: cancelled ? 'reviewer_withdrew_during_acceptance_followup' : 'acceptance_job_already_cancelled',
    };
  }

  return null;
}

const preparationKey = jobId => `acceptance-confirmation-preparation:${jobId}`;
async function notifyPreparationProblem(job, reason, notify, terminal = false) {
  try {
    await notify({ type: 'reviewer_acceptance_confirmation_preparation_failed', severity: 'warning', emailAdmins: true,
      title: terminal ? 'Reviewer acceptance confirmation was not sent' : 'Reviewer acceptance confirmation preparation paused',
      message: terminal
        ? 'Confirmation not sent; confirm the reviewer is still accepted and eligible before sending by hand.'
        : 'Confirmation not sent. Preparation will retry within the existing bounded job retry window.',
      autoResolveKey: preparationKey(job.id) + (terminal ? ':terminal' : ''), source: 'reviewer-acceptance-drain', category: 'ops',
      metadata: { jobId: job.id, suggestionId: job.suggestion_id, reason },
      operationalEvent: { stage: 'acceptance_confirmation_preparation', transient: !terminal,
        entityRefs: { jobId: job.id, suggestionId: job.suggestion_id } },
    });
  } catch { console.warn('[reviewer acceptance drain] preparation alert unavailable'); }
}
async function settlePreparation(jobId, superseded = false, terminal = false) {
  for (const key of [preparationKey(jobId), ...(terminal ? [preparationKey(jobId) + ':terminal'] : [])]) {
    try {
      if (superseded) await OperationalEventService.markSuperseded(key, { note: 'Acceptance job cancelled; confirmation no longer applies.' });
      await AlertService.autoResolve(key);
    } catch { console.warn('[reviewer acceptance drain] preparation alert settlement unavailable'); }
  }
}
const sameGuid = (a, b) => isGuid(a) && isGuid(b) && a.toLowerCase() === b.toLowerCase();
const confirmationSnapshot = row => JSON.stringify(['_wmkf_request_value', 'wmkf_revieweremail', 'wmkf_reviewduedateoverride',
  'wmkf_accepted', 'wmkf_declined', 'wmkf_reviewstatus', 'wmkf_responsereceivedat'].map(key => row?.[key] ?? null));

async function sendAcceptanceConfirmationOnce({
  job,
  payload,
  suggestion,
  request,
  reviewer,
  prepareAcceptanceEmail, sendPreparedAcceptanceEmail, readConfirmationRequest, readConfirmationSuggestion,
  isolationRequestId, suggestions, deleteLateHonorarium, cancelLateReleasedHonorarium,
  notify, jobs,
}) {
  const existing = job.steps?.acceptance_confirmation || {};
  if (existing.sentAt || existing.claimedAt) {
    return { skipped: true, reason: 'already_claimed' };
  }
  const refuse = async reason => {
    requireLeaseMutation(await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
      preparationFailedAt: new Date().toISOString(), preparationReason: reason,
    }), job, 'acceptance-confirmation preparation refusal');
    await notifyPreparationProblem(job, reason, notify);
    return { retryError: makeRetryable(`acceptance_confirmation_preparation: ${reason}`, { delaySeconds: 300 }) };
  };
  let prepared, freshSuggestion, freshRequest;
  try {
    freshSuggestion = await readConfirmationSuggestion(suggestion.wmkf_appreviewersuggestionid);
  } catch { return refuse('suggestion_unavailable'); }
  const cancelFresh = row => cancelAfterHonorariumIfNeeded({ currentSuggestion: row,
    suggestionId: suggestion.wmkf_appreviewersuggestionid, reviewer, job, suggestions, jobs,
    deleteLateHonorarium, cancelLateReleasedHonorarium });
  // A failed read is not evidence of withdrawal.
  if (!freshSuggestion) return refuse('suggestion_unavailable');
  let cancelled = await cancelFresh(freshSuggestion);
  if (cancelled) return { cancelled };
  if (!acceptedTimestampStatus(job, payload, freshSuggestion).ok) return refuse('accepted_timestamp_changed');
  const requestId = freshSuggestion._wmkf_request_value;
  if (!sameGuid(requestId, job.request_id) || (payload.request?.akoya_requestid && !sameGuid(requestId, payload.request.akoya_requestid))
      || (isolationRequestId !== undefined && !sameGuid(requestId, isolationRequestId))) return refuse('request_identity_mismatch');
  try {
    freshRequest = await readConfirmationRequest(requestId, { select: 'akoya_requestid,akoya_requestnum,akoya_title,_wmkf_programdirector_value,wmkf_reviewduedate' });
    if (!sameGuid(freshRequest?.akoya_requestid, requestId)) return refuse('request_identity_mismatch');
    const token = payload?.reviewerPortalTokenEncrypted ? decrypt(payload.reviewerPortalTokenEncrypted) : null;
    if (payload?.reviewerPortalTokenEncrypted && !token) return refuse('withdrawal_token_unavailable');
    const withdrawUrl = token ? `${buildExternalUrl(token)}?action=decline` : null;
    prepared = await prepareAcceptanceEmail({ suggestion: freshSuggestion, request: freshRequest, reviewer, withdrawUrl });
  } catch { return refuse('preparation_unavailable'); }
  if (!prepared?.ok) return refuse(prepared?.reason || 'preparation_unavailable');
  let rechecked;
  try { rechecked = await readConfirmationSuggestion(suggestion.wmkf_appreviewersuggestionid); }
  catch { return refuse('suggestion_unavailable'); }
  if (!rechecked) return refuse('suggestion_unavailable');
  cancelled = await cancelFresh(rechecked);
  if (cancelled) return { cancelled };
  if (confirmationSnapshot(rechecked) !== confirmationSnapshot(freshSuggestion)) return refuse('suggestion_changed');
  requireLeaseMutation(
    await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
      claimedAt: new Date().toISOString(),
    }),
    job,
    'acceptance-confirmation claim',
  );
  await settlePreparation(job.id);
  let result;
  try {
    result = await sendPreparedAcceptanceEmail(prepared);
    if (result?.sent !== true) throw new Error('Acceptance confirmation transport receipt unconfirmed');
  } catch (emailErr) {
    const classification = classifyEmailDispatchError(emailErr);
    console.error('[reviewer acceptance drain] acceptance confirmation failed (non-fatal):', emailErr?.message || emailErr);
    requireLeaseMutation(
      await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
        failedAt: new Date().toISOString(),
        outcome: classification.outcome,
        error: emailErr?.message || String(emailErr),
      }),
      job,
      'acceptance-confirmation failure recording',
    );
    try {
      await notify({
        type: 'reviewer_acceptance_confirmation_failed',
        severity: 'warning',
        emailAdmins: true,
        title: classification.outcome === 'uncertain'
          ? 'Reviewer acceptance confirmation email status is uncertain'
          : 'Reviewer acceptance confirmation email failed',
        message: emailErr?.message || String(emailErr),
        metadata: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          requestNumber: request?.akoya_requestnum || null,
          reviewerEmail: reviewer?.wmkf_emailaddress || suggestion?.wmkf_revieweremail || null,
          outcome: classification.outcome,
        },
        source: 'reviewer-acceptance-drain',
        category: 'ops',
      });
    } catch (notifyErr) {
      console.error('[reviewer acceptance drain] acceptance confirmation alert failed:', notifyErr?.message || notifyErr);
    }
    return { sent: false, reason: classification.outcome === 'uncertain' ? 'send_unconfirmed' : 'send_failed' };
  }
  requireLeaseMutation(
    await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
      sentAt: new Date().toISOString(),
      result: result || null,
    }),
    job,
    'acceptance-confirmation success recording',
  );
  await settlePreparation(job.id, false, true);
  return { sent: true };
}

const MATERIALS_STEP = 'release_materials';
// Mirrors send-emails-service.js MATERIALS_ALREADY_DELIVERED_STATUSES.
const MATERIALS_DELIVERED_STATUSES = new Set(['materials_sent', 'under_review', 'review_received', 'complete']
  .map(key => suggestionAdapter.REVIEW_STATUS_MAP[key]));
const MATERIALS_CYCLE_FIELDS = Object.freeze({ review_template_blob_url: 'reviewTemplateBlobUrl', additional_attachments: 'additionalAttachments' });
const materialsAlertKey = suggestionId => `reviewer-materials-release:${suggestionId}`;
/** Same eligibility as the manual materials send: delivered stays delivered; a
 * revoked link or any status other than accepted/blank is a staff hold. */
function materialsEligibility(row) {
  const status = row?.wmkf_reviewstatus;
  if (row?.wmkf_materialssentat || MATERIALS_DELIVERED_STATUSES.has(status)) return 'delivered';
  if (row?.wmkf_externaltokenrevoked === true || (status != null && status !== suggestionAdapter.REVIEW_STATUS_MAP.accepted)) return 'ineligible';
  return 'eligible';
}

async function notifyMaterials(notify, { job, suggestionId, kind, reason }) {
  const titles = {
    held: 'Reviewer materials held for manual release',
    stopped: 'Reviewer materials release needs staff attention',
    unrecorded: 'Reviewer materials sent but not yet recorded',
  };
  const messages = {
    held: 'The reviewer accepted and got the usual acceptance email. Materials were not sent automatically; release them from the Review Manager.',
    unrecorded: 'The materials email went out, but the reviewer row does not show it yet. The job keeps retrying; if this persists, check the reviewer\u2019s status.',
    stopped: 'Materials may not have reached the reviewer. Check the release and use "Send materials again" if needed. The reviewer’s invitation link may no longer work.',
  };
  // Returns false when the alert could not be stored; callers then retry
  // instead of completing the step, so the alert is never silently lost.
  try {
    await notify({ type: `reviewer_materials_release_${kind}`, severity: 'warning', emailAdmins: true,
      title: titles[kind], message: messages[kind], autoResolveKey: materialsAlertKey(suggestionId),
      source: 'reviewer-acceptance-drain', category: 'ops', metadata: { jobId: job.id, suggestionId, reason } });
    return true;
  } catch {
    console.warn('[reviewer acceptance drain] materials alert unavailable');
    return false;
  }
}

/**
 * D46/D49: on acceptance, send the materials in the one acceptance email.
 * Everything reversible (fresh reads, PDF, cycle attachments, sender, render)
 * runs before the shared release claim; the link is re-minted only after it.
 * Retries act on the release row's state, never on this step alone
 * (docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md §3.3 build notes).
 * Falls back to today's acceptance confirmation, with materials held for manual
 * release, when the materials cannot go out automatically.
 */
async function releaseMaterialsOnAcceptance(ctx) {
  const { job, payload, suggestion, reviewer, jobs, notify, materials, readConfirmationRequest, potentialReviewers,
    readConfirmationSuggestion, isolationRequestId, suggestions, deleteLateHonorarium, cancelLateReleasedHonorarium } = ctx;
  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  const step = async patch => requireLeaseMutation(
    await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, MATERIALS_STEP, patch), job, 'materials release step');
  const done = async (outcome, reason = null) => {
    await step({ outcome, reason, completedAt: new Date().toISOString() });
    return { [outcome]: true, reason };
  };
  const retry = async reason => {
    await step({ preparationFailedAt: new Date().toISOString(), preparationReason: reason });
    return { retryError: makeRetryable(`materials_release_preparation: ${reason}`, { delaySeconds: 300 }) };
  };
  const hold = async reason => {
    const confirmation = await sendAcceptanceConfirmationOnce(ctx);
    if (confirmation.cancelled || confirmation.retryError) return confirmation;
    if (!(await notifyMaterials(notify, { job, suggestionId, kind: 'held', reason }))) return retry('materials_alert_unavailable');
    return done('held', reason);
  };
  const stop = async reason => {
    if (!(await notifyMaterials(notify, { job, suggestionId, kind: 'stopped', reason }))) return retry('materials_alert_unavailable');
    return done('stopped', reason);
  };
  // Bookkeeping after a confirmed send: retries never resend; a lasting failure
  // alerts so the decline lock and status do not silently stay unset.
  const record = async sentAt => {
    try {
      await materials.recordDelivered({ suggestionId, originalSuggestion: suggestion, templateType: 'materials', sentAt, actingUserSystemId: undefined });
      await materials.record(suggestionId);
    } catch {
      await notifyMaterials(notify, { job, suggestionId, kind: 'unrecorded', reason: 'materials_bookkeeping_unavailable' });
      return retry('materials_bookkeeping_unavailable');
    }
    return done('released');
  };

  if (job.steps?.[MATERIALS_STEP]?.completedAt) return { skipped: true, reason: 'already_completed' };

  // 1. An existing release row decides everything; it is never resumed blindly.
  let existing;
  try { existing = await materials.get(suggestionId); } catch { return retry('release_state_unavailable'); }
  if (existing) {
    const ours = existing.source === 'acceptance' && String(existing.job_id) === String(job.id);
    if (!ours) return done('skipped', 'release_owned_elsewhere');
    if (existing.state === 'recorded') return done('released');
    if (existing.state === 'sent') return record(existing.sent_at instanceof Date ? existing.sent_at.toISOString() : existing.sent_at);
    // A worker that lost the job lock may still be sending under its release
    // lease: wait for it to finish or expire rather than closing it out.
    if (['claimed', 'link_minted'].includes(existing.state) && Date.parse(existing.lease_until) > Date.now()) return retry('release_in_progress');
    return stop(`release_${existing.state}`);
  }

  // 2. Fresh reads and identity, as the confirmation does.
  let freshSuggestion, freshRequest;
  try { freshSuggestion = await readConfirmationSuggestion(suggestionId); } catch { return retry('suggestion_unavailable'); }
  if (!freshSuggestion) return retry('suggestion_unavailable');
  const cancelFresh = row => cancelAfterHonorariumIfNeeded({ currentSuggestion: row, suggestionId, reviewer, job,
    suggestions, jobs, deleteLateHonorarium, cancelLateReleasedHonorarium });
  let cancelled = await cancelFresh(freshSuggestion);
  if (cancelled) return { cancelled };
  if (!acceptedTimestampStatus(job, payload, freshSuggestion).ok) return retry('accepted_timestamp_changed');
  const requestId = freshSuggestion._wmkf_request_value;
  if (!sameGuid(requestId, job.request_id) || (payload.request?.akoya_requestid && !sameGuid(requestId, payload.request.akoya_requestid))
      || (isolationRequestId !== undefined && !sameGuid(requestId, isolationRequestId))) return retry('request_identity_mismatch');
  const eligibility = materialsEligibility(freshSuggestion);
  if (eligibility === 'delivered') return done('skipped', 'materials_already_sent');
  if (eligibility === 'ineligible') return hold('materials_release_ineligible');
  try {
    freshRequest = await readConfirmationRequest(requestId, { select: 'akoya_requestid,akoya_requestnum,akoya_title,_wmkf_programdirector_value,wmkf_reviewduedate,_wmkf_grantcycle_value' });
  } catch { return retry('request_unavailable'); }
  if (!sameGuid(freshRequest?.akoya_requestid, requestId)) return retry('request_identity_mismatch');

  // 3. Can the materials go out automatically? Decided before any claim.
  // The address check needs the live reviewer row; the job's snapshot fallback
  // would see no trust state and pass a conflicted address.
  let person;
  try { person = await potentialReviewers.getById(freshSuggestion._wmkf_potentialreviewer_value); } catch { return retry('reviewer_unavailable'); }
  if (!person) return retry('reviewer_unavailable');
  if (emailConfidence(person).action === 'blocked') return hold('address_conflict_pending');
  let preflight;
  try { preflight = await materials.preflight({ requestId }); } catch { return retry('proposal_unavailable'); }
  if (!preflight?.ok) return retry('proposal_unavailable');
  if (!(preflight.fileCount > 0)) return hold('proposal_missing');
  let cycleConfig;
  try {
    const grantCycleId = freshRequest._wmkf_grantcycle_value;
    const code = grantCycleId ? (await materials.cycleCodes([grantCycleId]))[grantCycleId] : null;
    if (!code) return hold('grant_cycle_missing');
    cycleConfig = (await materials.cycleConfigs([code], { fields: MATERIALS_CYCLE_FIELDS }))[code];
  } catch { return retry('cycle_configuration_unavailable'); }
  if (!cycleConfig) return hold('cycle_configuration_missing');
  let attachments;
  try { attachments = await materials.attachments(cycleConfig); } catch { return retry('cycle_attachments_unavailable'); }
  const prepared = await materials.prepare({ suggestion: freshSuggestion, request: freshRequest, reviewer, attachments,
    placeholderUrl: buildSendTimeExternalUrlPlaceholder(), placeholderToken: SEND_TIME_TOKEN_PLACEHOLDER_JWT });
  if (!prepared?.ok) return prepared?.reason === 'materials_defaults_blank' ? hold('materials_template_missing') : retry(prepared?.reason || 'preparation_unavailable');
  try {
    await materials.assertBound({ suggestionId, requestId, recipients: [prepared.message.to] });
  } catch { return hold('test_request_email_denied'); }
  let rechecked;
  try { rechecked = await readConfirmationSuggestion(suggestionId); } catch { return retry('suggestion_unavailable'); }
  if (!rechecked) return retry('suggestion_unavailable');
  cancelled = await cancelFresh(rechecked);
  if (cancelled) return { cancelled };
  // Revocation or delivery during preparation is re-evaluated by the next attempt;
  // the mint below is bound to this validated version.
  if (confirmationSnapshot(rechecked) !== confirmationSnapshot(freshSuggestion) || materialsEligibility(rechecked) !== 'eligible'
      || !isConcreteEtag(rechecked._etag)) return retry('suggestion_changed');

  // 4. Claim, then the irreversible part.
  let claim;
  try {
    claim = await materials.claim({ suggestionId, requestId, source: 'acceptance', jobId: job.id });
  } catch { return retry('release_claim_unavailable'); }
  if (!claim.claimed) return done('skipped', 'release_owned_elsewhere');
  const leaseToken = claim.release.lease_token;
  await step({ claimedAt: new Date().toISOString() });
  let minted;
  try {
    minted = await materials.mint({ suggestionId, requestId,
      expiresAt: computeReviewerTokenExpiry({ accepted: true, reviewDueDate: resolveEffectiveReviewDueDate({
        overrideDate: rechecked.wmkf_reviewduedateoverride, defaultDate: freshRequest.wmkf_reviewduedate }) }),
      ifMatch: rechecked._etag });
  } catch {
    await materials.stopRelease(suggestionId, leaseToken, 'failed', 'link_mint_failed').catch(() => null);
    return stop('link_mint_failed');
  }
  if (!(await materials.markLinkMinted(suggestionId, leaseToken))) return stop('release_lease_lost');
  let message;
  try { message = finalizeMaterialsAcceptanceMessage(prepared, minted.jwt); }
  catch {
    await materials.stopRelease(suggestionId, leaseToken, 'failed', 'link_render_failed').catch(() => null);
    return stop('link_render_failed');
  }
  let sentAt;
  try {
    const result = await materials.send(message);
    if (result?.sent !== true) throw new Error('Materials email transport receipt unconfirmed');
    sentAt = new Date().toISOString();
  } catch (err) {
    const outcome = classifyEmailDispatchError(err).outcome === 'uncertain' ? 'uncertain' : 'failed';
    const code = outcome === 'uncertain' ? 'send_unconfirmed' : 'send_failed';
    await materials.stopRelease(suggestionId, leaseToken, outcome, code).catch(() => null);
    return stop(code);
  }
  // The email has left. A missing receipt means staff took the row over mid-send.
  if (!(await materials.markSent(suggestionId, leaseToken).catch(() => null))) return stop('sent_after_release_taken_over');
  await step({ sentAt });
  return record(sentAt);
}

async function verifyAcceptedOrCancel({ job, payload, currentSuggestion, jobs }) {
  if (currentSuggestion?.wmkf_accepted === true && currentSuggestion?.wmkf_declined !== true) {
    const timestamp = acceptedTimestampStatus(job, payload, currentSuggestion);
    if (!timestamp.ok) {
      if (job.status === 'accept_pending' && jobAgeMs(job) < ACCEPT_COMMIT_GRACE_MS) {
        throw makeRetryable(timestamp.reason, { delaySeconds: 60 });
      }
      requireLeaseMutation(
        await jobs.cancelReviewerAcceptanceJob(
          job.id,
          `${timestamp.reason}: job=${timestamp.jobAcceptedAt || 'missing'} dataverse=${timestamp.responseReceivedAt || 'missing'}`,
          { leaseToken: job.lease_token },
        ),
        job,
        'timestamp-mismatch cancellation',
      );
      return { ok: false, cancelled: true, reason: timestamp.reason };
    }
    return { ok: true };
  }
  if (currentSuggestion?.wmkf_declined === true) {
    requireLeaseMutation(
      await jobs.cancelReviewerAcceptanceJob(
        job.id,
        'reviewer_withdrew_before_materials',
        { leaseToken: job.lease_token },
      ),
      job,
      'reviewer-withdrawal cancellation',
    );
    return { ok: false, cancelled: true, reason: 'reviewer_withdrew_before_materials' };
  }
  const ageMs = jobAgeMs(job);
  if (job.status === 'accept_pending' && ageMs < ACCEPT_COMMIT_GRACE_MS) {
    throw makeRetryable('accept_commit_not_visible_yet', { delaySeconds: 60 });
  }
  if (job.status === 'accept_pending') {
    requireLeaseMutation(
      await jobs.cancelReviewerAcceptanceJob(job.id, 'accept_not_committed', { leaseToken: job.lease_token }),
      job,
      'uncommitted-accept cancellation',
    );
    return { ok: false, cancelled: true, reason: 'accept_not_committed' };
  }
  throw makeRetryable('queued_acceptance_job_not_accepted_in_dataverse', { delaySeconds: 120 });
}

export async function processReviewerAcceptanceJob(job, deps = {}) {
  const suggestions = deps.suggestions || suggestionAdapter;
  const jobs = deps.jobs || jobStore;
  const potentialReviewers = deps.potentialReviewers || potentialReviewerAdapter;
  const ensureHonorarium = deps.ensureHonorarium || ensureHonorariumOnboarding;
  const ensureAcceptedContact = deps.ensureAcceptedContact || ensureAcceptedReviewerContact;
  const captureOrcid = deps.captureOrcid || captureSelfReportedReviewerOrcid;
  const captureIdentity = deps.captureIdentity || captureSelfReportedReviewerIdentity;
  const syncNameTitle = deps.syncNameTitle || syncReviewerNameTitleToContact;
  const alertEmail = deps.alertEmail || alertReviewerEmailMismatch;
  const alertAffiliation = deps.alertAffiliation || alertReviewerAffiliationMismatch;
  const resolveAffiliation = deps.resolveAffiliation || resolveReviewerAffiliationMismatch;
  const autoLinkAccount = deps.autoLinkAccount || autoLinkReviewerContactAccount;
  if (Object.hasOwn(deps, 'sendAcceptanceEmail')) throw new Error('Use prepareAcceptanceEmail and sendPreparedAcceptanceEmail seams');
  const prepareAcceptanceEmail = deps.prepareAcceptanceEmail || prepareAcceptanceConfirmationEmail;
  const sendPreparedAcceptanceEmail = deps.sendPreparedAcceptanceEmail || sendPreparedAcceptanceConfirmationEmail;
  const readConfirmationRequest = deps.readConfirmationRequest || requestAdapter.getById;
  const readConfirmationSuggestion = deps.readConfirmationSuggestion || (id => readCurrentSuggestion(suggestions, id));
  const notify = deps.notify || ((opts) => NotificationService.notify(opts));
  const quota = deps.quota || maybeNotifyQuotaReached;
  const deleteLateHonorarium = deps.deleteLateHonorarium
    || deleteLateHonorariumForWithdrawnReviewer;
  const cancelLateReleasedHonorarium = deps.cancelLateReleasedHonorarium
    || cancelLateHonorariumForReleasedReviewer;
  const resolveTestState = deps.resolveTestState || resolveRequestTestState;
  const isolationEnabled = deps.isolationEnabled || testRequestIsolationEnabled;
  const switchesReady = deps.switchesReady || reviewerAcceptanceSwitchesReady;
  const materials = {
    get: materialsReleaseStore.getMaterialsRelease,
    claim: materialsReleaseStore.claimMaterialsRelease,
    markLinkMinted: materialsReleaseStore.markMaterialsLinkMinted,
    markSent: materialsReleaseStore.markMaterialsSent,
    record: materialsReleaseStore.recordMaterialsRelease,
    stopRelease: materialsReleaseStore.markMaterialsReleaseStopped,
    recordDelivered: recordDeliveredEmail,
    preflight: materialsPreflight,
    cycleCodes: cycleCodesByGrantCycleId,
    cycleConfigs: loadCycleConfigs,
    attachments: loadCycleMaterialsAttachments,
    prepare: prepareMaterialsAcceptanceEmail,
    assertBound: assertReviewerDirectedEmailBound,
    mint: mintAndStore,
    send: sendPreparedAcceptanceEmail,
    ...(deps.materials || {}),
  };

  // The first follow-up read is safe, but a claimed job must stop before any
  // late cleanup, Contact, honorarium or BILL write during switch rollout.
  if (!switchesReady()) return { jobId: job.id, status: 'paused' };

  const payload = parsePayload(job.payload);
  const suggestionId = job.suggestion_id || payload?.suggestion?.wmkf_appreviewersuggestionid;
  if (!suggestionId) {
    const err = new Error('reviewer acceptance job missing suggestion id');
    err.retryable = false;
    throw err;
  }

  const currentSuggestion = await readCurrentSuggestion(suggestions, suggestionId);
  if (!switchesReady()) return { jobId: job.id, status: 'paused' };
  if (currentSuggestion?.wmkf_declined === true) {
    await deleteLateHonorarium(suggestionId, { suggestions });
  }
  if (currentSuggestion?.wmkf_reviewstatus === suggestionAdapter.REVIEW_STATUS_MAP.released) {
    await cancelLateReleasedHonorarium(suggestionId, { suggestions });
    const cancelled = await jobs.cancelReviewerAcceptanceJob(
      job.id,
      'reviewer_released_before_acceptance_followup',
      { leaseToken: job.lease_token },
    );
    return {
      jobId: job.id,
      status: 'cancelled',
      reason: cancelled ? 'reviewer_released_before_acceptance_followup' : 'acceptance_job_already_cancelled',
    };
  }
  const acceptedCheck = await verifyAcceptedOrCancel({ job, payload, currentSuggestion, jobs });
  if (!acceptedCheck.ok) return { jobId: job.id, status: 'cancelled', reason: acceptedCheck.reason };

  const suggestion = { ...(payload.suggestion || {}), ...(currentSuggestion || {}) };
  const request = payload.request || {};

  // Test requests (Test Request Factory Stage 1b): the accept is already
  // recorded; skip every follow-up (Contact promotion, identity capture,
  // honorarium record and BILL onboarding, confirmation email). An unreadable
  // marker retries rather than cancels, so a transient failure cannot drop a
  // real reviewer's follow-up.
  const isolationRequestId = isolationEnabled() ? currentSuggestion?._wmkf_request_value || null : undefined;
  if (isolationRequestId !== undefined) {
    const requestId = isolationRequestId;
    const testState = await resolveTestState(requestId);
    if (testState.kind === 'unknown') {
      throw makeRetryable(`reviewer acceptance follow-up could not confirm request ${requestId} is ordinary (${testState.reason})`);
    }
    if (testState.kind !== 'ordinary') {
      requireLeaseMutation(
        await jobs.cancelReviewerAcceptanceJob(
          job.id,
          'test_request_followup_skipped',
          { leaseToken: job.lease_token },
        ),
        job,
        'test-request cancellation',
      );
      return {
        jobId: job.id,
        status: 'cancelled',
        reason: 'test_request_followup_skipped',
      };
    }
  }
  const body = payload.body || {};
  const acceptedSuggestion = { ...(payload.acceptedSuggestion || {}), ...suggestion };
  const acceptedAffiliation = body?.contactEdits?.affiliation
    || acceptedSuggestion?.wmkf_revieweraffiliation
    || null;
  const isAcceptRepeat = payload.isAcceptRepeat === true;
  const optedOut = payload.optedOut === true || suggestion.wmkf_honorariumoptout === true;
  const acceptOrcidRaw = selfReportedOrcidOf(payload, suggestion);
  const bindingEventAt = canonicalJobTimestamp(job?.accepted_at || payload?.acceptedAt || null);
  let reviewer = await readCurrentReviewer(payload.reviewer, suggestion, potentialReviewers);
  reviewer = withAcceptedOrcid(reviewer, acceptOrcidRaw);
  const retryReasons = [];

  // The durable self-report must commit before honorarium contact resolution,
  // ORCID back-propagation, or other identity-dependent follow-up. A failure
  // bubbles to the job drain; deterministic typed failures are terminal while
  // transient/untyped and concurrency failures retry. No downstream work starts.
  const captureResult = await captureReviewerSelfReportedOrcid({
    reviewer,
    // Person binding commits first. The Contact is deliberately excluded until
    // ensureAcceptedReviewerContact validates any pre-existing link.
    contactId: null,
    rawOrcid: acceptOrcidRaw,
    bindingEventAt,
    captureOrcid,
  });
  reviewer = withPersistedSelfReport(reviewer, captureResult);

  let honContactId = null;
  if (optedOut) {
    try {
      const contactResult = await ensureAcceptedContact({
        reviewer,
        suggestion: acceptedSuggestion,
        body,
      });
      honContactId = contactResult?.contactId || null;
      if (contactResult?.addressCaptureError) {
        retryReasons.push(new Error(`address_capture_failed: ${contactResult.addressCaptureError}`));
      }
    } catch (contactErr) {
      await notifyAcceptedContactFailure({
        error: contactErr,
        suggestion,
        request,
        reviewer,
        optedOut: true,
        notify,
        job,
      });
      retryReasons.push(contactErr);
    }
  } else {
    try {
      const honResult = await ensureHonorarium({ suggestion, request, reviewer, body });
      honContactId = honResult?.contactId || null;
      await notifyHonorariumDeferred({ honResult, suggestion, request, isAcceptRepeat, notify });
      if (honResult?.addressCaptureError) {
        retryReasons.push(new Error(`address_capture_failed: ${honResult.addressCaptureError}`));
      }
    } catch (honErr) {
      if (String(honErr?.code || '').startsWith('accepted_reviewer_contact_')) {
        await notifyAcceptedContactFailure({
          error: honErr,
          suggestion,
          request,
          reviewer,
          optedOut: false,
          notify,
          job,
        });
      } else {
        await notifyHonorariumFailure({ error: honErr, suggestion, request, notify, job });
      }
      retryReasons.push(honErr);
    }
  }

  // Withdrawal and honorarium creation live in different durable stores and
  // can race. Re-read after the create/link step: if the reviewer withdrew
  // while this job was running, remove the exact linked honorarium before any
  // acceptance email or quota notification can run.
  const afterHonorarium = await readCurrentSuggestion(suggestions, suggestionId);
  const cancelledAfterHonorarium = await cancelAfterHonorariumIfNeeded({
    currentSuggestion: afterHonorarium, suggestionId, reviewer, job, suggestions, jobs,
    deleteLateHonorarium, cancelLateReleasedHonorarium,
  });
  if (cancelledAfterHonorarium) return cancelledAfterHonorarium;

  await captureBoardIdentity({ reviewer, suggestion, request, body, captureIdentity, notify });

  try {
    await syncNameTitle({
      reviewer,
      suggestion: acceptedSuggestion,
      contactId: honContactId,
      trusted: true,
    });
  } catch (nameTitleErr) {
    console.warn('[reviewer acceptance drain] reviewer name/title contact sync failed (non-fatal):', nameTitleErr?.message || nameTitleErr);
  }

  try {
    await alertEmail({
      reviewer,
      contactId: honContactId,
      reviewerEmail: body?.contactEdits?.email || acceptedSuggestion?.wmkf_revieweremail || null,
      suggestionId: suggestion.wmkf_appreviewersuggestionid || null,
    });
  } catch (mismatchErr) {
    console.warn('[reviewer acceptance drain] reviewer email-mismatch alert failed (non-fatal):', mismatchErr?.message || mismatchErr);
  }

  let affiliationAutoLinked = false;
  let affiliationAutoLinkFailed = false;
  let affiliationAutoLinkResult = null;
  try {
    affiliationAutoLinkResult = await autoLinkAccount({
      reviewer,
      contactId: honContactId,
      reviewerAffiliation: acceptedAffiliation,
      trustedAcceptance: true,
    });
    affiliationAutoLinked = affiliationAutoLinkResult?.linked === true
      || affiliationAutoLinkResult?.alreadyLinked === true;
  } catch (autoLinkErr) {
    affiliationAutoLinkFailed = true;
    retryReasons.push(autoLinkErr);
    console.warn('[reviewer acceptance drain] reviewer Contact account auto-link failed; job will retry:', autoLinkErr?.message || autoLinkErr);
  }

  if (affiliationAutoLinkResult?.skipped === 'account_scan_capped') {
    await notifyReviewerAccountScanCapped({
      autoLinkResult: affiliationAutoLinkResult,
      notify,
    });
  }

  if (affiliationAutoLinked) {
    try {
      await resolveAffiliation({ reviewer, contactId: honContactId });
    } catch (resolveError) {
      console.warn('[reviewer acceptance drain] affiliation-mismatch auto-resolve failed (non-fatal):', resolveError?.message || resolveError);
    }
  }

  // A successful exact link is already a stronger comparison than the alert
  // helper and clears any standing warning. Expected abstentions — including
  // an incomplete capped scan — continue to the helper. If the auto-link
  // operation itself threw, defer the warning until the durable retry has
  // given automation a fair chance; otherwise the warning would be transient
  // noise rather than a genuine data-state abstention.
  if (!affiliationAutoLinked && !affiliationAutoLinkFailed) {
    try {
      await alertAffiliation({
        reviewer,
        contactId: honContactId,
        reviewerAffiliation: acceptedAffiliation,
        suggestionId: suggestion.wmkf_appreviewersuggestionid || null,
      });
    } catch (mismatchErr) {
      console.warn('[reviewer acceptance drain] reviewer affiliation-mismatch alert failed (non-fatal):', mismatchErr?.message || mismatchErr);
    }
  }

  if (!isAcceptRepeat) {
    const confirmation = await releaseMaterialsOnAcceptance({
      job,
      payload,
      suggestion,
      request,
      reviewer,
      prepareAcceptanceEmail, sendPreparedAcceptanceEmail, readConfirmationRequest, readConfirmationSuggestion,
      isolationRequestId, suggestions, deleteLateHonorarium, cancelLateReleasedHonorarium,
      notify, jobs, materials, potentialReviewers,
    });
    if (confirmation.cancelled) return confirmation.cancelled;
    if (confirmation.retryError) retryReasons.push(confirmation.retryError);
    try {
      await quota({ requestId: request?.akoya_requestid, actingUserSystemId: null });
    } catch (quotaErr) {
      console.warn('[reviewer acceptance drain] quota notify failed (non-fatal):', quotaErr?.message || quotaErr);
    }
  }

  if (retryReasons.length) {
    const terminal = retryReasons.find((err) => err?.retryable === false);
    if (terminal) throw terminal;
    const message = retryReasons
      .map((err) => err?.message || String(err))
      .filter(Boolean)
      .join('; ');
    throw makeRetryable(`reviewer_acceptance_followup_retry_required: ${message}`, { delaySeconds: 300 });
  }

  requireLeaseMutation(
    await jobs.completeReviewerAcceptanceJob(job.id, job.lease_token),
    job,
    'completion',
  );
  // Every follow-up step succeeded — mark any open failure events from earlier
  // attempts recovered so operators can tell a transient/recovered failure
  // from an unresolved one. Best-effort, after the durable completion commit.
  await settleOperationalFollowupEvents({
    suggestionId,
    reviewerId: reviewer?.wmkf_potentialreviewersid || null,
    outcome: 'recovered',
    note: `acceptance follow-up job ${job.id} completed`,
  });
  return { jobId: job.id, status: 'completed' };
}

export async function drainReviewerAcceptanceJobs({
  limit = DEFAULT_BATCH_LIMIT,
  lockSeconds = DEFAULT_LOCK_SECONDS,
  deps = {},
} = {}) {
  const jobs = deps.jobs || jobStore;
  const switchesReady = deps.switchesReady || reviewerAcceptanceSwitchesReady;
  const readyAtStart = switchesReady();
  const claimed = readyAtStart
    ? await jobs.claimReviewerAcceptanceJobs({ limit, lockSeconds })
    : [];
  const result = {
    claimed: claimed.length,
    jobIds: claimed.map((job) => job.id),
    completed: 0,
    completedJobIds: [],
    cancelled: 0,
    cancelledJobIds: [],
    failed: 0,
    failedJobIds: [],
    retried: 0,
    retriedJobIds: [],
    leaseLost: 0,
    leaseLostJobIds: [],
    paused: 0,
    pausedJobIds: [],
    configurationPaused: !readyAtStart,
    errors: [],
  };

  for (const job of claimed) {
    try {
      if (!switchesReady()) {
        requireLeaseMutation(
          await jobs.releaseReviewerAcceptanceJobLease(job.id, job.lease_token),
          job,
          'configuration pause release',
        );
        result.paused += 1;
        result.pausedJobIds.push(job.id);
        continue;
      }
      const processed = await processReviewerAcceptanceJob(job, deps);
      if (processed.status === 'paused') {
        requireLeaseMutation(
          await jobs.releaseReviewerAcceptanceJobLease(job.id, job.lease_token),
          job,
          'configuration pause release',
        );
        result.paused += 1;
        result.pausedJobIds.push(job.id);
      } else if (processed.status === 'cancelled') {
        await settlePreparation(job.id, true, true);
        result.cancelled += 1;
        result.cancelledJobIds.push(job.id);
      } else if (processed.status === 'completed') {
        result.completed += 1;
        result.completedJobIds.push(job.id);
      } else {
        const err = new Error(`unexpected reviewer acceptance outcome: ${processed?.status || 'missing'}`);
        err.retryable = false;
        throw err;
      }
    } catch (err) {
      if (err?.code === LEASE_LOST_CODE) {
        result.leaseLost += 1;
        result.leaseLostJobIds.push(job.id);
        result.errors.push({
          jobId: job.id,
          retryable: true,
          code: LEASE_LOST_CODE,
          message: err.message,
        });
        continue;
      }
      const retryable = err?.retryable !== false;
      const updated = await jobs.recordReviewerAcceptanceJobFailure(job, err, {
        retryable,
        maxAttempts: deps.maxAttempts || 8,
        delaySeconds: err?.delaySeconds || 60,
      });
      if (!updated) {
        result.leaseLost += 1;
        result.leaseLostJobIds.push(job.id);
      } else if (updated.status === 'failed' || !retryable) {
        const emailStep = updated.steps?.acceptance_confirmation || {};
        const materialsStep = updated.steps?.release_materials || {};
        if (updated.status === 'failed' && parsePayload(updated.payload).isAcceptRepeat !== true && !emailStep.claimedAt && !emailStep.sentAt
            && !materialsStep.claimedAt && !materialsStep.completedAt) {
          await notifyPreparationProblem(updated, 'job_failed_before_confirmation_claim', deps.notify || (opts => NotificationService.notify(opts)), true);
        }
        result.failed += 1;
        result.failedJobIds.push(job.id);
      } else {
        result.retried += 1;
        result.retriedJobIds.push(job.id);
      }
      result.errors.push({
        jobId: job.id,
        retryable: updated ? retryable : true,
        code: !updated ? LEASE_LOST_CODE : (err?.code || null),
        message: err?.message || String(err),
      });
    }
  }

  return result;
}
