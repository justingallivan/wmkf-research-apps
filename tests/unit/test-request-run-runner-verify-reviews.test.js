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
import JSZip from 'jszip';
import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import {
  MANIFEST_V4, SANDBOX_URL, sha256, foundationBaselineDigest, computeRunPlanDigest,
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
    // F2: bound to the LIVE review-file copy policy (assertRunMatchesManifestAndBundle
    // checks this against reviewFileCopyPolicyDigest() directly, never against
    // a run-row column), so this must be the real function's output, not a placeholder.
    reviewFilePolicy: { version: REVIEW_FILE_COPY_POLICY.version, digest: reviewFileCopyPolicyDigest() },
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

// Folder depth below the Request folder (the Request folder itself is 0),
// mirroring lib/services/graph/files.js which recurses while
// `depth < maxDepth` and so lists files in folders at depth 0..maxDepth.
function folderDepthBelowRequest(folder) {
  const rel = folder.slice(REQUEST_FOLDER.length).replace(/^\//, '');
  return rel ? rel.split('/').length : 0;
}

function fakeGraph({ includeReview = false, docxReview = null, extraFiles = [], overrides = {} } = {}) {
  return {
    getSiteId: jest.fn(async () => EXPECTED_SITE_ID),
    getDriveId: jest.fn(async () => EXPECTED_DRIVE_ID),
    // Honors `maxDepth` like the real walker does (Codex F4): a file whose
    // folder is deeper than the requested depth is NOT listed.
    listFiles: jest.fn(async (parent, location, options = {}) => [
      ...extraFiles,
      { id: BASIC_ITEM_ID, name: BASIC_FILENAME, folder: BASIC_FOLDER, size: BASIC_FILE_BYTES.length },
      { id: iaId, name: 'ia.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
      { id: snapId, name: 'snap.docx', folder: `${REQUEST_FOLDER}/Artifacts/Initial Assessment/Board Milestones`, size: cachedDocxBytes ? cachedDocxBytes.length : 0 },
      ...(includeReview ? [{ id: REVIEW_ITEM_ID, name: 'Review_1.pdf', folder: REVIEW_FULL_FOLDER, size: REVIEW_FILE_BYTES.length }] : []),
      // P1-1 regression test fixture: the LISTED size is the SharePoint-
      // promoted (destination) size, deliberately different from the
      // source's size -- proving the census compares against the
      // journaled `itemSize`, never the source's `size`.
      ...(docxReview ? [{ id: docxReview.destItemId, name: 'Review_1.docx', folder: REVIEW_FULL_FOLDER, size: docxReview.destBuffer.length }] : []),
    ].filter((file) => !Number.isInteger(options.maxDepth) || folderDepthBelowRequest(file.folder) <= options.maxDepth)),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (itemId === iaId) return { driveId: EXPECTED_DRIVE_ID, id: iaId, name: 'ia.docx', size: cachedDocxBytes.length, eTag: '"ia-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/ia' };
      if (itemId === snapId) return { driveId: EXPECTED_DRIVE_ID, id: snapId, name: 'snap.docx', size: cachedDocxBytes.length, eTag: '"snap-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/snap' };
      if (itemId === BASIC_ITEM_ID) return { driveId: EXPECTED_DRIVE_ID, id: BASIC_ITEM_ID, name: BASIC_FILENAME, size: BASIC_FILE_BYTES.length, eTag: '"basic-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/basic' };
      if (includeReview && itemId === REVIEW_ITEM_ID) return { driveId: EXPECTED_DRIVE_ID, id: REVIEW_ITEM_ID, name: 'Review_1.pdf', size: REVIEW_FILE_BYTES.length, eTag: '"review-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/review' };
      if (docxReview && itemId === docxReview.destItemId) return { driveId: EXPECTED_DRIVE_ID, id: docxReview.destItemId, name: 'Review_1.docx', size: docxReview.destBuffer.length, eTag: '"review-docx-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/review-docx' };
      if (docxReview && itemId === docxReview.sourceItemId) return { driveId: docxReview.sourceDriveId, id: docxReview.sourceItemId, name: 'MyReview.docx', size: docxReview.sourceBuffer.length, eTag: docxReview.sourceETag, versionId: '1.0', lastModified: '2026-09-24T00:00:00Z', webUrl: 'https://x/review-docx-source' };
      return null;
    }),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (itemId === iaId) return { buffer: cachedDocxBytes };
      if (itemId === snapId) return { buffer: cachedDocxBytes };
      if (itemId === BASIC_ITEM_ID) return { buffer: BASIC_FILE_BYTES };
      if (includeReview && itemId === REVIEW_ITEM_ID) return { buffer: REVIEW_FILE_BYTES };
      if (docxReview && itemId === docxReview.destItemId) return { buffer: docxReview.destBuffer };
      if (docxReview && itemId === docxReview.sourceItemId) return { buffer: docxReview.sourceBuffer };
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
    readback: eTagAfter == null
      ? { suggestionId: DEST_SUGGESTION_A, answerCount: 1 }
      : { suggestionId: DEST_SUGGESTION_A, eTagAfter, answerCount: 1 },
    outcome: 'verified',
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
      size: REVIEW_FILE_BYTES.length, contentHash: REVIEW_FILE_SHA256, mimeType: 'application/pdf',
      driveId: EXPECTED_DRIVE_ID, itemId: REVIEW_ITEM_ID, eTag: '"review-1"', versionId: '1.0',
    },
    outcome: 'verified',
  };
}

