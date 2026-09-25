/** Staff read model and lease-fenced Zoom producer. */
import { createHash, randomUUID } from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { isGuid } from '../../utils/guid.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isVirusScanEnabled } from '../../utils/virus-scan-config.js';
import {
  POST_PRESENTATION_TRANSCRIPT_CONTENT_TYPES,
  POST_PRESENTATION_TRANSCRIPT_MAX_BYTES,
  validatePostPresentationTranscript,
  validatePostPresentationTranscriptDescriptor,
} from '../../utils/post-presentation-transcript-file.js';
import {
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import OperationalEventService from '../operational-event-service.js';
import { GraphService } from '../graph-service.js';
import { scanBytes } from '../cloudmersive-scan.js';
import {
  PORTAL_UPLOAD_SCOPES,
  createPortalUpload,
  recordPortalUploadCandidate,
  renewPortalUploadLease,
  staffActorBinding,
} from '../portal-upload-staging.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  POST_PRESENTATION_MP4_CONTENT_TYPE,
  POST_PRESENTATION_MP4_MAX_BYTES,
  hasPostPresentationMp4Signature,
  validatePostPresentationMp4Descriptor,
} from '../../utils/post-presentation-mp4-file.js';
import {
  isEligiblePostPresentationRow,
  materialBacking,
  normalizeZoomPaste,
  projectPostPresentationDescriptors,
  projectPostPresentationMaterials,
} from './material-model.js';
import {
  acquirePresentationSlotLease,
  getPresentationSlotLease,
  releasePresentationSlotLease,
  renewPresentationSlotLease,
} from './slot-lease-store.js';
import {
  PRESENTATION_UPLOAD_REVIEW_GRACE_MS,
  claimPresentationMaterialUpload,
  completePresentationMaterialUpload,
  getPresentationMaterialUpload,
  insertPresentationMaterialUpload,
  listPresentationMaterialUploads,
  markPresentationMaterialUploadFailed,
  markPresentationMaterialUploadSessionClosed,
  recordPresentationMaterialUploadCandidate,
  recordPresentationMaterialUploadSession,
  refreshPresentationMaterialUploadSession,
  releasePresentationMaterialUpload,
  renewPresentationMaterialUploadLease,
} from './upload-intent-store.js';
import {
  openPresentationUploadUrl,
  sealPresentationUploadUrl,
} from './upload-session-crypto.js';
import { GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES } from '../../../shared/utils/graph-browser-upload.js';

const PRODUCER = 'meeting-tracker-post-presentation';
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'];

export const POST_PRESENTATION_MATERIALS_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  requestAllowed: isPostPresentationMaterialsRequestAllowed,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findActiveSiteVisit: (requestId) => siteVisitAdapter.findActiveByRequest(requestId),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  findDocumentByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  updateDocument: (id, patch, options) => requestDocumentAdapter.update(id, patch, options),
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  createBrowserUploadSession: (...args) => GraphService.createBrowserUploadSession(...args),
  getBrowserUploadSessionStatus: (...args) => GraphService.getBrowserUploadSessionStatus(...args),
  readMediaRange: (...args) => GraphService.readMediaRange(...args),
  scanEnabled: isVirusScanEnabled,
  scanBytes,
  createPortalUpload,
  recordPortalUploadCandidate,
  renewPortalUploadLease,
  getUploadIntent: getPresentationMaterialUpload,
  listUploadIntents: listPresentationMaterialUploads,
  insertUploadIntent: insertPresentationMaterialUpload,
  recordUploadSession: recordPresentationMaterialUploadSession,
  refreshUploadSession: refreshPresentationMaterialUploadSession,
  markUploadFailed: markPresentationMaterialUploadFailed,
  markUploadSessionClosed: markPresentationMaterialUploadSessionClosed,
  recordUploadCandidate: recordPresentationMaterialUploadCandidate,
  claimUploadIntent: claimPresentationMaterialUpload,
  renewUploadLease: renewPresentationMaterialUploadLease,
  releaseUploadIntent: releasePresentationMaterialUpload,
  completeUploadIntent: completePresentationMaterialUpload,
  sealUploadUrl: sealPresentationUploadUrl,
  openUploadUrl: openPresentationUploadUrl,
  acquireSlotLease: acquirePresentationSlotLease,
  getSlotLease: getPresentationSlotLease,
  renewSlotLease: renewPresentationSlotLease,
  releaseSlotLease: releasePresentationSlotLease,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  randomUUID,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

function materialError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function activeBucket(buckets) {
  const list = Array.isArray(buckets) ? buckets : [];
  return list.find((bucket) => bucket.source === 'dynamics' && String(bucket.library).toLowerCase() === 'akoya_request')
    || list.find((bucket) => bucket.source === 'dynamics')
    || null;
}

function scanIsMisconfigured(error) {
  const status = Number(error?.status);
  return status === 401 || status === 403
    || (error?.serviceName === 'cloudmersive' && status === 500 && error?.isTransient === false);
}

function sanitizeForSharePoint(value) {
  return String(value || '').replace(/["*:<>?|\\/]/g, '').replace(/\s+/g, ' ').trim();
}

function assertFeature(requestId, dependencies) {
  if (!dependencies.schemaReady()) {
    throw materialError(
      'Presentation materials are not enabled for this environment.',
      'post_presentation_schema_not_ready',
      503,
    );
  }
  if (!dependencies.requestAllowed(requestId)) {
    throw materialError('Presentation materials are not available.', 'post_presentation_not_available', 404);
  }
}

async function loadBoundContext(requestId, dependencies) {
  const [request, visits] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findActiveSiteVisit(requestId),
  ]);
  if (!request?.akoya_requestid || !sameId(request.akoya_requestid, requestId)) {
    throw materialError('Request not found.', 'post_presentation_request_not_found', 404);
  }
  const rows = (visits?.records || []).filter((row) => sameId(row._regardingobjectid_value, requestId));
  if (rows.length !== 1) {
    throw materialError(
      rows.length === 0
        ? 'An active Site Visit is required before adding presentation materials.'
        : 'Multiple active Site Visits require reconciliation before adding presentation materials.',
      rows.length === 0 ? 'post_presentation_site_visit_required' : 'post_presentation_site_visit_ambiguous',
    );
  }
  const cycleCode = meetingDateToCycleCode(request.wmkf_meetingdate);
  if (!cycleCode) {
    throw materialError('The request does not have a supported grant-cycle meeting date.', 'post_presentation_cycle_required');
  }
  return { request, siteVisit: rows[0], cycleCode };
}

function leaseShape(requestId, artifactType, leaseToken, fenceVersion) {
  return { requestId, artifactType, leaseToken, fenceVersion: Number(fenceVersion) };
}

async function acquireMaterialSlot({ requestId, artifactType, leaseToken, label }, dependencies) {
  const acquired = await dependencies.acquireSlotLease({ requestId, artifactType, leaseToken });
  if (acquired) return leaseShape(requestId, artifactType, leaseToken, acquired.fence_version);
  const observed = await dependencies.getSlotLease({ requestId, artifactType });
  const expired = observed?.lease_token == null
    || (observed?.lease_expires_at
      && new Date(observed.lease_expires_at).getTime() <= dependencies.now().getTime());
  if (Number(observed?.fence_version) === 2147483647
    && observed?.lease_token !== leaseToken
    && expired) {
    await dependencies.recordEvent({
      eventType: 'post_presentation_slot_fence_exhausted',
      severity: 'critical',
      summary: 'A post-presentation material slot exhausted its Dataverse-compatible fence.',
      subsystem: 'post-presentation-materials',
      stage: 'slot-acquire',
      transient: false,
      correlationId: leaseToken,
      dedupeKey: `post-presentation-slot-fence-exhausted:${requestId}:${artifactType}`,
      entityRefs: { requestId },
      metadata: { artifactType },
    });
    throw materialError(
      'This presentation-material slot requires administrator reconciliation.',
      'post_presentation_slot_fence_exhausted',
      503,
    );
  }
  throw materialError(
    `Another ${label} update is in progress. Reload and retry.`,
    'post_presentation_slot_busy',
    409,
    { retryable: true },
  );
}

