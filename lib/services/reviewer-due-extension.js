/**
 * Accepted-reviewer due-date extension workflow.
 *
 * Notification prerequisites are resolved before the write. The date write is
 * then deliberately committed before the Dynamics dispatch, so only an actual
 * delivery failure can return partial success with the new deadline in force.
 * Confirmed engagement identity wins; legacy blank snapshots fall back to the
 * linked reviewer person record before the notification is declared unavailable.
 * Retry always re-reads the stored suggestion/request state; it never trusts a
 * deadline copied back from stale client state.
 */

import { ContactParser } from '../utils/contact-parser.js';
import { buildReviewerGreeting } from '../utils/email-generator.js';
import { composeReviewerEmailSignature } from '../utils/reviewer-email-closing.js';
import { isCurrentOrFutureYmd, isYmd } from '../utils/date-ymd.js';
import { renderPlainTextEmailHtml } from '../external/plain-text-email-html.js';
import { buildReviewDueIcs } from '../external/calendar-invite.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { DynamicsService } from './dynamics-service.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { resolveSignatureForRequest } from './email-signature.js';
import {
  getByIdWithSelect as getSuggestionByIdWithSelect,
  isExcluded,
  updateLifecycle,
} from '../dataverse/adapters/reviewer-suggestion.js';
import { getById as getRequestById } from '../dataverse/adapters/grant-request.js';
import { getById as getPotentialReviewerById } from '../dataverse/adapters/potential-reviewer.js';
import { getById as getSystemUserById } from '../dataverse/adapters/system-user.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';
import { isDataverseRecordNotFound } from '../dataverse/core/errors.js';

export const REVIEWER_EXTENSION_BODY_KEY = 'email.reviewer_extension.body';
export const REVIEWER_EXTENSION_SUBJECT_PREFIX = 'Updated review deadline';

const TERMINAL_STATUS_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));
const ACTIVE_EXTENSION_STATUS_VALUES = new Set([null, 100000000, 100000001, 100000002]);
const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_applicantdisposition',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_completedat',
  'wmkf_reviewduedateoverride',
  'wmkf_reviewerfirstname',
  'wmkf_reviewerlastname',
  'wmkf_reviewernickname',
  'wmkf_revieweremail',
].join(',');

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_title',
  'wmkf_reviewduedate',
  '_wmkf_programdirector_value',
].join(',');

