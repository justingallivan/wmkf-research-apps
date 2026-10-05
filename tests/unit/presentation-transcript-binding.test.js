/** @jest-environment node */
import {
  bindPresentationTranscript, bindStaffDiscussionTranscript, confirmedPresentationEnd, presentationTranscriptGenerationKey,
  staffDiscussionTranscriptGenerationKey,
} from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION = '33333333-3333-4333-8333-333333333333';
const OTHER_REVISION = '44444444-4444-4444-8444-444444444444';
const SHA = 'a'.repeat(64);
const PRODUCER = 'meeting-tracker-post-presentation';

function fileDescriptor(role) {
  return { siteId: 'site', driveId: 'drive', itemId: `item-${role}`, versionId: 'v1', eTag: 'e1', sha256: SHA, size: 10,
    filename: `t.${role}`, contentType: { txt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8', source: 'application/json' }[role] };
}
function manifest(overrides = {}) {
  return { schemaVersion: 4, requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: REVISION, operationId: REVISION,
    sourceRevisionId: null, formatterVersion: '4', files: { txt: fileDescriptor('txt'), vtt: fileDescriptor('vtt'), source: fileDescriptor('source') },
    presentationEnd: { endMs: 70_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:00:00.000Z' }, ...overrides };
}
function transcriptRow(manifestValue = manifest()) {
  const txt = manifestValue.files.txt;
  return { wmkf_requestdocumentid: 'doc-t', _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_producer: PRODUCER, wmkf_transcriptbundlejson: JSON.stringify(manifestValue),
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId,
    wmkf_sharepointversionid: txt.versionId, wmkf_sharepointetag: txt.eTag, wmkf_filename: txt.filename,
    wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size };
}
function derivativeRow(generationKey) {
  return { wmkf_requestdocumentid: 'doc-p', _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
    wmkf_producer: PRODUCER, wmkf_generationkey: generationKey };
}
const key = presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 70_000 });

test('the generation key is a stable SHA-256 over producer, request, type, source revision, and boundary', () => {
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(presentationTranscriptGenerationKey({ requestId: REQUEST_ID.toUpperCase(), sourceRevisionId: REVISION.toUpperCase(), presentationEndMs: 70_000 })).toBe(key);
  expect(presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 70_001 })).not.toBe(key);
  expect(presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: OTHER_REVISION, presentationEndMs: 70_000 })).not.toBe(key);
  expect(() => presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: 'nope', presentationEndMs: 1 })).toThrow('invalid_presentation_transcript_identity');
  expect(() => presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: -1 })).toThrow('invalid_presentation_transcript_identity');
});

test('confirmedPresentationEnd reads only a verified version-4 manifest with a confirmed boundary', () => {
  expect(confirmedPresentationEnd(transcriptRow(), REQUEST_ID)).toEqual({ revisionId: REVISION, presentationEnd: manifest().presentationEnd });
  expect(confirmedPresentationEnd(transcriptRow(manifest({ presentationEnd: null })), REQUEST_ID)).toBeNull();
  const v3 = manifest({ schemaVersion: 3, formatterVersion: '3' }); delete v3.presentationEnd;
  expect(confirmedPresentationEnd(transcriptRow(v3), REQUEST_ID)).toBeNull();
  expect(confirmedPresentationEnd({ ...transcriptRow(), wmkf_transcriptbundlejson: '{"schemaVersion":4' }, REQUEST_ID)).toBeNull();
  expect(confirmedPresentationEnd({ ...transcriptRow(), wmkf_transcriptbundlejson: null }, REQUEST_ID)).toBeNull();
  // Primary file identity must match the manifest's TXT descriptor.
  expect(confirmedPresentationEnd({ ...transcriptRow(), wmkf_contenthash: 'b'.repeat(64) }, REQUEST_ID)).toBeNull();
  expect(confirmedPresentationEnd(transcriptRow(), OTHER_REVISION)).toBeNull();
});

test('the derivative is bound only when its key matches the current transcript revision and boundary', () => {
  expect(bindPresentationTranscript([transcriptRow(), derivativeRow(key)], REQUEST_ID)).toMatchObject({ reason: 'bound', presentationTranscript: { wmkf_requestdocumentid: 'doc-p' } });
  expect(bindPresentationTranscript([derivativeRow(key)], REQUEST_ID)).toMatchObject({ reason: 'no_transcript', presentationTranscript: null });
  expect(bindPresentationTranscript([transcriptRow(manifest({ presentationEnd: null })), derivativeRow(key)], REQUEST_ID)).toMatchObject({ reason: 'boundary_not_confirmed', presentationTranscript: null });
  expect(bindPresentationTranscript([transcriptRow()], REQUEST_ID)).toMatchObject({ reason: 'presentation_transcript_missing', presentationTranscript: null });
  const moved = manifest({ presentationEnd: { endMs: 65_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:30:00.000Z' } });
  expect(bindPresentationTranscript([transcriptRow(moved), derivativeRow(key)], REQUEST_ID)).toMatchObject({ reason: 'presentation_transcript_stale', presentationTranscript: null });
  const republished = manifest({ revisionId: OTHER_REVISION, operationId: OTHER_REVISION, sourceRevisionId: REVISION });
  expect(bindPresentationTranscript([transcriptRow(republished), derivativeRow(key)], REQUEST_ID)).toMatchObject({ reason: 'presentation_transcript_stale', presentationTranscript: null });
  // A derivative from another producer or request is never bound.
  expect(bindPresentationTranscript([transcriptRow(), { ...derivativeRow(key), wmkf_producer: 'someone-else' }], REQUEST_ID)).toMatchObject({ reason: 'presentation_transcript_missing' });
});

describe('staff discussion derivative', () => {
  const discussionKey = staffDiscussionTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 70_000 });
  const discussionRow = (generationKey) => ({ ...derivativeRow(generationKey), wmkf_requestdocumentid: 'doc-d',
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT });

  test('its key differs from the presentation key for the same cut, so neither row can satisfy the other binding', () => {
    expect(discussionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(discussionKey).not.toBe(key);
    expect(bindPresentationTranscript([transcriptRow(), { ...derivativeRow(discussionKey) }], REQUEST_ID)).toMatchObject({ reason: 'presentation_transcript_stale' });
    expect(bindStaffDiscussionTranscript([transcriptRow(), discussionRow(key)], REQUEST_ID)).toMatchObject({ reason: 'discussion_stale' });
  });

  test('bound, missing, stale, unconfirmed, and no transcript', () => {
    expect(bindStaffDiscussionTranscript([transcriptRow(), discussionRow(discussionKey)], REQUEST_ID))
      .toMatchObject({ reason: 'bound', staffDiscussionTranscript: { wmkf_requestdocumentid: 'doc-d' } });
    expect(bindStaffDiscussionTranscript([transcriptRow()], REQUEST_ID)).toMatchObject({ reason: 'discussion_missing' });
    const moved = manifest({ presentationEnd: { endMs: 65_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:30:00.000Z' } });
    expect(bindStaffDiscussionTranscript([transcriptRow(moved), discussionRow(discussionKey)], REQUEST_ID)).toMatchObject({ reason: 'discussion_stale' });
    expect(bindStaffDiscussionTranscript([transcriptRow(manifest({ presentationEnd: null })), discussionRow(discussionKey)], REQUEST_ID))
      .toMatchObject({ reason: 'boundary_not_confirmed' });
    expect(bindStaffDiscussionTranscript([discussionRow(discussionKey)], REQUEST_ID)).toMatchObject({ reason: 'no_transcript' });
  });
});

