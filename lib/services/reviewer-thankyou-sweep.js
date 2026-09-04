/**
 * Reviewer thank-you sweep (reviewer-engagement thank-you automation).
 *
 * A daily, fire-once, claim-before-send sweep that emails every reviewer whose
 * review was RECEIVED (`wmkf_reviewreceivedat` set) but who has not yet been
 * thanked (`wmkf_thankyousentat` null), using the seeded 'thankyou' template —
 * with a courtesy DOCX copy of their OWN submitted review attached as real file
 * bytes (never staged in Blob).
 *
 * Structure + idempotency posture mirror `reviewer-reminder-sweep.js` exactly
 * (evidence: that file's sendOneReminder, lines 247-307):
 *   - Eligibility keys on `wmkf_reviewreceivedat ne null` — NOT the review-status
 *     picklist (the submit route now sets status=100000003 at submission, so the
 *     received-at timestamp is the durable "review is in" signal).
 *   - Claim-before-send, at-most-once: fetch rows WITH _etag; fail closed if the
 *     _etag is missing; claim by stamping `wmkf_thankyousentat` via an If-Match
 *     conditional write; 412 → claimFailed++, skip; a post-claim send failure is
 *     recorded (sendFailed++) but the marker is NOT rolled back and the send is
 *     NOT retried. This is the owner-approved acceptance-confirmation posture — a
 *     dropped thank-you is better than a duplicate.
 *   - The attachment is built BEFORE the claim. If compose/render throws, no
 *     marker is written and no email is sent, so the next sweep can retry the
 *     complete thank-you. The claim still precedes the irreversible email send.
 *
 * Interaction with the manual thank-you send (send-emails.js `thankyou` branch,
 * which also stamps `wmkf_thankyousentat`): a manually-thanked reviewer is
 * already marked, so this sweep naturally skips them; and because the sweep
 * claims the same marker, the manual modal's deliberate re-send path is unchanged
 * (matches the reminder semantics).
 */

import { DynamicsService } from './dynamics-service.js';
import { renderThankYou } from '../external/reviewer-reminder-email.js';
import { notExcludedFilter, patchReviewReceipt, queryAllSuggestions } from '../dataverse/adapters/reviewer-suggestion.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { preflightReviewDocxTemplates } from './review-documents/docx-renderer.js';
import { buildIndividualReviewDocx } from './review-documents/individual-review-builder.js';
// Reuse the reminder sweep's per-request context/reviewer loaders verbatim so the
// PD sender + signature + reviewer-email resolution stay a single code path.
import { loadRequestContext, loadReviewer } from './reviewer-reminder-sweep.js';

export const THANKYOU_SUBJECT_KEY = 'email.reviewer_thankyou.subject';
export const THANKYOU_BODY_KEY = 'email.reviewer_thankyou.body';

function emptyResult(dryRun) {
  return {
    scanned: 0, eligible: 0, sent: 0, skipped: 0, skippedMisconfigured: 0,
    claimFailed: 0, sendFailed: 0, attachmentFailed: 0, errors: [], dryRun,
  };
}

/**
 * Build the courtesy DOCX, claim (conditional marker write), render, and send one
 * thank-you. A document failure remains retryable because it occurs before the
 * claim; a lost If-Match (412) skips without sending; a send failure after a
 * successful claim is logged, never retried.
 */
