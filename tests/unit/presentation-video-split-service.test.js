/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({ resolveCurrentMeetingTranscriptSource: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-split-store.js', () => ({
  startPresentationVideoSplit: jest.fn(), findCopiedZoomVideoCopyForDocument: jest.fn(), listPresentationVideoSplitSnapshotsForRequest: jest.fn(),
  findAbandonedRegisteringPresentationVideoSplit: jest.fn(), claimPresentationVideoApproval: jest.fn(),
  markPresentationVideoApprovalAttempted: jest.fn(), releasePresentationVideoApproval: jest.fn(),
  yieldPresentationVideoApproval: jest.fn(), settleStalePresentationVideoApproval: jest.fn(),
}));
jest.mock('../../lib/services/post-presentation-materials/material-service.js', () => ({
  POST_PRESENTATION_MATERIALS_DEPENDENCIES: { findDocuments: jest.fn(), findDocumentByGenerationKey: jest.fn(), updateDocument: jest.fn() },
  loadBoundContext: jest.fn(),
  _internal: { assertFeature: jest.fn() },
}));

import { resolveCurrentMeetingTranscriptSource } from '../../lib/services/meeting-tracker-transcription/service.js';
import * as store from '../../lib/services/meeting-tracker-recordings/presentation-video-split-store.js';
import { POST_PRESENTATION_MATERIALS_DEPENDENCIES as deps, loadBoundContext, _internal } from '../../lib/services/post-presentation-materials/material-service.js';
import { getPresentationVideoSplits, startPresentationVideoSplit, presentationVideoSplitDto } from '../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const WINNER = '33333333-3333-4333-8333-333333333333';
const COPY = '44444444-4444-4444-8444-444444444444';
const REV = '55555555-5555-4555-8555-555555555555';
const SPLIT = '66666666-6666-4666-8666-666666666666';
const MEETING = 'abc/def==';
const REC_START = '2026-10-05T17:00:00.000Z';
const REC_END = '2026-10-05T18:02:00.000Z';
const args = (over = {}) => ({ requestId: REQUEST, actorProfileId: 9, actingUserSystemId: ACTOR, ...over });
async function rejection(promise) { try { await promise; } catch (error) { return error; } throw new Error('expected rejection'); }

const provenance = (over = {}) => ({
  version: 1, sourceId: REV, kind: 'zoom', audioSha256: 'a'.repeat(64), audioBytes: 5, audioDurationMs: 3000000,
  zoom: { importId: REV, meetingUuid: MEETING, hostId: 'h', audioOnlyFileCount: 1,
    audioFile: { fileId: 'f', recordingType: 'audio_only', bytes: 5, recordingStart: REC_START, recordingEnd: REC_END, sha256: 'a'.repeat(64) },
    transcriptFile: null, ...over },
});
const resolved = (over = {}) => ({ status: 'verified_zoom', provenance: provenance(), revisionId: REV, fingerprint: 'f'.repeat(64),
  presentationEnd: { endMs: 1_800_000, confirmedBy: 9, confirmedAt: '2026-10-09T10:00:00.000Z' }, ...over });
const winnerRow = (over = {}) => ({
  wmkf_requestdocumentid: WINNER, _wmkf_request_value: REQUEST, wmkf_artifacttype: 100000005, wmkf_operationstatus: 100000001,
  wmkf_lifecyclestate: 100000000, wmkf_sharepointdriveid: 'Drive', wmkf_sharepointitemid: 'Item', wmkf_sharepointversionid: '4.0',
  wmkf_sharepointetag: 'etag-1', wmkf_filename: 'v.mp4', wmkf_filesize: 555, wmkf_slotversion: 4, createdon: '2026-10-01T00:00:00Z', ...over,
});
const copyRow = (over = {}) => ({ id: COPY, zoom_meeting_uuid: MEETING, recording_start: new Date(REC_START), recording_end: new Date(REC_END),
  sharepoint_drive_id: 'drive', sharepoint_item_id: 'item', sharepoint_quickxor_hash: 'qx', declared_size: '555', ...over });

let saved;
beforeEach(() => {
  jest.resetAllMocks();
  saved = process.env.PRESENTATION_VIDEO_SPLIT_ACCESS;
  process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = 'on';
  _internal.assertFeature.mockImplementation(() => {});
  loadBoundContext.mockResolvedValue({ request: {}, siteVisit: { activityid: VISIT } });
  resolveCurrentMeetingTranscriptSource.mockResolvedValue(resolved());
  deps.findDocuments.mockResolvedValue({ records: [winnerRow()] });
  store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow());
  store.startPresentationVideoSplit.mockResolvedValue({ status: 'started', split: { id: SPLIT, state: 'queued' }, supersededIds: [] });
});
afterEach(() => { if (saved === undefined) delete process.env.PRESENTATION_VIDEO_SPLIT_ACCESS; else process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = saved; });

