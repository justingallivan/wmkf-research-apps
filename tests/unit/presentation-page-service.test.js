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
import { presentationTranscriptGenerationKey } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
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
    wmkf_filename: 'presentation.txt', wmkf_contenttype: 'text/plain', wmkf_filesize: 500,
    wmkf_generationkey: presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: endMs }),
    ...overrides,
  });
}
function summaryRow(overrides = {}) {
  return fileRow(SUMMARY_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, PRODUCER, {
    wmkf_filename: 'summary.pdf', ...overrides,
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
function textMedia(filename = 'presentation.txt', mimeType = 'text/plain') {
  return jest.fn(async (driveId, itemId) => ({
    driveId, itemId, filename, mimeType, malware: null, downloadUrl: 'https://tenant.sharepoint.com/download?short=1',
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

test('the summary is served as text/pdf/docx only', async () => {
  const ok = dependencies([summaryRow()], { resolveMediaDownloadUrl: textMedia('summary.pdf', 'application/pdf') });
  await expect(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${SUMMARY_ID}`, mode: 'open' }, ok))
    .resolves.toMatchObject({ kind: 'file' });
  const video = dependencies([summaryRow()], { resolveMediaDownloadUrl: textMedia('summary.mp4', 'video/mp4') });
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
