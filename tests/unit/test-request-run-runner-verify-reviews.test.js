/**
 * Test Request Factory slice 6c-ii Stage C — the `verify_reviews` step body
 * (lib/services/test-requests/run-runner.js `stepVerifyReviews`), the
 * `reviews` recipe's TERMINAL verifier.
 *
 * Reuses the exact IA/Basic fixture shape from
 * test-request-run-runner-verify-initial-assessment.test.js (buildSourceBundle,
 * fenceSource/observeStep/verifyClone/reverifyClone machinery, the sandbox
 * IA reader's fetch mocking) and extends it with a `reviewers[]` bundle
 * section, reviewer-assignment ledger reads, and the reviews-sandbox-deps.js
 * HTTP routes (person/suggestion/answers/list-suggestions), so the happy
 * path genuinely reaches markReady through the SAME two-file IA census plus
 * a seeded reviewer.
 *
 * @jest-environment node
 */

import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import {
  MANIFEST_V4, SANDBOX_URL, sha256, foundationBaselineDigest,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { SANDBOX_REHEARSAL_COPY_POLICY, copyPolicyDigest, planBundleFileCopies } from '../../lib/services/test-requests/bundle-file-copy.js';
import { SANDBOX_HOSTS, PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { hashGovernedDocxContent, GOVERNED_DOCX_HASH_PREFIX } from '../../lib/services/documents/governed-docx-hash.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import { SYNTHETIC_GENERATED } from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';
import { meetingDateToCycleCode } from '../../lib/utils/cycle-code.js';

function governedHashToHex(hash) {
  return Buffer.from(hash.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex');
}

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SEED_DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_DOCUMENT_ID = '55555555-5555-4555-4555-555555555555';
const LOCATION_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_PERSON_A = '77777777-7777-4777-8777-777777777771';
const DEST_PERSON_A = '88888888-8888-4888-8888-888888888881';
const DEST_SUGGESTION_A = '99999999-9999-4999-8999-999999999991';
const SANDBOX_HOST = SANDBOX_HOSTS[0];
const PROD_HOST = PRODUCTION_HOSTS[0];
const SANDBOX_BASE_URL = `https://${SANDBOX_HOST}/api/data/v9.2`;
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APP_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
const GRANT_CYCLE_CODE = meetingDateToCycleCode(MEETING_DATE)?.toUpperCase();

const BASIC_ITEM_ID = '01DEFGHIJKLMNOPQRSTUVWXYZ234567ABC';
const BASIC_FILENAME = `ProposalNarrative_${REQUEST_NUMBER}.pdf`;
const BASIC_FOLDER = `${REQUEST_FOLDER}/AI Materials`;
const BASIC_FILE_BYTES = Buffer.from('synthetic Basic-recipe proposal narrative bytes for verify_reviews');
const BASIC_FILE_SHA256 = crypto.createHash('sha256').update(BASIC_FILE_BYTES).digest('hex');

const REVIEW_ITEM_ID = '01REVIEWWWWWWWWWWWWWWWWWWWWWWWWWW1';
const REVIEW_FILE_BYTES = Buffer.from('synthetic reviewer-uploaded PDF review bytes');
const REVIEW_FILE_SHA256 = crypto.createHash('sha256').update(REVIEW_FILE_BYTES).digest('hex');
const ATTEMPT_ID = 'b'.repeat(32);
const REVIEW_SUBFOLDER = `Reviewer_${DEST_SUGGESTION_A.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const REVIEW_RELATIVE_FOLDER = `Reviewer_Uploads/${REVIEW_SUBFOLDER}/attempt_${ATTEMPT_ID}`;
const REVIEW_FULL_FOLDER = `${REQUEST_FOLDER}/${REVIEW_RELATIVE_FOLDER}`;

function bundleReviewerFixture({
  reviewForm = 'received_no_file', includeFiles = false, answers = ONE_ANSWER,
} = {}) {
  return {
    suggestionId: 'source-suggestion-1',
    personId: SOURCE_PERSON_A,
    person: {
      wmkf_name: 'Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
      wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University',
      wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
    },
    personIsSynthetic: false,
    suggestion: {
      wmkf_suggestionlabel: 'Auto-matched', wmkf_programarea: 'Science', wmkf_relevancescore: 88,
      wmkf_matchreason: 'Strong topical overlap', wmkf_sources: 'literature_retrieved',
      wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_declined: false,
      wmkf_responsetype: 100000000, wmkf_emailsentat: '2026-01-01T00:00:00Z', wmkf_responsereceivedat: '2026-01-02T00:00:00Z',
      wmkf_materialssentat: '2026-01-02T00:00:00Z',
      wmkf_reviewreceivedat: '2026-01-10T00:00:00Z', wmkf_completedat: '2026-01-10T00:00:00Z',
      wmkf_thankyousentat: null, wmkf_reviewstatus: 100000001, wmkf_revieweraffiliation: 'Example University',
      wmkf_reviewuploadedbystaff: includeFiles ? false : null,
      wmkf_reviewerfirstname: null, wmkf_reviewerlastname: null, wmkf_reviewernickname: null, wmkf_reviewertitle: null,
      wmkf_applicantdisposition: null,
    },
    answers,
    reviewForm,
    files: includeFiles ? [{
      id: 'source-suggestion-1:item-review', kind: 'reviewerUpload', library: 'akoya_request',
      folder: `${REQUEST_NUMBER}_SOURCE/Reviewer_Uploads/reviewer_abcd1234/attempt_11111111111111111111111111111111`,
      name: 'MyReview.pdf', driveId: 'b!sourceDriveIdSample000000000000', graphItemId: '01SOURCEREVIEW00000000000000000001',
      sharePointSite: { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' },
      size: REVIEW_FILE_BYTES.length, mimeType: 'application/pdf', eTag: '"source-review-1"', versionId: '1.0',
      contentHash: REVIEW_FILE_SHA256, suggestionId: 'source-suggestion-1',
    }] : [],
  };
}
const ONE_ANSWER = [{
  wmkf_questionkey: 'riskLevel', wmkf_questionorder: 1, wmkf_questiontext: 'Risk?', wmkf_questiontype: 'picklist',
  wmkf_answerhtml: null, wmkf_answertext: 'Low', wmkf_answervalue: 1, wmkf_answervalues: JSON.stringify(['low']), wmkf_questionoptions: JSON.stringify(['low', 'medium', 'high']),
}];

function buildBundle({ reviewForm, includeFiles, answers } = {}) {
  return buildSourceBundle({
    sourceRow: {
      akoya_requestid: SOURCE_ID, akoya_requestnum: REQUEST_NUMBER, akoya_requesttype: REQUEST_TYPE,
      akoya_purpose: PURPOSE, akoya_request: AMOUNT, akoya_fiscalyear: FISCAL_YEAR, wmkf_meetingdate: MEETING_DATE, versionnumber: 1,
    },
    documents: [{
      id: 'source-doc-1', kind: 'proposalNarrative', library: 'akoya_request',
      folder: `${REQUEST_NUMBER}_SOURCE/AI Materials`, name: `ProposalNarrative_${REQUEST_NUMBER}.pdf`,
      driveId: 'b!sourceDriveIdSample000000000000', graphItemId: '01SOURCEITEMABCDEFGHIJKLMNOPQR234',
      sharePointSite: { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' },
      size: BASIC_FILE_BYTES.length, mimeType: 'application/pdf', eTag: '"source-1"', versionId: '1.0', contentHash: BASIC_FILE_SHA256,
    }],
    reviewers: [bundleReviewerFixture({ reviewForm, includeFiles, answers })],
    dataverseHost: PROD_HOST,
    exportedAt: new Date(),
  });
}

const CREATE_BODY = Object.freeze({
  akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
  akoya_title: TITLE, akoya_fiscalyear: FISCAL_YEAR, akoya_purpose: PURPOSE, akoya_request: AMOUNT,
  akoya_requesttype: REQUEST_TYPE,
});
const CREATE_BODY_SHA256 = sha256(CREATE_BODY);

function baseManifest(bundle, overrides = {}) {
  const createBody = { ...CREATE_BODY };
  const plannedFiles = planBundleFileCopies(bundle);
  return {
    kind: MANIFEST_V4, recipe: 'reviews',
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
    akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, akoya_title: TITLE, akoya_purpose: PURPOSE,
    akoya_request: AMOUNT, akoya_fiscalyear: FISCAL_YEAR, akoya_requesttype: REQUEST_TYPE, wmkf_meetingdate: MEETING_DATE,
    wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID, wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false,
    wmkf_phaseiistatus: null, akoya_recommendedamount: null, akoya_originalgrantamount: null, akoya_submissionaccepted: false,
    _akoya_applicantid_value: ORG_ID,
    '_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue': 'Synthetic University',
    _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
    _wmkf_currentinitialassessment_value: SEED_DOCUMENT_ID,
    '@odata.etag': 'W/"request-1"',
    ...overrides,
  };
}

function locationRow() {
  return {
    sharepointdocumentlocationid: LOCATION_ID, name: REQUEST_FOLDER, relativeurl: REQUEST_FOLDER,
    absoluteurl: `https://example.sharepoint.com/sites/akoyago/akoya_request/${REQUEST_FOLDER}`,
    _parentsiteorlocation_value: 'parent-1', _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, createdon: '2026-09-24T00:00:00Z',
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
      if (requestPath.startsWith('/sharepointdocumentlocations(')) {
        return { ok: true, status: 200, body: { sharepointdocumentlocationid: 'parent-1', name: 'akoya_request', relativeurl: 'akoya_request', absoluteurl: 'https://example.sharepoint.com/sites/akoyago/akoya_request', _parentsiteorlocation_value: 'site-x' } };
      }
      if (requestPath.startsWith('/sharepointdocumentlocations?') && requestPath.includes('$filter=relativeurl')) {
        return { ok: true, status: 200, body: { value: [{ sharepointdocumentlocationid: 'parent-1', name: 'akoya_request', relativeurl: 'akoya_request', _parentsiteorlocation_value: 'site-x' }] } };
      }
      if (requestPath.startsWith('/sharepointdocumentlocations?')) return { ok: true, status: 200, body: { value: [locationRow()] } };
      if (requestPath.startsWith('/systemusers')) return { ok: true, status: 200, body: { value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] } };
      if (requestPath.startsWith('/contacts')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith('/akoya_requestpayments')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith('/emails')) return { ok: true, status: 200, body: { value: [] } };
      if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: requestRow };
      throw new Error(`unexpected preflight/client path: ${requestPath}`);
    }),
  };
}

