/** Exact-item reconciliation for expired durable presentation upload intents. */
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import {
  isPostPresentationMaterialsSchemaReady,
  postPresentationMaterialsAccess,
} from '../../utils/post-presentation-materials-readiness.js';
import { GraphService } from '../graph-service.js';
import OperationalEventService from '../operational-event-service.js';
import { openPresentationUploadUrl } from './upload-session-crypto.js';
import {
  abandonPresentationMaterialUpload,
  bindPresentationMaterialUploadForCleanup,
  claimPresentationMaterialUploadsForCleanup,
  recordPresentationMaterialUploadCandidate,
  refreshPresentationMaterialUploadSession,
  releasePresentationMaterialUploadCleanupLease,
  renewPresentationMaterialUploadCleanupLease,
} from './upload-intent-store.js';

const PRODUCER = 'meeting-tracker-post-presentation';
const CLEANUP_GRAPH_TIMEOUT_MS = 8_000;

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  access: postPresentationMaterialsAccess,
  claim: claimPresentationMaterialUploadsForCleanup,
  release: releasePresentationMaterialUploadCleanupLease,
  renew: renewPresentationMaterialUploadCleanupLease,
  recordCandidate: recordPresentationMaterialUploadCandidate,
  bind: bindPresentationMaterialUploadForCleanup,
  abandon: abandonPresentationMaterialUpload,
  refreshSession: refreshPresentationMaterialUploadSession,
  openUploadUrl: openPresentationUploadUrl,
  getSessionStatus: (uploadUrl) => GraphService.getBrowserUploadSessionStatus(
    uploadUrl,
    { timeoutMs: CLEANUP_GRAPH_TIMEOUT_MS },
  ),
  getByPath: (libraryName, folderPath, filename) => GraphService.getFileMetadataByPath(
    libraryName,
    folderPath,
    filename,
    { timeoutMs: CLEANUP_GRAPH_TIMEOUT_MS },
  ),
  getById: (driveId, itemId, options = {}) => GraphService.getFileMetadataById(
    driveId,
    itemId,
    { ...options, timeoutMs: CLEANUP_GRAPH_TIMEOUT_MS },
  ),
  deleteByEtag: (...args) => GraphService.deleteFileWithEtag(...args),
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  destructiveCleanupEnabled: () => process.env.POST_PRESENTATION_MATERIALS_CLEANUP === 'on',
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

async function stableCandidate(row, dependencies) {
  const item = await dependencies.getByPath(row.library_name, row.folder_path, row.physical_filename);
  if (!item) return { state: 'absent', candidate: null };
  if (!item.id || !item.driveId || !item.siteId || item.name !== row.physical_filename
    || Number(item.size) !== Number(row.declared_size)) {
    return { state: 'mismatch', candidate: null };
  }
  const stable = await dependencies.getById(item.driveId, item.id, { siteId: item.siteId || null });
  const itemVersion = item.versionId || item.cTag || null;
  const stableVersion = stable?.versionId || stable?.cTag || null;
  if (!stable || !sameId(stable.id, item.id) || !sameId(stable.driveId, item.driveId)
    || stable.name !== item.name || Number(stable.size) !== Number(item.size)
    || (item.eTag && stable.eTag !== item.eTag)
    || (itemVersion && stableVersion !== itemVersion)
    || !sameId(stable.siteId, item.siteId)
    || !stable.eTag || !stableVersion) {
    return { state: 'mismatch', candidate: null };
  }
  return {
    state: 'complete',
    candidate: {
      siteId: stable.siteId,
      driveId: stable.driveId,
      itemId: stable.id,
      versionId: stableVersion,
      eTag: stable.eTag,
      size: Number(stable.size),
    },
  };
}

function exactRegistryMatch(row, document, candidate) {
  return sameId(document?._wmkf_request_value, row.request_id)
    && Number(document?.wmkf_artifacttype) === Number(row.artifact_type)
    && document?.wmkf_producer === PRODUCER
    && document?.wmkf_generationkey === row.generation_key
    && sameId(document?.wmkf_sharepointdriveid, candidate.driveId)
    && sameId(document?.wmkf_sharepointitemid, candidate.itemId);
}

async function alert(row, reason, dependencies) {
  try {
    await dependencies.recordEvent({
      eventType: 'post_presentation_upload_cleanup_retained',
      severity: 'warning',
      summary: 'An expired presentation upload intent was retained for reconciliation.',
      subsystem: 'post-presentation-materials',
      stage: 'upload-cleanup',
      transient: false,
      correlationId: row.id,
      dedupeKey: `post-presentation-upload-cleanup:${row.id}:${reason}`,
      entityRefs: { requestId: row.request_id },
      metadata: { uploadId: row.id, reason },
    });
  } catch (error) {
    console.warn('[post-presentation-upload-cleanup] event failed:', error?.message || error);
  }
}

async function settleRetained(row, leaseToken, reason, dependencies) {
  await alert(row, reason, dependencies);
  await dependencies.release({ uploadId: row.id, leaseToken, lastError: reason });
  return 'retained';
}

async function renewCleanupOrRetain(row, leaseToken, dependencies) {
  const renewed = await dependencies.renew({ uploadId: row.id, leaseToken });
  if (renewed) return true;
  await alert(row, 'cleanup_lease_lost', dependencies);
  return false;
}

