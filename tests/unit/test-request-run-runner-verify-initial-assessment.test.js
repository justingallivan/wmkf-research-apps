/**
 * Test Request Factory slice 6b, Stage C, item C — the
 * `verify_initial_assessment` step body
 * (lib/services/test-requests/run-runner.js `stepVerifyInitialAssessment`),
 * the `initial_assessment` recipe's TERMINAL verifier.
 *
 * Builds a full, real v4 bundle manifest and observation fixture (the same
 * fenceSource/observeStep/verifyClone/reverifyClone machinery the Basic
 * recipe's own `stepVerify` exercises) so the happy path genuinely reaches
 * markReady, then proves each Stage C addition stops readiness with the
 * right reason: the durable Foundation/Contact baseline compare, the
 * sandbox-backed canonical resolve + content-hash checks, the retained Board
 * snapshot's two-read stability + dual-hash check, and the request pointer
 * check.
 *
 * @jest-environment node
 */

import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { assertLedgerReceipt, ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import {
  MANIFEST_V4, sha256, foundationBaselineDigest,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { SANDBOX_REHEARSAL_COPY_POLICY, copyPolicyDigest } from '../../lib/services/test-requests/bundle-file-copy.js';
import { SANDBOX_HOSTS, PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { hashGovernedDocxContent, GOVERNED_DOCX_HASH_PREFIX } from '../../lib/services/documents/governed-docx-hash.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import { SYNTHETIC_GENERATED } from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

function governedHashToHex(hash) {
  return Buffer.from(hash.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex');
}

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SEED_DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_DOCUMENT_ID = '55555555-5555-4555-4555-555555555555';
const LOCATION_ID = '66666666-6666-4666-8666-666666666666';
const SANDBOX_HOST = SANDBOX_HOSTS[0];
const PROD_HOST = PRODUCTION_HOSTS[0];
const SANDBOX_BASE_URL = `https://${SANDBOX_HOST}/api/data/v9.2`;
const ORG_ID = '77777777-7777-4777-8777-777777777777';
const APP_USER_ID = '88888888-8888-4888-8888-888888888888';
const EXPECTED_SITE_ID = 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';
const EXPECTED_DRIVE_ID = 'b!driveIdSample1234567890';
const SHARE_POINT_TARGET = () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' });

const ENV_KEYS = [
  'VERCEL_ENV', 'NODE_ENV', 'DATAVERSE_TARGET_INTERLOCK',
  'DYNAMICS_URL', 'DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET',
];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'test';
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = APP_USER_ID;
  process.env.DYNAMICS_CLIENT_SECRET = 's';
  _resetInterlockStateForTests();
  fetch.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function tokenResponse() {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ access_token: 'sandbox-token', expires_in: 3600 }),
    text: () => Promise.resolve(''),
  });
}
function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

const REQUEST_NUMBER = '9009009';
const REQUEST_FOLDER = `${REQUEST_NUMBER}_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`;
const MEETING_DATE = '2026-06-15';
const TITLE = 'TEST: fixture';
const FISCAL_YEAR = 'December 2026';
const PURPOSE = 'Synthetic purpose';
const AMOUNT = 5000;
const REQUEST_TYPE = 100000000;

// Basic-recipe file copy (Stage C round 2, P1-A): a real Basic document in
// the bundle plus a matching journaled copy_file resource below, so the
// census/reverifyClone paths exercise a genuine Basic-recipe copy rather than
// only the two IA-only entries this step adds.
const BASIC_ITEM_ID = '01DEFGHIJKLMNOPQRSTUVWXYZ234567ABC';
const BASIC_FILENAME = `ProposalNarrative_${REQUEST_NUMBER}.pdf`;
const BASIC_FOLDER = `${REQUEST_FOLDER}/AI Materials`;
const BASIC_FILE_BYTES = Buffer.from('synthetic Basic-recipe proposal narrative bytes for Stage C P1-A');
const BASIC_FILE_SHA256 = crypto.createHash('sha256').update(BASIC_FILE_BYTES).digest('hex');

