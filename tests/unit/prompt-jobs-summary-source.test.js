/** @jest-environment node */
import { createHash } from 'node:crypto';
import { getById } from '../../lib/dataverse/adapters/grant-request.js';
import { getByIdWithSelect } from '../../lib/dataverse/adapters/contact.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets.js';
import { extractTextFromBuffer } from '../../lib/utils/file-loader.js';
import { createSummarySource } from '../../lib/services/prompt-jobs/summary-source.js';
import { verifyContextSnapshot } from '../../lib/services/prompt-jobs/context.js';

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/utils/file-loader.js', () => ({ extractTextFromBuffer: jest.fn() }));
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({ getRequestSharePointBuckets: jest.fn() }));
jest.mock('../../lib/services/graph-service.js', () => ({
  GraphService: { getFileMetadataByPath: jest.fn(), downloadFile: jest.fn() },
}));

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONTACT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQUEST_NUMBER = '1003109';
const PI_NAME = 'Synthetic PI Name';
const ACTIVE = { library: 'akoya_request', folder: '1003109_GUID', source: 'dynamics' };
const FOLDER = `${ACTIVE.folder}/Submission-Documents`;
const ORIGINAL_NAME = 'Project-Narrative_1003109.pdf';
const OTHER_NAME = 'Narrative-Bibliography_1003109.pdf';
const PDF = Buffer.from('%PDF-synthetic');
const MAX_BYTES = 20 * 1024 * 1024;
const nonceSecret = 'synthetic snapshot secret for local fixture testing';
const scope = { environment: 'test', authorizationScope: 'fixture', requestId: REQUEST_ID };
const profile = {
  key: 'proposal-analysis',
  revision: 1,
  wrapperVersion: 1,
  sharedInstructions: 'Read the governed proposal.',
  documentRoles: ['proposal'],
  recordNames: ['pi_name'],
  limits: { maxDocuments: 1, maxDocumentBytes: 262144, maxTotalDocumentBytes: 262144, maxRecordBytes: 16000 },
};

function metadata(name = ORIGINAL_NAME, overrides = {}) {
  return { name, siteId: 'site-1', driveId: 'b!drive-1', id: 'item-1', eTag: 'W/"e1"', versionId: '1.0', ...overrides };
}

function fixture() {
  const request = { akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, _wmkf_projectleader_value: CONTACT_ID };
  const contact = { contactid: CONTACT_ID, fullname: PI_NAME };
  const files = { [ORIGINAL_NAME]: metadata() };
  const deps = {
    readRequest: jest.fn(async () => request),
    readContact: jest.fn(async () => contact),
    getBuckets: jest.fn(async () => [ACTIVE, { library: 'RequestArchive1', folder: 'archive', source: 'archive' }]),
    getFileMetadataByPath: jest.fn(async (_library, _folder, name) => files[name] ?? null),
    downloadFile: jest.fn(async () => ({ filename: ORIGINAL_NAME, buffer: PDF })),
    extractText: jest.fn(async () => 'Synthetic proposal text'),
  };
  const source = createSummarySource(deps);
  const inspect = () => source.inspect({ requestId: REQUEST_ID });
  const prepare = (manifest, options) => source.prepare({ manifest, scope, profile, nonceSecret, ...options });
  return { request, contact, files, deps, source, inspect, prepare };
}

const digest = value => createHash('sha256').update(value).digest('hex');

test('pins both authoritative reads and the unique active narrative, without retaining PI text', async () => {
  const { inspect, deps } = fixture();
  const manifest = await inspect();

  expect(manifest).toEqual({
    version: 1, sourcePolicy: 'submission-documents-summary-pi-v1',
    requestId: REQUEST_ID, requestNumber: REQUEST_NUMBER, piContactId: CONTACT_ID, piNameHash: digest(PI_NAME),
    library: 'akoya_request', folder: FOLDER, filename: ORIGINAL_NAME,
    siteId: 'site-1', driveId: 'b!drive-1', itemId: 'item-1', eTag: 'W/"e1"', versionId: '1.0',
  });
  expect(JSON.stringify(manifest)).not.toContain(PI_NAME);
  expect(deps.readRequest).toHaveBeenCalledWith(REQUEST_ID, {
    select: ['akoya_requestid', 'akoya_requestnum', '_wmkf_projectleader_value'],
  });
  expect(deps.readContact).toHaveBeenCalledWith(CONTACT_ID, ['contactid', 'fullname']);
  expect(deps.getBuckets).toHaveBeenCalledWith(REQUEST_ID, REQUEST_NUMBER, {
    requireResolvedParents: true, requireCompleteResults: true,
  });
  expect(deps.getFileMetadataByPath.mock.calls).toEqual([
    ['akoya_request', FOLDER, ORIGINAL_NAME],
  ]);
  expect(deps.downloadFile).not.toHaveBeenCalled();
});

