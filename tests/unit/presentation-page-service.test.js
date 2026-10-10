/** @jest-environment node */
import {
  buildPresentationContext,
  resolvePresentationMember,
  _internal,
} from '../../lib/services/post-presentation-materials/presentation-page-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import { presentationTranscriptGenerationKey, staffDiscussionTranscriptGenerationKey, transcriptSummaryBindingFingerprint } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';

jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  findByRequest: jest.fn(async () => ({ records: [] })),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SLIDES_ID = '22222222-2222-4222-8222-222222222222';
const RECORDING_ID = '33333333-3333-4333-8333-333333333333';
const TRANSCRIPT_ID = '44444444-4444-4444-8444-444444444444';

function fileRow(id, artifactType, producer, overrides = {}) {
  return {
    wmkf_requestdocumentid: id,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: artifactType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: producer,
    wmkf_sharepointdriveid: `drive-${id}`,
    wmkf_sharepointitemid: `item-${id}`,
    wmkf_sharepointweburl: `https://tenant.sharepoint.com/${id}`,
    wmkf_filename: 'material.pdf',
    wmkf_contenttype: 'application/pdf',
    wmkf_filesize: 90_000_000,
    wmkf_slotversion: 1,
    createdon: '2026-09-25T12:00:00Z',
    ...overrides,
  };
}

function dependencies(rows, overrides = {}) {
  return {
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID,
      akoya_title: 'A private proposal title',
      _akoya_applicantid_value: 'account-id',
      '_akoya_applicantid_value_formatted': 'Fallback institution',
      akoya_requestnum: '1003220',
    })),
    getAccount: jest.fn(async () => ({ name: 'Example University' })),
    findDocuments: jest.fn(async () => ({ records: rows })),
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({
      driveId, itemId, filename: 'material.pdf', mimeType: 'application/pdf',
      size: 90_000_000, malware: null, downloadUrl: 'https://tenant.sharepoint.com/download?short=1',
    })),
    ...overrides,
  };
}

const PRESENTATION_ID = '88888888-8888-4888-8888-888888888888';
const SUMMARY_ID = '99999999-9999-4999-8999-999999999999';
const REVISION = '33333333-3333-4333-8333-3333333333aa';
const SHA = 'a'.repeat(64);
const PRODUCER = 'meeting-tracker-post-presentation';

function v4Manifest(overrides = {}) {
  const file = (role, contentType) => ({
    siteId: 'site', driveId: `drive-${TRANSCRIPT_ID}`, itemId: `item-${role}`, versionId: 'v1', eTag: 'e1', sha256: SHA,
    size: 10, filename: `t.${role}`, contentType,
  });
  return {
    schemaVersion: 4, requestId: REQUEST_ID, siteVisitActivityId: '22222222-2222-4222-8222-2222222222bb',
    revisionId: REVISION, operationId: REVISION, sourceRevisionId: null, formatterVersion: '4',
    files: { txt: file('txt', 'text/plain; charset=utf-8'), vtt: file('vtt', 'text/vtt; charset=utf-8'), source: file('source', 'application/json') },
    presentationEnd: { endMs: 70_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:00:00.000Z' },
    ...overrides,
  };
}
function fullTranscript(manifest = v4Manifest()) {
  const txt = manifest.files.txt;
  return fileRow(TRANSCRIPT_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, PRODUCER, {
    wmkf_transcriptbundlejson: JSON.stringify(manifest),
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId,
    wmkf_sharepointversionid: txt.versionId, wmkf_sharepointetag: txt.eTag, wmkf_filename: txt.filename,
    wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size,
  });
}
function derivative(endMs = 70_000, overrides = {}) {
  return fileRow(PRESENTATION_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, PRODUCER, {
    wmkf_filename: 'presentation.txt', wmkf_contenttype: 'text/plain', wmkf_filesize: 500, wmkf_sharepointetag: 'e1',
    wmkf_generationkey: presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: endMs }),
    ...overrides,
  });
}
function summaryRow(overrides = {}) {
  return fileRow(SUMMARY_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, PRODUCER, {
    wmkf_filename: 'summary.pdf', wmkf_sharepointetag: 'e1',
    wmkf_inputfingerprint: transcriptSummaryBindingFingerprint({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 70_000 }),
    ...overrides,
  });
}
function zoomRecording(overrides = {}) {
  return fileRow(RECORDING_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, PRODUCER, {
    wmkf_sharepointdriveid: null, wmkf_sharepointitemid: null, wmkf_sharepointweburl: null, wmkf_filename: null,
    wmkf_contenttype: null, wmkf_filesize: null, wmkf_externalurl: 'https://zoom.us/rec/share/current?pwd=secret',
    ...overrides,
  });
}
function fileRecording() {
  return fileRow(RECORDING_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, PRODUCER, {
    wmkf_filename: 'recording.mp4', wmkf_contenttype: 'video/mp4',
  });
}
function textMedia(filename = 'presentation.txt', mimeType = 'text/plain', { eTag = 'e1' } = {}) {
  return jest.fn(async (driveId, itemId) => ({
    driveId, itemId, filename, mimeType, malware: null, eTag, downloadUrl: 'https://tenant.sharepoint.com/download?short=1',
  }));
}

