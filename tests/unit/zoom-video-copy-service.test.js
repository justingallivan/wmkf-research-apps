/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/policy.js', () => ({ requireMeetingTranscriptionEnabled: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/binding.js', () => ({ loadMeetingTranscriptionBinding: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({ uploadMeetingTranscription: jest.fn(), startMeetingTranscription: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  MAX_TRANSCRIPTION_BYTES: 200 * 1024 * 1024, MAX_ZOOM_TRANSCRIPT_BYTES: 4_000_000, projectMeetingTranscriptionJob: jest.fn(), writePrivateContent: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => ({ getMeetingTranscriptionJob: jest.fn(), retireMeetingTranscriptionUploadingJob: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-recordings/import-store.js', () => ({
  ...jest.requireActual('../../lib/services/meeting-tracker-recordings/import-store.js'),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/zoom-client.js', () => ({
  ...jest.requireActual('../../lib/services/meeting-tracker-recordings/zoom-client.js'),
  listHostRecordings: jest.fn(), getMeetingRecordings: jest.fn(), downloadRecordingFile: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/video-copy-store.js', () => ({
  startZoomVideoCopy: jest.fn(), listFailedZoomVideoCopiesForFile: jest.fn(), findCopiedZoomVideoCopyForFile: jest.fn(),
  listZoomVideoCopySnapshotsForRequest: jest.fn(), requestZoomVideoCopyCancel: jest.fn(),
  zoomRecordingTimes: (file) => jest.requireActual('../../lib/services/meeting-tracker-recordings/video-copy-store.js').zoomRecordingTimes(file),
}));
jest.mock('../../lib/services/post-presentation-materials/material-service.js', () => {
  const { ServiceHttpError } = jest.requireActual('../../lib/services/service-http-error.js');
  const error = (message, code, httpStatus = 409) => new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
  return {
    POST_PRESENTATION_MATERIALS_DEPENDENCIES: {
      schemaReady: jest.fn(), requestAllowed: jest.fn(), findDocuments: jest.fn(), getSharePointBuckets: jest.fn(), ensureFolderPath: jest.fn(),
    },
    activeBucket: jest.fn(buckets => buckets[0] || null),
    loadBoundContext: jest.fn(),
    materialError: error,
    _internal: { assertFeature: jest.fn(), TERMINAL_MP4_VALIDATION_CODES: [], resolveStableMp4Path: jest.fn(), validateRecoveredMp4Row: jest.fn() },
  };
});

import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { listHostRecordings, getMeetingRecordings } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import * as store from '../../lib/services/meeting-tracker-recordings/video-copy-store.js';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES as deps, activeBucket, loadBoundContext, _internal,
} from '../../lib/services/post-presentation-materials/material-service.js';
import { getZoomVideoCopies, startZoomVideoCopy, cancelZoomVideoCopy, zoomVideoCopyDto } from '../../lib/services/meeting-tracker-recordings/video-copy-service.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const WINNER = '33333333-3333-4333-8333-333333333333';
const COPY = '44444444-4444-4444-8444-444444444444';
const UUID = 'abc/def==';
const HOST_ID = 'zoomhost123';
const HOST_EMAIL = 'wmk-library@wmkeck.org';
const START = '2026-10-05T17:00:00Z';
const ENV_KEYS = ['ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET', 'ZOOM_RECORDING_HOSTS', 'ZOOM_VIDEO_COPY_ACCESS'];
const PLAIN = 'shared_screen_with_speaker_view';
const video = (over = {}) => ({ id: 'mp4-id', status: 'completed', file_extension: 'MP4', recording_type: PLAIN, file_size: 1000,
  recording_start: START, download_url: 'https://us02web.zoom.us/rec/download/SECRET', ...over });
const meeting = (files, over = {}) => ({ uuid: UUID, host_id: HOST_ID, topic: 'SECRET TOPIC', start_time: START, duration: 62, recording_files: files, ...over });
const sharepointWinner = (over = {}) => ({
  wmkf_requestdocumentid: WINNER, _wmkf_request_value: REQUEST, wmkf_artifacttype: 100000005, wmkf_operationstatus: 100000001,
  wmkf_lifecyclestate: 100000000, wmkf_sharepointdriveid: 'd', wmkf_sharepointitemid: 'i', wmkf_filename: 'Staff upload.mp4',
  wmkf_filesize: 555, wmkf_slotversion: 4, createdon: '2026-10-01T00:00:00Z', ...over,
});
const zoomLinkWinner = () => ({ wmkf_requestdocumentid: WINNER, _wmkf_request_value: REQUEST, wmkf_artifacttype: 100000005,
  wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000, wmkf_externalurl: 'https://us02web.zoom.us/rec/share/abc', wmkf_slotversion: 2 });
const args = (over = {}) => ({ requestId: REQUEST, actorProfileId: 9, actingUserSystemId: ACTOR, meetingUuid: UUID, replaces: null, ...over });
async function rejection(promise) { try { await promise; } catch (error) { return error; } throw new Error('expected rejection'); }


// Worker-side inspection seams for Try again. The default seams would reach Postgres and Dataverse.
function inspectionDeps({ records = [], over = {} } = {}) {
  return {
    now: () => Date.now(),
    log: jest.fn(),
    recordEvent: jest.fn(async () => {}),
    claimInspection: jest.fn(async ({ uploadId }) => ({
      row: { id: uploadId, request_id: REQUEST, generation_key: 'gen-key', state: 'uploaded', candidate_item_id: 'item1', client_resume_fingerprint: 'fp' },
      leaseToken: 'INSPECT',
    })),
    renewInspection: jest.fn(async () => ({})),
    releaseInspection: jest.fn(async () => ({})),
    bindReceipt: jest.fn(async () => ({ bound: true })),
    markCopied: jest.fn(async ({ id }) => ({ id })),
    recordReceiptConflict: jest.fn(async () => ({})),
    materialDependencies: { findDocumentByGenerationKey: jest.fn(async () => ({ records })) },
    ...over,
  };
}
const FAILED_UPLOADED = { id: COPY, updated_key: 'k', intent_state: 'uploaded', intent_lease_live: false };

let saved;
beforeEach(() => {
  jest.resetAllMocks();
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  Object.assign(process.env, { ZOOM_S2S_ACCOUNT_ID: 'a', ZOOM_S2S_CLIENT_ID: 'c', ZOOM_S2S_CLIENT_SECRET: 's',
    ZOOM_RECORDING_HOSTS: 'Wmk-Library@wmkeck.org', ZOOM_VIDEO_COPY_ACCESS: 'on' });
  deps.schemaReady.mockReturnValue(true);
  deps.requestAllowed.mockReturnValue(true);
  deps.findDocuments.mockResolvedValue({ records: [] });
  deps.getSharePointBuckets.mockResolvedValue([{ source: 'dynamics', library: 'akoya_request', folder: 'akoya_request/R-1/' }]);
  deps.ensureFolderPath.mockResolvedValue({});
  _internal.assertFeature.mockImplementation(() => {});
  activeBucket.mockImplementation(buckets => buckets[0] || null);
  loadBoundContext.mockResolvedValue({ request: { akoya_requestid: REQUEST, akoya_requestnum: '1001234' }, siteVisit: { activityid: VISIT }, cycleCode: 'J26' });
  listHostRecordings.mockResolvedValue([meeting([video()])]);
  getMeetingRecordings.mockResolvedValue(meeting([video()]));
  store.findCopiedZoomVideoCopyForFile.mockResolvedValue(null);
  store.listFailedZoomVideoCopiesForFile.mockResolvedValue([]);
  store.startZoomVideoCopy.mockResolvedValue({ status: 'started', copy: { id: COPY, lease_token: 'LEASE' }, intent: {} });
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('startZoomVideoCopy: success', () => {
  test('re-lists server side, picks the file itself and writes N1 with server-derived values (202 queued)', async () => {
    const result = await startZoomVideoCopy(args());
    expect(result).toEqual({ status: 202, body: { copy: { id: COPY, state: 'queued' } } });
    expect(store.startZoomVideoCopy).toHaveBeenCalledWith({
      requestId: REQUEST, requestNum: '1001234', siteVisitActivityId: VISIT, actorProfileId: 9, actorSystemId: ACTOR,
      zoomMeetingUuid: UUID, zoomHostId: HOST_ID, zoomHostEmail: HOST_EMAIL, zoomMeetingStart: '2026-10-05T17:00:00.000Z',
      zoomFileId: 'mp4-id', zoomRecordingType: PLAIN, declaredSize: 1000, originalDisplayFilename: 'Zoom video Oct 5, 2026 10.00 AM PT.mp4',
      libraryName: 'akoya_request', folderPath: 'akoya_request/R-1/Post Site Visit Materials',
      confirmedWinnerDocumentId: null, confirmedWinnerSlotVersion: null, recordingStart: null, recordingEnd: null, failedSnapshot: [],
    });
    expect(deps.ensureFolderPath).toHaveBeenCalledWith('akoya_request', 'akoya_request/R-1/Post Site Visit Materials');
    expect(JSON.stringify(result)).not.toMatch(/LEASE|SECRET|mp4-id/);
  });
  test('Stage 4 decision 16: writes the picked file\'s recording_start/recording_end to N1', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video({ recording_end: '2026-10-05T18:02:00Z' })]));
    await startZoomVideoCopy(args());
    expect(store.startZoomVideoCopy).toHaveBeenCalledWith(expect.objectContaining({
      recordingStart: '2026-10-05T17:00:00.000Z', recordingEnd: '2026-10-05T18:02:00.000Z',
    }));
  });
  test('passes the Try-again snapshot verbatim to N1', async () => {
    const snapshot = [{ id: 'old', updated_key: 'k', intent_state: 'failed', intent_lease_live: false }];
    store.listFailedZoomVideoCopiesForFile.mockResolvedValue(snapshot);
    await startZoomVideoCopy(args(), { ...deps, zoomCopyWorkerDependencies: inspectionDeps({ records: [] }) });
    expect(store.listFailedZoomVideoCopiesForFile).toHaveBeenCalledWith({ requestId: REQUEST, zoomFileId: 'mp4-id' });
    expect(store.startZoomVideoCopy.mock.calls[0][0].failedSnapshot).toBe(snapshot);
  });
  test('the CC file is used when it is the only completed variant', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video({ id: 'cc-id', recording_type: `${PLAIN}(CC)` })]));
    await startZoomVideoCopy(args());
    expect(store.startZoomVideoCopy.mock.calls[0][0]).toMatchObject({ zoomFileId: 'cc-id', zoomRecordingType: `${PLAIN}(CC)` });
  });
  test('does not require the transcription flag (no transcription module is consulted)', async () => {
    await startZoomVideoCopy(args());
    expect(jest.requireMock('../../lib/services/meeting-tracker-transcription/policy.js').requireMeetingTranscriptionEnabled).not.toHaveBeenCalled();
  });
});

