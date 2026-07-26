/**
 * Shared review-upload core. Used by both the external (token-authenticated)
 * and staff (session-authenticated) endpoints. The two endpoints differ only
 * in how they identify the suggestion (token payload vs. request body) and
 * what `source` they tag — the actual file-handling and Dataverse writes are
 * one code path so the two flows can never drift.
 *
 * Behavior:
 *   1. Read the suggestion + expanded request to derive the SharePoint folder
 *      pattern (`{requestNumber}_{guidNoHyphensUpper}`).
 *   2. Validate all files (extension, magic bytes, per-file size, count).
 *   3. Validate structured form data against `reviewFormSchema`.
 *   4. Upload each attempt to its own SharePoint subfolder beneath the reviewer
 *      folder. Track item ids as we go so we can roll back only that attempt if
 *      a later step fails.
 *   5. PATCH the suggestion row with the new field values (folder, primary
 *      filename, received-at, picklists, affiliation, staff flag).
 *
 * On failure after the first SharePoint write, attempt best-effort cleanup
 * of the files we just wrote. If cleanup itself fails, log loudly — staff
 * may need to remove orphan files manually.
 */

import crypto from 'crypto';
import { GraphService } from './graph-service.js';
import { scanBytes } from './cloudmersive-scan.js';
import { validateReviewForm } from '../external/review-form-schema.js';
import { getAuthoritativeQuestionSet } from '../external/review-question-fetcher.js';
import { buildMultiselectSnapshotRows, buildRatingSnapshotRows } from '../external/review-answer-snapshot.js';
import { validateReviewFile } from '../utils/file-magic.js';
import { isVirusScanEnabled } from '../utils/virus-scan-config.js';
import { extendForPostSubmissionWindow } from '../external/token-lifecycle.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';
import { resolveProgramDirectorEmailForRequest } from './program-director-resolver.js';
import NotificationService from './notification-service.js';
import { cleanupSharePointItems } from './sharepoint-cleanup.js';
import { getForExternalVerification, patchReviewReceipt, ENTITY_SET_NAME as SUGGESTION_ENTITY_SET } from '../dataverse/adapters/reviewer-suggestion.js';
import { answerUpsertDescriptor } from '../dataverse/adapters/review-answer.js';
import { runChangeset, atomicParentWithChildren } from '../dataverse/core/changeset.js';
import {
  authorizeReviewReceipt,
  classifyReviewReceiptConflict,
  isReviewReceiptPreconditionFailure,
  ReviewReceiptEligibilityError,
} from './review-receipt-guard.js';

const REVIEW_LIBRARY = 'akoya_request';
const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
// wmkf_reviewstatus picklist value for "materials_sent" (REVIEW_STATUS_MAP in
// lib/dataverse/adapters/reviewer-suggestion.js; mirrored in external context.js).
// A reviewer may only upload once materials have been released (status >= this).
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
// Post-accept terminal statuses sit numerically ABOVE materials_sent, so the
// `status < MATERIALS_SENT` gate below would let a withdrawn/released reviewer
// keep uploading (Codex S369 adversarial finding, confirmed). Rejected
// explicitly rather than by magnitude.
const TERMINAL_REVIEW_STATUSES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

/**
 * Write review files to SharePoint and update the suggestion row.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID of the wmkf_appreviewersuggestion row
 * @param {Array<{ filename: string, buffer: Buffer }>} args.files - 1..MAX_FILES files
 * @param {Object} args.structuredData - Raw form values keyed by `field.key`
 * @param {Object} args.opts
 * @param {'reviewer_self_token'|'staff_upload'} args.opts.source
 * @param {string|null} [args.opts.performedBy] - Profile id (staff endpoint) or null (token endpoint)
 * @param {string|null} [args.opts.actingUserSystemId] - Dynamics systemuserid for
 *   `MSCRMCallerID` attribution. Set on staff_upload from the session; null on
 *   reviewer_self_token (no Dynamics user behind the JWT).
 * @returns {Promise<{ ok: true, folder: string, files: Array<{ name, id, webUrl, size }>, dataverseValues: Object }
 *                  | { ok: false, reason: 'validation', errors: string[] }
 *                  | { ok: false, reason: 'not_found' }
 *                  | { ok: false, reason: 'infected', errors: string[] }
 *                  | { ok: false, reason: 'scan_misconfigured' }
 *                  | { ok: false, reason: 'scan_unavailable' }
 *                  | { ok: false, reason: 'sharepoint_failed', error: string, partial?: Array }
 *                  | { ok: false, reason: 'dataverse_failed', error: string, cleanedUp: boolean }>}
 */