async function expectNotFound(promise) {
  await expect(promise).rejects.toMatchObject({ httpStatus: 404 });
}

test('context lists applicant files plus only the bound Presentation Transcript and summary, and leaks no internals', async () => {
  const slides = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'site-visit-materials-portal');
  const forbidden = fileRow('66666666-6666-4666-8666-666666666666', REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK, 'consultant-feedback');
  const deps = dependencies([slides, fileRecording(), fullTranscript(), derivative(), summaryRow(), forbidden]);
  const context = await buildPresentationContext(
    { requestId: REQUEST_ID, link: { expires_at: new Date('2026-11-24T12:00:00Z') } }, deps,
  );
  expect(context.materials.map((item) => item.member)).toEqual([
    `material:${SLIDES_ID}`, `material:${PRESENTATION_ID}`, `material:${SUMMARY_ID}`,
  ]);
  expect(context.materials.every((item) => item.canWatch === false)).toBe(true);
  const json = JSON.stringify(context);
  for (const leak of ['1003220', 'sharepoint.com', 'consultant', REVISION, 'presentationEnd', 'generationkey', 'schemaVersion']) {
    expect(json).not.toContain(leak);
  }
});

test('the default findDocuments opts into the transcript bundle', async () => {
  await _internal.DEFAULT_DEPENDENCIES.findDocuments(REQUEST_ID);
  expect(requestDocumentAdapter.findByRequest).toHaveBeenCalledWith(REQUEST_ID, { includeMeetingTranscriptBundle: true });
});

test.each([
  ['a READY full transcript', () => [fullTranscript()]],
  ['a READY SharePoint recording', () => [fileRecording()]],
  ['a READY Zoom recording', () => [zoomRecording()]],
])('%s is absent from context and 404s on open, watch, and download', async (_label, makeRows) => {
  const deps = dependencies(makeRows());
  const context = await buildPresentationContext({ requestId: REQUEST_ID }, deps);
  expect(context.materials).toEqual([]);
  for (const id of [TRANSCRIPT_ID, RECORDING_ID]) {
    for (const mode of ['open', 'watch', 'download']) {
      await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${id}`, mode }, deps));
    }
  }
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test('a bound Presentation Transcript opens and downloads by redirect, but never in watch mode', async () => {
  const deps = dependencies([fullTranscript(), derivative()], { resolveMediaDownloadUrl: textMedia() });
  for (const mode of ['open', 'download']) {
    const result = await resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode }, deps);
    expect(result).toMatchObject({ kind: 'file', redirectUrl: 'https://tenant.sharepoint.com/download?short=1' });
    expect(result).not.toHaveProperty('buffer');
  }
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'watch' }, deps));
});

test('a replaced SharePoint file (live eTag differs from the pinned one) is never served, for the derivative or the summary (Codex finding)', async () => {
  const replaced = dependencies([fullTranscript(), derivative(), summaryRow()], { resolveMediaDownloadUrl: textMedia('presentation.txt', 'text/plain', { eTag: 'e2' }) });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, replaced));
  const replacedSummary = dependencies([fullTranscript(), summaryRow()], { resolveMediaDownloadUrl: textMedia('summary.pdf', 'application/pdf', { eTag: 'e2' }) });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SUMMARY_ID}`, mode: 'open' }, replacedSummary));
  // A row that never pinned an eTag fails closed too.
  const unpinned = dependencies([fullTranscript(), derivative(70_000, { wmkf_sharepointetag: null })], { resolveMediaDownloadUrl: textMedia() });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, unpinned));
  const noLiveTag = dependencies([fullTranscript(), derivative()], { resolveMediaDownloadUrl: textMedia('presentation.txt', 'text/plain', { eTag: null }) });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, noLiveTag));
});