let cachedDocxBytes = null;
async function docxBytes() {
  if (!cachedDocxBytes) {
    cachedDocxBytes = await renderInitialAssessmentDocx({ requestNumber: REQUEST_NUMBER, title: TITLE, institution: 'Synthetic University', generated: SYNTHETIC_GENERATED });
  }
  return cachedDocxBytes;
}
const iaId = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const snapId = '01BCDEFGHIJKLMNOPQRSTUVWXYZ234567A';

function fakeGraph({ includeReview = false, overrides = {} } = {}) {
  return {
    getSiteId: jest.fn(async () => EXPECTED_SITE_ID),
    getDriveId: jest.fn(async () => EXPECTED_DRIVE_ID),
    listFiles: jest.fn(async () => [
      { id: BASIC_ITEM_ID, name: BASIC_FILENAME, folder: BASIC_FOLDER, size: BASIC_FILE_BYTES.length },
      { id: iaId, name: 'ia.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
      { id: snapId, name: 'snap.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
      ...(includeReview ? [{ id: REVIEW_ITEM_ID, name: 'Review_1.pdf', folder: REVIEW_FULL_FOLDER, size: REVIEW_FILE_BYTES.length }] : []),
    ]),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (itemId === iaId) return { driveId: EXPECTED_DRIVE_ID, id: iaId, name: 'ia.docx', size: cachedDocxBytes.length, eTag: '"ia-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/ia' };
      if (itemId === snapId) return { driveId: EXPECTED_DRIVE_ID, id: snapId, name: 'snap.docx', size: cachedDocxBytes.length, eTag: '"snap-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/snap' };
      if (itemId === BASIC_ITEM_ID) return { driveId: EXPECTED_DRIVE_ID, id: BASIC_ITEM_ID, name: BASIC_FILENAME, size: BASIC_FILE_BYTES.length, eTag: '"basic-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/basic' };
      if (includeReview && itemId === REVIEW_ITEM_ID) return { driveId: EXPECTED_DRIVE_ID, id: REVIEW_ITEM_ID, name: 'Review_1.pdf', size: REVIEW_FILE_BYTES.length, eTag: '"review-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/review' };
      return null;
    }),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (itemId === iaId) return { buffer: cachedDocxBytes };
      if (itemId === snapId) return { buffer: cachedDocxBytes };
      if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
      if (includeReview && itemId === REVIEW_ITEM_ID) return { buffer: REVIEW_FILE_BYTES };
      return null;
    }),
    ...overrides,
  };
}