export async function writeReviewFiles({ suggestionId, files, structuredData, opts }) {
  // ── 1. Argument shape ─────────────────────────────────────────────────
  if (!suggestionId || typeof suggestionId !== 'string') {
    return { ok: false, reason: 'validation', errors: ['suggestionId required'] };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: 'validation', errors: ['at least one file required'] };
  }
  if (files.length > MAX_FILES) {
    return { ok: false, reason: 'validation', errors: [`max ${MAX_FILES} files per upload`] };
  }
  if (!opts || (opts.source !== 'reviewer_self_token' && opts.source !== 'staff_upload')) {
    return { ok: false, reason: 'validation', errors: ['opts.source must be reviewer_self_token or staff_upload'] };
  }

  // ── 2. File validation (size + magic bytes) ───────────────────────────
  const fileErrors = [];
  for (const [idx, f] of files.entries()) {
    if (!f || typeof f.filename !== 'string' || !Buffer.isBuffer(f.buffer)) {
      fileErrors.push(`file[${idx}]: must have filename (string) and buffer (Buffer)`);
      continue;
    }
    if (f.buffer.length === 0) {
      fileErrors.push(`${f.filename}: empty file`);
      continue;
    }
    if (f.buffer.length > MAX_FILE_BYTES) {
      fileErrors.push(`${f.filename}: exceeds ${MAX_FILE_BYTES} bytes`);
      continue;
    }
    const v = validateReviewFile(f.filename, f.buffer);
    if (!v.ok) {
      fileErrors.push(`${f.filename}: ${v.reason}`);
    } else {
      f._type = v.type;
    }
  }
  if (fileErrors.length > 0) {
    return { ok: false, reason: 'validation', errors: fileErrors };
  }

  // ── 3. Structured data validation ─────────────────────────────────────
  // Validate against the LIVE question set (fail-closed) so a staff-edited
  // rating domain/order is honoured exactly as the reviewer submit path does.
  // Authoritative (uncached) resolve: write boundary — this set decides which
  // rating snapshot rows get persisted.
  const questionSet = await getAuthoritativeQuestionSet();
  const formResult = validateReviewForm(structuredData, { fields: questionSet });
  if (!formResult.ok) {
    return { ok: false, reason: 'validation', errors: formResult.errors };
  }

  // ── 3.5. Virus scan (gated on VIRUS_SCAN_ENABLED) ─────────────────────
  // Runs after file + form validation so we don't spend scanner quota on
  // uploads the app will reject anyway. Runs BEFORE folder resolution /
  // SharePoint upload so an infected file never produces a SharePoint write
  // that has to be rolled back. Fail-closed: when scanning is enabled, a
  // scanner outage or misconfiguration blocks the upload (operator opted
  // in via env flag and accepted the scanner as gatekeeper).
  if (isVirusScanEnabled()) {
    const scanFailure = await runVirusScans(files);
    if (scanFailure) {
      // Detection alerts fire whenever any file in the batch was confirmed
      // infected, even if another file in the same batch hit a scanner
      // outage and that outage wins the response-reason precedence. The
      // two concerns are separable: rejection-reason ordering controls
      // what the reviewer sees and whether they can safely retry, while
      // the detection alert is about routing a known event to ops. Pre-
      // S190 the alert path was gated on `reason === 'infected'`, which
      // silently suppressed alerts on mixed batches.
      const knownInfected = Array.isArray(scanFailure.infectedErrors)
        ? scanFailure.infectedErrors
        : [];
      if (knownInfected.length > 0) {
        await fireReviewDetectionAlert({
          suggestionId,
          source: opts?.source || 'unknown',
          files,
          infectedErrors: knownInfected,
          infectedDetails: Array.isArray(scanFailure.infectedDetails) ? scanFailure.infectedDetails : [],
        }).catch(err => {
          // Never let alert failure block the client rejection.
          console.error(`[review-upload] detection alert failed for ${suggestionId}: ${err.message}`);
        });
      }
      return scanFailure;
    }
  }

  // ── 4. Resolve the request folder name ────────────────────────────────
  let suggestion;
  try {
    suggestion = await getForExternalVerification(suggestionId, {
      select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_accepted,wmkf_declined,wmkf_reviewreceivedat,wmkf_reviewstatus',
      expand:
        'wmkf_Request($select=akoya_requestid,akoya_requestnum),' +
        'wmkf_PotentialReviewer($select=wmkf_lastname,wmkf_name)',
    });
  } catch (e) {
    if (e.status === 404) return { ok: false, reason: 'not_found' };
    throw e;
  }

  const request = suggestion?.wmkf_Request;
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { ok: false, reason: 'not_found' };
  }

  let authorization;
  try {
    authorization = authorizeReviewReceipt(suggestion);
  } catch (error) {
    if (error instanceof ReviewReceiptEligibilityError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }

  // Materials-sent gate (reviewer-engagement §3.D / Codex P2): a reviewer who accepted
  // but whose proposal materials have NOT yet been released must not be able to upload a
  // review via their token — they have no proposal to review against. Scoped to the
  // self-token path; a staff_upload is a deliberate, fully-contextualized action and is
  // not gated. null/accepted (< materials_sent) ⇒ refused; materials_sent and beyond pass.
  if (opts.source === 'reviewer_self_token') {
    const status = suggestion?.wmkf_reviewstatus;
    if (TERMINAL_REVIEW_STATUSES.has(status)) {
      return { ok: false, reason: 'engagement_ended' };
    }
    if (status == null || status < REVIEW_STATUS_MATERIALS_SENT) {
      return { ok: false, reason: 'materials_not_sent' };
    }
  }

  const requestFolder = `${request.akoya_requestnum}_${request.akoya_requestid.replace(/-/g, '').toUpperCase()}`;
  const reviewerSubfolder = buildReviewerSubfolder(suggestionId, suggestion?.wmkf_PotentialReviewer);
  // Graph simple uploads use conflictBehavior=replace. A deterministic reviewer
  // folder plus a client filename therefore lets concurrent same-name attempts
  // replace one another and receive the same drive-item id. If the losing
  // Dataverse If-Match then deletes that id, it can delete the winning receipt's
  // file. Give every attempt a unique folder and persist this exact folder in the
  // winning row, so rollback ownership is per attempt while the client filename
  // remains unchanged for download/display.
  const attemptId = crypto.randomUUID().replace(/-/g, '');
  const reviewsFolder =
    `${requestFolder}/Reviewer_Uploads/${reviewerSubfolder}/attempt_${attemptId}`;

  // ── 5. Upload files to SharePoint, tracking for rollback ──────────────
  const uploaded = [];
  let driveId;
  try {
    driveId = await GraphService.getDriveId(REVIEW_LIBRARY);
    for (const f of files) {
      const contentType = MIME_BY_EXT[f._type] || 'application/octet-stream';
      const item = await GraphService.uploadFile(
        REVIEW_LIBRARY,
        reviewsFolder,
        f.filename,
        f.buffer,
        contentType,
      );
      uploaded.push(item);
    }
  } catch (e) {
    // Best-effort cleanup of anything already uploaded
    await cleanupSharePointItems(driveId, uploaded, 'review-upload');
    return {
      ok: false,
      reason: 'sharepoint_failed',
      error: e.message,
      partial: uploaded.map(u => u.name),
    };
  }

  // ── 6. PATCH the Dataverse row ────────────────────────────────────────
  const primaryFilename = files[0].filename;
  const dvPatch = {
    ...formResult.dataverseValues,
    wmkf_reviewsharepointfolder: reviewsFolder,
    wmkf_reviewfilename: primaryFilename,
    wmkf_reviewreceivedat: new Date().toISOString(),
    wmkf_reviewuploadedbystaff: opts.source === 'staff_upload',
  };

  // Write the rating snapshot rows atomically with the parent PATCH. Post-Phase-E
  // the parent PATCH (`dvPatch`) no longer carries the rating columns — ratings
  // live ONLY in the snapshot now (`formResult.ratings` → rows). The upload path
  // always carries the two ratings and the required multiselect answer
  // (non-partial validation above), so all three structured rows are written;
  // narrative answers live in the uploaded PDF, not the form.
  const ratingRows = buildRatingSnapshotRows(formResult.ratings, questionSet);
  const multiselectRows = buildMultiselectSnapshotRows(formResult.multiselects, questionSet);
  const snapshotRows = [...ratingRows, ...multiselectRows];
  const snapshotKeys = new Set(
    questionSet.filter((f) => f.type === 'picklist' || f.type === 'multiselect' || f.type === 'richtext').map((f) => f.key),
  );

  try {
    const actingOpts = {
      ...(opts?.actingUserSystemId ? { actingUserSystemId: opts.actingUserSystemId } : {}),
      ifMatch: authorization.ifMatch,
    };
    if (snapshotRows.length === 0) {
      await patchReviewReceipt(suggestionId, dvPatch, actingOpts);
    } else {
      const children = snapshotRows.map((row) => answerUpsertDescriptor(suggestionId, row, snapshotKeys));
      const parent = {
        method: 'PATCH',
        entitySet: SUGGESTION_ENTITY_SET,
        key: suggestionId,
        body: dvPatch,
        ifMatch: authorization.ifMatch,
      };
      const changesetOpts = opts?.actingUserSystemId ? { actingUserSystemId: opts.actingUserSystemId } : {};
      await runChangeset(atomicParentWithChildren({ parent, children }), changesetOpts);
    }
  } catch (e) {
    let reason = 'dataverse_failed';
    let current = null;
    const is412 = isReviewReceiptPreconditionFailure(e);
    if (is412) {
      try {
        current = await getForExternalVerification(suggestionId, {
          select: 'wmkf_appreviewersuggestionid,wmkf_reviewreceivedat,wmkf_reviewstatus',
        });
      } catch {
        // The failed If-Match is still a conflict if the winner cannot be read.
      }
      reason = classifyReviewReceiptConflict(current);
    }
    // Cleanup safety hinges on whether this was a 412 (a lost concurrency race)
    // or an ordinary failure:
    //
    // - Non-412: this attempt is the ONLY writer of the row, so there is no
    //   concurrent winner and deleting our own uploaded items is safe.
    // - 412: some concurrent lifecycle or receipt write won. Never try to infer
    //   SharePoint item ownership after that race. The attempt folder is unique,
    //   so orphaning it is bounded storage litter; deleting anything risks
    //   removing content referenced by the winning row.
    const cleanedUp = is412
      ? false
      : await cleanupSharePointItems(driveId, uploaded, 'review-upload');
    if (is412) {
      console.error(
        `[review-upload] 412 for ${suggestionId}; leaving the unique losing attempt orphaned rather than deleting after a concurrency race`,
      );
    }
    return {
      ok: false,
      reason,
      error: e.message,
      cleanedUp,
    };
  }

  // Tighten the external-link expiry to a 7-day post-submission window. The
  // review is already committed at this point, so we treat a failure here as
  // non-fatal — better an unshortened token than a rolled-back upload. The
  // mint-time 90-day ceiling stays as the upper bound; this just pulls it in
  // once the reviewer has actually submitted.
  try {
    await extendForPostSubmissionWindow(suggestionId, { actingUserSystemId: opts?.actingUserSystemId });
  } catch (e) {
    console.error(`[review-upload] failed to tighten token expiry for ${suggestionId}: ${e.message}`);
  }

  return {
    ok: true,
    folder: reviewsFolder,
    files: uploaded,
    dataverseValues: dvPatch,
  };
}