function formatDateLong(value) {
  if (!isYmd(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function applyTemplate(template, replacements) {
  let output = String(template || '');
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(String(value ?? ''));
  }
  return output;
}

function confirmedReviewerName(suggestion) {
  const first = String(
    suggestion?.wmkf_reviewernickname
      || suggestion?.wmkf_reviewerfirstname
      || '',
  ).trim();
  const last = String(suggestion?.wmkf_reviewerlastname || '').trim();
  return ContactParser.normalizeDisplayName(
    [first, last].filter(Boolean).join(' '),
  );
}

async function resolveReviewerNotificationIdentity(suggestion) {
  const snapshotName = confirmedReviewerName(suggestion);
  const snapshotEmail = String(suggestion?.wmkf_revieweremail || '').trim();
  if (snapshotName && snapshotEmail) {
    return { reviewerName: snapshotName, recipientEmail: snapshotEmail };
  }

  const reviewerId = suggestion?._wmkf_potentialreviewer_value;
  const reviewer = reviewerId
    ? await getPotentialReviewerById(reviewerId).catch(() => null)
    : null;
  const fallbackName = ContactParser.normalizeDisplayName(
    reviewer?.wmkf_name
      || [reviewer?.wmkf_firstname, reviewer?.wmkf_lastname].filter(Boolean).join(' '),
  );
  const fallbackEmail = String(reviewer?.wmkf_emailaddress || '').trim();
  return {
    reviewerName: snapshotName || fallbackName,
    recipientEmail: snapshotEmail || fallbackEmail,
  };
}

function isEligibleSuggestion(suggestion) {
  return suggestion?.wmkf_accepted === true
    && suggestion?.wmkf_declined !== true
    && !suggestion?.wmkf_reviewreceivedat
    && !suggestion?.wmkf_completedat
    && ACTIVE_EXTENSION_STATUS_VALUES.has(suggestion?.wmkf_reviewstatus ?? null)
    && !TERMINAL_STATUS_VALUES.has(suggestion?.wmkf_reviewstatus)
    && !isExcluded(suggestion);
}

async function loadContext(suggestionId) {
  let suggestion;
  try {
    suggestion = await getSuggestionByIdWithSelect(suggestionId, SUGGESTION_SELECT);
  } catch (error) {
    return isDataverseRecordNotFound(error)
      ? { ok: false, reason: 'not_found' }
      : { ok: false, reason: 'read_failed' };
  }
  if (!suggestion?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
  if (!isEligibleSuggestion(suggestion)) return { ok: false, reason: 'ineligible' };

  const requestId = suggestion._wmkf_request_value;
  if (!requestId) return { ok: false, reason: 'ineligible' };
  let request;
  try {
    request = await getRequestById(requestId, { select: REQUEST_SELECT });
  } catch (error) {
    return isDataverseRecordNotFound(error)
      ? { ok: false, reason: 'original_due_date_missing' }
      : { ok: false, reason: 'read_failed' };
  }
  if (!request?.akoya_requestid || !isYmd(request.wmkf_reviewduedate)) {
    return { ok: false, reason: 'original_due_date_missing' };
  }

  return { ok: true, suggestion, request };
}

async function resolveProgramDirector(request) {
  const pdId = request?._wmkf_programdirector_value;
  if (!pdId) return null;
  const pd = await getSystemUserById(pdId).catch(() => null);
  if (pd?.isdisabled !== false || !pd?.systemuserid || !pd?.internalemailaddress) return null;
  return pd;
}

export function renderReviewerDueDateUpdate({ bodyTemplate, reviewerName, proposalTitle, dueDate, signatureBlock }) {
  const signature = composeReviewerEmailSignature(signatureBlock);
  const greeting = buildReviewerGreeting(reviewerName);
  const formattedDueDate = formatDateLong(dueDate);
  if (!reviewerName || !formattedDueDate) return null;
  const subject = proposalTitle
    ? `${REVIEWER_EXTENSION_SUBJECT_PREFIX}: ${proposalTitle}`
    : REVIEWER_EXTENSION_SUBJECT_PREFIX;
  const bodyText = applyTemplate(bodyTemplate, {
    '{{greeting}}': greeting,
    '{{reviewerName}}': reviewerName,
    '{{proposalTitle}}': proposalTitle || 'the proposal',
    '{{reviewDueDate}}': formattedDueDate,
    '{{signature}}': signature,
  });
  return { subject, body: renderPlainTextEmailHtml(bodyText), bodyText };
}

async function prepareNotification({ suggestion, request, effectiveDate }) {
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
    return {
      ok: false,
      reason: 'misconfigured',
      errors: [{ key: 'DYNAMICS_IMPERSONATION_ENABLED', reason: 'not_enabled' }],
    };
  }
  const emailDefaults = await readRequiredEmailDefaults([REVIEWER_EXTENSION_BODY_KEY], {
    source: 'review-manager-review-due-extension',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }
  const bodyTemplate = emailDefaults.values[REVIEWER_EXTENSION_BODY_KEY];
  const requiredTokens = ['{{greeting}}', '{{reviewDueDate}}', '{{signature}}'];
  const missingTokens = requiredTokens.filter((token) => !bodyTemplate.includes(token));
  if (missingTokens.length > 0) {
    return {
      ok: false,
      reason: 'misconfigured',
      errors: [{ key: REVIEWER_EXTENSION_BODY_KEY, reason: 'missing_placeholders', missingTokens }],
    };
  }

  const pd = await resolveProgramDirector(request);
  const { reviewerName, recipientEmail } = await resolveReviewerNotificationIdentity(suggestion);
  if (!pd || !reviewerName || !recipientEmail) {
    return { ok: false, reason: 'notification_unavailable' };
  }

  const signatureBlock = await resolveSignatureForRequest(request.akoya_requestid);
  const rendered = renderReviewerDueDateUpdate({
    bodyTemplate,
    reviewerName,
    proposalTitle: request.akoya_title,
    dueDate: effectiveDate,
    signatureBlock,
  });
  const calendar = buildReviewDueIcs({
    reviewDueDate: effectiveDate,
    suggestionId: suggestion.wmkf_appreviewersuggestionid,
  });
  if (!rendered || !calendar) return { ok: false, reason: 'notification_unavailable' };

  return {
    ok: true,
    email: {
      subject: rendered.subject,
      body: rendered.body,
      from: pd.internalemailaddress,
      to: recipientEmail,
      regardingId: request.akoya_requestid,
      regardingType: 'akoya_request',
      attachments: [calendar],
      actingUserSystemId: pd.systemuserid,
      noFallback: true,
    },
  };
}

async function dispatchNotification(prepared) {
  try {
    await DynamicsService.createAndSendEmail(prepared.email);
    return { ok: true };
  } catch (error) {
    console.error('[reviewer-due-extension] deadline email dispatch failed:', error);
    return { ok: false, reason: 'send_failed' };
  }
}

function classifySaveError(error) {
  if (error?.status === 412) return 'conflict';
  const message = String(error?.message || '');
  if (message.includes('applicant-excluded suggestion')) return 'ineligible';
  if (message.includes('reviewDueDateOverride must be today or later')) return 'invalid_extension_date';
  return 'save_failed';
}

/**
 * Save a new extension (or clear it to restore the request date), then notify.
 */
export async function saveReviewerDueDateExtension({
  suggestionId,
  reviewDueDateOverride,
  actingUserSystemId = null,
} = {}) {
  const ctx = await loadContext(suggestionId);
  if (!ctx.ok) return ctx;
  const { suggestion, request } = ctx;
  const originalDate = request.wmkf_reviewduedate;

  if (reviewDueDateOverride !== null) {
    if (!isCurrentOrFutureYmd(reviewDueDateOverride) || reviewDueDateOverride <= originalDate) {
      return { ok: false, reason: 'invalid_extension_date' };
    }
    if (reviewDueDateOverride === suggestion.wmkf_reviewduedateoverride) {
      return { ok: false, reason: 'no_change' };
    }
  } else if (!suggestion.wmkf_reviewduedateoverride) {
    return { ok: false, reason: 'no_extension_to_restore' };
  }

  if (!suggestion._etag) {
    return { ok: false, reason: 'save_failed', errors: [{ message: 'Suggestion concurrency token missing' }] };
  }

  const effectiveDate = reviewDueDateOverride || originalDate;
  const prepared = await prepareNotification({
    suggestion: { ...suggestion, wmkf_reviewduedateoverride: reviewDueDateOverride },
    request,
    effectiveDate,
  });
  if (!prepared.ok) return prepared;

  try {
    await updateLifecycle(suggestionId, { reviewDueDateOverride }, {
      actingUserSystemId,
      ifMatch: suggestion._etag,
    });
  } catch (error) {
    console.error('[reviewer-due-extension] deadline write failed:', error);
    return { ok: false, reason: classifySaveError(error) };
  }

  const notification = await dispatchNotification(prepared);
  if (!notification.ok) {
    return {
      ok: false,
      saved: true,
      notified: false,
      retryable: true,
      reason: notification.reason,
      errors: notification.errors,
      effectiveReviewDeadline: effectiveDate,
    };
  }
  return {
    ok: true,
    saved: true,
    notified: true,
    effectiveReviewDeadline: effectiveDate,
  };
}

/** Retry notification from freshly read durable date state; performs no date write. */
export async function retryReviewerDueDateNotification({ suggestionId } = {}) {
  const ctx = await loadContext(suggestionId);
  if (!ctx.ok) return ctx;
  const { suggestion, request } = ctx;
  const effectiveDate = resolveEffectiveReviewDueDate({
    overrideDate: suggestion.wmkf_reviewduedateoverride,
    defaultDate: request.wmkf_reviewduedate,
  });
  if (!effectiveDate) return { ok: false, reason: 'original_due_date_missing' };
  const prepared = await prepareNotification({ suggestion, request, effectiveDate });
  if (!prepared.ok) return { ...prepared, saved: false, notified: false };
  const notification = await dispatchNotification(prepared);
  if (!notification.ok) {
    return {
      ok: false,
      saved: false,
      notified: false,
      retryable: true,
      reason: notification.reason,
      errors: notification.errors,
      effectiveReviewDeadline: effectiveDate,
    };
  }
  return { ok: true, saved: false, notified: true, effectiveReviewDeadline: effectiveDate };
}
