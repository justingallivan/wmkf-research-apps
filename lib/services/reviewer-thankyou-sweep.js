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
 *   - The attachment is NON-FATAL: if compose/render throws, the thank-you still
 *     sends WITHOUT the DOCX and the row counts as attachmentFailed. The claim has
 *     already landed; a missing courtesy copy must not suppress the thanks.
 *
 * Interaction with the manual thank-you send (send-emails.js `thankyou` branch,
 * which also stamps `wmkf_thankyousentat`): a manually-thanked reviewer is
 * already marked, so this sweep naturally skips them; and because the sweep
 * claims the same marker, the manual modal's deliberate re-send path is unchanged
 * (matches the reminder semantics).
 */

import { DynamicsService } from './dynamics-service.js';
import { renderThankYou } from '../external/reviewer-reminder-email.js';
import { notExcludedFilter } from '../dataverse/adapters/reviewer-suggestion.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { fetchAnswersBySuggestion } from './review-answers.js';
import { composeSingleReviewCopy } from '../../shared/utils/review-report.js';
import { generateSingleReviewCopyDocx } from '../../shared/utils/review-report-docx.js';
// Reuse the reminder sweep's per-request context/reviewer loaders verbatim so the
// PD sender + signature + reviewer-email resolution stay a single code path.
import { SUGGESTION_SET, loadRequestContext, loadReviewer } from './reviewer-reminder-sweep.js';

export const THANKYOU_SUBJECT_KEY = 'email.reviewer_thankyou.subject';
export const THANKYOU_BODY_KEY = 'email.reviewer_thankyou.body';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function emptyResult(dryRun) {
  return {
    scanned: 0, eligible: 0, sent: 0, skipped: 0, skippedMisconfigured: 0,
    claimFailed: 0, sendFailed: 0, attachmentFailed: 0, errors: [], dryRun,
  };
}

/**
 * Build the courtesy DOCX copy of one reviewer's own review. Returns an
 * attachments array ([] on failure — the caller treats a failure as non-fatal
 * and sends the thank-you without the copy).
 */
async function buildReviewCopyAttachment({ suggestionId, reviewer, request, generatedAtIso }) {
  const answersBySuggestion = await fetchAnswersBySuggestion([suggestionId]);
  const answers = answersBySuggestion[suggestionId] || [];
  const copy = composeSingleReviewCopy({
    reviewerName: reviewer.wmkf_name || null,
    requestNumber: request.akoya_requestnum || null,
    requestTitle: request.akoya_title || null,
    generatedAtIso,
    answers,
  });
  const content = await generateSingleReviewCopyDocx(copy);
  const filename = `Review-${request.akoya_requestnum || 'copy'}.docx`;
  return [{ filename, contentType: DOCX_CONTENT_TYPE, content }];
}

/**
 * Claim (conditional marker write), build the courtesy DOCX (non-fatal), render,
 * and send one thank-you. Claim-before-send: a lost If-Match (412) skips without
 * sending; a send failure after a successful claim is logged, never retried.
 */
export async function sendOneThankYou({ subjectTemplate, bodyTemplate, row, request, pd, signatureBlock, reviewer, actingUserSystemId, result }) {
  const id = row.wmkf_appreviewersuggestionid;
  const nowIso = new Date().toISOString();

  // Fail closed when the ETag is missing (mirrors sendOneReminder): without it the
  // claim would degrade to an UNCONDITIONAL write and lose its concurrency guarantee.
  if (!row._etag) { result.claimFailed++; return; }

  // 1. Claim via If-Match so only one writer proceeds.
  try {
    await DynamicsService.updateRecord(SUGGESTION_SET, id, { wmkf_thankyousentat: nowIso }, {
      ifMatch: row._etag,
      actingUserSystemId,
    });
  } catch (e) {
    // 412 = another run/manual send claimed it, or the row changed underneath us.
    result.claimFailed++;
    return;
  }

  // 2. Build the courtesy DOCX copy of the reviewer's own review. NON-FATAL: the
  //    claim already landed, so a compose/render failure must not suppress the
  //    thank-you — send it without the attachment and count attachmentFailed.
  let attachments = [];
  try {
    attachments = await buildReviewCopyAttachment({ suggestionId: id, reviewer, request, generatedAtIso: nowIso });
  } catch (e) {
    result.attachmentFailed++;
    result.errors.push({ id, message: `attachment: ${String(e.message || e).slice(0, 200)}` });
    attachments = [];
  }

  // 3. Render + send the thank-you from the PD.
  try {
    const { subject, html } = renderThankYou({
      subjectTemplate,
      bodyTemplate,
      reviewerName: reviewer.wmkf_name || null,
      title: request.akoya_title,
      signatureBlock,
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
  const { records } = await DynamicsService.queryAllRecords(SUGGESTION_SET, {
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,_wmkf_request_value',
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
