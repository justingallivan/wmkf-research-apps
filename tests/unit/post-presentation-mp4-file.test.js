/** @jest-environment node */
import {
  POST_PRESENTATION_MP4_MAX_BYTES,
  hasPostPresentationMp4Signature,
  validatePostPresentationMp4Descriptor,
} from '../../lib/utils/post-presentation-mp4-file.js';

const FINGERPRINT = 'a'.repeat(64);

test('MP4 descriptor accepts the exact cap and contract', () => {
  expect(validatePostPresentationMp4Descriptor(
    'Recording.MP4', 'video/mp4', POST_PRESENTATION_MP4_MAX_BYTES, FINGERPRINT,
  )).toMatchObject({ ok: true, filename: 'Recording.MP4' });
});
test.each([
  ['wrong extension', 'recording.mov', 'video/mp4', 100, FINGERPRINT, 'mp4_filename_invalid'],
  ['wrong MIME', 'recording.mp4', 'application/octet-stream', 100, FINGERPRINT, 'mp4_content_type_invalid'],
  ['empty file', 'recording.mp4', 'video/mp4', 0, FINGERPRINT, 'mp4_size_invalid'],
  ['over cap', 'recording.mp4', 'video/mp4', POST_PRESENTATION_MP4_MAX_BYTES + 1, FINGERPRINT, 'mp4_size_invalid'],
  ['bad fingerprint', 'recording.mp4', 'video/mp4', 100, 'x', 'mp4_fingerprint_invalid'],
])('%s fails closed', (_label, filename, mime, size, fingerprint, reason) => {
  expect(validatePostPresentationMp4Descriptor(filename, mime, size, fingerprint)).toEqual({ ok: false, reason });
});

test('MP4 signature requires ftyp at bytes four through seven', () => {
  expect(hasPostPresentationMp4Signature(Buffer.concat([
    Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4),
  ]))).toBe(true);
  expect(hasPostPresentationMp4Signature(Buffer.from('not-an-mp4'))).toBe(false);
});