function createFakeLedger(initialRun, initialResources = [], assignments = []) {
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
    async advanceStep() { throw new Error('verify_reviews must never advance -- it is always terminal'); },
    async markNeedsAttention({ leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      const storedReason = ledgerReasonOrThrow(reason);
      const storedError = error == null ? null : ledgerReasonOrThrow(error);
      run = { ...run, status: 'needs_attention', needsAttentionReason: storedReason, lastError: storedError ?? run.lastError ?? null, leaseToken: null, lockedUntil: null, version: run.version + 1 };
      return { ...run };
    },
    async journalPlannedResource() { throw new Error('verify_reviews must not journal new resources'); },
    async recordResourceReadback() { throw new Error('verify_reviews must not journal new resources'); },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
    async listRunReviewerAssignments() { return assignments.map(({ address, ...rest }) => ({ ...rest })); },
    async getRunReviewerAssignment(_runId, sequence) { return assignments.find((a) => a.sequence === sequence) || null; },
  };
  return { ledger, calls };
}

function baseRun(overrides = {}, bundle) {
  return {
    runId: RUN_ID, recipe: 'reviews', status: 'creating',
    currentStep: 'verify_reviews', stepIndex: 13, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: CREATE_BODY_SHA256, bundleSha256: sha256(bundle), copyPolicyDigest: copyPolicyDigest(),
    sourceRequestId: SOURCE_ID, sourceRequestNumber: REQUEST_NUMBER, sourceRevision: '1',
    destinationRequestId: REQUEST_ID, destinationLocationId: LOCATION_ID, destinationRequestNumber: REQUEST_NUMBER,
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
let anchorHashHex = null;
let anchorBytesSha256 = null;
function seedResourceRow() {
  return {
    resourceId: 2, sequence: 2, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SEED_DOCUMENT_ID, itemId: iaId, contentHash: anchorHashHex, sourceVersionId: '1.0', bytesSha256: anchorBytesSha256 },
    outcome: 'advanced',
  };
}
function snapshotResourceRow() {
  return {
    resourceId: 3, sequence: 3, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
    readback: { requestDocumentId: SNAPSHOT_DOCUMENT_ID, itemId: snapId, contentHash: anchorHashHex, versionId: '1.0', bytesSha256: anchorBytesSha256 },
    outcome: 'advanced',
  };
}
function basicFileCopyResource() {
  return {
    resourceId: 4, sequence: 4, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
    readback: {
      index: 0, filename: BASIC_FILENAME, folder: BASIC_FOLDER, library: 'akoya_request',
      size: BASIC_FILE_BYTES.length, contentHash: BASIC_FILE_SHA256,
      driveId: EXPECTED_DRIVE_ID, itemId: BASIC_ITEM_ID, eTag: '"basic-1"', versionId: '1.0',
    },
    outcome: 'verified',
  };
}
function personResource() {
  return {
    resourceId: 5, sequence: 5, step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
    plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: 'a'.repeat(64) },
    readback: { destinationPersonId: DEST_PERSON_A }, outcome: 'verified',
  };
}
function suggestionResource() {
  return {
    resourceId: 6, sequence: 6, step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
    plannedIdentity: { assignmentSequence: 1, suggestionId: DEST_SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
    readback: { suggestionId: DEST_SUGGESTION_A }, outcome: 'verified',
  };
}
function answersResource({ eTagAfter = 'W/"2"' } = {}) {
  return {
    resourceId: 7, sequence: 7, step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
    plannedIdentity: { assignmentSequence: 1, suggestionId: DEST_SUGGESTION_A, reviewForm: 'received_no_file', answerCount: 1 },
    readback: { suggestionId: DEST_SUGGESTION_A, eTagAfter, answerCount: 1 }, outcome: 'verified',
  };
}
function reviewFolderResource() {
  return {
    resourceId: 8, sequence: 8, step: 'copy_review_file', resourceKind: 'sharepoint_folder', system: 'sharepoint',
    plannedIdentity: { assignmentSequence: 1, folder: REVIEW_RELATIVE_FOLDER },
    readback: { filename: 'Review_1.pdf' }, outcome: 'verified',
  };
}
function reviewFileResource() {
  return {
    resourceId: 9, sequence: 9, step: 'copy_review_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
    plannedIdentity: { assignmentSequence: 1, index: 0, filename: 'Review_1.pdf' },
    readback: {
      index: 0, filename: 'Review_1.pdf', folder: REVIEW_FULL_FOLDER, library: 'akoya_request',
      size: REVIEW_FILE_BYTES.length, contentHash: REVIEW_FILE_SHA256,
      driveId: EXPECTED_DRIVE_ID, itemId: REVIEW_ITEM_ID, eTag: '"review-1"', versionId: '1.0',
    },
    outcome: 'verified',
  };
}

const ASSIGNMENT = { sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64), address: 'throwaway@example.test' };

function iaRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: SEED_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000002,
    wmkf_producer: 'request-workbench', _wmkf_request_value: REQUEST_ID, wmkf_generationkey: 'a'.repeat(64),
    wmkf_sharepointdriveid: EXPECTED_DRIVE_ID, wmkf_sharepointitemid: iaId, wmkf_sharepointsiteid: EXPECTED_SITE_ID,
    wmkf_sharepointversionid: '1.0', wmkf_sharepointfolderpath: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`,
    wmkf_contenthash: cachedIaHash, ...overrides,
  };
}
function snapshotRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: SNAPSHOT_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000002,
    wmkf_producer: 'request-workbench-board-snapshot', _wmkf_request_value: REQUEST_ID, _wmkf_sourcedocument_value: SEED_DOCUMENT_ID,
    wmkf_generationkey: 'c'.repeat(64), wmkf_sharepointdriveid: EXPECTED_DRIVE_ID, wmkf_sharepointitemid: snapId, wmkf_sharepointsiteid: EXPECTED_SITE_ID,
    wmkf_sharepointversionid: '1.0', wmkf_sourceversionid: '1.0', wmkf_sourcecontenthash: cachedIaHash, wmkf_contenthash: cachedIaHash,
    wmkf_sharepointfolderpath: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, ...overrides,
  };
}

let cachedIaHash = null;

/** The reviews-sandbox-deps.js person row a get would read back, from the bundle reviewer + address (syntheticPersonProjection). */
function personRow(bundleReviewer, overrides = {}) {
  const p = bundleReviewer.person;
  return {
    wmkf_potentialreviewersid: DEST_PERSON_A,
    wmkf_name: `TEST · ${p.wmkf_name}`, wmkf_firstname: p.wmkf_firstname, wmkf_lastname: p.wmkf_lastname,
    wmkf_emailaddress: ASSIGNMENT.address, wmkf_issyntheticreviewer: true,
    wmkf_areaofexpertise: p.wmkf_areaofexpertise, wmkf_primaryaffiliation: p.wmkf_primaryaffiliation,
    wmkf_academicrank: p.wmkf_academicrank, wmkf_primarydepartment: p.wmkf_primarydepartment, wmkf_maininstitution: p.wmkf_maininstitution,
    wmkf_organizationname: p.wmkf_primaryaffiliation,
    statecode: 0, _wmkf_contact_value: null,
    '@odata.etag': 'W/"person-1"',
    ...overrides,
  };
}

function suggestionRowFor(bundleReviewer, { pointers = null, eTag = 'W/"2"', overrides = {} } = {}) {
  const s = bundleReviewer.suggestion;
  return {
    wmkf_appreviewersuggestionid: DEST_SUGGESTION_A,
    _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID,
    ...s,
    wmkf_thankyousentat: s.wmkf_thankyousentat ?? s.wmkf_reviewreceivedat ?? null, // D-R6
    wmkf_grantcyclecode: GRANT_CYCLE_CODE,
    wmkf_reviewsharepointfolder: pointers?.folder ?? null,
    wmkf_reviewfilename: pointers?.filename ?? null,
    '@odata.etag': eTag,
    ...overrides,
  };
}

function mockDataverse({
  ia = iaRow(), snapshot = snapshotRow(), request = requestReadback(), person, suggestion, answers = ONE_ANSWER, liveSuggestionIds = [DEST_SUGGESTION_A],
} = {}) {
  fetch.mockImplementation((url) => {
    const href = String(url);
    if (href.includes('login.microsoftonline.com')) return tokenResponse();
    if (href.startsWith(`https://${SANDBOX_HOST}/api/data/v9.2/akoya_requests(${REQUEST_ID})`)) return jsonResponse(request);
    if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [ia, snapshot].filter(Boolean) });
    if (href.includes(`wmkf_potentialreviewerses(${DEST_PERSON_A})`)) return jsonResponse(person);
    if (href.includes(`wmkf_appreviewersuggestions(${DEST_SUGGESTION_A})`)) return jsonResponse(suggestion);
    if (href.includes('wmkf_appreviewersuggestions?')) return jsonResponse({ value: liveSuggestionIds.map((id) => ({ wmkf_appreviewersuggestionid: id })) });
    if (href.includes('wmkf_appreviewanswers?')) return jsonResponse({ value: answers.map((a) => ({ ...a, '@odata.etag': 'W/"answer-1"' })) });
    throw new Error(`unexpected fetch to ${href}`);
  });
}