export async function sendOneThankYou({ subjectTemplate, bodyTemplate, row, request, pd, signatureBlock, reviewer, actingUserSystemId, result }) {
  const id = row.wmkf_appreviewersuggestionid;
  const nowIso = new Date().toISOString();

  // Fail closed when the ETag is missing (mirrors sendOneReminder): without it the
  // claim would degrade to an UNCONDITIONAL write and lose its concurrency guarantee.
  if (!row._etag) { result.claimFailed++; return; }

  // 1. Build the complete attachment before claiming. If generation fails, leave
  //    the row eligible so a later sweep can retry the whole delivery.
  let attachments;
  try {
    attachments = [await buildIndividualReviewDocx({
      suggestionId: id,
      reviewer,
      request,
      row,
      generatedAtIso: nowIso,
    })];
  } catch (e) {
    result.attachmentFailed++;
    result.errors.push({ id, message: `attachment: ${String(e.message || e).slice(0, 200)}` });
    return;
  }

  // 2. Claim via If-Match so only one writer proceeds.
  try {
    await patchReviewReceipt(id, { wmkf_thankyousentat: nowIso }, {
      ifMatch: row._etag,
      actingUserSystemId,
    });
  } catch (e) {
    // 412 = another run/manual send claimed it, or the row changed underneath us.
    result.claimFailed++;
    return;
  }

  // 3. Render + send the thank-you from the PD.
  try {
    const { subject, html } = renderThankYou({
      subjectTemplate,
      bodyTemplate,
      reviewerName: reviewer.wmkf_name || null,
      title: request.akoya_title,
      signatureBlock,
      senderName: pd.fullname,
      senderEmail: pd.internalemailaddress,
    });
    await DynamicsService.createAndSendEmail({
      subject,
      body: html,
      from: pd.internalemailaddress,
      to: reviewer.wmkf_emailaddress,
      regardingId: request.akoya_requestid,
      regardingType: 'akoya_request',
      attachments,
      actingUserSystemId: pd.systemuserid,
      noFallback: true,
    });
    result.sent++;
  } catch (e) {
    // Claim already landed (at-most-once); record the failure but do NOT roll back
    // the marker — a duplicate thank-you is worse than a missed one.
    result.sendFailed++;
    result.errors.push({ id, message: String(e.message || e).slice(0, 240) });
  }
}

/**
 * Thank-you sweep. Received-not-yet-thanked reviewers with a usable email.
 */
export async function sweepReviewThankYous({ maxBatch = 200, dryRun = false, actingUserSystemId = null } = {}) {
  const result = emptyResult(dryRun);
  const emailDefaults = await readRequiredEmailDefaults([THANKYOU_SUBJECT_KEY, THANKYOU_BODY_KEY], {
    source: 'reviewer-thankyous',
  });

  // Review received, not yet thanked, not excluded. Eligibility keys on
  // wmkf_reviewreceivedat (NOT the status picklist — see module header).
  const { records } = await queryAllSuggestions({
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_reviewreceivedat,wmkf_reviewertitle,wmkf_revieweraffiliation,wmkf_honorariumoptout',
    filter: `wmkf_reviewreceivedat ne null and wmkf_thankyousentat eq null and ${notExcludedFilter()}`,
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
  if (!dryRun) {
    try {
      await preflightReviewDocxTemplates(['individual']);
    } catch (error) {
      result.skipped += records.length;
      result.skippedMisconfigured += records.length;
      result.errors.push({
        id: null,
        message: `review DOCX template misconfigured: ${String(error.message || error).slice(0, 200)}`,
      });
      return result;
    }
  }

  const requestCache = new Map();
  // maxBatch bounds irreversible CLAIMS (marker writes), not just successful sends
  // — a send/attachment outage must not let one run stamp far more than maxBatch
  // rows as thanked (same rationale as the reminder sweep, Codex Phase-3 finding #1).
  let attempted = 0;
  for (const row of records) {
    if (attempted >= maxBatch) { result.skipped++; continue; }
    const ctx = await loadRequestContext(row._wmkf_request_value, requestCache);
    if (!ctx) { result.skipped++; continue; }
    const { request, pd, signatureBlock } = ctx;

    // Thank-you is unconditional (no per-request opt-in): just need a PD sender
    // and a usable reviewer email.
    if (!pd?.internalemailaddress || !pd?.systemuserid) { result.skipped++; continue; }
    const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
    if (!reviewer?.wmkf_emailaddress) { result.skipped++; continue; }

    result.eligible++;
    if (dryRun) continue;

    attempted++;
    await sendOneThankYou({
      subjectTemplate: emailDefaults.values[THANKYOU_SUBJECT_KEY],
      bodyTemplate: emailDefaults.values[THANKYOU_BODY_KEY],
      row, request, pd, signatureBlock, reviewer,
      actingUserSystemId, result,
    });
  }
  return result;
}
