import crypto from 'node:crypto';

const REFERENCE_CONTEXT = 'assemblyai-transcription-upload-reference-v1';
const CALLBACK_CONTEXT = 'transcription-callback:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC_HEX = /^[0-9a-f]{64}$/;

function deriveReferenceKey(secret = process.env.TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY) {
  const value = String(secret || '');
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY is not configured');
  }
  return Buffer.from(crypto.hkdfSync(
    'sha256', Buffer.from(value, 'utf8'), Buffer.alloc(0), Buffer.from(REFERENCE_CONTEXT, 'utf8'), 32,
  ));
}

export function sealProviderUploadReference(reference, secret) {
  const value = String(reference || '');
  if (!value) throw new Error('Provider upload reference is required');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveReferenceKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openProviderUploadReference(sealed, secret) {
  const bytes = Buffer.from(String(sealed || ''), 'base64');
  if (bytes.length <= IV_BYTES + TAG_BYTES) throw new Error('Provider upload reference is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveReferenceKey(secret), bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

export function createAssemblyAIWebhookAuth(correlationId, secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
  const id = String(correlationId || '');
  const key = String(secret || '');
  if (!CORRELATION_ID.test(id)) throw new Error('Canonical attempt correlation id is required');
  if (Buffer.byteLength(key, 'utf8') < 32) throw new Error('ASSEMBLYAI_WEBHOOK_SECRET is not configured');
  return crypto.createHmac('sha256', key).update(`${CALLBACK_CONTEXT}${id}`, 'utf8').digest('hex');
}

export function verifyAssemblyAIWebhookAuth(correlationId, provided, secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
  const id = String(correlationId || '');
  const supplied = String(provided || '');
  const key = String(secret || '');
  if (!CORRELATION_ID.test(id) || !HMAC_HEX.test(supplied) || Buffer.byteLength(key, 'utf8') < 32) return false;
  const expected = createAssemblyAIWebhookAuth(id, key);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

/** Named guard identity for the route-security matrix and checker. */
export function verifyAssemblyAIWebhook(correlationId, provided, secret) {
  return verifyAssemblyAIWebhookAuth(correlationId, provided, secret);
}

export const TRANSCRIPTION_REFERENCE_KEY_CONTEXT = REFERENCE_CONTEXT;
