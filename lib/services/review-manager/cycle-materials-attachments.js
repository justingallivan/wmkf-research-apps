/**
 * Review Manager — cycle materials attachments (shared by the manual materials
 * send and the automatic release on acceptance, D46/D49).
 *
 * `fetchAttachment` moved here unchanged from send-emails-service.js.
 * `loadCycleMaterialsAttachments` is the automatic path's strict assembly: the
 * cycle's review template plus its additional attachments, and it THROWS when
 * any of them cannot be fetched. The manual send keeps its own loop, which
 * warns and continues, because a staff member sees that send happen; nobody
 * watches the automatic one, so a missing review template must stop it.
 * Do not collapse the two.
 */
import { fetchPublicBlob, isPublicBlobUrl } from '../../utils/public-blob-fetch';
import { readUploadedBlobBuffer } from '../../utils/uploaded-blob';
import { isPrivateCycleMaterialPathname } from '../../utils/cycle-material-ref';

// `ref` is either a legacy public blob URL or a private cycle-material pathname
// (cycle-materials/ prefix). Private refs are read server-side from the private
// store (Phase 1) and would otherwise be blocked by isPublicBlobUrl and silently
// dropped. `explicitFilename` (from the attachment JSON) wins when provided.
export async function fetchAttachment(ref, cache, explicitFilename) {
  if (cache.has(ref)) return cache.get(ref);

  let buffer;
  let contentType;
  let filename;

  if (isPrivateCycleMaterialPathname(ref)) {
    buffer = await readUploadedBlobBuffer({ access: 'private', pathname: ref });
    contentType = 'application/octet-stream';
    filename = explicitFilename || ref.split('/').pop() || 'attachment';
  } else {
    if (!isPublicBlobUrl(ref)) {
      console.warn('fetchAttachment blocked non-allowed URL:', ref);
      return null;
    }
    const response = await fetchPublicBlob(ref);
    if (!response.ok) return null;
    buffer = Buffer.from(await response.arrayBuffer());
    contentType = response.headers.get('content-type') || 'application/octet-stream';
    filename = explicitFilename || new URL(ref).pathname.split('/').pop() || 'attachment';
  }

  const attachment = { filename, contentType, content: buffer };
  cache.set(ref, attachment);
  return attachment;
}

/**
 * @param {{ review_template_blob_url?: string|null, additional_attachments?: object[]|null }} cycleConfig
 *   the snake_case projection send-emails-service loads for the cycle
 * @returns {Promise<Array<{ filename: string, contentType: string, content: Buffer }>>}
 * @throws when any configured attachment cannot be fetched
 */
export async function loadCycleMaterialsAttachments(cycleConfig, { fetch = fetchAttachment } = {}) {
  const cache = new Map();
  const refs = [];
  if (cycleConfig?.review_template_blob_url) refs.push({ ref: cycleConfig.review_template_blob_url });
  for (const a of Array.isArray(cycleConfig?.additional_attachments) ? cycleConfig.additional_attachments : []) {
    const ref = isPrivateCycleMaterialPathname(a?.pathname) ? a.pathname : (a?.blobUrl || a?.url);
    if (!ref) throw new Error('cycle_attachment_reference_missing');
    refs.push({ ref, filename: a.filename });
  }
  const attachments = [];
  for (const { ref, filename } of refs) {
    if (cache.has(ref)) continue;
    const attachment = await fetch(ref, cache, filename);
    if (!attachment) throw new Error('cycle_attachment_unavailable');
    attachments.push(attachment);
  }
  return attachments;
}
