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
import JSZip from 'jszip';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { assertLedgerReceipt, ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import {
  MANIFEST_V4, SANDBOX_URL, sha256, foundationBaselineDigest, validateCloneManifest, computeRunPlanDigest,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { REVIEW_FILE_COPY_POLICY, reviewFileCopyPolicyDigest } from '../../lib/services/test-requests/review-file-copy.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { SANDBOX_REHEARSAL_COPY_POLICY, copyPolicyDigest, planBundleFileCopies } from '../../lib/services/test-requests/bundle-file-copy.js';
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
    folder: `${REQUEST_NUMBER}_SOURCE/AI Materials`,
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
  // F2 (Codex slice 6c-ii Stage C round 1): an empty (not omitted) reviewers
  // section, so this same fixture also satisfies the pre-lease
  // `validateReviewFilePlan` check the "reviews recipe" test below now
  // exercises (a real `reviews`-recipe bundle always carries this section;
  // this fixture otherwise never seeds an actual reviewer).
  reviewers: [],
});

// Validator-shaped (Stage C round 2, P3): every field validateCloneManifest
// checks is present and consistent, so the fixture cannot drift from what a
// real prepared manifest looks like (see the fixture self-check test below).
// The values/createBody ids are the fixed fixture GUIDs rather than
// buildCloneManifest's random ones because the fake Dataverse routes on them.
const CREATE_BODY = Object.freeze({
  akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
  akoya_title: TITLE, akoya_fiscalyear: FISCAL_YEAR, akoya_purpose: PURPOSE, akoya_request: AMOUNT,
  akoya_requesttype: REQUEST_TYPE,
});
const CREATE_BODY_SHA256 = sha256(CREATE_BODY);

function baseManifest(overrides = {}) {
  const createBody = { ...CREATE_BODY };
  const plannedFiles = planBundleFileCopies(bundle);
  return {
    kind: MANIFEST_V4, recipe: 'initial_assessment',
    preparedAt: bundle.exportedAt, expiresAt: bundle.exportedAt,
    target: SANDBOX_URL,
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: MEETING_DATE },
    source: {
      requestId: SOURCE_ID, requestNumber: REQUEST_NUMBER, revision: '1', requestType: REQUEST_TYPE,
      dataverseHost: PROD_HOST, exportedAt: bundle.exportedAt, bundleSha256: sha256(bundle),
    },
    bundle,
    plannedFiles,
    createBody,
    createBodySha256: CREATE_BODY_SHA256,
    copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
    expectedRequestType: { value: REQUEST_TYPE },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: ORG_ID },
    expectedGraphSiteId: EXPECTED_SITE_ID,
    expectedGraphDriveId: EXPECTED_DRIVE_ID,
    invariants: {
      exactlyOneCreate: true, retryOnAmbiguousCreate: false, retryOnAmbiguousFileUpload: false,
      deleteOrReset: false, expectedPayments: 0, expectedRegardingEmails: 0, expectedDynamicsLocations: 1,
      expectedSharePointFiles: plannedFiles.length,
    },
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
    '_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue': 'Synthetic University',
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
    // Reached only by the `reviews` recipe (slice 6c-i): verify_initial_assessment
    // advances instead of marking ready, since it is not that recipe's final step.
    async advanceStep({
      leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, destinationRequestNumber,
    }) {
      calls.push({ op: 'advanceStep', nextStep, nextStepIndex, status, destinationRequestNumber });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = {
        ...run, currentStep: nextStep, stepIndex: nextStepIndex, status: status ?? run.status,
        destinationRequestNumber: destinationRequestNumber ?? run.destinationRequestNumber, version: run.version + 1,
      };
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
    // F2: only reached for the `reviews`-recipe test below (this file's
    // shared bundle carries an empty reviewers section, so an empty
    // assignments list is the correct fixture -- no reviewer is actually
    // seeded in this file's fixtures).
    async listRunReviewerAssignments() { return []; },
  };
  return { ledger, calls };
}

