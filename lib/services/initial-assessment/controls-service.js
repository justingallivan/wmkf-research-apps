/**
 * Administrator controls for governed Initial Assessment artifacts.
 *
 * Restore mutates the canonical SharePoint item by promoting one historical
 * version to a new current version. Board freeze never mutates that item: it
 * submits the exact current bytes to a distinct retained Request Document item
 * and verifies the governed Word content after SharePoint ingestion.
 */

import crypto from 'crypto';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import {
  hashGovernedDocxContent,
  projectArtifact,
  resolveCanonicalInitialAssessment,
} from './artifact-service.js';
import {
  INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CLAIM_LEASE_MS = 15 * 60 * 1000;

const DEFAULT_DEPENDENCIES = Object.freeze({
  resolveCanonical: resolveCanonicalInitialAssessment,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  getFileVersionMetadata: (...args) => GraphService.getFileVersionMetadata(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  downloadFileVersion: (...args) => GraphService.downloadFileVersion(...args),
  restoreFileVersion: (...args) => GraphService.restoreFileVersion(...args),
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  hashDocx: hashGovernedDocxContent,
  newClaimToken: () => crypto.randomUUID(),
  now: () => new Date(),
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function controlError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function validateVersionId(value, field) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{1,300}$/.test(normalized)) {
    throw controlError(`${field} is invalid.`, 'initial_assessment_version_invalid', 400);
  }
  return normalized;
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw controlError(
      'The Initial Assessment registry row is missing its concurrency token.',
      'initial_assessment_registry_etag_missing',
      500,
    );
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function assertCanonicalFile(row, metadata) {
  if (!row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid || !metadata) {
    throw controlError(
      'The canonical Initial Assessment file could not be found in SharePoint.',
      'initial_assessment_file_missing',
      404,
    );
  }
  if (!sameId(metadata.driveId, row.wmkf_sharepointdriveid)
    || !sameId(metadata.id, row.wmkf_sharepointitemid)) {
    throw controlError(
      'SharePoint returned a different Initial Assessment file identity.',
      'initial_assessment_file_identity_mismatch',
      500,
    );
  }
  if (!metadata.versionId) {
    throw controlError(
      'SharePoint did not return the current Initial Assessment version.',
      'initial_assessment_current_version_missing',
    );
  }
}

function assertStableCanonicalRegistry(before, current, code, message) {
  if (!sameId(before.wmkf_requestdocumentid, current?.wmkf_requestdocumentid)
    || !sameId(before.wmkf_sharepointdriveid, current?.wmkf_sharepointdriveid)
    || !sameId(before.wmkf_sharepointitemid, current?.wmkf_sharepointitemid)
    || before._etag !== current?._etag) {
    throw controlError(message, code);
  }
}

async function readCurrentFile(row, dependencies) {
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  return {
    buffer: downloaded.buffer,
    contentHash: await dependencies.hashDocx(downloaded.buffer),
  };
}

async function persistRestoredMetadata(
  requestId,
  expectedArtifactId,
  metadata,
  contentHash,
  actingUserSystemId,
  dependencies,
) {
  const { request, row } = await dependencies.resolveCanonical({
    requestId,
    expectedArtifactId,
  });
  await dependencies.updateDocument(row.wmkf_requestdocumentid, {
    wmkf_sharepointversionid: metadata.versionId,
    wmkf_sharepointetag: metadata.eTag,
    wmkf_sharepointweburl: metadata.webUrl,
    wmkf_filename: metadata.name,
    wmkf_filesize: metadata.size,
    wmkf_sharepointlastmodified: metadata.lastModified,
    wmkf_contenthash: contentHash,
  }, conditionalOptions(row, actingUserSystemId));
  const verified = await dependencies.resolveCanonical({ requestId, expectedArtifactId });
  if (verified.row.wmkf_sharepointversionid !== metadata.versionId
    || verified.row.wmkf_contenthash !== contentHash) {
    throw controlError(
      'The restored Initial Assessment version was not confirmed in the registry.',
      'initial_assessment_restore_registry_mismatch',
      500,
    );
  }
  const artifact = projectArtifact(verified.row, request);
  if (artifact.file) {
    artifact.file.metadataStatus = 'current';
    artifact.file.metadataCheckedAt = dependencies.now().toISOString();
  }
  return artifact;
}

/** Restore one exact historical version as a new current SharePoint version. */
export async function restoreInitialAssessmentVersion(
  {
    requestId,
    expectedArtifactId,
    targetVersionId,
    expectedCurrentVersionId,
  },
  { actingUserSystemId = null, dependencies = DEFAULT_DEPENDENCIES } = {},
) {
  const targetVersion = validateVersionId(targetVersionId, 'targetVersionId');
  const expectedCurrent = validateVersionId(
    expectedCurrentVersionId,
    'expectedCurrentVersionId',
  );
  const { row } = await dependencies.resolveCanonical({ requestId, expectedArtifactId });
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertCanonicalFile(row, before);
  if (targetVersion === before.versionId) {
    throw controlError(
      'The selected version is already current.',
      'initial_assessment_restore_target_current',
    );
  }
  const target = await dependencies.getFileVersionMetadata(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    targetVersion,
  );
  if (!target) {
    throw controlError(
      'The selected SharePoint version no longer exists.',
      'initial_assessment_restore_target_missing',
      404,
    );
  }
  const targetBytes = await dependencies.downloadFileVersion(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    targetVersion,
  );

  if (before.versionId !== expectedCurrent) {
    const current = await readCurrentFile(row, dependencies);
    if (!current.buffer.equals(targetBytes)) {
      throw controlError(
        'The Initial Assessment changed after this history was loaded. Refresh before restoring.',
        'initial_assessment_restore_stale',
      );
    }
    const artifact = await persistRestoredMetadata(
      requestId,
      expectedArtifactId,
      before,
      current.contentHash,
      actingUserSystemId,
      dependencies,
    );
    return { artifact, restored: false, reconciled: true, targetVersionId: targetVersion };
  }

  const stable = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertCanonicalFile(row, stable);
  if (stable.versionId !== before.versionId
    || stable.eTag !== before.eTag
    || stable.lastModified !== before.lastModified
    || stable.size !== before.size) {
    throw controlError(
      'The Initial Assessment changed while the restore was being prepared. Refresh before restoring.',
      'initial_assessment_restore_stale',
    );
  }
  const confirmed = await dependencies.resolveCanonical({ requestId, expectedArtifactId });
  assertStableCanonicalRegistry(
    row,
    confirmed.row,
    'initial_assessment_restore_stale',
    'The canonical Initial Assessment changed while the restore was being prepared. Refresh before restoring.',
  );

  await dependencies.restoreFileVersion(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    targetVersion,
  );
  const after = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertCanonicalFile(row, after);
  if (after.versionId === before.versionId) {
    throw controlError(
      'SharePoint did not expose the restored version during readback.',
      'initial_assessment_restore_readback_incomplete',
      503,
    );
  }
  const restored = await readCurrentFile(row, dependencies);
  if (!restored.buffer.equals(targetBytes)) {
    throw controlError(
      'The restored SharePoint bytes did not match the selected version.',
      'initial_assessment_restore_bytes_mismatch',
      500,
    );
  }
  const artifact = await persistRestoredMetadata(
    requestId,
    expectedArtifactId,
    after,
    restored.contentHash,
    actingUserSystemId,
    dependencies,
  );
  return { artifact, restored: true, reconciled: false, targetVersionId: targetVersion };
}

function snapshotIdentity(source, sourceVersionId, sourceHash) {
  const value = {
    contract: INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.templateVersion,
    sourceArtifactId: String(source.wmkf_requestdocumentid).toLowerCase(),
    sourceVersionId,
    sourceHash,
  };
  return {
    generationKey: sha256(JSON.stringify(value)),
    inputFingerprint: sha256(JSON.stringify({ ...value, purpose: 'board-milestone' })),
  };
}

async function rereadSnapshot(generationKey, dependencies) {
  const result = await dependencies.findByGenerationKey(generationKey);
  if ((result.records || []).length > 1) {
    throw controlError(
      'Duplicate Initial Assessment Board snapshot keys require reconciliation.',
      'initial_assessment_snapshot_duplicate',
      500,
    );
  }
  return result.records?.[0] || null;
}

function snapshotClaimActive(row, now) {
  if (row?.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && now.getTime() - modifiedAt < CLAIM_LEASE_MS;
}

async function claimSnapshot(
  row,
  claimToken,
  now,
  actingUserSystemId,
  dependencies,
) {
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) return row;
  if (snapshotClaimActive(row, now)) {
    throw controlError(
      'A Board snapshot is already being created for this version.',
      'initial_assessment_snapshot_in_progress',
    );
  }
  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
    }, conditionalOptions(row, actingUserSystemId));
  } catch (error) {
    if (error?.status === 412) {
      throw controlError(
        'The Board snapshot claim changed while it was being acquired. Retry.',
        'initial_assessment_snapshot_in_progress',
      );
    }
    throw error;
  }
  const claimed = await rereadSnapshot(row.wmkf_generationkey, dependencies);
  if (!claimed) {
    throw controlError(
      'The Board snapshot row disappeared while it was being claimed.',
      'initial_assessment_snapshot_row_missing',
      500,
    );
  }
  return claimed;
}

