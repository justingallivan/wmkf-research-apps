/** @jest-environment node */
import {
  buildPresentationContext,
  resolvePresentationMember,
} from '../../lib/services/post-presentation-materials/presentation-page-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

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

test('context includes only portal applicant collection plus latest post-presentation singletons and leaks no URLs or request number', async () => {
  const slides = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'site-visit-materials-portal');
  const recording = fileRow(RECORDING_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, 'meeting-tracker-post-presentation', {
    wmkf_filename: 'recording.mp4', wmkf_contenttype: 'video/mp4', wmkf_slotversion: 2,
  });
  const oldRecording = { ...recording, wmkf_requestdocumentid: '55555555-5555-4555-8555-555555555555', wmkf_slotversion: 1 };
  const forbidden = fileRow('66666666-6666-4666-8666-666666666666', REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK, 'consultant-feedback');
  const context = await buildPresentationContext(
    { requestId: REQUEST_ID, link: { expires_at: new Date('2026-11-24T12:00:00Z') } },
    dependencies([slides, oldRecording, recording, forbidden]),
  );
  expect(context.materials.map((item) => item.member)).toEqual([
    `material:${SLIDES_ID}`,
    `material:${RECORDING_ID}`,
  ]);
  expect(JSON.stringify(context)).not.toContain('1003220');
  expect(JSON.stringify(context)).not.toContain('sharepoint.com');
  expect(JSON.stringify(context)).not.toContain('consultant');
});

test('resolver serves a >50 MB current member by fresh HTTPS redirect without buffering bytes', async () => {
  const transcript = fileRow(TRANSCRIPT_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, 'meeting-tracker-post-presentation', {
    wmkf_filename: 'transcript.pdf', wmkf_filesize: 90_000_000,
  });
  const deps = dependencies([transcript]);
  const result = await resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${TRANSCRIPT_ID}`,
    mode: 'download',
  }, deps);
  expect(result.redirectUrl).toBe('https://tenant.sharepoint.com/download?short=1');
  expect(deps.resolveMediaDownloadUrl).toHaveBeenCalledTimes(1);
  expect(result).not.toHaveProperty('buffer');
});

test('resolver serves a current portal Applicant Slides file', async () => {
  const slides = fileRow(
    SLIDES_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    'site-visit-materials-portal',
  );
  const deps = dependencies([slides]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${SLIDES_ID}`,
    mode: 'download',
  }, deps)).resolves.toMatchObject({ kind: 'file', mimeType: 'application/pdf' });
  expect(deps.resolveMediaDownloadUrl).toHaveBeenCalledWith(`drive-${SLIDES_ID}`, `item-${SLIDES_ID}`);
});

test('resolver watches a >50 MiB current SharePoint MP4 by redirect without buffering bytes', async () => {
  const recording = fileRow(
    RECORDING_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    'meeting-tracker-post-presentation',
    { wmkf_filename: 'recording.mp4', wmkf_contenttype: 'video/mp4', wmkf_filesize: 90_000_000 },
  );
  const deps = dependencies([recording], {
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({
      driveId,
      itemId,
      filename: 'recording.mp4',
      mimeType: 'video/mp4',
      size: 90_000_000,
      malware: null,
      downloadUrl: 'https://tenant.sharepoint.com/recording?short=1',
    })),
  });
  const result = await resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${RECORDING_ID}`,
    mode: 'watch',
  }, deps);
  expect(result).toMatchObject({ kind: 'file', mimeType: 'video/mp4' });
  expect(result).not.toHaveProperty('buffer');
});

test('resolver rejects non-allowlisted producers and stale singleton winners before Graph', async () => {
  const forbidden = fileRow(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, 'some-other-producer');
  const deps = dependencies([forbidden]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${SLIDES_ID}`,
    mode: 'open',
  }, deps)).rejects.toMatchObject({ httpStatus: 404 });
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test('resolver rejects an eligible but stale singleton loser before Graph', async () => {
  const stale = fileRow(
    RECORDING_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    'meeting-tracker-post-presentation',
    { wmkf_filename: 'old.mp4', wmkf_contenttype: 'video/mp4', wmkf_slotversion: 1 },
  );
  const winner = fileRow(
    '77777777-7777-4777-8777-777777777777',
    REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    'meeting-tracker-post-presentation',
    { wmkf_filename: 'current.mp4', wmkf_contenttype: 'video/mp4', wmkf_slotversion: 2 },
  );
  const deps = dependencies([stale, winner]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${RECORDING_ID}`,
    mode: 'watch',
  }, deps)).rejects.toMatchObject({ httpStatus: 404 });
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test.each([
  ['not ready', { wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED }],
  ['superseded', { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }],
  ['pre-site distribution snapshot', { wmkf_producer: 'request-workbench-distribution-pdf' }],
])('resolver refuses %s applicant rows before Graph', async (_label, overrides) => {
  const candidate = fileRow(
    SLIDES_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    'site-visit-materials-portal',
    overrides,
  );
  const deps = dependencies([candidate]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${SLIDES_ID}`,
    mode: 'download',
  }, deps)).rejects.toMatchObject({ httpStatus: 404 });
  expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
});