const DOCX_SOURCE_ITEM_ID = `01${'E'.repeat(32)}`;
const DOCX_DEST_ITEM_ID = `01${'F'.repeat(32)}`;

/**
 * Build a minimal real DOCX and a SharePoint-"promoted" copy for the P1-1
 * DOCX-through-verifier regression. Mirrors the exact tolerated mutation
 * used by test-request-run-runner-copy-review-file.test.js's DOCX
 * end-to-end test (metadata-part rewrite only, via `attestDocxPackageAgainstSource`'s
 * METADATA_PARTS allowance for docProps/core.xml) so this fixture is known
 * to pass attestation and isolates the itemSize census bug.
 */
async function buildDocxReviewFixture() {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="ns"><w:body><w:p/></w:body></w:document>');
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>source</dc:title><cp:lastModifiedBy>Un-named</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-25T03:32:30Z</dcterms:modified></cp:coreProperties>');
  const sourceDocx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const promotedZip = await JSZip.loadAsync(sourceDocx);
  promotedZip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>rewritten by SharePoint promotion, longer than the source docProps/core.xml part</dc:title><cp:lastModifiedBy>Un-named</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-25T03:32:30Z</dcterms:modified></cp:coreProperties>');
  const destDocx = await promotedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { sourceDocx, destDocx };
}

