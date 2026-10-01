import {
  createAssemblyAIWebhookAuth,
  openProviderUploadReference,
  sealProviderUploadReference,
  verifyAssemblyAIWebhookAuth,
} from '../../lib/services/transcription-pilot/crypto';

const SECRET = 't'.repeat(48);
const CORRELATION_ID = '9d2716e0-1b78-4bf4-90e2-5d06c331c824';

describe('transcription pilot cryptographic bindings', () => {
  test('seals upload references with authenticated encryption and round-trips only with the same key', () => {
    const reference = 'https://upload.assemblyai.com/private/upload-reference';
    const sealed = sealProviderUploadReference(reference, SECRET);
    expect(sealed).not.toContain(reference);
    expect(openProviderUploadReference(sealed, SECRET)).toBe(reference);
    expect(() => openProviderUploadReference(sealed, 'r'.repeat(48))).toThrow();
    expect(() => openProviderUploadReference(`${sealed.slice(0, -4)}AAAA`, SECRET)).toThrow();
  });

  test('derives a per-attempt HMAC and verifies before any row lookup can occur', () => {
    const auth = createAssemblyAIWebhookAuth(CORRELATION_ID, SECRET);
    expect(auth).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAssemblyAIWebhookAuth(CORRELATION_ID, auth, SECRET)).toBe(true);
    expect(verifyAssemblyAIWebhookAuth(CORRELATION_ID, auth, 'x'.repeat(48))).toBe(false);
    expect(verifyAssemblyAIWebhookAuth('not-a-canonical-id', auth, SECRET)).toBe(false);
    expect(verifyAssemblyAIWebhookAuth(CORRELATION_ID, `${auth.slice(0, -1)}0`, SECRET)).toBe(false);
  });

  test('does not create callback authentication for malformed IDs or missing secrets', () => {
    expect(() => createAssemblyAIWebhookAuth('unknown', SECRET)).toThrow();
    expect(() => createAssemblyAIWebhookAuth(CORRELATION_ID, '')).toThrow();
    expect(() => sealProviderUploadReference('ref', 'short')).toThrow();
  });
});
