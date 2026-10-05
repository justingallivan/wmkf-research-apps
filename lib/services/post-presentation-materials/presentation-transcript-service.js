/**
 * Presentation Transcript writer (artifact type 100000012).
 *
 * Cuts the current TRANSCRIPT bundle's verified source at its confirmed
 * presentation end and registers the presentation-only TXT as its own
 * Request Document row. The row carries no bundle metadata; its generation key
 * (presentation-transcript-binding.js) binds it to the exact source revision
 * and boundary it was cut from, so a later republish or boundary change hides
 * it until it is regenerated. Plan §4.2.
 */
import crypto from 'node:crypto';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { GraphService } from '../graph-service.js';
import OperationalEventService from '../operational-event-service.js';
import { isGuid } from '../../utils/guid.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { POST_PRESENTATION_TRANSCRIPT_MAX_BYTES } from '../../utils/post-presentation-transcript-file.js';
import {
  isPostPresentationMaterialsRequestAllowed, isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';
import { isMeetingTranscriptBundleSchemaReady } from '../../utils/meeting-transcript-bundle-readiness.js';
import { requireMeetingTranscriptionEnabled } from '../meeting-tracker-transcription/policy.js';
import { loadMeetingTranscriptionBinding } from '../meeting-tracker-transcription/binding.js';
import { getMeetingTranscriptionSupervisedTestPolicy } from '../meeting-tracker-transcription/test-deployment-policy.js';
import { validateMeetingTranscriptManifest, parseVerifiedMeetingTranscriptSource } from '../meeting-tracker-transcription/bundle.js';
import { buildPresentationTranscriptText } from '../meeting-tracker-transcription/presentation-boundary.js';
import { isEligiblePostPresentationRow, projectPostPresentationMaterials } from './material-model.js';
import {
  bindPresentationTranscript, presentationTranscriptGenerationKey, POST_PRESENTATION_PRODUCER,
} from './presentation-transcript-binding.js';
import {
  acquireMaterialSlot, renewOrLose, loadBoundContext, activeBucket, sanitizeForSharePoint, materialError,
} from './material-service.js';
import {
  acquirePresentationSlotLease, getPresentationSlotLease, renewPresentationSlotLease, releasePresentationSlotLease,
} from './slot-lease-store.js';

const { TRANSCRIPT, PRESENTATION_TRANSCRIPT } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const SOURCE_MAX_BYTES = 4_000_000;
const CONTENT_TYPE = 'text/plain; charset=utf-8';
const FOLDER_NAME = 'Site Visit - Presentation Transcript';

export const PRESENTATION_TRANSCRIPT_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  requestAllowed: isPostPresentationMaterialsRequestAllowed,
  loadBinding: (requestId) => loadMeetingTranscriptionBinding(requestId),
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'],
  }),
  findActiveSiteVisit: (requestId) => siteVisitAdapter.findActiveByRequest(requestId),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true }),
  findByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key),
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  updateDocument: (id, patch, options) => requestDocumentAdapter.update(id, patch, options),
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  acquireSlotLease: acquirePresentationSlotLease,
  getSlotLease: getPresentationSlotLease,
  renewSlotLease: renewPresentationSlotLease,
  releaseSlotLease: releasePresentationSlotLease,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date(),
});

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprintOf = (row) => row?.wmkf_inputfingerprint || row?.wmkf_contenthash || null;

function primaryFile(row) {
  return {
    siteId: row?.wmkf_sharepointsiteid, driveId: row?.wmkf_sharepointdriveid,
    itemId: row?.wmkf_sharepointitemid, versionId: row?.wmkf_sharepointversionid,
    eTag: row?.wmkf_sharepointetag, filename: row?.wmkf_filename,
    sha256: row?.wmkf_contenthash, contentType: row?.wmkf_contenttype, size: Number(row?.wmkf_filesize),
  };
}

async function bindCurrent(requestId, dependencies) {
  const result = await dependencies.findDocuments(requestId);
  const rows = (result?.records || []).filter((row) => [TRANSCRIPT, PRESENTATION_TRANSCRIPT]
    .includes(Number(row?.wmkf_artifacttype)));
  return bindPresentationTranscript(projectPostPresentationMaterials(rows, requestId).winners, requestId);
}