async function assertOwnedSnapshot(generationKey, claimToken, dependencies) {
  const row = await rereadSnapshot(generationKey, dependencies);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw controlError(
      'The Board snapshot claim was superseded.',
      'initial_assessment_snapshot_claim_lost',
    );
  }
  return row;
}

async function failSnapshotIfOwned(
  generationKey,
  claimToken,
  error,
  actingUserSystemId,
  dependencies,
  retainedItem = null,
) {
  const row = await rereadSnapshot(generationKey, dependencies).catch(() => null);
  if (!row || row.wmkf_claimtoken !== claimToken
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return;
  await dependencies.updateDocument(row.wmkf_requestdocumentid, {
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_lasterrorcode: String(error?.code || 'initial_assessment_snapshot_failed').slice(0, 100),
    wmkf_lasterrormessage: String(error?.message || 'Board snapshot failed').slice(0, 2000),
    wmkf_lastfailedat: dependencies.now().toISOString(),
    ...(retainedItem ? {
      wmkf_orphancleanupjson: JSON.stringify([{
        siteId: retainedItem.siteId || null,
        driveId: retainedItem.driveId || null,
        itemId: retainedItem.id || null,
        folderPath: row.wmkf_sharepointfolderpath || null,
        filename: row.wmkf_filename || null,
        reason: error?.code || 'initial_assessment_snapshot_reconciliation_required',
      }]),
    } : {}),
  }, conditionalOptions(row, actingUserSystemId));
}

function assertSnapshotContract(row, source, sourceVersionId, sourceHash) {
  if (row.wmkf_producer !== INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.producer
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT
    || !sameId(row._wmkf_sourcedocument_value, source.wmkf_requestdocumentid)
    || row.wmkf_sourceversionid !== sourceVersionId
    || row.wmkf_sourcecontenthash !== sourceHash) {
    throw controlError(
      'The existing Board snapshot row does not match its source contract.',
      'initial_assessment_snapshot_contract_mismatch',
      500,
    );
  }
}

function assertReadySnapshot(row, source, sourceVersionId, sourceHash) {
  assertSnapshotContract(row, source, sourceVersionId, sourceHash);
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY
    || row.wmkf_contenthash !== sourceHash
    || !row.wmkf_sharepointdriveid
    || !row.wmkf_sharepointitemid
    || sameId(row.wmkf_sharepointitemid, source.wmkf_sharepointitemid)) {
    throw controlError(
      'The existing Board snapshot row is incomplete or points at the editable source.',
      'initial_assessment_snapshot_ready_invalid',
      500,
    );
  }
}