async function runStep({
  bundle, resources, assignments = [ASSIGNMENT], requestRow = requestReadback(), deps = {},
} = {}) {
  const run0 = baseRun({}, bundle);
  const { ledger, calls } = createFakeLedger(run0, resources, assignments);
  const manifest = baseManifest(bundle);
  const result = await bypassDynamicsRestrictions('test:verify-reviews', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle,
    deps: { client: fakeClient({ requestRow }), graph: fakeGraph(), sharePointTarget: SHARE_POINT_TARGET, ...deps },
  }));
  return { result, calls };
}

const validBaseline = () => foundationBaselineDigest({ accountid: ORG_ID, versionnumber: 1 }, []);

describe('stepVerifyReviews', () => {
  beforeAll(async () => {
    const iaBuffer = await docxBytes();
    const iaHash = await hashGovernedDocxContent(iaBuffer);
    cachedIaHash = iaHash;
    anchorHashHex = governedHashToHex(iaHash);
    anchorBytesSha256 = crypto.createHash('sha256').update(iaBuffer).digest('hex');
  });

  it('happy path (received_no_file, one answer): reaches markReady', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({ person: personRow(bundleReviewer), suggestion: suggestionRowFor(bundleReviewer) });
    const { result, calls } = await runStep({
      bundle,
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(), personResource(), suggestionResource(), answersResource()],
    });
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('happy path (uploaded, one PDF file): reaches markReady, census includes the review file', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    const { result, calls } = await runStep({
      bundle,
      resources: [
        baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(),
        personResource(), suggestionResource(),
        {
          resourceId: 7, sequence: 7, step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
          plannedIdentity: { assignmentSequence: 1, suggestionId: DEST_SUGGESTION_A, reviewForm: 'uploaded', answerCount: 0 },
          readback: { suggestionId: DEST_SUGGESTION_A, eTagAfter: 'W/"2"', answerCount: 0 }, outcome: 'verified',
        },
        reviewFolderResource(), reviewFileResource(),
      ],
      deps: { graph: fakeGraph({ includeReview: true }) },
    });
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  it('unreceived: fresh-default wmkf_reviewuploadedbystaff:false passes (Codex plan round 10)', async () => {
    const bundle = buildBundle({ reviewForm: 'unreceived', answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const suggestion = {
      wmkf_appreviewersuggestionid: DEST_SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID,
      ...bundleReviewer.suggestion,
      wmkf_reviewreceivedat: null, wmkf_completedat: null, wmkf_thankyousentat: null, wmkf_reviewstatus: null,
      wmkf_reviewuploadedbystaff: false, // Dataverse default readback, never null
      wmkf_grantcyclecode: GRANT_CYCLE_CODE, wmkf_reviewsharepointfolder: null, wmkf_reviewfilename: null,
      '@odata.etag': 'W/"1"',
    };
    mockDataverse({ person: personRow(bundleReviewer), suggestion, answers: [] });
    const { result } = await runStep({
      bundle,
      resources: [
        baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(),
        personResource(), suggestionResource(),
        {
          resourceId: 7, sequence: 7, step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
          plannedIdentity: { assignmentSequence: 1, reviewForm: 'unreceived' },
          readback: { suggestionId: DEST_SUGGESTION_A, answerCount: 0 }, outcome: 'verified',
        },
      ],
    });
    expect(result.outcome).toBe('ready');
  });

  const happyResources = () => [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(), personResource(), suggestionResource(), answersResource()];

  it('mutation: a mismatched person name (missing TEST prefix) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({ person: personRow(bundleReviewer, { wmkf_name: bundleReviewer.person.wmkf_name }), suggestion: suggestionRowFor(bundleReviewer) });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: a mismatched candidate field (wmkf_suggestionlabel) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { wmkf_suggestionlabel: 'Tampered label' } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: wmkf_thankyousentat NOT defaulted to the received time (D-R6) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { wmkf_thankyousentat: null } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: an answer row whose wmkf_answervalues differs canonically fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      answers: [{ ...ONE_ANSWER[0], wmkf_answervalues: JSON.stringify(['high']) }],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: a stale suggestion eTag (post-changeset drift) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { eTag: 'W/"999"' }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: an extra live suggestion beyond the seeded set fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      liveSuggestionIds: [DEST_SUGGESTION_A, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (branch swap): pointers set on a received_no_file review fail reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers: { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (branch swap): null pointers on an uploaded review fail reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers: null, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    const { result } = await runStep({
      bundle,
      resources: [
        baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(),
        personResource(), suggestionResource(),
        {
          resourceId: 7, sequence: 7, step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
          plannedIdentity: { assignmentSequence: 1, suggestionId: DEST_SUGGESTION_A, reviewForm: 'uploaded', answerCount: 0 },
          readback: { suggestionId: DEST_SUGGESTION_A, eTagAfter: 'W/"2"', answerCount: 0 }, outcome: 'verified',
        },
        reviewFolderResource(), reviewFileResource(),
      ],
      deps: { graph: fakeGraph({ includeReview: true }) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });
});
