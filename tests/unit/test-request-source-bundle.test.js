/** @jest-environment node */
import { jest } from '@jest/globals';
import {
  SOURCE_BUNDLE_KIND,
  SOURCE_BUNDLE_VERSION,
  buildSourceBundle,
  exportTestRequestSourceBundle,
  readSourceBundle,
  summarizeSourceBundle,
} from '../../lib/services/test-requests/source-bundle.js';

const REQUEST_ID = 'E43AE6EA-698F-F111-8076-6045BD018A07';
const PURPOSE = 'Confidential source purpose text';
const sourceRow = (over = {}) => ({
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '1003222',
  akoya_requesttype: 100000001,
  akoya_purpose: PURPOSE,
  akoya_request: 1000000,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-03T00:00:00Z',
  versionnumber: 123456,
  ...over,
});
const document = (over = {}) => ({
  id: 'inv-1',
  kind: 'reviewerProposal',
  library: 'akoya_request',
  folder: '1003222_E43AE6EA/Reviewer Materials',
  name: 'Proposal_1003222.pdf',
  driveId: 'b!drive-id',
  graphItemId: '01ABC',
  sharePointSite: {
    key: 'akoyago-shared',
    hostname: 'appriver3651007194.sharepoint.com',
    pathname: '/sites/akoyago',
  },
  size: 1024,
  mimeType: 'application/pdf',
  eTag: '"{ETAG},1"',
  versionId: '1.0',
  contentHash: 'a'.repeat(64),
  ...over,
});
const build = (over = {}) => buildSourceBundle({
  sourceRow: sourceRow(),
  documents: [document()],
  dataverseHost: 'WMKF.crm.dynamics.com',
  exportedAt: new Date('2026-09-23T12:00:00Z'),
  ...over,
});

const inventoryDocument = (over = {}) => ({
  id: 'inv-1',
  kind: 'reviewerProposal',
  label: 'Reviewer proposal',
  library: 'akoya_request',
  folder: '1003222_E43AE6EA/Reviewer Materials',
  name: 'Proposal_1003222.pdf',
  graphItemId: '01ABC',
  size: 1024,
  mimeType: 'application/pdf',
  lastModified: '2026-09-23T12:00:00Z',
  source: 'dynamics',
  copyMode: 'copy-rename',
  ...over,
});

function exportDependencies({ inventories, metadata } = {}) {
  const passes = inventories || [[inventoryDocument()], [inventoryDocument()]];
  const freshMetadata = metadata || {
    id: '01ABC',
    name: 'Proposal_1003222.pdf',
    size: 1024,
    mimeType: 'application/pdf',
    eTag: '"{ETAG},1"',
    versionId: '1.0',
  };
  return {
    readSourceRow: jest.fn(async () => sourceRow()),
    discoverDocuments: jest.fn()
      .mockResolvedValueOnce({ documents: passes[0], errors: [] })
      .mockResolvedValueOnce({ documents: passes[1], errors: [] }),
    assertReadLimits: jest.fn(),
    hydrateDocument: jest.fn(async () => document()),
    getDriveId: jest.fn(async () => 'b!drive-id'),
    getFileMetadataById: jest.fn(async () => freshMetadata),
    readSourceRevision: jest.fn(async () => '123456'),
  };
}

const exportBundle = (dependencies) => exportTestRequestSourceBundle({
  sourceRequestNumber: '1003222',
  dataverseHost: 'wmkf.crm.dynamics.com',
  exportedAt: new Date('2026-09-23T12:00:00Z'),
}, dependencies);

test('builds a canonical bundle from the clone projection', () => {
  const bundle = build();
  expect(bundle).toMatchObject({
    kind: SOURCE_BUNDLE_KIND,
    version: SOURCE_BUNDLE_VERSION,
    exportedAt: '2026-09-23T12:00:00.000Z',
    source: {
      dataverseHost: 'wmkf.crm.dynamics.com',
      request: {
        akoya_requestid: REQUEST_ID.toLowerCase(),
        akoya_requestnum: '1003222',
        akoya_purpose: PURPOSE,
        wmkf_meetingdate: '2026-12-03',
        revision: '123456',
      },
    },
  });
  expect(bundle.documents).toEqual([document()]);
});

