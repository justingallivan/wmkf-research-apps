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
import { isGuid } from '../utils/guid.js';
import { resolveRequestTestState } from './test-requests/request-test-state.js';
import {
  sharedDeadlineTemplate, resolveSenderDeadlineTemplate, validateDeadlineTemplate,
  deadlinePreviewDigest, mintDeadlinePreviewProof, verifyDeadlinePreviewProof,
} from './reviewer-deadline-personalization.js';
import { DynamicsService } from './dynamics-service.js';
import { classifyEmailDispatchError } from '../../shared/utils/email-send-outcome.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { resolveSignatureForRequest } from './email-signature.js';
import {
  getByIdWithSelect as getSuggestionByIdWithSelect,
  isExcluded,
} from '../dataverse/adapters/reviewer-suggestion.js';
import { changeReviewDeadline } from './reviewer-engagement/change-review-deadline.js';
import { getById as getRequestById } from '../dataverse/adapters/grant-request.js';
import { getById as getPotentialReviewerById } from '../dataverse/adapters/potential-reviewer.js';
import { getById as getSystemUserById } from '../dataverse/adapters/system-user.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';
import { isDataverseRecordNotFound } from '../dataverse/core/errors.js';
import { assertReviewerDirectedEmailBound } from './test-requests/reviewer-directed-email.js';

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
  'wmkf_externaltokenhash',
  'wmkf_externaltokenexpires',
  'wmkf_externaltokenrevoked',
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

function currentTokenCoversDate(suggestion, dueDate) {
  if (!suggestion?.wmkf_externaltokenhash) return true;
  if (suggestion.wmkf_externaltokenrevoked === true) return false;
  const expiresMs = Date.parse(suggestion.wmkf_externaltokenexpires || '');
  const dueMs = Date.parse(`${dueDate}T23:59:59Z`);
  return Number.isFinite(expiresMs) && Number.isFinite(dueMs) && expiresMs >= dueMs;
}

async function loadContext(suggestionId, expectedRequestId) {
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
  if (!expectedRequestId || String(requestId).toLowerCase() !== String(expectedRequestId).toLowerCase()) {
    return { ok: false, reason: 'request_mismatch' };
  }
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

export function renderReviewerDueDateUpdate({ subjectTemplate = 'Updated review deadline: {{proposalTitle}}', bodyTemplate, reviewerName, proposalTitle, dueDate, signatureBlock }) {
  const signature = composeReviewerEmailSignature(signatureBlock);
  const greeting = buildReviewerGreeting(reviewerName);
  const formattedDueDate = formatDateLong(dueDate);
  if (!reviewerName || !formattedDueDate) return null;
  const title = String(proposalTitle || '').replace(/[\r\n]/g, ' ').trim();
  const subject = (title ? subjectTemplate : subjectTemplate.replace(/[:–—-]\s*\{\{proposalTitle\}\}\s*$/, ''))
    .split('{{proposalTitle}}').join(title).trim();
  if (!subject || subject.length > 500 || /[\r\n]/.test(subject)) return null;
  const bodyText = applyTemplate(bodyTemplate, {
    '{{greeting}}': greeting,
    '{{reviewerName}}': reviewerName,
    '{{proposalTitle}}': proposalTitle || 'the proposal',
    '{{reviewDueDate}}': formattedDueDate,
    '{{signature}}': signature,
  });
  return { subject, body: renderPlainTextEmailHtml(bodyText), bodyText };
}

/** Cc is never preference data. The normalized list is proof-bound. */
export function normalizeDeadlineCc(cc, to, from) {
  if (!Array.isArray(cc) || cc.length > 20) return null;
  const result = [];
  for (const value of cc) {
    if (typeof value !== 'string' || value.length > 254) return null;
    const address = value.trim().toLowerCase();
    if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(address)
      || [to, from].some((other) => String(other).trim().toLowerCase() === address)) return null;
    if (!result.includes(address)) result.push(address);
  }
  return result;
}

async function checkRecipients(suggestionId, requestId, to, cc) {
  // Read even when the general isolation switch is off: the slice-2 Cc rule
  // is unconditional and cannot be weakened by that switch.
  let state;
  try { state = await resolveRequestTestState(requestId); }
  catch { return { ok: false, reason: 'recipient_policy_refused', retryable: false }; }
  if (state.kind === 'synthetic' && cc.length) return { ok: false, reason: 'cc_not_allowed_for_test_request', retryable: false };
  if (!['ordinary', 'synthetic'].includes(state.kind)) return { ok: false, reason: 'recipient_policy_refused', retryable: false };
  try {
    await assertReviewerDirectedEmailBound({ suggestionId, requestId, recipients: [to, ...cc] });
    return { ok: true };
  } catch { return { ok: false, reason: 'recipient_policy_refused', retryable: false }; }
}

