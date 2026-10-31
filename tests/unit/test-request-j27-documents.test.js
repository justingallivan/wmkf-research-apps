/** @jest-environment node */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';
import { discoverTestRequestSourceDocuments } from '../../lib/services/test-requests/admin-preview-service.js';
import { buildSourceBundle, readSourceBundle, exportTestRequestSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { compileBasicCloneFilePlan } from '../../lib/services/test-requests/file-plan.js';
import { J27_AI_INPUT_PROFILE } from '../../lib/services/test-requests/document-profile.js';
import { planBundleFileCopies, copyBundleFiles, verifyCopiedFiles } from '../../lib/services/test-requests/bundle-file-copy.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';
import { fenceSource, sha256 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { copyPolicyDigest, SANDBOX_REHEARSAL_COPY_POLICY } from '../../lib/services/test-requests/bundle-file-copy.js';
import { verifyCloneRequestReadback } from '../../lib/services/test-requests/sandbox-clone.js';

const NUMBER = '1003222';
const REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const DEST_FOLDER = '1000400_AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceRow = () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: NUMBER, akoya_requesttype: 100000001,
  akoya_purpose: 'Source purpose', akoya_request: 1, akoya_fiscalyear: 'June 2027', wmkf_meetingdate: null,
  wmkf_abstract: 'Applicant abstract', versionnumber: 1, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' } });
const documents = () => [
  ['proposalNarrative', `Project-Narrative_${NUMBER}.pdf`],
  ['proposalBibliography', `Bibliography_${NUMBER}.pdf`],
].map(([kind, name], index) => {
  const bytes = Buffer.from(`%PDF-1.4\n${kind}`);
  return { id: `inventory-${index}`, graphItemId: `item-${index}`, kind, name, folder: 'source/AI Materials',
    library: 'akoya_request', driveId: 'source-drive', sharePointSite: SITE, size: bytes.length,
    mimeType: 'application/pdf', eTag: '"source"', versionId: '1.0', contentHash: hash(bytes) };
});
function build(docs = documents()) {
  return buildSourceBundle({ sourceRow: sourceRow(), documents: docs, applicantAbstract: 'Applicant abstract',
    documentProfile: J27_AI_INPUT_PROFILE, sourceCycleCode: 'J27',
    dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date() });
}
function discovery(docs) {
  return { getRequestSharePointBuckets: async () => [{ library: 'akoya_request', folder: 'source', source: 'dynamics' }],
    listFiles: async () => docs.map(doc => ({ ...doc, id: doc.graphItemId })) };
}
function exporter(docs, row = sourceRow()) {
  return { readSourceRow: jest.fn(async () => row),
    discoverDocuments: jest.fn(async () => ({ documents: docs, errors: [] })),
    assertReadLimits: jest.fn(), hydrateDocument: jest.fn(async d => d),
    getDriveId: async () => 'source-drive', getFileMetadataById: async (_drive, id) => ({ ...docs.find(d => d.graphItemId === id), id }),
    readSourceRevision: async () => '1' };
}
const exportArgs = { sourceRequestNumber: NUMBER, dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date() };

test('discovery recognizes J27-only names; both naming variants are ambiguous even before copying', async () => {
  const docs = documents();
  const found = await discoverTestRequestSourceDocuments(sourceRow(), discovery(docs));
  expect(found.errors).toEqual([]);
  expect(found.documents.map(d => d.kind).sort()).toEqual(['proposalBibliography', 'proposalNarrative']);
  const both = [...docs, { ...docs[0], graphItemId: 'old-name', name: `ProposalNarrative_${NUMBER}.pdf` }];
  expect((await discoverTestRequestSourceDocuments(sourceRow(), discovery(both))).errors)
    .toContainEqual({ source: 'proposal-inputs', code: 'SOURCE_DOCUMENT_AMBIGUOUS' });
});

test('authoritative J27 cycle produces a versioned profile, not a meeting-date inference', async () => {
  const deps = exporter(documents());
  const bundle = await exportTestRequestSourceBundle(exportArgs, deps);
  expect(bundle).toMatchObject({ version: 6, documentProfile: J27_AI_INPUT_PROFILE, source: { cycleCode: 'J27' }, abstract: 'Applicant abstract' });
  const reloaded = readSourceBundle(JSON.parse(JSON.stringify(bundle)));
  expect(reloaded).toEqual(bundle);
  expect(hash(Buffer.from(JSON.stringify(reloaded)))).toBe(hash(Buffer.from(JSON.stringify(bundle))));
  const legacy = await exportTestRequestSourceBundle(exportArgs, exporter([], { ...sourceRow(), wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } }));
  expect(legacy.version).toBe(5);
  expect(legacy).not.toHaveProperty('documentProfile');
  expect(legacy.source).not.toHaveProperty('cycleCode');
});

test.each([[], [documents()[0]], [documents()[1]]].map(docs => [docs]))('J27 empty or partial input inventory blocks export before hydration: %j', async docs => {
  const deps = exporter(docs);
  await expect(exportTestRequestSourceBundle(exportArgs, deps)).rejects.toThrow(/J27 AI inputs require exactly one/);
  expect(deps.hydrateDocument).not.toHaveBeenCalled();
});

test('stored profiles cannot shed a required input, downgrade, change cycle, or use unknown profile', () => {
  const bundle = build();
  for (const changed of [{ ...bundle, documents: [] }, { ...bundle, version: 5 },
    { ...bundle, documentProfile: 'unknown' }, { ...bundle, source: { ...bundle.source, cycleCode: 'D26' } }]) {
    expect(() => readSourceBundle(changed)).toThrow();
    expect(() => planBundleFileCopies(changed)).toThrow();
  }
  const { documentProfile, ...downgraded } = bundle;
  const { cycleCode, ...source } = bundle.source;
  expect(() => readSourceBundle({ ...downgraded, version: 5, source })).toThrow(/version 6/);
});

test.each(['wrong-name', 'wrong-folder', 'wrong-mime', 'duplicate'])('invalid J27 input blocks a saved bundle: %s', mode => {
  const docs = documents();
  if (mode === 'wrong-name') docs[0].name = 'Other.pdf';
  if (mode === 'wrong-folder') docs[0].folder = 'source/Submission-Documents';
  if (mode === 'wrong-mime') docs[0].mimeType = 'image/png';
  if (mode === 'duplicate') docs.push({ ...docs[0], id: 'extra', graphItemId: 'extra', name: `ProposalNarrative_${NUMBER}.pdf` });
  expect(() => build(docs)).toThrow();
});

test('copy planning normalizes destinations, preserves source names and fits unchanged ledger grammar', () => {
  const bundle = build();
  const plan = planBundleFileCopies(bundle, { destinationRequestNumber: '1000400' });
  expect(plan.map(p => p.destination.filename).sort()).toEqual(['ProposalBibliography_1000400.pdf', 'ProposalNarrative_1000400.pdf']);
  expect(plan.map(p => p.source.name).sort()).toEqual([`Bibliography_${NUMBER}.pdf`, `Project-Narrative_${NUMBER}.pdf`]);
  const sql = readFileSync(path.join(__dirname, '../../lib/db/migrations/054_test_request_runs.sql'), 'utf8');
  const filenameRule = new RegExp(sql.match(/WHEN e.key IN \('filename', 'name'\) THEN s.v ~ '([^']+)'/)[1]);
  const folderRule = new RegExp(sql.match(/WHEN e.key IN \('folder', 'relativeUrl'\) THEN s.v ~ '([^']+)'/)[1]);
  for (const p of plan) {
    expect(() => assertLedgerReceipt({ filename: p.destination.filename, folder: `${DEST_FOLDER}/${p.destination.folder}` })).not.toThrow();
    expect(filenameRule.test(p.destination.filename)).toBe(true);
    expect(folderRule.test(`${DEST_FOLDER}/${p.destination.folder}`)).toBe(true);
    expect(filenameRule.test(p.source.name)).toBe(false);
  }
});

test('J27 export, JSON reload, copying and final file verification preserve exact source bytes', async () => {
  const docs = documents();
  const bundle = readSourceBundle(JSON.parse(JSON.stringify(await exportTestRequestSourceBundle(exportArgs, exporter(docs)))));
  const plan = planBundleFileCopies(bundle, { destinationRequestNumber: '1000400' });
  const saved = new Map();
  const metadata = (doc, id) => ({ ...doc, id });
  const deps = { clearGraphCaches: jest.fn(), configuredSharePointTarget: () => ({ ...SITE, registered: true }),
    getSiteId: async () => 'site-id', getDriveId: async () => 'source-drive',
    getFileMetadataById: async (_drive, id) => docs.some(d => d.graphItemId === id)
      ? metadata(docs.find(d => d.graphItemId === id), id) : [...saved.values()].find(d => d.id === id),
    downloadFile: async (_drive, id) => ({ buffer: docs.some(d => d.graphItemId === id)
      ? Buffer.from(`%PDF-1.4\n${docs.find(d => d.graphItemId === id).kind}`) : [...saved.values()].find(d => d.id === id).bytes }),
    getFileMetadataByPath: async (_library, folder, name) => saved.get(`${folder}/${name}`) || null,
    ensureFolderPath: async () => ({}),
    uploadFile: jest.fn(async (_lib, folder, name, bytes, mimeType, options) => {
      const item = { id: `destination-${saved.size}`, name, size: bytes.length, mimeType, eTag: '"destination"', versionId: '1.0', folder, bytes };
      saved.set(`${folder}/${name}`, item);
      await options.onItemCreated(item);
      return item;
    }) };
  const journal = jest.fn(async () => {});
  const copied = await copyBundleFiles({ plannedFiles: plan, requestFolder: DEST_FOLDER,
    expectedSiteId: 'site-id', expectedDestinationDriveId: 'source-drive' }, deps, journal);
  expect(copied).toHaveLength(2);
  expect(deps.uploadFile).toHaveBeenCalledTimes(2);
  expect(verifyCopiedFiles(copied, [...saved.values()])).toEqual([]);
  for (const p of plan) expect(saved.get(`${DEST_FOLDER}/${p.destination.folder}/${p.destination.filename}`).bytes)
    .toEqual(Buffer.from(`%PDF-1.4\n${p.kind}`));
});

test('new bundle version retains applicant-abstract verification', () => {
  const bundle = build();
  const manifest = { bundle, values: {}, createBody: { wmkf_abstract: bundle.abstract }, expectedOrganization: {} };
  expect(verifyCloneRequestReadback(manifest, { wmkf_abstract: 'changed' })).toContain('abstract mismatch');
  expect(verifyCloneRequestReadback(manifest, { wmkf_abstract: bundle.abstract })).not.toContain('abstract mismatch');
});


test('v6 production source fence still refuses live or create-body abstract drift', async () => {
  const bundle = build();
  const manifest = { kind: 'test-request-sandbox-rehearsal-manifest/v4', targetEnvironment: 'production', recipe: 'basic',
    bundle, source: { requestId: REQUEST_ID, requestNumber: NUMBER, requestType: 100000001,
      revision: bundle.source.request.revision, dataverseHost: bundle.source.dataverseHost,
      bundleSha256: sha256(bundle) },
    copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
    createBody: { akoya_purpose: 'Source purpose', akoya_request: 1, wmkf_abstract: bundle.abstract } };
  const client = { get: async () => ({ ok: true, body: sourceRow() }) };
  await expect(fenceSource(client, manifest, 100000001)).resolves.toMatchObject({ akoya_requestid: REQUEST_ID });
  await expect(fenceSource({ get: async () => ({ ok: true, body: { ...sourceRow(), wmkf_abstract: 'changed' } }) }, manifest, 100000001))
    .rejects.toThrow(/abstract changed/);
  await expect(fenceSource(client, { ...manifest, createBody: { ...manifest.createBody, wmkf_abstract: 'changed' } }, 100000001))
    .rejects.toThrow(/abstract changed/);
});


test.each([undefined, null, { wmkf_cyclecode: 'D26' }])('alias-named inputs on an unlinked or D26 source refuse legacy export: %j', async cycle => {
  await expect(exportTestRequestSourceBundle(exportArgs,
    exporter(documents(), { ...sourceRow(), wmkf_GrantCycle: cycle })))
    .rejects.toThrow(/J27 source documents require the version 6 document profile/);
});

test('sandbox preview cannot select only one input from a complete J27 inventory', () => {
  const sourceDocuments = documents().map(({ contentHash, eTag, folder, id, kind, library, mimeType, name, size, versionId }) =>
    ({ contentHash, eTag, folder, id, kind, library, mimeType, name, size, versionId }));
  const trusted = { sourceRequestNumber: NUMBER, destinationRequestNumber: '1000400', sourceDocuments,
    filePolicy: { maxFiles: 7, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, allowedMimeTypes: ['application/pdf'] } };
  const result = compileBasicCloneFilePlan(trusted, { selectedDocumentIds: [sourceDocuments[0].id] });
  expect(result.blockers.map(b => b.code)).toContain('J27_AI_INPUTS_INCOMPLETE');
  expect(result.plannedFiles).toEqual([]);
  expect(compileBasicCloneFilePlan(trusted, { selectedDocumentIds: sourceDocuments.map(d => d.id) }).planReady).toBe(true);
});

test('J27 discovery ignores raw uploads and images while tolerating an allowlisted Phase I extra', async () => {
  const docs = documents();
  const extras = [
    { ...docs[0], graphItemId: 'raw', folder: 'source/Submission-Documents' },
    { ...docs[0], graphItemId: 'image', name: `Graphical-Abstract_${NUMBER}.png`, mimeType: 'image/png' },
    { ...docs[0], graphItemId: 'legacy', folder: 'source/Phase I', name: 'ProjectDescription.pdf' },
  ];
  const inventory = await discoverTestRequestSourceDocuments(sourceRow(), discovery([...docs, ...extras]));
  expect(inventory.errors).toEqual([]);
  expect(inventory.documents.map(d => d.kind).sort()).toEqual(['projectDescription', 'proposalBibliography', 'proposalNarrative']);
  expect(inventory.documents.map(d => d.graphItemId)).not.toContain('raw');
  expect(inventory.documents.map(d => d.graphItemId)).not.toContain('image');
});
