/** @jest-environment node */
import { buildContributorContext, finalizeMaterialUpload, outOfSync } from '../../lib/services/site-visit-materials/contributor-service';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const REQUEST = { akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_title: 'Neural dust', wmkf_meetingdate: '2026-12-08T00:00:00Z', _akoya_applicantid_value_formatted: 'Caltech' };
const ROW_PDF = { wmkf_requestdocumentid: 'aaaaaaaa-0000-4000-8000-000000000001', _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_sharepointitemid: 'item-0', wmkf_filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2026-11-20T10:00:00Z' };

function collection(overrides = {}) {
  return { request_id: REQUEST_ID, status: 'open', due_at: '2026-12-04T23:59:00Z', closes_at: '2026-12-08T17:00:00Z', checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false })), ...overrides };
}

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => REQUEST),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getSharePointBuckets: jest.fn(async () => [{ library: 'akoya_request', folder: 'Neural dust_ABC123', source: 'dynamics' }, { library: 'Archive', folder: 'x', source: 'archive' }]),
    ensureFolderPath: jest.fn(async () => ({})),
    uploadFile: jest.fn(async (_lib, _folder, name) => ({ siteId: 'site', driveId: 'drive', id: 'item-1', name, size: 9, webUrl: 'https://sp/x', eTag: '"1"', versionId: '2.0', lastModified: '2026-11-21T09:00:00Z' })),
    createDocument: jest.fn(async (payload) => ({ wmkf_requestdocumentid: 'bbbbbbbb-0000-4000-8000-000000000002', ...payload })),
    supersedeDocument: jest.fn(async () => ({})),
    scanEnabled: () => true,
    scanBytes: jest.fn(async () => ({ scan_result: 'clean' })),
    getUploadMaxMb: jest.fn(async () => ({ maxMb: 100 })),
    randomUUID: () => 'cccccccc-0000-4000-8000-000000000003',
    now: () => new Date('2026-11-21T09:00:00Z'),
    ...overrides,
  };
}

test('context shows institution, title, dates, cap, and per-slot receipt; waived items are hidden; no SharePoint identity', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  const col = collection();
  col.checklist[2].waived = true;
  const ctx = await buildContributorContext({ collection: col }, d);
  expect(ctx.institution).toBe('Caltech');
  expect(ctx.proposalTitle).toBe('Neural dust');
  expect(ctx.maxMb).toBe(100);
  expect(ctx.closed).toBe(false);
  expect(ctx.checklist.map((i) => i.key)).toEqual(['presentation_pdf', 'presentation_source']);
  expect(ctx.checklist[0].received).toEqual({ filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-11-20T10:00:00Z' });
  expect(ctx.checklist[1].received).toBeNull();
  expect(JSON.stringify(ctx)).not.toContain('drive');
  const closed = await buildContributorContext({ collection: collection({ closes_at: '2026-11-01T00:00:00Z' }) }, d);
  expect(closed.closed).toBe(true);
});

test('outOfSync flags PDF and source received more than an hour apart', () => {
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: { receivedAt: '2026-11-20T10:30:00Z' } })).toBe(false);
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: { receivedAt: '2026-11-22T10:00:00Z' } })).toBe(true);
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: null })).toBe(false);
});

test('finalize validates, scans, uploads under the canonical name with replace, registers a READY/DRAFT row, and supersedes the prior slot row', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  const result = await finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'Our Deck v3.pdf', buffer: PDF } }, d);
  expect(d.scanBytes).toHaveBeenCalledWith(PDF, 'Our Deck v3.pdf');
  expect(d.ensureFolderPath).toHaveBeenCalledWith('akoya_request', 'Neural dust_ABC123/Site Visit - Slides');
  expect(d.uploadFile).toHaveBeenCalledWith('akoya_request', 'Neural dust_ABC123/Site Visit - Slides', '1003222 Site Visit Presentation.pdf', PDF, 'application/pdf', { conflictBehavior: 'replace' });
  const [payload, options] = d.createDocument.mock.calls[0];
  expect(payload).toMatchObject({
    'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_cyclecode: 'D26',
    wmkf_producer: 'site-visit-materials-portal',
    wmkf_claimtoken: 'cccccccc-0000-4000-8000-000000000003',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item-1',
    wmkf_sharepointversionid: '2.0',
    wmkf_filename: '1003222 Site Visit Presentation.pdf',
    wmkf_sharepointfolderpath: 'Neural dust_ABC123/Site Visit - Slides',
  });
  expect(payload.wmkf_inputfingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(payload.wmkf_contenthash).toBe(payload.wmkf_inputfingerprint);
  expect(options.actorPolicy).toBe('allow-unattributed');
  expect(d.supersedeDocument).toHaveBeenCalledWith(ROW_PDF.wmkf_requestdocumentid);
  expect(result).toMatchObject({ ok: true, slot: 'presentation_pdf', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-11-21T09:00:00Z' });
});

test('finalize refuses: waived slot, oversize, wrong bytes, infected scan, no active bucket; nothing uploaded', async () => {
  const d = deps();
  const waived = collection(); waived.checklist[0].waived = true;
  await expect(finalizeMaterialUpload({ collection: waived, slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: PDF } }, d)).rejects.toMatchObject({ code: 'slot_not_open', httpStatus: 400 });
  const tiny = deps({ getUploadMaxMb: async () => ({ maxMb: 1 }) });
  await expect(finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: Buffer.alloc(1024 * 1024 + 1) } }, tiny)).rejects.toMatchObject({ code: 'file_too_large' });
  await expect(finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: ZIP } }, d)).rejects.toMatchObject({ code: 'signature_mismatch', httpStatus: 422 });
  const infected = deps({ scanBytes: async () => ({ scan_result: 'infected' }) });
  await expect(finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: PDF } }, infected)).rejects.toMatchObject({ code: 'scan_infected' });
  const noBucket = deps({ getSharePointBuckets: async () => [{ library: 'Archive', folder: 'x', source: 'archive' }] });
  await expect(finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: PDF } }, noBucket)).rejects.toMatchObject({ code: 'folder_unavailable', httpStatus: 503 });
  for (const x of [d, tiny, infected, noBucket]) { expect(x.uploadFile).not.toHaveBeenCalled(); expect(x.createDocument).not.toHaveBeenCalled(); }
});

test('other slot keeps a sanitized original name under Site Visit - Other and never supersedes', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  const result = await finalizeMaterialUpload({ collection: collection(), slotKey: 'other', file: { filename: 'Lab  Tour <Map>.pdf', buffer: PDF } }, d);
  expect(d.uploadFile.mock.calls[0][1]).toBe('Neural dust_ABC123/Site Visit - Other');
  expect(result.filename.startsWith('1003222 Site Visit - ')).toBe(true);
  expect(result.filename).not.toMatch(/[<>]/);
  expect(d.createDocument.mock.calls[0][0].wmkf_artifacttype).toBe(REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS);
  expect(d.supersedeDocument).not.toHaveBeenCalled();
});