test('the summary is served as text/pdf/docx only', async () => {
  const ok = dependencies([fullTranscript(), summaryRow()], { resolveMediaDownloadUrl: textMedia('summary.pdf', 'application/pdf') });
  await expect(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SUMMARY_ID}`, mode: 'open' }, ok))
    .resolves.toMatchObject({ kind: 'file' });
  const video = dependencies([fullTranscript(), summaryRow()], { resolveMediaDownloadUrl: textMedia('summary.mp4', 'video/mp4') });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SUMMARY_ID}`, mode: 'open' }, video));
});

test('a derivative whose boundary moved is omitted at context and 404s at open', async () => {
  const moved = v4Manifest({ presentationEnd: { endMs: 65_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:30:00.000Z' } });
  const deps = dependencies([fullTranscript(moved), derivative(70_000)], { resolveMediaDownloadUrl: textMedia() });
  expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials).toEqual([]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, deps));
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test('a derivative whose key matches but whose transcript has a v3 manifest, no manifest, or no boundary is omitted', async () => {
  const v3 = v4Manifest({ schemaVersion: 3, formatterVersion: '3' });
  delete v3.presentationEnd;
  const transcripts = [
    fullTranscript(v3),
    { ...fullTranscript(), wmkf_transcriptbundlejson: null },
    fullTranscript(v4Manifest({ presentationEnd: null })),
  ];
  for (const transcript of transcripts) {
    const deps = dependencies([transcript, derivative()], { resolveMediaDownloadUrl: textMedia() });
    expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials).toEqual([]);
    await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, deps));
  }
});

test('a derivative with no transcript winner, or from another producer, is omitted', async () => {
  const alone = dependencies([derivative()], { resolveMediaDownloadUrl: textMedia() });
  expect((await buildPresentationContext({ requestId: REQUEST_ID }, alone)).materials).toEqual([]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, alone));
  const foreign = dependencies([fullTranscript(), derivative(70_000, { wmkf_producer: 'someone-else' })], { resolveMediaDownloadUrl: textMedia() });
  expect((await buildPresentationContext({ requestId: REQUEST_ID }, foreign)).materials).toEqual([]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, foreign));
});

