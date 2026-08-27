/**
 * Manual reviewer reminder actions for one selected reviewer at a time.
 *
 * Staff can follow up on either an unanswered invitation (Invite tab) or an
 * accepted-but-not-submitted review (Reviews tab). Both reuse the cron's
 * send/token/template machinery from `reviewer-reminder-sweep.js`
 * (`sendOneReminder`, `loadRequestContext`, `loadReviewer`) while adding a
 * manual-only fresh authorization and atomic marker+token write.
 *
 * Manual-send semantics (binding, per the plan):
 *   - Respond nudges stamp `wmkf_respondremindersentat`; review-due nudges
 *     stamp `wmkf_remindersentat` and increment `wmkf_remindercount`.
 *   - UNLIKE the cron, a manual re-send when the relevant marker is already set
 *     IS allowed (staff-initiated, deliberate) — neither manual path filters on
 *     its prior reminder stamp.
 *   - Still concurrency-safe: `sendOneReminder` persists the marker and token
 *     together via If-Match BEFORE sending. A 412 aborts without sending and is
 *     surfaced as a conflict, not silently retried.
 *
 * Shared eligibility is server-side and re-checked from a fresh read: the row
 * belongs to the request, remains selected, is not token-revoked, and is not
 * applicant-excluded. Each action then applies its own lifecycle checks.
 */

import { readRequiredEmailDefaults } from './email-defaults.js';
import { buildRespondReminderBodyText } from '../external/reviewer-reminder-email.js';
import {
  readReminderSuggestion as readSuggestion,
  respondRefusalReason,
  reviewDueRefusalReason,
} from './reviewer-reminder-eligibility.js';
import {
  RESPOND_SUBJECT_KEY,
  RESPOND_BODY_KEY,
  REVIEW_DUE_SUBJECT_KEY,
  REVIEW_DUE_BODY_KEY,
  loadRequestContext,
  loadReviewer,
  sendOneReminder,
} from './reviewer-reminder-sweep.js';
import { cancelScheduledEmailBySource } from './scheduled-email-store.js';
import {
  REVIEWER_RESPOND_WORKFLOW,
  REVIEWER_REVIEWDUE_WORKFLOW,
} from './reviewer-reminder-workflows.js';

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

async function sendManualReminder({ kind, subjectTemplate, bodyTemplate, reviewedContent, row, requestId, refusalReasonForRow, delivery, actingUserSystemId }) {
  const result = { sent: 0, claimFailed: 0, prepareFailed: 0, sendFailed: 0, errors: [] };
  await sendOneReminder({
    kind,
    subjectTemplate,
    bodyTemplate,
    reviewedContent,
    row,
    ...delivery,
    actingUserSystemId,
    authorizeMint: async () => {
      const { row: current, error } = await readSuggestion(row.wmkf_appreviewersuggestionid);
      if (error) return { ok: false, reason: 'read_failed' };
      if (!current?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
      const reason = refusalReasonForRow(current, requestId);
      if (reason) return { ok: false, reason };
      if (!current._etag) return { ok: false, reason: 'conflict' };
      return { ok: true, ifMatch: current._etag, row: current };
    },
    result,
  });

  if (result.refusalReason) return { ok: false, reason: result.refusalReason };
  if (result.claimFailed > 0) return { ok: false, reason: 'conflict' };
  if (result.prepareFailed > 0) return { ok: false, reason: 'prepare_failed' };
  if (result.sendFailed > 0) return { ok: false, reason: 'send_failed', errors: result.errors };

  // A deliberate manual nudge supersedes the queued cron copy: cancel the
  // ledger row so the reviewer isn't double-nudged. Best-effort — the marker
  // this send just stamped also stops the queued row at delivery time, so a
  // failure here only delays the cleanup, never causes a duplicate.
  try {
    await cancelScheduledEmailBySource(
      kind === 'respond' ? REVIEWER_RESPOND_WORKFLOW : REVIEWER_REVIEWDUE_WORKFLOW,
      row.wmkf_appreviewersuggestionid,
    );
  } catch (cancelError) {
    console.warn('[reviewer manual reminder] scheduled-copy cancel failed (non-fatal):', cancelError?.message || cancelError);
  }
  return { ok: true };
}

/**
 * @param {{ requestId: string, suggestionId: string, actingUserSystemId?: string|null }} args
 *   Both ids must already be GUID-validated by the caller (route trust boundary) —
 *   this service interpolates them raw into Dataverse selectors.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'misconfigured'|'not_found'|'read_failed'|'removed'|'revoked'|'ineligible'|'conflict'|'prepare_failed'|'send_failed', errors?: any[] }>}
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
  const refusalReason = reviewDueRefusalReason(row, requestId);
  if (refusalReason) return { ok: false, reason: refusalReason };

  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  return sendManualReminder({
    kind: 'reviewdue',
    subjectTemplate: emailDefaults.values[REVIEW_DUE_SUBJECT_KEY],
    bodyTemplate: emailDefaults.values[REVIEW_DUE_BODY_KEY],
    row,
    requestId,
    refusalReasonForRow: reviewDueRefusalReason,
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