test('uses the existing service APIs when no dependencies are overridden', async () => {
  const { deps } = fixture();
  getById.mockImplementation(deps.readRequest);
  getByIdWithSelect.mockImplementation(deps.readContact);
  getRequestSharePointBuckets.mockImplementation(deps.getBuckets);
  GraphService.getFileMetadataByPath.mockImplementation(deps.getFileMetadataByPath);
  GraphService.downloadFile.mockImplementation(deps.downloadFile);
  extractTextFromBuffer.mockImplementation(deps.extractText);
  const source = createSummarySource();

  const manifest = await source.inspect({ requestId: REQUEST_ID });
  await expect(source.prepare({ manifest, scope, profile, nonceSecret })).resolves.toMatchObject({ scope });
  expect(GraphService.downloadFile).toHaveBeenCalledWith('b!drive-1', 'item-1', { maxBytes: MAX_BYTES });
  expect(extractTextFromBuffer).toHaveBeenCalledWith(PDF, ORIGINAL_NAME, 'application/pdf');
});

test('ignores existing combined PDF, legacy narrative and applicant abstract; missing narrative never falls back', async () => {
  const f = fixture();
  f.request.wmkf_abstract = 'Applicant abstract must not be used';
  f.files[OTHER_NAME] = metadata(OTHER_NAME, { id: 'combined-item' });
  f.files['ProposalNarrative_1003109.pdf'] = metadata('ProposalNarrative_1003109.pdf');
  f.deps.getFileMetadataByPath.mockImplementation(async (_library, folder, name) => {
    if (folder.endsWith('/AI Materials')) return metadata(name, { id: 'wrong-folder' });
    return f.files[name] ?? null;
  });
  const manifest = await f.inspect();
  const snapshot = await f.prepare(manifest);
  expect(snapshot.documents[0].text).toBe('Synthetic proposal text');
  expect(f.deps.getFileMetadataByPath.mock.calls.every(call => call[1] === FOLDER && call[2] === ORIGINAL_NAME)).toBe(true);
  delete f.files[ORIGINAL_NAME];
  f.deps.downloadFile.mockClear();
  await expect(f.inspect()).rejects.toMatchObject({ code: 'summary_source_missing' });
  await expect(f.prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_changed' });
  expect(f.deps.downloadFile).not.toHaveBeenCalled();
});

test.each([
  { source: 'archive', library: 'akoya_request', folder: 'archive' },
  { source: 'dynamics', library: 'another_library', folder: 'other' },
])('does not use unrelated or archive-only locations', async bucket => {
  const { inspect, deps } = fixture();
  deps.getBuckets.mockResolvedValue([bucket]);
  await expect(inspect()).rejects.toMatchObject({ code: 'summary_source_missing' });
  expect(deps.getFileMetadataByPath).not.toHaveBeenCalled();
});

test('refuses multiple active Request locations before Graph reads', async () => {
  const { inspect, deps } = fixture();
  deps.getBuckets.mockResolvedValue([ACTIVE, { ...ACTIVE, folder: 'duplicate' }]);
  await expect(inspect()).rejects.toMatchObject({ code: 'summary_source_ambiguous' });
  expect(deps.getFileMetadataByPath).not.toHaveBeenCalled();
});

test.each(['', '  ', null])('requires a nonblank PI name from the exact Project Leader Contact', async fullname => {
  const { inspect, contact, deps } = fixture();
  contact.fullname = fullname;
  await expect(inspect()).rejects.toMatchObject({ code: 'summary_source_pi_missing' });
  expect(deps.getBuckets).not.toHaveBeenCalled();
});

test('does not use a fallback Contact when the Project Leader is missing or invalid', async () => {
  const { inspect, request, deps } = fixture();
  request._wmkf_projectleader_value = 'not-a-guid';
  request._wmkf_researchleader_value = CONTACT_ID;
  await expect(inspect()).rejects.toMatchObject({ code: 'summary_source_pi_missing' });
  expect(deps.readContact).not.toHaveBeenCalled();
});

test.each([
  ['PI name', ({ contact }) => { contact.fullname = 'A different PI name'; }],
  ['Project Leader identity', ({ request }) => { request._wmkf_projectleader_value = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; }],
  ['Graph version', ({ files }) => { files[ORIGINAL_NAME].versionId = '2.0'; }],
  ['Graph ETag', ({ files }) => { files[ORIGINAL_NAME].eTag = 'W/"e2"'; }],
  ['Graph item', ({ files }) => { files[ORIGINAL_NAME].id = 'replaced-item'; }],
  ['narrative deletion', ({ files }) => { delete files[ORIGINAL_NAME]; }],
])('marks a %s change stale and discards downloaded bytes before extraction', async (_label, change) => {
  const f = fixture();
  const manifest = await f.inspect();
  await expect(f.source.isCurrent({ manifest })).resolves.toBe(true);
  f.deps.downloadFile.mockImplementationOnce(async () => {
    change(f);
    return { filename: ORIGINAL_NAME, buffer: PDF };
  });

  await expect(f.prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_changed' });
  await expect(f.source.isCurrent({ manifest })).resolves.toBe(false);
  expect(f.deps.extractText).not.toHaveBeenCalled();
});

test('checks the bounded download and rejects oversized bytes before extraction', async () => {
  const { inspect, prepare, deps } = fixture();
  const manifest = await inspect();
  deps.downloadFile.mockResolvedValue({ filename: ORIGINAL_NAME, buffer: Buffer.alloc(MAX_BYTES + 1) });
  await expect(prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_too_large' });
  expect(deps.downloadFile).toHaveBeenCalledWith('b!drive-1', 'item-1', { maxBytes: MAX_BYTES });
  expect(deps.extractText).not.toHaveBeenCalled();
});

test('preserves the bounded Graph rejection without exposing its diagnostics', async () => {
  const { inspect, prepare, deps } = fixture();
  const manifest = await inspect();
  deps.downloadFile.mockRejectedValue(Object.assign(new Error('private filename'), { code: 'graph_download_size_limit' }));

  await expect(prepare(manifest)).rejects.toMatchObject({
    code: 'summary_source_too_large', message: 'summary_source_too_large',
  });
  expect(deps.extractText).not.toHaveBeenCalled();
});

test('treats a renamed download as changed and leaves extraction untouched', async () => {
  const { inspect, prepare, deps } = fixture();
  const manifest = await inspect();
  deps.downloadFile.mockResolvedValue({ filename: OTHER_NAME, buffer: PDF });
  await expect(prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_changed' });
  expect(deps.extractText).not.toHaveBeenCalled();
});

test('returns a verifiable snapshot with raw byte lineage and directly sourced PI', async () => {
  const { inspect, prepare, deps } = fixture();
  const manifest = await inspect();
  const snapshot = await prepare(manifest);

  expect(deps.getFileMetadataByPath).toHaveBeenCalledTimes(4);
  expect(deps.extractText).toHaveBeenCalledWith(PDF, ORIGINAL_NAME, 'application/pdf');
  expect(snapshot.documents).toEqual([{
    role: 'proposal', id: JSON.stringify(['site-1', 'b!drive-1', 'item-1']),
    version: JSON.stringify(['1.0', 'W/"e1"']), sha256: digest(PDF),
    text: 'Synthetic proposal text', extractionVersion: 'pdf-parse-text-v1',
  }]);
  expect(snapshot.records).toEqual([{
    name: 'pi_name', present: true, value: PI_NAME, provenance: `contact:${CONTACT_ID}:fullname`,
  }]);
  expect(verifyContextSnapshot({ scope, profile, snapshot, nonceSecret })).toEqual(snapshot);
});

test('preserves the shared UTF-8 text ceiling without truncation', async () => {
  const { inspect, prepare, deps } = fixture();
  const manifest = await inspect();
  deps.extractText.mockResolvedValue('é'.repeat(131073));
  await expect(prepare(manifest)).rejects.toMatchObject({ code: 'snapshot_too_large' });
});

test('uses a safe transient error when source freshness cannot be observed', async () => {
  const { inspect, source, deps } = fixture();
  const manifest = await inspect();
  deps.getFileMetadataByPath.mockRejectedValue(new Error('sensitive provider error'));

  const error = await source.isCurrent({ manifest }).catch(e => e);
  expect(error).toMatchObject({ code: 'summary_source_unavailable', isTransient: true });
  expect(error.message).not.toContain('sensitive provider error');
  expect(error.cause).toBeUndefined();
});

test('treats a confirmed missing Contact as stale rather than transport uncertainty', async () => {
  const { inspect, source, deps } = fixture();
  const manifest = await inspect();
  deps.readContact.mockRejectedValue(Object.assign(new Error('sensitive 404'), { status: 404 }));
  await expect(source.isCurrent({ manifest })).resolves.toBe(false);
});

test('invalid manifest, scope, profile, and Request identity fail before source I/O', async () => {
  const { inspect, prepare, source, deps } = fixture();
  const manifest = await inspect();
  deps.readRequest.mockClear();
  await expect(source.inspect({ requestId: 'invalid-guid' })).rejects.toMatchObject({ code: 'summary_source_invalid_request' });
  await expect(source.isCurrent({ manifest: { ...manifest, piName: PI_NAME } })).rejects.toMatchObject({ code: 'summary_source_invalid_manifest' });
  await expect(prepare(manifest, { scope: { ...scope, requestId: CONTACT_ID } })).rejects.toMatchObject({ code: 'summary_source_invalid_scope' });
  await expect(prepare(manifest, { profile: { ...profile, recordNames: [] } })).rejects.toMatchObject({ code: 'summary_source_invalid_profile' });
  expect(deps.readRequest).not.toHaveBeenCalled();
  expect(deps.downloadFile).not.toHaveBeenCalled();
});


test.each(['version', 'PI'])('rejects %s changes during asynchronous extraction', async kind => {
  const f = fixture(); const manifest = await f.inspect();
  f.deps.extractText.mockImplementationOnce(async () => {
    if (kind === 'version') f.files[ORIGINAL_NAME].versionId = '2.0';
    else f.contact.fullname = 'Changed person';
    return 'Extracted from the old version';
  });
  await expect(f.prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_changed' });
});

test.each([Buffer.from('HTML login response'), Buffer.alloc(0), null])('rejects invalid PDF bytes before extraction', async buffer => {
  const f = fixture(); const manifest = await f.inspect();
  f.deps.downloadFile.mockResolvedValue({ filename: ORIGINAL_NAME, buffer });
  await expect(f.prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_invalid_file' });
  expect(f.deps.extractText).not.toHaveBeenCalled();
});

test.each(['', '  ', null])('rejects unusable extraction without a snapshot', async text => {
  const f = fixture(); const manifest = await f.inspect();
  f.deps.extractText.mockResolvedValue(text);
  await expect(f.prepare(manifest)).rejects.toMatchObject({ code: 'summary_source_extraction_failed' });
});

test.each([
  { sourcePolicy: 'ai-materials-proposal-pi-v1' },
  { folder: '1003109_GUID/AI Materials' },
  { filename: 'Narrative-Bibliography_1003109.pdf' },
  { folder: '../Submission-Documents' },
  { version: 2 },
])('rejects foreign or malformed manifest before I/O: %j', async changes => {
  const f = fixture(); const manifest = await f.inspect(); f.deps.readRequest.mockClear();
  await expect(f.prepare({ ...manifest, ...changes })).rejects.toMatchObject({ code: 'summary_source_invalid_manifest' });
  expect(f.deps.readRequest).not.toHaveBeenCalled();
});