test('round-trips through JSON and readSourceBundle unchanged', () => {
  const bundle = build();
  expect(readSourceBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
});

test('exports after an unchanged strict discovery and metadata pass', async () => {
  const dependencies = exportDependencies();

  await expect(exportBundle(dependencies)).resolves.toEqual(build());
  expect(dependencies.discoverDocuments).toHaveBeenCalledTimes(2);
  expect(dependencies.assertReadLimits).toHaveBeenCalledTimes(2);
  expect(dependencies.readSourceRevision).toHaveBeenCalledWith(REQUEST_ID.toLowerCase());
});

test.each([
  ['added', [[inventoryDocument()], [inventoryDocument(), inventoryDocument({
    id: 'inv-2', kind: 'proposalNarrative', folder: '1003222_E43AE6EA/AI Materials',
    name: 'ProposalNarrative_1003222.pdf', graphItemId: '01DEF',
  })]]],
  ['removed', [[inventoryDocument()], []]],
  ['moved', [[inventoryDocument()], [inventoryDocument({ folder: '1003222_E43AE6EA/AI Materials' })]]],
])('rejects a document %s between discovery passes', async (_label, inventories) => {
  const dependencies = exportDependencies({ inventories });
  if (_label === 'added') {
    dependencies.getFileMetadataById.mockImplementation(async (_driveId, itemId) => (
      itemId === '01DEF'
        ? {
          id: '01DEF', name: 'ProposalNarrative_1003222.pdf', size: 1024,
          mimeType: 'application/pdf', eTag: '"{ETAG-2},1"', versionId: '1.0',
        }
        : {
          id: '01ABC', name: 'Proposal_1003222.pdf', size: 1024,
          mimeType: 'application/pdf', eTag: '"{ETAG},1"', versionId: '1.0',
        }
    ));
  }

  await expect(exportBundle(dependencies)).rejects.toThrow(/document set changed during export/);
  expect(dependencies.readSourceRevision).not.toHaveBeenCalled();
});

test('rejects fresh eTag or version drift after hydration', async () => {
  const dependencies = exportDependencies({
    metadata: {
      id: '01ABC', name: 'Proposal_1003222.pdf', size: 1024,
      mimeType: 'application/pdf', eTag: '"{ETAG},2"', versionId: '2.0',
    },
  });

  await expect(exportBundle(dependencies)).rejects.toThrow(/document set changed during export/);
  expect(dependencies.readSourceRevision).not.toHaveBeenCalled();
});

test.each([
  ['wrong kind', (b) => ({ ...b, kind: 'other' }), /not a Test Request source bundle/],
  ['unsupported v1 bundle', (b) => ({ ...b, version: 1 }), /Unsupported source bundle version: 1/],
  ['bad export time', (b) => ({ ...b, exportedAt: 'nope' }), /export time/],
  ['missing request', (b) => ({ ...b, source: { dataverseHost: 'x' } }), /request is missing/],
  ['bad request GUID', (b) => ({ ...b, source: { ...b.source, request: { ...b.source.request, akoya_requestid: 'x' } } }), /identity is invalid/],
  ['missing revision', (b) => ({ ...b, source: { ...b.source, request: { ...b.source.request, revision: null } } }), /revision is unavailable/],
  ['bad document hash', (b) => ({ ...b, documents: [{ ...b.documents[0], contentHash: 'short' }] }), /contentHash/],
  ['missing drive identity', (b) => ({ ...b, documents: [{ ...b.documents[0], driveId: null }] }), /driveId/],
  ['missing SharePoint site identity', (b) => ({ ...b, documents: [{ ...b.documents[0], sharePointSite: null }] }), /sharePointSite/],
  ['bad SharePoint site path', (b) => ({
    ...b,
    documents: [{ ...b.documents[0], sharePointSite: { ...b.documents[0].sharePointSite, pathname: 'sites/akoyago' } }],
  }), /sharePointSite/],
  ['unknown document kind', (b) => ({ ...b, documents: [{ ...b.documents[0], kind: 'other' }] }), /kind/],
])('readSourceBundle rejects %s', (_label, mutate, pattern) => {
  expect(() => readSourceBundle(mutate(JSON.parse(JSON.stringify(build()))))).toThrow(pattern);
});

test('rejects duplicate document kinds', () => {
  expect(() => build({ documents: [document(), document({ id: 'inv-2' })] })).toThrow(/more than one reviewerProposal/);
});

test('rejects a missing request number', () => {
  expect(() => build({ sourceRow: sourceRow({ akoya_requestnum: null }) })).toThrow(/Request number/);
});

test('summary carries identities and hash prefixes but never source text', () => {
  const summary = summarizeSourceBundle(build());
  expect(JSON.stringify(summary)).not.toContain(PURPOSE);
  expect(summary).toMatchObject({
    requestNumber: '1003222',
    requestId: REQUEST_ID.toLowerCase(),
    hasPurpose: true,
    documents: [{ kind: 'reviewerProposal', sha256Prefix: 'aaaaaaaaaaaa' }],
  });
});
