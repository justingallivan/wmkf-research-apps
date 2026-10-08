/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/policy.js', () => ({ requireMeetingTranscriptionEnabled: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/binding.js', () => ({ loadMeetingTranscriptionBinding: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({ uploadMeetingTranscription: jest.fn(), startMeetingTranscription: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  MAX_TRANSCRIPTION_BYTES: 200 * 1024 * 1024, MAX_ZOOM_TRANSCRIPT_BYTES: 4_000_000,
  projectMeetingTranscriptionJob: jest.fn(row => ({ id: row.id, status: row.status, version: row.version })),
  writePrivateContent: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => ({ getMeetingTranscriptionJob: jest.fn(), retireMeetingTranscriptionUploadingJob: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-recordings/zoom-client.js', () => ({
  ...jest.requireActual('../../lib/services/meeting-tracker-recordings/zoom-client.js'),
  listHostRecordings: jest.fn(), getMeetingRecordings: jest.fn(), downloadRecordingFile: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/import-store.js', () => ({
  ...jest.requireActual('../../lib/services/meeting-tracker-recordings/import-store.js'),
  claimZoomImport: jest.fn(), getActiveZoomImport: jest.fn(), findJobForImport: jest.fn(),
  takeOverExpiredAsStarted: jest.fn(), takeOverExpiredAsFailed: jest.fn(),
  releaseStartedImportWithEndedJob: jest.fn(), markZoomImportStarted: jest.fn(), markZoomImportFailed: jest.fn(), listZoomImportsForRequest: jest.fn(),
}));

import { requireMeetingTranscriptionEnabled } from '../../lib/services/meeting-tracker-transcription/policy.js';
import { loadMeetingTranscriptionBinding } from '../../lib/services/meeting-tracker-transcription/binding.js';
import { uploadMeetingTranscription, startMeetingTranscription } from '../../lib/services/meeting-tracker-transcription/service.js';
import { writePrivateContent, projectMeetingTranscriptionJob } from '../../lib/services/transcription-pilot/runtime.js';
import { getMeetingTranscriptionJob, retireMeetingTranscriptionUploadingJob } from '../../lib/services/transcription-pilot/store.js';
import { ZoomClientError, listHostRecordings, getMeetingRecordings, downloadRecordingFile } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import * as store from '../../lib/services/meeting-tracker-recordings/import-store.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { importZoomRecording, listZoomRecordingsForVisit, readZoomImportConfig } from '../../lib/services/meeting-tracker-recordings/import-service.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const JOB = '33333333-3333-4333-8333-333333333333';
const UUID = 'abc/def==';
const HOST_ID = 'zoomhost123';
const START = '2026-10-05T17:00:00Z';
const ENV_KEYS = ['ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET', 'ZOOM_RECORDING_HOSTS'];
const AUDIO_URL = 'https://us02web.zoom.us/rec/download/AUDIO-SECRET';
const VTT_URL = 'https://us02web.zoom.us/rec/download/VTT-SECRET';
const CC_URL = 'https://us02web.zoom.us/rec/download/CC-SECRET';

const file = (over) => ({ id: 'file-id', status: 'completed', file_extension: 'M4A', recording_type: 'audio_only', file_size: 5,
  recording_start: '2026-10-05T17:00:00Z', download_url: AUDIO_URL, ...over });
const audioFile = file({ id: 'audio-id' });
const vttFile = file({ id: 'vtt-id', file_extension: 'VTT', recording_type: 'audio_transcript', file_size: 3, download_url: VTT_URL });
const ccFile = file({ id: 'cc-id', file_extension: 'VTT', recording_type: 'closed_caption', file_size: 9, download_url: CC_URL });
const mp4File = file({ id: 'mp4-id', file_extension: 'MP4', recording_type: 'shared_screen_with_speaker_view', file_size: 99, download_url: 'https://x.zoom.us/mp4' });
const meeting = (files, over = {}) => ({ uuid: UUID, id: 1, host_id: HOST_ID, topic: 'SECRET TOPIC', start_time: START, duration: 62, recording_files: files, ...over });

let rows;
let clock;
function installFakeStore() {
  rows = new Map();
  store.claimZoomImport.mockImplementation(async (p) => {
    for (const r of rows.values()) if (r.request_id === p.requestId && r.zoom_meeting_uuid === p.meetingUuid && ['importing', 'started'].includes(r.state)) return null;
    const row = { id: p.id || `44444444-4444-4444-8444-${String(rows.size + 1).padStart(12, '0')}`, request_id: p.requestId, site_visit_activity_id: p.siteVisitActivityId,
      actor_profile_id: p.actorProfileId, zoom_meeting_uuid: p.meetingUuid, zoom_host_id: p.hostId, zoom_meeting_start: p.meetingStart,
      includes_zoom_transcript: p.includesZoomTranscript, state: 'importing', lease_token: `lease-${rows.size + 1}`, lease_expires_at: 'future',
      lease_expired: false, transcription_job_id: null, failure_code: null };
    rows.set(row.id, row);
    return { ...row };
  });
  store.getActiveZoomImport.mockImplementation(async ({ requestId, meetingUuid }) => {
    const r = [...rows.values()].find(x => x.request_id === requestId && x.zoom_meeting_uuid === meetingUuid && ['importing', 'started'].includes(x.state));
    return r ? { ...r } : null;
  });
  store.markZoomImportStarted.mockImplementation(async ({ id, leaseToken, jobId }) => {
    const r = rows.get(id);
    if (!r || r.lease_token !== leaseToken || r.state !== 'importing') return null;
    Object.assign(r, { state: 'started', transcription_job_id: jobId, lease_token: null, lease_expires_at: null });
    return { ...r };
  });
  store.markZoomImportFailed.mockImplementation(async ({ id, leaseToken, failureCode }) => {
    const r = rows.get(id);
    if (!r || r.lease_token !== leaseToken || r.state !== 'importing') return null;
    Object.assign(r, { state: 'failed', failure_code: failureCode, lease_token: null, lease_expires_at: null });
    return { ...r };
  });
  store.takeOverExpiredAsStarted.mockImplementation(async ({ id, jobId }) => {
    const r = rows.get(id);
    if (!r || r.state !== 'importing' || !r.lease_expired) return null;
    Object.assign(r, { state: 'started', transcription_job_id: jobId, lease_token: null, lease_expires_at: null, lease_expired: false });
    return { ...r };
  });
  store.takeOverExpiredAsFailed.mockImplementation(async ({ id, failureCode }) => {
    const r = rows.get(id);
    if (!r || r.state !== 'importing' || !r.lease_expired) return null;
    Object.assign(r, { state: 'failed', failure_code: failureCode, lease_token: null, lease_expires_at: null, lease_expired: false });
    return { ...r };
  });
  store.releaseStartedImportWithEndedJob.mockImplementation(async ({ id, jobId }) => {
    const r = rows.get(id);
    if (!r || r.state !== 'started' || (r.transcription_job_id ?? null) !== (jobId ?? null)) return null;
    Object.assign(r, { state: 'failed', failure_code: 'zoom_import_job_ended' });
    return { ...r };
  });
  store.listZoomImportsForRequest.mockImplementation(async () => [...rows.values()].reverse().map(r => ({ ...r })));
}

const args = (over = {}) => ({ requestId: REQUEST, ownerProfileId: 9, actingUserSystemId: ACTOR, meetingUuid: UUID, acknowledged: true, ...over });
const rawJob = { id: JOB, status: 'uploading', version: 2, input_cleanup_pathname: `transcription-pilot/9/${JOB}/input/audio.m4a`,
  zoom_transcript_cleanup_pathname: `transcription-pilot/9/${JOB}/input/zoom-transcript.vtt` };
let saved;
beforeEach(() => {
  jest.resetAllMocks();
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  Object.assign(process.env, { ZOOM_S2S_ACCOUNT_ID: 'a', ZOOM_S2S_CLIENT_ID: 'c', ZOOM_S2S_CLIENT_SECRET: 's', ZOOM_RECORDING_HOSTS: 'Wmk-Library@wmkeck.org' });
  installFakeStore();
  projectMeetingTranscriptionJob.mockImplementation(row => ({ id: row.id, status: row.status, version: row.version }));
  loadMeetingTranscriptionBinding.mockResolvedValue({ requestId: REQUEST, siteVisitActivityId: VISIT });
  listHostRecordings.mockResolvedValue([meeting([audioFile, vttFile, ccFile, mp4File])]);
  getMeetingRecordings.mockResolvedValue(meeting([audioFile, vttFile, ccFile, mp4File], { start_time: '2030-01-01T00:00:00Z' }));
  uploadMeetingTranscription.mockResolvedValue({ job: { id: JOB, status: 'uploading', version: 2 }, upload: { token: 'client-token' } });
  getMeetingTranscriptionJob.mockResolvedValue(rawJob);
  retireMeetingTranscriptionUploadingJob.mockResolvedValue({ ...rawJob, cleanup_requested_at: 'now' });
  downloadRecordingFile.mockImplementation(async (url) => (url === AUDIO_URL ? Buffer.alloc(5) : url === VTT_URL ? Buffer.alloc(3) : Buffer.alloc(9)));
  writePrivateContent.mockResolvedValue({});
  startMeetingTranscription.mockResolvedValue({ job: { id: JOB, status: 'queued', version: 3 }, dispatchPending: false });
  clock = Date.now();
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } jest.restoreAllMocks(); });

async function rejection(promise) { try { await promise; } catch (error) { return error; } throw new Error('expected rejection'); }
const onlyRow = () => [...rows.values()][0];

describe('config', () => {
  test('parses, lower-cases and de-duplicates hosts and drops invalid entries', () => {
    expect(readZoomImportConfig({ ZOOM_S2S_ACCOUNT_ID: 'a', ZOOM_S2S_CLIENT_ID: 'c', ZOOM_S2S_CLIENT_SECRET: 's',
      ZOOM_RECORDING_HOSTS: ' A@x.org, a@x.org ,not-an-email,,b@y.org ' })).toEqual({ available: true, hosts: ['a@x.org', 'b@y.org'] });
  });
  test.each([...ENV_KEYS.slice(0, 3), 'ZOOM_RECORDING_HOSTS-empty', 'ZOOM_RECORDING_HOSTS-invalid'])('missing %s makes GET unavailable before any Zoom call and POST 503', async (key) => {
    if (key === 'ZOOM_RECORDING_HOSTS-empty') process.env.ZOOM_RECORDING_HOSTS = ' , ';
    else if (key === 'ZOOM_RECORDING_HOSTS-invalid') process.env.ZOOM_RECORDING_HOSTS = 'nobody';
    else delete process.env[key];
    expect(await listZoomRecordingsForVisit({ requestId: REQUEST })).toEqual({ available: false });
    const error = await rejection(importZoomRecording(args()));
    expect(error.httpStatus).toBe(503);
    expect(error.code).toBe('zoom_import_unavailable');
    expect(listHostRecordings).not.toHaveBeenCalled();
    expect(getMeetingRecordings).not.toHaveBeenCalled();
    expect(store.claimZoomImport).not.toHaveBeenCalled();
  });
});

describe('listing', () => {
  test('returns occurrences with file sizes and import state, and never URLs, file ids, topics or passcodes', async () => {
    rows.set('r1', { id: 'r1', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'started', transcription_job_id: JOB, job_status: 'queued', failure_code: null, lease_expired: false });
    const result = await listZoomRecordingsForVisit({ requestId: REQUEST });
    expect(requireMeetingTranscriptionEnabled).toHaveBeenCalledWith(REQUEST);
    expect(result).toEqual({ available: true, windowDays: 30, meetings: [{ meetingUuid: UUID, startTime: START, durationMinutes: 62,
      hostEmail: 'wmk-library@wmkeck.org', audio: { bytes: 5 }, transcript: { bytes: 3 }, import: { state: 'started', jobId: JOB, failureCode: null } }] });
    const text = JSON.stringify(result);
    for (const leak of ['SECRET', 'download', 'audio-id', 'vtt-id', 'passcode', 'HOST']) expect(text).not.toContain(leak);
  });
  test('a closed_caption-only meeting lists as audio only', async () => {
    listHostRecordings.mockResolvedValue([meeting([audioFile, ccFile])]);
    expect((await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0].transcript).toBeNull();
  });
  test('an expired importing row is shown as failed so the meeting can be retried', async () => {
    rows.set('r1', { id: 'r1', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true });
    expect((await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0].import).toEqual({ state: 'failed', jobId: null, failureCode: 'zoom_import_lease_expired' });
  });
  test.each(['0', '91', '1.5', 'abc', -3, 500])('days=%s is rejected with 400 (not clamped)', async (days) => {
    const error = await rejection(listZoomRecordingsForVisit({ requestId: REQUEST, days }));
    expect(error.httpStatus).toBe(400);
    expect(listHostRecordings).not.toHaveBeenCalled();
  });
});

describe('import: validation and provenance', () => {
  test('requires the acknowledgement and a valid uuid before any Zoom call', async () => {
    expect((await rejection(importZoomRecording(args({ acknowledged: 'true' })))).httpStatus).toBe(400);
    for (const bad of ['', 'x'.repeat(201), 'a\nb', 5, null]) expect((await rejection(importZoomRecording(args({ meetingUuid: bad })))).code).toBe('invalid_meeting_uuid');
    expect((await rejection(importZoomRecording(args({ actingUserSystemId: 'not-a-guid' })))).httpStatus).toBe(403);
    expect(listHostRecordings).not.toHaveBeenCalled();
  });

  test('a uuid the approved listing did not return is 404 and no per-meeting Zoom call is made', async () => {
    listHostRecordings.mockResolvedValue([meeting([audioFile], { uuid: 'someone-elses' })]);
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_meeting_not_found');
    expect(error.httpStatus).toBe(404);
    expect(getMeetingRecordings).not.toHaveBeenCalled();
    expect(store.claimZoomImport).not.toHaveBeenCalled();
  });

  test('a host_id that differs between the listing and the meeting detail is 403 before the claim', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([audioFile], { host_id: 'other-host' }));
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_host_not_approved');
    expect(error.httpStatus).toBe(403);
    expect(store.claimZoomImport).not.toHaveBeenCalled();
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });

  test('host and start time come from the listing row; the actor and idempotency key are the session and the row id', async () => {
    const result = await importZoomRecording(args());
    const claim = store.claimZoomImport.mock.calls[0][0];
    expect(claim).toMatchObject({ requestId: REQUEST, siteVisitActivityId: VISIT, actorProfileId: 9, meetingUuid: UUID, hostId: HOST_ID,
      meetingStart: new Date(START).toISOString(), includesZoomTranscript: true });
    expect(claim.meetingStart).not.toContain('2030');
    const upload = uploadMeetingTranscription.mock.calls[0][0];
    expect(upload.ownerProfileId).toBe(9);
    expect(upload.body).toEqual({ filename: `Zoom ${new Date(START).toISOString()}.m4a`, contentType: 'audio/mp4', bytes: 5,
      idempotencyKey: onlyRow().id, providerRegion: 'us', zoomTranscript: { contentType: 'text/vtt', bytes: 3 } });
    expect(result.import).toEqual({ id: onlyRow().id, state: 'started', failureCode: null });
    expect(onlyRow()).toMatchObject({ state: 'started', transcription_job_id: JOB, lease_token: null });
  });

  test('start uses the job version returned by the upload (after the reservation) and the session actor', async () => {
    uploadMeetingTranscription.mockResolvedValue({ job: { id: JOB, status: 'uploading', version: 7 }, upload: {} });
    await importZoomRecording(args());
    expect(startMeetingTranscription).toHaveBeenCalledWith({ requestId: REQUEST, ownerProfileId: 9, actingUserSystemId: ACTOR, jobId: JOB,
      body: { expectedVersion: 7, nonSensitiveAcknowledged: true } });
  });
});