describe('startPresentationVideoSplit: success', () => {
  test('freezes the verified source into the store call (202 queued)', async () => {
    const result = await startPresentationVideoSplit(args());
    expect(result).toEqual({ status: 202, body: { split: { id: SPLIT, state: 'queued' } } });
    expect(resolveCurrentMeetingTranscriptSource).toHaveBeenCalledWith({ requestId: REQUEST, actorProfileId: 9 });
    expect(store.findCopiedZoomVideoCopyForDocument).toHaveBeenCalledWith({ requestId: REQUEST, requestDocumentId: WINNER });
    const call = store.startPresentationVideoSplit.mock.calls[0][0];
    expect(call).toMatchObject({
      requestId: REQUEST, siteVisitActivityId: VISIT, actorProfileId: 9, sourceCopyId: COPY, transcriptRevisionId: REV,
      presentationEndMs: 1_800_000, sourceDocumentId: WINNER, sourceDriveId: 'Drive', sourceItemId: 'Item', sourceVersionId: '4.0',
      sourceEtag: 'etag-1', sourceSize: 555, sourceQuickXorHash: 'qx',
    });
    expect(call.lineage).toEqual({
      version: 1, provenance: provenance(), transcriptRevisionId: REV, presentationEndMs: 1_800_000,
      boundaryConfirmedBy: 9, boundaryConfirmedAt: '2026-10-09T10:00:00.000Z',
      source: { documentId: WINNER, driveId: 'Drive', itemId: 'Item', versionId: '4.0', eTag: 'etag-1', size: 555, quickXorHash: 'qx', copyId: COPY },
    });
  });
  test('lineage carries no names, emails or URLs', async () => {
    await startPresentationVideoSplit(args());
    const text = JSON.stringify(store.startPresentationVideoSplit.mock.calls[0][0].lineage);
    expect(text).not.toMatch(/https?:|@|speaker|attendee|topic|email|\.mp4/i);
  });
  test('recording times compare as instants, not strings', async () => {
    store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ recording_start: '2026-10-05T10:00:00-07:00', recording_end: '2026-10-05T18:02:00Z' }));
    expect((await startPresentationVideoSplit(args())).status).toBe(202);
  });
});

