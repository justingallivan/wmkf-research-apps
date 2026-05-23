/**
 * drain-files-moved-helpers.js
 *
 * Pure helpers extracted from the files_moved drain state handler. Lives
 * outside the route module so unit tests can load them without the full
 * drain module (which imports `pg` — incompatible with jest's jsdom env
 * because the pg webcrypto path references `TextEncoder`).
 */
'use strict';

/**
 * SharePoint folder name for a request, per the review-upload.js convention.
 * Format: `{akoya_requestnum}_{requestGuid-no-hyphens-upper}`.
 */
function requestFolderName(akoyaRequestnum, requestGuid) {
  return `${akoyaRequestnum}_${requestGuid.replace(/-/g, '').toUpperCase()}`;
}

/**
 * Drain plan §"Per-state idempotency" for files_moved: track written paths
 * in `sharepoint_paths`; skip already-written. Match on filename + sha256
 * so two attachments sharing a filename (defensive) are distinguishable,
 * and a re-upload of the same artifact is correctly skipped.
 */
function isAlreadyWritten(sharepointPaths, attachment) {
  if (!Array.isArray(sharepointPaths)) return false;
  return sharepointPaths.some((p) =>
    p?.filename === attachment.filename && p?.sha256 === attachment.sha256
  );
}

// Fallback content-type guesser. The attach endpoint should populate
// `attachment.contentType` directly; this kicks in for pre-existing data.
const CONTENT_TYPE_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
};
function guessContentType(filename) {
  const ext = String(filename).toLowerCase().split('.').pop();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

module.exports = {
  requestFolderName,
  isAlreadyWritten,
  guessContentType,
  CONTENT_TYPE_BY_EXT,
};
