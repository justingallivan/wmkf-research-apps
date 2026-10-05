/** Staff presentation materials, source-attested DOCX transcripts, and MP4 upload recovery. */
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
import { attestDocxPackageAgainstSource, DOCX_PACKAGE_BUDGET } from '../test-requests/docx-package-attestation.js';
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
  reacquirePresentationSlotLease,
  getPresentationSlotLease,
  releasePresentationSlotLease,
  renewPresentationSlotLease,
} from './slot-lease-store.js';
import {
  PRESENTATION_UPLOAD_REVIEW_GRACE_MS,
  cancelPresentationMaterialUploadRecovery,
  claimPresentationMaterialUpload,
  claimPresentationMaterialUploadRecovery,
  completePresentationMaterialUpload,
  getPresentationMaterialUpload,
  insertPresentationMaterialUpload,
  listPresentationMaterialUploads,
  markPresentationMaterialUploadFailed,
  markPresentationMaterialUploadSessionClosed,
  markPresentationMaterialUploadRecoveryTerminal,
  markPresentationMaterialUploadRecoveryUncertain,
  recordPresentationMaterialUploadCandidate,
  recordPresentationMaterialUploadSession,
  recordPresentationMaterialUploadRecoverySession,
  refreshPresentationMaterialUploadSession,
  releasePresentationMaterialUpload,
  releasePresentationMaterialUploadRecovery,
  renewPresentationMaterialUploadLease,
  renewPresentationMaterialUploadRecovery,
} from './upload-intent-store.js';
import {
  openPresentationUploadUrl,
  sealPresentationUploadUrl,
} from './upload-session-crypto.js';
import { GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES } from '../../../shared/utils/graph-browser-upload.js';
import { isMeetingTranscriptBundleSchemaReady } from '../../utils/meeting-transcript-bundle-readiness.js';
import {
  assertMeetingTranscriptionSupervisedTestBinding,
  getMeetingTranscriptionSupervisedTestPolicy,
} from '../meeting-tracker-transcription/test-deployment-policy.js';

const PRODUCER = 'meeting-tracker-post-presentation';
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'];
const TERMINAL_MP4_VALIDATION_CODES = new Set([
  'post_presentation_mp4_signature_invalid',
  'post_presentation_mp4_malware',
]);

export const POST_PRESENTATION_MATERIALS_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  requestAllowed: isPostPresentationMaterialsRequestAllowed,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findActiveSiteVisit: (requestId) => siteVisitAdapter.findActiveByRequest(requestId),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  findDocumentsWithMeetingTranscriptBundle: (requestId) => requestDocumentAdapter.findByRequest(requestId, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, includeMeetingTranscriptBundle: true,
  }),
  findDocumentByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  findMeetingTranscriptDocumentByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key, { includeMeetingTranscriptBundle: true }),
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
  cancelBrowserUploadSession: (...args) => GraphService.cancelBrowserUploadSession(...args),
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
  claimUploadRecovery: claimPresentationMaterialUploadRecovery,
  renewUploadRecovery: renewPresentationMaterialUploadRecovery,
  releaseUploadRecovery: releasePresentationMaterialUploadRecovery,
  markUploadRecoveryTerminal: markPresentationMaterialUploadRecoveryTerminal,
  markUploadRecoveryUncertain: markPresentationMaterialUploadRecoveryUncertain,
  cancelUploadRecovery: cancelPresentationMaterialUploadRecovery,
  recordUploadRecoverySession: recordPresentationMaterialUploadRecoverySession,
  renewUploadLease: renewPresentationMaterialUploadLease,
  releaseUploadIntent: releasePresentationMaterialUpload,
  completeUploadIntent: completePresentationMaterialUpload,
  sealUploadUrl: sealPresentationUploadUrl,
  openUploadUrl: openPresentationUploadUrl,
  acquireSlotLease: acquirePresentationSlotLease,
  reacquireSlotLease: reacquirePresentationSlotLease,
  getSlotLease: getPresentationSlotLease,
  renewSlotLease: renewPresentationSlotLease,
  releaseSlotLease: releasePresentationSlotLease,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  randomUUID,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export function materialError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function transcriptTextInvalidError() {
  return materialError(
    "This file is not a readable text transcript. Zoom's chat.txt and renamed media files are not transcripts.",
    'transcript_text_invalid',
    422,
  );
}

function isPlainTextTranscriptType(contentType) {
  return contentType === 'text/plain' || contentType === 'text/vtt';
}

function assertReadableTextTranscript(buffer, extension) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw transcriptTextInvalidError();
  }
  if (text.includes('\0')) throw transcriptTextInvalidError();
  if (extension === 'vtt' && !text.replace(/^\uFEFF/, '').trimStart().startsWith('WEBVTT')) {
    throw transcriptTextInvalidError();
  }
}

function rejectedMp4Upload(row) {
  return row?.state === 'failed' && Boolean(row.candidate_item_id);
}

function mp4RejectedError() {
  return materialError('This recording was rejected. Choose a different MP4.', 'post_presentation_upload_rejected', 409);
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
      : JSON.stringify(value);
}