describe('import: file selection', () => {
  test('uses audio_transcript and never closed_caption or video', async () => {
    await importZoomRecording(args());
    const urls = downloadRecordingFile.mock.calls.map(([url]) => url);
    expect(urls).toEqual([AUDIO_URL, VTT_URL]);
    expect(urls).not.toContain(CC_URL);
  });
  test('a meeting with only closed_caption imports audio only and sends no zoomTranscript', async () => {
    const files = [audioFile, ccFile, mp4File];
    listHostRecordings.mockResolvedValue([meeting(files)]);
    getMeetingRecordings.mockResolvedValue(meeting(files));
    await importZoomRecording(args());
    expect(uploadMeetingTranscription.mock.calls[0][0].body.zoomTranscript).toBeUndefined();
    expect(downloadRecordingFile.mock.calls.map(([url]) => url)).toEqual([AUDIO_URL]);
    expect(onlyRow().includes_zoom_transcript).toBe(false);
  });
  test.each([
    ['only closed_caption and video', [ccFile, mp4File]],
    ['an incomplete audio file', [{ ...audioFile, status: 'processing' }]],
    ['audio of the wrong extension', [{ ...audioFile, file_extension: 'MP3' }]],
    ['a type Zoom added later', [{ ...audioFile, recording_type: 'audio_future' }]],
  ])('%s is 422 zoom_audio_missing with no claim', async (_label, files) => {
    getMeetingRecordings.mockResolvedValue(meeting(files));
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_audio_missing');
    expect(error.httpStatus).toBe(422);
    expect(rows.size).toBe(0);
  });
  test('audio over the transcription cap is rejected before the claim', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([{ ...audioFile, file_size: 200 * 1024 * 1024 + 1 }]));
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_audio_too_large');
    expect(rows.size).toBe(0);
  });
  test('an oversize Zoom transcript is ignored and the audio imports alone', async () => {
    const files = [audioFile, { ...vttFile, file_size: 4_000_001 }];
    getMeetingRecordings.mockResolvedValue(meeting(files));
    await importZoomRecording(args());
    expect(uploadMeetingTranscription.mock.calls[0][0].body.zoomTranscript).toBeUndefined();
  });
  test('picks the newest completed audio file', async () => {
    const newer = file({ id: 'newer', recording_start: '2026-10-05T18:00:00Z', file_size: 6, download_url: 'https://us02web.zoom.us/rec/download/NEWER' });
    getMeetingRecordings.mockResolvedValue(meeting([audioFile, newer]));
    downloadRecordingFile.mockResolvedValue(Buffer.alloc(6));
    await importZoomRecording(args());
    expect(downloadRecordingFile.mock.calls[0][0]).toBe('https://us02web.zoom.us/rec/download/NEWER');
    expect(uploadMeetingTranscription.mock.calls[0][0].body.bytes).toBe(6);
  });
});

