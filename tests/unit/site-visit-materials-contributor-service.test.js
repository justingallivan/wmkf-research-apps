/** @jest-environment node */
import { buildContributorContext, finalizeMaterialUpload, outOfSync } from '../../lib/services/site-visit-materials/contributor-service';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';
import AlertRecipients from '../../lib/services/alert-recipients';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const COLLECTION_ID = '22222222-2222-4222-8222-222222222222';
const STAGING_ID = '33333333-3333-4333-8333-333333333333';
const STAGING_LEASE = '44444444-4444-4444-8444-444444444444';
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const REQUEST = { akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_title: 'Neural dust', wmkf_meetingdate: '2026-12-08T00:00:00Z', _akoya_applicantid_value_formatted: 'Caltech' };
const ROW_PDF = { wmkf_requestdocumentid: 'aaaaaaaa-0000-4000-8000-000000000001', _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_sharepointitemid: 'item-0', wmkf_filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2026-11-20T10:00:00Z' };

function collection(overrides = {}) {
  return { id: COLLECTION_ID, request_id: REQUEST_ID, status: 'open', due_at: '2026-12-04T23:59:00Z', closes_at: '2026-12-08T17:00:00Z', checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false })), ...overrides };
}

function finalizeArgs(slotKey = 'presentation_pdf', file = { filename: 'a.pdf', buffer: PDF }, overrides = {}) {
  return { collection: collection(), slotKey, file, stagingId: STAGING_ID, leaseToken: STAGING_LEASE, ...overrides };
}

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => REQUEST),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    getSharePointBuckets: jest.fn(async () => [{ library: 'akoya_request', folder: 'Neural dust_ABC123', source: 'dynamics' }, { library: 'Archive', folder: 'x', source: 'archive' }]),
    ensureFolderPath: jest.fn(async () => ({})),
    uploadFile: jest.fn(async (_lib, _folder, name) => ({ siteId: 'site', driveId: 'drive', id: 'item-1', name, size: 9, webUrl: 'https://sp/x', eTag: '"1"', versionId: '2.0', lastModified: '2026-11-21T09:00:00Z' })),
    createDocument: jest.fn(async (payload) => ({ wmkf_requestdocumentid: 'bbbbbbbb-0000-4000-8000-000000000002', ...payload })),
    supersedeDocument: jest.fn(async () => ({})),
    scanEnabled: () => true,
    scanBytes: jest.fn(async () => ({ scan_result: 'clean' })),
    getUploadMaxMb: jest.fn(async () => ({ maxMb: 100 })),
    getSupportEmail: jest.fn(async () => null),
    acquireSlotLease: jest.fn(async () => ({ leaseToken: 'slot-lease', expiresAt: new Date('2026-11-21T09:05:00Z') })),
    releaseSlotLease: jest.fn(async () => true),
    recordPortalUploadCandidate: jest.fn(async () => undefined),
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

describe('supportEmail', () => {
  test('surfaces the configured support address', async () => {
    const d = deps({ getSupportEmail: jest.fn(async () => 'portalhelp@wmkeck.org') });
    const ctx = await buildContributorContext({ collection: collection() }, d);
    expect(ctx.supportEmail).toBe('portalhelp@wmkeck.org');
  });

  test('is null when unconfigured', async () => {
    const d = deps({ getSupportEmail: jest.fn(async () => null) });
    const ctx = await buildContributorContext({ collection: collection() }, d);
    expect(ctx.supportEmail).toBeNull();
  });

});