async function renewOrLose(lease, dependencies) {
  const renewed = await dependencies.renewSlotLease(lease);
  if (!renewed || Number(renewed.fence_version) !== lease.fenceVersion) {
    throw materialError(
      'Another presentation-material update won this slot. Reload and retry.',
      'post_presentation_slot_lease_lost',
      409,
      { retryable: true },
    );
  }
  return renewed;
}

function validateRecoveredZoomRow(row, spec) {
  return row
    && sameId(row._wmkf_request_value, spec.requestId)
    && Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING
    && row.wmkf_producer === PRODUCER
    && row.wmkf_generationkey === spec.generationKey
    && row.wmkf_inputfingerprint === spec.inputFingerprint
    && Number.isInteger(Number(row.wmkf_slotversion))
    && Number(row.wmkf_slotversion) > 0
    && Number(row.wmkf_slotversion) <= spec.fenceVersion
    && materialBacking(row).kind === 'external'
    && materialBacking(row).url === spec.zoomUrl;
}

function validateRecoveredTranscriptRow(row, spec) {
  return row
    && sameId(row._wmkf_request_value, spec.requestId)
    && Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT
    && row.wmkf_producer === PRODUCER
    && row.wmkf_generationkey === spec.generationKey
    && row.wmkf_inputfingerprint === spec.inputFingerprint
    && row.wmkf_sharepointdriveid === spec.candidate.driveId
    && row.wmkf_sharepointitemid === spec.candidate.itemId
    && Number(row.wmkf_filesize) === Number(spec.candidate.size)
    && Number.isInteger(Number(row.wmkf_slotversion))
    && Number(row.wmkf_slotversion) > 0
    && Number(row.wmkf_slotversion) <= spec.fenceVersion;
}

async function createPostPresentationDocument({ payload, actingUserSystemId, operation, requestId, operationId }, dependencies) {
  return dependencies.createDocument(payload, {
    actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
    actorContext: { operation, requestId, operationId },
    actingUserSystemId,
  });
}

async function updatePostPresentationDocument({
  id, patch, actingUserSystemId, operation, requestId, operationId,
}, dependencies) {
  return dependencies.updateDocument(id, patch, {
    actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
    actorContext: { operation, requestId, operationId },
    actingUserSystemId,
  });
}

async function recordReconciliation(spec, dependencies) {
  try {
    await dependencies.recordEvent({
      eventType: 'post_presentation_material_reconciliation_required',
      severity: 'warning',
      summary: 'A post-presentation material replacement needs registry reconciliation.',
      subsystem: 'post-presentation-materials',
      stage: spec.stage,
      transient: false,
      correlationId: spec.operationId,
      dedupeKey: `post-presentation-reconciliation:${spec.operationId}:${spec.stage}`,
      entityRefs: {
        requestId: spec.requestId,
        requestDocumentId: spec.requestDocumentId || null,
        predecessorIds: spec.predecessorIds || [],
      },
      metadata: {
        artifactType: spec.artifactType,
        fenceVersion: spec.fenceVersion,
        reason: spec.reason,
        candidateDriveId: spec.candidateDriveId || null,
        candidateItemId: spec.candidateItemId || null,
      },
    });
  } catch (error) {
    console.warn('[post-presentation-materials] reconciliation event failed:', error?.message || error);
  }
}

function projectUploadIntents(rows, now) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const reviewLive = new Date(row.intent_expires_at).getTime() > now.getTime();
    const strandedFinalize = row.state === 'finalizing'
      && new Date(row.lease_expires_at || 0).getTime() <= now.getTime();
    return {
      uploadId: row.id,
      artifactType: Number(row.artifact_type),
      filename: row.original_display_filename,
      contentType: row.validated_mime_type,
      size: Number(row.declared_size),
      state: row.state,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      canResume: row.state === 'initiated'
        && Boolean(row.upload_session_expires_at)
        && reviewLive,
      canFinalize: reviewLive && (
        (row.state === 'uploaded' && Boolean(row.candidate_item_id))
        || strandedFinalize
      ),
    };
  });
}

function staffProjection(rows, requestId, uploads = []) {
  const projection = projectPostPresentationDescriptors(rows, requestId, { includeStaffUrls: true });
  return {
    status: 'ready',
    materials: projection.materials,
    conflicts: projection.conflicts,
    uploads,
    supported: {
      recording: ['zoom', 'mp4'],
      transcript: ['vtt', 'txt', 'pdf', 'docx'],
      transcriptSummary: [],
    },
  };
}

export async function getPresentationMaterials({ requestId, actingUserSystemId = null }, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  assertFeature(requestId, dependencies);
  await loadBoundContext(requestId, dependencies);
  const [result, uploadRows] = await Promise.all([
    dependencies.findDocuments(requestId),
    isGuid(actingUserSystemId || '')
      ? dependencies.listUploadIntents({ requestId, actorId: actingUserSystemId })
      : Promise.resolve([]),
  ]);
  return staffProjection(
    result?.records || [],
    requestId,
    projectUploadIntents(uploadRows, dependencies.now()),
  );
}

