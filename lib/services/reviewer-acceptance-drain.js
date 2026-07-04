import { ensureHonorariumOnboarding } from '../bill/honorarium-onboard-orchestrator.js';
import { captureSelfReportedReviewerOrcid } from './capture-self-reported-orcid.js';
import { captureSelfReportedReviewerIdentity } from './capture-self-reported-reviewer-identity.js';
import { syncReviewerNameTitleToContact } from './sync-reviewer-name-title-to-contact.js';
import { alertReviewerEmailMismatch } from './alert-reviewer-email-mismatch.js';
import { alertReviewerAffiliationMismatch } from './alert-reviewer-affiliation-mismatch.js';
import { maybeNotifyQuotaReached } from './reviewer-quota.js';
import { DynamicsService } from './dynamics-service.js';
import NotificationService from './notification-service.js';
import { normalizeOrcid } from '../utils/orcid-normalize.js';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer.js';
import { sendAcceptanceConfirmationEmail } from './reviewer-acceptance-email.js';
import * as jobStore from './reviewer-acceptance-job-service.js';

const DEFAULT_BATCH_LIMIT = 5;
const DEFAULT_LOCK_SECONDS = 300;
const ACCEPT_COMMIT_GRACE_MS = 10 * 60 * 1000;

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_responsereceivedat',
  'wmkf_honorariumoptout',
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_reviewertitle',
  'wmkf_revieweraffiliation',
  'wmkf_revieweremail',
  'wmkf_reviewerorcid',
  '_wmkf_honorariumrequest_value',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
].join(',');

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
    wmkf_identitystatus: 'confirmed',
  };
}

async function readCurrentSuggestion(dynamics, suggestionId) {
  return dynamics.getRecord('wmkf_appreviewersuggestions', suggestionId, {
    select: SUGGESTION_SELECT,
  });
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

function timestampMs(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
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

async function notifyHonorariumFailure({ error, suggestion, request, notify }) {
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
    });
  } catch (notifyErr) {
    console.error('[reviewer acceptance drain] honorarium alert failed:', notifyErr?.message || notifyErr);
  }
}

async function captureReviewerSelfReportedOrcid({ reviewer, contactId, rawOrcid, captureOrcid }) {
  if (!rawOrcid) return;
  try {
    await captureOrcid({
      potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
      rawOrcid,
      contactId: contactId || reviewer?._wmkf_contact_value || null,
    });
  } catch (orcidErr) {
    console.warn('[reviewer acceptance drain] self-reported ORCID capture failed (non-fatal):', orcidErr?.message || orcidErr);
  }
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

async function sendAcceptanceConfirmationOnce({ job, suggestion, request, reviewer, sendAcceptanceEmail, notify, jobs }) {
  const existing = job.steps?.acceptance_confirmation || {};
  if (existing.sentAt || existing.claimedAt) {
    return { skipped: true, reason: 'already_claimed' };
  }
  await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
    claimedAt: new Date().toISOString(),
  });
  try {
    const result = await sendAcceptanceEmail({ suggestion, request, reviewer });
    await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
      sentAt: new Date().toISOString(),
      result: result || null,
    });
    return { sent: true };
  } catch (emailErr) {
    console.error('[reviewer acceptance drain] acceptance confirmation failed (non-fatal):', emailErr?.message || emailErr);
    await jobs.mergeReviewerAcceptanceJobStep(job.id, job.lease_token, 'acceptance_confirmation', {
      failedAt: new Date().toISOString(),
      error: emailErr?.message || String(emailErr),
    });
    try {
      await notify({
        type: 'reviewer_acceptance_confirmation_failed',
        severity: 'warning',
        emailAdmins: true,
        title: 'Reviewer acceptance confirmation email failed',
        message: emailErr?.message || String(emailErr),
        metadata: {
          suggestionId: suggestion.wmkf_appreviewersuggestionid,
          requestNumber: request?.akoya_requestnum || null,
          reviewerEmail: reviewer?.wmkf_emailaddress || suggestion?.wmkf_revieweremail || null,
        },
        source: 'reviewer-acceptance-drain',
        category: 'ops',
      });
    } catch (notifyErr) {
      console.error('[reviewer acceptance drain] acceptance confirmation alert failed:', notifyErr?.message || notifyErr);
    }
    return { sent: false, reason: 'send_failed' };
  }
}

