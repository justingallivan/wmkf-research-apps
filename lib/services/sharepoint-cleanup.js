/**
 * Shared SharePoint rollback helper.
 *
 * Extracted from review-upload.js so the reviewer-upload and grantee-upload
 * services share one best-effort cleanup path (no copy-paste drift). Deletes
 * the given uploaded Graph items; used to roll back orphan files when a later
 * step (e.g. the Dataverse PATCH) fails after the upload succeeded.
 *
 * Best-effort: per-item failures are logged and swallowed so the caller's own
 * error path still reaches the client. Returns true iff every delete succeeded.
 */

import { GraphService } from './graph-service.js';

/**
 * @param {string} driveId - the SharePoint drive id (from GraphService.getDriveId)
 * @param {Array<{id:string,name?:string}>} items - uploaded Graph items to delete
 * @param {string} [label='sharepoint-cleanup'] - log prefix for the calling surface
 * @returns {Promise<boolean>} true iff all deletes succeeded
 */
export async function cleanupSharePointItems(driveId, items, label = 'sharepoint-cleanup') {
  if (!driveId || !Array.isArray(items) || items.length === 0) return true;
  let allOk = true;
  for (const item of items) {
    try {
      await GraphService.deleteFile(driveId, item.id);
    } catch (e) {
      allOk = false;
      console.error(`[${label}] cleanup failed for ${item?.name} (${item?.id}): ${e.message}`);
    }
  }
  return allOk;
}
