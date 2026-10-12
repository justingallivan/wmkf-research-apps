/** @jest-environment node */
import crypto from 'node:crypto';
import {
  readStaffPresentationText,
  RESPONSE_MAX_BYTES,
  SOURCE_MAX_BYTES,
} from '../../lib/services/post-presentation-materials/staff-text-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import {
  presentationTranscriptGenerationKey,
  transcriptSummaryBindingFingerprint,
} from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';

jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequest: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const TRANSCRIPT_ID = '44444444-4444-4444-8444-444444444444';
const PRESENTATION_ID = '88888888-8888-4888-8888-888888888888';
const SUMMARY_ID = '99999999-9999-4999-8999-999999999999';
const RECORDING_ID = '33333333-3333-4333-8333-333333333333';
const REVISION = '33333333-3333-4333-8333-3333333333aa';
const PRODUCER = 'meeting-tracker-post-presentation';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const TRANSCRIPT_TEXT = '﻿[00:00] Jane Doe: Thank you all.\n\n[01:12] A. Smith: Could you say more?';
const SUMMARY_TEXT = 'What was presented\nA pipeline.\n\nOpen points\n- Budget.';
const bytesOf = (text) => Buffer.from(text, 'utf8');

function row(id, artifactType, overrides = {}) {
  return {
    wmkf_requestdocumentid: id, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: artifactType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: PRODUCER, wmkf_sharepointdriveid: `drive-${id}`, wmkf_sharepointitemid: `item-${id}`,
    wmkf_sharepointweburl: `https://tenant.sharepoint.com/${id}`, wmkf_slotversion: 1, createdon: '2026-10-10T12:00:00Z',
    ...overrides,
  };
}
function txtFields(text, filename = 'file.txt') {
  const bytes = bytesOf(text);
  return { wmkf_filename: filename, wmkf_contenttype: 'text/plain; charset=utf-8', wmkf_filesize: bytes.length, wmkf_contenthash: sha(bytes) };
}
function manifest() {
  const bytes = bytesOf(TRANSCRIPT_TEXT);
  const file = (role, contentType, over = {}) => ({ siteId: 'site', driveId: `drive-${TRANSCRIPT_ID}`, itemId: `item-${role}`,
    versionId: 'v1', eTag: 'e1', sha256: sha(bytes), size: bytes.length, filename: `t.${role}`, contentType, ...over });
  return { schemaVersion: 4, requestId: REQUEST_ID, siteVisitActivityId: '22222222-2222-4222-8222-2222222222bb',
    revisionId: REVISION, operationId: REVISION, sourceRevisionId: null, formatterVersion: '4',
    files: { txt: file('txt', 'text/plain; charset=utf-8'), vtt: file('vtt', 'text/vtt; charset=utf-8'), source: file('source', 'application/json') },
    presentationEnd: { endMs: 70_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:00:00.000Z' } };
}
function transcript() {
  const m = manifest();
  const txt = m.files.txt;
  return row(TRANSCRIPT_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, {
    wmkf_transcriptbundlejson: JSON.stringify(m), wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId,
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointversionid: txt.versionId, wmkf_sharepointetag: txt.eTag,
    wmkf_filename: txt.filename, wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size,
  });
}
function presentationHalf(endMs = 70_000) {
  return row(PRESENTATION_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, {
    ...txtFields(TRANSCRIPT_TEXT, 'presentation.txt'),
    wmkf_generationkey: presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: endMs }),
  });
}
function summary(endMs = 70_000, over = {}) {
  return row(SUMMARY_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, {
    ...txtFields(SUMMARY_TEXT, 'summary.txt'),
    wmkf_inputfingerprint: transcriptSummaryBindingFingerprint({ requestId: REQUEST_ID, sourceRevisionId: REVISION, presentationEndMs: endMs }),
    ...over,
  });
}

function deps(rows, over = {}) {
  const contents = new Map([
    [`item-txt`, bytesOf(TRANSCRIPT_TEXT)],
    [`item-${PRESENTATION_ID}`, bytesOf(TRANSCRIPT_TEXT)],
    [`item-${SUMMARY_ID}`, bytesOf(SUMMARY_TEXT)],
  ]);
  return {
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_title: 'Quantum materials' })),
    findDocuments: jest.fn(async () => ({ records: rows })),
    downloadFile: jest.fn(async (_driveId, itemId) => ({ buffer: contents.get(itemId) })),
    presentationSchemaReady: () => true,
    presentationRequestAllowed: () => true,
    ...over,
  };
}
const read = (documentId, d) => readStaffPresentationText({ requestId: REQUEST_ID, documentId }, d);
async function rejection(promise) {
  try { await promise; } catch (error) { return { status: error.httpStatus, body: error.body }; }
  throw new Error('expected a rejection');
}

test('reads the full transcript TXT with identity, BOM stripped, bounded by its own size', async () => {
  const d = deps([transcript()]);
  const result = await read(TRANSCRIPT_ID, d);
  expect(result).toMatchObject({
    ok: true, request: { number: '1003222', title: 'Quantum materials' },
    item: { kind: 'transcript', summaryKind: null, label: 'Transcript', stale: false },
    links: { sharePoint: `https://tenant.sharepoint.com/${TRANSCRIPT_ID}` },
  });
  expect(result.text.startsWith('[00:00] Jane Doe')).toBe(true);
  expect(d.downloadFile).toHaveBeenCalledWith(`drive-${TRANSCRIPT_ID}`, 'item-txt', { maxBytes: bytesOf(TRANSCRIPT_TEXT).length });
});

