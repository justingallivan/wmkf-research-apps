/** @jest-environment node */
// Board readiness on the staff GET uses the REAL bindPresentationVideo (Codex final review round 2): the plain request
// document read returns the transcript WITHOUT its bundle manifest, the bundle read returns it WITH; the enriched row
// must win the de-duplication, or a current approved video reads as stale.
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({ resolveCurrentMeetingTranscriptSource: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-split-store.js', () => ({
  listPresentationVideoSplitSnapshotsForRequest: jest.fn(),
}));
jest.mock('../../lib/utils/presentation-video-split-access.js', () => ({ isPresentationVideoSplitRequestAllowed: () => true }));

import * as store from '../../lib/services/meeting-tracker-recordings/presentation-video-split-store.js';
import { getPresentationVideoSplits } from '../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js';
import { REQUEST_ID, VIDEO_ID, transcriptRow, recordingRow, videoRow } from '../helpers/presentation-video-fixtures.js';

const SPLIT = '77777777-7777-4777-8777-777777777777';

function plainTranscript() {
  const { wmkf_transcriptbundlejson: _omitted, ...rest } = transcriptRow();
  return rest;
}

function deps() {
  return {
    findDocuments: jest.fn(async () => ({ records: [plainTranscript(), recordingRow(), videoRow()] })),
    findDocumentsWithMeetingTranscriptBundle: jest.fn(async () => ({ records: [transcriptRow()] })),
  };
}

beforeEach(() => {
  store.listPresentationVideoSplitSnapshotsForRequest.mockResolvedValue([
    { id: SPLIT, state: 'approved', request_document_id: VIDEO_ID, failure_code: null },
  ]);
});

test('overlapping plain and bundle-enriched transcript rows: the current approved video is bound (boardReady true)', async () => {
  const d = deps();
  const result = await getPresentationVideoSplits({ requestId: REQUEST_ID }, d);
  expect(d.findDocuments).toHaveBeenCalled();
  expect(d.findDocumentsWithMeetingTranscriptBundle).toHaveBeenCalled();
  expect(result.boardVideo).toEqual({ status: 'bound' });
  expect(result.splits[0].boardReady).toBe(true);
});

test('a boundary change after approval reads as stale with the real binding (boardReady false)', async () => {
  const d = deps();
  const moved = transcriptRow();
  const manifest = JSON.parse(moved.wmkf_transcriptbundlejson);
  manifest.presentationEnd = { ...manifest.presentationEnd, endMs: manifest.presentationEnd.endMs + 1000 };
  moved.wmkf_transcriptbundlejson = JSON.stringify(manifest);
  d.findDocumentsWithMeetingTranscriptBundle.mockResolvedValue({ records: [moved] });
  const result = await getPresentationVideoSplits({ requestId: REQUEST_ID }, d);
  expect(result.boardVideo).toEqual({ status: 'stale' });
  expect(result.splits[0].boardReady).toBe(false);
});
