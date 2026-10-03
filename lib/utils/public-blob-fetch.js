/**
 * Legacy public-file transport: unauthenticated GETs to Vercel's public Blob
 * CDN only. No caller-supplied request options and no redirects are accepted.
 * This is a storage-destination boundary, not record/owner authorization.
 * Private Blob reads and authenticated provider/Graph calls use other helpers.
 */
const PUBLIC_BLOB_HOST = /^([a-z0-9]+)\.public\.blob\.vercel-storage\.com$/;

function publicBlobUrl(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid public Blob URL');
  const parsed = new URL(value);
  const host = PUBLIC_BLOB_HOST.exec(parsed.hostname);
  if (parsed.protocol !== 'https:' || !host || parsed.username || parsed.password || parsed.port) {
    throw new TypeError('Invalid public Blob URL');
  }
  // Construct the authority independently of the supplied URL. Assigning
  // pathname/search cannot replace this origin, even for paths starting '//'.
  // Keep the parsed URL's escaped path/query bytes; decoding/re-encoding can alter
  // legacy filenames or signatures. Fragments are not part of an HTTP request.
  const target = new URL(`https://${encodeURIComponent(host[1])}.public.blob.vercel-storage.com/`);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  return target.href;
}

export function isPublicBlobUrl(value) {
  try { publicBlobUrl(value); return true; } catch { return false; }
}

/** Return the normal fetch Response; callers retain their existing HTTP handling. */
export async function fetchPublicBlob(value) {
  const url = publicBlobUrl(value);
  const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit' });
  if (response.status >= 300 && response.status < 400) {
    try { await response.body?.cancel?.(); } catch { /* Best-effort release of rejected response. */ }
    throw new Error('Public Blob redirects are not allowed');
  }
  return response;
}
