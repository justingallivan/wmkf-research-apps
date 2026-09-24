/**
 * Manual reviewer reminder actions for one selected reviewer at a time.
 *
 * Staff can follow up on either an unanswered invitation (Invite tab) or an
 * accepted-but-not-submitted review (Reviews tab). Both reuse the cron's
 * claim/send/template machinery from `reviewer-reminder-sweep.js`
 * (`sendOneReminder`, `loadRequestContext`, `loadReviewer`) while adding a
 * manual-only fresh authorization before the atomic claim. Respond nudges
 * claim and mint together; review-due nudges claim the marker without a token write.
 *
 * Manual-send semantics (binding, per the plan):
 *   - Respond nudges stamp `wmkf_respondremindersentat`; review-due nudges
 *     stamp `wmkf_remindersentat` and increment `wmkf_remindercount`.
 *   - UNLIKE the cron, a manual re-send when the relevant marker is already set
 *     IS allowed (staff-initiated, deliberate) — neither manual path filters on
 *     its prior reminder stamp.
 *   - Still concurrency-safe: `sendOneReminder` persists the marker and token
 *     via If-Match BEFORE sending. Respond nudges also mint their pre-acceptance
 *     link; review-due nudges preserve the existing review token. A 412 aborts without sending and is
 *     surfaced as a conflict, not silently retried.
 *
 * Shared eligibility is server-side and re-checked from a fresh read: the row
 * belongs to the request, remains selected, is not token-revoked, and is not
 * applicant-excluded. Each action then applies its own lifecycle checks.
 */

import { readRequiredEmailDefaults } from './email-defaults.js';
import { isExcluded, getByIdWithSelect } from '../dataverse/adapters/reviewer-suggestion.js';
import {
  buildRespondReminderBodyText,
  buildReviewDueReminderBodyText,
  REVIEW_DUE_ACCESS_INSTRUCTION,
  renderReviewDueReminder,
} from '../external/reviewer-reminder-email.js';
import {
  sharedReminderTemplate,
  loadSenderReminderTemplate,
  validateReminderTemplate,
  reminderPreviewDigest,
  mintReminderPreviewProof,
  verifyReminderPreviewProof,
} from './reviewer-reminder-personalization.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { evaluateReviewDueReminderEligibility } from './reviewer-reminder-eligibility.js';
import {
  RESPOND_SUBJECT_KEY,
  RESPOND_BODY_KEY,
  REVIEW_DUE_SUBJECT_KEY,
  REVIEW_DUE_BODY_KEY,
  REVIEW_STATUS_MATERIALS_SENT,
  REVIEW_STATUS_UNDER_REVIEW,
  loadRequestContext,
  loadReviewer,
  sendOneReminder,
} from './reviewer-reminder-sweep.js';

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_selected',
  'wmkf_externaltokenhash',
  'wmkf_externaltokenexpires',
  'wmkf_externaltokenrevoked',
  'wmkf_invited',
  'wmkf_emailsentat',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_applicantdisposition',
  'wmkf_remindercount',
  'wmkf_reviewduedateoverride',
].join(',');

async function readSuggestion(suggestionId) {
  try {
    return { row: await getByIdWithSelect(suggestionId, SUGGESTION_SELECT), error: null };
  } catch (error) {
    if (error?.status === 404) return { row: null, error: null };
    return { row: null, error };
  }
}

function sharedRefusalReason(row, requestId) {
  if (row._wmkf_request_value !== requestId) return 'ineligible';
  if (row.wmkf_selected !== true) return 'removed';
  if (row.wmkf_externaltokenrevoked === true) return 'revoked';
  if (isExcluded(row)) return 'ineligible';
  return null;
}

function reviewDueLifecycleRefusalReason(row, requestId) {
  if (row._wmkf_request_value !== requestId) return 'ineligible';
  if (row.wmkf_selected !== true) return 'removed';
  if (isExcluded(row)) return 'ineligible';
  if (row.wmkf_accepted !== true) return 'ineligible';
  const materialsSent = row.wmkf_reviewstatus === REVIEW_STATUS_MATERIALS_SENT
    || row.wmkf_reviewstatus === REVIEW_STATUS_UNDER_REVIEW;
  if (!materialsSent || row.wmkf_reviewreceivedat) return 'ineligible';
  return null;
}

function reviewDueRefusalReason(row, requestId, request) {
  const lifecycleReason = reviewDueLifecycleRefusalReason(row, requestId);
  if (lifecycleReason) return lifecycleReason;
  const effectiveReviewDueDate = resolveEffectiveReviewDueDate({
    overrideDate: row.wmkf_reviewduedateoverride,
    defaultDate: request?.wmkf_reviewduedate,
  });
  const eligibility = evaluateReviewDueReminderEligibility({
    row,
    effectiveReviewDueDate,
  });
  return eligibility.eligible ? null : eligibility.reason;
}