/**
 * Build the per-reviewer subfolder name for a SharePoint upload path.
 *
 * Format: `{sanitizedLastName}_{shortId}` where shortId is the first
 * 8 chars of the suggestion GUID. Falls back to `{shortId}` only when
 * the lastname sanitizes to an empty string (e.g. CJK-only names with
 * no ASCII fold).
 *
 * Why human-readable: lets staff browse SharePoint and identify whose
 * review is whose without cross-referencing Dataverse. Automation
 * doesn't depend on the format — `wmkf_reviewsharepointfolder` on the
 * row is the canonical pointer, and reviewer identity always comes
 * from the joined `wmkf_potentialreviewer` row, never from parsing
 * folder names.
 *
 * The subfolder name is computed once at first upload and frozen on the
 * row. Replacing files reuses the same folder. Renames to the source
 * row (e.g., reviewer's name corrected later) do not propagate to
 * SharePoint.
 *
 * Sanitization recipe:
 *   1. Pull lastname (or last word of full name if lastname unset)
 *   2. NFD normalize, drop combining marks (`José` → `Jose`)
 *   3. Strip everything not [A-Za-z0-9]
 *   4. Truncate to 30 chars
 *   5. If empty, fall back to short-id-only
 *   6. Append `_` + first 8 chars of suggestion GUID
 *
 * @param {string} suggestionId
 * @param {Object|null} reviewer - expanded wmkf_PotentialReviewer row,
 *   or null. Reads `wmkf_lastname` first, falls back to last word of
 *   `wmkf_name`.
 * @returns {string}
 */
