/**
 * Zoom recording import for the Meeting Tracker site-visit card (Stage 3a). Plan:
 * docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md.
 *
 * Lists approved hosts' cloud recordings and imports one meeting's audio (and Zoom
 * `audio_transcript` VTT) into the existing transcription pipeline by calling the existing
 * upload/start services. No Dataverse, SharePoint or Zoom writes. Download URLs, Zoom file
 * ids, topics and passcodes never leave this module.
 */
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { requireMeetingTranscriptionEnabled } from '../meeting-tracker-transcription/policy.js';
import { loadMeetingTranscriptionBinding } from '../meeting-tracker-transcription/binding.js';
import { uploadMeetingTranscription, startMeetingTranscription } from '../meeting-tracker-transcription/service.js';
import { MAX_TRANSCRIPTION_BYTES, MAX_ZOOM_TRANSCRIPT_BYTES, projectMeetingTranscriptionJob, writePrivateContent } from '../transcription-pilot/runtime.js';
import { getMeetingTranscriptionJob } from '../transcription-pilot/store.js';
import {
  ZoomClientError, listHostRecordings, getMeetingRecordings, downloadRecordingFile,
} from './zoom-client.js';
import {
  claimZoomImport, getActiveZoomImport, findJobForImport, takeOverExpiredAsStarted, takeOverExpiredAsFailed,
  markZoomImportStarted, markZoomImportFailed, listZoomImportsForRequest, FALLBACK_FAILURE_CODE,
} from './import-store.js';

export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
const FILE_REFRESH_MS = 5 * 60_000;
const BLOB_WRITE_MS = 120_000;
const CLAIM_ATTEMPTS = 3;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function fail(code, status, message = code) {
  throw new ServiceHttpError(message, { httpStatus: status, code, body: { error: message, code } });
}

/** `available` is true only when all three S2S credentials and at least one valid approved host are set. */
export function readZoomImportConfig(env = process.env) {
  const hosts = [...new Set(String(env.ZOOM_RECORDING_HOSTS || '').split(',')
    .map(value => value.trim().toLowerCase()).filter(value => value.length <= 254 && EMAIL.test(value)))];
  const credentials = ['ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET']
    .every(key => String(env[key] || '').trim() !== '');
  return { available: credentials && hosts.length > 0, hosts };
}

const fileTime = file => { const time = Date.parse(file?.recording_start); return Number.isFinite(time) ? time : 0; };
const newest = files => [...files].sort((a, b) => fileTime(b) - fileTime(a))[0] || null;
const extensionOf = file => String(file?.file_extension || '').toUpperCase();

/**
 * Newest completed audio_only M4A and newest completed audio_transcript VTT. Anything else
 * (closed_caption, MP4 video, unknown types, incomplete files, files without a usable size) is ignored.
 * A Zoom transcript over the pilot cap is treated as absent.
 */
function pickFiles(meeting, { requireUrl }) {
  const completed = (Array.isArray(meeting?.recording_files) ? meeting.recording_files : [])
    .filter(file => file?.status === 'completed' && Number.isSafeInteger(file.file_size) && file.file_size > 0
      && (!requireUrl || (typeof file.download_url === 'string' && file.download_url)));
  const audio = newest(completed.filter(file => file.recording_type === 'audio_only' && extensionOf(file) === 'M4A'));
  const transcript = newest(completed.filter(file => file.recording_type === 'audio_transcript'
    && extensionOf(file) === 'VTT' && file.file_size <= MAX_ZOOM_TRANSCRIPT_BYTES));
  return { audio, transcript };
}

/** The approved hosts' recorded meetings for the picker window, newest first, de-duplicated by occurrence UUID. */
async function listApprovedOccurrences(hosts, days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const byUuid = new Map();
  for (const hostEmail of hosts) {
    for (const meeting of await listHostRecordings(hostEmail, { from, to })) {
      if (!byUuid.has(meeting.uuid)) byUuid.set(meeting.uuid, { meeting, hostEmail });
    }
  }
  return [...byUuid.values()].sort((a, b) => String(b.meeting.start_time).localeCompare(String(a.meeting.start_time)));
}

function parseDays(days) {
  if (days === undefined || days === null || days === '') return DEFAULT_WINDOW_DAYS;
  const value = typeof days === 'string' && /^\d{1,3}$/.test(days) ? Number(days) : days;
  if (!Number.isInteger(value) || value < 1 || value > MAX_WINDOW_DAYS) fail('invalid_days', 400, 'days must be a whole number from 1 to 90.');
  return value;
}

function importSummaryByUuid(rows) {
  const summary = new Map();
  for (const row of rows) {
    const expired = row.state === 'importing' && row.lease_expired === true;
    const state = expired ? 'failed' : row.state;
    if (!['importing', 'started', 'failed'].includes(state)) continue;
    const current = summary.get(row.zoom_meeting_uuid);
    // Rows arrive newest first; an active row wins over an older failed one.
    if (!current || (current.state === 'failed' && state !== 'failed')) {
      summary.set(row.zoom_meeting_uuid, { state, jobId: row.transcription_job_id || null,
        failureCode: state === 'failed' ? (expired ? 'zoom_import_lease_expired' : row.failure_code || null) : null });
    }
  }
  return summary;
}

