/**
 * Manual reviewer reminder actions for one selected reviewer at a time.
 *
 * Staff can follow up on either an unanswered invitation (Invite tab) or an
 * accepted-but-not-submitted review (Reviews tab). Both reuse the cron's
 * claim/send/token/template machinery from `reviewer-reminder-sweep.js`
 * verbatim (`sendOneReminder`,
 * `loadRequestContext`, `loadReviewer`) so manual and cron sends are
 * byte-identical in what they send and how they claim.
 *
 * Manual-send semantics (binding, per the plan):
 *   - Respond nudges stamp `wmkf_respondremindersentat`; review-due nudges
 *     stamp `wmkf_remindersentat` and increment `wmkf_remindercount`.
 *   - UNLIKE the cron, a manual re-send when the relevant marker is already set
 *     IS allowed (staff-initiated, deliberate) — neither manual path filters on
 *     its prior reminder stamp.
 *   - Still concurrency-safe: `sendOneReminder` claims via If-Match BEFORE
 *     sending (claim-before-send, at-most-once). A 412 on the claim aborts
 *     without sending and is surfaced as a conflict, not silently retried.
 *
 * Shared eligibility is server-side and re-checked from a fresh read: the row
 * belongs to the request, remains selected, is not token-revoked, and is not
 * applicant-excluded. Each action then applies its own lifecycle checks.
 */

import { readRequiredEmailDefaults } from './email-defaults.js';
import { isExcluded, getByIdWithSelect } from '../dataverse/adapters/reviewer-suggestion.js';
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
  'wmkf_externaltokenrevoked',
  'wmkf_invited',
  'wmkf_emailsentat',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_applicantdisposition',
  'wmkf_externaltokenexpires',
  'wmkf_remindercount',
  'wmkf_reviewduedateoverride',
].join(',');

async function readSuggestion(suggestionId) {
  try {
    return await getByIdWithSelect(suggestionId, SUGGESTION_SELECT);
  } catch {
    return null;
  }
}

function sharedRefusalReason(row, requestId) {
  if (row._wmkf_request_value !== requestId) return 'ineligible';
  if (row.wmkf_selected !== true) return 'removed';
  if (row.wmkf_externaltokenrevoked === true) return 'revoked';
  if (isExcluded(row)) return 'ineligible';
  return null;
}

function reviewDueRefusalReason(row, requestId) {
  const sharedReason = sharedRefusalReason(row, requestId);
  if (sharedReason) return sharedReason;
  if (row.wmkf_accepted !== true) return 'ineligible';
  const materialsSent = row.wmkf_reviewstatus === REVIEW_STATUS_MATERIALS_SENT
    || row.wmkf_reviewstatus === REVIEW_STATUS_UNDER_REVIEW;
  if (!materialsSent || row.wmkf_reviewreceivedat) return 'ineligible';
  return null;
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

async function sendManualReminder({ kind, subjectTemplate, bodyTemplate, row, requestId, refusalReasonForRow, delivery, actingUserSystemId }) {
  const result = { sent: 0, claimFailed: 0, sendFailed: 0, errors: [] };
  await sendOneReminder({
    kind,
    subjectTemplate,
    bodyTemplate,
    row,
    ...delivery,
    actingUserSystemId,
    authorizeMint: async () => {
      const current = await readSuggestion(row.wmkf_appreviewersuggestionid);
      if (!current?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };
      const reason = refusalReasonForRow(current, requestId);
      if (reason) return { ok: false, reason };
      if (!current._etag) return { ok: false, reason: 'conflict' };
      return { ok: true, ifMatch: current._etag };
    },
    result,
  });

  if (result.refusalReason) return { ok: false, reason: result.refusalReason };
  if (result.claimFailed > 0) return { ok: false, reason: 'conflict' };
  if (result.sendFailed > 0) return { ok: false, reason: 'send_failed', errors: result.errors };
  return { ok: true };
}

/**
 * @param {{ requestId: string, suggestionId: string, actingUserSystemId?: string|null }} args
 *   Both ids must already be GUID-validated by the caller (route trust boundary) —
 *   this service interpolates them raw into Dataverse selectors.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'misconfigured'|'not_found'|'removed'|'revoked'|'ineligible'|'conflict'|'send_failed', errors?: any[] }>}
 */
export async function sendManualReviewDueReminder({ requestId, suggestionId, actingUserSystemId = null } = {}) {
  const emailDefaults = await readRequiredEmailDefaults([REVIEW_DUE_SUBJECT_KEY, REVIEW_DUE_BODY_KEY], {
    source: 'reviewer-reminders-review-due-manual',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }

  const row = await readSuggestion(suggestionId);
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
export async function sendManualRespondReminder({ requestId, suggestionId, actingUserSystemId = null } = {}) {
  const emailDefaults = await readRequiredEmailDefaults([RESPOND_SUBJECT_KEY, RESPOND_BODY_KEY], {
    source: 'reviewer-reminders-respond-by-manual',
  });
  if (!emailDefaults.ok) {
    return { ok: false, reason: 'misconfigured', errors: emailDefaults.failures };
  }

  const row = await readSuggestion(suggestionId);
  if (!row?.wmkf_appreviewersuggestionid) return { ok: false, reason: 'not_found' };

  const refusalReason = respondRefusalReason(row, requestId);
  if (refusalReason) return { ok: false, reason: refusalReason };

  const delivery = await loadDeliveryInputs(row, requestId);
  if (!delivery) return { ok: false, reason: 'ineligible' };
  return sendManualReminder({
    kind: 'respond',
    subjectTemplate: emailDefaults.values[RESPOND_SUBJECT_KEY],
    bodyTemplate: emailDefaults.values[RESPOND_BODY_KEY],
    row,
    requestId,
    refusalReasonForRow: respondRefusalReason,
    delivery,
    actingUserSystemId,
  });
}