// One real v4 bundle (buildSourceBundle) so fenceSource's bundleSourceOf
// genuinely validates instead of being stubbed. `documents` carries exactly
// the one Basic file the copy_file resource below journals, so
// `bundle.documents.length === manifest.invariants.expectedSharePointFiles`
// -- the invariant the real `validateCloneManifest` enforces (this runner
// never calls that function, but the fixture stays consistent with it rather
// than hiding the real per-recipe file-count mismatch P1-A found).
const bundle = buildSourceBundle({
  sourceRow: {
    akoya_requestid: SOURCE_ID,
    akoya_requestnum: REQUEST_NUMBER,
    akoya_requesttype: REQUEST_TYPE,
    akoya_purpose: PURPOSE,
    akoya_request: AMOUNT,
    akoya_fiscalyear: FISCAL_YEAR,
    wmkf_meetingdate: MEETING_DATE,
    versionnumber: 1,
  },
  documents: [{
    id: 'source-doc-1',
    kind: 'proposalNarrative',
    library: 'akoya_request',
    folder: 'Phase I',
    name: `ProposalNarrative_${REQUEST_NUMBER}.pdf`,
    driveId: 'b!sourceDriveIdSample000000000000',
    graphItemId: '01SOURCEITEMABCDEFGHIJKLMNOPQR234',
    sharePointSite: { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' },
    size: BASIC_FILE_BYTES.length,
    mimeType: 'application/pdf',
    eTag: '"source-1"',
    versionId: '1.0',
    contentHash: BASIC_FILE_SHA256,
  }],
  dataverseHost: PROD_HOST,
  exportedAt: new Date(),
});

function baseManifest(overrides = {}) {
  return {
    kind: MANIFEST_V4, recipe: 'initial_assessment',
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: MEETING_DATE },
    source: {
      requestId: SOURCE_ID, requestNumber: REQUEST_NUMBER, revision: '1', requestType: REQUEST_TYPE,
      dataverseHost: PROD_HOST, bundleSha256: sha256(bundle),
    },
    bundle,
    createBody: {
      akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
      akoya_title: TITLE, akoya_fiscalyear: FISCAL_YEAR, akoya_purpose: PURPOSE, akoya_request: AMOUNT,
      akoya_requesttype: REQUEST_TYPE,
    },
    createBodySha256: 'body-hash',
    copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
    expectedRequestType: { value: REQUEST_TYPE },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: ORG_ID },
    invariants: { expectedSharePointFiles: 1 },
    ...overrides,
  };
}

function requestReadback(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: REQUEST_NUMBER,
    akoya_title: TITLE,
    akoya_purpose: PURPOSE,
    akoya_request: AMOUNT,
    akoya_fiscalyear: FISCAL_YEAR,
    akoya_requesttype: REQUEST_TYPE,
    wmkf_meetingdate: MEETING_DATE,
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: RUN_ID,
    wmkf_respondreminderenabled: false,
    wmkf_reviewduereminderenabled: false,
    wmkf_phaseiistatus: null,
    akoya_recommendedamount: null,
    akoya_originalgrantamount: null,
    akoya_submissionaccepted: false,
    _akoya_applicantid_value: ORG_ID,
    _createdby_value: APP_USER_ID,
    _ownerid_value: APP_USER_ID,
    _wmkf_currentinitialassessment_value: SEED_DOCUMENT_ID,
    '@odata.etag': 'W/"request-1"',
    ...overrides,
  };
}

function locationRow() {
  return {
    sharepointdocumentlocationid: LOCATION_ID,
    name: REQUEST_FOLDER,
    relativeurl: REQUEST_FOLDER,
    absoluteurl: `https://example.sharepoint.com/sites/akoyago/akoya_request/${REQUEST_FOLDER}`,
    _parentsiteorlocation_value: 'parent-1',
    _createdby_value: APP_USER_ID,
    _ownerid_value: APP_USER_ID,
    createdon: '2026-09-24T00:00:00Z',
  };
}