function assertRetainedSnapshotMetadata(metadata, locator, source) {
  if (!metadata?.driveId || !metadata?.id || !metadata.versionId || !metadata.eTag
    || !sameId(metadata.driveId, locator?.driveId)
    || !sameId(metadata.id, locator?.id)
    || sameId(metadata.id, source.wmkf_sharepointitemid)) {
    throw controlError(
      'The retained Board snapshot file requires reconciliation.',
      'initial_assessment_snapshot_file_invalid',
    );
  }
}

function assertStableRetainedSnapshotMetadata(before, after, locator, source) {
  assertRetainedSnapshotMetadata(after, locator, source);
  if (after.versionId !== before.versionId
    || after.eTag !== before.eTag
    || after.lastModified !== before.lastModified
    || Number(after.size) !== Number(before.size)) {
    throw controlError(
      'The retained Board snapshot changed while it was being verified.',
      'initial_assessment_snapshot_file_invalid',
    );
  }
}

async function readStableRetainedSnapshotFile(
  locator,
  source,
  sourceHash,
  dependencies,
  { mismatchCode = 'initial_assessment_snapshot_file_invalid', mismatchStatus = 409 } = {},
) {
  const options = { siteId: locator.siteId || null };
  const before = await dependencies.getFileMetadataById(locator.driveId, locator.id, options);
  assertRetainedSnapshotMetadata(before, locator, source);
  const retained = await dependencies.downloadFile(before.driveId, before.id);
  const after = await dependencies.getFileMetadataById(locator.driveId, locator.id, options);
  assertStableRetainedSnapshotMetadata(before, after, locator, source);
  const retainedHash = await dependencies.hashDocx(retained.buffer);
  if (retainedHash !== sourceHash) {
    throw controlError(
      'The retained Board snapshot no longer matches its governed source content.',
      mismatchCode,
      mismatchStatus,
    );
  }
  return { metadata: after, contentHash: retainedHash };
}