async function verifyAcceptedOrCancel({ job, payload, currentSuggestion, jobs }) {
  if (currentSuggestion?.wmkf_accepted === true && currentSuggestion?.wmkf_declined !== true) {
    const timestamp = acceptedTimestampStatus(job, payload, currentSuggestion);
    if (!timestamp.ok) {
      if (job.status === 'accept_pending' && jobAgeMs(job) < ACCEPT_COMMIT_GRACE_MS) {
        throw makeRetryable(timestamp.reason, { delaySeconds: 60 });
      }
      await jobs.cancelReviewerAcceptanceJob(
        job.id,
        `${timestamp.reason}: job=${timestamp.jobAcceptedAt || 'missing'} dataverse=${timestamp.responseReceivedAt || 'missing'}`,
        { leaseToken: job.lease_token },
      );
      return { ok: false, cancelled: true, reason: timestamp.reason };
    }
    return { ok: true };
  }
  const ageMs = jobAgeMs(job);
  if (job.status === 'accept_pending' && ageMs < ACCEPT_COMMIT_GRACE_MS) {
    throw makeRetryable('accept_commit_not_visible_yet', { delaySeconds: 60 });
  }
  if (job.status === 'accept_pending') {
    await jobs.cancelReviewerAcceptanceJob(job.id, 'accept_not_committed', { leaseToken: job.lease_token });
    return { ok: false, cancelled: true, reason: 'accept_not_committed' };
  }
  throw makeRetryable('queued_acceptance_job_not_accepted_in_dataverse', { delaySeconds: 120 });
}