function reviewFolderResourceDocx() {
  return {
    resourceId: 8, sequence: 8, step: 'copy_review_file', resourceKind: 'sharepoint_folder', system: 'sharepoint',
    plannedIdentity: { assignmentSequence: 1, folder: REVIEW_RELATIVE_FOLDER },
    readback: { filename: 'Review_1.docx' }, outcome: 'verified',
  };
}
function reviewFileResourceDocx({ sourceDocx, destDocx }) {
  return {
    resourceId: 9, sequence: 9, step: 'copy_review_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
    plannedIdentity: { assignmentSequence: 1, index: 0, filename: 'Review_1.docx' },
    readback: {
      index: 0, filename: 'Review_1.docx', folder: REVIEW_FULL_FOLDER, library: 'akoya_request',
      // `size` is the SOURCE's pre-copy size (never equal to the
      // destination's post-promotion size); `itemSize` is the destination's
      // own post-write size (P1-1) -- the census must use the latter.
      size: sourceDocx.length, itemSize: destDocx.length, contentHash: crypto.createHash('sha256').update(sourceDocx).digest('hex'),
      driveId: EXPECTED_DRIVE_ID, itemId: DOCX_DEST_ITEM_ID, eTag: '"review-docx-1"', versionId: '1.0',
      sourceDriveId: EXPECTED_DRIVE_ID, sourceGraphItemId: DOCX_SOURCE_ITEM_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      eTagBefore: '"source-docx-1"', sourceVersionId: '1.0',
      attestedDigest: crypto.createHash('sha256').update(destDocx).digest('hex'),
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
    wmkf_name: ` TEST · ${p.wmkf_firstname} ${p.wmkf_lastname} `, wmkf_firstname: `TEST · ${p.wmkf_firstname}`, wmkf_lastname: p.wmkf_lastname,
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
    if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
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
  bundle, resources, assignments = [ASSIGNMENT], requestRow = requestReadback(), deps = {}, manifestOverrides = {},
} = {}) {
  const manifest = baseManifest(bundle, manifestOverrides);
  // F2: the pre-lease check recomputes planDigest from the manifest plus
  // the ledger's own reviewer-assignment addressSha256 values.
  const planDigest = computeRunPlanDigest({ manifest, reviewerAddressDigests: assignments.map((a) => a.addressSha256) });
  const run0 = baseRun({ planDigest }, bundle);
  const { ledger, calls } = createFakeLedger(run0, resources, assignments);
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

  it('a destination person whose platform-derived name lacks the synthetic prefix refuses ready', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer, { wmkf_name: ' Jane Reviewer ' }),
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
    expect(result.outcome).toBe('needs_attention');
    expect(result.errorMessage).toMatch(/derived name does not carry the synthetic prefix/);
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('an inactive destination person (statecode 1) refuses ready even when every projected field matches', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer, { statecode: 1 }),
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
    expect(result.outcome).toBe('needs_attention');
    expect(result.errorMessage).toMatch(/destination person is not active/);
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  // Codex slice review round 1, F4: the default census depth (3) reaches
  // the attempt folder but not a folder nested INSIDE it, so a rogue file at
  // depth 4 was invisible to the terminal verifier. The fake walker honors
  // `maxDepth`, so this test is green only if verify_reviews asks for a
  // deeper census than the default.
  it('a rogue file nested inside an attempt folder (depth 4) is seen by the census and refuses ready (Codex F4)', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    expect(folderDepthBelowRequest(REVIEW_FULL_FOLDER)).toBe(3);
    const rogue = { id: 'rogue-depth-4', name: 'smuggled.bin', folder: `${REVIEW_FULL_FOLDER}/nested`, size: 3 };
    const graph = fakeGraph({ includeReview: true, extraFiles: [rogue] });
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
      deps: { graph },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
    const listOptions = graph.listFiles.mock.calls[0][2];
    expect(listOptions.maxDepth).toBeGreaterThanOrEqual(4);
    expect(listOptions.failOnTruncation).toBe(true);
    expect(listOptions.failOnDepthLimit).toBe(true);
  });

  it('a truncated census (Graph stopped at its file limit) is a verification failure, never a shorter file list (Codex F4)', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    const graph = fakeGraph({ includeReview: true });
    graph.listFiles = jest.fn(async () => { const error = new Error('listFiles(x) exceeded the 100-file inventory limit'); error.code = 'graph_file_list_truncated'; throw error; });
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
      deps: { graph },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('happy path (uploaded, one DOCX file, SharePoint-promoted size): reaches markReady with the correct post-promotion census (P1-1 regression)', async () => {
    const { sourceDocx, destDocx } = await buildDocxReviewFixture();
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    // The bundle must describe the SAME source file the journal copied (a
    // DOCX), not the PDF fixture: the verifier now compares each journaled
    // file against the bundle by ordinal name, source hash and MIME type
    // (Opus round 2 P3-1), which exposed this fixture's PDF/DOCX mismatch.
    bundleReviewer.files[0] = {
      ...bundleReviewer.files[0],
      name: 'MyReview.docx', size: sourceDocx.length,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      contentHash: crypto.createHash('sha256').update(sourceDocx).digest('hex'),
    };
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.docx' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    const docxReview = {
      destItemId: DOCX_DEST_ITEM_ID, destBuffer: destDocx,
      sourceItemId: DOCX_SOURCE_ITEM_ID, sourceBuffer: sourceDocx, sourceDriveId: EXPECTED_DRIVE_ID, sourceETag: '"source-docx-1"',
    };
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
        reviewFolderResourceDocx(), reviewFileResourceDocx({ sourceDocx, destDocx }),
      ],
      deps: { graph: fakeGraph({ docxReview }) },
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

  it('mutation (P2-2, Opus round 1): received_no_file with no journaled eTagAfter fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({ person: personRow(bundleReviewer), suggestion: suggestionRowFor(bundleReviewer) });
    const { result } = await runStep({
      bundle,
      resources: [baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(), personResource(), suggestionResource(), answersResource({ eTagAfter: null })],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (P2-3, Opus round 1): a non-null wmkf_externaltokenhash fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { wmkf_externaltokenhash: 'a'.repeat(64) } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (P2-3, Opus round 1): a non-null _wmkf_honorariumrequest_value fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { _wmkf_honorariumrequest_value: 'f'.repeat(8) + '-1111-1111-1111-' + 'f'.repeat(12) } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

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

  // ── P2-5 (Opus round 1): one discriminating test per named finding ──────

  it('mutation (M2): unreceived with wmkf_reviewuploadedbystaff:true fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'unreceived', answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const suggestion = {
      wmkf_appreviewersuggestionid: DEST_SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID,
      ...bundleReviewer.suggestion,
      wmkf_reviewreceivedat: null, wmkf_completedat: null, wmkf_thankyousentat: null, wmkf_reviewstatus: null,
      wmkf_reviewuploadedbystaff: true, // mutated: must be false/null for unreceived
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
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (M2): unreceived with a non-null wmkf_reviewreceivedat fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'unreceived', answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const suggestion = {
      wmkf_appreviewersuggestionid: DEST_SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID,
      ...bundleReviewer.suggestion,
      wmkf_reviewreceivedat: '2026-09-25T00:00:00Z', // mutated: must be null for unreceived
      wmkf_completedat: null, wmkf_thankyousentat: null, wmkf_reviewstatus: null,
      wmkf_reviewuploadedbystaff: false,
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
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it.each([
    // Each case isolates ONE comparison in verifyOneReview's bundle check.
    // (The count check itself is not reachable by mutating the bundle: a
    // bundle with fewer files than the source is refused by the source
    // fence first, as `source_changed`. It guards a journal inconsistency,
    // and the missing-file case below covers the bundle-larger direction.)
    // A MIME-type mutation is NOT in this table (F2, Codex slice 6c-ii
    // Stage C round 1): review-file-copy.js's extension<->MIME binding
    // means a `.pdf`-named file with an `application/msword` MIME is a
    // review-file POLICY violation, not merely a journal/bundle drift, so
    // the pre-lease `validateReviewFilePlan` check now refuses it before
    // any lease -- covered separately below.
    ['the bundle lists a second file the journal never copied (missing-file check)', (r) => { r.files.push({ ...r.files[0], name: 'Second.pdf', graphItemId: '01SOURCEREVIEW00000000000000000002' }); }],
    ['the journaled source hash differs from the bundle (hash check)', (r) => { r.files[0].contentHash = 'f'.repeat(64); }],
  ])('P3-1 (Opus round 2): uploaded review fails reviews_verification_failed when %s', async (_label, mutate) => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    mutate(bundleReviewer);
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
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

  it('F2: a bundle file whose MIME type disagrees with its extension is refused pre-lease (validateReviewFilePlan), never reaching verify_reviews', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    bundleReviewer.files[0].mimeType = 'application/msword';
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    await expect(runStep({
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
    })).rejects.toThrow(/MIME type .* does not match its extension/);
  });

  it('mutation (M8): destination person not marker-true fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer, { wmkf_issyntheticreviewer: false }),
      suggestion: suggestionRowFor(bundleReviewer),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (M9): destination person carries a Contact link fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer, { _wmkf_contact_value: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      suggestion: suggestionRowFor(bundleReviewer),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: suggestion bound to the wrong destination person fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { _wmkf_potentialreviewer_value: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: suggestion bound to the wrong destination request fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { _wmkf_request_value: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: wmkf_grantcyclecode does not match the destination meeting date fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { overrides: { wmkf_grantcyclecode: 'WRONGCYCLE' } }),
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: a missing answer row fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({ person: personRow(bundleReviewer), suggestion: suggestionRowFor(bundleReviewer), answers: [] });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: an extra answer row fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      answers: [...ONE_ANSWER, { ...ONE_ANSWER[0], wmkf_questionkey: 'extraQuestion' }],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: a duplicate answer row (same question key twice) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      answers: [ONE_ANSWER[0], { ...ONE_ANSWER[0] }],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it.each([
    ['wmkf_questionorder', 99],
    ['wmkf_questiontext', 'Tampered question text'],
    ['wmkf_questiontype', 'text'],
    ['wmkf_answerhtml', '<p>tampered</p>'],
    ['wmkf_answervalue', 999],
    ['wmkf_questionoptions', JSON.stringify(['tampered'])],
  ])('mutation: answer row field %s mismatch fails reviews_verification_failed', async (field, value) => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      answers: [{ ...ONE_ANSWER[0], [field]: value }],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation: zero-answer received_no_file passes (a valid review can have no answers)', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file', answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({ person: personRow(bundleReviewer), suggestion: suggestionRowFor(bundleReviewer), answers: [] });
    const { result } = await runStep({
      bundle,
      resources: [
        baselineResource(validBaseline()), seedResourceRow(), snapshotResourceRow(), basicFileCopyResource(),
        personResource(), suggestionResource(), answersResource({ eTagAfter: 'W/"2"' }),
      ],
    });
    expect(result.outcome).toBe('ready');
  });

  it('mutation: a seeded suggestion missing from the destination fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'received_no_file' });
    const bundleReviewer = bundle.reviewers[0];
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer),
      liveSuggestionIds: [],
    });
    const { result } = await runStep({ bundle, resources: happyResources() });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('mutation (P2-5, Opus round 1): a copied review file failing re-verification inside the verifier fails needs_attention', async () => {
    // [VERIFIED via run-runner.js:1884-1917, 2829-2836] verify_reviews's own
    // combined census (verifyBasicAndInitialAssessment's `extraFileCopies:
    // reviewFileCopies`, which reverifies every copy_review_file entry via
    // reverifyClone -> reverifyCopiedItems) runs BEFORE the per-reviewer
    // loop reaches verifyOneReview's own (structurally identical, defense-
    // in-depth) reverifyCopiedItems call at line 2833 -- so a drifted review
    // file is always caught there first, surfacing as ia_verification_failed
    // rather than reviews_verification_failed. Both checks call the exact
    // same reverifyCopiedItems logic on the exact same journaled entries.
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    const pointers = { folder: REVIEW_FULL_FOLDER, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
      answers: [],
    });
    // Journal a review file receipt whose eTag disagrees with what the fake
    // Graph actually serves for that item -- reverifyCopiedItems' exact-hash
    // re-verification must catch this drift.
    const tamperedFileResource = { ...reviewFileResource(), readback: { ...reviewFileResource().readback, eTag: '"tampered-etag"' } };
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
        reviewFolderResource(), tamperedFileResource,
      ],
      deps: { graph: fakeGraph({ includeReview: true }) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_verification_failed');
    expect(result.errorMessage).toMatch(/Review_1\.pdf metadata changed after verification/);
  });

  it('mutation: journaled folder disagrees with the destination pointers (non-null case) fails reviews_verification_failed', async () => {
    const bundle = buildBundle({ reviewForm: 'uploaded', includeFiles: true, answers: [] });
    const bundleReviewer = bundle.reviewers[0];
    // The suggestion's own pointers claim a DIFFERENT (but still non-null)
    // folder than the one copy_review_file actually journaled.
    const pointers = { folder: `${REVIEW_FULL_FOLDER}_wrong`, filename: 'Review_1.pdf' };
    mockDataverse({
      person: personRow(bundleReviewer),
      suggestion: suggestionRowFor(bundleReviewer, { pointers, overrides: { wmkf_reviewuploadedbystaff: false } }),
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