function fakeClient({ requestRow } = {}) {
  return {
    baseUrl: SANDBOX_BASE_URL,
    get: jest.fn(async (requestPath) => {
      if (requestPath.includes('EntityDefinitions')) {
        if (requestPath.includes('ManyToOneRelationships')) return { ok: true, status: 200, body: { value: [{ ReferencedEntity: 'account' }] } };
        if (requestPath.includes('PicklistAttributeMetadata')) {
          return { ok: true, status: 200, body: { OptionSet: { Options: [{ Value: REQUEST_TYPE, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } } };
        }
        if (requestPath.includes('MoneyAttributeMetadata')) return { ok: true, status: 200, body: { MinValue: 0, MaxValue: 1 } };
        if (requestPath.includes('StringAttributeMetadata') || requestPath.includes('MemoAttributeMetadata')) return { ok: true, status: 200, body: { MaxLength: 100 } };
        return {
          ok: true, status: 200,
          body: {
            value: [
              'akoya_requestid', 'akoya_applicantid', 'akoya_title', 'akoya_purpose', 'akoya_request',
              'akoya_fiscalyear', 'akoya_requesttype', 'wmkf_meetingdate', 'wmkf_istestrequest',
              'wmkf_testcreationrunid', 'wmkf_respondreminderenabled', 'wmkf_reviewduereminderenabled',
            ].map((field) => ({ LogicalName: field, AttributeType: 'String', IsValidForCreate: true, RequiredLevel: { Value: 'None' } })),
          },
        };
      }
      if (requestPath.startsWith('/accounts')) return { ok: true, status: 200, body: { value: [{ accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0, versionnumber: 1 }] } };
      if (requestPath.startsWith('/sharepointsites')) return { ok: true, status: 200, body: { value: [{ sharepointsiteid: 'site-x', absoluteurl: 'https://example.sharepoint.com/sites/akoyago' }] } };
      // Single-entity parent read (resolveLocationParents): no query string params, parenthesized id.
      if (requestPath.startsWith('/sharepointdocumentlocations(')) {
        return { ok: true, status: 200, body: { sharepointdocumentlocationid: 'parent-1', name: 'akoya_request', relativeurl: 'akoya_request', absoluteurl: 'https://example.sharepoint.com/sites/akoyago/akoya_request', _parentsiteorlocation_value: 'site-x' } };
      }
      // getRequestLibraryParent (preflight): filter on relativeurl.
      if (requestPath.startsWith('/sharepointdocumentlocations?') && requestPath.includes('$filter=relativeurl')) {
        return { ok: true, status: 200, body: { value: [{ sharepointdocumentlocationid: 'parent-1', name: 'akoya_request', relativeurl: 'akoya_request', _parentsiteorlocation_value: 'site-x' }] } };
      }
      // getLocations (observe): filter on _regardingobjectid_value.
      if (requestPath.startsWith('/sharepointdocumentlocations?')) {
        return { ok: true, status: 200, body: { value: [locationRow()] } };
      }
      if (requestPath.startsWith('/systemusers')) return { ok: true, status: 200, body: { value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] } };
      if (requestPath.startsWith('/contacts')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith('/akoya_requestpayments')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith('/emails')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: requestRow };
      throw new Error(`unexpected preflight/client path: ${requestPath}`);
    }),
  };
}

function fakeGraph(overrides = {}) {
  return {
    getSiteId: jest.fn(async () => EXPECTED_SITE_ID),
    getDriveId: jest.fn(async () => EXPECTED_DRIVE_ID),
    listFiles: jest.fn(async () => [
      { id: BASIC_ITEM_ID, name: BASIC_FILENAME, folder: BASIC_FOLDER, size: BASIC_FILE_BYTES.length },
      { id: iaId, name: 'ia.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
      { id: snapId, name: 'snap.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
    ]),
    ...overrides,
  };
}

let cachedDocxBytes = null;
async function docxBytes() {
  if (!cachedDocxBytes) {
    cachedDocxBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: TITLE, institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
  }
  return cachedDocxBytes;
}

const iaId = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const snapId = '01BCDEFGHIJKLMNOPQRSTUVWXYZ234567A';

function createFakeLedger(initialRun, initialResources = []) {
  let run = { ...initialRun };
  const resources = initialResources.map((r) => ({ ...r }));
  const calls = [];
  function fenceOk(leaseToken, leaseGeneration, expectedVersion) {
    return run.leaseToken === leaseToken && run.leaseGeneration === leaseGeneration
      && (expectedVersion === undefined || run.version === expectedVersion) && run.lockedUntil !== null;
  }
  const ledger = {
    async getRun(runId) { return runId === run.runId ? { ...run } : null; },
    async claimLease({ expectedVersion }) {
      if (run.version !== expectedVersion || run.lockedUntil !== null) return null;
      run = { ...run, leaseToken: `lease-${run.leaseGeneration + 1}`, leaseGeneration: run.leaseGeneration + 1, lockedUntil: 'future', version: run.version + 1 };
      return { ...run };
    },
    async releaseLease({ leaseToken, leaseGeneration }) {
      if (!fenceOk(leaseToken, leaseGeneration)) return null;
      run = { ...run, leaseToken: null, lockedUntil: null };
      return { ...run };
    },
    async markReady(args) {
      calls.push({ op: 'markReady', ...args });
      run = { ...run, status: 'ready', leaseToken: null, lockedUntil: null, version: run.version + 1 };
      return { ...run };
    },
    async markNeedsAttention({ leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      const storedReason = ledgerReasonOrThrow(reason);
      const storedError = error == null ? null : ledgerReasonOrThrow(error);
      run = { ...run, status: 'needs_attention', needsAttentionReason: storedReason, lastError: storedError ?? run.lastError ?? null, leaseToken: null, lockedUntil: null, version: run.version + 1 };
      return { ...run };
    },
    async journalPlannedResource() { throw new Error('verify_initial_assessment must not journal new resources'); },
    async recordResourceReadback() { throw new Error('verify_initial_assessment must not journal new resources'); },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
  };
  return { ledger, calls };
}

function baseRun(overrides = {}) {
  return {
    runId: RUN_ID, recipe: 'initial_assessment', status: 'creating',
    currentStep: 'verify_initial_assessment', stepIndex: 9, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: sha256(bundle), copyPolicyDigest: copyPolicyDigest(),
    sourceRequestId: SOURCE_ID, sourceRequestNumber: REQUEST_NUMBER, sourceRevision: '1',
    destinationRequestId: REQUEST_ID, destinationLocationId: LOCATION_ID,
    destinationRequestNumber: REQUEST_NUMBER,
    expectedOrganizationId: ORG_ID, expectedAppUserId: APP_USER_ID,
    expectedGraphSiteId: EXPECTED_SITE_ID, expectedGraphDriveId: EXPECTED_DRIVE_ID,
    ...overrides,
  };
}

function baselineResource(digest) {
  return {
    resourceId: 1, sequence: 1, step: 'verify', resourceKind: 'foundation_baseline', system: 'dataverse',
    plannedIdentity: { foundationBaselineSha256: digest }, readback: { foundationBaselineSha256: digest }, outcome: 'verified',
  };
}
function seedResourceRow(overrides = {}) {
  return {
    resourceId: 2, sequence: 2, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId },
    outcome: 'advanced',
    ...overrides,
  };
}
function snapshotResourceRow(overrides = {}) {
  return {
    resourceId: 3, sequence: 3, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId },
    outcome: 'advanced',
    ...overrides,
  };
}

async function runStep({ deps = {}, resources, requestRow, manifestOverrides = {} } = {}) {
  const run0 = baseRun();
  const { ledger, calls } = createFakeLedger(run0, resources);
  const manifest = baseManifest(manifestOverrides);
  const result = await bypassDynamicsRestrictions('test:verify-initial-assessment', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle: null,
    deps: { client: fakeClient({ requestRow }), graph: fakeGraph(), sharePointTarget: SHARE_POINT_TARGET, ...deps },
  }));
  return { result, calls };
}