async function reconcileCandidate(row, candidate, leaseToken, destructive, dependencies) {
  const recorded = await dependencies.recordCandidate({
    uploadId: row.id,
    requestId: row.request_id,
    actorId: row.actor_id,
    candidate,
    leaseToken,
  });
  if (!recorded) return settleRetained(row, leaseToken, 'candidate_record_failed', dependencies);
  const found = await dependencies.findByGenerationKey(row.generation_key);
  const documents = found?.records || [];
  if (documents.length === 1 && exactRegistryMatch(row, documents[0], candidate)) {
    if (!destructive) return settleRetained(row, leaseToken, 'bound_inspect_only', dependencies);
    if (!await renewCleanupOrRetain(row, leaseToken, dependencies)) return 'retained';
    const bound = await dependencies.bind({
      uploadId: row.id,
      leaseToken,
      requestDocumentId: documents[0].wmkf_requestdocumentid,
    });
    if (!bound) return settleRetained(row, leaseToken, 'bound_finalize_failed', dependencies);
    return 'bound';
  }
  if (documents.length !== 0) {
    return settleRetained(row, leaseToken, documents.length > 1 ? 'registry_ambiguous' : 'registry_mismatch', dependencies);
  }
  if (!destructive) return settleRetained(row, leaseToken, 'unbound_inspect_only', dependencies);
  if (!await renewCleanupOrRetain(row, leaseToken, dependencies)) return 'retained';
  const status = await dependencies.deleteByEtag(candidate.driveId, candidate.itemId, candidate.eTag);
  if (![204, 404].includes(status)) return settleRetained(row, leaseToken, `delete_${status}`, dependencies);
  const abandoned = await dependencies.abandon({
    uploadId: row.id,
    leaseToken,
    lastError: 'unbound_candidate_deleted',
  });
  return abandoned ? 'deleted' : settleRetained(row, leaseToken, 'abandon_failed', dependencies);
}

async function reconcileRow(row, leaseToken, destructive, dependencies) {
  let path = await stableCandidate(row, dependencies);
  if (path.state === 'mismatch') {
    return settleRetained(row, leaseToken, 'candidate_mismatch', dependencies);
  }
  if (path.state === 'complete') {
    return reconcileCandidate(row, path.candidate, leaseToken, destructive, dependencies);
  }

  if (!row.upload_url_ciphertext) {
    if (!destructive || row.state !== 'failed') {
      return settleRetained(row, leaseToken, 'session_url_missing', dependencies);
    }
    if (!await renewCleanupOrRetain(row, leaseToken, dependencies)) return 'retained';
    const abandoned = await dependencies.abandon({
      uploadId: row.id,
      leaseToken,
      lastError: 'session_create_failed_no_candidate',
    });
    return abandoned ? 'abandoned' : settleRetained(row, leaseToken, 'abandon_failed', dependencies);
  }
  let uploadUrl;
  try {
    uploadUrl = dependencies.openUploadUrl(row.upload_url_ciphertext);
  } catch {
    return settleRetained(row, leaseToken, 'session_url_unreadable', dependencies);
  }
  try {
    const status = await dependencies.getSessionStatus(uploadUrl);
    const expiresAt = new Date(status.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) return settleRetained(row, leaseToken, 'session_expiry_invalid', dependencies);
    const refreshed = await dependencies.refreshSession({
      uploadId: row.id,
      requestId: row.request_id,
      actorId: row.actor_id,
      expiresAt: expiresAt.toISOString(),
      intentExpiresAt: new Date(expiresAt.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!refreshed) return settleRetained(row, leaseToken, 'session_refresh_failed', dependencies);
    await dependencies.release({ uploadId: row.id, leaseToken, lastError: null });
    return 'refreshed';
  } catch (error) {
    if (![404, 410].includes(Number(error?.status))) {
      return settleRetained(row, leaseToken, 'session_status_uncertain', dependencies);
    }
  }
  for (const delayMs of [2_000, 8_000]) {
    await dependencies.sleep(delayMs);
    path = await stableCandidate(row, dependencies);
    if (path.state === 'mismatch') {
      return settleRetained(row, leaseToken, 'candidate_mismatch', dependencies);
    }
    if (path.state === 'complete') {
      return reconcileCandidate(row, path.candidate, leaseToken, destructive, dependencies);
    }
  }
  if (!destructive) return settleRetained(row, leaseToken, 'closed_session_inspect_only', dependencies);
  if (!await renewCleanupOrRetain(row, leaseToken, dependencies)) return 'retained';
  const abandoned = await dependencies.abandon({
    uploadId: row.id,
    leaseToken,
    lastError: 'session_closed_without_candidate',
  });
  return abandoned ? 'abandoned' : settleRetained(row, leaseToken, 'abandon_failed', dependencies);
}

export async function cleanupPresentationMaterialUploads({ limit = 4 } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) return { scanned: 0, bound: 0, deleted: 0, abandoned: 0, refreshed: 0, retained: 0 };
  const access = dependencies.access();
  const destructive = access.valid === true
    && access.mode === 'on'
    && dependencies.destructiveCleanupEnabled();
  const claimed = await dependencies.claim({ limit });
  const stats = { scanned: claimed.rows.length, bound: 0, deleted: 0, abandoned: 0, refreshed: 0, retained: 0 };
  await Promise.all(claimed.rows.map(async (row) => {
    try {
      const outcome = await reconcileRow(row, claimed.leaseToken, destructive, dependencies);
      stats[outcome] += 1;
    } catch (error) {
      stats.retained += 1;
      await settleRetained(row, claimed.leaseToken, error?.code || 'cleanup_failed', dependencies);
    }
  }));
  return stats;
}

export { DEFAULT_DEPENDENCIES as PRESENTATION_UPLOAD_CLEANUP_DEPENDENCIES };
