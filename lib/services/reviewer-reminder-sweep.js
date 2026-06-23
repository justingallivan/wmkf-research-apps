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
 *                 = the request's wmkf_reviewduedate - leadDays. Marker: wmkf_remindersentat
 *                 (the existing review-due/follow-up marker — automates the manual followup).
 *
 * Each reminder re-mints a fresh token (latest-link-wins) so the email carries a live link;
 * the expiry follows the Phase-2 policy (computeReviewerTokenExpiry — capped for the
 * non-accepted respond reminder, long for the accepted review-due reminder).
 *
 * Both are gated per-request by the campaign-config enabled flag; a request with the flag
 * off (or null) is skipped. Designed for cron use (bounded batches, fail-soft per row).
 */

import { DynamicsService } from './dynamics-service.js';
import { mintAndStore } from '../external/token-lifecycle.js';
import { computeReviewerTokenExpiry } from '../external/reviewer-token-ttl.js';
import { resolveSignatureForRequest } from './email-signature.js';
import { renderRespondReminder, renderReviewDueReminder } from '../external/reviewer-reminder-email.js';
import { notExcludedFilter } from '../dataverse/adapters/reviewer-suggestion.js';
import { readRequiredEmailDefaults } from './email-defaults.js';

const SUGGESTION_SET = 'wmkf_appreviewersuggestions';
const DAY_MS = 24 * 60 * 60 * 1000;
const RESPOND_SUBJECT_KEY = 'email.reviewer_reminder_respond_by.subject';
const RESPOND_BODY_KEY = 'email.reviewer_reminder_respond_by.body';
const REVIEW_DUE_SUBJECT_KEY = 'email.reviewer_reminder_review_due.subject';
const REVIEW_DUE_BODY_KEY = 'email.reviewer_reminder_review_due.body';

const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const REVIEW_STATUS_UNDER_REVIEW = 100000002;

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title',
  '_wmkf_programdirector_value',
  'wmkf_respondoffsetdays', 'wmkf_respondreminderenabled', 'wmkf_respondreminderleaddays',
  'wmkf_reviewduedate', 'wmkf_reviewduereminderenabled', 'wmkf_reviewduereminderleaddays',
].join(',');

function emptyResult(dryRun) {
  return { scanned: 0, eligible: 0, sent: 0, skipped: 0, skippedMisconfigured: 0, claimFailed: 0, sendFailed: 0, errors: [], dryRun };
}

/**
 * Load + cache per-request context: config, PD sender (email + systemuserid), signature.
 * Returns null when the request/PD can't be resolved (caller skips the row).
 */