export async function listZoomRecordingsForVisit({ requestId, days } = {}) {
  const config = readZoomImportConfig();
  if (!config.available) return { available: false };
  const windowDays = parseDays(days);
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const [occurrences, imports] = await Promise.all([
    listApprovedOccurrences(config.hosts, windowDays),
    listZoomImportsForRequest({ requestId: binding.requestId }),
  ]);
  const summary = importSummaryByUuid(imports);
  const meetings = occurrences.map(({ meeting, hostEmail }) => {
    const { audio, transcript } = pickFiles(meeting, { requireUrl: false });
    return {
      meetingUuid: meeting.uuid,
      startTime: meeting.start_time,
      durationMinutes: Number.isFinite(Number(meeting.duration)) ? Number(meeting.duration) : null,
      hostEmail,
      audio: audio ? { bytes: audio.file_size } : null,
      transcript: transcript ? { bytes: transcript.file_size } : null,
      import: summary.get(meeting.uuid) || null,
    };
  });
  return { available: true, windowDays, meetings };
}

function isAuthoredError(error) {
  if (error instanceof ZoomClientError || error instanceof ServiceHttpError) return true;
  const status = Number(error?.httpStatus ?? error?.status);
  return typeof error?.code === 'string' && Number.isInteger(status) && status >= 400 && status <= 599;
}

async function jobDtoFor(binding, jobId) {
  if (!jobId) return null;
  const row = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
  return row ? projectMeetingTranscriptionJob(row) : null;
}

const importDto = row => ({ id: row.id, state: row.state, failureCode: row.failure_code || null });

/**
 * Claim the import slot for this request and meeting. Returns { claimed } for a new
 * importing row, or { existing } for a started row. An importing row past its lease is
 * resolved by looking up its job: past 'uploading' it becomes started, otherwise it is
 * failed and a new claim proceeds. Both takeovers are conditional updates, so of two
 * concurrent requests only one wins and the other re-reads.
 */
async function claimOrResolve(params) {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const claimed = await claimZoomImport(params);
    if (claimed) return { claimed };
    const active = await getActiveZoomImport({ requestId: params.requestId, meetingUuid: params.meetingUuid });
    if (!active) continue;
    if (active.state === 'started') return { existing: active };
    if (active.state !== 'importing') fail('zoom_import_state_unknown', 500);
    if (active.lease_expired !== true) fail('zoom_import_in_progress', 409, 'This recording is already being imported.');
    const job = await findJobForImport({ actorProfileId: active.actor_profile_id, importId: active.id });
    if (job && job.status !== 'uploading') {
      const started = await takeOverExpiredAsStarted({ id: active.id, jobId: job.id });
      if (started) return { existing: started };
    } else {
      await takeOverExpiredAsFailed({ id: active.id, failureCode: 'zoom_import_lease_expired' });
    }
  }
  return fail('zoom_import_in_progress', 409, 'This recording is already being imported.');
}

/**
 * Import one approved-host meeting. Returns { import: { id, state, failureCode }, job }. Every error
 * after the claim leaves the row 'failed' with a sanitized code and is rethrown with its own status.
 */
