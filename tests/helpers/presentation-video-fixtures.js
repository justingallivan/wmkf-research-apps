// Shared Request Document row fixtures for the Stage 4 presentation-video binding and outside-reader tests.
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument.js';
import { presentationVideoFingerprint } from '../../lib/services/post-presentation-materials/presentation-video-binding.js';

export const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const VISIT_ID = '22222222-2222-4222-8222-222222222222';
export const REVISION = '33333333-3333-4333-8333-333333333333';
export const OTHER_REVISION = '44444444-4444-4444-8444-444444444444';
export const RECORDING_ID = '55555555-5555-4555-8555-555555555555';
export const OTHER_RECORDING_ID = '56565656-5656-4565-8565-565656565656';
export const VIDEO_ID = '66666666-6666-4666-8666-666666666666';
export const END_MS = 70_000;
export const PRODUCER = 'meeting-tracker-post-presentation';
const SHA = 'a'.repeat(64);

function fileDescriptor(role) {
  return { siteId: 'site', driveId: 'drive', itemId: `item-${role}`, versionId: 'v1', eTag: 'e1', sha256: SHA, size: 10,
    filename: `t.${role}`, contentType: { txt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8', source: 'application/json' }[role] };
}
export function manifest(overrides = {}) {
  return { schemaVersion: 4, requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: REVISION, operationId: REVISION,
    sourceRevisionId: null, formatterVersion: '4', files: { txt: fileDescriptor('txt'), vtt: fileDescriptor('vtt'), source: fileDescriptor('source') },
    presentationEnd: { endMs: END_MS, confirmedBy: 5, confirmedAt: '2026-10-05T18:00:00.000Z' }, ...overrides };
}
export function transcriptRow(manifestValue = manifest()) {
  const txt = manifestValue.files.txt;
  return { wmkf_requestdocumentid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, wmkf_producer: PRODUCER,
    wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000, wmkf_slotversion: 1, createdon: '2026-10-05T00:00:00Z',
    wmkf_transcriptbundlejson: JSON.stringify(manifestValue),
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId,
    wmkf_sharepointversionid: txt.versionId, wmkf_sharepointetag: txt.eTag, wmkf_filename: txt.filename,
    wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size };
}
/** The full Recording winner: SharePoint-backed, NOT produced by the post-presentation producer. */
export function recordingRow(over = {}) {
  return { wmkf_requestdocumentid: RECORDING_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    wmkf_producer: 'zoom-video-copy', wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000, wmkf_slotversion: 4,
    createdon: '2026-10-05T01:00:00Z', wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'rec-item', wmkf_sharepointetag: 'rec-etag-1',
    wmkf_filename: 'full-recording.mp4', wmkf_contenttype: 'video/mp4', wmkf_filesize: 9000, wmkf_sharepointweburl: 'https://sp.example/full-recording.mp4', ...over };
}
export function boundFingerprint(over = {}) {
  return presentationVideoFingerprint({ requestId: REQUEST_ID, transcriptRevisionId: REVISION, presentationEndMs: END_MS,
    sourceDocumentId: RECORDING_ID, sourceEtag: 'rec-etag-1', ...over });
}
/** An approved Presentation Video row. By default bound to transcriptRow() + recordingRow(). */
export function videoRow(over = {}) {
  return { wmkf_requestdocumentid: VIDEO_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO,
    wmkf_producer: PRODUCER, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000, wmkf_slotversion: 2,
    createdon: '2026-10-06T00:00:00Z', wmkf_inputfingerprint: boundFingerprint(), wmkf_generationkey: 'k'.repeat(64),
    wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'video-item', wmkf_sharepointetag: 'video-etag-1',
    wmkf_filename: 'presentation-video.mp4', wmkf_contenttype: 'video/mp4', wmkf_filesize: 4000,
    wmkf_sharepointweburl: 'https://sp.example/presentation-video.mp4', ...over };
}