export async function processReviewerAcceptanceJob(job, deps = {}) {
  const dynamics = deps.dynamics || DynamicsService;
  const jobs = deps.jobs || jobStore;
  const potentialReviewers = deps.potentialReviewers || potentialReviewerAdapter;
  const ensureHonorarium = deps.ensureHonorarium || ensureHonorariumOnboarding;
  const captureOrcid = deps.captureOrcid || captureSelfReportedReviewerOrcid;
  const captureIdentity = deps.captureIdentity || captureSelfReportedReviewerIdentity;
  const syncNameTitle = deps.syncNameTitle || syncReviewerNameTitleToContact;
  const alertEmail = deps.alertEmail || alertReviewerEmailMismatch;
  const alertAffiliation = deps.alertAffiliation || alertReviewerAffiliationMismatch;
  const sendAcceptanceEmail = deps.sendAcceptanceEmail || sendAcceptanceConfirmationEmail;
  const notify = deps.notify || ((opts) => NotificationService.notify(opts));
  const quota = deps.quota || maybeNotifyQuotaReached;

  const payload = parsePayload(job.payload);
  const suggestionId = job.suggestion_id || payload?.suggestion?.wmkf_appreviewersuggestionid;
  if (!suggestionId) {
    const err = new Error('reviewer acceptance job missing suggestion id');
    err.retryable = false;
    throw err;
  }

  const currentSuggestion = await readCurrentSuggestion(dynamics, suggestionId);
  const acceptedCheck = await verifyAcceptedOrCancel({ job, payload, currentSuggestion, jobs });
  if (!acceptedCheck.ok) return { jobId: job.id, status: 'cancelled', reason: acceptedCheck.reason };

  const suggestion = { ...(payload.suggestion || {}), ...(currentSuggestion || {}) };
  const request = payload.request || {};
  const body = payload.body || {};
  const acceptedSuggestion = { ...(payload.acceptedSuggestion || {}), ...suggestion };
  const isAcceptRepeat = payload.isAcceptRepeat === true;
  const optedOut = payload.optedOut === true || suggestion.wmkf_honorariumoptout === true;
  const acceptOrcidRaw = selfReportedOrcidOf(payload, suggestion);
  let reviewer = await readCurrentReviewer(payload.reviewer, suggestion, potentialReviewers);
  reviewer = withAcceptedOrcid(reviewer, acceptOrcidRaw);
  const retryReasons = [];

  let honContactId = null;
  if (!optedOut) {
    try {
      const honResult = await ensureHonorarium({ suggestion, request, reviewer, body });
      honContactId = honResult?.contactId || null;
      await notifyHonorariumDeferred({ honResult, suggestion, request, isAcceptRepeat, notify });
      if (honResult?.status === 'deferred' && honResult.addressCaptureError) {
        retryReasons.push(new Error(`address_capture_failed: ${honResult.addressCaptureError}`));
      }
    } catch (honErr) {
      await notifyHonorariumFailure({ error: honErr, suggestion, request, notify });
      retryReasons.push(honErr);
    }
  }

  await captureReviewerSelfReportedOrcid({ reviewer, contactId: honContactId, rawOrcid: acceptOrcidRaw, captureOrcid });
  await captureBoardIdentity({ reviewer, suggestion, request, body, captureIdentity, notify });

  try {
    await syncNameTitle({
      reviewer,
      suggestion: acceptedSuggestion,
      contactId: honContactId || reviewer?._wmkf_contact_value || null,
      trusted: true,
    });
  } catch (nameTitleErr) {
    console.warn('[reviewer acceptance drain] reviewer name/title contact sync failed (non-fatal):', nameTitleErr?.message || nameTitleErr);
  }

  try {
    await alertEmail({
      reviewer,
      contactId: honContactId || reviewer?._wmkf_contact_value || null,
      reviewerEmail: body?.contactEdits?.email || acceptedSuggestion?.wmkf_revieweremail || null,
      suggestionId: suggestion.wmkf_appreviewersuggestionid || null,
    });
  } catch (mismatchErr) {
    console.warn('[reviewer acceptance drain] reviewer email-mismatch alert failed (non-fatal):', mismatchErr?.message || mismatchErr);
  }

  try {
    await alertAffiliation({
      reviewer,
      contactId: honContactId || reviewer?._wmkf_contact_value || null,
      reviewerAffiliation: body?.contactEdits?.affiliation || acceptedSuggestion?.wmkf_revieweraffiliation || null,
      suggestionId: suggestion.wmkf_appreviewersuggestionid || null,
    });
  } catch (mismatchErr) {
    console.warn('[reviewer acceptance drain] reviewer affiliation-mismatch alert failed (non-fatal):', mismatchErr?.message || mismatchErr);
  }

  if (!isAcceptRepeat) {
    await sendAcceptanceConfirmationOnce({ job, suggestion, request, reviewer, sendAcceptanceEmail, notify, jobs });
    try {
      await quota({ requestId: request?.akoya_requestid, actingUserSystemId: null });
    } catch (quotaErr) {
      console.warn('[reviewer acceptance drain] quota notify failed (non-fatal):', quotaErr?.message || quotaErr);
    }
  }

  if (retryReasons.length) {
    const message = retryReasons
      .map((err) => err?.message || String(err))
      .filter(Boolean)
      .join('; ');
    throw makeRetryable(`honorarium_onboarding_retry_required: ${message}`, { delaySeconds: 300 });
  }

  await jobs.completeReviewerAcceptanceJob(job.id, job.lease_token);
  return { jobId: job.id, status: 'completed' };
}

export async function drainReviewerAcceptanceJobs({
  limit = DEFAULT_BATCH_LIMIT,
  lockSeconds = DEFAULT_LOCK_SECONDS,
  deps = {},
} = {}) {
  const jobs = deps.jobs || jobStore;
  const claimed = await jobs.claimReviewerAcceptanceJobs({ limit, lockSeconds });
  const result = {
    claimed: claimed.length,
    completed: 0,
    cancelled: 0,
    failed: 0,
    retried: 0,
    errors: [],
  };

  for (const job of claimed) {
    try {
      const processed = await processReviewerAcceptanceJob(job, deps);
      if (processed.status === 'cancelled') result.cancelled += 1;
      else result.completed += 1;
    } catch (err) {
      const retryable = err?.retryable !== false;
      const updated = await jobs.recordReviewerAcceptanceJobFailure(job, err, {
        retryable,
        maxAttempts: deps.maxAttempts || 8,
        delaySeconds: err?.delaySeconds || 60,
      });
      if (updated?.status === 'failed' || !retryable) result.failed += 1;
      else result.retried += 1;
      result.errors.push({
        jobId: job.id,
        retryable,
        message: err?.message || String(err),
      });
    }
  }

  return result;
}