describe('startZoomVideoCopy: Try again inspects the prior registration before N1', () => {
  const withWorker = (workerDeps) => ({ ...deps, zoomCopyWorkerDependencies: workerDeps });
  const registered = { wmkf_requestdocumentid: WINNER };
  beforeEach(() => {
    _internal.resolveStableMp4Path.mockResolvedValue({ state: 'complete', candidate: { itemId: 'item1' } });
    _internal.validateRecoveredMp4Row.mockReturnValue(true);
    store.listFailedZoomVideoCopiesForFile.mockResolvedValue([FAILED_UPLOADED]);
  });

  test('a failed copy whose registration already exists is bound and replayed; N1 never runs', async () => {
    const w = inspectionDeps({ records: [registered] });
    const result = await startZoomVideoCopy(args(), withWorker(w));
    expect(result).toEqual({ status: 200, body: { copy: { id: COPY, state: 'copied' }, replayed: true } });
    expect(w.materialDependencies.findDocumentByGenerationKey).toHaveBeenCalledWith('gen-key');
    expect(w.bindReceipt).toHaveBeenCalledWith(expect.objectContaining({ copyId: COPY, verified: expect.objectContaining({ requestDocumentId: WINNER }) }));
    expect(w.markCopied).toHaveBeenCalledWith({ id: COPY, leaseToken: null });
    expect(w.releaseInspection).toHaveBeenCalled();
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });

  test.each([
    ['the registration read fails', { materialDependencies: { findDocumentByGenerationKey: jest.fn(async () => { throw new Error('dataverse down'); }) } }],
    ['the intent lease is busy', { claimInspection: jest.fn(async () => null) }],
    ['the registration is ambiguous', { materialDependencies: { findDocumentByGenerationKey: jest.fn(async () => ({ records: [registered, registered] })) } }],
    ['the bind is refused', { bindReceipt: jest.fn(async () => ({ bound: false, reason: 'stale' })) }],
    ['the receipt repair throws', { markCopied: jest.fn(async () => { throw new Error('pg down'); }) }],
  ])('%s: 409 reconciliation pending and N1 never runs', async (_label, over) => {
    const records = over.bindReceipt || over.markCopied ? [registered] : [];
    const error = await rejection(startZoomVideoCopy(args(), withWorker(inspectionDeps({ records, over }))));
    expect(error).toMatchObject({ httpStatus: 409, code: 'zoom_video_reconciliation_pending' });
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });

  test('proven absence proceeds to N1 with exactly the snapshot that was inspected (read once, before inspection)', async () => {
    const snapshot = [FAILED_UPLOADED];
    store.listFailedZoomVideoCopiesForFile.mockResolvedValueOnce(snapshot);
    const w = inspectionDeps({ records: [] });
    const result = await startZoomVideoCopy(args(), withWorker(w));
    expect(result.status).toBe(202);
    expect(w.releaseInspection).toHaveBeenCalled();
    expect(store.listFailedZoomVideoCopiesForFile).toHaveBeenCalledTimes(1);
    expect(store.startZoomVideoCopy.mock.calls[0][0].failedSnapshot).toBe(snapshot);
  });

  test('a copy that fails after inspection is not admitted: N1 sees an unseen row and the start is pending (Codex round 3)', async () => {
    // Inspection sees no failed rows; a concurrent worker then fails a registering copy. The snapshot handed to N1 is
    // the inspected (empty) one, so N1's locked recheck finds an unseen failed row and refuses.
    store.listFailedZoomVideoCopiesForFile.mockResolvedValueOnce([]).mockResolvedValue([FAILED_UPLOADED]);
    store.startZoomVideoCopy.mockImplementation(async ({ failedSnapshot }) => (
      failedSnapshot.length === 0 ? { status: 'reconciliation_pending', copy: null } : { status: 'started', copy: { id: COPY } }));
    const w = inspectionDeps({ records: [] });
    await expect(startZoomVideoCopy(args(), withWorker(w))).rejects.toMatchObject({ code: 'zoom_video_reconciliation_pending' });
    expect(store.startZoomVideoCopy.mock.calls[0][0].failedSnapshot).toEqual([]);
  });

  test('a failed copy whose intent is already finalized is repaired through N5 and replayed without an inspection', async () => {
    store.listFailedZoomVideoCopiesForFile.mockResolvedValue([{ ...FAILED_UPLOADED, intent_state: 'finalized' }]);
    const w = inspectionDeps();
    const result = await startZoomVideoCopy(args(), withWorker(w));
    expect(result).toEqual({ status: 200, body: { copy: { id: COPY, state: 'copied' }, replayed: true } });
    expect(w.markCopied).toHaveBeenCalledWith({ id: COPY, leaseToken: null });
    expect(w.claimInspection).not.toHaveBeenCalled();
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });

  test('a receipt uniqueness conflict on repair is recorded and blocks N1', async () => {
    const conflict = Object.assign(new Error('conflict'), { code: 'zoom_video_receipt_conflict' });
    store.listFailedZoomVideoCopiesForFile.mockResolvedValue([{ ...FAILED_UPLOADED, intent_state: 'finalized' }]);
    const w = inspectionDeps({ over: { markCopied: jest.fn(async () => { throw conflict; }) } });
    const error = await rejection(startZoomVideoCopy(args(), withWorker(w)));
    expect(error).toMatchObject({ httpStatus: 409, code: 'zoom_video_reconciliation_pending' });
    expect(w.recordReceiptConflict).toHaveBeenCalledWith({ id: COPY });
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });

  test('an abandoned intent is settled and not inspected', async () => {
    store.listFailedZoomVideoCopiesForFile.mockResolvedValue([{ ...FAILED_UPLOADED, intent_state: 'abandoned' }]);
    const w = inspectionDeps();
    expect((await startZoomVideoCopy(args(), withWorker(w))).status).toBe(202);
    expect(w.claimInspection).not.toHaveBeenCalled();
  });
});