function respondRefusalReason(row, requestId) {
  const sharedReason = sharedRefusalReason(row, requestId);
  if (sharedReason) return sharedReason;
  if (row.wmkf_invited !== true || !row.wmkf_emailsentat) return 'ineligible';
  if (row.wmkf_accepted === true || row.wmkf_declined === true || row.wmkf_responsetype != null) {
    return 'ineligible';
  }
  return null;
}

async function loadDeliveryInputs(row, requestId) {
  const ctx = await loadRequestContext(requestId, new Map());
  if (!ctx) return null;
  const { request, pd, signatureBlock } = ctx;
  if (!pd?.internalemailaddress || !pd?.systemuserid) return null;

  const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
  if (!reviewer?.wmkf_emailaddress) return null;
  return { request, pd, signatureBlock, reviewer };
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hasCompleteReviewedContent(reviewed) {
  return reviewed && typeof reviewed === 'object'
    && typeof reviewed.subject === 'string' && Boolean(reviewed.subject.trim())
    && typeof reviewed.bodyText === 'string' && Boolean(reviewed.bodyText.trim())
    && typeof reviewed.to === 'string' && Boolean(reviewed.to.trim())
    && typeof reviewed.from === 'string' && Boolean(reviewed.from.trim())
    && typeof reviewed.senderId === 'string' && Boolean(reviewed.senderId.trim());
}

function reviewedRespondContent(reviewed, delivery) {
  if (!hasCompleteReviewedContent(reviewed)) return null;
  const { subject, bodyText, to, from, senderId } = reviewed;
  if (normalizedEmail(to) !== normalizedEmail(delivery.reviewer.wmkf_emailaddress)) {
    return { error: 'recipient_changed' };
  }
  if (
    normalizedEmail(from) !== normalizedEmail(delivery.pd.internalemailaddress)
    || senderId.toLowerCase() !== String(delivery.pd.systemuserid).toLowerCase()
  ) {
    return { error: 'sender_changed' };
  }
  return { subject, bodyText };
}

async function sendManualReminder({ kind, subjectTemplate, bodyTemplate, reviewedContent, row, requestId, refusalReasonForRow, delivery, actingUserSystemId, expectedEtag }) {
  const result = { sent: 0, claimFailed: 0, prepareFailed: 0, sendFailed: 0, sendUnconfirmed: 0, errors: [] };
  await sendOneReminder({
    kind,
    subjectTemplate,
    bodyTemplate,
    reviewedContent,
    row,
    ...delivery,
    actingUserSystemId,
    authorizeClaim: async () => {
      const { row: current, error } = await readSuggestion(row.wmkf_appreviewersuggestionid);
      if (error) return { ok: false, reason: 'read_failed' };
      if (!current?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
      const reason = refusalReasonForRow(current, requestId);
      if (reason) return { ok: false, reason };
      if (!current._etag) return { ok: false, reason: 'conflict' };
      // A changed row may still be eligible, but its date or token metadata
      // may no longer match the copy the staff member previewed.
      if (expectedEtag && current._etag !== expectedEtag) return { ok: false, reason: 'conflict' };
      return { ok: true, ifMatch: current._etag, row: current };
    },
    result,
  });

  if (result.refusalReason) return { ok: false, reason: result.refusalReason };
  if (result.claimFailed > 0) return { ok: false, reason: 'conflict' };
  if (result.prepareFailed > 0) return { ok: false, reason: 'prepare_failed' };
  if (result.sendUnconfirmed > 0) return { ok: false, reason: 'send_unconfirmed', errors: result.errors };
  if (result.sendFailed > 0) return { ok: false, reason: 'send_failed', errors: result.errors };
  return { ok: true };
}

/**
 * @param {{ requestId: string, suggestionId: string, actingUserSystemId?: string|null }} args
 *   Both ids must already be GUID-validated by the caller (route trust boundary) —
 *   this service interpolates them raw into Dataverse selectors.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'misconfigured'|'not_found'|'read_failed'|'removed'|'ineligible'|'token_revoked'|'token_not_minted'|'token_invalid_data'|'token_expired'|'token_insufficient_window'|'due_date_missing'|'conflict'|'prepare_failed'|'send_failed'|'send_unconfirmed', errors?: any[] }>}
 */
export async function sendManualReviewDueReminder({ requestId, suggestionId, actingUserSystemId = null } = {}) {
  const emailDefaults = await readRequiredEmailDefaults([REVIEW_DUE_SUBJECT_KEY, REVIEW_DUE_BODY_KEY], {
    source: 'reviewer-reminders-review-due-manual',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }

  const { row, error } = await readSuggestion(suggestionId);
  if (error) return { ok: false, reason: 'read_failed' };
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };

  // Eligibility, re-derived from a fresh read (never trust client-claimed state).
  const refusalReason = reviewDueLifecycleRefusalReason(row, requestId);
  if (refusalReason) return { ok: false, reason: refusalReason };

  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  const tokenRefusalReason = reviewDueRefusalReason(row, requestId, delivery.request);
  if (tokenRefusalReason) return { ok: false, reason: tokenRefusalReason };
  return sendManualReminder({
    kind: 'reviewdue',
    subjectTemplate: emailDefaults.values[REVIEW_DUE_SUBJECT_KEY],
    bodyTemplate: emailDefaults.values[REVIEW_DUE_BODY_KEY],
    row,
    requestId,
    refusalReasonForRow: (current, currentRequestId) =>
      reviewDueRefusalReason(current, currentRequestId, delivery.request),
    delivery,
    actingUserSystemId,
  });
}

/**
 * Send one staff-initiated follow-up to an invited reviewer who has not answered.
 * There is deliberately no deadline or prior-marker gate: the staff action is
 * the scheduling decision, and deliberate re-sends are allowed.
 */
export async function sendManualRespondReminder({ requestId, suggestionId, actingUserSystemId = null, reviewed } = {}) {
  // Send consumes the complete draft the staff member reviewed. Defaults are a
  // preview dependency only, so a later Admin edit/outage cannot silently swap
  // or block the already-reviewed copy.
  if (!hasCompleteReviewedContent(reviewed)) return { ok: false, reason: 'invalid_preview' };

  const { row, error } = await readSuggestion(suggestionId);
  if (error) return { ok: false, reason: 'read_failed' };
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };

  const refusalReason = respondRefusalReason(row, requestId);
  if (refusalReason) return { ok: false, reason: refusalReason };

  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  const reviewedContent = reviewedRespondContent(reviewed, delivery);
  if (!reviewedContent) return { ok: false, reason: 'invalid_preview' };
  if (reviewedContent.error) return { ok: false, reason: reviewedContent.error };
  return sendManualReminder({
    kind: 'respond',
    row,
    requestId,
    refusalReasonForRow: respondRefusalReason,
    delivery,
    reviewedContent,
    actingUserSystemId,
  });
}

/**
 * Render the editable respond-reminder draft without minting a token, claiming a
 * marker, or attempting delivery. Send performs the same eligibility reads again.
 */
export async function previewManualRespondReminder({ requestId, suggestionId } = {}) {
  const emailDefaults = await readRequiredEmailDefaults([RESPOND_SUBJECT_KEY, RESPOND_BODY_KEY], {
    source: 'reviewer-reminders-respond-by-manual-preview',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }

  const { row, error } = await readSuggestion(suggestionId);
  if (error) return { ok: false, reason: 'read_failed' };
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };

  const refusalReason = respondRefusalReason(row, requestId);
  if (refusalReason) return { ok: false, reason: refusalReason };

  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  const { request, pd, signatureBlock, reviewer } = delivery;
  return {
    ok: true,
    draft: {
      suggestionId: row.wmkf_appreviewersuggestionid,
      name: reviewer.wmkf_name || null,
      to: reviewer.wmkf_emailaddress,
      from: pd.internalemailaddress,
      senderId: pd.systemuserid,
      subject: emailDefaults.values[RESPOND_SUBJECT_KEY],
      bodyText: buildRespondReminderBodyText({
        bodyTemplate: emailDefaults.values[RESPOND_BODY_KEY],
        reviewerName: reviewer.wmkf_name,
        title: request.akoya_title,
        signatureBlock,
      }),
    },
  };
}

function previewBinding({ kind, requestId, suggestionId, actingUserSystemId, template, row, delivery }) {
  const { request, pd, reviewer, signatureBlock } = delivery;
  return reminderPreviewDigest({
    kind, requestId, suggestionId, actingUserSystemId,
    template,
    rowEtag: row._etag,
    rowDueDate: row.wmkf_reviewduedateoverride,
    requestTitle: request.akoya_title,
    requestDueDate: request.wmkf_reviewduedate,
    senderId: pd.systemuserid,
    from: pd.internalemailaddress,
    to: reviewer.wmkf_emailaddress,
    reviewerName: reviewer.wmkf_name,
    signatureBlock,
  });
}

/** Read-only preview for either reminder kind; no marker, token, or email write. */
export async function previewManualReminder({ kind, requestId, suggestionId, actingUserSystemId, template } = {}) {
  const shared = await sharedReminderTemplate(kind);
  if (!shared.ok) return { ok: false, reason: shared.reason, errors: shared.errors };
  const { row, error } = await readSuggestion(suggestionId);
  if (error) return { ok: false, reason: 'read_failed' };
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
  const firstRefusal = kind === 'respond' ? respondRefusalReason(row, requestId) : reviewDueLifecycleRefusalReason(row, requestId);
  if (firstRefusal) return { ok: false, reason: firstRefusal };
  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  if (kind === 'reviewdue') {
    const reason = reviewDueRefusalReason(row, requestId, delivery.request);
    if (reason) return { ok: false, reason };
  }
  // Explicit one-send copy is independently validated and proof-bound. A bad
  // saved default must not prevent an authorized staff member from repairing it.
  let selectedTemplate = template;
  if (selectedTemplate === undefined) {
    const personal = await loadSenderReminderTemplate(delivery.pd.systemuserid, kind, shared.template);
    if (!personal.ok) return { ok: false, reason: personal.reason, errors: personal.errors, shared: shared.template };
    selectedTemplate = personal.template;
  }
  const checked = validateReminderTemplate(kind, selectedTemplate);
  if (!checked.valid) return { ok: false, reason: 'invalid_preview', errors: checked.errors };
  const resolved = checked.value;
  const { request, pd, reviewer, signatureBlock } = delivery;
  const dueDate = resolveEffectiveReviewDueDate({
    overrideDate: row.wmkf_reviewduedateoverride,
    defaultDate: request.wmkf_reviewduedate,
  });
  const bodyText = kind === 'respond'
    ? buildRespondReminderBodyText({ bodyTemplate: resolved.body, reviewerName: reviewer.wmkf_name, title: request.akoya_title, signatureBlock })
    : buildReviewDueReminderBodyText({ bodyTemplate: resolved.body, reviewerName: reviewer.wmkf_name, title: request.akoya_title, reviewDueDate: dueDate, signatureBlock });
  const previewHtml = kind === 'reviewdue'
    ? renderReviewDueReminder({ subjectTemplate: resolved.subject, bodyTemplate: resolved.body, reviewerName: reviewer.wmkf_name, title: request.akoya_title, reviewDueDate: dueDate, signatureBlock }).html
    : null;
  const proof = await mintReminderPreviewProof(previewBinding({ kind, requestId, suggestionId, actingUserSystemId, template: resolved, row, delivery }));
  return {
    ok: true,
    draft: {
      suggestionId, kind,
      name: reviewer.wmkf_name || null,
      to: reviewer.wmkf_emailaddress,
      from: pd.internalemailaddress,
      senderId: pd.systemuserid,
      subject: resolved.subject,
      bodyText,
      previewHtml,
      ...(kind === 'reviewdue' ? { fixedAccessInstruction: REVIEW_DUE_ACCESS_INSTRUCTION, dueDate } : {}),
      template: resolved,
      proof,
    },
  };
}

/** Proof-bound manual send; edited raw template is never saved as a preference. */
export async function sendManualReminderWithProof({ kind, requestId, suggestionId, actingUserSystemId, template, proof } = {}) {
  const checked = validateReminderTemplate(kind, template);
  if (!checked.valid) return { ok: false, reason: 'invalid_preview', errors: checked.errors };
  const { row, error } = await readSuggestion(suggestionId);
  if (error) return { ok: false, reason: 'read_failed' };
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
  const firstRefusal = kind === 'respond' ? respondRefusalReason(row, requestId) : reviewDueLifecycleRefusalReason(row, requestId);
  if (firstRefusal) return { ok: false, reason: firstRefusal };
  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  if (kind === 'reviewdue') {
    const reason = reviewDueRefusalReason(row, requestId, delivery.request);
    if (reason) return { ok: false, reason };
  }
  const digest = previewBinding({ kind, requestId, suggestionId, actingUserSystemId, template: checked.value, row, delivery });
  if (!await verifyReminderPreviewProof(proof, digest)) return { ok: false, reason: 'preview_stale' };
  return sendManualReminder({
    kind,
    subjectTemplate: checked.value.subject,
    bodyTemplate: checked.value.body,
    row,
    requestId,
    refusalReasonForRow: kind === 'respond'
      ? respondRefusalReason
      : (current, currentRequestId) => reviewDueRefusalReason(current, currentRequestId, delivery.request),
    delivery,
    actingUserSystemId,
    expectedEtag: row._etag,
  });
}
