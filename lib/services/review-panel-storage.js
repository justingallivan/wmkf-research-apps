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

export const reviewPanelDigest = (value) =>
  createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

/** 503 with plain copy when the panel's dedicated Blob token is unset (D11 store not yet provisioned). */
export function assertReviewPanelStorageConfigured() {
  if (!process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN) {
    throw reviewPanelError('The private review panel document store has not been configured.', 503);
  }
  return process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN;
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
