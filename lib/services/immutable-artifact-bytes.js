/** Shared private immutable artifact byte transport for Dossier and Review Panel.
 * Wrappers own authorization prerequisites, pathname/ref validation, limits,
 * configuration and domain errors. No environment lookup, credential fallback,
 * persistence, batching or extra retry belongs here.
 * Read-back must use the domain reader to revalidate configuration and refs.
 */
import { createHash } from 'crypto';

export async function readVerifiedArtifact({ ref, getToken, maxBytes, fail }) {
  const { get } = await import('@vercel/blob');
  const result = await get(ref.pathname, { access: 'private', token: getToken(), useCache: false });
  if (!result?.stream) throw fail('The saved artifact is unavailable.', 404);
  const reader = result.stream.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw fail('Artifact exceeds the download limit.', 413); }
      chunks.push(Buffer.from(next.value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== ref.sha256 || bytes.length !== ref.size) throw fail('The saved artifact failed its integrity check.', 502);
  return bytes;
}

export async function writeImmutableArtifact({ ref, bytes, token, fail, readBack }) {
  const { put } = await import('@vercel/blob');
  try {
    const result = await put(ref.pathname, bytes, { access: 'private', token, contentType: ref.contentType, addRandomSuffix: false, allowOverwrite: false });
    if (result.pathname !== ref.pathname) throw fail('Storage returned an unexpected artifact identity.', 502);
  } catch (error) {
    // The domain reader rechecks configuration; never reuse the captured token.
    // Retry/lost response: only the exact previously written bytes are success.
    try { await readBack(ref); } catch { throw error; }
  }
  return ref;
}