test('a Ready, file-backed Staff Discussion Transcript from the real producer is never listed or served, in any mode (staff-only)', async () => {
  const DISCUSSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const discussion = fileRow(DISCUSSION_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT, PRODUCER, {
    wmkf_filename: 'discussion.txt', wmkf_contenttype: 'text/plain', wmkf_filesize: 500, wmkf_sharepointetag: 'e1',
    wmkf_generationkey: staffDiscussionTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 70_000 }),
  });
  const deps = dependencies([fullTranscript(), derivative(), discussion], { resolveMediaDownloadUrl: textMedia('discussion.txt') });
  const context = await buildPresentationContext({ requestId: REQUEST_ID }, deps);
  expect(context.materials.map((item) => item.member)).not.toContain(`material:${DISCUSSION_ID}`);
  expect(JSON.stringify(context)).not.toMatch(/discussion/i);
  for (const mode of ['open', 'download', 'watch']) {
    await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${DISCUSSION_ID}`, mode }, deps));
  }
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalledWith(discussion.wmkf_sharepointdriveid, discussion.wmkf_sharepointitemid);
});

test('an external (Zoom) backing on a Presentation Transcript is never served', async () => {
  const zoomish = derivative(70_000, {
    wmkf_sharepointdriveid: null, wmkf_sharepointitemid: null, wmkf_sharepointweburl: null,
    wmkf_externalurl: 'https://zoom.us/rec/share/current?pwd=secret',
  });
  const deps = dependencies([fullTranscript(), zoomish]);
  expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials).toEqual([]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, deps));
});

test('resolver serves a current portal Applicant Slides file', async () => {
  const slides = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'site-visit-materials-portal');
  const deps = dependencies([slides]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'download',
  }, deps)).resolves.toMatchObject({ kind: 'file', mimeType: 'application/pdf' });
  expect(deps.resolveMediaDownloadUrl).toHaveBeenCalledWith(`drive-${SLIDES_ID}`, `item-${SLIDES_ID}`);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'watch' }, deps));
});

test('resolver rejects non-allowlisted producers before Graph', async () => {
  const forbidden = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'some-other-producer');
  const deps = dependencies([forbidden]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'open' }, deps));
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test.each([
  ['not ready', { wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED }],
  ['superseded', { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }],
  ['pre-site distribution snapshot', { wmkf_producer: 'request-workbench-distribution-pdf' }],
])('resolver refuses %s applicant rows before Graph', async (_label, overrides) => {
  const candidate = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'site-visit-materials-portal', overrides);
  const deps = dependencies([candidate]);
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'download' }, deps));
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test.each([
  ['malware', { malware: { detected: true } }],
  ['drive mismatch', { driveId: 'wrong-drive' }],
  ['item mismatch', { itemId: 'wrong-item' }],
])('resolver rejects Graph %s for an otherwise eligible file', async (_label, graphOverride) => {
  const slides = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'site-visit-materials-portal');
  const deps = dependencies([slides], {
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({
      driveId, itemId, filename: 'material.pdf', mimeType: 'application/pdf', malware: null,
      downloadUrl: 'https://tenant.sharepoint.com/download', ...graphOverride,
    })),
  });
  await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'download' }, deps));
});

test.each([
  ['has no binding fingerprint', () => [fullTranscript(), summaryRow({ wmkf_inputfingerprint: null })]],
  ['was made from another revision', () => [fullTranscript(), summaryRow({ wmkf_inputfingerprint: transcriptSummaryBindingFingerprint({
    requestId: REQUEST_ID, sourceRevisionId: '33333333-3333-4333-8333-3333333333bb', presentationEndMs: 70_000 }) })]],
  ['was made at another boundary', () => [fullTranscript(), summaryRow({ wmkf_inputfingerprint: transcriptSummaryBindingFingerprint({
    requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: 65_000 }) })]],
  ['has no confirmed boundary to bind to', () => [fullTranscript(v4Manifest({ presentationEnd: null })), summaryRow()]],
  ['has no transcript at all', () => [summaryRow()]],
])('a summary that %s is omitted at context and 404s on open and download', async (_label, makeRows) => {
  const deps = dependencies(makeRows(), { resolveMediaDownloadUrl: textMedia('summary.pdf', 'application/pdf') });
  expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials.map((item) => item.member)).not.toContain(`material:${SUMMARY_ID}`);
  for (const mode of ['open', 'download']) {
    await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SUMMARY_ID}`, mode }, deps));
  }
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});