export function activeBucket(buckets) {
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

export function sanitizeForSharePoint(value) {
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

export async function loadBoundContext(requestId, dependencies) {
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

export async function acquireMaterialSlot({ requestId, artifactType, leaseToken, label }, dependencies) {
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

export async function renewOrLose(lease, dependencies) {
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
    && (Number(row.wmkf_filesize) === Number(spec.candidate.size)
      || (isDocxTranscript(spec.candidate)
        && Number(row.wmkf_filesize) === spec.candidate.registrySize))
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
  return (Array.isArray(rows) ? rows : []).filter((row) => !rejectedMp4Upload(row)).map((row) => {
    const reviewLive = new Date(row.intent_expires_at).getTime() > now.getTime();
    const leased = Boolean(row.lease_token)
      && new Date(row.lease_expires_at || 0).getTime() > now.getTime();
    const unfinished = ['initiated', 'failed'].includes(row.state)
      && !row.candidate_item_id && !row.request_document_id;
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
      canResume: !leased && row.state === 'initiated'
        && Boolean(row.upload_session_expires_at)
        && reviewLive,
      canCancel: !leased && unfinished,
      canRetry: !leased && row.state === 'failed' && unfinished,
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
  const match = String(ranges[0] || '').match(/^(\d+)-(\d+)?$/);
  const start = Number(match?.[1]);
  const boundedEnd = match?.[2] === undefined ? null : Number(match[2]);
  if (!match || !Number.isInteger(start) || start < 0 || start >= size
    || (boundedEnd !== null && (!Number.isInteger(boundedEnd) || boundedEnd !== size - 1))) {
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
    if (rejectedMp4Upload(existing)) throw mp4RejectedError();
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
    if (rejectedMp4Upload(raced)) throw mp4RejectedError();
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
  if (row.state === 'abandoned') {
    throw materialError('This upload was already cancelled.', 'post_presentation_upload_cancelled', 409);
  }
  if (rejectedMp4Upload(row)) throw mp4RejectedError();
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
    let partialSeen = exact.state === 'partial';
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
      partialSeen ||= visible.state === 'partial';
    }
    const lastError = Number(error.status) === 410 && !partialSeen
      ? 'session_expired' : 'session_closed_unknown';
    const closed = await dependencies.markUploadSessionClosed({
      uploadId, requestId, actorId: actingUserSystemId,
      uploadUrlCiphertext: row.upload_url_ciphertext, lastError,
    });
    if (!closed) throw materialError('The upload changed during status reconciliation.', 'post_presentation_upload_changed', 409);
    if (Number(error.status) === 410) {
      if (partialSeen) throw recoveryPending();
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
    uploadUrlCiphertext: row.upload_url_ciphertext,
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

async function claimMp4Recovery({ requestId, uploadId, actingUserSystemId, resumeFingerprint }, dependencies) {
  if (!isGuid(requestId) || !isGuid(uploadId)) {
    throw materialError('A valid upload recovery request is required.', 'invalid_upload_id', 400);
  }
  assertMp4Actor(actingUserSystemId);
  assertFeature(requestId, dependencies);
  const { siteVisit } = await loadBoundContext(requestId, dependencies);
  const row = await dependencies.getUploadIntent({ uploadId, requestId, actorId: actingUserSystemId });
  if (!row) throw materialError('Upload not found.', 'post_presentation_upload_not_found', 404);
  if (!sameVisit(row, siteVisit)) {
    throw materialError('The active Site Visit changed after this upload began.', 'post_presentation_site_visit_changed', 409);
  }
  if (resumeFingerprint !== undefined && row.client_resume_fingerprint !== resumeFingerprint) {
    throw materialError('The selected file does not match this upload.', 'post_presentation_resume_fingerprint_mismatch', 409);
  }
  if (row.state === 'finalized') {
    const documents = await dependencies.findDocuments(requestId);
    return { result: {
      ...staffProjection(documents?.records || [], requestId),
      uploadId, requestDocumentId: row.request_document_id,
      finalized: true,
    } };
  }
  if (row.state === 'abandoned' && resumeFingerprint === undefined) {
    return { result: { uploadId, cancelled: true } };
  }
  if (row.state === 'abandoned') {
    throw materialError('This upload was already cancelled.', 'post_presentation_upload_cancelled', 409);
  }
  if (rejectedMp4Upload(row)) throw mp4RejectedError();
  if (row.state === 'finalizing'
    && new Date(row.lease_expires_at || 0).getTime() > dependencies.now().getTime()) {
    throw materialError('This upload is currently being finalized.', 'post_presentation_finalize_in_progress', 409);
  }
  if (row.candidate_item_id) {
    return { result: { uploadId, complete: true, canFinalize: true } };
  }
  if (row.state === 'uploaded') throw recoveryPending();
  const claim = await dependencies.claimUploadRecovery({ uploadId, requestId, actorId: actingUserSystemId });
  if (!claim) {
    throw materialError('This upload is being changed or finalized. Reload and retry.', 'post_presentation_upload_changed', 409);
  }
  return { row: claim.row, leaseToken: claim.leaseToken };
}

async function renewMp4Recovery(row, leaseToken, dependencies) {
  const renewed = await dependencies.renewUploadRecovery({ uploadId: row.id, leaseToken });
  if (!renewed) throw materialError('This upload changed during recovery.', 'post_presentation_upload_changed', 409);
}

async function recoveryPath(row, leaseToken, dependencies, delays = [0, 2_000, 8_000]) {
  for (const delayMs of delays) {
    if (delayMs) await dependencies.sleep(delayMs);
    await renewMp4Recovery(row, leaseToken, dependencies);
    const exact = await resolveStableMp4Path(row, dependencies);
    if (exact.state === 'complete') {
      await persistMp4Candidate(row, exact.candidate, leaseToken, dependencies);
      return { state: 'complete' };
    }
    if (exact.state !== 'absent') return { state: 'uncertain' };
  }
  return { state: 'absent' };
}

function recoveryPending() {
  return materialError(
    'The exact SharePoint file is still present or its outcome is uncertain. The upload was retained for reconciliation.',
    'post_presentation_upload_reconciliation_pending',
    409,
  );
}

/** Cancel only a staff-owned unfinished session, never a committed SharePoint item. */
export async function cancelMp4Upload({
  requestId, uploadId, actingUserSystemId,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  const claim = await claimMp4Recovery({ requestId, uploadId, actingUserSystemId }, dependencies);
  if (claim.result) return claim.result;
  const { row, leaseToken } = claim;
  try {
    const initial = await recoveryPath(row, leaseToken, dependencies, [0]);
    if (initial.state === 'complete') return { uploadId, complete: true, canFinalize: true };
    let cancellation = null;
    if (row.upload_url_ciphertext) {
      let uploadUrl;
      try {
        uploadUrl = dependencies.openUploadUrl(row.upload_url_ciphertext);
      } catch {
        throw recoveryPending();
      }
      await renewMp4Recovery(row, leaseToken, dependencies);
      cancellation = await dependencies.cancelBrowserUploadSession(uploadUrl);
    } else if (row.state !== 'failed') {
      throw recoveryPending();
    }
    const visible = await recoveryPath(row, leaseToken, dependencies);
    if (visible.state === 'complete') return { uploadId, complete: true, canFinalize: true };
    if (visible.state !== 'absent' || (cancellation && !['cancelled', 'expired'].includes(cancellation.outcome))) {
      const marked = await dependencies.markUploadRecoveryUncertain({
        uploadId, leaseToken,
        lastError: visible.state === 'absent' ? 'cancel_status_unknown' : 'cancel_path_uncertain',
      });
      if (!marked) throw materialError('This upload changed during cancellation.', 'post_presentation_upload_changed', 409);
      throw recoveryPending();
    }
    await renewMp4Recovery(row, leaseToken, dependencies);
    const cancelled = await dependencies.cancelUploadRecovery({ uploadId, leaseToken });
    if (!cancelled) throw materialError('This upload changed during cancellation.', 'post_presentation_upload_changed', 409);
    return { uploadId, cancelled: true };
  } finally {
    await dependencies.releaseUploadRecovery({ uploadId, leaseToken });
  }
}

/** Explicitly start one fresh zero-based session after Microsoft confirms terminal loss. */
export async function retryMp4Upload({
  requestId, uploadId, actingUserSystemId, resumeFingerprint,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (typeof resumeFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(resumeFingerprint)) {
    throw materialError('A valid file fingerprint is required.', 'post_presentation_resume_fingerprint_invalid', 400);
  }
  const claim = await claimMp4Recovery({ requestId, uploadId, actingUserSystemId, resumeFingerprint }, dependencies);
  if (claim.result) return claim.result;
  const { row, leaseToken } = claim;
  let createdSession = null;
  let recordedSession = false;
  let safeToCancelCreatedSession = false;
  try {
    const initial = await recoveryPath(row, leaseToken, dependencies, [0]);
    if (initial.state === 'complete') return { uploadId, complete: true, canFinalize: true };
    if (initial.state !== 'absent' && !row.upload_url_ciphertext) throw recoveryPending();

    if (row.upload_url_ciphertext) {
      let uploadUrl;
      try {
        uploadUrl = dependencies.openUploadUrl(row.upload_url_ciphertext);
      } catch {
        throw recoveryPending();
      }
      let status;
      try {
        status = await dependencies.getBrowserUploadSessionStatus(uploadUrl);
      } catch (error) {
        if (![404, 410].includes(Number(error?.status))) throw error;
        const visible = await recoveryPath(row, leaseToken, dependencies);
        if (visible.state === 'complete') return { uploadId, complete: true, canFinalize: true };
        if (initial.state !== 'absent' || visible.state !== 'absent' || Number(error.status) !== 410) {
          const marked = await dependencies.markUploadRecoveryUncertain({ uploadId, leaseToken, lastError: 'retry_status_unknown' });
          if (!marked) throw materialError('This upload changed during recovery.', 'post_presentation_upload_changed', 409);
          throw recoveryPending();
        }
        await renewMp4Recovery(row, leaseToken, dependencies);
        const marked = await dependencies.markUploadRecoveryTerminal({ uploadId, leaseToken });
        if (!marked) throw materialError('This upload changed during recovery.', 'post_presentation_upload_changed', 409);
      }
      if (status) {
        exactSequentialRange(status.nextExpectedRanges, Number(row.declared_size));
        const expiresAt = new Date(status.expiresAt);
        if (!Number.isFinite(expiresAt.getTime())) {
          throw materialError('Microsoft returned an invalid upload-session expiry.', 'post_presentation_upload_session_invalid', 502);
        }
        await renewMp4Recovery(row, leaseToken, dependencies);
        const intentExpiresAt = intentReviewAfter(expiresAt).toISOString();
        const saved = row.state === 'failed'
          ? await dependencies.recordUploadRecoverySession({
            uploadId, leaseToken, uploadUrlCiphertext: row.upload_url_ciphertext,
            expiresAt: expiresAt.toISOString(), intentExpiresAt,
          })
          : await dependencies.refreshUploadSession({
            uploadId, requestId, actorId: actingUserSystemId, leaseToken,
            uploadUrlCiphertext: row.upload_url_ciphertext,
            expiresAt: expiresAt.toISOString(), intentExpiresAt,
          });
        if (!saved) throw materialError('This upload changed during recovery.', 'post_presentation_upload_changed', 409);
        return {
          uploadId, lockKey: uploadId, uploadUrl, expiresAt: expiresAt.toISOString(),
          nextExpectedRanges: status.nextExpectedRanges, chunkBytes: GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
          file: { name: row.original_display_filename, size: Number(row.declared_size), contentType: row.validated_mime_type },
          restarted: false,
        };
      }
    } else if (row.state !== 'failed') {
      throw recoveryPending();
    } else {
      const visible = await recoveryPath(row, leaseToken, dependencies);
      if (visible.state === 'complete') return { uploadId, complete: true, canFinalize: true };
      if (visible.state !== 'absent') throw recoveryPending();
    }

    await renewMp4Recovery(row, leaseToken, dependencies);
    createdSession = await dependencies.createBrowserUploadSession(
      row.library_name, row.folder_path, row.physical_filename, { conflictBehavior: 'fail' },
    );
    safeToCancelCreatedSession = true;
    if (exactSequentialRange(createdSession.nextExpectedRanges, Number(row.declared_size)) !== 0) {
      throw materialError('Microsoft returned a nonzero range for a fresh session.', 'post_presentation_upload_range_invalid', 502);
    }
    const expiresAt = new Date(createdSession.expiresAt);
    const intentExpiresAt = intentReviewAfter(expiresAt).toISOString();
    await renewMp4Recovery(row, leaseToken, dependencies);
    const uploadUrlCiphertext = dependencies.sealUploadUrl(createdSession.uploadUrl);
    let saved;
    safeToCancelCreatedSession = false;
    try {
      saved = await dependencies.recordUploadRecoverySession({
        uploadId, leaseToken, uploadUrlCiphertext,
        expiresAt: expiresAt.toISOString(), intentExpiresAt,
      });
    } catch (error) {
      let readback = null;
      try {
        readback = await dependencies.getUploadIntent({ uploadId, requestId, actorId: actingUserSystemId });
      } catch {}
      if (readback?.upload_url_ciphertext === uploadUrlCiphertext && readback.state === 'initiated') {
        saved = readback;
      } else {
        safeToCancelCreatedSession = Boolean(readback)
          && readback.state === 'failed'
          && readback.upload_url_ciphertext === row.upload_url_ciphertext;
        throw error;
      }
    }
    if (!saved) {
      safeToCancelCreatedSession = true;
      throw materialError('This upload changed during recovery.', 'post_presentation_upload_changed', 409);
    }
    recordedSession = true;
    return {
      uploadId, lockKey: uploadId, uploadUrl: createdSession.uploadUrl,
      expiresAt: expiresAt.toISOString(), nextExpectedRanges: createdSession.nextExpectedRanges,
      chunkBytes: GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
      file: { name: row.original_display_filename, size: Number(row.declared_size), contentType: row.validated_mime_type },
      restarted: true,
    };
  } finally {
    if (createdSession && !recordedSession && safeToCancelCreatedSession) {
      try {
        const cancellation = await dependencies.cancelBrowserUploadSession(createdSession.uploadUrl);
        if (!['cancelled', 'expired'].includes(cancellation?.outcome)) {
          await dependencies.recordEvent({
            eventType: 'post_presentation_upload_retry_session_uncertain',
            severity: 'warning',
            summary: 'A fresh upload session was not delivered and its cancellation is uncertain.',
            subsystem: 'post-presentation-materials',
            stage: 'upload-retry',
            transient: false,
            correlationId: uploadId,
            dedupeKey: `post-presentation-upload-retry:${uploadId}:cancel-uncertain`,
            entityRefs: { requestId },
          });
        }
      } catch (error) {
        console.warn('[post-presentation-upload-retry] undisclosed session cancellation failed:', error?.message || error);
      }
    } else if (createdSession && !recordedSession) {
      try {
        await dependencies.recordEvent({
          eventType: 'post_presentation_upload_retry_persistence_uncertain',
          severity: 'warning',
          summary: 'A fresh upload session may have been recorded; cancellation was deferred for reconciliation.',
          subsystem: 'post-presentation-materials',
          stage: 'upload-retry',
          transient: false,
          correlationId: uploadId,
          dedupeKey: `post-presentation-upload-retry:${uploadId}:persistence-uncertain`,
          entityRefs: { requestId },
        });
      } catch (error) {
        console.warn('[post-presentation-upload-retry] persistence alert failed:', error?.message || error);
      }
    }
    await dependencies.releaseUploadRecovery({ uploadId, leaseToken });
  }
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
  if (signature?.malware) {
    throw materialError('Microsoft flagged this recording as unsafe.', 'post_presentation_mp4_malware', 409);
  }
  if (!hasPostPresentationMp4Signature(signature?.bytes)) {
    throw materialError('The uploaded recording is not a valid MP4.', 'post_presentation_mp4_signature_invalid', 415);
  }
  if (signature.mimeType !== POST_PRESENTATION_MP4_CONTENT_TYPE) {
    throw materialError('Microsoft has not confirmed the MP4 media type. Try Finish saving again.', 'post_presentation_mp4_mime_unconfirmed', 409, { retryable: true });
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
  if (claim.state === 'rejected') throw mp4RejectedError();
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
    const terminal = TERMINAL_MP4_VALIDATION_CODES.has(error?.code);
    try {
      await dependencies.releaseUploadIntent({
        uploadId,
        leaseToken: claim.leaseToken,
        lastError: error?.code || 'finalize_failed',
        terminal,
      });
    } catch (releaseError) {
      console.error('[post-presentation-materials] MP4 intent release failed:', releaseError?.message || releaseError);
    }
    if (terminal) {
      try {
        await dependencies.recordEvent({
          eventType: 'post_presentation_upload_validation_rejected',
          severity: 'warning',
          summary: 'A presentation recording failed permanent validation.',
          subsystem: 'post-presentation-materials',
          stage: 'mp4-finalize',
          transient: false,
          correlationId: uploadId,
          dedupeKey: `post-presentation-upload-rejected:${uploadId}:${error.code}`,
          entityRefs: { requestId },
          metadata: { uploadId, reason: error.code },
        });
      } catch (eventError) {
        console.warn('[post-presentation-materials] MP4 rejection event failed:', eventError?.message || eventError);
      }
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

const DOCX_TRANSCRIPT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isDocxTranscript = (candidate) => candidate.contentType === DOCX_TRANSCRIPT_CONTENT_TYPE;

function validateTranscriptCandidate(candidate, expected) {
  const sourceReceipt = candidate && isDocxTranscript(expected)
    && candidate.sourceSha256 !== undefined && candidate.sourceSize !== undefined;
  return candidate
    && sameId(candidate.requestId, expected.requestId)
    && candidate.generationKey === expected.generationKey
    && (sourceReceipt ? candidate.sourceSha256 : candidate.sha256) === expected.sha256
    && candidate.contentType === expected.contentType
    && Number(sourceReceipt ? candidate.sourceSize : candidate.size) === expected.size
    && Number.isSafeInteger(candidate.size) && candidate.size > 0
    && /^[a-f0-9]{64}$/.test(candidate.sha256)
    && (candidate.registrySize === undefined
      || (isDocxTranscript(expected) && Number.isSafeInteger(candidate.registrySize) && candidate.registrySize > 0))
    && typeof candidate.driveId === 'string' && candidate.driveId
    && typeof candidate.itemId === 'string' && candidate.itemId
    && typeof candidate.filename === 'string' && candidate.filename;
}

/** Never log attestor messages: relationship targets and ZIP names may be user data. */
function docxFailureDiagnostics(error) {
  const failures = Array.isArray(error?.failures) ? error.failures : [error?.message];
  const knownParts = new Set([
    '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/custom.xml', 'docProps/app.xml',
    'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml',
    'word/fontTable.xml', 'word/webSettings.xml', 'word/footnotes.xml', 'word/endnotes.xml',
    'word/comments.xml', 'word/_rels/document.xml.rels',
  ]);
  return {
    failureCount: Math.min(failures.length, 2000),
    failures: failures.slice(0, 8).map((failure) => {
      const text = typeof failure === 'string' ? failure.slice(0, 1024) : '';
      const name = text.match(/^(?:part |unexpected part |customXml (?:part|relationships part) )([^ ]{1,160})/)?.[1] || '';
      let part = 'package';
      if (knownParts.has(name) || /^(?:customXml\/(?:item(?:Props)?\d{1,6}\.xml|_rels\/item\d{1,6}\.xml\.rels)|word\/(?:header|footer)\d{1,6}\.xml)$/.test(name)) part = name;
      else if (text.startsWith('document relationship')) part = 'word/_rels/document.xml.rels';
      else if (text.startsWith('content-type') || text.startsWith('[Content_Types].xml')) part = '[Content_Types].xml';
      else if (name.startsWith('word/')) part = 'word/other';
      else if (name.startsWith('customXml/')) part = 'customXml/other';
      else if (name) part = 'other';
      const kind = /exceed|ceiling|above|more than/.test(text) ? 'budget_exceeded'
        : /differs/.test(text) ? 'content_changed'
          : /missing/.test(text) ? 'part_missing'
            : /relationship|content-type|matching sets/.test(text) ? 'structure_mismatch'
              : /unexpected|shape|not a/.test(text) ? 'unsupported_shape' : 'invalid_package';
      return { part, kind };
    }),
  };
}

/**
 * SharePoint may promote DOCX properties or repack the ZIP. Attest every
 * package part against the staged source; an ETag alone never substitutes
 * for this proof. Keep the exact stored-byte receipt for orphan cleanup.
 */
async function verifyDocxTranscriptCandidate(candidate, sourceBuffer, dependencies, uploadContext) {
  const readMetadata = async () => {
    try {
      return await dependencies.getFileMetadataById(candidate.driveId, candidate.itemId, {
        siteId: candidate.siteId || null,
      });
    } catch (error) {
      throw materialError('The transcript upload could not be verified.', 'post_presentation_candidate_unavailable', 503);
    }
  };
  const matchesIdentity = (metadata) => metadata
    && sameId(metadata.driveId, candidate.driveId) && sameId(metadata.id, candidate.itemId)
    && metadata.name === candidate.filename;
  const metadata = await readMetadata();
  if (!metadata) {
    throw materialError('The transcript upload is not visible yet.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw materialError('The transcript size is not confirmed yet.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!matchesIdentity(metadata) || metadata.size > DOCX_PACKAGE_BUDGET.maxTotalUncompressedBytes) {
    throw materialError('The transcript upload no longer matches its identity or bounds.', 'post_presentation_candidate_mismatch', 409);
  }
  if (!metadata.eTag && !metadata.versionId) {
    throw materialError('The transcript upload has no stable receipt yet.', 'post_presentation_candidate_unavailable', 503);
  }
  let downloaded;
  try {
    downloaded = await dependencies.downloadFile(candidate.driveId, candidate.itemId);
  } catch (error) {
    throw materialError('The transcript bytes could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  const stable = await readMetadata();
  if (!stable) {
    throw materialError('The transcript upload could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!matchesIdentity(stable)) {
    throw materialError('The transcript identity changed during verification.', 'post_presentation_candidate_mismatch', 409);
  }
  if (stable.size !== metadata.size || stable.eTag !== metadata.eTag || stable.versionId !== metadata.versionId
    || !Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length !== metadata.size) {
    throw materialError('The transcript is still changing; retry finalization.', 'post_presentation_candidate_unavailable', 503);
  }
  const receipt = {
    ...candidate,
    sourceSha256: digest(sourceBuffer), sourceSize: sourceBuffer.length,
    sha256: digest(downloaded.buffer), size: downloaded.buffer.length,
    siteId: stable.siteId || candidate.siteId || null,
    versionId: stable.versionId || null, eTag: stable.eTag || null,
    webUrl: stable.webUrl || candidate.webUrl || null,
    lastModified: stable.lastModified || candidate.lastModified || null,
  };
  try {
    await attestDocxPackageAgainstSource(downloaded.buffer, sourceBuffer);
  } catch (error) {
    console.warn('[post-presentation-materials] DOCX attestation rejected', {
      requestId: candidate.requestId,
      stagingId: uploadContext.stagingId,
      ...docxFailureDiagnostics(error),
    });
    // Fresh/conflict uploads need an orphan receipt. A recorded retry keeps
    // its prior receipt: changed bytes must not gain cleanup authority.
    // If persistence fails, propagate that failure so the route retains staging.
    if (!uploadContext.hasRecordedCandidate) {
      await dependencies.renewPortalUploadLease(uploadContext);
      await dependencies.recordPortalUploadCandidate({ ...uploadContext, candidate: receipt });
    }
    throw materialError('The stored DOCX does not preserve the staged transcript.', 'post_presentation_candidate_mismatch', 409);
  }
  return receipt;
}

async function verifyTranscriptCandidate(candidate, dependencies, callbacks = {}) {
  let metadata;
  try {
    await callbacks.beforeIO?.();
    metadata = await dependencies.getFileMetadataById(candidate.driveId, candidate.itemId, {
      siteId: candidate.siteId || null,
    });
    await callbacks.afterIO?.();
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
  const receiptStable = !callbacks.forceContent && Boolean(candidate.eTag || candidate.versionId)
    && (!candidate.eTag || metadata.eTag === candidate.eTag)
    && (!candidate.versionId || metadata.versionId === candidate.versionId);
  if (!receiptStable) {
    let downloaded;
    try {
      await callbacks.beforeIO?.();
      downloaded = callbacks.forceContent
        ? await dependencies.downloadFile(candidate.driveId, candidate.itemId, { maxBytes: 4_000_000 })
        : await dependencies.downloadFile(candidate.driveId, candidate.itemId);
      await callbacks.afterIO?.();
    } catch (error) {
      throw materialError('The recorded transcript bytes could not be verified.', 'post_presentation_candidate_unavailable', 503);
    }
    if (!Buffer.isBuffer(downloaded?.buffer)
      || downloaded.buffer.length !== Number(candidate.size)
      || digest(downloaded.buffer) !== candidate.sha256) {
      throw materialError('The recorded transcript bytes no longer match its receipt.', 'post_presentation_candidate_mismatch', 409);
    }
    await callbacks.beforeIO?.();
    const stable = await dependencies.getFileMetadataById(candidate.driveId, candidate.itemId, {
      siteId: candidate.siteId || null,
    });
    await callbacks.afterIO?.();
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
  bucket, folderPath, filename, expectedCandidate, sourceBuffer, dependencies, uploadContext, callbacks = {},
}) {
  let metadata;
  try {
    await callbacks.beforeIO?.();
    metadata = await dependencies.getFileMetadataByPath(bucket.library, folderPath, filename);
    await callbacks.afterIO?.();
  } catch (error) {
    throw materialError('The existing transcript upload could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!metadata) {
    throw materialError('The existing transcript upload is not visible yet.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!metadata.id || !metadata.driveId || metadata.name !== filename
    || (!isDocxTranscript(expectedCandidate) && Number(metadata.size) !== expectedCandidate.size)) {
    throw materialError('The existing transcript path does not match this retry.', 'post_presentation_candidate_mismatch', 409);
  }
  if (isDocxTranscript(expectedCandidate)) {
    return verifyDocxTranscriptCandidate({
      ...expectedCandidate, siteId: metadata.siteId || null,
      driveId: metadata.driveId, itemId: metadata.id, folderPath, filename,
    }, sourceBuffer, dependencies, uploadContext);
  }
  let downloaded;
  try {
    await callbacks.beforeIO?.();
    downloaded = callbacks.maxBytes
      ? await dependencies.downloadFile(metadata.driveId, metadata.id, { maxBytes: callbacks.maxBytes })
      : await dependencies.downloadFile(metadata.driveId, metadata.id);
    await callbacks.afterIO?.();
  } catch (error) {
    throw materialError('The existing transcript bytes could not be verified.', 'post_presentation_candidate_unavailable', 503);
  }
  if (!Buffer.isBuffer(downloaded?.buffer)
    || downloaded.buffer.length !== expectedCandidate.size
    || digest(downloaded.buffer) !== expectedCandidate.sha256) {
    throw materialError('The existing transcript bytes do not match this retry.', 'post_presentation_candidate_mismatch', 409);
  }
  await callbacks.beforeIO?.();
  const stable = await dependencies.getFileMetadataById(metadata.driveId, metadata.id, {
    siteId: metadata.siteId || null,
  });
  await callbacks.afterIO?.();
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
    // A .vtt without the WEBVTT header is a wrong file, not a malformed request.
    if (validated.reason === 'vtt_header_invalid') throw transcriptTextInvalidError();
    throw materialError('The transcript upload is not valid.', validated.reason, 422);
  }
  const computedSha256 = digest(file.buffer);
  if (file.sha256 && file.sha256 !== computedSha256) {
    throw materialError('The staged transcript hash does not match its bytes.', 'post_presentation_content_mismatch', 409);
  }
  // Plain-text transcripts (owner decision 2026-10-04) skip Cloudmersive: no execution surface.
  if (isPlainTextTranscriptType(validated.contentType)) {
    assertReadableTextTranscript(file.buffer, validated.extension);
  } else if (dependencies.scanEnabled()) {
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
      const labels = Array.isArray(scan?.detectedThreats) ? scan.detectedThreats.filter(Boolean) : [];
      if (scan?.signatureDetected !== true && labels.length > 0) {
        throw materialError(
          `The transcript was rejected by the file scanner: ${labels.join(', ')}.`,
          'scan_infected', 422, { contentFlags: Array.isArray(scan?.contentFlags) ? scan.contentFlags : [] },
        );
      }
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
  const uploadContext = { stagingId, leaseToken: file.leaseToken };
  let candidate = file.candidate || null;
  if (candidate) {
    if (!validateTranscriptCandidate(candidate, expectedCandidate)) {
      throw materialError('The recorded transcript upload does not match this retry.', 'post_presentation_candidate_mismatch', 409);
    }
    const verifiedCandidate = isDocxTranscript(expectedCandidate)
      ? await verifyDocxTranscriptCandidate({
        ...candidate, registrySize: candidate.registrySize ?? candidate.size,
      }, file.buffer, dependencies, { ...uploadContext, hasRecordedCandidate: true })
      : await verifyTranscriptCandidate(candidate, dependencies);
    if (['eTag', 'versionId', 'sha256', 'size', 'sourceSha256', 'sourceSize', 'registrySize']
      .some((key) => verifiedCandidate[key] !== candidate[key])) {
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
        bucket, folderPath, filename, expectedCandidate, sourceBuffer: file.buffer, dependencies, uploadContext,
      });
    }
    if (!candidate) {
      if (!uploaded?.id || !uploaded?.driveId || uploaded?.name !== filename
        || (!isDocxTranscript(expectedCandidate) && Number(uploaded.size) !== file.buffer.length)) {
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
      if (isDocxTranscript(expectedCandidate)) {
        candidate = await verifyDocxTranscriptCandidate(candidate, file.buffer, dependencies, uploadContext);
      }
    }
    if (isDocxTranscript(expectedCandidate)) candidate.registrySize = candidate.size;
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
      if (isDocxTranscript(candidate) && candidate.registrySize !== candidate.size) {
        // A previous create may have failed before a later SharePoint repack.
        // Fence the size this create will use; retain it across future replays.
        candidate = { ...candidate, registrySize: candidate.size };
        await dependencies.recordPortalUploadCandidate({ stagingId, leaseToken: file.leaseToken, candidate });
      }
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

/** Resolve exact SharePoint write paths before freezing the publication receipt. */
export async function prepareMeetingTranscriptBundlePublication({ requestId, operationId, siteVisitActivityId }, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(operationId) || !isGuid(siteVisitActivityId)) throw materialError('A valid transcript operation is required.', 'invalid_transcript_operation', 400);
  const supervised = getMeetingTranscriptionSupervisedTestPolicy();
  assertMeetingTranscriptionSupervisedTestBinding(requestId, null);
  assertFeature(requestId, dependencies);
  const { request, siteVisit, cycleCode } = await loadBoundContext(requestId, dependencies);
  if (!sameId(siteVisit.activityid, siteVisitActivityId)) throw materialError('The active Site Visit changed. Reload before publishing.', 'meeting_transcript_site_visit_changed', 409);
  assertMeetingTranscriptionSupervisedTestBinding(requestId, siteVisit.activityid);
  const bucket = activeBucket(await dependencies.getSharePointBuckets(requestId, request.akoya_requestnum));
  if (!bucket) throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);
  const folderPath = supervised.requested
    ? `${String(bucket.folder).replace(/\/+$/, '')}/TEST - Transcription Pilot/${operationId}`
    : `${String(bucket.folder).replace(/\/+$/, '')}/Site Visit - Transcript`;
  const filenameStem = `${sanitizeForSharePoint(request.akoya_requestnum || 'Request')}-Transcript-${operationId}`;
  const filenames = { txt: `${filenameStem}.txt`, vtt: `${filenameStem}.vtt`, source: `${filenameStem}.json` };
  const candidatePaths = Object.fromEntries(Object.entries(filenames).map(([role, filename]) => [role, `${folderPath}/${filename}`]));
  return { request, siteVisit, cycleCode, bucket, folderPath, filenames, candidatePaths };
}

/** Publish one already-formatted Meeting Tracker bundle through the shared TRANSCRIPT slot. */
export async function publishMeetingTranscriptBundle({
  requestId, operationId, actorProfileId, actingUserSystemId, identity,
  files, frozenInputSha256, expectedCurrentArtifactId = null, expectedCurrentFingerprint = null,
  prepared, candidatePaths, callbacks = {}, resumeVerifiedFiles = null, originalSlotFenceVersion = null,
}, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(operationId)) throw materialError('A valid transcript operation is required.', 'invalid_transcript_operation', 400);
  if (!isGuid(actingUserSystemId || '')) throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  if (actorProfileId == null || actorProfileId === '') throw materialError('A staff profile is required.', 'post_presentation_profile_required', 403);
  if (!isMeetingTranscriptBundleSchemaReady()) throw materialError('Transcript bundle metadata is not enabled.', 'meeting_transcript_bundle_schema_not_ready', 503);
  assertFeature(requestId, dependencies);
  const supervised = getMeetingTranscriptionSupervisedTestPolicy();
  const testFolderPath = `${String(prepared?.bucket?.folder || '').replace(/\/+$/, '')}/TEST - Transcription Pilot/${operationId}`;
  const isSupervisedPath = prepared?.folderPath === testFolderPath;
  if (supervised.requested || isSupervisedPath) {
    assertMeetingTranscriptionSupervisedTestBinding(requestId, identity?.siteVisitActivityId);
    if (!supervised.requested || !supervised.enabled
        || !sameId(requestId, supervised.requestId)
        || !sameId(identity?.siteVisitActivityId, supervised.siteVisitActivityId)
        || !isSupervisedPath
        || !['txt', 'vtt', 'source'].every((role) => candidatePaths?.[role] === `${testFolderPath}/${prepared?.filenames?.[role]}`)
        || !['txt', 'vtt', 'source'].every((role) => String(prepared?.filenames?.[role] || '').includes(operationId))) {
      throw materialError('The supervised transcript publication path is not configured for this request and visit.',
        'meeting_transcription_supervised_test_path_mismatch', 409);
    }
  }
  const resuming = Boolean(resumeVerifiedFiles);
  if (typeof callbacks?.renew !== 'function'
    || (!resuming && (typeof callbacks?.recordCandidate !== 'function' || typeof callbacks?.bindSlotFence !== 'function'))) {
    throw materialError('A durable publication receipt is required.', 'meeting_transcript_receipt_required', 503);
  }
  if (!candidatePaths || !['txt','vtt','source'].every(role => typeof candidatePaths[role] === 'string')) {
    throw materialError('Exact transcript paths are required.', 'meeting_transcript_path_binding_mismatch', 409);
  }
  if (!resuming && (!files || !['txt','vtt','source'].every(role => Buffer.isBuffer(files[role]?.bytes)
    && files[role].bytes.length > 0 && digest(files[role].bytes) === files[role].sha256))) {
    throw materialError('The generated transcript bundle is invalid.', 'meeting_transcript_bundle_invalid', 422);
  }
  if (!prepared || !sameId(prepared.request?.akoya_requestid, requestId)
    || !sameId(prepared.siteVisit?.activityid, identity?.siteVisitActivityId)
    || stableJson(prepared.candidatePaths) !== stableJson(candidatePaths)) {
    throw materialError('The frozen transcript paths do not match the active request and visit.', 'meeting_transcript_path_binding_mismatch', 409);
  }
  const { request, cycleCode, bucket, folderPath, filenames } = prepared;
  const artifactType = REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT;
  const currentFingerprint = row => row?.wmkf_inputfingerprint || row?.wmkf_contenthash || null;
  const readCurrent = async () => {
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    const result = await dependencies.findDocuments(requestId);
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    const projection = projectPostPresentationMaterials(result?.records || [], requestId);
    return { rows: result?.records || [], current: projection.winners.find(row => Number(row.wmkf_artifacttype) === artifactType) || null };
  };
  const assertExpectedCurrent = current => {
    if (supervised.requested && current) {
      throw materialError('A supervised test transcript may not replace an existing transcript.',
        'meeting_transcription_supervised_test_transcript_exists', 409);
    }
    const id = current?.wmkf_requestdocumentid || null;
    const fingerprint = currentFingerprint(current);
    if ((id || null) !== (expectedCurrentArtifactId || null)
      || (fingerprint || null) !== (expectedCurrentFingerprint || null)) {
      throw materialError('The current transcript changed. Reload before publishing.', 'meeting_transcript_current_changed', 409);
    }
  };
  const beforeCurrent = await readCurrent();
  assertExpectedCurrent(beforeCurrent.current);
  if (!resuming) {
    // The manifest's boundary is what outside readers trust; it must be the one frozen in the source envelope.
    let frozenEnd = null;
    try { frozenEnd = JSON.parse(files.source.bytes.toString('utf8'))?.presentationEnd ?? null; } catch { frozenEnd = undefined; }
    if (frozenEnd === undefined || stableJson(frozenEnd) !== stableJson(identity?.presentationEnd ?? null)) {
      throw materialError('The transcript manifest boundary does not match its frozen source.', 'meeting_transcript_bundle_invalid', 422);
    }
  }
  const leaseToken = operationId;
  const leaseResult = resuming
    ? await dependencies.reacquireSlotLease({ requestId, artifactType, leaseToken, fenceVersion: originalSlotFenceVersion })
    : null;
  const lease = resuming
    ? (leaseResult ? leaseShape(requestId, artifactType, leaseToken, leaseResult.fence_version) : null)
    : await acquireMaterialSlot({ requestId, artifactType, leaseToken, label: 'transcript' }, dependencies);
  if (!lease || (resuming && lease.fenceVersion !== originalSlotFenceVersion)) {
    throw materialError('The original transcript slot fence is no longer available.', 'meeting_transcript_original_fence_lost', 409);
  }
  let createdId = null;
  try {
    if (!resuming) {
      const fenceBound = await callbacks.bindSlotFence(lease.fenceVersion);
      if (fenceBound !== true) throw materialError('The original publication fence could not be bound to its receipt.', 'meeting_transcript_slot_fence_unrecorded', 409);
    }
    await renewOrLose(lease, dependencies);
    const fencedCurrent = await readCurrent();
    assertExpectedCurrent(fencedCurrent.current);
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    const descriptors = {};
    const sharepointCandidates = {};
    if (!resuming) {
    await dependencies.ensureFolderPath(bucket.library, folderPath);
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    for (const role of ['txt','vtt','source']) {
      await renewOrLose(lease, dependencies);
      const file = files[role];
      const filename = filenames[role];
      if (candidatePaths[role] !== `${folderPath}/${filename}`) throw materialError('The frozen transcript path changed.', 'meeting_transcript_path_binding_mismatch', 409);
      const expectedCandidate = {
        requestId, generationKey: digest(`meeting-transcript:${requestId}:${operationId}:${role}`),
        sha256: file.sha256, contentType: file.contentType, size: file.bytes.length,
      };
      let candidate;
      try {
        if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
        const uploaded = await dependencies.uploadFile(bucket.library, folderPath, filename, file.bytes, file.contentType, { conflictBehavior: 'fail' });
        if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
        if (!uploaded?.id || !uploaded?.driveId || Number(uploaded.size) !== file.bytes.length) {
          throw materialError('SharePoint did not confirm the generated transcript file.', 'meeting_transcript_upload_unconfirmed', 502);
        }
        candidate = { ...expectedCandidate, siteId: uploaded.siteId || null, driveId: uploaded.driveId,
          itemId: uploaded.id, versionId: uploaded.versionId || null, eTag: uploaded.eTag || null,
          folderPath, filename: uploaded.name || filename, webUrl: uploaded.webUrl || null,
          lastModified: uploaded.lastModified || null };
      } catch (error) {
        if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
        if (Number(error?.status) !== 409) throw error;
        candidate = await recoverTranscriptPathCandidate({ bucket, folderPath, filename, expectedCandidate, dependencies,
          callbacks: { beforeIO: callbacks.renew, afterIO: callbacks.renew, maxBytes: 4_000_000 } });
        if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
      }
      await renewOrLose(lease, dependencies);
      const verified = await verifyTranscriptCandidate(candidate, dependencies,
        { beforeIO: callbacks.renew, afterIO: callbacks.renew, forceContent: true });
      if (!verified.siteId || !verified.versionId || !verified.eTag) {
        throw materialError('SharePoint did not provide a stable transcript-file identity.', 'meeting_transcript_file_identity_unavailable', 503);
      }
      descriptors[role] = {
        siteId: verified.siteId, driveId: verified.driveId, itemId: verified.itemId,
        versionId: verified.versionId, eTag: verified.eTag,
        sha256: file.sha256, size: file.bytes.length, filename: verified.filename,
        contentType: file.contentType,
      };
      sharepointCandidates[role] = verified;
      const recorded = await callbacks.recordCandidate(role, candidatePaths[role], descriptors[role]);
      if (recorded !== true) throw materialError('The verified transcript file could not be bound to its publication receipt.', 'meeting_transcript_receipt_candidate_conflict', 409);
    }
    } else {
      if (Object.keys(resumeVerifiedFiles).sort().join(',') !== 'source,txt,vtt') {
        throw materialError('A complete verified transcript bundle is required for recovery.', 'meeting_transcript_verified_bundle_required', 409);
      }
      for (const role of ['txt','vtt','source']) {
        const descriptor = resumeVerifiedFiles[role];
        if (!descriptor || candidatePaths[role] !== `${folderPath}/${descriptor.filename}`
          || !/^[0-9a-f]{64}$/.test(descriptor.sha256 || '') || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1) {
          throw materialError('A verified transcript identity no longer matches its frozen path.', 'meeting_transcript_receipt_candidate_conflict', 409);
        }
        const candidate = { ...descriptor, requestId, generationKey: digest(`meeting-transcript:${requestId}:${operationId}:${role}`) };
        const verified = await verifyTranscriptCandidate(candidate, dependencies,
          { beforeIO: callbacks.renew, afterIO: callbacks.renew, forceContent: true });
        descriptors[role] = { siteId: verified.siteId, driveId: verified.driveId, itemId: verified.itemId,
          versionId: verified.versionId, eTag: verified.eTag, sha256: descriptor.sha256, size: descriptor.size,
          filename: descriptor.filename, contentType: descriptor.contentType };
        if (stableJson(descriptors[role]) !== stableJson(descriptor)) {
          throw materialError('A verified transcript file version changed after its receipt was saved.',
            'meeting_transcript_receipt_candidate_conflict', 409);
        }
        sharepointCandidates[role] = verified;
      }
    }
    await renewOrLose(lease, dependencies);
    const afterFiles = await readCurrent();
    assertExpectedCurrent(afterFiles.current);
    const { buildMeetingTranscriptManifest } = await import('../meeting-tracker-transcription/bundle.js');
    const manifest = buildMeetingTranscriptManifest({ identity, files: descriptors });
    if (!/^[0-9a-f]{64}$/.test(frozenInputSha256 || '')) throw materialError('The frozen transcript identity is invalid.', 'meeting_transcript_bundle_invalid', 422);
    const inputFingerprint = frozenInputSha256;
    const generationKey = digest(`${PRODUCER}:${requestId.toLowerCase()}:${artifactType}:${operationId.toLowerCase()}:${inputFingerprint}`);
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    const recovered = await dependencies.findMeetingTranscriptDocumentByGenerationKey(generationKey);
    if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    if ((recovered?.records || []).length > 1) throw materialError('The transcript retry identity is ambiguous.', 'meeting_transcript_generation_ambiguous', 500);
    let row = recovered?.records?.[0] || null;
    if (row) {
      if (!sameId(row._wmkf_request_value, requestId) || row.wmkf_generationkey !== generationKey
        || row.wmkf_inputfingerprint !== inputFingerprint || row.wmkf_transcriptbundlejson !== JSON.stringify(manifest)) {
        throw materialError('The transcript retry does not match its receipt.', 'meeting_transcript_replay_mismatch', 409);
      }
    } else {
      if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
      row = await createPostPresentationDocument({ payload: {
        wmkf_name: `${request.akoya_requestnum || 'Request'} research presentation transcript`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: operationId,
        wmkf_producer: PRODUCER,
        wmkf_contenttype: descriptors.txt.contentType,
        wmkf_contenthash: descriptors.txt.sha256,
        wmkf_sharepointsiteid: descriptors.txt.siteId,
        wmkf_sharepointdriveid: descriptors.txt.driveId,
        wmkf_sharepointitemid: descriptors.txt.itemId,
        wmkf_sharepointweburl: sharepointCandidates.txt.webUrl || null,
        wmkf_sharepointversionid: descriptors.txt.versionId,
        wmkf_sharepointetag: descriptors.txt.eTag,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: descriptors.txt.filename,
        wmkf_filesize: descriptors.txt.size,
        wmkf_sharepointlastmodified: sharepointCandidates.txt.lastModified || null,
        wmkf_slotversion: lease.fenceVersion,
        wmkf_transcriptbundlejson: JSON.stringify(manifest),
      }, actingUserSystemId, operation: 'meeting-tracker-transcript-publish', requestId, operationId }, dependencies);
      if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
      createdId = row?.wmkf_requestdocumentid || row?.id || null;
      if (!createdId) throw materialError('Dataverse did not confirm the transcript registry row.', 'meeting_transcript_registry_unconfirmed', 502);
    }
    await renewOrLose(lease, dependencies);
    const after = await readCurrent();
    const winner = after.rows.find(candidate => sameId(candidate.wmkf_requestdocumentid, createdId || row.wmkf_requestdocumentid));
    if (!winner) throw materialError('The published transcript is not visible in the registry.', 'meeting_transcript_registry_unconfirmed', 502);
    for (const predecessor of after.rows.filter(candidate => Number(candidate.wmkf_artifacttype) === artifactType
      && !sameId(candidate.wmkf_requestdocumentid, winner.wmkf_requestdocumentid)
      && isEligiblePostPresentationRow(candidate, requestId)
      && Number(candidate.wmkf_slotversion || 0) < lease.fenceVersion)) {
      await renewOrLose(lease, dependencies);
      if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
      await updatePostPresentationDocument({ id: predecessor.wmkf_requestdocumentid,
        patch: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
        actingUserSystemId, operation: 'meeting-tracker-transcript-supersede', requestId, operationId }, dependencies);
      if (await callbacks.renew() !== true) throw materialError('The publication lease could not be renewed.', 'meeting_transcript_publication_lease_lost', 409);
    }
    return { artifactId: winner.wmkf_requestdocumentid, fingerprint: inputFingerprint, bundleEditable: true, manifest };
  } finally {
    await dependencies.releaseSlotLease(lease).catch(async error => {
      await recordReconciliation({ requestId, operationId, requestDocumentId: createdId, predecessorIds: [],
        artifactType, fenceVersion: lease.fenceVersion, stage: 'meeting-transcript-slot-release',
        reason: error?.code || 'slot_release_failed' }, dependencies);
    });
  }
}

export const _internal = {
  docxFailureDiagnostics,
  digest,
  validateRecoveredZoomRow,
  validateRecoveredTranscriptRow,
  validateTranscriptCandidate,
  staffProjection,
  loadBoundContext,
};