export async function saveZoomRecording({
  requestId,
  operationId,
  zoomText,
  actingUserSystemId,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  if (!isGuid(operationId)) throw materialError('A valid operationId is required.', 'invalid_operation_id', 400);
  if (!isGuid(actingUserSystemId || '')) {
    throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  }
  assertFeature(requestId, dependencies);
  let zoomUrl;
  try {
    zoomUrl = normalizeZoomPaste(zoomText);
  } catch (error) {
    throw materialError(error.message, 'post_presentation_zoom_invalid', 400);
  }
  const { request, cycleCode } = await loadBoundContext(requestId, dependencies);
  const artifactType = REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING;
  const lease = await acquireMaterialSlot({
    requestId, artifactType, leaseToken: operationId, label: 'recording',
  }, dependencies);
  const generationKey = digest(`${PRODUCER}:${requestId.toLowerCase()}:${operationId.toLowerCase()}`);
  const inputFingerprint = digest(zoomUrl);
  let createdId = null;
  let predecessors = [];
  try {
    const before = await dependencies.findDocuments(requestId);
    predecessors = (before?.records || [])
      .filter((row) => (
        Number(row.wmkf_artifacttype) === artifactType
        && isEligiblePostPresentationRow(row, requestId)
        && (row.wmkf_slotversion == null || Number(row.wmkf_slotversion) < lease.fenceVersion)
      ))
      .map((row) => row.wmkf_requestdocumentid)
      .filter(Boolean);

    await renewOrLose(lease, dependencies);
    const recovered = await dependencies.findDocumentByGenerationKey(generationKey);
    if ((recovered?.records || []).length > 1) {
      throw materialError('The Zoom save retry identity is ambiguous.', 'post_presentation_generation_ambiguous', 500);
    }
    let row = recovered?.records?.[0] || null;
    if (row && !validateRecoveredZoomRow(row, {
      requestId, generationKey, inputFingerprint, fenceVersion: lease.fenceVersion, zoomUrl,
    })) {
      throw materialError('The Zoom save retry does not match the original operation.', 'post_presentation_replay_mismatch');
    }
    if (!row) {
      row = await createPostPresentationDocument({ payload: {
        wmkf_name: `${request.akoya_requestnum || 'Request'} research presentation recording`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: dependencies.randomUUID(),
        wmkf_producer: PRODUCER,
        wmkf_externalurl: zoomUrl,
        wmkf_slotversion: lease.fenceVersion,
      },
        actingUserSystemId,
        operation: 'post-presentation-save-zoom',
        requestId,
        operationId,
      }, dependencies);
      createdId = row?.wmkf_requestdocumentid || row?.id || null;
      if (!createdId) {
        throw materialError('Dataverse did not confirm the recording row.', 'post_presentation_create_unconfirmed', 502);
      }
    } else {
      createdId = row.wmkf_requestdocumentid;
      const recoveredFence = Number(row.wmkf_slotversion);
      const visibleBefore = projectPostPresentationMaterials(before?.records || [], requestId).winners
        .find((candidate) => Number(candidate.wmkf_artifacttype) === artifactType);
      if (visibleBefore && Number(visibleBefore.wmkf_slotversion || 0) > recoveredFence) {
        const after = await dependencies.findDocuments(requestId);
        return {
          ...staffProjection(after?.records || [], requestId),
          operationId,
          replayed: true,
          reconciliationRequired: false,
        };
      }
    }

    try {
      await renewOrLose(lease, dependencies);
    } catch (error) {
      await recordReconciliation({
        requestId, operationId, requestDocumentId: createdId, predecessorIds: predecessors,
        artifactType, fenceVersion: lease.fenceVersion, stage: 'post-create-lease-lost',
        reason: error.code || 'slot_lease_lost',
      }, dependencies);
      throw error;
    }

    const supersedeFailures = [];
    for (const predecessorId of predecessors.filter((id) => !sameId(id, createdId))) {
      try {
        await renewOrLose(lease, dependencies);
        await updatePostPresentationDocument({
          id: predecessorId,
          patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
          actingUserSystemId,
          operation: 'post-presentation-supersede-recording',
          requestId,
          operationId,
        }, dependencies);
      } catch (error) {
        supersedeFailures.push(predecessorId);
        await recordReconciliation({
          requestId, operationId, requestDocumentId: createdId, predecessorIds: [predecessorId],
          artifactType, fenceVersion: lease.fenceVersion, stage: 'predecessor-supersede',
          reason: error.code || 'predecessor_update_failed',
        }, dependencies);
        if (error?.code === 'post_presentation_slot_lease_lost') break;
      }
    }
    const after = await dependencies.findDocuments(requestId);
    const projected = staffProjection(after?.records || [], requestId);
    const unresolved = projected.conflicts.filter((conflict) => (
      conflict.artifactType === artifactType && conflict.reason === 'eligible_non_winner'
    ));
    if (unresolved.length > 0) {
      await recordReconciliation({
        requestId, operationId, requestDocumentId: createdId,
        predecessorIds: unresolved.map((conflict) => conflict.artifactId).filter(Boolean),
        artifactType, fenceVersion: lease.fenceVersion, stage: 'post-write-projection',
        reason: 'multiple_active_rows',
      }, dependencies);
    }
    return {
      ...projected,
      operationId,
      replayed: Boolean(recovered?.records?.[0]),
      reconciliationRequired: supersedeFailures.length > 0 || unresolved.length > 0,
    };
  } finally {
    try {
      await dependencies.releaseSlotLease(lease);
    } catch (error) {
      await recordReconciliation({
        requestId, operationId, requestDocumentId: createdId, predecessorIds: predecessors,
        artifactType, fenceVersion: lease.fenceVersion, stage: 'lease-release',
        reason: error?.code || 'lease_release_failed',
      }, dependencies);
    }
  }
}

function assertMp4Actor(actingUserSystemId) {
  if (!isGuid(actingUserSystemId || '')) {
    throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  }
}

function intentReviewAfter(expiresAt) {
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime())) {
    throw materialError('Microsoft returned an invalid upload-session expiry.', 'post_presentation_upload_session_invalid', 502);
  }
  return new Date(expiry.getTime() + PRESENTATION_UPLOAD_REVIEW_GRACE_MS);
}

function exactSequentialRange(ranges, size) {
  if (!Array.isArray(ranges) || ranges.length !== 1) {
    throw materialError('Microsoft returned an ambiguous upload range.', 'post_presentation_upload_range_invalid', 502);
  }
  const match = String(ranges[0] || '').match(/^(\d+)-$/);
  const start = Number(match?.[1]);
  if (!match || !Number.isInteger(start) || start < 0 || start >= size) {
    throw materialError('Microsoft returned an invalid upload range.', 'post_presentation_upload_range_invalid', 502);
  }
  return start;
}

function sameVisit(row, siteVisit) {
  return sameId(row?.site_visit_id, siteVisit?.activityid);
}

async function resolveStableMp4Path(row, dependencies) {
  const item = await dependencies.getFileMetadataByPath(
    row.library_name,
    row.folder_path,
    row.physical_filename,
  );
  if (!item) return { state: 'absent', candidate: null };
  if (!item.id || !item.driveId || !item.siteId || item.name !== row.physical_filename) {
    throw materialError('The SharePoint upload path has an unexpected item.', 'post_presentation_candidate_mismatch', 409);
  }
  const itemSize = Number(item.size);
  if (!Number.isInteger(itemSize) || itemSize < 0 || itemSize > Number(row.declared_size)) {
    throw materialError('The SharePoint upload size does not match this intent.', 'post_presentation_candidate_mismatch', 409);
  }
  if (itemSize < Number(row.declared_size)) return { state: 'partial', candidate: null };
  const stable = await dependencies.getFileMetadataById(item.driveId, item.id, { siteId: item.siteId || null });
  const itemVersion = item.versionId || item.cTag || null;
  const stableVersion = stable?.versionId || stable?.cTag || null;
  if (!stable
    || !sameId(stable.driveId, item.driveId)
    || !sameId(stable.id, item.id)
    || stable.name !== item.name
    || Number(stable.size) !== itemSize
    || (item.eTag && stable.eTag !== item.eTag)
    || (itemVersion && stableVersion !== itemVersion)
    || !stable.siteId
    || !stable.eTag
    || !stableVersion) {
    throw materialError('The SharePoint upload changed during verification.', 'post_presentation_candidate_mismatch', 409);
  }
  return {
    state: 'complete',
    candidate: {
      siteId: stable.siteId,
      driveId: stable.driveId,
      itemId: stable.id,
      versionId: stableVersion,
      eTag: stable.eTag,
      size: itemSize,
      filename: stable.name,
      folderPath: row.folder_path,
      webUrl: stable.webUrl || item.webUrl || null,
      lastModified: stable.lastModified || item.lastModified || null,
    },
  };
}

async function persistMp4Candidate(row, candidate, leaseToken, dependencies) {
  const stored = await dependencies.recordUploadCandidate({
    uploadId: row.id,
    requestId: row.request_id,
    actorId: row.actor_id,
    candidate,
    leaseToken,
  });
  if (!stored) {
    throw materialError('The completed upload could not be recorded.', 'post_presentation_candidate_record_failed', 503);
  }
  return stored;
}