export function buildReviewerSubfolder(suggestionId, reviewer) {
  const shortId = String(suggestionId || '').replace(/-/g, '').slice(0, 8);
  const rawLast = (reviewer?.wmkf_lastname && reviewer.wmkf_lastname.trim())
    || lastWordOf(reviewer?.wmkf_name)
    || '';
  const sanitized = rawLast
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 30);
  return sanitized ? `${sanitized}_${shortId}` : shortId;
}

function lastWordOf(name) {
  if (!name || typeof name !== 'string') return '';
  const cleaned = name.trim().replace(/^(dr\.?|prof\.?|professor)\s+/i, '');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Run Cloudmersive scans across all files in parallel and return either
 * `null` (all clean — caller proceeds) or an `ok:false` envelope matching
 * one of the three new failure reasons.
 *
 * Uses Promise.allSettled (not Promise.all) so a thrown scan doesn't
 * short-circuit while the other 4 in-flight fetches keep running
 * orphaned — full settlement lets us evaluate all results coherently and
 * doesn't waste scanner quota on responses we'd discard.
 *
 * Reason discrimination on the throw path comes from the structured-error
 * shape produced by cloudmersive-scan.js:
 *   - err.isTransient === false → config bug (missing key, 401, 403, bad
 *     input). Operations-visible — caller maps to 500.
 *   - err.isTransient === true  → outage (5xx-exhaust, network-exhaust,
 *     429-exhaust). Retryable later — caller maps to 503.
 * If multiple files throw, we report the FIRST encountered with the worst
 * (misconfigured > unavailable) classification, since a misconfiguration
 * is the higher-leverage finding for the operator.
 */
async function runVirusScans(files) {
  const settled = await Promise.allSettled(
    files.map(f => scanBytes(f.buffer, f.filename)),
  );

  // Pass 1: collect all errors and the worst classification.
  let misconfiguredErr = null;
  let unavailableErr = null;
  const infectedErrors = [];
  // S193: parallel structured detection records, used by the detection alert
  // path so `detectedThreats` / `verifiedFileFormat` (added to scanBytes in
  // S193) flow into system_alerts.metadata for admin analytics.
  const infectedDetails = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const file = files[i];
    if (r.status === 'rejected') {
      const err = r.reason;
      // Log server-side so an operator can triage. Don't leak err.message
      // to the client; the endpoint caller returns a generic message.
      console.error(
        `[review-upload] cloudmersive scan failed for ${file.filename}:`,
        {
          serviceName: err?.serviceName,
          status: err?.status,
          isTransient: err?.isTransient,
          noResponse: err?.noResponse,
          causeKind: err?.causeKind,
          message: err?.message,
        },
      );
      if (err?.isTransient === false) {
        if (!misconfiguredErr) misconfiguredErr = err;
      } else {
        if (!unavailableErr) unavailableErr = err;
      }
    } else if (r.value?.scan_result === 'infected') {
      const v = Array.isArray(r.value.foundViruses) && r.value.foundViruses[0];
      const detection = v?.virusName || 'unknown signature';
      infectedErrors.push(`${file.filename}: virus detected (${detection})`);
      infectedDetails.push({
        filename: file.filename,
        virusName: v?.virusName || null,
        detectedThreats: Array.isArray(r.value.detectedThreats) ? r.value.detectedThreats : [],
        verifiedFileFormat: r.value.verifiedFileFormat ?? null,
      });
    }
  }

  // Detection alerts (handled by the caller) fire whenever any file was
  // confirmed infected — surface that list alongside whichever reason wins
  // the response-precedence. The user-facing rejection path keeps the
  // existing precedence (misconfigured > unavailable > infected) so a
  // partial-failure batch can't be retried without a clean rescan.
  const hasInfected = infectedErrors.length > 0;
  if (misconfiguredErr) {
    return { ok: false, reason: 'scan_misconfigured', infectedErrors: hasInfected ? infectedErrors : [], infectedDetails: hasInfected ? infectedDetails : [] };
  }
  if (unavailableErr) {
    return { ok: false, reason: 'scan_unavailable', infectedErrors: hasInfected ? infectedErrors : [], infectedDetails: hasInfected ? infectedDetails : [] };
  }
  if (hasInfected) {
    return { ok: false, reason: 'infected', errors: infectedErrors, infectedErrors, infectedDetails };
  }
  return null;
}

