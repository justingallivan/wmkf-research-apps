/**
 * Accepted-reviewer due-date extension workflow.
 *
 * The date write is deliberately committed before notification. A delivery
 * failure therefore returns a partial-success result that keeps the new
 * operational deadline in force and gives the staff UI a safe retry action.
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
import { getById as getSystemUserById } from '../dataverse/adapters/system-user.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';

export const REVIEWER_EXTENSION_BODY_KEY = 'email.reviewer_extension.body';
export const REVIEWER_EXTENSION_SUBJECT_PREFIX = 'Updated review deadline';

const TERMINAL_STATUS_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));
const ACTIVE_EXTENSION_STATUS_VALUES = new Set([null, 100000000, 100000001, 100000002]);
const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
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
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!suggestion?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
  if (!isEligibleSuggestion(suggestion)) return { ok: false, reason: 'ineligible' };

  const requestId = suggestion._wmkf_request_value;
  if (!requestId) return { ok: false, reason: 'ineligible' };
  const request = await getRequestById(requestId, { select: REQUEST_SELECT }).catch(() => null);
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

async function sendNotification({ suggestion, request, effectiveDate }) {
  const emailDefaults = await readRequiredEmailDefaults([REVIEWER_EXTENSION_BODY_KEY], {
    source: 'review-manager-review-due-extension',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }
  const bodyTemplate = emailDefaults.values[REVIEWER_EXTENSION_BODY_KEY];
  const requiredTokens = ['{{reviewerName}}', '{{reviewDueDate}}', '{{signature}}'];
  const missingTokens = requiredTokens.filter((token) => !bodyTemplate.includes(token));
  if (missingTokens.length > 0) {
    return {
      ok: false,
      reason: 'misconfigured',
      errors: [{ key: REVIEWER_EXTENSION_BODY_KEY, reason: 'missing_placeholders', missingTokens }],
    };
  }

  const pd = await resolveProgramDirector(request);
  const reviewerName = confirmedReviewerName(suggestion);
  const recipientEmail = String(suggestion?.wmkf_revieweremail || '').trim();
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

  try {
    await DynamicsService.createAndSendEmail({
      subject: rendered.subject,
      body: rendered.body,
      from: pd.internalemailaddress,
      to: recipientEmail,
      regardingId: request.akoya_requestid,
      regardingType: 'akoya_request',
      attachments: [calendar],
      actingUserSystemId: pd.systemuserid,
      noFallback: true,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'send_failed',
      errors: [{ message: String(error?.message || error).slice(0, 240) }],
    };
  }
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

  try {
    if (!suggestion._etag) {
      return { ok: false, reason: 'save_failed', errors: [{ message: 'Suggestion concurrency token missing' }] };
    }
    await updateLifecycle(suggestionId, { reviewDueDateOverride }, {
      actingUserSystemId,
      ifMatch: suggestion._etag,
    });
  } catch (error) {
    return { ok: false, reason: 'save_failed', errors: [{ message: String(error?.message || error).slice(0, 240) }] };
  }

  const effectiveDate = reviewDueDateOverride || originalDate;
  const notification = await sendNotification({
    suggestion: { ...suggestion, wmkf_reviewduedateoverride: reviewDueDateOverride },
    request,
    effectiveDate,
  });
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

/** Retry notification from freshly read durable date state; performs no write. */
export async function retryReviewerDueDateNotification({ suggestionId } = {}) {
  const ctx = await loadContext(suggestionId);
  if (!ctx.ok) return ctx;
  const { suggestion, request } = ctx;
  const effectiveDate = resolveEffectiveReviewDueDate({
    overrideDate: suggestion.wmkf_reviewduedateoverride,
    defaultDate: request.wmkf_reviewduedate,
  });
  if (!effectiveDate) return { ok: false, reason: 'original_due_date_missing' };
  const notification = await sendNotification({ suggestion, request, effectiveDate });
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
  return { ok: true, saved: true, notified: true, effectiveReviewDeadline: effectiveDate };
}