function parseSnapshotCleanupQueue(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    for (const entry of parsed) {
      if (!entry?.driveId || !entry?.itemId) {
        throw new Error('cleanup entry has no stable drive/item identity');
      }
    }
    return parsed;
  } catch {
    throw controlError(
      'The Board snapshot registry contains unreadable SharePoint cleanup work.',
      'initial_assessment_snapshot_cleanup_invalid',
      500,
    );
  }
}

function cleanupPatchForPublishedItem(row, metadata) {
  const patch = {};
  for (const field of ['wmkf_orphancleanupjson', 'wmkf_orphancleanupoverflowjson']) {
    if (!row?.[field]) continue;
    const entries = parseSnapshotCleanupQueue(row[field]);
    const retained = entries.filter((entry) => !(
      sameId(entry.driveId, metadata.driveId) && sameId(entry.itemId, metadata.id)
    ));
    if (retained.length !== entries.length) {
      patch[field] = retained.length > 0 ? JSON.stringify(retained) : null;
    }
  }
  return patch;
}

function snapshotMetadataPatch(metadata) {
  return {
    wmkf_sharepointsiteid: metadata.siteId || null,
    wmkf_sharepointdriveid: metadata.driveId,
    wmkf_sharepointitemid: metadata.id,
    wmkf_sharepointweburl: metadata.webUrl || null,
    wmkf_sharepointversionid: metadata.versionId,
    wmkf_sharepointetag: metadata.eTag,
    wmkf_filename: metadata.name || null,
    wmkf_filesize: metadata.size,
    wmkf_sharepointlastmodified: metadata.lastModified || null,
  };
}

function snapshotMetadataMatches(row, metadata) {
  return sameId(row?.wmkf_sharepointdriveid, metadata.driveId)
    && sameId(row?.wmkf_sharepointitemid, metadata.id)
    && (row?.wmkf_sharepointsiteid || null) === (metadata.siteId || null)
    && (row?.wmkf_sharepointweburl || null) === (metadata.webUrl || null)
    && row?.wmkf_sharepointversionid === metadata.versionId
    && row?.wmkf_sharepointetag === metadata.eTag
    && (row?.wmkf_filename || null) === (metadata.name || null)
    && Number(row?.wmkf_filesize) === Number(metadata.size)
    && (row?.wmkf_sharepointlastmodified || null) === (metadata.lastModified || null);
}

async function verifyReadySnapshotFile(
  row,
  source,
  sourceHash,
  actingUserSystemId,
  dependencies,
) {
  const verified = await readStableRetainedSnapshotFile({
    siteId: row.wmkf_sharepointsiteid || null,
    driveId: row.wmkf_sharepointdriveid,
    id: row.wmkf_sharepointitemid,
  }, source, sourceHash, dependencies);
  const cleanupPatch = cleanupPatchForPublishedItem(row, verified.metadata);
  if (snapshotMetadataMatches(row, verified.metadata)
    && Object.keys(cleanupPatch).length === 0) return row;

  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      ...snapshotMetadataPatch(verified.metadata),
      ...cleanupPatch,
    }, conditionalOptions(row, actingUserSystemId));
  } catch (error) {
    if (![409, 412].includes(error?.status)) throw error;
  }
  const refreshed = await rereadSnapshot(row.wmkf_generationkey, dependencies);
  if (!refreshed) {
    throw controlError(
      'The Board snapshot row disappeared while its registry metadata was being reconciled.',
      'initial_assessment_snapshot_row_missing',
      500,
    );
  }
  assertReadySnapshot(refreshed, source, row.wmkf_sourceversionid, sourceHash);
  if (!snapshotMetadataMatches(refreshed, verified.metadata)
    || Object.keys(cleanupPatchForPublishedItem(refreshed, verified.metadata)).length > 0) {
    throw controlError(
      'The retained Board snapshot registry metadata changed concurrently.',
      'initial_assessment_snapshot_registry_conflict',
    );
  }
  return refreshed;
}