describe('startZoomVideoCopy: outcomes', () => {
  test('N1 replayed is 200 copied', async () => {
    store.startZoomVideoCopy.mockResolvedValue({ status: 'replayed', copy: { id: COPY } });
    expect(await startZoomVideoCopy(args())).toEqual({ status: 200, body: { copy: { id: COPY, state: 'copied' }, replayed: true } });
  });
  test.each([
    ['active', 'zoom_video_copy_active'],
    ['reconciliation_pending', 'zoom_video_reconciliation_pending'],
    ['in_progress', 'zoom_video_copy_in_progress'],
  ])('N1 %s is 409 %s', async (outcome, code) => {
    store.startZoomVideoCopy.mockResolvedValue({ status: outcome, copy: null });
    const error = await rejection(startZoomVideoCopy(args()));
    expect(error).toBeInstanceOf(ServiceHttpError);
    expect([error.httpStatus, error.code]).toEqual([409, code]);
  });
  test('an unknown N1 outcome fails closed', async () => {
    store.startZoomVideoCopy.mockResolvedValue({ status: 'weird' });
    expect((await rejection(startZoomVideoCopy(args()))).httpStatus).toBe(500);
  });
});

describe('startZoomVideoCopy: access gates', () => {
  test.each([['unset', undefined], ['off', 'off'], ['malformed', 'maybe'], ['test for another request', 'test:99999999-9999-4999-8999-999999999999']])(
    'kill switch %s is refused before any I/O', async (_l, value) => {
      if (value === undefined) delete process.env.ZOOM_VIDEO_COPY_ACCESS; else process.env.ZOOM_VIDEO_COPY_ACCESS = value;
      const error = await rejection(startZoomVideoCopy(args()));
      expect([error.httpStatus, error.code]).toEqual([404, 'zoom_video_copy_not_available']);
      expect(listHostRecordings).not.toHaveBeenCalled();
      expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
    });
  test('test:<this request> is allowed', async () => {
    process.env.ZOOM_VIDEO_COPY_ACCESS = `test:${REQUEST}`;
    expect((await startZoomVideoCopy(args())).status).toBe(202);
  });
  test('post-presentation feature refusal (assertFeature) stops before Zoom', async () => {
    _internal.assertFeature.mockImplementation(() => { throw new ServiceHttpError('nope', { httpStatus: 404, code: 'post_presentation_not_available' }); });
    expect((await rejection(startZoomVideoCopy(args()))).code).toBe('post_presentation_not_available');
    expect(listHostRecordings).not.toHaveBeenCalled();
  });
  test('missing Zoom config is 503 before any Zoom call', async () => {
    delete process.env.ZOOM_S2S_CLIENT_SECRET;
    const error = await rejection(startZoomVideoCopy(args()));
    expect([error.httpStatus, error.code]).toEqual([503, 'zoom_import_unavailable']);
    expect(listHostRecordings).not.toHaveBeenCalled();
  });
  test('Site Visit binding failure stops before Zoom', async () => {
    loadBoundContext.mockRejectedValue(new ServiceHttpError('x', { httpStatus: 409, code: 'post_presentation_site_visit_required' }));
    expect((await rejection(startZoomVideoCopy(args()))).code).toBe('post_presentation_site_visit_required');
    expect(listHostRecordings).not.toHaveBeenCalled();
  });
  test.each([
    ['bad request id', { requestId: 'nope' }, 400],
    ['empty meeting uuid', { meetingUuid: '' }, 400],
    ['control char in uuid', { meetingUuid: 'a\nb' }, 400],
    ['replaces with an extra key', { replaces: { artifactId: WINNER, slotVersion: 1, x: 1 } }, 400],
    ['replaces with a bad GUID', { replaces: { artifactId: 'nope', slotVersion: 1 } }, 400],
    ['replaces with slotVersion 0', { replaces: { artifactId: WINNER, slotVersion: 0 } }, 400],
    ['no profile', { actorProfileId: null }, 401],
    ['no Dataverse actor', { actingUserSystemId: '' }, 403],
  ])('%s is rejected before I/O', async (_l, over, status) => {
    expect((await rejection(startZoomVideoCopy(args(over)))).httpStatus).toBe(status);
    expect(listHostRecordings).not.toHaveBeenCalled();
  });
});