function assertExpected(bound, body) {
  const transcript = bound.transcript;
  if (!transcript || !sameId(transcript.wmkf_requestdocumentid, body.expectedCurrentArtifactId)
    || fingerprintOf(transcript) !== body.expectedCurrentFingerprint) {
    throw materialError('The current transcript changed. Reload before generating the presentation transcript.',
      'meeting_transcript_current_changed', 409);
  }
  if (!bound.boundary) {
    throw materialError('Confirm where the presentation ends before generating the presentation transcript.',
      'presentation_end_not_confirmed', 409);
  }
}

function result(bound, row) {
  const artifactId = row.wmkf_requestdocumentid;
  const presentationTranscript = { artifactId, state: 'bound' };
  return {
    presentationTranscript,
    currentArtifact: {
      id: bound.transcript.wmkf_requestdocumentid, fingerprint: fingerprintOf(bound.transcript), bundleEditable: true,
      presentationEnd: bound.boundary.presentationEnd, presentationTranscript,
    },
  };
}

async function loadVerifiedSource(bound, siteVisitActivityId, requestId, dependencies) {
  let manifest;
  try {
    manifest = validateMeetingTranscriptManifest(JSON.parse(bound.transcript.wmkf_transcriptbundlejson), {
      requestId, siteVisitActivityId, primaryFile: primaryFile(bound.transcript),
    });
  } catch {
    throw materialError('This transcript has no verified editable bundle.', 'meeting_transcript_bundle_unavailable', 409);
  }
  const descriptor = manifest.files.source;
  const downloaded = await dependencies.downloadFile(descriptor.driveId, descriptor.itemId, { maxBytes: SOURCE_MAX_BYTES });
  const latest = await dependencies.getFileMetadataById(descriptor.driveId, descriptor.itemId, { siteId: descriptor.siteId });
  if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length > SOURCE_MAX_BYTES
    || downloaded.buffer.length !== descriptor.size || sha256(downloaded.buffer) !== descriptor.sha256
    || !latest || latest.eTag !== descriptor.eTag || latest.versionId !== descriptor.versionId) {
    throw materialError('The transcript source could not be verified.', 'meeting_transcript_source_integrity_failed', 503);
  }
  const source = parseVerifiedMeetingTranscriptSource(downloaded.buffer, descriptor, {
    requestId, siteVisitActivityId, revisionId: manifest.revisionId,
  });
  if (source.presentationEnd?.endMs !== bound.boundary.presentationEnd.endMs) {
    throw materialError('The transcript source does not carry the confirmed presentation end.',
      'meeting_transcript_source_integrity_failed', 503);
  }
  return source;
}

async function uploadAndVerify({ bucket, folderPath, filename, bytes, expectedSha }, dependencies, lease) {
  await dependencies.ensureFolderPath(bucket.library, folderPath);
  await renewOrLose(lease, dependencies);
  const uploaded = await dependencies.uploadFile(bucket.library, folderPath, filename, bytes, CONTENT_TYPE,
    { conflictBehavior: 'replace' });
  if (!uploaded?.id || !uploaded?.driveId || Number(uploaded.size) !== bytes.length) {
    throw materialError('SharePoint did not confirm the presentation transcript file.', 'presentation_transcript_upload_unconfirmed', 502);
  }
  const siteId = uploaded.siteId || null;
  const metadata = await dependencies.getFileMetadataById(uploaded.driveId, uploaded.id, { siteId });
  if (!metadata || metadata.name !== (uploaded.name || filename) || Number(metadata.size) !== bytes.length) {
    throw materialError('The presentation transcript upload no longer matches what was written.',
      'presentation_transcript_file_mismatch', 409);
  }
  const downloaded = await dependencies.downloadFile(uploaded.driveId, uploaded.id, { maxBytes: POST_PRESENTATION_TRANSCRIPT_MAX_BYTES });
  if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length !== bytes.length || sha256(downloaded.buffer) !== expectedSha) {
    throw materialError('The presentation transcript upload no longer matches what was written.',
      'presentation_transcript_file_mismatch', 409);
  }
  const stable = await dependencies.getFileMetadataById(uploaded.driveId, uploaded.id, { siteId });
  if (!stable || stable.eTag !== metadata.eTag || stable.versionId !== metadata.versionId) {
    throw materialError('The presentation transcript changed during verification.', 'presentation_transcript_file_mismatch', 409);
  }
  const verified = { siteId: stable.siteId || siteId, driveId: uploaded.driveId, itemId: uploaded.id,
    versionId: stable.versionId || null, eTag: stable.eTag || null, filename: stable.name || filename,
    webUrl: stable.webUrl || uploaded.webUrl || null, lastModified: stable.lastModified || uploaded.lastModified || null };
  if (!verified.siteId || !verified.versionId || !verified.eTag) {
    throw materialError('SharePoint did not provide a stable file identity.', 'presentation_transcript_file_identity_unavailable', 503);
  }
  return verified;
}