describe('import: bytes and Blob writes', () => {
  test("bytes are written to the job's cleanup pathnames with the declared sizes enforced by the download", async () => {
    await importZoomRecording(args());
    expect(getMeetingTranscriptionJob).toHaveBeenCalledWith({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT });
    expect(downloadRecordingFile).toHaveBeenNthCalledWith(1, AUDIO_URL, { maxBytes: 200 * 1024 * 1024, expectedBytes: 5 });
    expect(downloadRecordingFile).toHaveBeenNthCalledWith(2, VTT_URL, { maxBytes: 4_000_000, expectedBytes: 3 });
    expect(writePrivateContent.mock.calls.map(([path, type, body]) => [path, type, body.length])).toEqual([
      [rawJob.input_cleanup_pathname, 'audio/mp4', 5], [rawJob.zoom_transcript_cleanup_pathname, 'text/vtt', 3]]);
  });
  test.each([
    ['audio path outside the job', { input_cleanup_pathname: 'transcription-pilot/9/other/input/audio.m4a' }],
    ['audio path missing', { input_cleanup_pathname: null }],
    ['transcript path missing while a transcript was declared', { zoom_transcript_cleanup_pathname: null }],
  ])('%s fails the import without writing', async (_l, over) => {
    getMeetingTranscriptionJob.mockResolvedValue({ ...rawJob, ...over });
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_job_pathname_missing');
    expect(writePrivateContent).not.toHaveBeenCalled();
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'zoom_job_pathname_missing' });
  });
  test('a job that is not in uploading fails closed', async () => {
    uploadMeetingTranscription.mockResolvedValue({ job: { id: JOB, status: 'ready', version: 2 }, upload: null });
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_job_not_uploading');
    expect(downloadRecordingFile).not.toHaveBeenCalled();
    expect(onlyRow().state).toBe('failed');
  });
  test('download URLs are refreshed when more than five minutes passed since the meeting detail was read', async () => {
    const fresh = meeting([{ ...audioFile, download_url: 'https://us02web.zoom.us/rec/download/FRESH' }, vttFile]);
    getMeetingRecordings.mockResolvedValueOnce(meeting([audioFile, vttFile])).mockResolvedValue(fresh);
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    uploadMeetingTranscription.mockImplementation(async () => { clock += 6 * 60_000; return { job: { id: JOB, status: 'uploading', version: 2 }, upload: {} }; });
    await importZoomRecording(args());
    expect(getMeetingRecordings).toHaveBeenCalledTimes(2);
    expect(downloadRecordingFile.mock.calls[0][0]).toBe('https://us02web.zoom.us/rec/download/FRESH');
    now.mockRestore();
  });
  test('a recording that changed size after the job was declared is rejected', async () => {
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    uploadMeetingTranscription.mockImplementation(async () => { clock += 6 * 60_000; return { job: { id: JOB, status: 'uploading', version: 2 }, upload: {} }; });
    getMeetingRecordings.mockResolvedValueOnce(meeting([audioFile])).mockResolvedValue(meeting([{ ...audioFile, file_size: 8 }]));
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_recording_changed');
    expect(writePrivateContent).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe('import: claim lifecycle', () => {
  test('a started row for the same meeting is returned without any upload', async () => {
    rows.set('existing', { id: 'existing', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'started', transcription_job_id: JOB, job_status: 'queued', lease_expired: false });
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status: 'queued', version: 3 });
    const result = await importZoomRecording(args());
    expect(result).toEqual({ import: { id: 'existing', state: 'started', failureCode: null }, job: { id: JOB, status: 'queued', version: 3 } });
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
    expect(downloadRecordingFile).not.toHaveBeenCalled();
  });
  test('a live importing row is 409 zoom_import_in_progress with no upload', async () => {
    rows.set('live', { id: 'live', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: false });
    const error = await rejection(importZoomRecording(args()));
    expect(error.httpStatus).toBe(409);
    expect(error.code).toBe('zoom_import_in_progress');
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('an unknown active state is an error, not success', async () => {
    store.claimZoomImport.mockResolvedValue(null);
    store.getActiveZoomImport.mockResolvedValue({ id: 'weird', state: 'mystery' });
    const error = await rejection(importZoomRecording(args()));
    expect(error.httpStatus).toBe(500);
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('an expired lease whose job is past uploading becomes started with that job and nothing is re-uploaded', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue({ id: JOB, status: 'queued' });
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status: 'queued', version: 3 });
    const result = await importZoomRecording(args());
    expect(store.findJobForImport).toHaveBeenCalledWith({ actorProfileId: 3, importId: 'stale' });
    expect(result.import).toEqual({ id: 'stale', state: 'started', failureCode: null });
    expect(rows.get('stale')).toMatchObject({ state: 'started', transcription_job_id: JOB });
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test.each([['no job', null], ['a job still uploading', { id: JOB, status: 'uploading' }]])('an expired lease with %s is failed zoom_import_lease_expired and a new claim proceeds', async (_l, job) => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue(job);
    const result = await importZoomRecording(args());
    expect(rows.get('stale')).toMatchObject({ state: 'failed', failure_code: 'zoom_import_lease_expired', lease_token: null });
    expect(result.import.id).not.toBe('stale');
    expect(result.import.state).toBe('started');
    expect(uploadMeetingTranscription).toHaveBeenCalledTimes(1);
  });
  test('losing the takeover race re-reads the active row instead of assuming the takeover', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue(null);
    // The other request wins: it fails the stale row and its new claim is live.
    store.takeOverExpiredAsFailed.mockImplementationOnce(async () => {
      rows.get('stale').state = 'failed'; rows.get('stale').failure_code = 'zoom_import_lease_expired';
      rows.set('theirs', { id: 'theirs', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: false });
      return null;
    });
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_import_in_progress');
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('the final update cannot overwrite a takeover: a lost lease is not marked failed or started', async () => {
    startMeetingTranscription.mockImplementation(async () => {
      Object.assign(onlyRow(), { state: 'importing', lease_token: 'someone-else' });
      return { job: { id: JOB, status: 'queued', version: 3 }, dispatchPending: false };
    });
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_import_lease_lost');
    expect(onlyRow()).toMatchObject({ state: 'importing', lease_token: 'someone-else' });
  });
  test('if the started update itself fails after the job queued, the row is not marked failed', async () => {
    store.markZoomImportStarted.mockRejectedValue(new Error('db down'));
    const result = await importZoomRecording(args());
    expect(result.import.state).toBe('importing');
    expect(store.markZoomImportFailed).not.toHaveBeenCalled();
    expect(result.job.id).toBe(JOB);
  });
});

describe('import: failure paths', () => {
  test('a global-slot conflict from the upload is recorded failed and returned with its own status', async () => {
    uploadMeetingTranscription.mockRejectedValue(new ServiceHttpError('Another transcription is active.', { httpStatus: 409, code: 'transcription_slot_busy' }));
    const error = await rejection(importZoomRecording(args()));
    expect(error.httpStatus).toBe(409);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'transcription_slot_busy', lease_token: null });
    expect(downloadRecordingFile).not.toHaveBeenCalled();
  });
  test('a start failure is recorded failed with its code and status', async () => {
    startMeetingTranscription.mockRejectedValue(Object.assign(new Error('content_unavailable'), { code: 'content_unavailable', status: 410 }));
    const error = await rejection(importZoomRecording(args()));
    expect(error.status).toBe(410);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'content_unavailable' });
  });
  test('dispatchPending:true counts as started', async () => {
    startMeetingTranscription.mockResolvedValue({ job: { id: JOB, status: 'queued', version: 3 }, dispatchPending: true });
    const result = await importZoomRecording(args());
    expect(result.import.state).toBe('started');
    expect(onlyRow().state).toBe('started');
  });
  test('a start result without a job is not success', async () => {
    startMeetingTranscription.mockResolvedValue({});
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_start_unexpected');
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'zoom_start_unexpected' });
  });
  test('a Zoom download size mismatch fails the row with the sanitized code and the original status', async () => {
    downloadRecordingFile.mockRejectedValue(new ZoomClientError('zoom_download_invalid'));
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('zoom_download_invalid');
    expect(error.httpStatus).toBe(502);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'zoom_download_invalid' });
    expect(startMeetingTranscription).not.toHaveBeenCalled();
  });
  test('an unexpected error is returned as a generic 500 and recorded with the fallback code; its text never leaks', async () => {
    writePrivateContent.mockRejectedValue(Object.assign(new Error(`put failed ${AUDIO_URL} Bearer SECRET-TOKEN`), { code: 'weird_blob_code' }));
    const error = await rejection(importZoomRecording(args()));
    expect(error.httpStatus).toBe(500);
    expect(JSON.stringify([error.message, error.body])).not.toMatch(/SECRET|zoom\.us|Bearer/);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'zoom_import_failed' });
  });
  test('a failure update that itself throws does not mask the original error', async () => {
    downloadRecordingFile.mockRejectedValue(new ZoomClientError('zoom_not_found'));
    store.markZoomImportFailed.mockRejectedValue(new Error('constraint violation'));
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_not_found');
  });
  test('a failed row frees the slot for a retry that gets a new row and a new idempotency key', async () => {
    downloadRecordingFile.mockRejectedValueOnce(new ZoomClientError('zoom_unavailable'));
    await rejection(importZoomRecording(args()));
    const first = onlyRow().id;
    await importZoomRecording(args());
    const keys = uploadMeetingTranscription.mock.calls.map(([call]) => call.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(first);
    expect(keys[1]).not.toBe(first);
  });
});

