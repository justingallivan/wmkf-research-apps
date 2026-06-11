/**
 * Server-side reader for files uploaded via the shared `FileUploaderSimple`
 * client-upload flow (Phase 1 private-blob migration).
 *
 * An uploaded-file reference looks like:
 *   { access?: 'public' | 'private', pathname?: string, url?: string,
 *     filename, size }
 *
 * - `access: 'private'` → the blob has NO auth-free public URL; it is read
 *   server-side by `pathname` with `BLOB_READ_WRITE_TOKEN` via `@vercel/blob`'s
 *   `get(pathname, { access: 'private' })`.
 * - anything else (public / legacy uploads with no `access` field) → fetched
 *   from its public `url` via `safeFetch` (back-compat during migration).
 *
 * Centralizing the read here keeps every consumer's private-read path
 * identical and is the single place a future consumer (or the shared
 * `file-loader`) plugs private reads into.
 */

import { safeFetch } from './safe-fetch.js';

/**
 * Read an uploaded-file reference into a Node Buffer.
 * @param {{access?: string, pathname?: string, url?: string, filename?: string}} file
 * @returns {Promise<Buffer>}
 */
export async function readUploadedBlobBuffer(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('readUploadedBlobBuffer: a file reference object is required');
  }

  if (file.access === 'private') {
    if (!file.pathname) {
      throw new Error('readUploadedBlobBuffer: private file reference requires a pathname');
    }
    // Private blobs live in a DEDICATED private store, NOT the public shared
    // store bound to BLOB_READ_WRITE_TOKEN. Reading a private blob with the
    // public token fails at the Blob API layer (see docs/CREDENTIALS_RUNBOOK.md
    // "Private Blob store provisioning"). Fail closed if the private-store token
    // is not configured rather than silently falling back to the public store.
    const token = process.env.UPLOADS_BLOB_RW_TOKEN;
    if (!token) {
      throw new Error(
        'readUploadedBlobBuffer: UPLOADS_BLOB_RW_TOKEN is not set — cannot read private uploads',
      );
    }
    // Lazy-import @vercel/blob so consumers that only ever do public/legacy
    // reads (and their tests) don't pull the SDK + undici into their graph.
    const { get: getBlob } = await import('@vercel/blob');
    const result = await getBlob(file.pathname, { access: 'private', token });
    if (!result) {
      throw new Error(`readUploadedBlobBuffer: private blob not found: ${file.pathname}`);
    }
    // `get()` returns a web ReadableStream; collect it into a Node Buffer.
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  // Public or legacy reference — fetch the auth-free URL through the SSRF allowlist.
  if (!file.url) {
    throw new Error('readUploadedBlobBuffer: public file reference requires a url');
  }
  const resp = await safeFetch(file.url);
  if (!resp.ok) {
    throw new Error(`readUploadedBlobBuffer: failed to fetch uploaded file (${resp.status})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}
