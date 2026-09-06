/**
 * Reviewer reminder sweeps (reviewer-engagement Phase 3, spec §3.B).
 *
 * Two daily, per-request-configurable reminders, both fire-once and claim-before-send
 * (mirrors grantee-deliverable-reminders): a marker is stamped via an If-Match/ETag
 * conditional write BEFORE the email goes out, so a concurrent run or a post-send retry
 * can never double-send. A send failure after a successful claim is logged, not retried
 * (at-most-once — a soft nudge is better dropped than duplicated).
 *
 *   Respond-by  : nudge an invited reviewer who has not accepted/declined. Per-reviewer
 *                 deadline = wmkf_emailsentat + respondOffsetDays (computed here; OData
 *                 can't do the arithmetic). Fires once at today >= deadline - leadDays,
 *                 only while the token is unexpired. Marker: wmkf_respondremindersentat.
 *   Review-due  : nudge an accepted, materials-sent, not-yet-submitted reviewer. Deadline
 *                 = suggestion override or request wmkf_reviewduedate, minus leadDays.
 *                 Marker: wmkf_remindersentat
 *                 (the existing review-due/follow-up marker — automates the manual followup).
 *
 * Respond reminders re-mint the short pre-acceptance link. Review-due reminders never
 * mint or replace token authority; they direct the reviewer to the stable link in the
 * original materials email.
 *
 * Both are gated per-request by the campaign-config enabled flag; a request with the flag
 * off (or null) is skipped. Designed for cron use (bounded batches, fail-soft per row).
 */

import { DynamicsService } from './dynamics-service.js';
import { mintAndStore } from '../external/token-lifecycle.js';
import { computeReviewerTokenExpiry } from '../external/reviewer-token-ttl.js';
import { resolveSignatureForRequest } from './email-signature.js';
import {
  renderRespondReminder,
  renderRespondReminderFromBodyText,
  renderReviewDueReminder,
} from '../external/reviewer-reminder-email.js';
import {
  notExcludedFilter,
  selectedAndNotRevokedFilter,
  queryAllSuggestions,
} from '../dataverse/adapters/reviewer-suggestion.js';
import { claimReviewDueReminder } from './reviewer-engagement/claim-reminder.js';
import { getById as getRequestById } from '../dataverse/adapters/grant-request.js';
import { getById as getSystemUserById } from '../dataverse/adapters/system-user.js';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../dataverse/adapters/potential-reviewer.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import {
  REVIEW_DUE_TOKEN_BLOCK_REASONS,
  evaluateReviewDueReminderEligibility,
} from './reviewer-reminder-eligibility.js';
import {
  REVIEW_STATUS_MATERIALS_SENT,
  REVIEW_STATUS_UNDER_REVIEW,
  reviewDueCandidateFilter,
} from './reviewer-reminder-candidate.js';

// Exported so `lib/services/reviewer-manual-reminder.js` (staff "Send reminder
// now" action, workbench Reviews tab Phase 1) can reuse the exact same
// claim/send/token/template machinery instead of duplicating it — the cron
// path here is otherwise unchanged.
export const SUGGESTION_SET = 'wmkf_appreviewersuggestions';
const DAY_MS = 24 * 60 * 60 * 1000;
export const RESPOND_SUBJECT_KEY = 'email.reviewer_reminder_respond_by.subject';
export const RESPOND_BODY_KEY = 'email.reviewer_reminder_respond_by.body';
export const REVIEW_DUE_SUBJECT_KEY = 'email.reviewer_reminder_review_due.subject';
export const REVIEW_DUE_BODY_KEY = 'email.reviewer_reminder_review_due.body';

export { REVIEW_STATUS_MATERIALS_SENT, REVIEW_STATUS_UNDER_REVIEW, reviewDueCandidateFilter };

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title',
  'wmkf_organizationname', '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  'wmkf_respondoffsetdays', 'wmkf_respondreminderenabled', 'wmkf_respondreminderleaddays',
  'wmkf_reviewduedate', 'wmkf_reviewduereminderenabled', 'wmkf_reviewduereminderleaddays',
].join(',');