function sameId(a, b) { return isGuid(a) && isGuid(b) && a.toLowerCase() === b.toLowerCase(); }
const OPERATIONS = ['save', 'restore', 'retry', 'resend'];

async function prepareNotificationUnchecked({ suggestionId, expectedRequestId, actingUserSystemId, operation, reviewDueDateOverride, template, cc = [] }) {
  if (!isGuid(actingUserSystemId)) return { ok: false, reason: 'assigned_pd_required' };
  if (!OPERATIONS.includes(operation)) return { ok: false, reason: 'invalid_preview' };
  const ctx = await loadContext(suggestionId, expectedRequestId);
  if (!ctx.ok) return ctx;
  const { suggestion, request } = ctx;
  if (!sameId(request._wmkf_programdirector_value, actingUserSystemId)) return { ok: false, reason: 'assigned_pd_required' };
  let effectiveDate;
  if (operation === 'save') {
    if (!isCurrentOrFutureYmd(reviewDueDateOverride) || reviewDueDateOverride <= request.wmkf_reviewduedate) return { ok: false, reason: 'invalid_extension_date' };
    if (reviewDueDateOverride === suggestion.wmkf_reviewduedateoverride) return { ok: false, reason: 'no_change' };
    if (!currentTokenCoversDate(suggestion, reviewDueDateOverride)) return { ok: false, reason: 'token_recovery_required' };
    effectiveDate = reviewDueDateOverride;
  } else if (operation === 'restore') {
    if (!suggestion.wmkf_reviewduedateoverride) return { ok: false, reason: 'no_extension_to_restore' };
    effectiveDate = request.wmkf_reviewduedate;
  } else {
    effectiveDate = resolveEffectiveReviewDueDate({ overrideDate: suggestion.wmkf_reviewduedateoverride, defaultDate: request.wmkf_reviewduedate });
  }
  if (!suggestion._etag) return { ok: false, reason: 'read_failed' };
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') return { ok: false, reason: 'misconfigured' };
  const pd = await resolveProgramDirector(request);
  if (!pd || !sameId(pd.systemuserid, actingUserSystemId)) return { ok: false, reason: 'sender_changed' };
  const { reviewerName, recipientEmail } = await resolveReviewerNotificationIdentity(suggestion);
  if (!reviewerName || !recipientEmail) return { ok: false, reason: 'notification_unavailable' };
  const normalizedCc = normalizeDeadlineCc(cc, recipientEmail, pd.internalemailaddress);
  if (!normalizedCc) return { ok: false, reason: 'invalid_cc' };
  const recipients = await checkRecipients(suggestionId, expectedRequestId, recipientEmail, normalizedCc);
  if (!recipients.ok) return recipients;
  let selected = { template, templateSource: 'edited' };
  if (template === undefined) {
    const shared = await sharedDeadlineTemplate();
    if (!shared.ok) return shared;
    selected = await resolveSenderDeadlineTemplate(actingUserSystemId, shared.template);
  }
  const checked = validateDeadlineTemplate(selected.template);
  if (!checked.valid) return { ok: false, reason: 'invalid_preview', errors: checked.errors };
  const signatureBlock = await resolveSignatureForRequest(request.akoya_requestid);
  const rendered = renderReviewerDueDateUpdate({ subjectTemplate: checked.value.subject, bodyTemplate: checked.value.body,
    reviewerName, proposalTitle: request.akoya_title, dueDate: effectiveDate, signatureBlock });
  const calendar = buildReviewDueIcs({ reviewDueDate: effectiveDate, suggestionId });
  if (!rendered || !calendar) return { ok: false, reason: 'invalid_preview' };
  const binding = {
    operation, actingUserSystemId, suggestionId, expectedRequestId, effectiveDate,
    row: suggestion, request, senderId: pd.systemuserid, from: pd.internalemailaddress,
    to: recipientEmail, cc: normalizedCc, reviewerName, signatureBlock,
    template: checked.value, rendered,
  };
  return {
    ok: true, binding, digest: deadlinePreviewDigest(binding),
    template: checked.value, templateSource: selected.templateSource, templateNotice: selected.templateNotice,
    effectiveDate, suggestion, request,
    email: { subject: rendered.subject, body: checked.value.body === '' ? '' : rendered.body,
      from: pd.internalemailaddress, to: recipientEmail, cc: normalizedCc,
      regardingId: request.akoya_requestid, regardingType: 'akoya_request', attachments: [calendar],
      actingUserSystemId: pd.systemuserid, noFallback: true },
    rendered,
  };
}

async function prepareNotification(input) {
  try { return await prepareNotificationUnchecked(input); }
  catch { return { ok: false, reason: 'read_failed' }; }
}