async function loadRequestContext(requestId, cache) {
  if (cache.has(requestId)) return cache.get(requestId);
  let ctx = null;
  try {
    const request = await DynamicsService.getRecord('akoya_requests', requestId, { select: REQUEST_SELECT });
    if (request?.akoya_requestid) {
      let pd = null;
      const pdGuid = request._wmkf_programdirector_value;
      if (pdGuid) {
        pd = await DynamicsService.getRecord('systemusers', pdGuid, {
          select: 'systemuserid,internalemailaddress,isdisabled',
        }).catch(() => null);
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

async function loadReviewer(personId) {
  if (!personId) return null;
  return DynamicsService.getRecord('wmkf_potentialreviewerses', personId, {
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

  // Invited, emailed, no response yet, not already respond-reminded, not excluded.
  const { records } = await DynamicsService.queryAllRecords(SUGGESTION_SET, {
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_emailsentat,wmkf_externaltokenexpires',
    filter: `wmkf_invited eq true and wmkf_emailsentat ne null `
      + `and (wmkf_accepted eq false or wmkf_accepted eq null) `
      + `and (wmkf_declined eq false or wmkf_declined eq null) `
      + `and wmkf_responsetype eq null and wmkf_respondremindersentat eq null and ${notExcludedFilter()}`,
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
  const result = emptyResult(dryRun);
  const emailDefaults = await readRequiredEmailDefaults([REVIEW_DUE_SUBJECT_KEY, REVIEW_DUE_BODY_KEY], {
    source: 'reviewer-reminders-review-due',
  });

  // Accepted, materials sent (or under review), not yet submitted, not already review-due
  // reminded (wmkf_remindersentat null — shared with the manual followup so the two never
  // double-nudge), not excluded.
  //
  // RESIDUAL (Codex finding #3, deferred): this cron claims wmkf_remindersentat BEFORE
  // send (If-Match), but the manual followup in send-emails stamps it AFTER send. So a
  // manual followup running in the same ~minute as this daily cron, OR a manual followup
  // whose post-send lifecycle stamp fails, can leave a row cron-eligible and produce one
  // extra nudge. Accepted as low-risk (manual followups are rare and staff-initiated; the
  // cron runs once daily) — fixing it means reordering the manual followup to claim-first,
  // which is out of Phase-3 scope. Documented in the spec §3.B and the Atlas.
  const { records } = await DynamicsService.queryAllRecords(SUGGESTION_SET, {
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_remindercount',
    filter: `wmkf_accepted eq true `
      + `and (wmkf_reviewstatus eq ${REVIEW_STATUS_MATERIALS_SENT} or wmkf_reviewstatus eq ${REVIEW_STATUS_UNDER_REVIEW}) `
      + `and wmkf_reviewreceivedat eq null and wmkf_remindersentat eq null and ${notExcludedFilter()}`,
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
    const dueYmd = request.wmkf_reviewduedate || null;
    if (!enabled || !dueYmd) { result.skipped++; continue; }

    // Fire at review-due - lead. End-of-day on the due date.
    const dueMs = Date.parse(`${dueYmd}T23:59:59Z`);
    if (!Number.isFinite(dueMs) || now < dueMs - lead * DAY_MS) { result.skipped++; continue; }

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
 * Claim (conditional marker write), mint a fresh token, render, and send one reminder.
 * Claim-before-send: if the conditional write loses (412 / stale etag) we skip without
 * sending; if the send fails after a successful claim we log (at-most-once).
 */
async function sendOneReminder({ kind, subjectTemplate, bodyTemplate, row, request, pd, signatureBlock, reviewer, actingUserSystemId, result }) {
  const id = row.wmkf_appreviewersuggestionid;
  const nowIso = new Date().toISOString();

  // Fail closed when the ETag is missing (Codex finding #2): without it the claim would
  // degrade to an UNCONDITIONAL write and silently lose its concurrency guarantee. Skip
  // rather than send under a claim we couldn't make atomic.
  if (!row._etag) { result.claimFailed++; return; }

  // 1. Claim via If-Match so only one writer proceeds.
  const claimPatch = kind === 'respond'
    ? { wmkf_respondremindersentat: nowIso }
    : { wmkf_remindersentat: nowIso, wmkf_remindercount: (Number.isInteger(row.wmkf_remindercount) ? row.wmkf_remindercount : 0) + 1 };
  try {
    await DynamicsService.updateRecord(SUGGESTION_SET, id, claimPatch, {
      // queryAllRecords surfaces the OData ETag as `_etag` (dynamics-service strips
      // `@odata.etag` → `_etag`). Same field the grantee reminder cron claims on.
      ifMatch: row._etag,
      actingUserSystemId,
    });
  } catch (e) {
    // 412 = another run claimed it, or the row changed underneath us. Don't send.
    result.claimFailed++;
    return;
  }

  // 2. Mint a fresh token (latest-link-wins). Expiry per Phase-2 policy: capped for the
  //    non-accepted respond reminder, long for the accepted review-due reminder.
  try {
    const { url } = await mintAndStore({
      suggestionId: id,
      requestId: request.akoya_requestid,
      expiresAt: computeReviewerTokenExpiry({
        accepted: kind === 'reviewdue',
        reviewDueDate: request.wmkf_reviewduedate || null,
      }),
      actingUserSystemId,
    });
    const reviewerName = reviewer.wmkf_name || null;
    const { subject, html } = kind === 'respond'
      ? renderRespondReminder({ subjectTemplate, bodyTemplate, reviewerName, title: request.akoya_title, signatureBlock, url })
      : renderReviewDueReminder({ subjectTemplate, bodyTemplate, reviewerName, title: request.akoya_title, reviewDueDate: request.wmkf_reviewduedate, signatureBlock, url });

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
    // Claim already landed (at-most-once); record the failure but do NOT roll back the
    // marker — a duplicate nudge is worse than a missed one.
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