function emptyResult(dryRun, { includeReviewDueBlocks = false } = {}) {
  const result = {
    scanned: 0,
    eligible: 0,
    sent: 0,
    skipped: 0,
    skippedMisconfigured: 0,
    prepareFailed: 0,
    claimFailed: 0,
    sendFailed: 0,
    errors: [],
    dryRun,
  };
  if (includeReviewDueBlocks) {
    result.blocked = Object.fromEntries(REVIEW_DUE_TOKEN_BLOCK_REASONS.map((reason) => [reason, 0]));
  }
  return result;
}

function recordReviewDueBlock(result, reason, { manual = false } = {}) {
  if (!result.blocked) result.blocked = {};
  result.blocked[reason] = (result.blocked[reason] || 0) + 1;
  result.skipped = (result.skipped || 0) + 1;
  if (manual) result.refusalReason = reason;
}

/**
 * Load + cache per-request context: config, PD sender (email + systemuserid), signature.
 * Returns null when the request/PD can't be resolved (caller skips the row).
 */
export async function loadRequestContext(requestId, cache) {
  if (cache.has(requestId)) return cache.get(requestId);
  let ctx = null;
  try {
    const request = await getRequestById(requestId, { select: REQUEST_SELECT });
    if (request?.akoya_requestid) {
      let pd = null;
      const pdGuid = request._wmkf_programdirector_value;
      if (pdGuid) {
        pd = await getSystemUserById(pdGuid).catch(() => null);
      }
      const signatureBlock = await resolveSignatureForRequest(requestId).catch(() => null);
      ctx = { request, pd: pd && pd.isdisabled === false ? pd : null, signatureBlock };
    }
  } catch {
    ctx = null;
  }
  cache.set(requestId, ctx);
  return ctx;
}

export async function loadReviewer(personId) {
  if (!personId) return null;
  return getReviewerByIdWithSelect(personId, {
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress',
  }).catch(() => null);
}

/**
 * Respond-by reminder sweep.
 */
