/** Private immutable dossier bytes. Only server-owned, persisted references may
 * reach readers. Routes authorize the entry/edition separately before reading.
 */
import { createHash } from 'crypto';
import { dossierError } from './cycle-dossier-store';
const MAX_BYTES = 30 * 1024 * 1024;
export const dossierDigest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function assertDossierStorageConfigured() {
  if (!process.env.DOSSIER_BLOB_READ_WRITE_TOKEN) throw dossierError('The private dossier store has not been configured.', 503);
  return process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;
}
export async function readDossierFile(ref) {
  if (typeof ref?.pathname !== 'string' || !ref.pathname.startsWith('cycle-dossier/') || ref.pathname.includes('..') || !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || !Number.isInteger(ref.size) || ref.size < 0 || ref.size > MAX_BYTES) throw dossierError('Invalid saved artifact reference.');
  const { get } = await import('@vercel/blob');
  const result = await get(ref.pathname, { access: 'private', token: assertDossierStorageConfigured(), useCache: false });
  if (!result?.stream) throw dossierError('The saved artifact is unavailable.', 404);
  const reader = result.stream.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw dossierError('Artifact exceeds the download limit.', 413); }
      chunks.push(Buffer.from(next.value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (dossierDigest(bytes) !== ref.sha256 || bytes.length !== ref.size) throw dossierError('The saved artifact failed its integrity check.', 502);
  return bytes;
}
export async function storeDossierFile(pathname, bytes, contentType) {
  if (!pathname.startsWith('cycle-dossier/') || pathname.includes('..') || !Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw dossierError('Invalid dossier artifact.', 413);
  const token = assertDossierStorageConfigured();
  const ref = { pathname, sha256: dossierDigest(bytes), size: bytes.length, contentType };
  const { put } = await import('@vercel/blob');
  try {
    const result = await put(pathname, bytes, { access: 'private', token, contentType, addRandomSuffix: false, allowOverwrite: false });
    if (result.pathname !== pathname) throw dossierError('Storage returned an unexpected artifact identity.', 502);
  } catch (error) {
    // Retry/lost response: only the exact previously written bytes are success.
    try { await readDossierFile(ref); } catch { throw error; }
  }
  return ref;
}
export const storeDossierJSON = (path, value) => storeDossierFile(path, Buffer.from(JSON.stringify(value)), 'application/json');
export const readDossierJSON = async ref => JSON.parse((await readDossierFile(ref)).toString('utf8'));