describe('startZoomVideoCopy: Zoom verification', () => {
  test('a meeting that is not in the approved hosts\' listing is 404 with no detail call', async () => {
    listHostRecordings.mockResolvedValue([meeting([video()], { uuid: 'other' })]);
    expect((await rejection(startZoomVideoCopy(args()))).code).toBe('zoom_meeting_not_found');
    expect(getMeetingRecordings).not.toHaveBeenCalled();
  });
  test('a detail host_id that differs from the listing is 403', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video()], { host_id: 'someone-else' }));
    const error = await rejection(startZoomVideoCopy(args()));
    expect([error.httpStatus, error.code]).toEqual([403, 'zoom_host_not_approved']);
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });
  test('no eligible MP4 is 422 zoom_video_missing', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video({ recording_type: 'gallery_view' })]));
    expect((await rejection(startZoomVideoCopy(args()))).code).toBe('zoom_video_missing');
  });
  test('over 2,000,000,000 bytes is 422 zoom_video_too_large; exactly 2,000,000,000 is allowed', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video({ file_size: 2_000_000_001 })]));
    const error = await rejection(startZoomVideoCopy(args()));
    expect([error.httpStatus, error.code]).toEqual([422, 'zoom_video_too_large']);
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
    getMeetingRecordings.mockResolvedValue(meeting([video({ file_size: 2_000_000_000 })]));
    expect((await startZoomVideoCopy(args())).status).toBe(202);
  });
  test('two completed MP4s of the chosen type is 422 zoom_video_segmented and nothing is written', async () => {
    getMeetingRecordings.mockResolvedValue(meeting([video(), video({ id: 'mp4-2' })]));
    const error = await rejection(startZoomVideoCopy(args()));
    expect([error.httpStatus, error.code]).toEqual([422, 'zoom_video_segmented']);
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
    expect(deps.ensureFolderPath).not.toHaveBeenCalled();
  });
  test('client file metadata is ignored: only the meeting id and replaces reach the service result', async () => {
    await startZoomVideoCopy({ ...args(), fileId: 'evil', fileSize: 1, downloadUrl: 'https://evil.example' });
    expect(store.startZoomVideoCopy.mock.calls[0][0]).toMatchObject({ zoomFileId: 'mp4-id', declaredSize: 1000 });
  });
});