export async function sweepRespondReminders({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const now = Date.now();
  const result = emptyResult(dryRun);
  const emailDefaults = await readRequiredEmailDefaults([RESPOND_SUBJECT_KEY, RESPOND_BODY_KEY], {
    source: 'reviewer-reminders-respond-by',
  });

  // Invited, emailed, no response yet, not already respond-reminded, not excluded,
  // still selected, token not revoked. The selected/not-revoked clause mirrors the
  // manual reminder path so an automatic reminder can't re-mint a fresh link for a
  // staff-revoked or deselected reviewer (mintAndStore clears the revoked flag).
  const { records } = await queryAllSuggestions({
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_emailsentat,wmkf_externaltokenexpires,wmkf_reviewduedateoverride',
    filter: `wmkf_invited eq true and wmkf_emailsentat ne null `
      + `and (wmkf_accepted eq false or wmkf_accepted eq null) `
      + `and (wmkf_declined eq false or wmkf_declined eq null) `
      + `and wmkf_responsetype eq null and wmkf_respondremindersentat eq null `
      + `and ${selectedAndNotRevokedFilter()} and ${notExcludedFilter()}`,
  });
  result.scanned = records.length;
  if (records.length === 0) return result;
  if (!emailDefaults.ok) {
    result.skipped += records.length;
    result.skippedMisconfigured += records.length;
    result.errors.push({
      id: null,
      message: `email defaults misconfigured: ${emailDefaults.failures.map((f) => `${f.key}:${f.reason}`).join(', ')}`,
    });
    return result;
  }

  const requestCache = new Map();
  // maxBatch bounds irreversible CLAIMS (marker writes), not just successful sends — a
  // send outage must not let one run stamp far more than maxBatch rows as reminded
  // (Codex Phase-3 finding #1). `attempted` counts every row we proceed to claim+send.
  let attempted = 0;
  for (const row of records) {
    if (attempted >= maxBatch) { result.skipped++; continue; }
    const ctx = await loadRequestContext(row._wmkf_request_value, requestCache);
    if (!ctx) { result.skipped++; continue; }
    const { request, pd, signatureBlock } = ctx;

    const enabled = request.wmkf_respondreminderenabled === true;
    const offset = Number.isInteger(request.wmkf_respondoffsetdays) ? request.wmkf_respondoffsetdays : null;
    const lead = Number.isInteger(request.wmkf_respondreminderleaddays) ? request.wmkf_respondreminderleaddays : 0;
    if (!enabled || offset == null || !row.wmkf_emailsentat) { result.skipped++; continue; }

    // Per-reviewer soft deadline = emailSentAt + offset days; fire at deadline - lead.
    const deadline = new Date(row.wmkf_emailsentat).getTime() + offset * DAY_MS;
    if (now < deadline - lead * DAY_MS) { result.skipped++; continue; }

    // Only nudge while the reviewer's current token is still live (§3.B); a dead link
    // means their offer window has already closed.
    const tokenExpires = row.wmkf_externaltokenexpires ? new Date(row.wmkf_externaltokenexpires).getTime() : null;
    if (tokenExpires == null || tokenExpires <= now) { result.skipped++; continue; }

    if (!pd?.internalemailaddress || !pd?.systemuserid) { result.skipped++; continue; }
    const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
    if (!reviewer?.wmkf_emailaddress) { result.skipped++; continue; }

    result.eligible++;
    if (dryRun) continue;

    attempted++;
    await sendOneReminder({
      kind: 'respond',
      subjectTemplate: emailDefaults.values[RESPOND_SUBJECT_KEY],
      bodyTemplate: emailDefaults.values[RESPOND_BODY_KEY],
      row, request, pd, signatureBlock, reviewer,
      actingUserSystemId, result,
    });
  }
  return result;
}

/**
 * Review-due reminder sweep.
 */
export async function sweepReviewDueReminders({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const now = Date.now();
  const result = emptyResult(dryRun, { includeReviewDueBlocks: true });
  const emailDefaults = await readRequiredEmailDefaults([REVIEW_DUE_SUBJECT_KEY, REVIEW_DUE_BODY_KEY], {
    source: 'reviewer-reminders-review-due',
  });

  // Accepted, materials sent (or under review), not yet submitted, not already review-due
  // reminded (wmkf_remindersentat null — shared with the manual followup so the two never
  // double-nudge), not excluded.
  //
  // Manual and scheduled review-due reminders share this marker and both claim it
  // before sending, so they cannot double-nudge from the same unclaimed row.
  const { records } = await queryAllSuggestions({
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_remindercount,wmkf_reviewduedateoverride,wmkf_externaltokenhash,wmkf_externaltokenexpires,wmkf_externaltokenrevoked',
    filter: reviewDueCandidateFilter(),
  });
  result.scanned = records.length;
  if (records.length === 0) return result;
  if (!emailDefaults.ok) {
    result.skipped += records.length;
    result.skippedMisconfigured += records.length;
    result.errors.push({
      id: null,
      message: `email defaults misconfigured: ${emailDefaults.failures.map((f) => `${f.key}:${f.reason}`).join(', ')}`,
    });
    return result;
  }

  const requestCache = new Map();
  let attempted = 0; // bounds irreversible claims, not just sends (Codex finding #1)
  for (const row of records) {
    if (attempted >= maxBatch) { result.skipped++; continue; }
    const ctx = await loadRequestContext(row._wmkf_request_value, requestCache);
    if (!ctx) { result.skipped++; continue; }
    const { request, pd, signatureBlock } = ctx;

    const enabled = request.wmkf_reviewduereminderenabled === true;
    const lead = Number.isInteger(request.wmkf_reviewduereminderleaddays) ? request.wmkf_reviewduereminderleaddays : 0;
    const dueYmd = resolveEffectiveReviewDueDate({
      overrideDate: row.wmkf_reviewduedateoverride,
      defaultDate: request.wmkf_reviewduedate,
    });
    if (!enabled) { result.skipped++; continue; }

    // Fire at review-due - lead. End-of-day on the due date.
    const dueMs = dueYmd ? Date.parse(`${dueYmd}T23:59:59Z`) : NaN;
    if (!Number.isFinite(dueMs)) {
      recordReviewDueBlock(result, 'due_date_missing');
      continue;
    }
    if (now < dueMs - lead * DAY_MS) { result.skipped++; continue; }

    const eligibility = evaluateReviewDueReminderEligibility({
      row,
      effectiveReviewDueDate: dueYmd,
      nowMs: now,
    });
    if (!eligibility.eligible) {
      recordReviewDueBlock(result, eligibility.reason);
      continue;
    }

    if (!pd?.internalemailaddress || !pd?.systemuserid) { result.skipped++; continue; }
    const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
    if (!reviewer?.wmkf_emailaddress) { result.skipped++; continue; }

    result.eligible++;
    if (dryRun) continue;

    attempted++;
    await sendOneReminder({
      kind: 'reviewdue',
      subjectTemplate: emailDefaults.values[REVIEW_DUE_SUBJECT_KEY],
      bodyTemplate: emailDefaults.values[REVIEW_DUE_BODY_KEY],
      row, request, pd, signatureBlock, reviewer,
      actingUserSystemId, result,
    });
  }
  return result;
}

/**
 * Claim, render, and send one reminder. Respond reminders atomically claim and mint
 * their pre-acceptance link. Review-due reminders atomically claim only their marker,
 * preserving the accepted reviewer's existing token. Manual sends first authorize
 * from a fresh row. Either path skips on a stale ETag; send failures after a successful
 * claim are not retried.
 */
export async function sendOneReminder({ kind, subjectTemplate, bodyTemplate, reviewedContent, row, request, pd, signatureBlock, reviewer, actingUserSystemId, authorizeClaim, result }) {
  if (kind !== 'respond' && kind !== 'reviewdue') {
    result.prepareFailed++;
    result.refusalReason = 'invalid_kind';
    result.errors.push({
      id: row?.wmkf_appreviewersuggestionid || null,
      message: `unsupported reminder kind: ${String(kind)}`,
    });
    return;
  }

  const id = row.wmkf_appreviewersuggestionid;
  const nowIso = new Date().toISOString();

  // Reviewed copy is a manual respond-reminder-only contract. Reject an
  // incomplete or misplaced override before any marker/token persistence.
  if (reviewedContent && (
    kind !== 'respond'
    || typeof reviewedContent.subject !== 'string'
    || !reviewedContent.subject.trim()
    || typeof reviewedContent.bodyText !== 'string'
    || !reviewedContent.bodyText.trim()
  )) {
    result.prepareFailed++;
    return;
  }

  // Fail closed when the ETag is missing (Codex finding #2): without it the claim would
  // degrade to an UNCONDITIONAL write and silently lose its concurrency guarantee. Skip
  // rather than send under a claim we couldn't make atomic.
  if (!row._etag) { result.claimFailed++; return; }

  // Manual sends re-authorize from a fresh read first; cron binds to the query row's
  // ETag. Either
  // way, a staff revoke/deselect (or another run) landing after our read makes the
  // write 412 instead of being silently overwritten. This closes the window where the
  // former cron claim-then-unconditional-mint flow let `setExternalToken` clear
  // `wmkf_externaltokenrevoked` back to false and reactivate a link the token verifier
  // does NOT re-gate on `wmkf_selected` (Codex adversarial P1).
  let claimIfMatch = row._etag;
  let effectiveRow = row;
  if (authorizeClaim) {
    let authorization;
    try {
      authorization = await authorizeClaim();
    } catch {
      authorization = { ok: false, reason: 'conflict' };
    }
    if (!authorization?.ok || !authorization.ifMatch) {
      result.refusalReason = authorization?.reason || 'conflict';
      return;
    }
    claimIfMatch = authorization.ifMatch;
    effectiveRow = authorization.row || row;
  }

  const reviewDueDate = resolveEffectiveReviewDueDate({
    overrideDate: effectiveRow.wmkf_reviewduedateoverride,
    defaultDate: request.wmkf_reviewduedate,
  });
  let preparedReviewDue = null;
  if (kind === 'reviewdue') {
    const eligibility = evaluateReviewDueReminderEligibility({
      row: effectiveRow,
      effectiveReviewDueDate: reviewDueDate,
    });
    if (!eligibility.eligible) {
      recordReviewDueBlock(result, eligibility.reason, { manual: Boolean(authorizeClaim) });
      return;
    }
    try {
      preparedReviewDue = renderReviewDueReminder({
        subjectTemplate,
        bodyTemplate,
        reviewerName: reviewer.wmkf_name || null,
        title: request.akoya_title,
        reviewDueDate,
        signatureBlock,
      });
    } catch (e) {
      // Validate editable reminder content before the irreversible fire-once claim.
      result.prepareFailed++;
      result.errors.push({ id, message: String(e.message || e).slice(0, 240) });
      return;
    }
  }
  const claimPatch = kind === 'respond'
    ? { wmkf_respondremindersentat: nowIso }
    : {
        wmkf_remindersentat: nowIso,
        wmkf_remindercount: (Number.isInteger(effectiveRow.wmkf_remindercount) ? effectiveRow.wmkf_remindercount : 0) + 1,
      };

  // Single ETag-guarded claim BEFORE the email send (at-most-once). Respond reminders
  // persist marker+token together. Review-due reminders persist only the marker/count,
  // so routine follow-up cannot invalidate an open review session. A 412 means a
  // concurrent write landed first: skip without sending.
  let url;
  try {
    if (kind === 'respond') {
      ({ url } = await mintAndStore({
        suggestionId: id,
        requestId: request.akoya_requestid,
        expiresAt: computeReviewerTokenExpiry({ accepted: false, reviewDueDate }),
        actingUserSystemId,
        ifMatch: claimIfMatch,
        writeFields: claimPatch,
      }));
    } else {
      await claimReviewDueReminder({ id, claimPatch, claimIfMatch, actingUserSystemId });
    }
  } catch (e) {
    if (e?.status === 412) {
      result.claimFailed++;
      return;
    }
    result.prepareFailed++;
    result.errors.push({ id, message: String(e.message || e).slice(0, 240) });
    return;
  }

  try {
    const reviewerName = reviewer.wmkf_name || null;
    const { subject, html } = kind === 'respond'
      ? reviewedContent
        ? renderRespondReminderFromBodyText({
            ...reviewedContent,
            url,
            automationNotice: {
              senderName: signatureBlock?.name || pd.fullname,
              senderEmail: signatureBlock?.email || pd.internalemailaddress,
              kind: 'reminder',
            },
          })
        : renderRespondReminder({ subjectTemplate, bodyTemplate, reviewerName, title: request.akoya_title, signatureBlock, url })
      : preparedReviewDue;

    await DynamicsService.createAndSendEmail({
      subject,
      body: html,
      from: pd.internalemailaddress,
      to: reviewer.wmkf_emailaddress,
      regardingId: request.akoya_requestid,
      regardingType: 'akoya_request',
      actingUserSystemId: pd.systemuserid,
      noFallback: true,
    });
    result.sent++;
  } catch (e) {
    // Marker + token already landed (at-most-once); record the delivery failure
    // but do not roll back the marker because a duplicate nudge is worse than a miss.
    result.sendFailed++;
    result.errors.push({ id, message: String(e.message || e).slice(0, 240) });
  }
}

/** Run both sweeps; returns a combined summary. */
export async function sweepReviewerReminders({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const respond = await sweepRespondReminders({ maxBatch, dryRun, actingUserSystemId });
  const reviewDue = await sweepReviewDueReminders({ maxBatch, dryRun, actingUserSystemId });
  return { respond, reviewDue };
}