// cleanupSharePointItems is now shared — see ./sharepoint-cleanup.js (imported above).

/**
 * Fire a virus-detection alert for the reviewer-upload path.
 *
 * Writes a `system_alerts` row and sends an email routed to the Program
 * Director on the related akoya_request (falls back to category routing
 * if the PD lookup yields nothing). Best-effort: all failures are logged
 * and swallowed so the upload rejection still reaches the client.
 *
 * Loads suggestion + reviewer + request just-in-time only on the rare
 * detection path — the happy path keeps the existing single read at
 * line 124 of writeReviewFiles.
 */
async function fireReviewDetectionAlert({ suggestionId, source, files, infectedErrors, infectedDetails = [] }) {
  let suggestion;
  try {
    suggestion = await getForExternalVerification(suggestionId, {
      select: 'wmkf_appreviewersuggestionid,_wmkf_request_value',
      expand:
        'wmkf_Request($select=akoya_requestid,akoya_requestnum,akoya_title),' +
        'wmkf_PotentialReviewer($select=wmkf_lastname,wmkf_name,wmkf_emailaddress)',
    });
  } catch (e) {
    console.warn(`[review-upload] detection-alert suggestion read failed for ${suggestionId}: ${e.message}`);
    suggestion = null;
  }

  const request = suggestion?.wmkf_Request || {};
  const reviewer = suggestion?.wmkf_PotentialReviewer || {};
  // Prefer the expanded payload; fall back to the lookup GUID we always select.
  // Codex 2026-05-26 review caught the silent-fall-through case where the
  // expand was incomplete but _wmkf_request_value was populated.
  const requestId = request?.akoya_requestid || suggestion?._wmkf_request_value || null;

  const pdEmail = requestId
    ? await resolveProgramDirectorEmailForRequest(requestId)
    : null;

  const reviewerLabel = reviewer.wmkf_name
    || reviewer.wmkf_lastname
    || reviewer.wmkf_emailaddress
    || 'unknown reviewer';
  const requestLabel = request.akoya_requestnum
    ? `${request.akoya_requestnum}${request.akoya_title ? ` — ${request.akoya_title}` : ''}`
    : 'unknown request';

  const fileSummaries = (infectedErrors && infectedErrors.length > 0)
    ? infectedErrors
    : files.map(f => `${f.filename}: virus detected (signature unknown)`);

  await NotificationService.notify({
    type: 'virus_detection_reviewer',
    severity: 'error',
    title: `Virus scan rejected a reviewer upload (${requestLabel})`,
    message: [
      `The virus scanner blocked an upload from ${reviewerLabel} for ${requestLabel}.`,
      `Source: ${source}.`,
      '',
      'Detections:',
      ...fileSummaries.map(s => `  • ${s}`),
      '',
      "The upload was not stored. The reviewer's typed review (if any) is preserved on their end and they have been asked to scan their machine and try a clean copy.",
    ].join('\n'),
    metadata: {
      suggestionId,
      requestId,
      requestNumber: request.akoya_requestnum || null,
      requestTitle: request.akoya_title || null,
      reviewerName: reviewer.wmkf_name || null,
      reviewerEmail: reviewer.wmkf_emailaddress || null,
      source,
      fileDetections: fileSummaries,
      // S193: structured detection details for admin-dashboard analytics.
      // Shape: [{ filename, virusName, detectedThreats: string[], verifiedFileFormat: string|null }]
      detections: infectedDetails,
    },
    source: 'review-upload',
    // Category routing handles the foundation alerts address (configured
    // in /admin → Alert Recipients under category 'virus-detection').
    // explicitRecipients adds the PD on this specific request when
    // resolvable — notify() unions both lists and dedupes.
    category: 'virus-detection',
    explicitRecipients: pdEmail ? [pdEmail] : [],
  });
}
