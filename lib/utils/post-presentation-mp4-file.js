/** Bounded metadata and signature validation for browser-direct MP4 uploads. */
export const POST_PRESENTATION_MP4_MAX_BYTES = 2_000_000_000;
export const POST_PRESENTATION_MP4_CONTENT_TYPE = 'video/mp4';

export function validatePostPresentationMp4Descriptor(filename, contentType, size, fingerprint) {
  const name = String(filename || '').split(/[\\/]/).pop().trim();
  if (!name || name.length > 180 || !/\.mp4$/i.test(name)) return { ok: false, reason: 'mp4_filename_invalid' };
  if (contentType !== POST_PRESENTATION_MP4_CONTENT_TYPE) return { ok: false, reason: 'mp4_content_type_invalid' };
  if (!Number.isInteger(size) || size <= 0 || size > POST_PRESENTATION_MP4_MAX_BYTES) {
    return { ok: false, reason: 'mp4_size_invalid' };
  }
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) {
    return { ok: false, reason: 'mp4_fingerprint_invalid' };
  }
  return { ok: true, filename: name, contentType, size, fingerprint };
}
export function hasPostPresentationMp4Signature(bytes) {
  return Buffer.isBuffer(bytes)
    && bytes.length >= 12
    && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
}