describe('started rows and ended jobs (re-import release)', () => {
  const startedRow = (over) => rows.set('old', { id: 'old', request_id: REQUEST, actor_profile_id: 9, zoom_meeting_uuid: UUID, state: 'started',
    transcription_job_id: JOB, job_status: 'queued', lease_expired: false, ...over });
  test.each(['failed', 'expired'])('a started row whose job is %s is released and a new row and a new job are created', async (status) => {
    startedRow({ job_status: status });
    const result = await importZoomRecording(args());
    expect(rows.get('old')).toMatchObject({ state: 'failed', failure_code: 'zoom_import_job_ended' });
    expect(result.import.id).not.toBe('old');
    expect(result.import.state).toBe('started');
    expect(uploadMeetingTranscription).toHaveBeenCalledTimes(1);
  });
  test('a started row whose job id is NULL is re-importable', async () => {
    startedRow({ transcription_job_id: null, job_status: null });
    await importZoomRecording(args());
    expect(rows.get('old').failure_code).toBe('zoom_import_job_ended');
    expect(uploadMeetingTranscription).toHaveBeenCalledTimes(1);
  });
  test.each(['ready', 'submission_uncertain', 'processing', 'queued'])('a started row whose job is %s still blocks and is returned without any upload', async (status) => {
    startedRow({ job_status: status });
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status, version: 3 });
    const result = await importZoomRecording(args());
    expect(result.import).toEqual({ id: 'old', state: 'started', failureCode: null });
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
    expect(store.releaseStartedImportWithEndedJob).not.toHaveBeenCalled();
  });
  test('losing the release race re-reads the active row', async () => {
    startedRow({ job_status: 'failed' });
    store.releaseStartedImportWithEndedJob.mockImplementationOnce(async () => {
      Object.assign(rows.get('old'), { state: 'failed', failure_code: 'zoom_import_job_ended' });
      rows.set('theirs', { id: 'theirs', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: false });
      return null;
    });
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_import_in_progress');
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('an expired lease whose job already failed is failed (not started) with zoom_import_job_ended', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue({ id: JOB, status: 'failed' });
    await importZoomRecording(args());
    expect(rows.get('stale')).toMatchObject({ state: 'failed', failure_code: 'zoom_import_job_ended' });
    expect(store.takeOverExpiredAsStarted).not.toHaveBeenCalled();
  });
  test('the listing presents a started row with an ended or missing job as failed so the card offers it again', async () => {
    rows.set('r1', { id: 'r1', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'started', transcription_job_id: JOB, job_status: 'expired', lease_expired: false });
    expect((await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0].import).toEqual({ state: 'failed', jobId: JOB, failureCode: 'zoom_import_job_ended' });
    rows.get('r1').job_status = null;
    expect((await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0].import.state).toBe('failed');
    rows.get('r1').job_status = 'ready';
    expect((await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0].import.state).toBe('started');
  });
});