export async function importZoomRecording({ requestId, ownerProfileId, actingUserSystemId, meetingUuid, acknowledged }) {
  const config = readZoomImportConfig();
  if (!config.available) fail('zoom_import_unavailable', 503, 'Zoom import is not available.');
  if (acknowledged !== true) fail('non_sensitive_acknowledgement_required', 400, 'The non-sensitive acknowledgement is required.');
  // eslint-disable-next-line no-control-regex
  if (typeof meetingUuid !== 'string' || meetingUuid.length < 1 || meetingUuid.length > 200 || /[\u0000-\u001f\u007f]/.test(meetingUuid)) {
    fail('invalid_meeting_uuid', 400, 'A valid meeting is required.');
  }
  if (!Number.isSafeInteger(ownerProfileId) || ownerProfileId < 1) fail('profile_required', 401);
  if (!isGuid(actingUserSystemId || '')) fail('post_presentation_actor_required', 403);
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);

  // The UUID must come from the approved hosts' own listing; no Zoom call is made for any other UUID.
  const listed = (await listApprovedOccurrences(config.hosts, DEFAULT_WINDOW_DAYS)).find(item => item.meeting.uuid === meetingUuid);
  if (!listed) fail('zoom_meeting_not_found', 404, 'That recording was not found.');
  const hostId = listed.meeting.host_id;
  const startTime = new Date(listed.meeting.start_time);
  if (typeof hostId !== 'string' || hostId.length < 1 || hostId.length > 100 || Number.isNaN(startTime.getTime())) {
    fail('zoom_listing_invalid', 502, 'The Zoom listing could not be used.');
  }
  let detail = await getMeetingRecordings(meetingUuid);
  let detailAt = Date.now();
  if (detail?.host_id !== hostId) fail('zoom_host_not_approved', 403, 'That recording is not from an approved host.');
  const { audio, transcript } = pickFiles(detail, { requireUrl: true });
  if (!audio) fail('zoom_audio_missing', 422, 'That meeting has no audio recording yet.');
  if (audio.file_size > MAX_TRANSCRIPTION_BYTES) fail('zoom_audio_too_large', 422, 'That audio recording is too large to transcribe.');

  const claim = await claimOrResolve({ requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
    actorProfileId: ownerProfileId, meetingUuid, hostId, meetingStart: startTime.toISOString(),
    includesZoomTranscript: transcript != null });
  if (claim.existing) return { import: importDto(claim.existing), job: await jobDtoFor(binding, claim.existing.transcription_job_id) };
  const held = claim.claimed;

  // Fresh download URLs when more than five minutes passed; the files must still be what the job declared.
  async function currentFile(kind, declaredBytes) {
    if (Date.now() - detailAt > FILE_REFRESH_MS) {
      detail = await getMeetingRecordings(meetingUuid);
      detailAt = Date.now();
      if (detail?.host_id !== hostId) fail('zoom_host_not_approved', 403, 'That recording is not from an approved host.');
    }
    const file = pickFiles(detail, { requireUrl: true })[kind];
    if (!file || file.file_size !== declaredBytes) fail('zoom_recording_changed', 409, 'The recording changed while importing. Try again.');
    return file;
  }

  let started;
  try {
    const body = { filename: `Zoom ${startTime.toISOString()}.m4a`, contentType: 'audio/mp4', bytes: audio.file_size,
      idempotencyKey: held.id, providerRegion: 'us' };
    if (transcript) body.zoomTranscript = { contentType: 'text/vtt', bytes: transcript.file_size };
    const created = await uploadMeetingTranscription({ requestId, ownerProfileId, body });
    const job = created?.job;
    if (!job?.id || !Number.isSafeInteger(job.version) || job.status !== 'uploading') fail('zoom_job_not_uploading', 409);
    // The job DTO carries no cleanup pathnames; the raw row (exported store getter) does.
    const row = await getMeetingTranscriptionJob({ jobId: job.id, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    const prefix = `transcription-pilot/${ownerProfileId}/${job.id}/`;
    const audioPath = row?.input_cleanup_pathname;
    const transcriptPath = row?.zoom_transcript_cleanup_pathname;
    if (typeof audioPath !== 'string' || !audioPath.startsWith(prefix)
      || (transcript && (typeof transcriptPath !== 'string' || !transcriptPath.startsWith(prefix)))) {
      fail('zoom_job_pathname_missing', 500);
    }
    const audioFile = await currentFile('audio', audio.file_size);
    const audioBytes = await downloadRecordingFile(audioFile.download_url, { maxBytes: MAX_TRANSCRIPTION_BYTES, expectedBytes: audio.file_size });
    await writePrivateContent(audioPath, 'audio/mp4', audioBytes, Date.now() + BLOB_WRITE_MS);
    if (transcript) {
      const transcriptFile = await currentFile('transcript', transcript.file_size);
      const vtt = await downloadRecordingFile(transcriptFile.download_url, { maxBytes: MAX_ZOOM_TRANSCRIPT_BYTES, expectedBytes: transcript.file_size });
      await writePrivateContent(transcriptPath, 'text/vtt', vtt, Date.now() + BLOB_WRITE_MS);
    }
    // expectedVersion is the version of the job after its upload-window reservation.
    started = await startMeetingTranscription({ requestId, ownerProfileId, actingUserSystemId, jobId: job.id,
      body: { expectedVersion: job.version, nonSensitiveAcknowledged: true } });
  } catch (error) {
    const known = isAuthoredError(error);
    try {
      await markZoomImportFailed({ id: held.id, leaseToken: held.lease_token, failureCode: known ? error.code : FALLBACK_FAILURE_CODE });
    } catch { /* the original error wins */ }
    if (known) throw error;
    return fail(FALLBACK_FAILURE_CODE, 500, 'The Zoom import could not be completed.');
  }

  // Only dispatchPending:true or a returned job counts as started; the hourly recovery cron dispatches pending jobs.
  if (!started?.job?.id) {
    await markZoomImportFailed({ id: held.id, leaseToken: held.lease_token, failureCode: 'zoom_start_unexpected' }).catch(() => {});
    fail('zoom_start_unexpected', 502);
  }
  let finished = null;
  try {
    finished = await markZoomImportStarted({ id: held.id, leaseToken: held.lease_token, jobId: started.job.id });
  } catch {
    // The job is already queued: leave the lease; an expired lease resolves to started through the job lookup.
    return { import: { id: held.id, state: 'importing', failureCode: null }, job: started.job };
  }
  if (!finished) {
    const active = await getActiveZoomImport({ requestId: binding.requestId, meetingUuid });
    if (active?.state === 'started' && active.id === held.id) return { import: importDto(active), job: started.job };
    fail('zoom_import_lease_lost', 409, 'The import was taken over by another request.');
  }
  return { import: importDto(finished), job: started.job };
}
