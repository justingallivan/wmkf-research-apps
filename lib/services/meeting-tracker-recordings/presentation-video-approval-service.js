/**
 * Approve and open for the Stage 4 presentation video (slice 4; plan docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md).
 *
 * Approval registers the reviewed cut as a Presentation Video (100000011) Request Document, bound by
 * `wmkf_inputfingerprint` to the transcript revision, boundary and source Recording it was cut from
 * (post-presentation-materials/presentation-video-binding.js). It mirrors `publishSummaryDraft` step for step:
 * claim (per-request advisory lock, abandoned-claim reclaim), revalidate, slot fence, "attempted" flag, find by
 * generation key before any create, create (REQUIRED actor), settleWinner, mark approved; on error release the
 * claim only if no registry write was attempted, otherwise yield it.
 *
 * Stale-approval reconciliation (Codex round 2): a reclaimed row whose frozen identity no longer holds never
 * registers. Under the claim it looks up the row by generation key, supersedes it, and settles the split as
 * terminal `superseded`, which frees both partial unique indexes. Start runs the same step for an abandoned,
 * stale `registering` row.
 */
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { isGuid } from '../../utils/guid.js';
import { isPresentationVideoSplitRequestAllowed } from '../../utils/presentation-video-split-access.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES, loadBoundContext, acquireMaterialSlot, renewOrLose, activeBucket,
  sanitizeForSharePoint, _internal as materialInternals,
} from '../post-presentation-materials/material-service.js';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { bindPresentationTranscript, POST_PRESENTATION_PRODUCER } from '../post-presentation-materials/presentation-transcript-binding.js';
import { presentationVideoFingerprint, presentationVideoGenerationKey } from '../post-presentation-materials/presentation-video-binding.js';
import { settleWinner, recordReconciliation } from '../post-presentation-materials/presentation-transcript-service.js';
import * as splitStore from './presentation-video-split-store.js';

const { PRESENTATION_VIDEO, RECORDING } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const LABEL = 'presentation video';
const CODE_PREFIX = 'presentation_video';
const OPERATION = 'meeting-tracker-presentation-video';
const VIDEO_FOLDER = 'Post Site Visit Materials';

export const PRESENTATION_VIDEO_APPROVAL_DEPENDENCIES = Object.freeze({
  ...POST_PRESENTATION_MATERIALS_DEPENDENCIES,
  // The one Presentation Video create seam (registered as REQUIRED in scripts/check-request-document-writers.js).
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  resolveMediaDownloadUrl: (...args) => GraphService.resolveMediaDownloadUrl(...args),
  store: splitStore,
});

function fail(code, status, message = code, extras = {}) {
  throw new ServiceHttpError(message, { httpStatus: status, code, body: { error: message, code, ...extras } });
}
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** The current confirmed boundary and RECORDING winner, read the way the worker and start read them. */
async function readCurrentSource(requestId, dependencies) {
  const [withBundle, plain] = await Promise.all([
    dependencies.findDocumentsWithMeetingTranscriptBundle(requestId), dependencies.findDocuments(requestId),
  ]);
  const boundary = bindPresentationTranscript(projectPostPresentationMaterials(withBundle?.records || [], requestId).winners, requestId).boundary;
  const recording = projectPostPresentationMaterials(plain?.records || [], requestId).winners
    .find(row => Number(row.wmkf_artifacttype) === RECORDING) || null;
  return { boundary, recording };
}

/** Does the split's frozen transcript revision, boundary and source Recording still match the current ones? */
export function frozenIdentityIsCurrent(row, { boundary, recording }) {
  return Boolean(boundary && recording
    && sameId(boundary.revisionId, row.transcript_revision_id)
    && Number(boundary.presentationEnd?.endMs) === Number(row.presentation_end_ms)
    && sameId(recording.wmkf_requestdocumentid, row.source_document_id)
    && String(recording.wmkf_sharepointetag || '') === String(row.source_etag || ''));
}

/**
 * Stale-approval reconciliation, under a held claim. Finds the split's generation-key row, supersedes it, and
 * settles the split as `superseded`. Marks the registry phase attempted first, so any failure here yields the
 * claim (the row stays `registering`) and the next start or approve call retries.
 */