describe('a throw after the job left uploading', () => {
  test('start throws after the job moved to queued: row started, success, and a retry creates no second job', async () => {
    startMeetingTranscription.mockRejectedValue(new Error('post-dispatch read failed'));
    getMeetingTranscriptionJob.mockImplementation(async () => ({ ...rawJob, status: 'queued', version: 3 }));
    const result = await importZoomRecording(args());
    expect(result.import).toEqual({ id: onlyRow().id, state: 'started', failureCode: null });
    expect(result.job.id).toBe(JOB);
    expect(onlyRow()).toMatchObject({ state: 'started', transcription_job_id: JOB });
    expect(store.markZoomImportFailed).not.toHaveBeenCalled();
    const first = onlyRow(); first.job_status = 'queued';
    await importZoomRecording(args());
    expect(uploadMeetingTranscription).toHaveBeenCalledTimes(1);
  });
  test('start throws while the job is still uploading: row failed as before', async () => {
    startMeetingTranscription.mockRejectedValue(Object.assign(new Error('content_unavailable'), { code: 'content_unavailable', status: 410 }));
    getMeetingTranscriptionJob.mockResolvedValue({ ...rawJob, status: 'uploading' });
    expect((await rejection(importZoomRecording(args()))).status).toBe(410);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'content_unavailable' });
  });
  test('start throws and the job turned failed: row failed as before', async () => {
    startMeetingTranscription.mockRejectedValue(Object.assign(new Error('x'), { code: 'start_failed', status: 409 }));
    getMeetingTranscriptionJob.mockResolvedValue({ ...rawJob, status: 'failed' });
    await rejection(importZoomRecording(args()));
    expect(onlyRow().state).toBe('failed');
  });
  test('the job read failing in the catch leaves the row importing and rethrows the original error', async () => {
    startMeetingTranscription.mockRejectedValue(Object.assign(new Error('boom'), { code: 'start_boom', status: 502 }));
    getMeetingTranscriptionJob.mockResolvedValueOnce(rawJob).mockRejectedValueOnce(new Error('db down'));
    const error = await rejection(importZoomRecording(args()));
    expect(error.code).toBe('start_boom');
    expect(onlyRow().state).toBe('importing');
    expect(store.markZoomImportFailed).not.toHaveBeenCalled();
  });
});