describe('startPresentationVideoSplit: refusals', () => {
  test.each([
    ['an invalid request id', { requestId: 'nope' }, 400, 'invalid_request_id'],
    ['no profile', { actorProfileId: 0 }, 401, 'profile_required'],
    ['no actor system id', { actingUserSystemId: '' }, 403, 'post_presentation_actor_required'],
  ])('%s', async (_l, over, status, code) => {
    expect(await rejection(startPresentationVideoSplit(args(over)))).toMatchObject({ httpStatus: status, code });
    expect(resolveCurrentMeetingTranscriptSource).not.toHaveBeenCalled();
  });

  test.each(['off', undefined, 'bogus'])('flag %s: 404 before any feature check or remote read', async (value) => {
    if (value === undefined) delete process.env.PRESENTATION_VIDEO_SPLIT_ACCESS; else process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = value;
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 404, code: 'presentation_video_split_not_available' });
    for (const fn of [_internal.assertFeature, loadBoundContext, resolveCurrentMeetingTranscriptSource, deps.findDocuments, store.findCopiedZoomVideoCopyForDocument, store.startPresentationVideoSplit]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  test('the resolver is read only after the feature check and bound context', async () => {
    const order = [];
    _internal.assertFeature.mockImplementation(() => { order.push('feature'); });
    loadBoundContext.mockImplementation(async () => { order.push('context'); return { siteVisit: { activityid: VISIT } }; });
    resolveCurrentMeetingTranscriptSource.mockImplementation(async () => { order.push('resolver'); return resolved(); });
    await startPresentationVideoSplit(args());
    expect(order).toEqual(['feature', 'context', 'resolver']);
  });

  test('resolver errors propagate (409 meeting_transcript_current_changed)', async () => {
    const error = Object.assign(new Error('changed'), { httpStatus: 409, code: 'meeting_transcript_current_changed' });
    resolveCurrentMeetingTranscriptSource.mockRejectedValue(error);
    expect(await rejection(startPresentationVideoSplit(args()))).toBe(error);
    expect(store.startPresentationVideoSplit).not.toHaveBeenCalled();
  });

  test.each([
    ['an upload source', () => resolveCurrentMeetingTranscriptSource.mockResolvedValue(resolved({ status: 'upload' })), 'presentation_video_source_not_zoom'],
    ['an invalid source', () => resolveCurrentMeetingTranscriptSource.mockResolvedValue({ status: 'invalid', provenance: null }), 'presentation_video_source_not_zoom'],
    ['two audio files', () => resolveCurrentMeetingTranscriptSource.mockResolvedValue(resolved({ provenance: provenance({ audioOnlyFileCount: 2 }) })), 'presentation_video_audio_ambiguous'],
    ['no boundary', () => resolveCurrentMeetingTranscriptSource.mockResolvedValue(resolved({ presentationEnd: null })), 'presentation_video_boundary_required'],
    ['a boundary without endMs', () => resolveCurrentMeetingTranscriptSource.mockResolvedValue(resolved({ presentationEnd: { confirmedBy: 9 } })), 'presentation_video_boundary_required'],
    ['no RECORDING winner', () => deps.findDocuments.mockResolvedValue({ records: [] }), 'presentation_video_recording_missing'],
    ['a Zoom-link winner', () => deps.findDocuments.mockResolvedValue({ records: [{ ...winnerRow(), wmkf_sharepointdriveid: undefined, wmkf_sharepointitemid: undefined,
      wmkf_sharepointversionid: undefined, wmkf_sharepointetag: undefined, wmkf_externalurl: 'https://us02web.zoom.us/rec/share/abc' }] }), 'presentation_video_recording_missing'],
    ['a winner without an eTag', () => deps.findDocuments.mockResolvedValue({ records: [winnerRow({ wmkf_sharepointetag: null })] }), 'presentation_video_recording_missing'],
    ['no copied row', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(null), 'presentation_video_source_not_copied'],
    ['a different meeting', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ zoom_meeting_uuid: 'other' })), 'presentation_video_source_mismatch'],
    ['a pre-079 copy (null times)', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ recording_start: null, recording_end: null })), 'presentation_video_recopy_required'],
    ['a different recording start', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ recording_start: '2026-10-05T17:00:01.000Z' })), 'presentation_video_source_mismatch'],
    ['a different recording end', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ recording_end: '2026-10-05T18:02:01.000Z' })), 'presentation_video_source_mismatch'],
    ['a different SharePoint item', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ sharepoint_item_id: 'other' })), 'presentation_video_source_mismatch'],
    ['a different SharePoint drive', () => store.findCopiedZoomVideoCopyForDocument.mockResolvedValue(copyRow({ sharepoint_drive_id: 'other' })), 'presentation_video_source_mismatch'],
  ])('422 for %s, nothing started', async (_l, arrange, code) => {
    arrange();
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 422, code });
    expect(store.startPresentationVideoSplit).not.toHaveBeenCalled();
  });

  test.each([
    ['active', 'presentation_video_split_active'],
    ['approval_in_progress', 'presentation_video_approval_in_progress'],
  ])('store outcome %s maps to 409 %s', async (status, code) => {
    store.startPresentationVideoSplit.mockResolvedValue({ status, split: null });
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 409, code });
  });

  test('an unknown store outcome is a 500', async () => {
    store.startPresentationVideoSplit.mockResolvedValue({ status: 'weird' });
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 500 });
  });
});