export async function mintMp4Upload({
  requestId,
  operationId,
  actingUserSystemId,
  filename,
  contentType,
  size,
  resumeFingerprint,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  if (!isGuid(operationId)) throw materialError('A valid operationId is required.', 'invalid_operation_id', 400);
  assertMp4Actor(actingUserSystemId);
  assertFeature(requestId, dependencies);
  const validation = validatePostPresentationMp4Descriptor(filename, contentType, size, resumeFingerprint);
  if (!validation.ok) throw materialError('The recording upload is not valid.', validation.reason, 400);
  const { request, siteVisit } = await loadBoundContext(requestId, dependencies);
  const existing = await dependencies.getUploadIntent({
    uploadId: operationId,
    requestId,
    actorId: actingUserSystemId,
  });
  if (existing) {
    const same = existing.client_resume_fingerprint === resumeFingerprint
      && existing.original_display_filename === validation.filename
      && existing.validated_mime_type === contentType
      && Number(existing.declared_size) === size
      && sameVisit(existing, siteVisit);
    if (!same) {
      throw materialError('This upload retry does not match its original file.', 'post_presentation_replay_mismatch', 409);
    }
    const replayFailed = existing.state === 'failed' && !existing.upload_url_ciphertext;
    throw materialError(
      'This upload already exists. Resume it from the unfinished uploads list.',
      replayFailed ? 'post_presentation_upload_failed' : 'post_presentation_upload_exists',
      409,
      { uploadId: operationId, retryable: !replayFailed },
    );
  }
  const bucket = activeBucket(await dependencies.getSharePointBuckets(requestId, request.akoya_requestnum));
  if (!bucket) throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);
  const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/Post Site Visit Materials`;
  const physicalFilename = `${sanitizeForSharePoint(request.akoya_requestnum || 'Request')}-Recording-${operationId}.mp4`;
  const folder = await dependencies.ensureFolderPath(bucket.library, folderPath);
  const generationKey = digest(`${PRODUCER}:${requestId.toLowerCase()}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING}:${operationId.toLowerCase()}:${resumeFingerprint}`);
  const provisionalExpiry = new Date(dependencies.now().getTime() + PRESENTATION_UPLOAD_REVIEW_GRACE_MS);
  const inserted = await dependencies.insertUploadIntent({
    id: operationId,
    requestId,
    siteVisitId: siteVisit.activityid,
    actorId: actingUserSystemId,
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    originalDisplayFilename: validation.filename,
    validatedMimeType: POST_PRESENTATION_MP4_CONTENT_TYPE,
    declaredSize: size,
    clientResumeFingerprint: resumeFingerprint,
    libraryName: bucket.library,
    folderPath,
    physicalFilename,
    generationKey,
    intentExpiresAt: provisionalExpiry.toISOString(),
  });
  if (!inserted) {
    const raced = await dependencies.getUploadIntent({
      uploadId: operationId,
      requestId,
      actorId: actingUserSystemId,
    });
    const same = raced
      && raced.client_resume_fingerprint === resumeFingerprint
      && raced.original_display_filename === validation.filename
      && raced.validated_mime_type === contentType
      && Number(raced.declared_size) === size
      && sameVisit(raced, siteVisit);
    if (!same) {
      throw materialError('This upload retry does not match its original file.', 'post_presentation_replay_mismatch', 409);
    }
    const replayFailed = raced.state === 'failed' && !raced.upload_url_ciphertext;
    throw materialError(
      'This upload already exists. Resume it from the unfinished uploads list.',
      replayFailed ? 'post_presentation_upload_failed' : 'post_presentation_upload_exists',
      409,
      { uploadId: operationId, retryable: !replayFailed },
    );
  }
  let session;
  try {
    session = await dependencies.createBrowserUploadSession(bucket.library, folderPath, physicalFilename, {
      conflictBehavior: 'fail',
      ...(folder?.siteId && folder?.driveId ? { siteId: folder.siteId, driveId: folder.driveId } : {}),
    });
    exactSequentialRange(session.nextExpectedRanges, size);
    const expiresAt = new Date(session.expiresAt);
    const saved = await dependencies.recordUploadSession({
      uploadId: operationId,
      uploadUrlCiphertext: dependencies.sealUploadUrl(session.uploadUrl),
      expiresAt: expiresAt.toISOString(),
      intentExpiresAt: intentReviewAfter(expiresAt).toISOString(),
    });
    if (!saved) throw new Error('upload session row was not updated');
  } catch (error) {
    await dependencies.markUploadFailed({ uploadId: operationId, lastError: error?.code || 'session_create_failed' });
    throw materialError('The recording upload session could not be created.', 'post_presentation_upload_session_failed', 503);
  }
  return {
    uploadId: operationId,
    lockKey: operationId,
    uploadUrl: session.uploadUrl,
    expiresAt: session.expiresAt,
    nextExpectedRanges: session.nextExpectedRanges,
    chunkBytes: GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
    file: { name: validation.filename, size, contentType },
  };
}

export async function getMp4UploadStatus({
  requestId,
  uploadId,
  actingUserSystemId,
  resumeFingerprint,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(uploadId)) {
    throw materialError('A valid upload status request is required.', 'invalid_upload_id', 400);
  }
  assertMp4Actor(actingUserSystemId);
  assertFeature(requestId, dependencies);
  const { siteVisit } = await loadBoundContext(requestId, dependencies);
  const row = await dependencies.getUploadIntent({ uploadId, requestId, actorId: actingUserSystemId });
  if (!row) throw materialError('Upload not found.', 'post_presentation_upload_not_found', 404);
  if (!sameVisit(row, siteVisit)) {
    throw materialError('The active Site Visit changed after this upload began.', 'post_presentation_site_visit_changed', 409);
  }
  if (row.client_resume_fingerprint !== resumeFingerprint) {
    throw materialError('The selected file does not match this upload.', 'post_presentation_resume_fingerprint_mismatch', 409);
  }
  if (row.state === 'finalized') {
    return { complete: true, finalized: true, canFinalize: false, uploadId };
  }
  if (row.state === 'finalizing'
    && new Date(row.lease_expires_at || 0).getTime() > dependencies.now().getTime()) {
    throw materialError('This upload is currently being finalized.', 'post_presentation_finalize_in_progress', 409, { retryable: true });
  }
  const exact = await resolveStableMp4Path(row, dependencies);
  if (exact.state === 'complete') {
    await persistMp4Candidate(row, exact.candidate, null, dependencies);
    return {
      complete: true,
      canFinalize: true,
      uploadId,
      file: { name: row.original_display_filename, size: Number(row.declared_size) },
    };
  }
  let uploadUrl;
  try {
    uploadUrl = dependencies.openUploadUrl(row.upload_url_ciphertext);
  } catch {
    throw materialError('The upload session cannot be resumed.', 'post_presentation_upload_session_unreadable', 503);
  }
  let status;
  try {
    status = await dependencies.getBrowserUploadSessionStatus(uploadUrl);
  } catch (error) {
    if (![404, 410].includes(Number(error?.status))) throw error;
    for (const delayMs of [2_000, 8_000]) {
      await dependencies.sleep(delayMs);
      const visible = await resolveStableMp4Path(row, dependencies);
      if (visible.state === 'complete') {
        await persistMp4Candidate(row, visible.candidate, null, dependencies);
        return {
          complete: true,
          canFinalize: true,
          uploadId,
          file: { name: row.original_display_filename, size: Number(row.declared_size) },
        };
      }
    }
    if (Number(error.status) === 410) {
      await dependencies.markUploadSessionClosed({
        uploadId, requestId, actorId: actingUserSystemId, lastError: 'session_expired',
      });
      throw materialError('Microsoft confirmed that the upload session expired before commit.', 'post_presentation_upload_session_expired', 410);
    }
    throw materialError(
      'Microsoft closed the upload session, but the exact file outcome is unresolved.',
      'post_presentation_upload_session_closed',
      409,
    );
  }
  exactSequentialRange(status.nextExpectedRanges, Number(row.declared_size));
  const expiresAt = new Date(status.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw materialError('Microsoft returned an invalid upload-session expiry.', 'post_presentation_upload_session_invalid', 502);
  }
  const refreshed = await dependencies.refreshUploadSession({
    uploadId,
    requestId,
    actorId: actingUserSystemId,
    expiresAt: expiresAt.toISOString(),
    intentExpiresAt: intentReviewAfter(expiresAt).toISOString(),
  });
  if (!refreshed) throw materialError('The upload session changed. Reload and retry.', 'post_presentation_upload_changed', 409);
  return {
    complete: false,
    canFinalize: false,
    uploadId,
    uploadUrl,
    expiresAt: expiresAt.toISOString(),
    nextExpectedRanges: status.nextExpectedRanges,
    chunkBytes: GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
    file: { name: row.original_display_filename, size: Number(row.declared_size) },
  };
}

function validateRecoveredMp4Row(row, spec) {
  return row
    && sameId(row._wmkf_request_value, spec.requestId)
    && Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING
    && row.wmkf_producer === PRODUCER
    && row.wmkf_generationkey === spec.generationKey
    && row.wmkf_inputfingerprint === spec.inputFingerprint
    && sameId(row.wmkf_sharepointdriveid, spec.candidate.driveId)
    && sameId(row.wmkf_sharepointitemid, spec.candidate.itemId)
    && Number(row.wmkf_filesize) === Number(spec.candidate.size)
    && Number.isInteger(Number(row.wmkf_slotversion))
    && Number(row.wmkf_slotversion) > 0
    && Number(row.wmkf_slotversion) <= spec.fenceVersion;
}

async function finalizeClaimedMp4Upload({ row, leaseToken, actingUserSystemId }, dependencies) {
  const requestId = row.request_id;
  const uploadId = row.id;
  const { request, siteVisit, cycleCode } = await loadBoundContext(requestId, dependencies);
  if (!sameVisit(row, siteVisit)) {
    throw materialError('The active Site Visit changed after this upload began.', 'post_presentation_site_visit_changed', 409);
  }
  let renewed = await dependencies.renewUploadLease({ uploadId, leaseToken });
  if (!renewed) throw materialError('The upload finalize lease was lost.', 'post_presentation_upload_lease_lost', 409, { retryable: true });
  const exact = await resolveStableMp4Path(row, dependencies);
  if (exact.state !== 'complete') {
    throw materialError('Finish the browser upload before saving the recording.', 'post_presentation_upload_incomplete', 409, { retryable: true });
  }
  const candidate = exact.candidate;
  if ((row.candidate_item_id && !sameId(row.candidate_item_id, candidate.itemId))
    || (row.candidate_drive_id && !sameId(row.candidate_drive_id, candidate.driveId))) {
    throw materialError('The completed upload does not match its recorded candidate.', 'post_presentation_candidate_mismatch', 409);
  }
  renewed = await dependencies.renewUploadLease({ uploadId, leaseToken });
  if (!renewed) throw materialError('The upload finalize lease was lost.', 'post_presentation_upload_lease_lost', 409, { retryable: true });
  await persistMp4Candidate(row, candidate, leaseToken, dependencies);
  const signature = await dependencies.readMediaRange(candidate.driveId, candidate.itemId, { start: 0, end: 31 });
  if (signature?.mimeType !== POST_PRESENTATION_MP4_CONTENT_TYPE || !hasPostPresentationMp4Signature(signature?.bytes)) {
    throw materialError('The uploaded recording is not a valid MP4.', 'post_presentation_mp4_signature_invalid', 415);
  }
  if (signature.malware) {
    throw materialError('Microsoft flagged this recording as unsafe.', 'post_presentation_mp4_malware', 409);
  }

  const artifactType = REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING;
  const slot = await acquireMaterialSlot({
    requestId,
    artifactType,
    leaseToken: uploadId,
    label: 'recording',
  }, dependencies);
  let createdId = null;
  let predecessors = [];
  const renewIntentOrLose = async () => {
    const live = await dependencies.renewUploadLease({ uploadId, leaseToken });
    if (!live) {
      throw materialError('The upload finalize lease was lost.', 'post_presentation_upload_lease_lost', 409, { retryable: true });
    }
    return live;
  };
  try {
    const before = await dependencies.findDocuments(requestId);
    predecessors = (before?.records || [])
      .filter((document) => (
        Number(document.wmkf_artifacttype) === artifactType
        && isEligiblePostPresentationRow(document, requestId)
        && (document.wmkf_slotversion == null || Number(document.wmkf_slotversion) < slot.fenceVersion)
      ))
      .map((document) => document.wmkf_requestdocumentid)
      .filter(Boolean);
    await renewOrLose(slot, dependencies);
    renewed = await renewIntentOrLose();
    const recovered = await dependencies.findDocumentByGenerationKey(row.generation_key);
    if ((recovered?.records || []).length > 1) {
      throw materialError('The recording retry identity is ambiguous.', 'post_presentation_generation_ambiguous', 500);
    }
    let document = recovered?.records?.[0] || null;
    if (document && !validateRecoveredMp4Row(document, {
      requestId,
      generationKey: row.generation_key,
      inputFingerprint: row.client_resume_fingerprint,
      fenceVersion: slot.fenceVersion,
      candidate,
    })) {
      throw materialError('The recording retry does not match the original operation.', 'post_presentation_replay_mismatch', 409);
    }
    if (!document) {
      document = await createPostPresentationDocument({ payload: {
        wmkf_name: `${request.akoya_requestnum || 'Request'} research presentation recording`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: row.generation_key,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: row.client_resume_fingerprint,
        wmkf_claimtoken: dependencies.randomUUID(),
        wmkf_producer: PRODUCER,
        wmkf_contenttype: POST_PRESENTATION_MP4_CONTENT_TYPE,
        wmkf_sharepointsiteid: candidate.siteId,
        wmkf_sharepointdriveid: candidate.driveId,
        wmkf_sharepointitemid: candidate.itemId,
        wmkf_sharepointweburl: candidate.webUrl,
        wmkf_sharepointversionid: candidate.versionId,
        wmkf_sharepointetag: candidate.eTag,
        wmkf_sharepointfolderpath: candidate.folderPath,
        wmkf_filename: candidate.filename,
        wmkf_filesize: candidate.size,
        wmkf_sharepointlastmodified: candidate.lastModified,
        wmkf_slotversion: slot.fenceVersion,
      },
      actingUserSystemId,
      operation: 'post-presentation-finalize-mp4',
      requestId,
      operationId: uploadId,
      }, dependencies);
      createdId = document?.wmkf_requestdocumentid || document?.id || null;
      if (!createdId) throw materialError('Dataverse did not confirm the recording row.', 'post_presentation_create_unconfirmed', 502);
    } else {
      createdId = document.wmkf_requestdocumentid;
      const visibleBefore = projectPostPresentationMaterials(before?.records || [], requestId).winners
        .find((current) => Number(current.wmkf_artifacttype) === artifactType);
      if (visibleBefore && Number(visibleBefore.wmkf_slotversion || 0) > Number(document.wmkf_slotversion || 0)) {
        try {
          await renewOrLose(slot, dependencies);
          await renewIntentOrLose();
          await updatePostPresentationDocument({
            id: createdId,
            patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
            actingUserSystemId,
            operation: 'post-presentation-supersede-stale-mp4-retry',
            requestId,
            operationId: uploadId,
          }, dependencies);
          await renewIntentOrLose();
          const completed = await dependencies.completeUploadIntent({ uploadId, leaseToken, requestDocumentId: createdId });
          if (!completed) {
            throw materialError('The recording was saved but its upload receipt was not finalized.', 'post_presentation_upload_completion_failed', 503);
          }
        } catch (error) {
          await recordReconciliation({
            requestId,
            operationId: uploadId,
            requestDocumentId: createdId,
            predecessorIds: [],
            artifactType,
            fenceVersion: slot.fenceVersion,
            stage: 'stale-retry-finalize',
            reason: error.code || 'stale_retry_finalize_failed',
            candidateDriveId: candidate.driveId,
            candidateItemId: candidate.itemId,
          }, dependencies);
          throw error;
        }
        const after = await dependencies.findDocuments(requestId);
        return {
          ...staffProjection(after?.records || [], requestId),
          uploadId,
          requestDocumentId: createdId,
          replayed: true,
          reconciliationRequired: false,
        };
      }
    }
    try {
      await renewOrLose(slot, dependencies);
      await renewIntentOrLose();
    } catch (error) {
      await recordReconciliation({
        requestId,
        operationId: uploadId,
        requestDocumentId: createdId,
        predecessorIds: predecessors,
        artifactType,
        fenceVersion: slot.fenceVersion,
        stage: 'post-create-lease-lost',
        reason: error.code || 'finalize_lease_lost',
        candidateDriveId: candidate.driveId,
        candidateItemId: candidate.itemId,
      }, dependencies);
      throw error;
    }
    const supersedeFailures = [];
    for (const predecessorId of predecessors.filter((id) => !sameId(id, createdId))) {
      try {
        await renewOrLose(slot, dependencies);
        await renewIntentOrLose();
        await updatePostPresentationDocument({
          id: predecessorId,
          patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
          actingUserSystemId,
          operation: 'post-presentation-supersede-mp4',
          requestId,
          operationId: uploadId,
        }, dependencies);
      } catch (error) {
        supersedeFailures.push(predecessorId);
        await recordReconciliation({
          requestId,
          operationId: uploadId,
          requestDocumentId: createdId,
          predecessorIds: [predecessorId],
          artifactType,
          fenceVersion: slot.fenceVersion,
          stage: 'predecessor-supersede',
          reason: error.code || 'predecessor_update_failed',
          candidateDriveId: candidate.driveId,
          candidateItemId: candidate.itemId,
        }, dependencies);
        if (['post_presentation_slot_lease_lost', 'post_presentation_upload_lease_lost'].includes(error?.code)) {
          throw error;
        }
      }
    }
    try {
      renewed = await renewIntentOrLose();
    } catch (error) {
      await recordReconciliation({
        requestId,
        operationId: uploadId,
        requestDocumentId: createdId,
        predecessorIds: predecessors,
        artifactType,
        fenceVersion: slot.fenceVersion,
        stage: 'pre-complete-intent-lease-lost',
        reason: error.code || 'upload_lease_lost',
        candidateDriveId: candidate.driveId,
        candidateItemId: candidate.itemId,
      }, dependencies);
      throw error;
    }
    const completed = await dependencies.completeUploadIntent({ uploadId, leaseToken, requestDocumentId: createdId });
    if (!completed) {
      throw materialError('The recording was saved but its upload receipt was not finalized.', 'post_presentation_upload_completion_failed', 503);
    }
    const after = await dependencies.findDocuments(requestId);
    const projected = staffProjection(after?.records || [], requestId);
    const unresolved = projected.conflicts.filter((conflict) => (
      conflict.artifactType === artifactType && conflict.reason === 'eligible_non_winner'
    ));
    if (unresolved.length > 0) {
      await recordReconciliation({
        requestId,
        operationId: uploadId,
        requestDocumentId: createdId,
        predecessorIds: unresolved.map((conflict) => conflict.artifactId).filter(Boolean),
        artifactType,
        fenceVersion: slot.fenceVersion,
        stage: 'post-write-projection',
        reason: 'multiple_active_rows',
        candidateDriveId: candidate.driveId,
        candidateItemId: candidate.itemId,
      }, dependencies);
    }
    return {
      ...projected,
      uploadId,
      requestDocumentId: createdId,
      replayed: Boolean(recovered?.records?.[0]),
      reconciliationRequired: supersedeFailures.length > 0 || unresolved.length > 0,
    };
  } finally {
    try {
      await dependencies.releaseSlotLease(slot);
    } catch (error) {
      await recordReconciliation({
        requestId,
        operationId: uploadId,
        requestDocumentId: createdId,
        predecessorIds: predecessors,
        artifactType,
        fenceVersion: slot.fenceVersion,
        stage: 'lease-release',
        reason: error?.code || 'lease_release_failed',
      }, dependencies);
    }
  }
}

export async function finalizeMp4Upload({
  requestId,
  uploadId,
  actingUserSystemId,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(uploadId)) {
    throw materialError('A valid recording finalize request is required.', 'invalid_upload_id', 400);
  }
  assertMp4Actor(actingUserSystemId);
  assertFeature(requestId, dependencies);
  await loadBoundContext(requestId, dependencies);
  const claim = await dependencies.claimUploadIntent({ uploadId, requestId, actorId: actingUserSystemId });
  if (claim.state === 'not_found') throw materialError('Upload not found.', 'post_presentation_upload_not_found', 404);
  if (claim.state === 'expired') throw materialError('The upload finalize grace period expired.', 'post_presentation_upload_expired', 410);
  if (claim.state === 'busy') {
    throw materialError('This upload is already being finalized.', 'post_presentation_finalize_in_progress', 409, { retryable: true });
  }
  if (claim.state === 'finalized') {
    const documents = await dependencies.findDocuments(requestId);
    return {
      ...staffProjection(documents?.records || [], requestId),
      uploadId,
      requestDocumentId: claim.row.request_document_id,
      replayed: true,
      reconciliationRequired: false,
    };
  }
  try {
    return await finalizeClaimedMp4Upload({
      row: claim.row,
      leaseToken: claim.leaseToken,
      actingUserSystemId,
    }, dependencies);
  } catch (error) {
    try {
      await dependencies.releaseUploadIntent({
        uploadId,
        leaseToken: claim.leaseToken,
        lastError: error?.code || 'finalize_failed',
      });
    } catch (releaseError) {
      console.error('[post-presentation-materials] MP4 intent release failed:', releaseError?.message || releaseError);
    }
    throw error;
  }
}

export async function mintTranscriptUpload({
  requestId,
  actorProfileId,
  actingUserSystemId,
  filename,
  contentType,
  size,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  if (!isGuid(actingUserSystemId || '')) {
    throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  }
  if (actorProfileId === null || actorProfileId === undefined || actorProfileId === '') {
    throw materialError('A staff profile is required.', 'post_presentation_profile_required', 403);
  }
  assertFeature(requestId, dependencies);
  await loadBoundContext(requestId, dependencies);
  const validation = validatePostPresentationTranscriptDescriptor(filename, contentType, size);
  if (!validation.ok) {
    throw materialError('The transcript upload is not valid.', validation.reason, 400);
  }
  return dependencies.createPortalUpload({
    scope: PORTAL_UPLOAD_SCOPES.POST_PRESENTATION_TRANSCRIPT,
    resourceId: requestId,
    actorBinding: staffActorBinding(actorProfileId),
    filename,
    contentType,
    maxBytes: POST_PRESENTATION_TRANSCRIPT_MAX_BYTES,
    allowedContentTypes: POST_PRESENTATION_TRANSCRIPT_CONTENT_TYPES,
  });
}

function validateTranscriptCandidate(candidate, expected) {
  return candidate
    && sameId(candidate.requestId, expected.requestId)
    && candidate.generationKey === expected.generationKey
    && candidate.sha256 === expected.sha256
    && candidate.contentType === expected.contentType
    && Number(candidate.size) === expected.size
    && typeof candidate.driveId === 'string' && candidate.driveId
    && typeof candidate.itemId === 'string' && candidate.itemId
    && typeof candidate.filename === 'string' && candidate.filename;
}

async function verifyTranscriptCandidate(candidate, dependencies) {
  let metadata;
  try {
    metadata = await dependencies.getFileMetadataById(candidate.driveId, candidate.itemId, {
      siteId: candidate.siteId || null,
    });
  } catch (error) {
    throw materialError('The recorded transcript upload could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!metadata
    || !sameId(metadata.driveId, candidate.driveId)
    || !sameId(metadata.id, candidate.itemId)
    || metadata.name !== candidate.filename
    || Number(metadata.size) !== Number(candidate.size)) {
    throw materialError('The recorded transcript upload no longer matches its receipt.', 'post_presentation_candidate_mismatch', 409);
  }
  const receiptStable = Boolean(candidate.eTag || candidate.versionId)
    && (!candidate.eTag || metadata.eTag === candidate.eTag)
    && (!candidate.versionId || metadata.versionId === candidate.versionId);
  if (!receiptStable) {
    let downloaded;
    try {
      downloaded = await dependencies.downloadFile(candidate.driveId, candidate.itemId);
    } catch (error) {
      throw materialError('The recorded transcript bytes could not be verified.', 'post_presentation_candidate_unavailable', 503);
    }
    if (!Buffer.isBuffer(downloaded?.buffer)
      || downloaded.buffer.length !== Number(candidate.size)
      || digest(downloaded.buffer) !== candidate.sha256) {
      throw materialError('The recorded transcript bytes no longer match its receipt.', 'post_presentation_candidate_mismatch', 409);
    }
    const stable = await dependencies.getFileMetadataById(candidate.driveId, candidate.itemId, {
      siteId: candidate.siteId || null,
    });
    if (!stable || stable.name !== metadata.name || Number(stable.size) !== Number(metadata.size)
      || stable.eTag !== metadata.eTag || stable.versionId !== metadata.versionId) {
      throw materialError('The recorded transcript changed during verification.', 'post_presentation_candidate_mismatch', 409);
    }
    return {
      ...candidate,
      siteId: stable.siteId || candidate.siteId || null,
      versionId: stable.versionId || null,
      eTag: stable.eTag || null,
      webUrl: stable.webUrl || candidate.webUrl || null,
      lastModified: stable.lastModified || candidate.lastModified || null,
    };
  }
  return candidate;
}

async function recoverTranscriptPathCandidate({
  bucket, folderPath, filename, expectedCandidate, dependencies,
}) {
  let metadata;
  try {
    metadata = await dependencies.getFileMetadataByPath(bucket.library, folderPath, filename);
  } catch (error) {
    throw materialError('The existing transcript upload could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!metadata) {
    throw materialError('The existing transcript upload is not visible yet.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!metadata.id || !metadata.driveId || metadata.name !== filename
    || Number(metadata.size) !== expectedCandidate.size) {
    throw materialError('The existing transcript path does not match this retry.', 'post_presentation_candidate_mismatch', 409);
  }
  let downloaded;
  try {
    downloaded = await dependencies.downloadFile(metadata.driveId, metadata.id);
  } catch (error) {
    throw materialError('The existing transcript bytes could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!Buffer.isBuffer(downloaded?.buffer)
    || downloaded.buffer.length !== expectedCandidate.size
    || digest(downloaded.buffer) !== expectedCandidate.sha256) {
    throw materialError('The existing transcript bytes do not match this retry.', 'post_presentation_candidate_mismatch', 409);
  }
  const stable = await dependencies.getFileMetadataById(metadata.driveId, metadata.id, {
    siteId: metadata.siteId || null,
  });
  if (!stable || stable.name !== metadata.name || Number(stable.size) !== Number(metadata.size)
    || (metadata.eTag && stable.eTag !== metadata.eTag)
    || (metadata.versionId && stable.versionId !== metadata.versionId)) {
    throw materialError('The existing transcript changed during recovery.', 'post_presentation_candidate_mismatch', 409);
  }
  return {
    ...expectedCandidate,
    siteId: stable.siteId || metadata.siteId || null,
    driveId: stable.driveId,
    itemId: stable.id,
    versionId: stable.versionId || null,
    eTag: stable.eTag || null,
    folderPath,
    filename: stable.name,
    webUrl: stable.webUrl || null,
    lastModified: stable.lastModified || null,
  };
}

export async function finalizeTranscriptUpload({
  requestId,
  stagingId,
  actorProfileId,
  actingUserSystemId,
  file,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  if (!isGuid(stagingId)) throw materialError('A valid stagingId is required.', 'invalid_staging_id', 400);
  if (!isGuid(actingUserSystemId || '')) {
    throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  }
  if (actorProfileId === null || actorProfileId === undefined || actorProfileId === '') {
    throw materialError('A staff profile is required.', 'post_presentation_profile_required', 403);
  }
  assertFeature(requestId, dependencies);
  const validated = validatePostPresentationTranscript(file?.filename, file?.mimeType, file?.buffer);
  if (!validated.ok) {
    throw materialError('The transcript upload is not valid.', validated.reason, 422);
  }
  const computedSha256 = digest(file.buffer);
  if (file.sha256 && file.sha256 !== computedSha256) {
    throw materialError('The staged transcript hash does not match its bytes.', 'post_presentation_content_mismatch', 409);
  }
  if (dependencies.scanEnabled()) {
    let scan;
    try {
      scan = await dependencies.scanBytes(file.buffer, file.filename);
    } catch (error) {
      if (scanIsMisconfigured(error)) {
        throw materialError('The malware scanner is not configured correctly.', 'scan_misconfigured', 500);
      }
      throw materialError('The transcript could not be scanned. Try again shortly.', 'scan_unavailable', 503);
    }
    const verdict = scan?.scan_result ?? scan?.scanResult ?? null;
    if (verdict === 'infected') {
      throw materialError('The transcript failed the malware scan.', 'scan_infected', 422);
    }
    if (verdict !== 'clean') {
      throw materialError('The transcript could not be scanned. Try again shortly.', 'scan_unavailable', 503);
    }
  }

  const { request, cycleCode } = await loadBoundContext(requestId, dependencies);
  const artifactType = REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT;
  const sha256 = computedSha256;
  const generationKey = digest(`${PRODUCER}:${requestId.toLowerCase()}:${artifactType}:${stagingId.toLowerCase()}:${sha256}`);
  const expectedCandidate = {
    requestId,
    generationKey,
    sha256,
    contentType: validated.contentType,
    size: file.buffer.length,
  };
  let candidate = file.candidate || null;
  if (candidate) {
    if (!validateTranscriptCandidate(candidate, expectedCandidate)) {
      throw materialError('The recorded transcript upload does not match this retry.', 'post_presentation_candidate_mismatch', 409);
    }
    const verifiedCandidate = await verifyTranscriptCandidate(candidate, dependencies);
    if (verifiedCandidate.eTag !== candidate.eTag || verifiedCandidate.versionId !== candidate.versionId) {
      candidate = verifiedCandidate;
      await dependencies.renewPortalUploadLease({ stagingId, leaseToken: file.leaseToken });
      await dependencies.recordPortalUploadCandidate({ stagingId, leaseToken: file.leaseToken, candidate });
    }
  } else {
    const bucket = activeBucket(await dependencies.getSharePointBuckets(requestId, request.akoya_requestnum));
    if (!bucket) {
      throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);
    }
    const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/Site Visit - Transcript`;
    await dependencies.ensureFolderPath(bucket.library, folderPath);
    const filename = `${sanitizeForSharePoint(request.akoya_requestnum || 'Request')}-Transcript-${stagingId}.${validated.extension}`;
    let uploaded;
    try {
      uploaded = await dependencies.uploadFile(
        bucket.library,
        folderPath,
        filename,
        file.buffer,
        validated.contentType,
        { conflictBehavior: 'fail' },
      );
    } catch (error) {
      if (Number(error?.status) !== 409) throw error;
      candidate = await recoverTranscriptPathCandidate({
        bucket, folderPath, filename, expectedCandidate, dependencies,
      });
    }
    if (!candidate) {
      if (!uploaded?.id || !uploaded?.driveId || !uploaded?.name
        || Number(uploaded.size) !== file.buffer.length) {
        throw materialError('SharePoint did not confirm the complete transcript upload.', 'post_presentation_upload_unconfirmed', 502);
      }
      candidate = {
        ...expectedCandidate,
        siteId: uploaded.siteId || null,
        driveId: uploaded.driveId,
        itemId: uploaded.id,
        versionId: uploaded.versionId || null,
        eTag: uploaded.eTag || null,
        folderPath,
        filename: uploaded.name,
        webUrl: uploaded.webUrl || null,
        lastModified: uploaded.lastModified || null,
      };
    }
    try {
      await dependencies.renewPortalUploadLease({ stagingId, leaseToken: file.leaseToken });
      await dependencies.recordPortalUploadCandidate({
        stagingId,
        leaseToken: file.leaseToken,
        candidate,
      });
    } catch (error) {
      await recordReconciliation({
        requestId,
        operationId: stagingId,
        artifactType,
        fenceVersion: null,
        stage: 'candidate-ledger',
        reason: error?.code || 'candidate_record_failed',
        candidateDriveId: candidate.driveId,
        candidateItemId: candidate.itemId,
      }, dependencies);
      throw error;
    }
  }

  await dependencies.renewPortalUploadLease({ stagingId, leaseToken: file.leaseToken });
  const lease = await acquireMaterialSlot({
    requestId, artifactType, leaseToken: file.leaseToken, label: 'transcript',
  }, dependencies);
  let createdId = null;
  let predecessors = [];
  try {
    const before = await dependencies.findDocuments(requestId);
    predecessors = (before?.records || [])
      .filter((row) => (
        Number(row.wmkf_artifacttype) === artifactType
        && isEligiblePostPresentationRow(row, requestId)
        && (row.wmkf_slotversion == null || Number(row.wmkf_slotversion) < lease.fenceVersion)
      ))
      .map((row) => row.wmkf_requestdocumentid)
      .filter(Boolean);

    await renewOrLose(lease, dependencies);
    const recovered = await dependencies.findDocumentByGenerationKey(generationKey);
    if ((recovered?.records || []).length > 1) {
      throw materialError('The transcript retry identity is ambiguous.', 'post_presentation_generation_ambiguous', 500);
    }
    let row = recovered?.records?.[0] || null;
    if (row && !validateRecoveredTranscriptRow(row, {
      requestId,
      generationKey,
      inputFingerprint: sha256,
      fenceVersion: lease.fenceVersion,
      candidate,
    })) {
      throw materialError('The transcript retry does not match the original operation.', 'post_presentation_replay_mismatch', 409);
    }
    if (!row) {
      await dependencies.renewPortalUploadLease({ stagingId, leaseToken: file.leaseToken });
      row = await createPostPresentationDocument({ payload: {
        wmkf_name: `${request.akoya_requestnum || 'Request'} research presentation transcript`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: sha256,
        wmkf_claimtoken: dependencies.randomUUID(),
        wmkf_producer: PRODUCER,
        wmkf_contenttype: validated.contentType,
        wmkf_contenthash: sha256,
        wmkf_sharepointsiteid: candidate.siteId,
        wmkf_sharepointdriveid: candidate.driveId,
        wmkf_sharepointitemid: candidate.itemId,
        wmkf_sharepointweburl: candidate.webUrl,
        wmkf_sharepointversionid: candidate.versionId,
        wmkf_sharepointetag: candidate.eTag,
        wmkf_sharepointfolderpath: candidate.folderPath,
        wmkf_filename: candidate.filename,
        wmkf_filesize: candidate.size,
        wmkf_sharepointlastmodified: candidate.lastModified,
        wmkf_slotversion: lease.fenceVersion,
      },
        actingUserSystemId,
        operation: 'post-presentation-finalize-transcript',
        requestId,
        operationId: stagingId,
      }, dependencies);
      createdId = row?.wmkf_requestdocumentid || row?.id || null;
      if (!createdId) {
        throw materialError('Dataverse did not confirm the transcript row.', 'post_presentation_create_unconfirmed', 502);
      }
    } else {
      createdId = row.wmkf_requestdocumentid;
      const recoveredFence = Number(row.wmkf_slotversion);
      const visibleBefore = projectPostPresentationMaterials(before?.records || [], requestId).winners
        .find((current) => Number(current.wmkf_artifacttype) === artifactType);
      if (visibleBefore && Number(visibleBefore.wmkf_slotversion || 0) > recoveredFence) {
        await renewOrLose(lease, dependencies);
        await updatePostPresentationDocument({
          id: createdId,
          patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
          actingUserSystemId,
          operation: 'post-presentation-supersede-stale-transcript-retry',
          requestId,
          operationId: stagingId,
        }, dependencies);
        const after = await dependencies.findDocuments(requestId);
        return {
          ...staffProjection(after?.records || [], requestId),
          stagingId,
          requestDocumentId: createdId,
          replayed: true,
          reconciliationRequired: false,
        };
      }
    }

    try {
      await renewOrLose(lease, dependencies);
    } catch (error) {
      await recordReconciliation({
        requestId, operationId: stagingId, requestDocumentId: createdId, predecessorIds: predecessors,
        artifactType, fenceVersion: lease.fenceVersion, stage: 'post-create-lease-lost',
        reason: error.code || 'slot_lease_lost',
      }, dependencies);
      throw error;
    }

    const supersedeFailures = [];
    for (const predecessorId of predecessors.filter((id) => !sameId(id, createdId))) {
      try {
        await renewOrLose(lease, dependencies);
        await updatePostPresentationDocument({
          id: predecessorId,
          patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
          actingUserSystemId,
          operation: 'post-presentation-supersede-transcript',
          requestId,
          operationId: stagingId,
        }, dependencies);
      } catch (error) {
        supersedeFailures.push(predecessorId);
        await recordReconciliation({
          requestId, operationId: stagingId, requestDocumentId: createdId, predecessorIds: [predecessorId],
          artifactType, fenceVersion: lease.fenceVersion, stage: 'predecessor-supersede',
          reason: error.code || 'predecessor_update_failed',
        }, dependencies);
        if (error?.code === 'post_presentation_slot_lease_lost') break;
      }
    }
    const after = await dependencies.findDocuments(requestId);
    const projected = staffProjection(after?.records || [], requestId);
    const unresolved = projected.conflicts.filter((conflict) => (
      conflict.artifactType === artifactType && conflict.reason === 'eligible_non_winner'
    ));
    if (unresolved.length > 0) {
      await recordReconciliation({
        requestId, operationId: stagingId, requestDocumentId: createdId,
        predecessorIds: unresolved.map((conflict) => conflict.artifactId).filter(Boolean),
        artifactType, fenceVersion: lease.fenceVersion, stage: 'post-write-projection',
        reason: 'multiple_active_rows',
      }, dependencies);
    }
    return {
      ...projected,
      stagingId,
      requestDocumentId: createdId,
      replayed: Boolean(recovered?.records?.[0]),
      reconciliationRequired: supersedeFailures.length > 0 || unresolved.length > 0,
    };
  } finally {
    try {
      await dependencies.releaseSlotLease(lease);
    } catch (error) {
      await recordReconciliation({
        requestId, operationId: stagingId, requestDocumentId: createdId, predecessorIds: predecessors,
        artifactType, fenceVersion: lease.fenceVersion, stage: 'lease-release',
        reason: error?.code || 'lease_release_failed',
      }, dependencies);
    }
  }
}

export const _internal = {
  digest,
  validateRecoveredZoomRow,
  validateRecoveredTranscriptRow,
  validateTranscriptCandidate,
  staffProjection,
  loadBoundContext,
};