export async function reconcileStaleApproval({ row, token, requestId, actingUserSystemId }, dependencies) {
  const { store } = dependencies;
  if (!await store.markPresentationVideoApprovalAttempted({ token })) {
    fail('presentation_video_approval_in_progress', 409, 'This presentation video is being approved elsewhere. Reload.');
  }
  const existing = await dependencies.findDocumentByGenerationKey(presentationVideoGenerationKey(row.id, requestId));
  const records = existing?.records || [];
  if (records.length > 1) fail('presentation_video_generation_ambiguous', 500, 'The presentation video retry identity is ambiguous.');
  const orphan = records[0] || null;
  if (orphan) {
    if (!sameId(orphan._wmkf_request_value, requestId) || Number(orphan.wmkf_artifacttype) !== PRESENTATION_VIDEO
      || orphan.wmkf_producer !== POST_PRESENTATION_PRODUCER) {
      fail('presentation_video_registry_conflict', 409, 'An existing presentation video conflicts with this cut.');
    }
    if (orphan.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
      await dependencies.updateDocument(orphan.wmkf_requestdocumentid, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: { operation: `${OPERATION}-stale-supersede`, requestId, operationId: token },
        actingUserSystemId,
      });
    }
  }
  if (!await store.settleStalePresentationVideoApproval({ token, supersededDocumentId: orphan?.wmkf_requestdocumentid || null })) {
    fail('presentation_video_approval_in_progress', 409, 'This presentation video is being approved elsewhere. Reload.');
  }
}

/** Release the claim when no registry write was attempted, otherwise yield it (like summary publish). */
async function giveUpClaim(store, token) {
  const released = await store.releasePresentationVideoApproval({ token }).catch(() => null);
  if (!released) await store.yieldPresentationVideoApproval({ token }).catch(() => {});
}

/**
 * Start's hook: an awaiting row is `registering` with an abandoned claim. Returns 'reconciled' when it was stale
 * and has been settled (the caller retries start once), 'pending' when its identity is still current (finish
 * approving it), or 'in_progress' when it is not claimable.
 */
export async function reconcileAbandonedForStart({ requestId, actorProfileId, actingUserSystemId, current }, dependencies) {
  const { store } = dependencies;
  const abandoned = await store.findAbandonedRegisteringPresentationVideoSplit({ requestId });
  if (!abandoned) return 'in_progress';
  if (frozenIdentityIsCurrent(abandoned, current)) return 'pending';
  const token = dependencies.randomUUID();
  const row = await store.claimPresentationVideoApproval({ id: abandoned.id, requestId, actorProfileId, token });
  if (!row) return 'in_progress';
  try {
    await reconcileStaleApproval({ row, token, requestId, actingUserSystemId }, dependencies);
  } catch (error) {
    await giveUpClaim(store, token);
    throw error;
  }
  return 'reconciled';
}

/** Returns `{ status, body }`; throws ServiceHttpError for every refusal. */
export async function approvePresentationVideoSplit({ requestId, splitId, actorProfileId, actingUserSystemId },
  dependencies = PRESENTATION_VIDEO_APPROVAL_DEPENDENCIES) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!isGuid(splitId)) fail('invalid_split_id', 400, 'A valid presentation video id is required.');
  if (!Number.isSafeInteger(actorProfileId) || actorProfileId < 1) fail('profile_required', 401);
  if (!isGuid(actingUserSystemId || '')) fail('post_presentation_actor_required', 403);
  if (!isPresentationVideoSplitRequestAllowed(requestId)) {
    fail('presentation_video_split_not_available', 404, 'Presentation video is not available.');
  }
  materialInternals.assertFeature(requestId, dependencies);
  const { store } = dependencies;
  const bound = await loadBoundContext(requestId, dependencies);

  const token = dependencies.randomUUID();
  const claimed = await store.claimPresentationVideoApproval({ id: splitId, requestId, actorProfileId, token });
  if (!claimed) {
    const existing = await store.getPresentationVideoSplitForApproval({ id: splitId, requestId });
    if (!existing) fail('presentation_video_split_not_found', 404, 'That presentation video was not found.');
    if (existing.state === 'registering') fail('presentation_video_approval_in_progress', 409, 'This presentation video is being approved. Try again shortly.');
    fail('presentation_video_split_not_reviewable', 409, 'This presentation video is not waiting for approval.');
  }
  try {
    return await approveClaimed({ row: claimed, token, requestId, actorProfileId, actingUserSystemId, bound }, dependencies);
  } catch (error) {
    await giveUpClaim(store, token);
    throw error;
  }
}