describe('DEFAULT_DEPENDENCIES.getSupportEmail', () => {
  afterEach(() => jest.restoreAllMocks());

  test('resolves the first configured "support" category address, never falling back to "default"', async () => {
    jest.spyOn(AlertRecipients, 'readConfig').mockResolvedValue({ support: ['portalhelp@wmkeck.org', 'other@wmkeck.org'], default: ['ops@wmkeck.org'] });
    const { DEFAULT_DEPENDENCIES } = await import('../../lib/services/site-visit-materials/contributor-service');
    await expect(DEFAULT_DEPENDENCIES.getSupportEmail()).resolves.toBe('portalhelp@wmkeck.org');
  });

  test('resolves null (not the "default" category) when "support" is unconfigured', async () => {
    jest.spyOn(AlertRecipients, 'readConfig').mockResolvedValue({ default: ['ops@wmkeck.org'] });
    const { DEFAULT_DEPENDENCIES } = await import('../../lib/services/site-visit-materials/contributor-service');
    await expect(DEFAULT_DEPENDENCIES.getSupportEmail()).resolves.toBeNull();
  });

  test('resolves null and logs on a read failure; never throws', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(AlertRecipients, 'readConfig').mockRejectedValue(new Error('dataverse down'));
    const { DEFAULT_DEPENDENCIES } = await import('../../lib/services/site-visit-materials/contributor-service');
    await expect(DEFAULT_DEPENDENCIES.getSupportEmail()).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

test('outOfSync flags PDF and source received more than an hour apart', () => {
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: { receivedAt: '2026-11-20T10:30:00Z' } })).toBe(false);
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: { receivedAt: '2026-11-22T10:00:00Z' } })).toBe(true);
  expect(outOfSync({ presentation_pdf: { receivedAt: '2026-11-20T10:00:00Z' }, presentation_source: null })).toBe(false);
});

test('finalize validates, scans, uploads under the canonical name with replace, registers a READY/DRAFT row, and supersedes the prior slot row', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  const result = await finalizeMaterialUpload(finalizeArgs('presentation_pdf', { filename: 'Our Deck v3.pdf', buffer: PDF }), d);
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
  expect(payload.wmkf_generationkey).toMatch(/^[0-9a-f]{64}$/);
  expect(d.findDocumentByGenerationKey).toHaveBeenCalledWith(payload.wmkf_generationkey);
  expect(payload.wmkf_contenthash).toBe(payload.wmkf_inputfingerprint);
  expect(options.actorPolicy).toBe('allow-unattributed');
  expect(d.supersedeDocument).toHaveBeenCalledWith(ROW_PDF.wmkf_requestdocumentid);
  expect(d.recordPortalUploadCandidate).toHaveBeenCalledWith({
    stagingId: STAGING_ID,
    leaseToken: STAGING_LEASE,
    candidate: expect.objectContaining({
      requestId: REQUEST_ID,
      slot: 'presentation_pdf',
      predecessorArtifactId: ROW_PDF.wmkf_requestdocumentid,
      driveId: 'drive',
      itemId: 'item-1',
      versionId: '2.0',
      filename: '1003222 Site Visit Presentation.pdf',
    }),
  });
  expect(d.releaseSlotLease).toHaveBeenCalledWith({ collectionId: COLLECTION_ID, slotKey: 'presentation_pdf', leaseToken: 'slot-lease' });
  expect(result).toMatchObject({ ok: true, slot: 'presentation_pdf', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-11-21T09:00:00Z' });
});

test('finalize refuses: waived slot, oversize, wrong bytes, infected scan, no active bucket; nothing uploaded', async () => {
  const d = deps();
  const waived = collection(); waived.checklist[0].waived = true;
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', { filename: 'a.pdf', buffer: PDF }, { collection: waived }), d)).rejects.toMatchObject({ code: 'slot_not_open', httpStatus: 400 });
  const tiny = deps({ getUploadMaxMb: async () => ({ maxMb: 1 }) });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', { filename: 'a.pdf', buffer: Buffer.alloc(1024 * 1024 + 1) }), tiny)).rejects.toMatchObject({ code: 'file_too_large' });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', { filename: 'a.pdf', buffer: ZIP }), d)).rejects.toMatchObject({ code: 'signature_mismatch', httpStatus: 422 });
  const infected = deps({ scanBytes: async () => ({ scan_result: 'infected' }) });
  const unknown = deps({ scanBytes: async () => ({}) });
  await expect(finalizeMaterialUpload(finalizeArgs(), unknown)).rejects.toMatchObject({ code: 'scan_unavailable', httpStatus: 503 });
  const errored = deps({ scanBytes: async () => ({ scan_result: 'error' }) });
  await expect(finalizeMaterialUpload(finalizeArgs(), errored)).rejects.toMatchObject({ code: 'scan_unavailable' });
  await expect(finalizeMaterialUpload(finalizeArgs(), infected)).rejects.toMatchObject({ code: 'scan_infected' });
  const noBucket = deps({ getSharePointBuckets: async () => [{ library: 'Archive', folder: 'x', source: 'archive' }] });
  await expect(finalizeMaterialUpload(finalizeArgs(), noBucket)).rejects.toMatchObject({ code: 'folder_unavailable', httpStatus: 503 });
  for (const x of [d, tiny, infected, unknown, errored, noBucket]) { expect(x.uploadFile).not.toHaveBeenCalled(); expect(x.createDocument).not.toHaveBeenCalled(); }
});