describe('a failed import retires its stranded uploading job', () => {
  const ids = { jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 9 };
  test('a download failure after the job was created retires the job and fails the row', async () => {
    downloadRecordingFile.mockRejectedValue(new ZoomClientError('zoom_download_invalid'));
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_download_invalid');
    expect(retireMeetingTranscriptionUploadingJob).toHaveBeenCalledWith(ids);
    expect(onlyRow()).toMatchObject({ state: 'failed', failure_code: 'zoom_download_invalid' });
  });
  test('an upload that threw after creating the job (no id returned) finds the job by idempotency key and retires it', async () => {
    uploadMeetingTranscription.mockRejectedValue(new ServiceHttpError('late failure', { httpStatus: 503, code: 'upload_window_failed' }));
    store.findJobForImport.mockResolvedValue({ id: JOB, status: 'uploading' });
    getMeetingTranscriptionJob.mockResolvedValue({ ...rawJob, status: 'uploading' });
    await rejection(importZoomRecording(args()));
    expect(store.findJobForImport).toHaveBeenCalledWith({ actorProfileId: 9, importId: onlyRow().id });
    expect(retireMeetingTranscriptionUploadingJob).toHaveBeenCalledWith(ids);
    expect(onlyRow().state).toBe('failed');
  });
  test('no job was ever created: nothing to retire and the row is failed', async () => {
    uploadMeetingTranscription.mockRejectedValue(new ServiceHttpError('nope', { httpStatus: 409, code: 'transcription_slot_busy' }));
    store.findJobForImport.mockResolvedValue(null);
    await rejection(importZoomRecording(args()));
    expect(retireMeetingTranscriptionUploadingJob).not.toHaveBeenCalled();
    expect(onlyRow().state).toBe('failed');
  });
  test('when the queue wins the race (retire returns null, job now queued) the row is started and the call succeeds', async () => {
    downloadRecordingFile.mockRejectedValue(new ZoomClientError('zoom_unavailable'));
    retireMeetingTranscriptionUploadingJob.mockResolvedValue(null);
    getMeetingTranscriptionJob.mockResolvedValueOnce(rawJob).mockResolvedValueOnce({ ...rawJob, status: 'uploading' })
      .mockResolvedValue({ ...rawJob, status: 'queued', version: 3 });
    const result = await importZoomRecording(args());
    expect(result.import.state).toBe('started');
    expect(onlyRow()).toMatchObject({ state: 'started', transcription_job_id: JOB });
    expect(store.markZoomImportFailed).not.toHaveBeenCalled();
  });
  test('retire throwing leaves the row importing and rethrows the original error', async () => {
    downloadRecordingFile.mockRejectedValue(new ZoomClientError('zoom_download_invalid'));
    retireMeetingTranscriptionUploadingJob.mockRejectedValue(new Error('db down'));
    expect((await rejection(importZoomRecording(args()))).code).toBe('zoom_download_invalid');
    expect(onlyRow().state).toBe('importing');
    expect(store.markZoomImportFailed).not.toHaveBeenCalled();
  });
  test('a stale lease with an uploading job retires it before failing the row', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue({ id: JOB, status: 'uploading' });
    await importZoomRecording(args());
    expect(retireMeetingTranscriptionUploadingJob).toHaveBeenCalledWith({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 3 });
    expect(rows.get('stale')).toMatchObject({ state: 'failed', failure_code: 'zoom_import_lease_expired' });
  });
  test('a stale lease whose uploading job was queued meanwhile becomes started', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValueOnce({ id: JOB, status: 'uploading' }).mockResolvedValue({ id: JOB, status: 'queued' });
    retireMeetingTranscriptionUploadingJob.mockResolvedValue(null);
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status: 'queued', version: 3 });
    const result = await importZoomRecording(args());
    expect(result.import).toEqual({ id: 'stale', state: 'started', failureCode: null });
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('a stale lease where retire throws stays importing and the error propagates', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue({ id: JOB, status: 'uploading' });
    retireMeetingTranscriptionUploadingJob.mockRejectedValue(new Error('db down'));
    await rejection(importZoomRecording(args()));
    expect(rows.get('stale').state).toBe('importing');
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
});

