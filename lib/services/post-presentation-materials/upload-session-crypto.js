/** Purpose-separated encryption for durable preauthenticated Graph upload URLs. */
import crypto from 'node:crypto';

const CONTEXT = 'presentation-upload-session-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(secretValue = process.env.EXTERNAL_LINK_SECRET) {
  const secret = String(secretValue || '');
  if (secret.length < 32) throw new Error('EXTERNAL_LINK_SECRET is not configured for presentation uploads');
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.alloc(0),
    Buffer.from(CONTEXT, 'utf8'),
    32,
  ));
}
export function sealPresentationUploadUrl(value, secretValue) {
  const plaintext = String(value || '');
  if (!plaintext) throw new Error('A Graph upload URL is required');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secretValue), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openPresentationUploadUrl(value, secretValue) {
  const bytes = Buffer.from(String(value || ''), 'base64');
  if (bytes.length <= IV_BYTES + TAG_BYTES) throw new Error('The sealed Graph upload URL is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(secretValue), bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
