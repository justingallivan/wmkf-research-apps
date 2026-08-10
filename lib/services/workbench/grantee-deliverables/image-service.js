/**
 * Grantee deliverable image read service (S411 increment 2).
 *
 * Streams the grantee-uploaded award image to the staff Awardee tab so it renders
 * in the app instead of only linking out to SharePoint. The link stays as a
 * fallback; this is additive.
 *
 * WHY A PATH LOOKUP AND NOT AN ITEM ID: the writer stores
 * `wmkf_imagefileref = uploadedItem.webUrl || \`${folder}/${filename}\``
 * (lib/services/grantee-upload.js:121). Neither form carries drive/item identity,
 * so `GraphService.downloadFile(driveId, itemId)` cannot be addressed from the
 * stored value. The folder is therefore RE-DERIVED from the request row via the
 * writer's own exported `granteeUploadFolder`, and only the FILENAME is taken
 * from the ref. Persisting drive/item IDs at upload time would be the better
 * contract, but that is a Dataverse schema change and is deliberately not done
 * here.
 *
 * TRUST: the filename is the one piece of this path that comes from stored data,
 * so it is matched against the exact server-controlled pattern the writer emits
 * (`{reqNum}_grantee_image_{8 hex}.{png|jpg|webp}`) and rejected otherwise. That
 * kills traversal (`..`, absolute paths, embedded separators) and any surprise
 * extension by construction rather than by escaping. The served Content-Type is
 * derived from that validated extension — never from the ref, and never from
 * Graph's reported mimeType — and the bytes are re-sniffed before returning, so
 * what we label is what we send.
 */

import { GraphService } from '../../graph-service.js';
import { GRANTEE_LIBRARY, granteeUploadFolder } from '../../grantee-upload.js';
import { sniffImageType } from '../../../utils/file-magic.js';
import { getDeliverableForRequest } from '../../grantee-deliverable-record.js';
import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../../service-http-error.js';

const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum';

// Exactly what lib/services/grantee-upload.js:108 emits. `ext` is the canonical
// stored extension (jpeg is stored as .jpg — see validateGranteeImage).
const STORED_IMAGE_NAME = /^[A-Za-z0-9-]{1,64}_grantee_image_[0-9a-f]{8}\.(png|jpg|webp)$/;

// Validated extension -> what we serve. The only three types the writer accepts.
const EXT_CONTENT_TYPE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
// Validated extension -> what the bytes must actually sniff as.
const EXT_SNIFFED_TYPE = { png: 'png', jpg: 'jpeg', webp: 'webp' };

/**
 * Last path segment of a stored image ref, whether it is an absolute webUrl or a
 * relative library path. Returns null when the ref yields nothing usable.
 *
 * A webUrl's segment is percent-encoded, so it is decoded before matching; a
 * malformed escape decodes to null rather than throwing.
 */
export function imageFilenameFromRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const trimmed = ref.trim();
  // Strip any query/fragment a webUrl may carry, then take the last segment of
  // either separator style.
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const last = withoutQuery.split(/[/\\]/).filter(Boolean).pop();
  if (!last) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    return null; // malformed percent-encoding
  }
  return STORED_IMAGE_NAME.test(decoded) ? decoded : null;
}

/**
 * Fetch the grantee image bytes for a request.
 *
 * @param {{ requestId: string }} args - requestId is GUID-validated by the route.
 * @returns {Promise<{ buffer: Buffer, contentType: string, filename: string }>}
 * @throws {ServiceHttpError} 404 no request / no package / no image / an
 *   unrecognized stored ref; 502 when SharePoint cannot produce the bytes.
 */
export async function loadGranteeImage({ requestId }) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid || !row?.akoya_requestnum) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const deliverable = await getDeliverableForRequest(requestId);
  const ref = deliverable?.wmkf_imagefileref || null;
  if (!ref) {
    throw new ServiceHttpError('No image on this deliverable.', { httpStatus: 404 });
  }

  const filename = imageFilenameFromRef(ref);
  if (!filename) {
    // A ref that does not match the writer's pattern is not something we will go
    // fetch. Staff still have the SharePoint link in the UI for this case.
    console.warn('[grantee-deliverables/image] unrecognized stored ref shape; refusing to fetch');
    throw new ServiceHttpError('Image reference is not in a recognized format.', { httpStatus: 404 });
  }

  const folder = granteeUploadFolder(row.akoya_requestnum, row.akoya_requestid);

  let file;
  try {
    file = await GraphService.downloadFileByPath(GRANTEE_LIBRARY, folder, filename);
  } catch (e) {
    // Includes the clean "file not found" case: Graph 404s are thrown, not null.
    console.error('[grantee-deliverables/image] sharepoint fetch failed:', e.message);
    throw new ServiceHttpError('Could not fetch the image from SharePoint.', { httpStatus: 502 });
  }

  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ServiceHttpError('Could not fetch the image from SharePoint.', { httpStatus: 502 });
  }

  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  // Defence in depth: serve the type we can prove, not the one the name claims.
  // The writer magic-checked these bytes at upload; re-checking here means a
  // later out-of-band replacement in the library cannot make us mislabel content.
  if (sniffImageType(buffer) !== EXT_SNIFFED_TYPE[ext]) {
    console.error('[grantee-deliverables/image] stored bytes do not match the stored extension');
    throw new ServiceHttpError('Stored image failed its content check.', { httpStatus: 502 });
  }

  return { buffer, contentType: EXT_CONTENT_TYPE[ext], filename };
}