test('other slot is refused while hidden from applicants (default), before any lease, upload, or registry write', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  await expect(finalizeMaterialUpload(finalizeArgs('other', { filename: 'map.pdf', buffer: PDF }), d)).rejects.toMatchObject({ code: 'slot_not_open', httpStatus: 400 });
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
  expect(d.uploadFile).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('other slot (when re-enabled) keeps a sanitized original name under Site Visit - Other and never supersedes', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }), otherUploadsEnabled: () => true });
  const result = await finalizeMaterialUpload(finalizeArgs('other', { filename: 'Lab  Tour <Map>.pdf', buffer: PDF }), d);
  expect(d.uploadFile.mock.calls[0][1]).toBe('Neural dust_ABC123/Site Visit - Other');
  expect(result.filename.startsWith('1003222 Site Visit - ')).toBe(true);
  expect(result.filename).not.toMatch(/[<>]/);
  expect(d.createDocument.mock.calls[0][0].wmkf_artifacttype).toBe(REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS);
  expect(d.supersedeDocument).not.toHaveBeenCalled();
});

test('the generation key is derived from the staging id: a retry after a lost response reuses the row and only redoes the supersede', async () => {
  const first = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  await finalizeMaterialUpload(finalizeArgs(), first);
  const key = first.createDocument.mock.calls[0][0].wmkf_generationkey;
  const candidate = first.recordPortalUploadCandidate.mock.calls[0][0].candidate;
  const again = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  await finalizeMaterialUpload(finalizeArgs(), again);
  expect(again.createDocument.mock.calls[0][0].wmkf_generationkey).toBe(key);
  const createdRow = {
    wmkf_requestdocumentid: 'bbbbbbbb-0000-4000-8000-000000000002',
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_sharepointdriveid: candidate.driveId,
    wmkf_sharepointitemid: candidate.itemId,
    wmkf_sharepointversionid: candidate.versionId,
    wmkf_filename: candidate.filename,
    wmkf_sharepointlastmodified: '2026-11-21T09:00:00Z',
    modifiedon: '2026-11-21T09:00:00Z',
  };
  // BOTH rows are present: matching current-state logic would choose the newly
  // created row, but replay must retire the predecessor frozen in the candidate.
  const retry = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF, createdRow] }), findDocumentByGenerationKey: async () => ({ records: [createdRow] }) });
  const result = await finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, { candidateResult: candidate }), retry);
  expect(retry.uploadFile).not.toHaveBeenCalled();
  expect(retry.createDocument).not.toHaveBeenCalled();
  expect(retry.supersedeDocument).toHaveBeenCalledWith(ROW_PDF.wmkf_requestdocumentid);
  expect(result).toMatchObject({ ok: true, replayed: true, artifactId: createdRow.wmkf_requestdocumentid, filename: createdRow.wmkf_filename });
});

