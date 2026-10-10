/** @jest-environment node */
import {
  bindPresentationVideo, presentationVideoFingerprint, presentationVideoGenerationKey,
} from '../../lib/services/post-presentation-materials/presentation-video-binding.js';
import { projectPostPresentationMaterials } from '../../lib/services/post-presentation-materials/material-model.js';
import {
  REQUEST_ID, REVISION, OTHER_REVISION, RECORDING_ID, OTHER_RECORDING_ID, END_MS, PRODUCER, manifest, transcriptRow, recordingRow,
  videoRow, boundFingerprint,
} from '../helpers/presentation-video-fixtures.js';

const bind = rows => bindPresentationVideo(projectPostPresentationMaterials(rows, REQUEST_ID).winners, REQUEST_ID);
const SPLIT = '99999999-9999-4999-8999-999999999999';

describe('fingerprint and generation key', () => {
  test('hex sha256, case-insensitive on ids, sensitive to every input', () => {
    const base = boundFingerprint();
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(boundFingerprint({ requestId: REQUEST_ID.toUpperCase(), transcriptRevisionId: REVISION.toUpperCase(), sourceDocumentId: RECORDING_ID.toUpperCase() })).toBe(base);
    for (const over of [{ transcriptRevisionId: OTHER_REVISION }, { presentationEndMs: END_MS + 1 }, { sourceDocumentId: OTHER_RECORDING_ID }, { sourceEtag: 'rec-etag-2' }]) {
      expect(boundFingerprint(over)).not.toBe(base);
    }
  });
  test('refuses malformed identities', () => {
    expect(() => boundFingerprint({ presentationEndMs: -1 })).toThrow('invalid_presentation_video_identity');
    expect(() => boundFingerprint({ sourceEtag: '' })).toThrow('invalid_presentation_video_identity');
    expect(() => presentationVideoFingerprint({})).toThrow('invalid_presentation_video_identity');
  });
  test('the generation key is unique per split and fixed to the documented preimage', () => {
    const crypto = require('node:crypto');
    expect(presentationVideoGenerationKey(SPLIT, REQUEST_ID)).toBe(
      crypto.createHash('sha256').update(`${PRODUCER}:${REQUEST_ID}:100000011:split:${SPLIT}`).digest('hex'));
    expect(presentationVideoGenerationKey('88888888-8888-4888-8888-888888888888', REQUEST_ID)).not.toBe(presentationVideoGenerationKey(SPLIT, REQUEST_ID));
    expect(() => presentationVideoGenerationKey('nope', REQUEST_ID)).toThrow('invalid_presentation_video_identity');
  });
});

describe('bindPresentationVideo', () => {
  test('bound: fingerprint matches current transcript revision, boundary and Recording winner', () => {
    const result = bind([transcriptRow(), recordingRow(), videoRow()]);
    expect(result).toMatchObject({ reason: 'bound', video: { wmkf_requestdocumentid: videoRow().wmkf_requestdocumentid }, boundary: { revisionId: REVISION } });
  });
  test('missing: no Presentation Video winner (an unapproved split has no row)', () => {
    expect(bind([transcriptRow(), recordingRow()])).toMatchObject({ reason: 'missing', video: null, candidate: null });
    expect(bind([])).toMatchObject({ reason: 'missing' });
  });
  test('a video from another producer or request is missing, not bound', () => {
    expect(bind([transcriptRow(), recordingRow(), videoRow({ wmkf_producer: 'someone-else' })]).reason).toBe('missing');
    expect(bindPresentationVideo(projectPostPresentationMaterials([transcriptRow(), recordingRow(), videoRow()], REQUEST_ID).winners,
      '77777777-7777-4777-8777-777777777777').reason).toBe('missing');
  });
  test('stale when the transcript is republished (new revision)', () => {
    const republished = manifest({ revisionId: OTHER_REVISION, operationId: OTHER_REVISION, sourceRevisionId: REVISION });
    expect(bind([transcriptRow(republished), recordingRow(), videoRow()])).toMatchObject({ reason: 'stale', video: null });
  });
  test('stale when the presentation end moves', () => {
    const moved = manifest({ presentationEnd: { endMs: END_MS - 5000, confirmedBy: 5, confirmedAt: '2026-10-05T19:00:00.000Z' } });
    expect(bind([transcriptRow(moved), recordingRow(), videoRow()])).toMatchObject({ reason: 'stale', video: null });
  });
  test('stale when the Recording is replaced (new document or new eTag)', () => {
    expect(bind([transcriptRow(), recordingRow({ wmkf_requestdocumentid: OTHER_RECORDING_ID }), videoRow()]).reason).toBe('stale');
    expect(bind([transcriptRow(), recordingRow({ wmkf_sharepointetag: 'rec-etag-2' }), videoRow()]).reason).toBe('stale');
  });
  test('stale when there is no Recording winner or it is not file-backed', () => {
    expect(bind([transcriptRow(), videoRow()]).reason).toBe('stale');
  });
  test('stale with no current transcript row at all (Stage 5 fail-closed pin)', () => {
    expect(bind([recordingRow(), videoRow()])).toMatchObject({ reason: 'stale', video: null, boundary: null });
  });
  test('stale when the boundary is unconfirmed', () => {
    expect(bind([transcriptRow(manifest({ presentationEnd: null })), recordingRow(), videoRow()])).toMatchObject({ reason: 'stale', video: null });
  });
  test('stale with a missing or foreign fingerprint', () => {
    expect(bind([transcriptRow(), recordingRow(), videoRow({ wmkf_inputfingerprint: null })]).reason).toBe('stale');
    expect(bind([transcriptRow(), recordingRow(), videoRow({ wmkf_inputfingerprint: 'f'.repeat(64) })]).reason).toBe('stale');
  });
});
