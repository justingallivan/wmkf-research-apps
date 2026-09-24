/** @jest-environment node */
import {
  SOURCE_BUNDLE_KIND,
  SOURCE_BUNDLE_VERSION,
  buildSourceBundle,
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