test('a stale replay never retires a newer current row and remains ambiguous when the generation row is superseded or missing', async () => {
  const first = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }) });
  await finalizeMaterialUpload(finalizeArgs(), first);
  const candidate = first.recordPortalUploadCandidate.mock.calls[0][0].candidate;
  const createdRow = {
    wmkf_requestdocumentid: 'bbbbbbbb-0000-4000-8000-000000000002',
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_sharepointdriveid: candidate.driveId,
    wmkf_sharepointitemid: candidate.itemId,
    wmkf_sharepointversionid: candidate.versionId,
    wmkf_filename: candidate.filename,
    modifiedon: '2026-11-21T09:00:00Z',
  };
  const newer = { ...ROW_PDF, wmkf_requestdocumentid: 'dddddddd-0000-4000-8000-000000000004', modifiedon: '2026-11-22T09:00:00Z' };
  const stale = deps({
    findDocumentsByRequest: async () => ({ records: [ROW_PDF, createdRow, newer] }),
    findDocumentByGenerationKey: async () => ({ records: [createdRow] }),
  });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, { candidateResult: candidate }), stale))
    .rejects.toMatchObject({ code: 'replay_ambiguous', httpStatus: 409 });
  expect(stale.supersedeDocument).not.toHaveBeenCalled();
  expect(stale.releaseSlotLease).toHaveBeenCalledTimes(1);

  // A candidate whose registry row never committed is not ambiguous: the
  // finalize is redone from the top (see the dedicated test below).
});

test('a failed supersede is not success: the finalize throws a transient 503 so the staging row is released for retry', async () => {
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }), supersedeDocument: async () => { throw new Error('412'); } });
  await expect(finalizeMaterialUpload(finalizeArgs(), d)).rejects.toMatchObject({ code: 'supersede_failed', httpStatus: 503 });
  expect(d.createDocument).toHaveBeenCalledTimes(1);
  expect(d.releaseSlotLease).toHaveBeenCalledTimes(1);
});

test('a lease release failure does not replace a replay ambiguity with an unclassified error', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const unbound = { ...ROW_PDF, wmkf_requestdocumentid: 'eeeeeeee-0000-4000-8000-000000000005', wmkf_sharepointitemid: 'someone-else' };
  const d = deps({
    findDocumentByGenerationKey: async () => ({ records: [unbound] }),
    releaseSlotLease: async () => { throw new Error('database detail'); },
  });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, {
    candidateResult: { requestId: REQUEST_ID, slot: 'presentation_pdf', generationKey: 'stale' },
  }), d)).rejects.toMatchObject({ code: 'replay_ambiguous', httpStatus: 409 });
  expect(log).toHaveBeenCalledWith('[site-visit-materials] slot lease release failed', { name: 'Error' });
  log.mockRestore();
});

test('slot contention returns retryable 409 before any registry or SharePoint read', async () => {
  const d = deps({ acquireSlotLease: jest.fn(async () => null) });
  await expect(finalizeMaterialUpload(finalizeArgs(), d)).rejects.toMatchObject({ code: 'slot_busy', httpStatus: 409 });
  expect(d.findDocumentByGenerationKey).not.toHaveBeenCalled();
  expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
  expect(d.uploadFile).not.toHaveBeenCalled();
});

test('thrown scanner failures are sanitized into unavailable or misconfigured errors', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const unavailable = deps({ scanBytes: async () => { throw Object.assign(new Error('socket secret'), { serviceName: 'cloudmersive', status: 503, isTransient: true }); } });
  await expect(finalizeMaterialUpload(finalizeArgs(), unavailable)).rejects.toMatchObject({ code: 'scan_unavailable', httpStatus: 503 });
  const misconfigured = deps({ scanBytes: async () => { throw Object.assign(new Error('bad key secret'), { serviceName: 'cloudmersive', status: 401, isTransient: false }); } });
  await expect(finalizeMaterialUpload(finalizeArgs(), misconfigured)).rejects.toMatchObject({ code: 'scan_misconfigured', httpStatus: 500 });
  expect(log.mock.calls).toEqual([
    ['[site-visit-materials] malware scan failed', { serviceName: 'cloudmersive', status: 503, isTransient: true, causeKind: null }],
    ['[site-visit-materials] malware scan failed', { serviceName: 'cloudmersive', status: 401, isTransient: false, causeKind: null }],
  ]);
  log.mockRestore();
});