test.each([
  ['malware', { malware: { detected: true } }],
  ['drive mismatch', { driveId: 'wrong-drive' }],
  ['item mismatch', { itemId: 'wrong-item' }],
])('resolver rejects Graph %s for an otherwise eligible file', async (_label, graphOverride) => {
  const slides = fileRow(
    SLIDES_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    'site-visit-materials-portal',
  );
  const deps = dependencies([slides], {
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({
      driveId,
      itemId,
      filename: 'material.pdf',
      mimeType: 'application/pdf',
      malware: null,
      downloadUrl: 'https://tenant.sharepoint.com/download',
      ...graphOverride,
    })),
  });
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID,
    member: `material:${SLIDES_ID}`,
    mode: 'download',
  }, deps)).rejects.toMatchObject({ httpStatus: 404 });
});

test('watch rejects a non-recording and a recording whose fresh Graph metadata is not MP4', async () => {
  const slides = fileRow(
    SLIDES_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    'site-visit-materials-portal',
  );
  const recording = fileRow(
    RECORDING_ID,
    REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    'meeting-tracker-post-presentation',
    { wmkf_filename: 'recording.mp4', wmkf_contenttype: 'video/mp4' },
  );
  const slideDeps = dependencies([slides]);
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID, member: `material:${SLIDES_ID}`, mode: 'watch',
  }, slideDeps)).rejects.toMatchObject({ httpStatus: 404 });

  const recordingDeps = dependencies([recording], {
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({
      driveId, itemId, filename: 'recording.pdf', mimeType: 'application/pdf', malware: null,
      downloadUrl: 'https://tenant.sharepoint.com/download',
    })),
  });
  await expect(resolvePresentationMember({
    requestId: REQUEST_ID, member: `material:${RECORDING_ID}`, mode: 'watch',
  }, recordingDeps)).rejects.toMatchObject({ httpStatus: 404 });
});

test('Zoom recording may be watched but never downloaded', async () => {
  const zoom = fileRow(RECORDING_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, 'meeting-tracker-post-presentation', {
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    wmkf_filename: null,
    wmkf_contenttype: null,
    wmkf_filesize: null,
    wmkf_externalurl: 'https://zoom.us/rec/share/current?pwd=secret',
  });
  const deps = dependencies([zoom]);
  await expect(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${RECORDING_ID}`, mode: 'watch' }, deps))
    .resolves.toMatchObject({ kind: 'external', redirectUrl: zoom.wmkf_externalurl });
  await expect(resolvePresentationMember({ requestId: REQUEST_ID, member: `material:${RECORDING_ID}`, mode: 'download' }, deps))
    .rejects.toMatchObject({ httpStatus: 404 });
});