function previewDto(prepared, proof) {
  return { template: prepared.template, templateSource: prepared.templateSource, templateNotice: prepared.templateNotice,
    subject: prepared.rendered.subject, bodyText: prepared.rendered.bodyText, previewHtml: prepared.email.body,
    from: prepared.email.from, to: prepared.email.to, cc: prepared.email.cc,
    effectiveReviewDeadline: prepared.effectiveDate, proof };
}

/** Read-only; no deadline, token, preference or transport write. */
export async function previewReviewerDueDateNotification(input = {}) {
  const prepared = await prepareNotification(input);
  if (!prepared.ok) return prepared;
  return { ok: true, preview: previewDto(prepared, await mintDeadlinePreviewProof(prepared.digest)) };
}

async function dispatchNotification(prepared) {
  const recipients = await checkRecipients(prepared.binding.suggestionId, prepared.binding.expectedRequestId, prepared.email.to, prepared.email.cc);
  if (!recipients.ok) return recipients;
  try {
    await DynamicsService.createAndSendEmail(prepared.email);
    return { ok: true };
  } catch (error) {
    if (error?.code === 'test_request_email_denied' || error?.code === 'test_request_reviewer_email_unbound') return { ok: false, reason: 'recipient_policy_refused', retryable: false };
    const dispatch = classifyEmailDispatchError(error);
    return { ok: false, retryable: dispatch.retryable, reason: dispatch.outcome === 'uncertain' ? 'send_unconfirmed' : 'send_failed' };
  }
}

function classifySaveError(error) {
  if (error?.status === 412) return 'conflict';
  const message = String(error?.message || '');
  if (message.includes('applicant-excluded suggestion')) return 'ineligible';
  if (message.includes('reviewDueDateOverride must be today or later')) return 'invalid_extension_date';
  return 'save_failed';
}

// Post-write equality allows ONLY our override, grant timestamp and ETag to
// change. Any other concurrent suggestion/request change requires new review.
function postWriteStableDigest(prepared) {
  const { _etag, wmkf_reviewduedateoverride, wmkf_reviewduedateextensiongrantedat, ...row } = prepared.binding.row;
  return deadlinePreviewDigest({ ...prepared.binding, operation: 'retry', row });
}

async function executeReviewedNotification(input, writesDate) {
  if (!input.template) return { ok: false, reason: 'invalid_preview' };
  const prepared = await prepareNotification(input);
  if (!prepared.ok) return prepared;
  if (!await verifyDeadlinePreviewProof(input.proof, prepared.digest)) return { ok: false, reason: 'preview_stale' };
  // Re-read after proof verification and immediately before the conditional
  // write/dispatch. Request and suggestion cannot be atomically locked together.
  let current = await prepareNotification(input);
  if (!current.ok) return current;
  if (current.digest !== prepared.digest) return { ok: false, reason: 'preview_stale' };
  if (writesDate) {
    try {
      await changeReviewDeadline({ suggestionId: input.suggestionId,
        reviewDueDateOverride: input.operation === 'restore' ? null : input.reviewDueDateOverride,
        ifMatch: prepared.suggestion._etag, actingUserSystemId: input.actingUserSystemId });
    } catch (error) { return { ok: false, reason: classifySaveError(error) }; }
    const retryInput = { ...input, operation: 'retry' };
    current = await prepareNotification(retryInput);
    if (!current.ok || current.effectiveDate !== prepared.effectiveDate
      || postWriteStableDigest(current) !== postWriteStableDigest(prepared)) {
      return { ok: false, saved: true, notified: false, retryable: true,
        reason: current.ok ? 'preview_stale' : current.reason,
        requiresPreview: true, effectiveReviewDeadline: prepared.effectiveDate };
    }
  }
  const notification = await dispatchNotification(current);
  if (notification.ok) return { ok: true, saved: writesDate, notified: true, effectiveReviewDeadline: current.effectiveDate };
  let retryProof;
  if (notification.retryable) {
    try {
      retryProof = await mintDeadlinePreviewProof(deadlinePreviewDigest({ ...current.binding, operation: 'retry' }));
    } catch { /* The date is already saved; require preview rather than losing that fact. */ }
  }
  return { ok: false, saved: writesDate, notified: false, reason: notification.reason,
    retryable: notification.retryable, retryProof, requiresPreview: notification.retryable && !retryProof,
    effectiveReviewDeadline: current.effectiveDate };
}

/** Final date write is impossible without an actor-bound reviewed preview. */
export async function saveReviewerDueDateExtension(input = {}) {
  return executeReviewedNotification({ ...input, operation: input.operation || (input.reviewDueDateOverride === null ? 'restore' : 'save') }, true);
}
/** Retry/resend reads durable date state and never writes a deadline. */
export async function retryReviewerDueDateNotification(input = {}) {
  return executeReviewedNotification({ ...input, operation: input.operation === 'resend' ? 'resend' : 'retry' }, false);
}