test('scanning off skips the scan, matching the grantee and reviewer upload paths', async () => {
  const d = deps({ scanEnabled: () => false, scanBytes: jest.fn() });
  await finalizeMaterialUpload(finalizeArgs(), d);
  expect(d.scanBytes).not.toHaveBeenCalled();
  expect(d.createDocument).toHaveBeenCalledTimes(1);
});

test('a recorded candidate with no registry row is redone from the top, not held as ambiguous', async () => {
  const stagingId = '33333333-3333-4333-8333-333333333333';
  const candidate = { requestId: REQUEST_ID, slot: 'presentation_pdf', generationKey: 'stale', predecessorArtifactId: ROW_PDF.wmkf_requestdocumentid, driveId: 'drive', itemId: 'item-1', versionId: '2.0', filename: '1003222 Site Visit Presentation.pdf' };
  const d = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }), findDocumentByGenerationKey: async () => ({ records: [] }) });
  const result = await finalizeMaterialUpload({ collection: collection(), slotKey: 'presentation_pdf', file: { filename: 'a.pdf', buffer: PDF }, stagingId, leaseToken: 'lease', candidateResult: candidate }, d);
  expect(result.ok).toBe(true);
  expect(result.replayed).toBeUndefined();
  expect(d.uploadFile).toHaveBeenCalledTimes(1);
  expect(d.createDocument).toHaveBeenCalledTimes(1);
  expect(d.supersedeDocument).toHaveBeenCalledWith(ROW_PDF.wmkf_requestdocumentid);
});

test('replay_ambiguous records one durable staff event keyed on the staging id; the redo-from-top path records none; a logging failure changes nothing (plan §16.3, PR 3)', async () => {
  const unbound = { ...ROW_PDF, wmkf_requestdocumentid: 'eeeeeeee-0000-4000-8000-000000000005', wmkf_sharepointitemid: 'someone-else' };
  const held = deps({ findDocumentByGenerationKey: async () => ({ records: [unbound] }), recordEvent: jest.fn(async () => ({ id: 1 })) });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, {
    candidateResult: { requestId: REQUEST_ID, slot: 'presentation_pdf', generationKey: 'stale' },
  }), held)).rejects.toMatchObject({ code: 'replay_ambiguous' });
  expect(held.recordEvent).toHaveBeenCalledTimes(1);
  expect(held.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'site_visit_material_replay_ambiguous', severity: 'error', transient: false, subsystem: 'site-visit-materials',
    requestNumber: '1003222', dedupeKey: `site_visit_material_replay_ambiguous:${STAGING_ID}`,
    entityRefs: { requestId: REQUEST_ID, collectionId: COLLECTION_ID, stagingId: STAGING_ID, slot: 'presentation_pdf', registryRowId: unbound.wmkf_requestdocumentid },
  }));

  const redo = deps({ findDocumentsByRequest: async () => ({ records: [ROW_PDF] }), findDocumentByGenerationKey: async () => ({ records: [] }), recordEvent: jest.fn() });
  await finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, { candidateResult: { requestId: REQUEST_ID, slot: 'presentation_pdf', generationKey: 'stale', predecessorArtifactId: ROW_PDF.wmkf_requestdocumentid, driveId: 'drive', itemId: 'item-1', versionId: '2.0', filename: '1003222 Site Visit Presentation.pdf' } }), redo);
  expect(redo.recordEvent).not.toHaveBeenCalled();

  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const broken = deps({ findDocumentByGenerationKey: async () => ({ records: [unbound] }), recordEvent: async () => { throw new Error('events table gone'); } });
  await expect(finalizeMaterialUpload(finalizeArgs('presentation_pdf', undefined, {
    candidateResult: { requestId: REQUEST_ID, slot: 'presentation_pdf', generationKey: 'stale' },
  }), broken)).rejects.toMatchObject({ code: 'replay_ambiguous', httpStatus: 409 });
  log.mockRestore();
});