test('reads a bound presentation half and a summary, marking a summary from an older boundary stale', async () => {
  expect((await read(PRESENTATION_ID, deps([transcript(), presentationHalf()]))).item.kind).toBe('transcript');
  const bound = await read(SUMMARY_ID, deps([transcript(), summary()]));
  expect(bound.item).toMatchObject({ kind: 'summary', summaryKind: 'presentation', stale: false });
  expect(bound.text).toBe(SUMMARY_TEXT);
  expect((await read(SUMMARY_ID, deps([transcript(), summary(10_000)]))).item.stale).toBe(true);
});

test('an unbound transcript half is not readable (the Workbench does not list it)', async () => {
  const d = deps([transcript(), presentationHalf(10_000)]);
  expect((await rejection(read(PRESENTATION_ID, d))).status).toBe(404);
  expect(d.downloadFile).not.toHaveBeenCalled();
});

test('non-text types, unknown documents and other producers are 404 before any download', async () => {
  const recording = row(RECORDING_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, { wmkf_filename: 'r.mp4', wmkf_contenttype: 'video/mp4' });
  for (const [rows, id] of [
    [[transcript(), recording], RECORDING_ID],
    [[transcript()], SUMMARY_ID],
    [[transcript(), summary(70_000, { wmkf_producer: 'someone-else' })], SUMMARY_ID],
  ]) {
    const d = deps(rows);
    const { status, body } = await rejection(read(id, d));
    expect(status).toBe(404);
    expect(body.request).toEqual({ number: '1003222', title: 'Quantum materials' });
    expect(d.downloadFile).not.toHaveBeenCalled();
  }
});

test('an uploaded PDF or DOCX transcript with a hash is 415 with its SharePoint link, never downloaded', async () => {
  for (const [filename, contentType] of [['t.pdf', 'application/pdf'], ['t.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['t.vtt', 'text/vtt'], ['t.txt', 'application/pdf']]) {
    const uploaded = row(TRANSCRIPT_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, {
      wmkf_filename: filename, wmkf_contenttype: contentType, wmkf_filesize: 1000, wmkf_contenthash: 'b'.repeat(64),
    });
    const d = deps([uploaded]);
    const { status, body } = await rejection(read(TRANSCRIPT_ID, d));
    expect(status).toBe(415);
    expect(body).toMatchObject({ reason: 'unsupported_format', links: { sharePoint: `https://tenant.sharepoint.com/${TRANSCRIPT_ID}` } });
    expect(d.downloadFile).not.toHaveBeenCalled();
  }
});

test('integrity: different bytes or size are 503; invalid UTF-8 is 415', async () => {
  const swapped = deps([transcript(), summary()], { downloadFile: jest.fn(async () => ({ buffer: bytesOf('Other text that is longer than before.') })) });
  expect((await rejection(read(SUMMARY_ID, swapped))).status).toBe(503);
  const sameSize = Buffer.from(SUMMARY_TEXT.replace('A', 'B'), 'utf8');
  expect((await rejection(read(SUMMARY_ID, deps([transcript(), summary()], { downloadFile: jest.fn(async () => ({ buffer: sameSize })) })))).status).toBe(503);
  const invalid = Buffer.from([0x57, 0xff, 0xfe, 0x41]);
  const badRow = summary(70_000, { wmkf_filesize: invalid.length, wmkf_contenthash: sha(invalid) });
  expect((await rejection(read(SUMMARY_ID, deps([transcript(), badRow], { downloadFile: jest.fn(async () => ({ buffer: invalid })) })))).status).toBe(415);
});

test('budgets: a declared size over the source cap is 413 before download; escaping-heavy text over the response cap is 413', async () => {
  const big = summary(70_000, { wmkf_filesize: SOURCE_MAX_BYTES + 1, wmkf_contenthash: 'c'.repeat(64) });
  const d = deps([transcript(), big]);
  expect((await rejection(read(SUMMARY_ID, d))).status).toBe(413);
  expect(d.downloadFile).not.toHaveBeenCalled();
  // Within the source cap, but every tab becomes "\t" in JSON, so the response would exceed its cap.
  const tabs = Buffer.from('\t'.repeat(Math.ceil(RESPONSE_MAX_BYTES / 2) + 1024), 'utf8');
  expect(tabs.length).toBeLessThanOrEqual(SOURCE_MAX_BYTES);
  const tabRow = summary(70_000, { wmkf_filesize: tabs.length, wmkf_contenthash: sha(tabs) });
  const { status, body } = await rejection(read(SUMMARY_ID, deps([transcript(), tabRow], { downloadFile: jest.fn(async () => ({ buffer: tabs })) })));
  expect(status).toBe(413);
  expect(body.links.sharePoint).toBe(`https://tenant.sharepoint.com/${SUMMARY_ID}`);
});

test('gates and ids: rollout off is 404; non-GUID ids are 400; nothing is read', async () => {
  for (const over of [{ presentationSchemaReady: () => false }, { presentationRequestAllowed: () => false }]) {
    const d = deps([transcript()], over);
    expect((await rejection(read(TRANSCRIPT_ID, d))).status).toBe(404);
    expect(d.findDocuments).not.toHaveBeenCalled();
  }
  const d = deps([transcript()]);
  expect((await rejection(readStaffPresentationText({ requestId: 'x', documentId: TRANSCRIPT_ID }, d))).status).toBe(400);
  expect((await rejection(read('nope', d))).status).toBe(400);
  expect(d.findDocuments).not.toHaveBeenCalled();
});