describe('stepVerifyInitialAssessment', () => {
  let iaHash;
  let iaBuffer;

  beforeAll(async () => {
    iaBuffer = await docxBytes();
    iaHash = await hashGovernedDocxContent(iaBuffer);
  });

  function iaRow(overrides = {}) {
    return {
      wmkf_requestdocumentid: SEED_DOCUMENT_ID,
      wmkf_artifacttype: 100000000,
      wmkf_operationstatus: 100000001, // READY
      wmkf_lifecyclestate: 100000002,
      wmkf_producer: 'request-workbench',
      _wmkf_request_value: REQUEST_ID,
      wmkf_generationkey: 'a'.repeat(64),
      wmkf_sharepointdriveid: EXPECTED_DRIVE_ID,
      wmkf_sharepointitemid: iaId,
      wmkf_sharepointsiteid: EXPECTED_SITE_ID,
      wmkf_sharepointversionid: '1.0',
      wmkf_sharepointfolderpath: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`,
      wmkf_contenthash: iaHash,
      ...overrides,
    };
  }
  function snapshotRow(overrides = {}) {
    return {
      wmkf_requestdocumentid: SNAPSHOT_DOCUMENT_ID,
      wmkf_artifacttype: 100000000,
      wmkf_operationstatus: 100000001, // READY
      wmkf_lifecyclestate: 100000002,
      wmkf_producer: 'request-workbench-board-snapshot',
      _wmkf_request_value: REQUEST_ID,
      _wmkf_sourcedocument_value: SEED_DOCUMENT_ID,
      wmkf_generationkey: 'c'.repeat(64),
      wmkf_sharepointdriveid: EXPECTED_DRIVE_ID,
      wmkf_sharepointitemid: snapId,
      wmkf_sharepointsiteid: EXPECTED_SITE_ID,
      wmkf_sourceversionid: '1.0',
      wmkf_sourcecontenthash: iaHash,
      wmkf_contenthash: iaHash,
      wmkf_sharepointfolderpath: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`,
      ...overrides,
    };
  }

  function mockDataverse({ ia = iaRow(), snapshot = snapshotRow(), request = requestReadback(), extraRows = [] } = {}) {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.startsWith(`https://${SANDBOX_HOST}/api/data/v9.2/akoya_requests(${REQUEST_ID})`)) return jsonResponse(request);
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [ia, snapshot, ...extraRows].filter(Boolean) });
      throw new Error(`unexpected fetch to ${href}`);
    });
  }

  function iaMetadata() {
    return { driveId: EXPECTED_DRIVE_ID, id: iaId, name: 'ia.docx', size: iaBuffer.length, eTag: '"ia-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/ia' };
  }
  function snapshotMetadata() {
    return { driveId: EXPECTED_DRIVE_ID, id: snapId, name: 'snap.docx', size: iaBuffer.length, eTag: '"snap-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/snap' };
  }

  function basicMetadata() {
    return { driveId: EXPECTED_DRIVE_ID, id: BASIC_ITEM_ID, name: BASIC_FILENAME, size: BASIC_FILE_BYTES.length, eTag: '"basic-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/basic' };
  }
  /** The one Basic-recipe copy_file resource this run's earlier copy_file step would have journaled (Stage C round 2, P1-A). */
  function basicFileCopyResource(overrides = {}) {
    return {
      resourceId: 4, sequence: 4, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      readback: {
        index: 0, filename: BASIC_FILENAME, folder: BASIC_FOLDER, library: 'akoya_request',
        size: BASIC_FILE_BYTES.length, contentHash: BASIC_FILE_SHA256,
        driveId: EXPECTED_DRIVE_ID, itemId: BASIC_ITEM_ID, eTag: '"basic-1"', versionId: '1.0',
      },
      outcome: 'verified',
      ...overrides,
    };
  }

  function baseGraph(overrides = {}) {
    return fakeGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === snapId) return snapshotMetadata();
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        return null;
      }),
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return { buffer: iaBuffer };
        if (itemId === snapId) return { buffer: iaBuffer };
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        return null;
      }),
      ...overrides,
    });
  }

  const validBaseline = () => foundationBaselineDigest({ accountid: ORG_ID, versionnumber: 1 }, []);

  it('happy path: reaches markReady exactly once with the correct 2-file census', async () => {
    mockDataverse();
    const graph = baseGraph();
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });

    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('a Foundation/Contact baseline mismatch stops with ia_verification_failed', async () => {
    mockDataverse();
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource('f'.repeat(64)), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('no recorded baseline stops with ia_verification_failed', async () => {
    mockDataverse();
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('downloaded Initial Assessment bytes that no longer hash to wmkf_contenthash stop with ia_verification_failed', async () => {
    mockDataverse();
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return { buffer: Buffer.from('mutated content') };
        if (itemId === snapId) return { buffer: iaBuffer };
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('a Board snapshot whose source version no longer matches the current Initial Assessment version stops with ia_snapshot_stale', async () => {
    mockDataverse({ snapshot: snapshotRow({ wmkf_sourceversionid: '0.9' }) });
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_snapshot_stale');
  });

  it('two disagreeing metadata reads of the retained snapshot file stop with ia_verification_failed, never markReady', async () => {
    mockDataverse();
    let call = 0;
    const graph = baseGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === snapId) {
          call += 1;
          return call === 1 ? snapshotMetadata() : { ...snapshotMetadata(), eTag: '"snap-2-different"' };
        }
        return null;
      }),
    });
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('a request pointer that is not the canonical Initial Assessment row stops with ia_pointer_mismatch', async () => {
    mockDataverse({ request: requestReadback({ _wmkf_currentinitialassessment_value: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) });
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
  });

  // Stage C round 2 (Opus P2/P3): previously-untested arms of existing stop
  // rules, each verified to be load-bearing by a mutation run (see the
  // build report).

  it('a size-only difference between the two retained snapshot metadata reads stops with ia_verification_failed', async () => {
    mockDataverse();
    let call = 0;
    // listFiles reports the SAME (mutated) size the second metadata read
    // returns, so the census/reverifyClone cross-checks cannot independently
    // catch this -- only the before/after double-read's own size comparison can.
    const mutatedSize = snapshotMetadata().size + 1;
    const graph = baseGraph({
      listFiles: jest.fn(async () => [
        { id: BASIC_ITEM_ID, name: BASIC_FILENAME, folder: BASIC_FOLDER, size: BASIC_FILE_BYTES.length },
        { id: iaId, name: 'ia.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`, size: iaBuffer.length },
        { id: snapId, name: 'snap.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, size: mutatedSize },
      ]),
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        if (itemId === snapId) {
          call += 1;
          return call === 1 ? snapshotMetadata() : { ...snapshotMetadata(), size: mutatedSize };
        }
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('a lastModified-only difference between the two retained snapshot metadata reads stops with ia_verification_failed', async () => {
    mockDataverse();
    let call = 0;
    const graph = baseGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        if (itemId === snapId) {
          call += 1;
          return call === 1 ? snapshotMetadata() : { ...snapshotMetadata(), lastModified: '2026-09-25T00:00:00Z' };
        }
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('a snapshot row whose source content hash no longer matches the current Initial Assessment stops with ia_snapshot_stale', async () => {
    mockDataverse({ snapshot: snapshotRow({ wmkf_sourcecontenthash: 'f'.repeat(64) }) });
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_snapshot_stale');
  });

  it('retained snapshot bytes that no longer hash to the row\'s own or source content hash stop with ia_verification_failed', async () => {
    mockDataverse();
    // A DETERMINISTIC different-but-valid DOCX (rendered once, reused for
    // every downloadFile call) so reverifyClone's own raw-byte re-check
    // (which downloads a second time) cannot independently catch this via
    // docProps timestamp drift between two independent renders -- isolating
    // the failure to this step's own governed-hash-vs-row check.
    const differentSnapshotBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: 'A different rendered document', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return { buffer: iaBuffer };
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === snapId) return { buffer: differentSnapshotBytes };
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('an unexpected extra file in the destination folder stops with ia_verification_failed', async () => {
    mockDataverse();
    const graph = baseGraph({
      listFiles: jest.fn(async () => [
        { id: BASIC_ITEM_ID, name: BASIC_FILENAME, folder: BASIC_FOLDER, size: BASIC_FILE_BYTES.length },
        { id: iaId, name: 'ia.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`, size: iaBuffer.length },
        { id: snapId, name: 'snap.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, size: iaBuffer.length },
        { id: '01UNEXPECTEDFILEABCDEFGHIJKLMNOPQ', name: 'unexpected.pdf', folder: `${REQUEST_FOLDER}/AI Materials`, size: 10 },
      ]),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('a mutated Basic-recipe copied file (bytes no longer match its journaled hash) stops with ia_verification_failed via reverifyClone', async () => {
    mockDataverse();
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return { buffer: iaBuffer };
        if (itemId === snapId) return { buffer: iaBuffer };
        if (itemId === BASIC_ITEM_ID) return { buffer: Buffer.from('mutated Basic-recipe bytes') };
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
  });

  it('a different, valid Ready Initial Assessment on the request (as a staff Generate would create) is refused with ia_pointer_mismatch', async () => {
    // Exactly ONE active Ready IA row exists (satisfying
    // resolveCanonicalInitialAssessment's own uniqueness/pointer checks on
    // their own), and the request's pointer correctly references it -- but
    // it is NOT the seed step's journaled requestDocumentId, isolating the
    // `expectedArtifactId` mismatch arm specifically (a staff Generate could
    // have superseded the seeded row with a new one after the seed step ran).
    const OTHER_READY_ID = '99999999-9999-4999-8999-999999999999';
    const otherReady = { ...iaRow(), wmkf_requestdocumentid: OTHER_READY_ID, wmkf_generationkey: 'e'.repeat(64) };
    mockDataverse({
      ia: otherReady,
      request: requestReadback({ _wmkf_currentinitialassessment_value: OTHER_READY_ID }),
    });
    const graph = baseGraph();
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
  });

  it('a canonical Initial Assessment SharePoint item that differs from the seed step\'s journaled item stops with ia_pointer_mismatch (Stage C round 2, P3-3)', async () => {
    mockDataverse({ ia: iaRow({ wmkf_sharepointitemid: '01DIFFERENTITEMABCDEFGHIJKLMNOPQ' }) });
    const graph = baseGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === '01DIFFERENTITEMABCDEFGHIJKLMNOPQ') return { ...iaMetadata(), id: itemId };
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
  });

  it('a canonical Board snapshot SharePoint item that differs from the snapshot step\'s journaled item stops with ia_pointer_mismatch (Stage C round 2, P3-3)', async () => {
    mockDataverse({ snapshot: snapshotRow({ wmkf_sharepointitemid: '01DIFFERENTSNAPABCDEFGHIJKLMNOPQ' }) });
    const graph = baseGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        if (itemId === '01DIFFERENTSNAPABCDEFGHIJKLMNOPQ') return { ...snapshotMetadata(), id: itemId };
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
  });
});
