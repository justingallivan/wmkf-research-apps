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
 *   4. Upload each file to SharePoint at `akoya_request/{request}/Reviews/{suggestionId}/`.
 *      Track item ids as we go so we can roll back if a later step fails.
 *   5. PATCH the suggestion row with the new field values (folder, primary
 *      filename, received-at, picklists, affiliation, staff flag).
 *
 * On failure after the first SharePoint write, attempt best-effort cleanup
 * of the files we just wrote. If cleanup itself fails, log loudly — staff
 * may need to remove orphan files manually.
 */

import { DynamicsService } from './dynamics-service.js';
import { GraphService } from './graph-service.js';
import { scanBytes } from './cloudmersive-scan.js';
import { validateReviewForm } from '../external/review-form-schema.js';
import { validateReviewFile } from '../utils/file-magic.js';
import { isVirusScanEnabled } from '../utils/virus-scan-config.js';
import { extendForPostSubmissionWindow } from '../external/token-lifecycle.js';

const REVIEW_LIBRARY = 'akoya_request';
const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

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
  const formResult = validateReviewForm(structuredData);
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
    if (scanFailure) return scanFailure;
  }

  // ── 4. Resolve the request folder name ────────────────────────────────
  let suggestion;
  try {
    suggestion = await DynamicsService.getRecord(
      'wmkf_appreviewersuggestions',
      suggestionId,
      {
        select: 'wmkf_appreviewersuggestionid,_wmkf_request_value',
        expand:
          'wmkf_Request($select=akoya_requestid,akoya_requestnum),' +
          'wmkf_PotentialReviewer($select=wmkf_lastname,wmkf_name)',
      },
    );
  } catch (e) {
    if (e.status === 404) return { ok: false, reason: 'not_found' };
    throw e;
  }

  const request = suggestion?.wmkf_Request;
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { ok: false, reason: 'not_found' };
  }

  const requestFolder = `${request.akoya_requestnum}_${request.akoya_requestid.replace(/-/g, '').toUpperCase()}`;
  const reviewerSubfolder = buildReviewerSubfolder(suggestionId, suggestion?.wmkf_PotentialReviewer);
  const reviewsFolder = `${requestFolder}/Reviewer_Uploads/${reviewerSubfolder}`;

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
    await cleanupSharePointItems(driveId, uploaded);
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

  try {
    await DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestionId, dvPatch, {
      ...(opts?.actingUserSystemId ? { actingUserSystemId: opts.actingUserSystemId } : {}),
    });
  } catch (e) {
    // Roll back the SharePoint writes — we don't want orphan files when the
    // canonical pointer record never got updated.
    const cleanedUp = await cleanupSharePointItems(driveId, uploaded);
    return {
      ok: false,
      reason: 'dataverse_failed',
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
    }
  }

  // Misconfigured outranks unavailable (operator action needed).
  if (misconfiguredErr) return { ok: false, reason: 'scan_misconfigured' };
  if (unavailableErr) return { ok: false, reason: 'scan_unavailable' };
  if (infectedErrors.length > 0) {
    return { ok: false, reason: 'infected', errors: infectedErrors };
  }
  return null;
}

async function cleanupSharePointItems(driveId, items) {
  if (!driveId || items.length === 0) return true;
  let allOk = true;
  for (const item of items) {
    try {
      await GraphService.deleteFile(driveId, item.id);
    } catch (e) {
      allOk = false;
      console.error(`[review-upload] cleanup failed for ${item.name} (${item.id}): ${e.message}`);
    }
  }
  return allOk;
}