// ---- Stage 4: Presentation Video (100000011) ------------------------------------------------------------------
describe('presentation video', () => {
  const vf = require('../helpers/presentation-video-fixtures.js');
  const videoMedia = (over = {}) => jest.fn(async (driveId, itemId) => ({
    driveId, itemId, filename: 'presentation-video.mp4', mimeType: 'video/mp4', malware: null, eTag: 'video-etag-1',
    downloadUrl: 'https://tenant.sharepoint.com/download?short=1', ...over,
  }));
  const bound = () => [vf.transcriptRow(), vf.recordingRow(), vf.videoRow()];
  const member = (id = vf.VIDEO_ID) => ({ requestId: REQUEST_ID, member: `material:${id}` });

  test('only a bound video lists, with canWatch true; the full Recording and an unapproved cut (no row) never list', async () => {
    const listed = await buildPresentationContext({ requestId: REQUEST_ID }, dependencies(bound()));
    expect(listed.materials).toHaveLength(1);
    expect(listed.materials[0]).toMatchObject({ member: `material:${vf.VIDEO_ID}`, label: 'Presentation Video', canWatch: true, canDownload: true });
    const json = JSON.stringify(listed);
    for (const leak of ['full-recording', vf.RECORDING_ID, 'rec-item', 'sharepoint.com', 'video-etag-1']) expect(json).not.toContain(leak);
    // Full Recording (and transcript) only: an unapproved split has no Dataverse row, so nothing lists.
    const none = await buildPresentationContext({ requestId: REQUEST_ID }, dependencies([vf.transcriptRow(), vf.recordingRow()]));
    expect(none.materials).toEqual([]);
  });

  test('the full Recording is never openable, with or without an approved video beside it', async () => {
    for (const rows of [[vf.recordingRow()], bound()]) {
      const deps = dependencies(rows, { resolveMediaDownloadUrl: videoMedia() });
      for (const mode of ['open', 'watch', 'download']) {
        await expectNotFound(resolvePresentationMember({ ...member(vf.RECORDING_ID), mode }, deps));
      }
    }
  });

  test.each([
    ['transcript republished', () => [vf.transcriptRow(vf.manifest({ revisionId: vf.OTHER_REVISION, operationId: vf.OTHER_REVISION, sourceRevisionId: vf.REVISION })), vf.recordingRow(), vf.videoRow()]],
    ['boundary moved', () => [vf.transcriptRow(vf.manifest({ presentationEnd: { endMs: 1000, confirmedBy: 5, confirmedAt: '2026-10-05T19:00:00.000Z' } })), vf.recordingRow(), vf.videoRow()]],
    ['recording replaced', () => [vf.transcriptRow(), vf.recordingRow({ wmkf_sharepointetag: 'rec-etag-2' }), vf.videoRow()]],
    ['no transcript row (Stage 5 fail-closed)', () => [vf.recordingRow(), vf.videoRow()]],
    ['no recording row', () => [vf.transcriptRow(), vf.videoRow()]],
    ['superseded video', () => [vf.transcriptRow(), vf.recordingRow(), vf.videoRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED })]],
  ])('a stale video (%s) is omitted at listing and 404s at open, watch and download', async (_l, makeRows) => {
    const deps = dependencies(makeRows(), { resolveMediaDownloadUrl: videoMedia() });
    expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials).toEqual([]);
    for (const mode of ['open', 'watch', 'download']) await expectNotFound(resolvePresentationMember({ ...member(), mode }, deps));
    expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
  });

  test('a bound video opens, watches and downloads by redirect with MP4 only, and the pinned eTag is enforced', async () => {
    for (const mode of ['open', 'watch', 'download']) {
      const deps = dependencies(bound(), { resolveMediaDownloadUrl: videoMedia() });
      expect(await resolvePresentationMember({ ...member(), mode }, deps))
        .toMatchObject({ kind: 'file', mimeType: 'video/mp4', redirectUrl: 'https://tenant.sharepoint.com/download?short=1' });
    }
    const replaced = dependencies(bound(), { resolveMediaDownloadUrl: videoMedia({ eTag: 'video-etag-2' }) });
    await expectNotFound(resolvePresentationMember({ ...member(), mode: 'watch' }, replaced));
    for (const over of [{ mimeType: 'text/plain' }, { mimeType: 'video/webm' }, { filename: 'presentation-video.txt' }, { malware: { x: 1 } }]) {
      await expectNotFound(resolvePresentationMember({ ...member(), mode: 'open' }, dependencies(bound(), { resolveMediaDownloadUrl: videoMedia(over) })));
    }
  });

  test('MP4 is accepted for the video only, and watch stays refused for transcripts and summaries', async () => {
    const deps = dependencies([fullTranscript(), derivative()], { resolveMediaDownloadUrl: textMedia('presentation.mp4', 'video/mp4') });
    await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'open' }, deps));
    const text = dependencies([fullTranscript(), derivative()], { resolveMediaDownloadUrl: textMedia() });
    await expectNotFound(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${PRESENTATION_ID}`, mode: 'watch' }, text));
  });

  test('a video from another producer is not served', async () => {
    const deps = dependencies([vf.transcriptRow(), vf.recordingRow(), vf.videoRow({ wmkf_producer: 'someone-else' })], { resolveMediaDownloadUrl: videoMedia() });
    expect((await buildPresentationContext({ requestId: REQUEST_ID }, deps)).materials).toEqual([]);
    await expectNotFound(resolvePresentationMember({ ...member(), mode: 'open' }, deps));
  });
});
