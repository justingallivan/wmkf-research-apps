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

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_MAX_ENTRIES = 2_000;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

function zipEntryNames(buffer) {
  if (buffer.length < 22) return null;
  const searchStart = Math.max(0, buffer.length - ZIP_MAX_COMMENT_BYTES - 22);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const directoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== entryCount) return null;
  if (entryCount > ZIP_MAX_ENTRIES || directorySize > ZIP_MAX_CENTRAL_DIRECTORY_BYTES) return null;
  if (directoryOffset > eocdOffset || directorySize > eocdOffset - directoryOffset) return null;

  const directoryEnd = directoryOffset + directorySize;
  const names = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset > directoryEnd - 46 || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_FILE_SIGNATURE) return null;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > directoryEnd) return null;
    if (localHeaderOffset > buffer.length - 4 || buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) return null;
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = nextOffset;
  }
  return offset === directoryEnd ? names : null;
}

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
    const entries = zipEntryNames(buffer);
    const root = extension === 'pptx' ? 'ppt/' : 'word/';
    if (!entries?.includes('[Content_Types].xml') || !entries.some((name) => name.startsWith(root))) {
      return { ok: false, reason: 'signature_mismatch' };
    }
  }
  return { ok: true, extension, contentType: contentTypeForExtension(extension) };
}