function baseRun(overrides = {}) {
  return {
    runId: RUN_ID, recipe: 'initial_assessment', status: 'creating',
    currentStep: 'verify_initial_assessment', stepIndex: 9, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: CREATE_BODY_SHA256, bundleSha256: sha256(bundle), copyPolicyDigest: copyPolicyDigest(),
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
// HEX64 governed hash of the fixture DOCX, set in the describe's beforeAll;
// the receipts below carry it because every producer path journals it.
let anchorHashHex = null;
// Raw SHA-256 of the fixture DOCX bytes (the `bytesSha256` receipt key the
// seed and snapshot steps journal before their PUTs), set in beforeAll.
let anchorBytesSha256 = null;
function seedResourceRow(overrides = {}) {
  return {
    resourceId: 2, sequence: 2, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId, contentHash: anchorHashHex, sourceVersionId: '1.0', bytesSha256: anchorBytesSha256 },
    outcome: 'advanced',
    ...overrides,
  };
}
function snapshotResourceRow(overrides = {}) {
  return {
    resourceId: 3, sequence: 3, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: anchorHashHex, versionId: '1.0', bytesSha256: anchorBytesSha256 },
    outcome: 'advanced',
    ...overrides,
  };
}

async function runStep({
  deps = {}, resources, requestRow, manifestOverrides = {}, runOverrides = {}, bundle: bundleForAdvance = null,
} = {}) {
  const run0 = baseRun(runOverrides);
  const { ledger, calls } = createFakeLedger(run0, resources);
  const manifest = baseManifest(manifestOverrides);
  const result = await bypassDynamicsRestrictions('test:verify-initial-assessment', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle: bundleForAdvance,
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
    anchorHashHex = governedHashToHex(iaHash);
    anchorBytesSha256 = crypto.createHash('sha256').update(iaBuffer).digest('hex');
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
      wmkf_sharepointversionid: '1.0',
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

  it('fixture self-check: the base manifest is validator-shaped (Stage C round 2, P3)', () => {
    expect(() => validateCloneManifest(baseManifest(), { allowExpired: true })).not.toThrow();
    expect(baseManifest().invariants.expectedSharePointFiles).toBe(bundle.documents.length);
  });

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

  // Slice 6c-i: `reviews` is cumulative on `initial_assessment`, so this same
  // step body must ADVANCE (never markReady) for that recipe -- pinning the
  // per-recipe terminal branch (mutation target: "IA verify marking ready on
  // reviews" would make this assert markReady called once instead).
  it('reviews recipe: the same verification passes but ADVANCES to seed_reviewers instead of marking ready', async () => {
    mockDataverse();
    const graph = baseGraph();
    // F2 (Codex slice 6c-ii Stage C round 1): the pre-lease check now binds
    // a `reviews` manifest to the live review-file copy policy and
    // recomputes the plan digest from the manifest plus the ledger's
    // (empty, in this fixture) reviewer-assignment addresses -- both must
    // agree with `run.planDigest`, and the real bundle (with its empty
    // `reviewers: []` section) must be passed, not `null`.
    const manifestOverrides = {
      recipe: 'reviews',
      reviewFilePolicy: { version: REVIEW_FILE_COPY_POLICY.version, digest: reviewFileCopyPolicyDigest() },
    };
    const planDigest = computeRunPlanDigest({ manifest: baseManifest(manifestOverrides), reviewerAddressDigests: [] });
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
      manifestOverrides,
      runOverrides: { recipe: 'reviews', planDigest },
      bundle,
    });

    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('seed_reviewers');
    expect(result.run.status).not.toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'advanceStep')).toHaveLength(1);
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
    // Isolating assertions (Stage C round 2, V3): the eTag arm of the twin
    // read must be what fires -- its own message, and the step must stop
    // before reverifyClone's third metadata read of the snapshot item, which
    // would otherwise catch the same eTag change later.
    expect(result.errorMessage).toBe('The Board snapshot file changed while it was being verified.');
    expect(call).toBe(2);
  });

  it('a versionId-only difference between the two retained snapshot metadata reads stops with ia_verification_failed', async () => {
    mockDataverse();
    let call = 0;
    const graph = baseGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return iaMetadata();
        if (itemId === BASIC_ITEM_ID) return basicMetadata();
        if (itemId === snapId) {
          call += 1;
          return call === 1 ? snapshotMetadata() : { ...snapshotMetadata(), versionId: '2.0' };
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
    expect(result.errorMessage).toBe('The Board snapshot file changed while it was being verified.');
    expect(call).toBe(2);
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
    expect(result.errorMessage).toBe('The Board snapshot file changed while it was being verified.');
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
    expect(result.errorMessage).toBe('The Board snapshot file changed while it was being verified.');
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

  // Receipt anchors (Codex adversarial round 1, F3): the rows' content
  // hashes and SharePoint versions must equal what the seed and snapshot
  // steps journaled when they committed, so an in-place replacement of a
  // file plus a consistent rewrite of the row's hash cannot verify.
  const anchoredSeed = () => seedResourceRow({ readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId, contentHash: governedHashToHex(iaHash), sourceVersionId: '1.0', bytesSha256: anchorBytesSha256 } });
  const anchoredSnapshot = () => snapshotResourceRow({ readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: governedHashToHex(iaHash), versionId: '1.0', bytesSha256: anchorBytesSha256 } });

  // Complete-package attestation (owner decision 2026-09-24, Codex round 2
  // F6, reshaped by the first live run): the downloaded package must equal
  // the fresh render part by part except SharePoint's characterized property
  // promotion. Cases: (a) a second render (only docProps/core.xml differs)
  // verifies; (b) SharePoint-shaped promotion verifies; (c) Codex's attack,
  // a foreign customXml payload with the same governed hash, is refused.
  async function withParts(bytes, mutate) {
    const zip = await JSZip.loadAsync(bytes);
    await mutate(zip);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
  const SP_SCHEMA = '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" ma:contentTypeName="Document" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"></ct:contentTypeSchema>';
  const SP_PROPS = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{6B761DE0-9541-4BAA-A2C3-622F827B4A03}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>';
  const SP_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>';
  async function sharePointPromoted(bytes) {
    return withParts(bytes, async (zip) => {
      zip.file('customXml/item1.xml', SP_SCHEMA);
      zip.file('customXml/itemProps1.xml', SP_PROPS);
      zip.file('customXml/_rels/item1.xml.rels', SP_RELS);
      zip.file('[trash]/0000.dat', Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(12)]));
      zip.file('docProps/custom.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="ContentTypeId"/></Properties>');
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'));
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
    });
  }
  function downloadsWith(iaBytes, snapshotBytes) {
    return baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === iaId) return { buffer: iaBytes };
        if (itemId === snapId) return { buffer: snapshotBytes };
        return null;
      }),
    });
  }
  const anchoredResources = () => [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()];

  it('package attestation: a second render of the fixture (only docProps/core.xml differs) still reaches markReady', async () => {
    const rerendered = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: TITLE, institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    expect(Buffer.compare(rerendered, iaBuffer)).not.toBe(0);
    mockDataverse();
    const { result, calls } = await runStep({ deps: { graph: downloadsWith(rerendered, rerendered) }, requestRow: requestReadback(), resources: anchoredResources() });
    expect(result.errorMessage).toBeUndefined();
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('package attestation: SharePoint property promotion (customXml items, props, rels, custom.xml, trash, content types) still reaches markReady', async () => {
    const promoted = await sharePointPromoted(iaBuffer);
    expect(await hashGovernedDocxContent(promoted)).toBe(iaHash);
    mockDataverse();
    const { result, calls } = await runStep({ deps: { graph: downloadsWith(promoted, promoted) }, requestRow: requestReadback(), resources: anchoredResources() });
    expect(result.errorMessage).toBeUndefined();
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('package attestation: a foreign customXml payload with the SAME governed hash (Codex round 2 F6) stops with ia_verification_failed', async () => {
    const attacked = await withParts(iaBuffer, async (zip) => { zip.file('customXml/item7.xml', '<?xml version="1.0"?><payload xmlns="urn:foreign">hidden</payload>'); });
    expect(await hashGovernedDocxContent(attacked)).toBe(iaHash);
    mockDataverse();
    const { result, calls } = await runStep({ deps: { graph: downloadsWith(attacked, iaBuffer) }, requestRow: requestReadback(), resources: anchoredResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toMatch(/^The downloaded Initial Assessment package differs from the synthetic render beyond SharePoint property promotion: customXml part customXml\/item7\.xml is not a SharePoint property-promotion item/);
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('package attestation: a foreign part outside customXml on the retained snapshot stops with ia_verification_failed', async () => {
    const attacked = await withParts(iaBuffer, async (zip) => { zip.file('hidden/payload.bin', Buffer.alloc(64, 7)); });
    mockDataverse();
    const { result } = await runStep({ deps: { graph: downloadsWith(iaBuffer, attacked) }, requestRow: requestReadback(), resources: anchoredResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toMatch(/^The retained Board snapshot package differs .*unexpected part hidden\/payload\.bin/);
  });

  // Fresh-render anchor (owner decision 2026-09-24): the row's governed hash
  // must equal a re-render of the synthetic fixture from the destination
  // Request's own fields, independent of any receipt.
  it('fresh-render anchor: an Initial Assessment whose row hash, bytes AND receipt all agree but do not equal a fresh synthetic render stops with ia_verification_failed', async () => {
    const foreignBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: 'Not the synthetic fixture title', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    const foreignHash = await hashGovernedDocxContent(foreignBytes);
    mockDataverse({ ia: iaRow({ wmkf_contenthash: foreignHash }), snapshot: snapshotRow({ wmkf_sourcecontenthash: foreignHash, wmkf_contenthash: foreignHash }) });
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === iaId || itemId === snapId) return { buffer: foreignBytes };
        return null;
      }),
    });
    const receiptHash = governedHashToHex(foreignHash);
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [
        baselineResource(validBaseline()),
        seedResourceRow({ readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId, contentHash: receiptHash, sourceVersionId: '1.0' } }),
        snapshotResourceRow({ readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: receiptHash, versionId: '1.0' } }),
        basicFileCopyResource(),
      ],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toBe('The Initial Assessment content hash does not match a fresh render of the synthetic fixture.');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('fresh-render anchor: a destination Request whose title changed after seeding stops with ia_verification_failed', async () => {
    mockDataverse({ request: requestReadback({ akoya_title: 'TEST: renamed after seeding' }) });
    const { result } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback({ akoya_title: 'TEST: renamed after seeding' }),
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toBe('The Initial Assessment content hash does not match a fresh render of the synthetic fixture.');
  });

  it('receipt anchors: a seed receipt that never journaled a content hash stops with ia_pointer_mismatch (anchors are mandatory)', async () => {
    mockDataverse();
    const { result, calls } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow({ readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId, sourceVersionId: '1.0' } }), snapshotResourceRow(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toBe('The Initial Assessment content hash does not match the hash the seed step journaled.');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('receipt anchors: consistent journaled hashes and versions still reach markReady', async () => {
    mockDataverse();
    const { result, calls } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), anchoredSeed(), anchoredSnapshot(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('receipt anchors: an Initial Assessment whose file AND row hash were both replaced consistently after the seed step stops with ia_pointer_mismatch', async () => {
    const replacedBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: 'A replaced Initial Assessment', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    const replacedHash = await hashGovernedDocxContent(replacedBytes);
    // Row and bytes agree with each other (every bytes-vs-row check passes);
    // only the seed receipt's journaled hash disagrees.
    mockDataverse({ ia: iaRow({ wmkf_contenthash: replacedHash }), snapshot: snapshotRow({ wmkf_sourcecontenthash: replacedHash, wmkf_contenthash: replacedHash }) });
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === iaId || itemId === snapId) return { buffer: replacedBytes };
        return null;
      }),
    });
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), anchoredSeed(), anchoredSnapshot(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toBe('The Initial Assessment content hash does not match the hash the seed step journaled.');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('receipt anchors: an Initial Assessment SharePoint version that differs from the journaled source version stops with ia_pointer_mismatch', async () => {
    mockDataverse({ ia: iaRow({ wmkf_sharepointversionid: '2.0' }) });
    const { result } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), anchoredSeed(), anchoredSnapshot(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toBe('The Initial Assessment SharePoint version does not match the version the seed step journaled.');
  });

  it('receipt anchors: a Board snapshot whose file AND row hashes were replaced consistently after the snapshot step stops with ia_pointer_mismatch', async () => {
    const replacedBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: 'A replaced Board snapshot', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    const replacedHash = await hashGovernedDocxContent(replacedBytes);
    // The snapshot row's own hash matches its bytes; its source hash still
    // matches the IA (so the ia_snapshot_stale check passes); only the
    // snapshot receipt's journaled hash disagrees.
    mockDataverse({ snapshot: snapshotRow({ wmkf_contenthash: replacedHash }) });
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === iaId) return { buffer: iaBuffer };
        if (itemId === snapId) return { buffer: replacedBytes };
        return null;
      }),
    });
    const { result } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), anchoredSeed(), anchoredSnapshot(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toBe('The Board snapshot content hash does not match the hash the snapshot step journaled.');
  });

  it('receipt anchors: a Board snapshot SharePoint version that differs from the journaled version stops with ia_pointer_mismatch', async () => {
    mockDataverse({ snapshot: snapshotRow({ wmkf_sharepointversionid: '2.0' }) });
    const { result } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), anchoredSeed(), anchoredSnapshot(), basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toBe('The Board snapshot SharePoint version does not match the version the snapshot step journaled.');
  });

  // Single-arm isolation of the bytes-versus-row-hash check (Stage C round 2,
  // V11a / V11b): each of the two arms must be able to fire alone.
  it('V11a: a snapshot row whose OWN content hash is corrupted while its source content hash and bytes are intact stops with ia_verification_failed', async () => {
    // The earlier `sourcecontenthash === iaRow.wmkf_contenthash` check still
    // passes (source hash intact), so only the row-hash arm can fire.
    const corruptedHash = `${GOVERNED_DOCX_HASH_PREFIX}${Buffer.alloc(32, 0xee).toString('base64url')}`;
    mockDataverse({ snapshot: snapshotRow({ wmkf_contenthash: corruptedHash }) });
    // The snapshot receipt journaled the same (wrong) hash, so the receipt
    // anchor passes and only the bytes-versus-row check can fire.
    const consistentReceipt = snapshotResourceRow({ readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: governedHashToHex(corruptedHash), versionId: '1.0' } });
    const { result, calls } = await runStep({
      deps: { graph: baseGraph() },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), consistentReceipt, basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toBe('The retained Board snapshot bytes do not match its own or its source content hash.');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('V11b: a snapshot whose bytes hash to its OWN content hash but not to its source content hash stops with ia_verification_failed', async () => {
    // A self-consistent snapshot row (own hash == bytes) that is nonetheless
    // not a copy of the source Initial Assessment: the source hash still
    // equals the IA row's hash (so the earlier ia_snapshot_stale check
    // passes), and only the source-hash arm of the bytes check can fire.
    const differentSnapshotBytes = await renderInitialAssessmentDocx({
      requestNumber: REQUEST_NUMBER, title: 'A snapshot that is not the source', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    const differentHash = await hashGovernedDocxContent(differentSnapshotBytes);
    expect(differentHash).not.toBe(iaHash);
    mockDataverse({ snapshot: snapshotRow({ wmkf_contenthash: differentHash, wmkf_sourcecontenthash: iaHash }) });
    const graph = baseGraph({
      downloadFile: jest.fn(async (driveId, itemId) => {
        if (itemId === iaId) return { buffer: iaBuffer };
        if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
        if (itemId === snapId) return { buffer: differentSnapshotBytes };
        return null;
      }),
    });
    // Receipt journaled the row's own (different) hash, so the receipt anchor
    // passes and only the source-hash arm of the bytes check can fire.
    const consistentReceipt = snapshotResourceRow({ readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: governedHashToHex(differentHash), versionId: '1.0' } });
    const { result, calls } = await runStep({
      deps: { graph },
      requestRow: requestReadback(),
      resources: [baselineResource(validBaseline()), seedResourceRow(), consistentReceipt, basicFileCopyResource()],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toBe('The retained Board snapshot bytes do not match its own or its source content hash.');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
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
