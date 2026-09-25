/** Preview-proof file identity helpers plus compatibility transport exports. */

export {
  GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
  nextExpectedStart,
  uploadBrowserDirectGraphFile as uploadPresentationMediaProofFile,
  withGraphBrowserUploadLock,
} from './graph-browser-upload';

const FINGERPRINT_EDGE_BYTES = 1024 * 1024;

/** Bind a resumed local file to its size and edge bytes without reading the full MP4. */
export async function fingerprintPresentationMediaProofFile(file, subtle = globalThis.crypto?.subtle) {
  if (!file || !Number.isInteger(file.size) || file.size <= 0 || !subtle?.digest) {
    throw new Error('The selected file cannot be verified for resume.');
  }
  const edge = Math.min(file.size, FINGERPRINT_EDGE_BYTES);
  const [first, last] = await Promise.all([
    file.slice(0, edge).arrayBuffer(),
    file.slice(file.size - edge, file.size).arrayBuffer(),
  ]);
  const prefix = new TextEncoder().encode(`${file.size}:`);
  const input = new Uint8Array(prefix.byteLength + first.byteLength + last.byteLength);
  input.set(prefix);
  input.set(new Uint8Array(first), prefix.byteLength);
  input.set(new Uint8Array(last), prefix.byteLength + first.byteLength);
  const digest = new Uint8Array(await subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
