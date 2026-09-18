import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  GOVERNED_DOCX_HASH_PREFIX,
  hashGovernedDocxContent,
} from '../documents/governed-docx-hash.js';
import { parseOrphanCleanup, sha256, sanitizeError } from './artifact-model.js';
import {
  commitReadyLineage,
  conditionalOptions,
  rereadByGenerationKey,
} from './artifact-lineage.js';

async function recordOrphanCleanup(
  generationKey,
  uploaded,
  cleanupError,
  actingUserSystemId = null,
  reason = 'claim_lost_delete_failed',
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const current = await rereadByGenerationKey(generationKey);
    if (!current) break;
    const existing = parseOrphanCleanup(current.wmkf_orphancleanupjson);
    const overflow = parseOrphanCleanup(current.wmkf_orphancleanupoverflowjson);
    if ([...existing, ...overflow].some((item) => (
      item.driveId === uploaded.driveId
      && item.itemId === uploaded.id
      && item.reason === reason
    ))) {
      return;
    }
    const entry = {
      driveId: uploaded.driveId,
      itemId: uploaded.id,
      name: uploaded.name || null,
      recordedAt: new Date().toISOString(),
      reason,
      error: sanitizeError(cleanupError).message.slice(0, 1000),
    };
    const queue = [...existing, entry];
    const value = JSON.stringify(queue);
    const overflowed = overflow.length > 0 || value.length > 10000;
    const patch = overflowed
      ? { wmkf_orphancleanupoverflowjson: JSON.stringify([...overflow, entry]) }
      : { wmkf_orphancleanupjson: value };
    try {
      await requestDocumentAdapter.update(
        current.wmkf_requestdocumentid,
        patch,
        conditionalOptions(current, actingUserSystemId),
      );
      if (!overflowed) return;
      throw new ServiceHttpError(
        'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
        {
          httpStatus: 500,
          body: {
            error: 'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
            code: 'orphan_cleanup_capacity_exceeded',
          },
        },
      );
    } catch (error) {
      if (error?.status === 412) continue;
      throw error;
    }
  }
  throw new Error('Unable to persist claim-lost SharePoint cleanup work.');
}

export async function cleanupSupersededUpload(
  uploaded,
  generationKey,
  actingUserSystemId = null,
  {
    reason = 'claim_lost_delete_failed',
    errorCode = 'claim_lost_cleanup_required',
    message = 'A superseded Initial Assessment upload could not be removed from SharePoint.',
  } = {},
) {
  try {
    await GraphService.deleteFile(uploaded.driveId, uploaded.id);
    return;
  } catch (error) {
    await recordOrphanCleanup(
      generationKey,
      uploaded,
      error,
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      message,
      {
        httpStatus: 500,
        body: {
          error: message,
          code: errorCode,
        },
        cause: error,
      },
    );
  }
}

export async function recoverUploadedFile(row, claimToken, actingUserSystemId = null) {
  if (!row.wmkf_contenthash || !row.wmkf_sharepointfolderpath || !row.wmkf_filename) {
    return null;
  }
  const metadata = await GraphService.getFileMetadataByPath(
    'akoya_request',
    row.wmkf_sharepointfolderpath,
    row.wmkf_filename,
  );
  if (!metadata) return null;
  const downloaded = await GraphService.downloadFile(metadata.driveId, metadata.id);
  let downloadedHash;
  try {
    downloadedHash = await hashGovernedDocxContent(downloaded.buffer);
  } catch (error) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      error,
      actingUserSystemId,
      'invalid_docx_retained',
    );
    return null;
  }
  const storedHash = String(row.wmkf_contenthash);
  if (!storedHash.startsWith(GOVERNED_DOCX_HASH_PREFIX)) {
    if (/^[a-f0-9]{64}$/i.test(storedHash) && sha256(downloaded.buffer) === storedHash) {
      return commitReadyLineage(row, {
        metadata,
        claimToken,
        actingUserSystemId,
      });
    }
    const legacy = /^[a-f0-9]{64}$/i.test(storedHash);
    const reason = legacy
      ? 'legacy_content_hash_unverifiable_retained'
      : 'unknown_content_hash_scheme_retained';
    const code = legacy
      ? 'legacy_content_hash_unverifiable'
      : 'unknown_content_hash_scheme';
    const message = legacy
      ? 'The prior upload uses a legacy whole-package hash that cannot verify SharePoint-normalized content.'
      : 'The prior upload uses an unknown content-hash scheme.';
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error(message),
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      `${message} Operator reconciliation is required before retrying.`,
      {
        httpStatus: 409,
        body: {
          error: `${message} Operator reconciliation is required before retrying.`,
          code,
        },
      },
    );
  }
  if (downloadedHash !== storedHash) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error('The prior upload content hash no longer matches the governed producer output.'),
      actingUserSystemId,
      'content_hash_mismatch_retained',
    );
    return null;
  }
  return commitReadyLineage(row, {
    metadata,
    claimToken,
    actingUserSystemId,
  });
}
