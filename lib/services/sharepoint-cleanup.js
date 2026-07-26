/**
 * Shared SharePoint rollback helper.
 *
 * Extracted from review-upload.js so the reviewer-upload and grantee-upload
 * services share one best-effort cleanup path (no copy-paste drift). Deletes
 * the given uploaded Graph items; used to roll back orphan files when a later
 * step (e.g. the Dataverse PATCH) fails after the upload succeeded.
 *
 * Best-effort: per-item failures are logged and swallowed so the caller's own
 * error path still reaches the client. The detailed helper preserves exact
 * per-item outcomes for destructive audit trails; the original boolean helper
 * remains the compatibility contract for upload rollback callers.
 */

import { GraphService } from './graph-service.js';

/**
 * @param {string} driveId - the SharePoint drive id (from GraphService.getDriveId)
 * @param {Array<{id:string,name?:string}>} items - uploaded Graph items to delete
 * @param {string} [label='sharepoint-cleanup'] - log prefix for the calling surface
 * @returns {Promise<boolean>} true iff all deletes succeeded
 */
export async function cleanupSharePointItems(driveId, items, label = 'sharepoint-cleanup') {
  const result = await cleanupSharePointItemsDetailed(driveId, items, label);
  return result.failed.length === 0;
}

/**
 * Delete Graph items best-effort while retaining exact success/failure
 * attribution for callers that write durable cleanup audit records.
 *
 * @returns {Promise<{
 *   deleted:Array<{id:string,name?:string}>,
 *   failed:Array<{id:string,name?:string,error:string}>
 * }>}
 */
export async function cleanupSharePointItemsDetailed(
  driveId,
  items,
  label = 'sharepoint-cleanup',
) {
  const deleted = [];
  const failed = [];
  if (!driveId || !Array.isArray(items) || items.length === 0) {
    return { deleted, failed };
  }
  for (const item of items) {
    try {
      await GraphService.deleteFile(driveId, item.id);
      deleted.push(item);
    } catch (e) {
      const error = e?.message || String(e);
      failed.push({ ...item, error });
      console.error(`[${label}] cleanup failed for ${item?.name} (${item?.id}): ${error}`);
    }
  }
  return { deleted, failed };
}
