/**
 * Server-owned classification for retained review-file paths.
 *
 * The browser receives the classification from the Review Manager service; it
 * never guesses provenance from a filename. External-review server code uses
 * the same helper to hide generated filenames from reviewer-facing copy.
 */

export const REVIEW_FILE_PROVENANCE = Object.freeze({
  NONE: 'none',
  GENERATED: 'generated',
  ATTEMPT_UPLOAD: 'attempt_upload',
  LEGACY: 'legacy',
});

function normalizedFolder(folderPath) {
  if (typeof folderPath !== 'string') return '';
  return folderPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function classifyReviewFileProvenance(folderPath) {
  const folder = normalizedFolder(folderPath);
  if (!folder) return REVIEW_FILE_PROVENANCE.NONE;
  if (/(?:^|\/)Reviewer_Uploads\/Generated\/[a-f0-9]{32}$/i.test(folder)) {
    return REVIEW_FILE_PROVENANCE.GENERATED;
  }
  if (/(?:^|\/)Reviewer_Uploads\/[^/]+\/attempt_[a-f0-9]{32}$/i.test(folder)) {
    return REVIEW_FILE_PROVENANCE.ATTEMPT_UPLOAD;
  }
  return REVIEW_FILE_PROVENANCE.LEGACY;
}

export function isGeneratedReviewFile(folderPath) {
  return classifyReviewFileProvenance(folderPath) === REVIEW_FILE_PROVENANCE.GENERATED;
}
