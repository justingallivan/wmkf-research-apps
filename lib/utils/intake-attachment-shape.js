/**
 * Attachment-shape validator — shared between /api/intake/submit and
 * /api/cron/drain-submissions.
 *
 * Drain plan v7 §5 (Codex round-6 §5): runs at BOTH submit-entry and
 * drain-entry. A malformed object that carries scan_result='clean' but
 * is missing other fields can pass the clean check at submit and fail
 * later in files_moved where the drain reads blob_url/sha256/size.
 *
 * Submit-side failure → 422 to applicant (normal re-upload UX).
 * Drain-side failure → terminal validation_400 + system_alerts row
 *   (rationale: by the time the drain sees a malformed attachment, submit
 *    already passed, so this is corruption / hand-editing / regression,
 *    not normal user error).
 *
 * Belt-and-suspenders: keep BOTH call sites, not just submit. The
 * single source of truth lives here.
 */
'use strict';

const VALID_SCAN_RESULTS = new Set(['clean', 'infected', 'error']);
// `pathname` (added round-12 fold extension) is the private-Blob pathname the
// drain's files_moved state passes to `@vercel/blob` `get({ access: 'private' })`.
// It is distinct from `blob_url` (the URL the upload endpoint received) — the
// private-store retrieval API takes the pathname, not the URL.
const REQUIRED_KEYS = ['filename', 'blob_url', 'pathname', 'sha256', 'size', 'scan_result'];

/**
 * Throws on shape failure. Returns void on success.
 * Includes the array index in the error message so callers can pinpoint
 * which attachment was malformed.
 */
function validateAttachmentShape(att, idx) {
  for (const k of REQUIRED_KEYS) {
    if (att?.[k] === undefined || att[k] === null) {
      throw new Error(`attachment[${idx}] shape: missing ${k}`);
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(att.sha256)) {
    throw new Error(`attachment[${idx}] shape: sha256 not 64-hex`);
  }
  if (typeof att.size !== 'number' || att.size <= 0) {
    throw new Error(`attachment[${idx}] shape: size not positive number`);
  }
  if (!VALID_SCAN_RESULTS.has(att.scan_result)) {
    throw new Error(`attachment[${idx}] shape: invalid scan_result=${att.scan_result}`);
  }
}

/**
 * Cross-attachment invariants — checks that apply to the full set, not
 * a single row. Today: filename uniqueness (Codex round-13 Q5).
 *
 * Why filename uniqueness matters: the drain's files_moved state uploads
 * each attachment to `SHAREPOINT_LIBRARY/{folder}/Applicant_Uploads/{filename}`.
 * SharePoint upload uses `@microsoft.graph.conflictBehavior=replace`, so
 * two attachments with the SAME filename but DIFFERENT sha256 (= different
 * artifacts) would silently overwrite each other in SharePoint. The
 * sharepoint_paths idempotency-skip would also see them as distinct
 * (because sha256 differs) and re-upload both, with the second clobbering
 * the first. Catch this at validation time.
 *
 * Throws on duplicate. Caller passes the index where the duplicate was
 * detected so the error pinpoints the offending row.
 */
function validateAttachmentSet(attachments) {
  if (!Array.isArray(attachments)) {
    throw new Error('attachment-set: not an array');
  }
  const seen = new Map(); // filename → first-index
  for (let i = 0; i < attachments.length; i++) {
    const filename = attachments[i]?.filename;
    if (filename == null) continue; // per-row validator catches missing filename
    if (seen.has(filename)) {
      throw new Error(`attachment-set: duplicate filename "${filename}" at index ${i} (also at index ${seen.get(filename)})`);
    }
    seen.set(filename, i);
  }
}

module.exports = {
  validateAttachmentShape,
  validateAttachmentSet,
  VALID_SCAN_RESULTS,
  REQUIRED_KEYS,
};