describe('a cancelled queued job (deletion requested) no longer holds the recording', () => {
  const cancelledRow = () => ({ id: 'old', request_id: REQUEST, zoom_meeting_uuid: UUID, state: 'started', transcription_job_id: JOB,
    job_status: 'queued', job_cleanup_requested: true, lease_expired: false });
  test('the listing reports the import as failed (re-importable), not started', async () => {
    rows.set('old', cancelledRow());
    const meeting = (await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0];
    expect(meeting.import).toEqual({ state: 'failed', jobId: JOB, failureCode: 'zoom_import_job_ended' });
  });
  test('importing again releases the old claim and creates a fresh job and claim', async () => {
    rows.set('old', cancelledRow());
    const result = await importZoomRecording(args());
    expect(uploadMeetingTranscription).toHaveBeenCalledTimes(1);
    expect(rows.get('old')).toMatchObject({ state: 'failed', failure_code: 'zoom_import_job_ended' });
    expect(result.import.id).not.toBe('old');
    expect(result.import.state).toBe('started');
    expect(rows.size).toBe(2);
  });
});

describe.each(['processing', 'saving', 'submission_uncertain'])('cleanup requested on a %s job keeps the import claim', (status) => {
  const row = (over = {}) => ({ id: 'old', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'started',
    transcription_job_id: JOB, job_status: status, job_cleanup_requested: true, lease_expired: false, ...over });
  test('the listing still reports the import as started', async () => {
    rows.set('old', row());
    const meeting = (await listZoomRecordingsForVisit({ requestId: REQUEST })).meetings[0];
    expect(meeting.import).toEqual({ state: 'started', jobId: JOB, failureCode: null });
  });
  test('importing again returns the existing claim: no release, no new row or job', async () => {
    rows.set('old', row());
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status, version: 3 });
    const result = await importZoomRecording(args());
    expect(result.import).toEqual({ id: 'old', state: 'started', failureCode: null });
    expect(rows.get('old').state).toBe('started');
    expect(rows.size).toBe(1);
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('an expired lease whose job has cleanup requested is taken over as started', async () => {
    rows.set('stale', { id: 'stale', request_id: REQUEST, actor_profile_id: 3, zoom_meeting_uuid: UUID, state: 'importing', lease_expired: true, lease_token: 'old' });
    store.findJobForImport.mockResolvedValue({ id: JOB, status, cleanup_requested_at: new Date() });
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status, version: 3 });
    const result = await importZoomRecording(args());
    expect(result.import).toEqual({ id: 'stale', state: 'started', failureCode: null });
    expect(rows.size).toBe(1);
    expect(uploadMeetingTranscription).not.toHaveBeenCalled();
  });
  test('error recovery keeps the claim started when the job has cleanup requested', async () => {
    startMeetingTranscription.mockRejectedValue(Object.assign(new Error('boom'), { code: 'content_unavailable', status: 410 }));
    getMeetingTranscriptionJob.mockResolvedValue({ id: JOB, status, version: 3, cleanup_requested_at: new Date() });
    const result = await importZoomRecording(args());
    expect(result.import.state).toBe('started');
    expect(onlyRow()).toMatchObject({ state: 'started', transcription_job_id: JOB });
  });
});
