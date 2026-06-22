/**
 * @jest-environment node
 *
 * validateGranteeImage — image magic-byte validation (PNG/JPEG/WEBP; GIF dropped
 * for award images S278, though sniffImageType still detects GIF for the
 * disguised-extension mismatch check), including the WEBP offset check
 * (RIFF@0 + WEBP@8).
 */
import { validateGranteeImage, sniffImageType } from '../../lib/utils/file-magic';

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const gif = () => Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const webp = () => Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // size
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP @ offset 8
  Buffer.from([0, 0]),
]);

test('sniffImageType recognizes each format', () => {
  expect(sniffImageType(png())).toBe('png');
  expect(sniffImageType(jpeg())).toBe('jpeg');
  expect(sniffImageType(gif())).toBe('gif');
  expect(sniffImageType(webp())).toBe('webp');
  expect(sniffImageType(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe('unknown'); // PDF
});

test('accepts matching extension + magic, returns canonical ext', () => {
  expect(validateGranteeImage('fig.png', png())).toEqual({ ok: true, type: 'png', ext: 'png' });
  expect(validateGranteeImage('fig.jpg', jpeg())).toEqual({ ok: true, type: 'jpeg', ext: 'jpg' });
  expect(validateGranteeImage('fig.jpeg', jpeg())).toEqual({ ok: true, type: 'jpeg', ext: 'jpg' });
  expect(validateGranteeImage('fig.webp', webp())).toEqual({ ok: true, type: 'webp', ext: 'webp' });
});

test('rejects extension/content mismatch (renamed file)', () => {
  expect(validateGranteeImage('fig.png', jpeg()).ok).toBe(false);
  expect(validateGranteeImage('fig.webp', png()).ok).toBe(false);
});

test('rejects unsupported extension (e.g. .pdf / .exe / .gif)', () => {
  expect(validateGranteeImage('doc.pdf', png()).ok).toBe(false);
  expect(validateGranteeImage('x.exe', png()).ok).toBe(false);
  expect(validateGranteeImage('', png()).ok).toBe(false);
  // GIF dropped for grantee award images (S278) — even a real GIF is rejected.
  expect(validateGranteeImage('fig.gif', gif()).ok).toBe(false);
});

test('WEBP with RIFF but wrong tag at offset 8 is rejected', () => {
  const fakeRiff = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]),
    Buffer.from([0x41, 0x56, 0x49, 0x20]), // 'AVI ' not 'WEBP'
  ]);
  expect(validateGranteeImage('fig.webp', fakeRiff).ok).toBe(false);
});
