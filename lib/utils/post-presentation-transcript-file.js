/** Bounded format contract for staff-uploaded post-presentation transcripts. */
import { validateReviewFile } from './file-magic.js';

export const POST_PRESENTATION_TRANSCRIPT_MAX_BYTES = 25 * 1024 * 1024;

const FORMAT_BY_EXTENSION = Object.freeze({
  vtt: 'text/vtt',
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

export const POST_PRESENTATION_TRANSCRIPT_CONTENT_TYPES = Object.freeze(
  Object.values(FORMAT_BY_EXTENSION),
);

function extensionOf(filename) {
  const match = typeof filename === 'string' ? filename.toLowerCase().match(/\.([a-z0-9]+)$/) : null;
  return match ? match[1] : '';
}

function hasWebVttHeader(buffer) {
  const prefix = buffer.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '');
  return /^WEBVTT(?:[ \t]|\r?\n|$)/.test(prefix);
}

export function validatePostPresentationTranscriptDescriptor(filename, contentType, size) {
  if (typeof filename !== 'string' || !filename) return { ok: false, reason: 'filename_required' };
  if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, reason: 'invalid_size' };
  if (size > POST_PRESENTATION_TRANSCRIPT_MAX_BYTES) return { ok: false, reason: 'file_too_large' };
  const extension = extensionOf(filename);
  const expectedContentType = FORMAT_BY_EXTENSION[extension];
  if (!expectedContentType) return { ok: false, reason: 'extension_not_allowed' };
  if (contentType !== expectedContentType) return { ok: false, reason: 'content_type_mismatch' };
  return { ok: true, extension, contentType: expectedContentType };
}

/**
 * TXT deliberately has no magic-byte assertion. Its safety contract is the
 * exact extension/MIME pair, bounded bytes, and the caller's malware scan.
 */
export function validatePostPresentationTranscript(filename, contentType, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, reason: 'empty_file' };
  const descriptor = validatePostPresentationTranscriptDescriptor(filename, contentType, buffer.length);
  if (!descriptor.ok) return descriptor;
  const { extension, contentType: expectedContentType } = descriptor;

  if (extension === 'vtt' && !hasWebVttHeader(buffer)) {
    return { ok: false, reason: 'vtt_header_invalid' };
  }
  if (extension === 'pdf' || extension === 'docx') {
    const signature = validateReviewFile(filename, buffer);
    if (!signature.ok || signature.type !== extension) {
      return { ok: false, reason: 'signature_mismatch' };
    }
  }
  return { ok: true, extension, contentType: expectedContentType };
}