describe('startPresentationVideoSplit: awaiting registering row', () => {
  const ABANDONED = '99999999-9999-4999-8999-999999999999';
  const ORPHAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const frozen = (over = {}) => ({ id: ABANDONED, transcript_revision_id: REV, presentation_end_ms: 1_800_000, source_document_id: WINNER, source_etag: 'etag-1', state: 'registering', ...over });
  beforeEach(() => {
    store.startPresentationVideoSplit.mockResolvedValueOnce({ status: 'approval_in_progress', split: null });
    store.claimPresentationVideoApproval.mockResolvedValue({ id: ABANDONED });
    store.markPresentationVideoApprovalAttempted.mockResolvedValue({ id: ABANDONED });
    store.settleStalePresentationVideoApproval.mockResolvedValue({ id: ABANDONED });
    deps.findDocumentByGenerationKey.mockResolvedValue({ records: [] });
  });

  test('a live (not abandoned) claim stays 409 approval_in_progress; nothing is claimed', async () => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(null);
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 409, code: 'presentation_video_approval_in_progress' });
    expect(store.claimPresentationVideoApproval).not.toHaveBeenCalled();
  });
  test('an abandoned row whose frozen identity is still current stays a refusal: finish approving it', async () => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(frozen());
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 409, code: 'presentation_video_approval_pending' });
    expect(store.claimPresentationVideoApproval).not.toHaveBeenCalled();
    expect(store.startPresentationVideoSplit).toHaveBeenCalledTimes(1);
  });
  test.each([
    ['transcript revision', { transcript_revision_id: '88888888-8888-4888-8888-888888888888' }],
    ['boundary', { presentation_end_ms: 1_700_000 }],
    ['source recording', { source_document_id: '88888888-8888-4888-8888-888888888888' }],
    ['source eTag', { source_etag: 'older' }],
  ])('an abandoned row stale by %s is reconciled (orphan superseded, row settled) and start is retried once', async (_l, over) => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(frozen(over));
    deps.findDocumentByGenerationKey.mockResolvedValue({ records: [{ wmkf_requestdocumentid: ORPHAN, _wmkf_request_value: REQUEST, wmkf_artifacttype: 100000011, wmkf_producer: 'meeting-tracker-post-presentation', wmkf_lifecyclestate: 100000000 }] });
    const result = await startPresentationVideoSplit(args());
    expect(result.status).toBe(202);
    expect(store.claimPresentationVideoApproval).toHaveBeenCalledWith(expect.objectContaining({ id: ABANDONED, requestId: REQUEST, actorProfileId: 9 }));
    expect(store.markPresentationVideoApprovalAttempted).toHaveBeenCalled();
    expect(deps.updateDocument).toHaveBeenCalledWith(ORPHAN, { wmkf_lifecyclestate: 100000003 }, expect.objectContaining({ actingUserSystemId: ACTOR }));
    expect(store.settleStalePresentationVideoApproval).toHaveBeenCalledWith(expect.objectContaining({ supersededDocumentId: ORPHAN }));
    expect(store.startPresentationVideoSplit).toHaveBeenCalledTimes(2);
  });
  test('stale with no Dataverse row (create never happened): settles with no document and retries start', async () => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(frozen({ source_etag: 'older' }));
    expect((await startPresentationVideoSplit(args())).status).toBe(202);
    expect(deps.updateDocument).not.toHaveBeenCalled();
    expect(store.settleStalePresentationVideoApproval).toHaveBeenCalledWith(expect.objectContaining({ supersededDocumentId: null }));
  });
  test('an ambiguous generation key yields the claim, never retries start, and surfaces 500', async () => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(frozen({ source_etag: 'older' }));
    deps.findDocumentByGenerationKey.mockResolvedValue({ records: [{}, {}] });
    store.releasePresentationVideoApproval.mockResolvedValue(null);
    store.yieldPresentationVideoApproval.mockResolvedValue({ id: ABANDONED });
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 500, code: 'presentation_video_generation_ambiguous' });
    expect(store.yieldPresentationVideoApproval).toHaveBeenCalled();
    expect(store.settleStalePresentationVideoApproval).not.toHaveBeenCalled();
    expect(store.startPresentationVideoSplit).toHaveBeenCalledTimes(1);
  });
  test('losing the claim race stays 409 approval_in_progress', async () => {
    store.findAbandonedRegisteringPresentationVideoSplit.mockResolvedValue(frozen({ source_etag: 'older' }));
    store.claimPresentationVideoApproval.mockResolvedValue(null);
    expect(await rejection(startPresentationVideoSplit(args()))).toMatchObject({ httpStatus: 409, code: 'presentation_video_approval_in_progress' });
  });
});

describe('getPresentationVideoSplits', () => {
  test('flag off: unavailable, no read', async () => {
    process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = 'off';
    expect(await getPresentationVideoSplits({ requestId: REQUEST })).toEqual({ available: false, splits: [] });
    expect(store.listPresentationVideoSplitSnapshotsForRequest).not.toHaveBeenCalled();
  });
  test('projects snapshots field by field', async () => {
    store.listPresentationVideoSplitSnapshotsForRequest.mockResolvedValue([{
      id: SPLIT, state: 'review', failure_code: null, created_at: 'c', updated_at: 'u', completed_at: null, approved_at: null,
      source_etag: 'secret-ish', sandbox_name: 'sb',
    }]);
    const result = await getPresentationVideoSplits({ requestId: REQUEST });
    expect(store.listPresentationVideoSplitSnapshotsForRequest).toHaveBeenCalledWith({ requestId: REQUEST, limit: 10 });
    expect(result).toEqual({ available: true, splits: [{ id: SPLIT, state: 'review', failureCode: null, createdAt: 'c', updatedAt: 'u', completedAt: null, approvedAt: null }] });
    expect(presentationVideoSplitDto({ id: 'x', state: 'failed', failure_code: 'f' }).failureCode).toBe('f');
  });
  test('rejects an invalid request id', async () => {
    expect(await rejection(getPresentationVideoSplits({ requestId: 'nope' }))).toMatchObject({ httpStatus: 400 });
  });
});