describe('startZoomVideoCopy: decision 8 confirmation', () => {
  const replaces = (over = {}) => ({ artifactId: WINNER, slotVersion: 4, ...over });
  test('a SharePoint winner with replaces null is 409 confirmation required and names the winner', async () => {
    deps.findDocuments.mockResolvedValue({ records: [sharepointWinner()] });
    const error = await rejection(startZoomVideoCopy(args()));
    expect([error.httpStatus, error.code]).toEqual([409, 'zoom_video_replace_confirmation_required']);
    expect(error.body.winner).toEqual({ artifactId: WINNER, slotVersion: 4, filename: 'Staff upload.mp4', size: 555 });
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
    expect(deps.ensureFolderPath).not.toHaveBeenCalled();
  });
  test('matching replaces proceeds and stores the confirmed winner id and slot version', async () => {
    deps.findDocuments.mockResolvedValue({ records: [sharepointWinner()] });
    expect((await startZoomVideoCopy(args({ replaces: replaces({ artifactId: WINNER.toUpperCase() }) }))).status).toBe(202);
    expect(store.startZoomVideoCopy.mock.calls[0][0]).toMatchObject({ confirmedWinnerDocumentId: WINNER, confirmedWinnerSlotVersion: 4 });
  });
  test.each([
    ['a different slot version', replaces({ slotVersion: 3 })],
    ['a different artifact', replaces({ artifactId: '55555555-5555-4555-8555-555555555555' })],
  ])('stale replaces (%s) is 409 zoom_video_replace_stale', async (_l, stale) => {
    deps.findDocuments.mockResolvedValue({ records: [sharepointWinner()] });
    const error = await rejection(startZoomVideoCopy(args({ replaces: stale })));
    expect([error.httpStatus, error.code]).toEqual([409, 'zoom_video_replace_stale']);
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });
  test('an unversioned SharePoint winner is 409 zoom_video_winner_unversioned, with or without replaces', async () => {
    deps.findDocuments.mockResolvedValue({ records: [sharepointWinner({ wmkf_slotversion: null })] });
    for (const r of [null, replaces()]) {
      const error = await rejection(startZoomVideoCopy(args({ replaces: r })));
      expect([error.httpStatus, error.code]).toEqual([409, 'zoom_video_winner_unversioned']);
    }
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });
  test('no winner or a Zoom-link winner: replaces null proceeds with no confirmed winner; a claimed replaces is stale', async () => {
    for (const records of [[], [zoomLinkWinner()]]) {
      deps.findDocuments.mockResolvedValue({ records });
      store.startZoomVideoCopy.mockClear();
      expect((await startZoomVideoCopy(args())).status).toBe(202);
      expect(store.startZoomVideoCopy.mock.calls[0][0]).toMatchObject({ confirmedWinnerDocumentId: null, confirmedWinnerSlotVersion: null });
      expect((await rejection(startZoomVideoCopy(args({ replaces: replaces() })))).code).toBe('zoom_video_replace_stale');
    }
  });
  test('a copied-file replay comes before the confirmation check (the Recording winner is never read)', async () => {
    deps.findDocuments.mockResolvedValue({ records: [sharepointWinner()] });
    store.findCopiedZoomVideoCopyForFile.mockResolvedValue({ id: COPY, state: 'copied' });
    expect(await startZoomVideoCopy(args())).toEqual({ status: 200, body: { copy: { id: COPY, state: 'copied' }, replayed: true } });
    expect(store.findCopiedZoomVideoCopyForFile).toHaveBeenCalledWith({ requestId: REQUEST, zoomFileId: 'mp4-id' });
    expect(deps.findDocuments).not.toHaveBeenCalled();
    expect(store.startZoomVideoCopy).not.toHaveBeenCalled();
  });
});

