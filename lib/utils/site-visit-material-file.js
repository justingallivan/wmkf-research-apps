/**
 * Byte-level validation for applicant site-visit materials (plan §16 M1).
 * The slot decides which extensions are acceptable; the bytes must match the
 * declared extension's signature. Keynote (.key), PPTX, and DOCX are all ZIP
 * packages, so they share the ZIP signature and are gated on extension.
 */
import { sniffFileType } from './file-magic.js';

const SLOT_EXTENSIONS = Object.freeze({
  presentation_pdf: ['pdf'],
  presentation_source: ['pptx', 'ppt', 'key'],
  participant_bios: ['pdf', 'docx', 'doc'],
  other: ['pdf', 'pptx', 'ppt', 'key', 'docx', 'doc'],
});

const EXTENSION_CONTENT_TYPE = Object.freeze({
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  key: 'application/vnd.apple.keynote',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
});

export function slotExtensions(slotKey) {
  return SLOT_EXTENSIONS[slotKey] || null;
}

export function contentTypeForExtension(extension) {
  return EXTENSION_CONTENT_TYPE[String(extension || '').toLowerCase()] || 'application/octet-stream';
}

/**
 * @returns {{ ok: true, extension: string, contentType: string } | { ok: false, reason: string }}
 */
export function validateSiteVisitMaterial(filename, buffer, slotKey) {
  const allowed = SLOT_EXTENSIONS[slotKey];
  if (!allowed) return { ok: false, reason: 'unknown_slot' };
  if (typeof filename !== 'string' || !filename) return { ok: false, reason: 'filename_required' };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, reason: 'empty_file' };
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match ? match[1] : '';
  if (!allowed.includes(extension)) return { ok: false, reason: 'extension_not_allowed' };
  const sniffed = sniffFileType(buffer);
  const expected = extension === 'pdf' ? 'pdf'
    : (extension === 'ppt' || extension === 'doc') ? 'doc'
      : 'docx'; // pptx, key, docx are ZIP packages
  if (sniffed !== expected) return { ok: false, reason: 'signature_mismatch' };
  // A renamed generic archive carries the ZIP signature; Office packages also
  // carry the OOXML content-types entry and a part root named for the format.
  // Keynote has no stable marker beyond the ZIP header, so it stays extension-gated.
  if (extension === 'pptx' || extension === 'docx') {
    const head = buffer.subarray(0, Math.min(buffer.length, 8 * 1024 * 1024)).toString('latin1');
    const root = extension === 'pptx' ? 'ppt/' : 'word/';
    if (!head.includes('[Content_Types].xml') || !head.includes(root)) return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true, extension, contentType: contentTypeForExtension(extension) };
}
