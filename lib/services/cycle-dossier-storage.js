/** Private immutable dossier bytes. Only server-owned, persisted references may
 * reach readers. Shared byte transport lives in immutable-artifact-bytes.js;
 * this wrapper retains dossier configuration and path validation. Routes authorize the entry/edition separately before reading.
 */
import { createHash } from 'crypto';
import { readVerifiedArtifact, writeImmutableArtifact } from './immutable-artifact-bytes';
import { dossierError } from './cycle-dossier-store';
const MAX_BYTES = 30 * 1024 * 1024;
export const dossierDigest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function assertDossierStorageConfigured() {
  if (!process.env.DOSSIER_BLOB_READ_WRITE_TOKEN) throw dossierError('The private dossier store has not been configured.', 503);
  return process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;
}
export async function readDossierFile(ref) {
  if (typeof ref?.pathname !== 'string' || !ref.pathname.startsWith('cycle-dossier/') || ref.pathname.includes('..') || !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || !Number.isInteger(ref.size) || ref.size < 0 || ref.size > MAX_BYTES) throw dossierError('Invalid saved artifact reference.');
  return readVerifiedArtifact({ ref, getToken: assertDossierStorageConfigured, maxBytes: MAX_BYTES, fail: dossierError });
}
export async function storeDossierFile(pathname, bytes, contentType) {
  if (!pathname.startsWith('cycle-dossier/') || pathname.includes('..') || !Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw dossierError('Invalid dossier artifact.', 413);
  const token = assertDossierStorageConfigured();
  const ref = { pathname, sha256: dossierDigest(bytes), size: bytes.length, contentType };
  return writeImmutableArtifact({ ref, bytes, token, fail: dossierError, readBack: readDossierFile });
}
export const storeDossierJSON = (path, value) => storeDossierFile(path, Buffer.from(JSON.stringify(value)), 'application/json');
export const readDossierJSON = async ref => JSON.parse((await readDossierFile(ref)).toString('utf8'));