async function approveClaimed({ row, token, requestId, actorProfileId, actingUserSystemId, bound }, dependencies) {
  const { store } = dependencies;
  const { request, cycleCode } = bound;
  const current = await readCurrentSource(requestId, dependencies);
  const item = await dependencies.getFileMetadataById(row.output_drive_id, row.output_item_id,
    { siteId: current.recording?.wmkf_sharepointsiteid || null });
  const outputIntact = Boolean(item && item.id === row.output_item_id && item.eTag === row.output_etag
    && (!row.output_quickxor_hash || item.quickXorHash === row.output_quickxor_hash));
  if (!frozenIdentityIsCurrent(row, current) || !outputIntact) {
    await reconcileStaleApproval({ row, token, requestId, actingUserSystemId }, dependencies);
    fail('presentation_video_approval_stale', 409,
      'The transcript, presentation end or recording changed after this video was cut. Create the video again.');
  }

  const bucket = activeBucket(await dependencies.getSharePointBuckets(requestId, request.akoya_requestnum));
  if (!bucket) fail('post_presentation_folder_unavailable', 503, 'The request has no active SharePoint folder.');
  const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${VIDEO_FOLDER}`;
  const fingerprint = presentationVideoFingerprint({
    requestId, transcriptRevisionId: row.transcript_revision_id, presentationEndMs: Number(row.presentation_end_ms),
    sourceDocumentId: row.source_document_id, sourceEtag: row.source_etag,
  });
  const generationKey = presentationVideoGenerationKey(row.id, requestId);

  const lease = await acquireMaterialSlot({ requestId, artifactType: PRESENTATION_VIDEO, leaseToken: token, label: LABEL }, dependencies);
  let createdId = null;
  try {
    await renewOrLose(lease, dependencies);
    // From here the split can never return to review: a registry write may exist.
    if (!await store.markPresentationVideoApprovalAttempted({ token })) {
      fail('presentation_video_approval_in_progress', 409, 'This presentation video is no longer held by this approval. Reload.');
    }
    const existing = await dependencies.findDocumentByGenerationKey(generationKey);
    if ((existing?.records || []).length > 1) fail('presentation_video_generation_ambiguous', 500, 'The presentation video retry identity is ambiguous.');
    const prior = existing?.records?.[0] || null;
    if (prior) {
      if (!sameId(prior._wmkf_request_value, requestId) || Number(prior.wmkf_artifacttype) !== PRESENTATION_VIDEO
        || prior.wmkf_producer !== POST_PRESENTATION_PRODUCER || prior.wmkf_inputfingerprint !== fingerprint) {
        fail('presentation_video_registry_conflict', 409, 'An existing presentation video conflicts with this cut.');
      }
      createdId = prior.wmkf_requestdocumentid;
      if (Number(prior.wmkf_slotversion || 0) !== lease.fenceVersion) {
        await renewOrLose(lease, dependencies);
        await dependencies.updateDocument(createdId, {
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_slotversion: lease.fenceVersion,
        }, {
          actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
          actorContext: { operation: `${OPERATION}-restore`, requestId, operationId: token },
          actingUserSystemId,
        });
      }
    } else {
      const requestNum = request.akoya_requestnum || 'Request';
      await renewOrLose(lease, dependencies);
      let created;
      try {
        created = await dependencies.createDocument({
          wmkf_name: `${sanitizeForSharePoint(requestNum)} presentation video`,
          'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
          wmkf_artifacttype: PRESENTATION_VIDEO,
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_generationkey: generationKey,
          wmkf_cyclecode: cycleCode,
          wmkf_inputfingerprint: fingerprint,
          wmkf_claimtoken: token,
          wmkf_producer: POST_PRESENTATION_PRODUCER,
          wmkf_contenttype: 'video/mp4',
          wmkf_sharepointsiteid: item.siteId || current.recording?.wmkf_sharepointsiteid || null,
          wmkf_sharepointdriveid: row.output_drive_id,
          wmkf_sharepointitemid: row.output_item_id,
          wmkf_sharepointweburl: item.webUrl,
          wmkf_sharepointversionid: item.versionId || null,
          wmkf_sharepointetag: item.eTag,
          wmkf_sharepointfolderpath: folderPath,
          wmkf_filename: item.name,
          wmkf_filesize: Number(item.size),
          wmkf_sharepointlastmodified: item.lastModified || null,
          wmkf_slotversion: lease.fenceVersion,
        }, {
          actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
          actorContext: { operation: OPERATION, requestId, operationId: token },
          actingUserSystemId,
        });
      } catch (error) {
        await recordReconciliation({ requestId, artifactType: PRESENTATION_VIDEO, operationId: token, requestDocumentId: null,
          fenceVersion: lease.fenceVersion, stage: 'presentation-video-register', reason: error?.code || 'register_failed',
          folderPath, filename: item.name, label: LABEL }, dependencies);
        throw error;
      }
      createdId = created?.wmkf_requestdocumentid || created?.id || null;
      if (!createdId) fail('presentation_video_registry_unconfirmed', 502, 'Dataverse did not confirm the presentation video row.');
    }
    await settleWinner({ requestId, artifactType: PRESENTATION_VIDEO, operationLabel: OPERATION, keepId: createdId, lease,
      operationId: token, actingUserSystemId, label: LABEL, codePrefix: CODE_PREFIX }, dependencies);
    const marked = await store.markPresentationVideoApproved({ token, requestDocumentId: createdId, approvedBy: actorProfileId });
    if (!marked) {
      // Only an abandoned claim can be taken over, so this approval ran past it. The row is registered and bound;
      // the next approve call reclaims, finds it by generation key and settles `approved`.
      await recordReconciliation({ requestId, artifactType: PRESENTATION_VIDEO, operationId: token, requestDocumentId: createdId,
        fenceVersion: lease.fenceVersion, stage: 'presentation-video-approval-mark', reason: 'approval_claim_lost', label: LABEL }, dependencies);
    } else {
      await store.supersedeApprovedPresentationVideos({ requestId, exceptId: row.id }).catch(() => {});
    }
    return { status: 200, body: { split: { id: row.id, state: marked ? 'approved' : 'registering' } } };
  } finally {
    await dependencies.releaseSlotLease(lease).catch(async (error) => {
      await Promise.resolve(dependencies.recordEvent({
        eventType: 'post_presentation_material_reconciliation_required',
        severity: 'warning',
        summary: `A ${LABEL} slot lease could not be released.`,
        subsystem: 'post-presentation-materials',
        stage: 'presentation-video-slot-release',
        transient: false,
        correlationId: token,
        dedupeKey: `post-presentation-reconciliation:${token}:presentation-video-slot-release`,
        entityRefs: { requestId, requestDocumentId: createdId, predecessorIds: [] },
        metadata: { artifactType: PRESENTATION_VIDEO, fenceVersion: lease.fenceVersion, reason: error?.code || 'slot_release_failed' },
      })).catch(() => {});
    });
  }
}

/**
 * Staff review open: a fresh download URL for the split's unregistered output, only while the recorded item id and
 * eTag still match the live item (like resolvePresentationMember). Returns `{ redirectUrl, filename, mimeType }`.
 */
export async function resolvePresentationVideoSplitOpen({ requestId, splitId }, dependencies = PRESENTATION_VIDEO_APPROVAL_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(splitId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!isPresentationVideoSplitRequestAllowed(requestId)) fail('presentation_video_split_not_available', 404, 'Presentation video is not available.');
  const row = await dependencies.store.getPresentationVideoSplitForApproval({ id: splitId, requestId });
  if (!row || !['review', 'registering', 'approved'].includes(row.state) || !row.output_item_id || !row.output_etag) {
    fail('presentation_video_split_not_found', 404, 'That presentation video was not found.');
  }
  const media = await dependencies.resolveMediaDownloadUrl(row.output_drive_id, row.output_item_id);
  if (media.malware || !sameId(media.driveId, row.output_drive_id) || !sameId(media.itemId, row.output_item_id)
    || String(media.eTag || '') !== String(row.output_etag)) {
    fail('presentation_video_output_changed', 409, 'The video file changed after it was cut.');
  }
  let redirect;
  try { redirect = new URL(media.downloadUrl); } catch { fail('presentation_video_output_unavailable', 502, 'The video could not be opened.'); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password) fail('presentation_video_output_unavailable', 502, 'The video could not be opened.');
  return { redirectUrl: redirect.toString(), filename: media.filename || null, mimeType: media.mimeType || 'video/mp4' };
}
