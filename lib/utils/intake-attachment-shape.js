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
const REQUIRED_KEYS = ['filename', 'blob_url', 'sha256', 'size', 'scan_result'];

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

module.exports = {
  validateAttachmentShape,
  VALID_SCAN_RESULTS,
  REQUIRED_KEYS,
};