function endsLabel(endMs) {
  const total = Math.max(0, Math.floor(Number(endMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}h${minutes}m${seconds}s`;
}

async function recordReconciliation(spec, dependencies) {
  try {
    await dependencies.recordEvent({
      eventType: 'post_presentation_material_reconciliation_required',
      severity: 'warning',
      summary: 'A presentation transcript write needs registry reconciliation.',
      subsystem: 'post-presentation-materials',
      stage: spec.stage,
      transient: false,
      correlationId: spec.operationId,
      dedupeKey: `post-presentation-reconciliation:${spec.operationId}:${spec.stage}`,
      entityRefs: { requestId: spec.requestId, requestDocumentId: spec.requestDocumentId, predecessorIds: spec.predecessorIds || [] },
      metadata: { artifactType: PRESENTATION_TRANSCRIPT, fenceVersion: spec.fenceVersion, reason: spec.reason,
        ...(spec.folderPath ? { folderPath: spec.folderPath, filename: spec.filename } : {}) },
    });
  } catch { /* the event sink is best-effort; the caller's own error still surfaces */ }
}

/**
 * Re-read the registry under the lease, require `keepId` to be visible, and supersede every other
 * eligible derivative with a lower fence. A supersede failure is recorded, not thrown: the kept row
 * already outranks the others for the projection and the outside binding ignores them by key.
 */
async function settleWinner({ requestId, keepId, lease, operationId, actingUserSystemId }, dependencies) {
  await renewOrLose(lease, dependencies);
  const after = await dependencies.findDocuments(requestId);
  const rows = after?.records || [];
  const winner = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, keepId));
  if (!winner) throw materialError('The presentation transcript is not visible in the registry.', 'presentation_transcript_registry_unconfirmed', 502);
  const predecessors = rows.filter((candidate) => Number(candidate.wmkf_artifacttype) === PRESENTATION_TRANSCRIPT
    && !sameId(candidate.wmkf_requestdocumentid, keepId)
    && isEligiblePostPresentationRow(candidate, requestId)
    && Number(candidate.wmkf_slotversion || 0) < lease.fenceVersion);
  const failed = [];
  for (const predecessor of predecessors) {
    try {
      await renewOrLose(lease, dependencies);
      await dependencies.updateDocument(predecessor.wmkf_requestdocumentid,
        { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, {
          actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
          actorContext: { operation: 'meeting-tracker-presentation-transcript-supersede', requestId, operationId },
          actingUserSystemId,
        });
    } catch (error) {
      failed.push(predecessor.wmkf_requestdocumentid);
      if (error?.code === 'post_presentation_slot_lease_lost' || error?.code === 'meeting_transcript_publication_lease_lost') throw error;
    }
  }
  if (failed.length) {
    await recordReconciliation({ requestId, operationId, requestDocumentId: keepId, predecessorIds: failed,
      fenceVersion: lease.fenceVersion, stage: 'presentation-transcript-supersede', reason: 'supersede_failed' }, dependencies);
  }
  return winner;
}

/** Write (or return the existing) Presentation Transcript for the current TRANSCRIPT winner. */
export async function generatePresentationTranscript({
  requestId, ownerProfileId, actingUserSystemId, body,
}, dependencies = PRESENTATION_TRANSCRIPT_DEPENDENCIES) {
  requireMeetingTranscriptionEnabled(requestId);
  if (!Number.isSafeInteger(ownerProfileId) || ownerProfileId < 1) throw materialError('A staff profile is required.', 'profile_required', 401);
  if (!isGuid(actingUserSystemId || '')) throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  if (!isMeetingTranscriptBundleSchemaReady()) throw materialError('Transcript bundle metadata is not enabled.', 'meeting_transcript_bundle_schema_not_ready', 503);
  if (!dependencies.schemaReady()) throw materialError('Presentation materials are not enabled for this environment.', 'post_presentation_schema_not_ready', 503);
  if (!dependencies.requestAllowed(requestId)) throw materialError('Presentation materials are not available.', 'post_presentation_not_available', 404);
  if (getMeetingTranscriptionSupervisedTestPolicy().requested) {
    throw materialError('A supervised test cannot write a presentation transcript.', 'meeting_transcription_supervised_test_unsupported', 409);
  }
  const binding = await dependencies.loadBinding(requestId);
  const boundRequestId = binding.requestId;

  const first = await bindCurrent(boundRequestId, dependencies);
  assertExpected(first, body);
  if (first.reason === 'bound') return result(first, first.presentationTranscript);

  const { request, siteVisit, cycleCode } = await loadBoundContext(boundRequestId, dependencies);
  if (!sameId(siteVisit.activityid, binding.siteVisitActivityId)) {
    throw materialError('The active Site Visit changed. Reload before generating.', 'meeting_transcript_site_visit_changed', 409);
  }
  const bucket = activeBucket(await dependencies.getSharePointBuckets(boundRequestId, request.akoya_requestnum));
  if (!bucket) throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);

  const operationId = dependencies.randomUUID();
  const lease = await acquireMaterialSlot({ requestId: boundRequestId, artifactType: PRESENTATION_TRANSCRIPT,
    leaseToken: operationId, label: 'presentation transcript' }, dependencies);
  let createdId = null;
  try {
    // Under the lease, trust only a fresh read: the winner may have changed while waiting.
    const bound = await bindCurrent(boundRequestId, dependencies);
    assertExpected(bound, body);
    if (bound.reason === 'bound') return result(bound, bound.presentationTranscript);
    const { revisionId, presentationEnd } = bound.boundary;
    const generationKey = presentationTranscriptGenerationKey({
      requestId: boundRequestId, sourceRevisionId: revisionId, presentationEndMs: presentationEnd.endMs });
    // A prior attempt that created its row but did not return is found here, before any upload,
    // so a retry never re-writes a file the registry row already identifies.
    const existing = await dependencies.findByGenerationKey(generationKey);
    if ((existing?.records || []).length > 1) {
      throw materialError('The presentation transcript retry identity is ambiguous.', 'presentation_transcript_generation_ambiguous', 500);
    }
    const prior = existing?.records?.[0] || null;
    if (prior) {
      if (!sameId(prior._wmkf_request_value, boundRequestId) || Number(prior.wmkf_artifacttype) !== PRESENTATION_TRANSCRIPT
        || prior.wmkf_producer !== POST_PRESENTATION_PRODUCER || prior.wmkf_generationkey !== generationKey) {
        throw materialError('An existing presentation transcript conflicts with this boundary.',
          'presentation_transcript_registry_conflict', 409);
      }
      // The row for this exact cut already exists but is not the projected winner: either a newer
      // (now stale) derivative outranks it, or it was superseded when the boundary moved away and
      // back. The generation key is a Dataverse alternate key, so a second row cannot be created;
      // instead the row is restored under this fence and the others are superseded.
      await renewOrLose(lease, dependencies);
      await dependencies.updateDocument(prior.wmkf_requestdocumentid, {
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_slotversion: lease.fenceVersion,
      }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: { operation: 'meeting-tracker-presentation-transcript-restore', requestId: boundRequestId, operationId },
        actingUserSystemId,
      });
      createdId = prior.wmkf_requestdocumentid;
      return result(bound, await settleWinner({ requestId: boundRequestId, keepId: createdId, lease, operationId, actingUserSystemId }, dependencies));
    }

    const source = await loadVerifiedSource(bound, binding.siteVisitActivityId, boundRequestId, dependencies);
    const bytes = Buffer.from(buildPresentationTranscriptText(source.content, source.speakerNames, presentationEnd.endMs), 'utf8');
    if (bytes.length < 1 || bytes.length > POST_PRESENTATION_TRANSCRIPT_MAX_BYTES) {
      throw materialError('The presentation transcript is empty or too large.', 'presentation_transcript_size_invalid', 422);
    }
    const fingerprint = sha256(bytes);
    const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${FOLDER_NAME}`;
    // The filename reaches the Board page, so it carries the boundary time, never a revision id.
    const filename = `${sanitizeForSharePoint(request.akoya_requestnum || 'Request')}-Presentation-Transcript-ends-${endsLabel(presentationEnd.endMs)}.txt`;
    await renewOrLose(lease, dependencies);
    const file = await uploadAndVerify({ bucket, folderPath, filename, bytes, expectedSha: fingerprint }, dependencies, lease);

    await renewOrLose(lease, dependencies);
    let row;
    try {
      // The TRANSCRIPT slot is not held here, so confirm the cut source is still current before registering.
      assertExpected(await bindCurrent(boundRequestId, dependencies), body);
      row = await dependencies.createDocument({
      wmkf_name: `${request.akoya_requestnum || 'Request'} research presentation transcript (presentation only)`,
      'wmkf_Request@odata.bind': `/akoya_requests(${boundRequestId})`,
      wmkf_artifacttype: PRESENTATION_TRANSCRIPT,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_generationkey: generationKey,
      wmkf_cyclecode: cycleCode,
      wmkf_inputfingerprint: fingerprint,
      wmkf_claimtoken: operationId,
      wmkf_producer: POST_PRESENTATION_PRODUCER,
      wmkf_contenttype: CONTENT_TYPE,
      wmkf_contenthash: fingerprint,
      wmkf_sharepointsiteid: file.siteId,
      wmkf_sharepointdriveid: file.driveId,
      wmkf_sharepointitemid: file.itemId,
      wmkf_sharepointweburl: file.webUrl,
      wmkf_sharepointversionid: file.versionId,
      wmkf_sharepointetag: file.eTag,
      wmkf_sharepointfolderpath: folderPath,
      wmkf_filename: file.filename,
      wmkf_filesize: bytes.length,
      wmkf_sharepointlastmodified: file.lastModified,
      wmkf_slotversion: lease.fenceVersion,
      }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: { operation: 'meeting-tracker-presentation-transcript', requestId: boundRequestId, operationId },
        actingUserSystemId,
      });
    } catch (error) {
      // The TXT is already in SharePoint at its deterministic path with no row naming it; a retry
      // overwrites it and nothing outside can reach it. Record the orphan so an operator can see it.
      await recordReconciliation({ requestId: boundRequestId, operationId, requestDocumentId: null, fenceVersion: lease.fenceVersion,
        stage: 'presentation-transcript-register', reason: error?.code || 'register_failed', folderPath, filename }, dependencies);
      throw error;
    }
    createdId = row?.wmkf_requestdocumentid || row?.id || null;
    if (!createdId) throw materialError('Dataverse did not confirm the presentation transcript row.', 'presentation_transcript_registry_unconfirmed', 502);
    return result(bound, await settleWinner({ requestId: boundRequestId, keepId: createdId, lease, operationId, actingUserSystemId }, dependencies));
  } finally {
    await dependencies.releaseSlotLease(lease).catch(async (error) => {
      await Promise.resolve(dependencies.recordEvent({
        eventType: 'post_presentation_material_reconciliation_required',
        severity: 'warning',
        summary: 'A presentation transcript slot lease could not be released.',
        subsystem: 'post-presentation-materials',
        stage: 'presentation-transcript-slot-release',
        transient: false,
        correlationId: operationId,
        dedupeKey: `post-presentation-reconciliation:${operationId}:presentation-transcript-slot-release`,
        entityRefs: { requestId: boundRequestId, requestDocumentId: createdId, predecessorIds: [] },
        metadata: { artifactType: PRESENTATION_TRANSCRIPT, fenceVersion: lease.fenceVersion, reason: error?.code || 'slot_release_failed' },
      })).catch(() => {});
    });
  }
}
