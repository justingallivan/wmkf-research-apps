/** Staff read model and lease-fenced Zoom producer. */
import { createHash, randomUUID } from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { isGuid } from '../../utils/guid.js';
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
import { ServiceHttpError } from '../service-http-error.js';
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
  acquireSlotLease: acquirePresentationSlotLease,
  getSlotLease: getPresentationSlotLease,
  renewSlotLease: renewPresentationSlotLease,
  releaseSlotLease: releasePresentationSlotLease,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  randomUUID,
  now: () => new Date(),
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
      },
    });
  } catch (error) {
    console.warn('[post-presentation-materials] reconciliation event failed:', error?.message || error);
  }
}

function staffProjection(rows, requestId) {
  const projection = projectPostPresentationDescriptors(rows, requestId, { includeStaffUrls: true });
  return {
    status: 'ready',
    materials: projection.materials,
    conflicts: projection.conflicts,
    supported: {
      recording: ['zoom'],
      transcript: [],
      transcriptSummary: [],
    },
  };
}

export async function getPresentationMaterials({ requestId }, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) throw materialError('A valid requestId is required.', 'invalid_request_id', 400);
  assertFeature(requestId, dependencies);
  await loadBoundContext(requestId, dependencies);
  const result = await dependencies.findDocuments(requestId);
  return staffProjection(result?.records || [], requestId);
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
  const acquired = await dependencies.acquireSlotLease({ requestId, artifactType, leaseToken: operationId });
  if (!acquired) {
    const observed = await dependencies.getSlotLease({ requestId, artifactType });
    const expired = observed?.lease_token == null
      || (observed?.lease_expires_at
        && new Date(observed.lease_expires_at).getTime() <= dependencies.now().getTime());
    if (Number(observed?.fence_version) === 2147483647
      && observed?.lease_token !== operationId
      && expired) {
      await dependencies.recordEvent({
        eventType: 'post_presentation_slot_fence_exhausted',
        severity: 'critical',
        summary: 'A post-presentation material slot exhausted its Dataverse-compatible fence.',
        subsystem: 'post-presentation-materials',
        stage: 'slot-acquire',
        transient: false,
        correlationId: operationId,
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
      'Another recording update is in progress. Reload and retry.',
      'post_presentation_slot_busy',
      409,
      { retryable: true },
    );
  }
  const lease = leaseShape(requestId, artifactType, operationId, acquired.fence_version);
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
      row = await dependencies.createDocument({
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
      }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: { operation: 'post-presentation-save-zoom', requestId, operationId },
        actingUserSystemId,
      });
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
        await dependencies.updateDocument(
          predecessorId,
          { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
          { actingUserSystemId },
        );
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

export const _internal = { digest, validateRecoveredZoomRow, staffProjection, loadBoundContext };
