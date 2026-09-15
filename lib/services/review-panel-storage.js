/** Private immutable review-panel bytes (D11: a dedicated Blob store, not a
 * prefix inside the dossier store). Only server-owned, persisted references
 * may reach readers. Routes authorize the entry separately before reading.
 * Parameterised clone of cycle-dossier-storage.js — same integrity contract
 * (SHA-256 + size verified on write and on read), pointed at the panel's own
 * token/store instead of DOSSIER_BLOB_READ_WRITE_TOKEN.
 */
import { createHash } from 'crypto';
import { reviewPanelError } from './review-panel-store';

const MAX_BYTES = 30 * 1024 * 1024;

// Every other store's own token env var, so the panel's dedicated store
// (D11) can never accidentally reuse one of them. Checked by VALUE, not by
// name — deliberately not deriving or validating the store id from the
// token's bytes (scripts/check-cycle-dossier-rollout.js's blob readiness
// check is presence-only too).
const OTHER_STORE_TOKEN_ENV_VARS = Object.freeze([
  'DOSSIER_BLOB_READ_WRITE_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'INTAKE_BLOB_RW_TOKEN', 'UPLOADS_BLOB_RW_TOKEN',
]);

export const reviewPanelDigest = (value) =>
  createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

/**
 * 503 with plain copy when the panel's dedicated Blob store isn't fully and
 * distinctly configured. Requires BOTH
 * `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` and `REVIEW_PANEL_BLOB_STORE_ID` to be
 * present and non-blank — mirrors scripts/check-cycle-dossier-rollout.js's
 * blob readiness check, which requires the dossier's own token AND store id
 * pair the same way. Also refuses if the token value is identical to any
 * OTHER store's token env var (a copy/paste or unset-fallback mistake would
 * otherwise silently write the panel's private editions into someone else's
 * store under that store's own access rules).
 */
export function assertReviewPanelStorageConfigured() {
  const token = String(process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN || '').trim();
  const storeId = String(process.env.REVIEW_PANEL_BLOB_STORE_ID || '').trim();
  if (!token || !storeId) {
    throw reviewPanelError('The private review panel document store has not been configured.', 503);
  }
  for (const otherVar of OTHER_STORE_TOKEN_ENV_VARS) {
    const otherToken = String(process.env[otherVar] || '').trim();
    if (otherToken && otherToken === token) {
      throw reviewPanelError("The review panel store token must not reuse another store's token.", 503);
    }
  }
  return token;
}

export async function readReviewPanelFile(ref) {
  if (typeof ref?.pathname !== 'string' || !ref.pathname.startsWith('review-panel/') || ref.pathname.includes('..')
    || !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || !Number.isInteger(ref.size) || ref.size < 0 || ref.size > MAX_BYTES) {
    throw reviewPanelError('Invalid saved artifact reference.');
  }
  const { get } = await import('@vercel/blob');
  const result = await get(ref.pathname, { access: 'private', token: assertReviewPanelStorageConfigured(), useCache: false });
  if (!result?.stream) throw reviewPanelError('The saved artifact is unavailable.', 404);
  const reader = result.stream.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw reviewPanelError('Artifact exceeds the download limit.', 413); }
      chunks.push(Buffer.from(next.value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (reviewPanelDigest(bytes) !== ref.sha256 || bytes.length !== ref.size) throw reviewPanelError('The saved artifact failed its integrity check.', 502);
  return bytes;
}

export async function storeReviewPanelFile(pathname, bytes, contentType) {
  if (!pathname.startsWith('review-panel/') || pathname.includes('..') || !Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) {
    throw reviewPanelError('Invalid review panel artifact.', 413);
  }
  const token = assertReviewPanelStorageConfigured();
  const ref = { pathname, sha256: reviewPanelDigest(bytes), size: bytes.length, contentType };
  const { put } = await import('@vercel/blob');
  try {
    const result = await put(pathname, bytes, { access: 'private', token, contentType, addRandomSuffix: false, allowOverwrite: false });
    if (result.pathname !== pathname) throw reviewPanelError('Storage returned an unexpected artifact identity.', 502);
  } catch (error) {
    // Retry/lost response: only the exact previously written bytes are success.
    try { await readReviewPanelFile(ref); } catch { throw error; }
  }
  return ref;
}

export const storeReviewPanelJSON = (path, value) => storeReviewPanelFile(path, Buffer.from(JSON.stringify(value)), 'application/json');
export const readReviewPanelJSON = async (ref) => JSON.parse((await readReviewPanelFile(ref)).toString('utf8'));
