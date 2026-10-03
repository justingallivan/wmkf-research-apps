/** @jest-environment node */
import {
  openPresentationUploadUrl,
  sealPresentationUploadUrl,
} from '../../lib/services/post-presentation-materials/upload-session-crypto.js';

const SECRET = 's'.repeat(64);

test('Graph upload URL round-trips through purpose-separated authenticated encryption', () => {
  const url = 'https://tenant.up.1drv.com/up/session-secret';
  const sealed = sealPresentationUploadUrl(url, SECRET);
  expect(sealed).not.toContain('session-secret');
  expect(sealed).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  expect(openPresentationUploadUrl(sealed, SECRET)).toBe(url);
});
test('tampering and the wrong secret fail closed', () => {
  const sealed = sealPresentationUploadUrl('https://upload.example/session', SECRET);
  const bytes = Buffer.from(sealed, 'base64');
  bytes[bytes.length - 1] ^= 1;
  expect(() => openPresentationUploadUrl(bytes.toString('base64'), SECRET)).toThrow();
  expect(() => openPresentationUploadUrl(sealed, 'x'.repeat(64))).toThrow();
});

test('short secrets are rejected instead of falling back', () => {
  expect(() => sealPresentationUploadUrl('https://upload.example/session', 'short')).toThrow(
    'EXTERNAL_LINK_SECRET is not configured for presentation uploads',
  );
});