describe('getZoomVideoCopies', () => {
  const row = (over = {}) => ({ id: COPY, zoom_meeting_uuid: UUID, state: 'copying', bytes_confirmed: '5242880', declared_size: '104857600',
    failure_code: null, cancel_requested_at: null, created_at: 'c', updated_at: 'u', completed_at: null,
    lease_token: 'LEASE', zoom_host_email_sha256: 'HASH', zoom_file_id: 'mp4-id', intent_has_ciphertext: true, sharepoint_drive_id: 'd', ...over });
  test('returns sanitized snapshots from Postgres only and makes no Zoom call', async () => {
    store.listZoomVideoCopySnapshotsForRequest.mockResolvedValue([row(), row({ id: 'x', state: 'failed', failure_code: 'zoom_range_unsupported', cancel_requested_at: 't' })]);
    const result = await getZoomVideoCopies({ requestId: REQUEST });
    expect(result).toEqual({ available: true, copies: [
      { id: COPY, meetingUuid: UUID, state: 'copying', bytesConfirmed: 5242880, declaredSize: 104857600, failureCode: null, cancelRequested: false,
        createdAt: 'c', updatedAt: 'u', completedAt: null },
      { id: 'x', meetingUuid: UUID, state: 'failed', bytesConfirmed: 5242880, declaredSize: 104857600, failureCode: 'zoom_range_unsupported',
        cancelRequested: true, createdAt: 'c', updatedAt: 'u', completedAt: null }] });
    expect(JSON.stringify(result)).not.toMatch(/LEASE|HASH|mp4-id|ciphertext|drive/i);
    expect(listHostRecordings).not.toHaveBeenCalled();
    expect(getMeetingRecordings).not.toHaveBeenCalled();
  });
  test('available is false when Zoom config is missing but copies are still listed', async () => {
    delete process.env.ZOOM_S2S_ACCOUNT_ID;
    store.listZoomVideoCopySnapshotsForRequest.mockResolvedValue([row()]);
    const result = await getZoomVideoCopies({ requestId: REQUEST });
    expect(result.available).toBe(false);
    expect(result.copies).toHaveLength(1);
  });
  test.each([['kill switch off', () => { process.env.ZOOM_VIDEO_COPY_ACCESS = 'off'; }],
    ['test for another request', () => { process.env.ZOOM_VIDEO_COPY_ACCESS = 'test:99999999-9999-4999-8999-999999999999'; }],
    ['feature schema not ready', () => deps.schemaReady.mockReturnValue(false)],
    ['feature not allowed for the request', () => deps.requestAllowed.mockReturnValue(false)],
  ])('%s: unavailable and nothing is read', async (_l, arrange) => {
    arrange();
    expect(await getZoomVideoCopies({ requestId: REQUEST })).toEqual({ available: false, copies: [] });
    expect(store.listZoomVideoCopySnapshotsForRequest).not.toHaveBeenCalled();
  });
  test('the dto never spreads the row', () => { expect(Object.keys(zoomVideoCopyDto(row())).sort()).toEqual(
    ['bytesConfirmed', 'cancelRequested', 'completedAt', 'createdAt', 'declaredSize', 'failureCode', 'id', 'meetingUuid', 'state', 'updatedAt']); });
});

