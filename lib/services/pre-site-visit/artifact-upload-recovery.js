import { conditionalOptions, sanitizeError, parseCleanupQueue } from './artifact-model.js';
import {
  commitReadyLineage,
  rereadByGenerationKey,
} from './artifact-lineage.js';

async function recordCleanup(row, metadata, reason, error, actingUserSystemId, dependencies) {
  const current = await rereadByGenerationKey(row.wmkf_generationkey, dependencies);
  if (!current) return;
  const existing = parseCleanupQueue(current.wmkf_orphancleanupjson);
  const overflow = parseCleanupQueue(current.wmkf_orphancleanupoverflowjson);
  if ([...existing, ...overflow].some((item) => (
    item.driveId === metadata.driveId && item.itemId === metadata.id
  ))) return;
  const entry = {
    driveId: metadata.driveId,
    itemId: metadata.id,
    name: metadata.name || null,
    recordedAt: new Date().toISOString(),
    reason,
    error: sanitizeError(error).message.slice(0, 1000),
  };
  const primary = JSON.stringify([...existing, entry]);
  const patch = primary.length <= 10000 && overflow.length === 0
    ? { wmkf_orphancleanupjson: primary }
    : { wmkf_orphancleanupoverflowjson: JSON.stringify([...overflow, entry]) };
  await dependencies.updateDocument(
    current.wmkf_requestdocumentid,
    patch,
    conditionalOptions(current, actingUserSystemId),
  );
}

async function recoverUploadedFile(row, claimToken, actingUserSystemId, dependencies, { expectedPointerId } = {}) {
  if (!row.wmkf_contenthash || !row.wmkf_sharepointfolderpath || !row.wmkf_filename) return null;
  const metadata = await dependencies.getFileMetadataByPath(
    'akoya_request',
    row.wmkf_sharepointfolderpath,
    row.wmkf_filename,
  );
  if (!metadata) return null;
  const downloaded = await dependencies.downloadFile(metadata.driveId, metadata.id);
  const actualHash = await dependencies.hashDocx(downloaded.buffer).catch(() => null);
  if (actualHash !== row.wmkf_contenthash) {
    await recordCleanup(
      row,
      metadata,
      'content_hash_mismatch_retained',
      new Error('Existing Pre-Site upload does not match the governed render.'),
      actingUserSystemId,
      dependencies,
    );
    return null;
  }
  return commitReadyLineage(row, { metadata, claimToken, actingUserSystemId, expectedPointerId }, dependencies);
}

export { recordCleanup, recoverUploadedFile };
