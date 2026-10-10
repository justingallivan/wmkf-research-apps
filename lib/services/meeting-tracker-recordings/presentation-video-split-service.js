/**
 * Start / list for the Stage 4 presentation-video split (slice 2; plan docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md).
 *
 * Start freezes the current verified source (transcript revision, confirmed presentation end, current RECORDING
 * winner and its copied Zoom row) into a `queued` split row. It cuts nothing and makes no Graph or Sandbox call;
 * the slice 3 worker does. The actor and ids come from the session in the route, never the body.
 */
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { isPresentationVideoSplitRequestAllowed } from '../../utils/presentation-video-split-access.js';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES, loadBoundContext, _internal as materialInternals,
} from '../post-presentation-materials/material-service.js';
import { materialBacking, projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { resolveCurrentMeetingTranscriptSource } from '../meeting-tracker-transcription/service.js';
import * as store from './presentation-video-split-store.js';

const LIST_LIMIT = 10;

function fail(code, status, message = code, extras = {}) {
  throw new ServiceHttpError(message, { httpStatus: status, code, body: { error: message, code, ...extras } });
}
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const instantMs = value => (value == null ? NaN : new Date(value).getTime());

/** The staff-facing split snapshot. Built field by field: store rows carry internals. */
export function presentationVideoSplitDto(row) {
  return {
    id: row.id,
    state: row.state,
    failureCode: row.failure_code || null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    completedAt: row.completed_at ?? null,
    approvedAt: row.approved_at ?? null,
  };
}

/** `{ available, splits }`. Postgres only. Nothing is read when the split is off for this request. */
export async function getPresentationVideoSplits({ requestId }) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!isPresentationVideoSplitRequestAllowed(requestId)) return { available: false, splits: [] };
  const rows = await store.listPresentationVideoSplitSnapshotsForRequest({ requestId, limit: LIST_LIMIT });
  return { available: true, splits: rows.map(presentationVideoSplitDto) };
}

/** Returns `{ status: 202, body }`; throws ServiceHttpError for every refusal. */
export async function startPresentationVideoSplit({ requestId, actorProfileId, actingUserSystemId },
  dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!Number.isSafeInteger(actorProfileId) || actorProfileId < 1) fail('profile_required', 401);
  if (!isGuid(actingUserSystemId || '')) fail('post_presentation_actor_required', 403);

  // Access first: nothing remote is read for a request the split is off for.
  if (!isPresentationVideoSplitRequestAllowed(requestId)) {
    fail('presentation_video_split_not_available', 404, 'Presentation video is not available.');
  }
  materialInternals.assertFeature(requestId, dependencies);
  const { siteVisit } = await loadBoundContext(requestId, dependencies);

  // Resolver errors (including 409 meeting_transcript_current_changed) propagate.
  const resolved = await resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId });
  if (resolved?.status !== 'verified_zoom') fail('presentation_video_source_not_zoom', 422, 'The current transcript is not from a verified Zoom recording.');
  const provenance = resolved.provenance;
  const zoom = provenance?.zoom;
  if (zoom?.audioOnlyFileCount !== 1) fail('presentation_video_audio_ambiguous', 422, 'The Zoom meeting has more than one audio recording.');
  const end = resolved.presentationEnd;
  if (!end || !Number.isSafeInteger(end.endMs) || end.endMs < 0) {
    fail('presentation_video_boundary_required', 422, 'Confirm the end of the presentation in the transcript first.');
  }

  const result = await dependencies.findDocuments(requestId);
  const winner = projectPostPresentationMaterials(result?.records || [], requestId).winners
    .find(row => Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING) || null;
  if (!winner || materialBacking(winner).kind !== 'file') {
    fail('presentation_video_recording_missing', 422, 'The current recording is not a copied video file.');
  }
  const size = Number(winner.wmkf_filesize);
  if (!winner.wmkf_sharepointetag || !Number.isSafeInteger(size) || size < 1) {
    fail('presentation_video_recording_missing', 422, 'The current recording is not a copied video file.');
  }

  const copy = await store.findCopiedZoomVideoCopyForDocument({ requestId, requestDocumentId: winner.wmkf_requestdocumentid });
  if (!copy) fail('presentation_video_source_not_copied', 422, 'The current recording was not copied from Zoom.');
  if (copy.zoom_meeting_uuid !== zoom.meetingUuid) fail('presentation_video_source_mismatch', 422, 'The video does not match the transcript source.');
  if (copy.recording_start == null || copy.recording_end == null) {
    fail('presentation_video_recopy_required', 422, 'Copy the video from Zoom again before cutting it.');
  }
  const start = instantMs(copy.recording_start);
  const stop = instantMs(copy.recording_end);
  if (!Number.isFinite(start) || !Number.isFinite(stop)
    || start !== instantMs(zoom.audioFile?.recordingStart) || stop !== instantMs(zoom.audioFile?.recordingEnd)
    || !sameId(winner.wmkf_sharepointdriveid, copy.sharepoint_drive_id) || !sameId(winner.wmkf_sharepointitemid, copy.sharepoint_item_id)) {
    fail('presentation_video_source_mismatch', 422, 'The video does not match the transcript source.');
  }

  const source = {
    documentId: winner.wmkf_requestdocumentid,
    driveId: winner.wmkf_sharepointdriveid,
    itemId: winner.wmkf_sharepointitemid,
    versionId: winner.wmkf_sharepointversionid || null,
    eTag: winner.wmkf_sharepointetag,
    size,
    quickXorHash: copy.sharepoint_quickxor_hash || null,
    copyId: copy.id,
  };
  const lineage = {
    version: 1,
    provenance,
    transcriptRevisionId: resolved.revisionId,
    presentationEndMs: end.endMs,
    boundaryConfirmedBy: end.confirmedBy,
    boundaryConfirmedAt: end.confirmedAt,
    source,
  };
  const outcome = await store.startPresentationVideoSplit({
    requestId, siteVisitActivityId: siteVisit.activityid, actorProfileId, sourceCopyId: copy.id,
    transcriptRevisionId: resolved.revisionId, presentationEndMs: end.endMs,
    sourceDocumentId: source.documentId, sourceDriveId: source.driveId, sourceItemId: source.itemId,
    sourceVersionId: source.versionId, sourceEtag: source.eTag, sourceSize: source.size,
    sourceQuickXorHash: source.quickXorHash, lineage,
  });
  switch (outcome?.status) {
    case 'started': return { status: 202, body: { split: { id: outcome.split.id, state: 'queued' } } };
    case 'active': return fail('presentation_video_split_active', 409, 'A presentation video is already being cut for this request.');
    case 'approval_in_progress': return fail('presentation_video_approval_in_progress', 409, 'A presentation video is being approved for this request.');
    default: return fail('presentation_video_start_unexpected', 500);
  }
}
