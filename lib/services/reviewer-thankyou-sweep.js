/**
 * Reviewer thank-you sweep (reviewer-engagement thank-you automation).
 *
 * A daily, fire-once, claim-before-send sweep that emails every reviewer whose
 * review was RECEIVED (`wmkf_reviewreceivedat` set) but who has not yet been
 * thanked (`wmkf_thankyousentat` null), using the seeded 'thankyou' template —
 * with a courtesy DOCX copy of their OWN submitted review attached as real file
 * bytes (never staged in Blob).
 *
 * Own defaults are resolved once per exact PD per run. Unknown own state pauses
 * that PD without claiming; confirmed absence alone inherits shared Admin copy.
 * Complete rendering/validation and required DOCX preparation precede If-Match
 * claim. Missing ETag/412 never sends. After-claim failure is never auto-retried.
 * This fences overlapping automatic sweeps, not callable legacy manual sends:
 * their independent post-send bookkeeping still writes the same marker.
 */

import { DynamicsService } from './dynamics-service.js';
import { isGuid } from '../utils/guid.js';
import { isConcreteEtag } from '../utils/etag.js';
import { ownReviewerThankYouTemplate } from './reviewer-thankyou-personalization.js';
import { validateReviewerThankYouTemplate } from '../../shared/config/reviewerThankYouEmail.js';
import { renderThankYou, buildThankYouBodyText } from '../external/reviewer-reminder-email.js';
import { claimThankYou, notExcludedFilter, queryAllSuggestions } from '../dataverse/adapters/reviewer-suggestion.js';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { preflightReviewDocxTemplates } from './review-documents/docx-renderer.js';
import { buildIndividualReviewDocx } from './review-documents/individual-review-builder.js';
// Reuse the reminder sweep's per-request context/reviewer loaders verbatim so the
// PD sender + signature + reviewer-email resolution stay a single code path.
import { loadRequestContext, loadReviewer } from './reviewer-reminder-sweep.js';
import { classifyEmailDispatchError } from '../../shared/utils/email-send-outcome.js';
import { createRequestTestStateLookup, recordTestRequestSkip } from './test-requests/request-test-state.js';

export const THANKYOU_SUBJECT_KEY = 'email.reviewer_thankyou.subject';
export const THANKYOU_BODY_KEY = 'email.reviewer_thankyou.body';

function emptyResult(dryRun) {
  return {
    scanned: 0, eligible: 0, sent: 0, skipped: 0, skippedMisconfigured: 0,
    claimFailed: 0, sendFailed: 0, sendUnconfirmed: 0, attachmentFailed: 0, errors: [], dryRun,
  };
}

/** Pure pre-claim preparation shared by real and dry runs. Never writes or sends. */
export function prepareReviewerThankYou({ subjectTemplate, bodyTemplate, source = 'shared', row, request, pd, signatureBlock, reviewer }) {
  if (!isConcreteEtag(row?._etag)) return { ok: false, reason: 'missing_etag' };
  if (!['shared', 'personal'].includes(source)) return { ok: false, reason: 'preference_invalid' };
  if (source === 'personal' && !validateReviewerThankYouTemplate({ subject: subjectTemplate, body: bodyTemplate }).valid) return { ok: false, reason: 'preference_invalid' };
  try {
    const input = { subjectTemplate, bodyTemplate, reviewerName: reviewer.wmkf_name || null,
      title: request.akoya_title, signatureBlock, senderName: pd.fullname, senderEmail: pd.internalemailaddress };
    const body = buildThankYouBodyText(input);
    const { subject, html } = renderThankYou(input);
    if (!subject.trim() || !body.trim()) return { ok: false, reason: 'rendered_copy_invalid' };
    if (subject.length > 2000 || /[\r\n]/.test(subject) || body.length > 100000) return { ok: false, reason: 'rendered_context_invalid' };
    return { ok: true, subject, html };
  } catch { return { ok: false, reason: 'rendered_copy_invalid' }; }
}

