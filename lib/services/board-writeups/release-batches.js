/** Additive version-1 journal batches. Older releases have no batch and never backfill email. */
import { RESEARCH_BOARD_MATERIALS_TARGET as TARGET } from '../sharepoint-target-registry.js';
import { fail } from './model.js';

/** A failed/held/unknown member waits for recovery. Reapproval belongs to a new batch. */
export function releasedBatch(state, batchId) {
  const batch = state.releaseBatches?.[batchId];
  if (!batch?.requestIds?.length) return null;
  const releases = [];
  for (const id of batch.requestIds) {
    const row = state.releases[id];
    if (!row) return null;
    if (row.batchId !== batchId || row.state === 'cancelled') continue;
    if (!row.releasedAt || row.state !== 'released') return null;
    releases.push(row);
  }
  return releases.length ? { ...batch, releases } : null;
}

/** Link only the live registered cycle folder containing these verified copies. */
export function batchFolderUrl(cycle, batch, folder) {
  let url;
  try { url = new URL(folder?.webUrl); } catch { fail('board_batch_folder_unavailable'); }
  const root = new URL(TARGET.webUrl);
  if (url.protocol !== 'https:' || url.origin !== root.origin || url.username || url.password || url.search || url.hash
    || decodeURIComponent(url.pathname) !== `${decodeURIComponent(root.pathname)}/${cycle}`
    || folder.driveId !== TARGET.driveId || folder.siteId !== TARGET.siteId
    || !batch.releases.every(row => row.folder?.folderId === folder.folderId && row.folder?.driveId === folder.driveId && row.destination?.driveId === folder.driveId)) {
    fail('board_batch_folder_changed', 'The Board folder needs administrator attention.');
  }
  return url.href;
}