describe('cancelZoomVideoCopy', () => {
  const full = (over = {}) => ({ id: COPY, zoom_meeting_uuid: UUID, state: 'queued', bytes_confirmed: 0, declared_size: 10, failure_code: null,
    cancel_requested_at: 't', lease_token: 'LEASE', ...over });
  test('requested is 202 with a sanitized copy, and N6 is scoped by request and copy id', async () => {
    store.requestZoomVideoCopyCancel.mockResolvedValue({ outcome: 'requested', row: full() });
    const result = await cancelZoomVideoCopy({ requestId: REQUEST, copyId: COPY });
    expect(store.requestZoomVideoCopyCancel).toHaveBeenCalledWith({ id: COPY, requestId: REQUEST });
    expect(result.status).toBe(202);
    expect(result.body.copy).toMatchObject({ id: COPY, cancelRequested: true });
    expect(JSON.stringify(result)).not.toContain('LEASE');
  });
  test('a terminal row is 200 as is; registering is 409 saving; an unknown id is 404', async () => {
    store.requestZoomVideoCopyCancel.mockResolvedValueOnce({ outcome: 'terminal', row: full({ state: 'copied' }) });
    expect(await cancelZoomVideoCopy({ requestId: REQUEST, copyId: COPY })).toMatchObject({ status: 200, body: { copy: { state: 'copied' } } });
    store.requestZoomVideoCopyCancel.mockResolvedValueOnce({ outcome: 'saving', row: full({ state: 'registering' }) });
    expect((await rejection(cancelZoomVideoCopy({ requestId: REQUEST, copyId: COPY }))).code).toBe('zoom_video_copy_saving');
    store.requestZoomVideoCopyCancel.mockResolvedValueOnce({ outcome: 'not_found', row: null });
    expect((await rejection(cancelZoomVideoCopy({ requestId: REQUEST, copyId: COPY }))).httpStatus).toBe(404);
  });
  test('does not read the kill switch (cancel only stops work)', async () => {
    process.env.ZOOM_VIDEO_COPY_ACCESS = 'off';
    store.requestZoomVideoCopyCancel.mockResolvedValue({ outcome: 'requested', row: full() });
    expect((await cancelZoomVideoCopy({ requestId: REQUEST, copyId: COPY })).status).toBe(202);
  });
  test.each([['non-GUID', 'nope'], ['padded', ` ${COPY}`], ['missing', undefined]])('%s copyId is 400 before any query', async (_l, copyId) => {
    expect((await rejection(cancelZoomVideoCopy({ requestId: REQUEST, copyId }))).httpStatus).toBe(400);
    expect(store.requestZoomVideoCopyCancel).not.toHaveBeenCalled();
  });
});