/** New preparation diagnostics are grouped/capped; counts never stop at the cap. */
function recordPreparationRefusal(result, row, pd, reason) {
  if (reason === 'missing_etag') { result.claimFailed++; return; }
  result.skipped++; result.skippedMisconfigured++;
  const owner = String(pd?.systemuserid || '').toLowerCase();
  const id = row.wmkf_appreviewersuggestionid;
  const found = result.errors.find(error => error.pdSystemUserId === owner && error.reason === reason);
  if (found) {
    found.affectedCount++;
    if (found.sampleIds.length < 10) found.sampleIds.push(id);
  } else if (result.errors.filter(error => error.pdSystemUserId !== undefined).length < 100) {
    result.errors.push({ id, pdSystemUserId: owner, reason, affectedCount: 1, sampleIds: [id], message: `Automatic thank-you paused: ${reason}.` });
  }
}

/** Prepare exact copy + required DOCX, then claim and send. No work after claim
 * may re-read defaults or re-render/rebuild the message. */
export async function sendOneThankYou({ subjectTemplate, bodyTemplate, source = 'shared', row, request, pd, signatureBlock, reviewer, actingUserSystemId, result }) {
  const id = row.wmkf_appreviewersuggestionid;
  const nowIso = new Date().toISOString();

  const prepared = prepareReviewerThankYou({ subjectTemplate, bodyTemplate, source, row, request, pd, signatureBlock, reviewer });
  if (!prepared.ok) { recordPreparationRefusal(result, row, pd, prepared.reason); return; }

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
    await claimThankYou(id, nowIso, {
      ifMatch: row._etag,
      actingUserSystemId,
    });
  } catch (e) {
    // 412 = another automatic run or another writer changed the row.
    result.claimFailed++;
    return;
  }

  // 3. Send exactly the already-prepared message from the server-resolved PD.
  try {
    const { subject, html } = prepared;
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
    const classification = classifyEmailDispatchError(e);
    if (classification.outcome === 'uncertain') result.sendUnconfirmed++;
    else result.sendFailed++;
    result.errors.push({ id, outcome: classification.outcome, message: String(e.message || e).slice(0, 240) });
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

  const requestTestState = createRequestTestStateLookup();
  const requestCache = new Map();
  const senderTemplates = new Map();
  // maxBatch bounds irreversible CLAIMS (marker writes), not just successful sends
  // — a send/attachment outage must not let one run stamp far more than maxBatch
  // rows as thanked (same rationale as the reminder sweep, Codex Phase-3 finding #1).
  let attempted = 0;
  for (const row of records) {
    if (attempted >= maxBatch) { result.skipped++; continue; }
    // Scheduled jobs never act on test requests (Test Request Factory Stage 1c):
    // skipped before any request read, claim, token mint or send.
    const testState = await requestTestState(row._wmkf_request_value);
    if (testState.kind !== 'ordinary') { recordTestRequestSkip(result, testState); continue; }
    const ctx = await loadRequestContext(row._wmkf_request_value, requestCache);
    if (!ctx) { result.skipped++; continue; }
    const { request, pd, signatureBlock } = ctx;

    // Thank-you is unconditional (no per-request opt-in): just need a PD sender
    // and a usable reviewer email.
    if (!pd?.internalemailaddress || !pd?.systemuserid) { result.skipped++; continue; }
    const reviewer = await loadReviewer(row._wmkf_potentialreviewer_value);
    if (!reviewer?.wmkf_emailaddress) { result.skipped++; continue; }

    if (!isGuid(pd.systemuserid)) { recordPreparationRefusal(result, row, pd, 'identity_unavailable'); continue; }
    result.eligible++;
    const owner = pd.systemuserid.toLowerCase();
    if (!senderTemplates.has(owner)) senderTemplates.set(owner, ownReviewerThankYouTemplate(owner));
    const own = await senderTemplates.get(owner);
    if (!['configured', 'absent'].includes(own.status)) {
      recordPreparationRefusal(result, row, pd, `preference_${own.status}`); continue;
    }
    const template = own.status === 'configured' ? own.template : {
      subject: emailDefaults.values[THANKYOU_SUBJECT_KEY], body: emailDefaults.values[THANKYOU_BODY_KEY],
    };
    const input = { subjectTemplate: template.subject, bodyTemplate: template.body,
      source: own.status === 'configured' ? 'personal' : 'shared', row, request, pd, signatureBlock, reviewer };
    if (dryRun) {
      const prepared = prepareReviewerThankYou(input);
      if (!prepared.ok) recordPreparationRefusal(result, row, pd, prepared.reason);
      continue;
    }
    attempted++;
    await sendOneThankYou({ ...input, actingUserSystemId, result });
  }
  return result;
}