/** Upload the exact current bytes and retain the governed content in a distinct Board item. */
export async function createInitialAssessmentBoardSnapshot(
  { requestId, expectedArtifactId, expectedCurrentVersionId },
  { actingUserSystemId = null, dependencies = DEFAULT_DEPENDENCIES } = {},
) {
  const expectedVersion = validateVersionId(
    expectedCurrentVersionId,
    'expectedCurrentVersionId',
  );
  const { request, row: source } = await dependencies.resolveCanonical({
    requestId,
    expectedArtifactId,
  });
  const before = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  assertCanonicalFile(source, before);
  if (before.versionId !== expectedVersion) {
    throw controlError(
      'The Initial Assessment changed after this page was loaded. Refresh before creating a Board snapshot.',
      'initial_assessment_snapshot_stale',
    );
  }
  const downloaded = await dependencies.downloadFile(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
  );
  const sourceHash = await dependencies.hashDocx(downloaded.buffer);
  const stable = await dependencies.getFileMetadataById(
    source.wmkf_sharepointdriveid,
    source.wmkf_sharepointitemid,
    { siteId: source.wmkf_sharepointsiteid || null },
  );
  assertCanonicalFile(source, stable);
  if (stable.versionId !== before.versionId
    || stable.eTag !== before.eTag
    || stable.lastModified !== before.lastModified
    || stable.size !== before.size) {
    throw controlError(
      'The Initial Assessment changed while the Board snapshot was being prepared. Retry with the latest version.',
      'initial_assessment_snapshot_stale',
    );
  }
  const confirmed = await dependencies.resolveCanonical({ requestId, expectedArtifactId });
  assertStableCanonicalRegistry(
    source,
    confirmed.row,
    'initial_assessment_snapshot_stale',
    'The canonical Initial Assessment changed while the Board snapshot was being prepared.',
  );

  const { generationKey, inputFingerprint } = snapshotIdentity(
    source,
    expectedVersion,
    sourceHash,
  );
  let snapshot = await rereadSnapshot(generationKey, dependencies);
  if (snapshot?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    assertReadySnapshot(snapshot, source, expectedVersion, sourceHash);
    snapshot = await verifyReadySnapshotFile(
      snapshot,
      source,
      sourceHash,
      actingUserSystemId,
      dependencies,
    );
    return { snapshot: projectArtifact(snapshot, request), reused: true, recovered: false };
  }

  const claimToken = dependencies.newClaimToken();
  const now = dependencies.now();
  const requestNumber = String(request.akoya_requestnum || '').trim();
  if (!requestNumber || !source.wmkf_cyclecode || !source.wmkf_sharepointfolderpath) {
    throw controlError(
      'The canonical Initial Assessment is missing snapshot naming or cycle metadata.',
      'initial_assessment_snapshot_source_incomplete',
      500,
    );
  }
  const folderPath = `${source.wmkf_sharepointfolderpath}/${INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.relativeFolder}`;
  const safeVersion = expectedVersion.replace(/[^A-Za-z0-9._-]/g, '-');
  const fileName = `${requestNumber || 'Request'} Initial Assessment Board v${safeVersion} ${generationKey.slice(0, 8)}.docx`;

  if (!snapshot) {
    try {
      await dependencies.createDocument({
        wmkf_name: `${requestNumber || 'Request'} Initial Assessment Board snapshot`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${source.wmkf_requestdocumentid})`,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: source.wmkf_cyclecode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.producer,
        wmkf_templateid: INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.templateId,
        wmkf_templateversion: INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.templateVersion,
        wmkf_contenttype: CONTENT_TYPE,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileName,
        wmkf_sourceversionid: expectedVersion,
        wmkf_sourcecontenthash: sourceHash,
        wmkf_attemptcount: 1,
      }, {
        actingUserSystemId,
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: {
          operation: 'initial-assessment-board-snapshot',
          requestId,
          requestNumber,
          operationId: generationKey,
        },
      });
      snapshot = await assertOwnedSnapshot(generationKey, claimToken, dependencies);
    } catch (error) {
      if ([409, 412].includes(error?.status) || /duplicate|alternate key/i.test(error?.message || '')) {
        snapshot = await rereadSnapshot(generationKey, dependencies);
      } else {
        throw error;
      }
    }
  }
  if (!snapshot) {
    throw controlError(
      'The Board snapshot row could not be resolved after creation.',
      'initial_assessment_snapshot_row_missing',
      500,
    );
  }
  if (snapshot.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    assertReadySnapshot(snapshot, source, expectedVersion, sourceHash);
    snapshot = await verifyReadySnapshotFile(
      snapshot,
      source,
      sourceHash,
      actingUserSystemId,
      dependencies,
    );
    return { snapshot: projectArtifact(snapshot, request), reused: true, recovered: false };
  }

  let owned = snapshot.wmkf_claimtoken === claimToken
    ? snapshot
    : await claimSnapshot(
      snapshot,
      claimToken,
      now,
      actingUserSystemId,
      dependencies,
    );
  assertSnapshotContract(owned, source, expectedVersion, sourceHash);
  let recovered = false;
  let retainedItem = null;
  try {
    await dependencies.ensureFolderPath('akoya_request', folderPath);
    owned = await assertOwnedSnapshot(generationKey, claimToken, dependencies);
    let uploaded = await dependencies.getFileMetadataByPath(
      'akoya_request',
      folderPath,
      fileName,
    );
    if (uploaded) {
      if (sameId(uploaded.id, source.wmkf_sharepointitemid)) {
        throw controlError(
          'The Board snapshot path resolved to the editable source item.',
          'initial_assessment_snapshot_identity_collision',
          500,
        );
      }
      recovered = true;
    } else {
      uploaded = await dependencies.uploadFile(
        'akoya_request',
        folderPath,
        fileName,
        downloaded.buffer,
        CONTENT_TYPE,
        { conflictBehavior: 'fail' },
      );
      retainedItem = uploaded;
    }
    if (!uploaded || sameId(uploaded.id, source.wmkf_sharepointitemid)) {
      throw controlError(
        'The Board snapshot did not create a distinct SharePoint item.',
        'initial_assessment_snapshot_identity_collision',
        500,
      );
    }
    const copied = await readStableRetainedSnapshotFile(
      uploaded,
      source,
      sourceHash,
      dependencies,
      recovered
        ? { mismatchCode: 'initial_assessment_snapshot_path_collision' }
        : { mismatchCode: 'initial_assessment_snapshot_hash_mismatch', mismatchStatus: 500 },
    );
    const finalSource = await dependencies.getFileMetadataById(
      source.wmkf_sharepointdriveid,
      source.wmkf_sharepointitemid,
      { siteId: source.wmkf_sharepointsiteid || null },
    );
    assertCanonicalFile(source, finalSource);
    if (finalSource.versionId !== stable.versionId
      || finalSource.eTag !== stable.eTag
      || finalSource.lastModified !== stable.lastModified
      || finalSource.size !== stable.size) {
      throw controlError(
        'The Initial Assessment changed before the Board snapshot could be published.',
        'initial_assessment_snapshot_stale',
      );
    }
    const finalCanonical = await dependencies.resolveCanonical({ requestId, expectedArtifactId });
    assertStableCanonicalRegistry(
      source,
      finalCanonical.row,
      'initial_assessment_snapshot_stale',
      'The canonical Initial Assessment changed before the Board snapshot could be published.',
    );
    owned = await assertOwnedSnapshot(generationKey, claimToken, dependencies);
    await dependencies.updateDocument(owned.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
      wmkf_claimtoken: null,
      wmkf_contenthash: copied.contentHash,
      ...snapshotMetadataPatch(copied.metadata),
      ...cleanupPatchForPublishedItem(owned, copied.metadata),
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
    }, conditionalOptions(owned, actingUserSystemId));
    const ready = await rereadSnapshot(generationKey, dependencies);
    if (!ready) {
      throw controlError(
        'The Board snapshot row disappeared during publication.',
        'initial_assessment_snapshot_row_missing',
        500,
      );
    }
    assertReadySnapshot(ready, source, expectedVersion, sourceHash);
    if (!sameId(ready.wmkf_sharepointitemid, copied.metadata.id)
      || !snapshotMetadataMatches(ready, copied.metadata)
      || Object.keys(cleanupPatchForPublishedItem(ready, copied.metadata)).length > 0) {
      throw controlError(
        'The Board snapshot was not confirmed after publication.',
        'initial_assessment_snapshot_readback_mismatch',
        500,
      );
    }
    return { snapshot: projectArtifact(ready, request), reused: false, recovered };
  } catch (error) {
    await failSnapshotIfOwned(
      generationKey,
      claimToken,
      error,
      actingUserSystemId,
      dependencies,
      retainedItem,
    ).catch((patchError) => {
      console.error('[initial-assessment] failed to persist Board snapshot failure:', patchError.message);
    });
    throw error;
  }
}

export { DEFAULT_DEPENDENCIES };
