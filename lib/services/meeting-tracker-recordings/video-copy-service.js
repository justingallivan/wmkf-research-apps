/**
 * Start / list / cancel for the Zoom meeting video copy into SharePoint (Stage 3b, slice S4). Plan:
 * docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md ("Routes and security", Build rulings 6, 7, 9, 10, 17).
 *
 * Start never trusts client file metadata: it re-lists the meeting through the approved hosts' listing and picks
 * the file itself. It moves no bytes and makes no Graph session; the tick worker does. GET reads Postgres only.
 * Download URLs, Zoom file ids, tokens, host emails and lease tokens never leave this module.
 */
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { isZoomVideoCopyRequestAllowed } from '../../utils/zoom-video-copy-access.js';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES, activeBucket, loadBoundContext, materialError, _internal as materialInternals,
} from '../post-presentation-materials/material-service.js';
import { materialBacking, projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { getMeetingRecordings } from './zoom-client.js';
import {
  DEFAULT_WINDOW_DAYS, MAX_ZOOM_VIDEO_BYTES, listApprovedOccurrences, pickVideoFile, readZoomImportConfig, zoomVideoFilename,
} from './import-service.js';
import * as store from './video-copy-store.js';
import { reconcileFailedCopiesForStart } from './video-copy-worker.js';

const LIST_LIMIT = 20;

function fail(code, status, message = code, extras = {}) {
  throw new ServiceHttpError(message, { httpStatus: status, code, body: { error: message, code, ...extras } });
}
// isGuid trims; ids that reach a query must be the bare GUID.
const strictGuid = value => typeof value === 'string' && value === value.trim() && isGuid(value);
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** The staff-facing copy snapshot. Built field by field: store rows can carry lease tokens and other internals. */
export function zoomVideoCopyDto(row) {
  return {
    id: row.id,
    meetingUuid: row.zoom_meeting_uuid,
    state: row.state,
    bytesConfirmed: Number(row.bytes_confirmed) || 0,
    declaredSize: Number(row.declared_size) || 0,
    failureCode: row.failure_code || null,
    cancelRequested: row.cancel_requested_at != null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

/** `{ available, copies }`. Postgres only, no Zoom call. Nothing is read when the copy is off for this request. */
export async function getZoomVideoCopies({ requestId }, dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!isZoomVideoCopyRequestAllowed(requestId) || !dependencies.schemaReady() || !dependencies.requestAllowed(requestId)) {
    return { available: false, copies: [] };
  }
  const rows = await store.listZoomVideoCopySnapshotsForRequest({ requestId, limit: LIST_LIMIT });
  return { available: readZoomImportConfig().available, copies: rows.map(zoomVideoCopyDto) };
}

function validReplaces(replaces) {
  if (replaces === null) return true;
  return replaces && typeof replaces === 'object' && !Array.isArray(replaces)
    && Object.keys(replaces).length === 2 && strictGuid(replaces.artifactId)
    && Number.isSafeInteger(replaces.slotVersion) && replaces.slotVersion > 0;
}

/**
 * Decision 8. Returns the confirmed winner `{ documentId, slotVersion }` to store, or null when the slot has no
 * SharePoint winner. Throws a 409 when staff must confirm, or when their confirmation no longer matches.
 */
async function checkReplacement(requestId, replaces, dependencies) {
  const result = await dependencies.findDocuments(requestId);
  const winner = projectPostPresentationMaterials(result?.records || [], requestId).winners
    .find(row => Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING) || null;
  if (!winner || materialBacking(winner).kind !== 'file') {
    // No winner, or a Zoom link: nothing to replace, so any claimed replacement is stale.
    if (replaces !== null) fail('zoom_video_replace_stale', 409, 'The current recording changed. Reload and try again.');
    return null;
  }
  const slotVersion = Number(winner.wmkf_slotversion);
  if (!Number.isInteger(slotVersion) || slotVersion < 1) {
    fail('zoom_video_winner_unversioned', 409, 'The current recording cannot be replaced from here. Upload the video manually.');
  }
  const documentId = winner.wmkf_requestdocumentid;
  if (replaces === null) {
    const size = Number(winner.wmkf_filesize);
    fail('zoom_video_replace_confirmation_required', 409, 'Copying this video will replace the current recording. Confirm to continue.',
      { winner: { artifactId: documentId, slotVersion, filename: winner.wmkf_filename || winner.wmkf_name || null,
        size: Number.isFinite(size) && size > 0 ? size : null } });
  }
  if (!sameId(replaces.artifactId, documentId) || replaces.slotVersion !== slotVersion) {
    fail('zoom_video_replace_stale', 409, 'The current recording changed. Reload and try again.');
  }
  return { documentId, slotVersion };
}

/**
 * Start one copy. Returns `{ status, body }` (202 queued; 200 copied-file replay); throws ServiceHttpError otherwise.
 * `actingUserSystemId` is the session's Dataverse system user and `actorProfileId` the staff profile: both come
 * from the session in the route, never the body.
 */
export async function startZoomVideoCopy({ requestId, actorProfileId, actingUserSystemId, meetingUuid, replaces },
  dependencies = POST_PRESENTATION_MATERIALS_DEPENDENCIES) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (typeof meetingUuid !== 'string' || meetingUuid.length < 1 || meetingUuid.length > 200 || /[\u0000-\u001f\u007f]/.test(meetingUuid)) {
    fail('invalid_meeting_uuid', 400, 'A valid meeting is required.');
  }
  if (!validReplaces(replaces)) fail('invalid_replaces', 400, 'The replacement confirmation is not valid.');
  if (!Number.isSafeInteger(actorProfileId) || actorProfileId < 1) fail('profile_required', 401);
  if (!isGuid(actingUserSystemId || '')) fail('post_presentation_actor_required', 403);

  // Access: the copy kill switch, the post-presentation feature and Zoom config. Not the transcription flag.
  if (!isZoomVideoCopyRequestAllowed(requestId)) fail('zoom_video_copy_not_available', 404, 'Video copy is not available.');
  materialInternals.assertFeature(requestId, dependencies);
  const config = readZoomImportConfig();
  if (!config.available) fail('zoom_import_unavailable', 503, 'Zoom import is not available.');
  const { request, siteVisit } = await loadBoundContext(requestId, dependencies);

  // The meeting must come from an approved host's own listing, and Zoom's detail must agree on the host.
  const listed = (await listApprovedOccurrences(config.hosts, DEFAULT_WINDOW_DAYS)).find(item => item.meeting.uuid === meetingUuid);
  if (!listed) fail('zoom_meeting_not_found', 404, 'That recording was not found.');
  const hostId = listed.meeting.host_id;
  const startTime = new Date(listed.meeting.start_time);
  if (typeof hostId !== 'string' || hostId.length < 1 || hostId.length > 100 || Number.isNaN(startTime.getTime())
    || !config.hosts.includes(listed.hostEmail)) {
    fail('zoom_listing_invalid', 502, 'The Zoom listing could not be used.');
  }
  const detail = await getMeetingRecordings(meetingUuid);
  if (detail?.host_id !== hostId) fail('zoom_host_not_approved', 403, 'That recording is not from an approved host.');
  const picked = pickVideoFile(detail);
  if (!picked) fail('zoom_video_missing', 422, 'That meeting has no video recording yet.');
  if (picked.segmented) fail('zoom_video_segmented', 422, 'That meeting was recorded in several video parts. Upload the video manually.');
  const { file } = picked;
  if (file.file_size > MAX_ZOOM_VIDEO_BYTES) fail('zoom_video_too_large', 422, 'That video is too large to copy. Upload it manually.');

  // Build ruling 6: an already-copied file replays before anything is asked of staff.
  const copied = await store.findCopiedZoomVideoCopyForFile({ requestId, zoomFileId: file.id });
  if (copied) return { status: 200, body: { copy: { id: copied.id, state: 'copied' }, replayed: true } };

  // Try again: a failed copy's real registration is inspected (and a bound receipt replayed) before staff are asked
  // anything or N1 may insert a second copy. Uncertainty blocks; only proven absence proceeds. The snapshot is taken
  // once, before inspection, and N1 rechecks exactly that set under its lock: a copy that fails after this point is
  // unseen there, so N1 returns reconciliation_pending instead of admitting an uninspected row.
  const failedSnapshot = await store.listFailedZoomVideoCopiesForFile({ requestId, zoomFileId: file.id });
  const prior = await reconcileFailedCopiesForStart({ requestId, zoomFileId: file.id, rows: failedSnapshot },
    dependencies.zoomCopyWorkerDependencies || {});
  if (prior.outcome === 'replayed') return { status: 200, body: { copy: { id: prior.copyId, state: 'copied' }, replayed: true } };
  if (prior.outcome !== 'clear') fail('zoom_video_reconciliation_pending', 409, 'A previous copy is still being reconciled. Try again shortly.');

  const confirmed = await checkReplacement(requestId, replaces, dependencies);

  const bucket = activeBucket(await dependencies.getSharePointBuckets(requestId, request.akoya_requestnum));
  if (!bucket) throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);
  const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/Post Site Visit Materials`;
  await dependencies.ensureFolderPath(bucket.library, folderPath);

  const outcome = await store.startZoomVideoCopy({
    requestId, requestNum: request.akoya_requestnum, siteVisitActivityId: siteVisit.activityid,
    actorProfileId, actorSystemId: actingUserSystemId,
    zoomMeetingUuid: meetingUuid, zoomHostId: hostId, zoomHostEmail: listed.hostEmail,
    zoomMeetingStart: startTime.toISOString(), zoomFileId: file.id, zoomRecordingType: file.recording_type,
    declaredSize: file.file_size, originalDisplayFilename: zoomVideoFilename(startTime),
    libraryName: bucket.library, folderPath,
    confirmedWinnerDocumentId: confirmed?.documentId ?? null, confirmedWinnerSlotVersion: confirmed?.slotVersion ?? null,
    ...store.zoomRecordingTimes(file),
    failedSnapshot,
  });
  switch (outcome?.status) {
    case 'started': return { status: 202, body: { copy: { id: outcome.copy.id, state: 'queued' } } };
    case 'replayed': return { status: 200, body: { copy: { id: outcome.copy.id, state: 'copied' }, replayed: true } };
    case 'active': return fail('zoom_video_copy_active', 409, 'Another video copy is already running for this request.');
    case 'reconciliation_pending': return fail('zoom_video_reconciliation_pending', 409, 'A previous copy is still being reconciled. Try again shortly.');
    case 'in_progress': return fail('zoom_video_copy_in_progress', 409, 'A video copy is already in progress for this request.');
    default: return fail('zoom_video_start_unexpected', 500);
  }
}

/** N6. Sets the cancel flag on a queued or copying row. Returns `{ status, body }`; throws on saving or unknown ids. */
export async function cancelZoomVideoCopy({ requestId, copyId }) {
  if (!isGuid(requestId)) fail('invalid_request_id', 400, 'A valid request id is required.');
  if (!strictGuid(copyId)) fail('invalid_copy_id', 400, 'A valid copy id is required.');
  const result = await store.requestZoomVideoCopyCancel({ id: copyId, requestId });
  switch (result?.outcome) {
    case 'requested': return { status: 202, body: { copy: zoomVideoCopyDto(result.row) } };
    case 'terminal': return { status: 200, body: { copy: zoomVideoCopyDto(result.row) } };
    case 'saving': return fail('zoom_video_copy_saving', 409, 'The video is being saved and can no longer be cancelled.');
    case 'not_found': return fail('zoom_video_copy_not_found', 404, 'That video copy was not found.');
    default: return fail('zoom_video_cancel_unexpected', 500);
  }
}
