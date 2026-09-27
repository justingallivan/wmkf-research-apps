/**
 * Test Request Factory slice 5a -- the `final_writeup` recipe's first two
 * step bodies (lib/services/test-requests/run-runner.js `stepSeedAbstract` /
 * `stepRenderPreRpBrief`).
 *
 * RECIPE_STEP_ORDER has no `final_writeup` entry until slice 5b, so these
 * tests drive both steps through `advanceRun` under the admitted
 * `pre_site_visit` recipe with advanceRun's POST-LEASE successor seam
 * (`deps.stepOrders`) extending that order. The seam never admits a recipe
 * (proven in test-request-run-runner.test.js).
 *
 * `createPreRpBriefSandboxDeps` is module-mocked here with an in-memory world
 * (its own transport/host/stub correctness is proven in
 * presite-sandbox-deps.test.js). `generatePreRpBrief`, `loadPreRpBriefInputs`,
 * the brief renderer and the governed-DOCX hasher are REAL. Every
 * production-bound adapter the real producer imports (Postgres distribution
 * store, env-bound SharePoint buckets, the env-bound Dataverse adapters,
 * GraphService, the production roster reader) and every LLM entry point is a
 * throwing sentinel, asserted untouched after EVERY test (I8/I9).
 *
 * @jest-environment node
 */
import crypto from 'node:crypto';

const sentinel = (name) => jest.fn(() => { throw new Error(`I8/I9 sentinel reached: ${name}`); });

jest.mock('../../lib/services/test-requests/presite-sandbox-deps.js', () => ({
  createPresiteAiRunDeps: jest.fn(),
  createPresiteSandboxDeps: jest.fn(),
  createPresiteInputDeps: jest.fn(),
  createPreRpBriefSandboxDeps: jest.fn(),
}));
jest.mock('../../lib/services/pre-site-visit/distribution-store.js', () => {
  const actual = jest.requireActual('../../lib/services/pre-site-visit/distribution-store.js');
  return Object.fromEntries(Object.entries(actual).map(([key, value]) => [
    key, typeof value === 'function' ? jest.fn(() => { throw new Error(`I9 sentinel reached: distribution-store.${key}`); }) : value,
  ]));
});
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({
  ...jest.requireActual('../../lib/utils/sharepoint-buckets.js'),
  getRequestSharePointBuckets: jest.fn(() => { throw new Error('I9 sentinel reached: getRequestSharePointBuckets'); }),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/request-document.js'),
  create: jest.fn(() => { throw new Error('I9 sentinel reached: requestDocumentAdapter.create'); }),
  update: jest.fn(() => { throw new Error('I9 sentinel reached: requestDocumentAdapter.update'); }),
  findByGenerationKey: jest.fn(() => { throw new Error('I9 sentinel reached: requestDocumentAdapter.findByGenerationKey'); }),
  findByRequest: jest.fn(() => { throw new Error('I9 sentinel reached: requestDocumentAdapter.findByRequest'); }),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/grant-request.js'),
  getById: jest.fn(() => { throw new Error('I9 sentinel reached: grantRequestAdapter.getById'); }),
}));
jest.mock('../../lib/dataverse/core/changeset.js', () => ({
  ...jest.requireActual('../../lib/dataverse/core/changeset.js'),
  runChangeset: jest.fn(() => { throw new Error('I9 sentinel reached: runChangeset'); }),
}));
jest.mock('../../lib/services/graph-service.js', () => ({
  ...jest.requireActual('../../lib/services/graph-service.js'),
  GraphService: {
    ensureFolderPath: jest.fn(() => { throw new Error('I9 sentinel reached: GraphService.ensureFolderPath'); }),
    uploadFile: jest.fn(() => { throw new Error('I9 sentinel reached: GraphService.uploadFile'); }),
    downloadFile: jest.fn(() => { throw new Error('I9 sentinel reached: GraphService.downloadFile'); }),
    deleteFile: jest.fn(() => { throw new Error('I9 sentinel reached: GraphService.deleteFile'); }),
  },
}));
jest.mock('../../lib/services/review-manager/reviewers-service.js', () => ({
  ...jest.requireActual('../../lib/services/review-manager/reviewers-service.js'),
  getWriteupRoster: jest.fn(() => { throw new Error('I9 sentinel reached: production getWriteupRoster'); }),
}));
jest.mock('../../lib/services/llm-client.js', () => {
  const actual = jest.requireActual('../../lib/services/llm-client.js');
  return Object.fromEntries(Object.entries(actual).map(([key, value]) => [
    key, typeof value === 'function' ? jest.fn(() => { throw new Error(`I8 sentinel reached: llm-client.${key}`); }) : value,
  ]));
});
jest.mock('../../lib/services/execute-prompt.js', () => ({
  ...jest.requireActual('../../lib/services/execute-prompt.js'),
  executePrompt: jest.fn(() => { throw new Error('I8 sentinel reached: executePrompt'); }),
}));
jest.mock('../../lib/services/test-requests/basic-clone-steps.js', () => ({
  ...jest.requireActual('../../lib/services/test-requests/basic-clone-steps.js'),
  runPreflight: jest.fn(),
}));

import { advanceRun, RECIPE_STEP_ORDER, preRpBriefClientOperationId } from '../../lib/services/test-requests/run-runner.js';
import { createPreRpBriefSandboxDeps } from '../../lib/services/test-requests/presite-sandbox-deps.js';
import { MANIFEST_V4, sha256, computeRunPlanDigest, runPreflight } from '../../lib/services/test-requests/basic-clone-steps.js';
import { reviewFileCopyPolicyDigest } from '../../lib/services/test-requests/review-file-copy.js';
import { assertLedgerReceipt, ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';
import { loadPreRpBriefInputs } from '../../lib/services/pre-rp-brief/input-service.js';
import { renderBrief } from '../../lib/services/pre-rp-brief/docx-renderer.js';
import { hashGovernedDocxContent } from '../../lib/services/documents/governed-docx-hash.js';
import * as distributionStore from '../../lib/services/pre-site-visit/distribution-store.js';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { getWriteupRoster } from '../../lib/services/review-manager/reviewers-service.js';
import * as llmClient from '../../lib/services/llm-client.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const PARENT_LOCATION_ID = '55555555-5555-4555-8555-555555555555';
const APP_USER_ID = '66666666-6666-4666-8666-666666666666';
const FOREIGN_ROW_ID = '77777777-7777-4777-8777-777777777777';
const APPLICANT_ID = '88888888-8888-4888-8888-888888888888';
const REQUEST_NUMBER = '1002379';
const SITE_ID = 'SITE-1';
const DRIVE_ID = 'b!DRIVE0123456789abcdefgh';
const ITEM_ID = `01${'A'.repeat(32)}`;
const OTHER_ITEM_ID = `01${'B'.repeat(32)}`;
const ABSTRACT = 'A confidential source abstract that must never reach the ledger.';
const REQUEST_FOLDER = expectedRequestFolder(REQUEST_NUMBER, REQUEST_ID);
const BRIEF_FOLDER = `${REQUEST_FOLDER}/${PRE_RP_BRIEF_CONTRACT.relativeFolder}`;
const { READY, GENERATING, FAILED } = REQUEST_DOCUMENT_OPERATION_STATUS;
const { DRAFT, SUPERSEDED } = REQUEST_DOCUMENT_LIFECYCLE_STATE;

/** Real 5b step order is not built; this is advanceRun's post-lease successor seam. */
const STEP_ORDERS = Object.freeze({
  pre_site_visit: Object.freeze([
    ...RECIPE_STEP_ORDER.pre_site_visit, 'seed_abstract', 'render_pre_rp_brief', 'start_site_visit',
  ]),
});

const PRODUCTION_SENTINELS = () => [
  ...Object.values(distributionStore).filter((value) => jest.isMockFunction(value)),
  getRequestSharePointBuckets,
  requestDocumentAdapter.create, requestDocumentAdapter.update,
  requestDocumentAdapter.findByGenerationKey, requestDocumentAdapter.findByRequest,
  grantRequestAdapter.getById, runChangeset,
  GraphService.ensureFolderPath, GraphService.uploadFile, GraphService.downloadFile, GraphService.deleteFile,
  getWriteupRoster, executePrompt,
  ...Object.values(llmClient).filter((value) => jest.isMockFunction(value)),
];

function buildBundle(overrides = {}) {
  return {
    kind: 'test-request-source-bundle/v4',
    version: 4,
    reviewers: [],
    documents: [],
    preSiteVisit: {
      requestDocumentId: 'source-doc-id', sectionFields: {}, proposalCoreJson: {},
      personnel: { principalInvestigator: 'Ada Principal', coPrincipalInvestigators: [] },
    },
    abstract: ABSTRACT,
    ...overrides,
  };
}

function baseManifest(bundle) {
  return {
    kind: MANIFEST_V4,
    recipe: 'pre_site_visit',
    source: { requestId: SOURCE_ID, revision: '1', bundleSha256: sha256(bundle) },
    createBodySha256: 'body-hash',
    copyPolicy: { digest: 'policy-digest' },
    values: { requestId: REQUEST_ID, locationId: LOCATION_ID, runId: RUN_ID },
    reviewFilePolicy: { digest: reviewFileCopyPolicyDigest() },
  };
}

function baseRun(bundle, overrides = {}) {
  return {
    runId: RUN_ID, recipe: 'pre_site_visit', status: 'creating',
    currentStep: 'seed_abstract', stepIndex: 18, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: sha256(bundle), copyPolicyDigest: 'policy-digest',
    sourceRequestId: SOURCE_ID, sourceRequestNumber: REQUEST_NUMBER, sourceRevision: '1',
    destinationRequestId: REQUEST_ID, destinationLocationId: LOCATION_ID, destinationRequestNumber: REQUEST_NUMBER,
    planDigest: computeRunPlanDigest({ manifest: baseManifest(bundle), reviewerAddressDigests: [] }),
    expectedAppUserId: APP_USER_ID, expectedGraphSiteId: SITE_ID, expectedGraphDriveId: DRIVE_ID,
    ...overrides,
  };
}

/** Recording fake ledger (run-ledger.js's shape; every receipt runs the real validator). */
function createFakeLedger(initialRun, initialResources = []) {
  const calls = [];
  let run = { ...initialRun };
  const resources = initialResources.map((r) => ({ ...r }));
  let nextId = resources.length + 1;
  const fenceOk = (leaseToken, leaseGeneration, expectedVersion) => run.leaseToken === leaseToken
    && run.leaseGeneration === leaseGeneration && (expectedVersion === undefined || run.version === expectedVersion)
    && run.lockedUntil !== null;
  const ledger = {
    async getRun(runId) { return runId === run.runId ? { ...run } : null; },
    async claimLease({ expectedVersion }) {
      calls.push({ op: 'claimLease' });
      if (run.version !== expectedVersion || run.lockedUntil !== null) return null;
      run = { ...run, leaseToken: `lease-${run.leaseGeneration + 1}`, leaseGeneration: run.leaseGeneration + 1, lockedUntil: 'future', version: run.version + 1 };
      return { ...run };
    },
    async releaseLease({ leaseToken, leaseGeneration }) {
      if (!fenceOk(leaseToken, leaseGeneration)) return null;
      run = { ...run, leaseToken: null, lockedUntil: null };
      return { ...run };
    },
    async advanceStep({ leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status }) {
      calls.push({ op: 'advanceStep', nextStep });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, currentStep: nextStep, stepIndex: nextStepIndex, status: status ?? run.status, version: run.version + 1 };
      return { ...run };
    },
    async markReady(args) {
      calls.push({ op: 'markReady', ...args });
      run = { ...run, status: 'ready', version: run.version + 1 };
      return { ...run };
    },
    async markNeedsAttention({ leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = {
        ...run, status: 'needs_attention', needsAttentionReason: ledgerReasonOrThrow(reason),
        lastError: error == null ? null : ledgerReasonOrThrow(error), leaseToken: null, lockedUntil: null, version: run.version + 1,
      };
      return { ...run };
    },
    async journalPlannedResource({ runId, step, resourceKind, system, plannedIdentity }) {
      assertLedgerReceipt(plannedIdentity ?? {}, 'plannedIdentity');
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      const resource = { resourceId: nextId, runId, sequence: nextId, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      nextId += 1;
      resources.push(resource);
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
      if (readback != null) assertLedgerReceipt(readback, 'readback');
      calls.push({ op: 'recordResourceReadback', resourceId, readback, outcome });
      const resource = resources.find((row) => row.resourceId === resourceId);
      Object.assign(resource, { readback, outcome, responseStatus });
      return { ...resource };
    },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
    async listRunReviewerAssignments() { return []; },
    async getRunReviewerAssignment() { return null; },
  };
  return { ledger, calls, resources };
}

function provisionLocationResource() {
  return {
    resourceId: 1, sequence: 1, step: 'provision_location', resourceKind: 'dataverse_document_location', system: 'dataverse',
    plannedIdentity: { locationId: LOCATION_ID }, readback: { locationId: LOCATION_ID, folder: REQUEST_FOLDER }, outcome: 'verified',
  };
}

/** Mutable in-memory sandbox (Dataverse request/locations/brief rows + one SharePoint drive). */
function createWorld() {
  let etag = 1;
  const nextEtag = () => { etag += 1; return `W/"${etag}"`; };
  const request = {
    akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, akoya_title: 'A test project',
    wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID,
    _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
    wmkf_abstract: null, wmkf_meetingdate: '2026-12-03', '@odata.etag': 'W/"1"',
    _akoya_applicantid_value: APPLICANT_ID,
    // The builder overlays the synthetic bundle PI (presite-sandbox-deps.test.js);
    // this fake stands in for its output.
    _wmkf_projectleader_value_formatted: 'TEST · Ada Principal',
    _wmkf_programdirector_value_formatted: 'Pat Director',
    _wmkf_currentprerpbrief_value: null,
  };
  const locations = [{
    sharepointdocumentlocationid: LOCATION_ID, relativeurl: REQUEST_FOLDER, _parentsiteorlocation_value: PARENT_LOCATION_ID,
    _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
  }];
  const parent = { sharepointdocumentlocationid: PARENT_LOCATION_ID, relativeurl: 'akoya_request' };
  const rows = new Map();
  const files = new Map();
  const flags = {
    patchStatus: null, patchThrows: false, patchLands: true, uploadConflict: false,
    hideRowsFromFindByRequestOnce: false, onNextGenerationKeyLookup: null, afterUpload: null, afterCommit: null,
    fileIdOverride: null,
  };
  const log = { patches: [], creates: [], updates: [], commits: [], folders: [], uploads: [], deletes: [], bucketCalls: 0 };

  const client = {
    baseUrl: 'https://orgd9e66399.crm.dynamics.com/api/data/v9.2',
    get: jest.fn(async (path) => {
      const decoded = decodeURIComponent(path);
      if (path.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: { ...request } };
      if (decoded.startsWith('/sharepointdocumentlocations') && decoded.includes('_regardingobjectid_value')) {
        return { ok: true, status: 200, body: { value: locations.map((l) => ({ ...l })) } };
      }
      if (decoded.startsWith('/sharepointdocumentlocations') && decoded.includes("relativeurl eq 'akoya_request'")) {
        return { ok: true, status: 200, body: { value: [{ ...parent }] } };
      }
      throw new Error(`unexpected sandbox GET ${path}`);
    }),
    patch: jest.fn(async (path, body, headers) => {
      log.patches.push({ path, body, headers });
      if (flags.patchThrows) {
        if (flags.patchLands) Object.assign(request, body, { '@odata.etag': nextEtag() });
        throw new Error('socket hang up');
      }
      if (flags.patchStatus === 412 || headers['If-Match'] !== request['@odata.etag']) return { ok: false, status: 412, text: '' };
      Object.assign(request, body, { '@odata.etag': nextEtag() });
      return { ok: true, status: 204, text: '' };
    }),
  };

  function applyPatch(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'wmkf_Request@odata.bind') row._wmkf_request_value = value.match(/\(([^)]+)\)/)[1];
      else row[key] = value;
    }
    row._etag = nextEtag();
    row.modifiedon = new Date().toISOString();
  }

  function seedRow(overrides = {}) {
    const id = overrides.wmkf_requestdocumentid || crypto.randomUUID();
    const row = {
      wmkf_requestdocumentid: id, _wmkf_request_value: REQUEST_ID,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType, wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType,
      wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer, wmkf_templateid: PRE_RP_BRIEF_CONTRACT.templateId,
      wmkf_templateversion: PRE_RP_BRIEF_CONTRACT.templateVersion,
      wmkf_operationstatus: FAILED, wmkf_lifecyclestate: DRAFT, wmkf_sharepointfolderpath: BRIEF_FOLDER,
      _etag: nextEtag(), modifiedon: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ...overrides,
    };
    rows.set(id, row);
    return row;
  }

  function briefDeps(getBuckets) {
    return {
      loadInputs: (args) => loadPreRpBriefInputs(args, {
        getRequest: async () => ({ ...request }),
        getAccount: async () => ({ name: 'Applicant University' }),
        getWriteupRoster: async () => ({ reviewers: world.reviewers, blockers: [] }),
      }),
      renderDocx: renderBrief,
      hashDocx: hashGovernedDocxContent,
      getRequest: async () => ({
        akoya_requestid: request.akoya_requestid, _wmkf_currentprerpbrief_value: request._wmkf_currentprerpbrief_value, _etag: request['@odata.etag'],
      }),
      getBuckets: async (...args) => { log.bucketCalls += 1; return getBuckets(...args); },
      findByGenerationKey: async (key) => {
        if (flags.onNextGenerationKeyLookup) {
          const hook = flags.onNextGenerationKeyLookup;
          flags.onNextGenerationKeyLookup = null;
          hook();
        }
        return { records: [...rows.values()].filter((row) => row.wmkf_generationkey === key).map((row) => ({ ...row })) };
      },
      findByRequest: async (requestId, { artifactType } = {}) => {
        if (flags.hideRowsFromFindByRequestOnce) { flags.hideRowsFromFindByRequestOnce = false; return { records: [] }; }
        return {
          records: [...rows.values()].filter((row) => row._wmkf_request_value === requestId
            && (artifactType === undefined || row.wmkf_artifacttype === artifactType)).map((row) => ({ ...row })),
        };
      },
      hasSentAttemptForSource: async () => false,
      listDistributionAttempts: async () => [],
      createDocument: async (payload, options) => {
        log.creates.push({ payload, options });
        const row = { wmkf_requestdocumentid: crypto.randomUUID() };
        applyPatch(row, payload);
        rows.set(row.wmkf_requestdocumentid, row);
        return { wmkf_requestdocumentid: row.wmkf_requestdocumentid };
      },
      updateDocument: async (id, patch, options) => {
        log.updates.push({ id, patch });
        const row = rows.get(id);
        if (!row || options?.ifMatch !== row._etag) throw Object.assign(new Error('precondition failed'), { status: 412 });
        applyPatch(row, patch);
        return {};
      },
      commitChangeset: async (operations) => {
        log.commits.push(operations);
        for (const op of operations) {
          if (op.entitySet === 'akoya_requests') {
            request._wmkf_currentprerpbrief_value = op.body['wmkf_CurrentPreRPBrief@odata.bind'].match(/\(([^)]+)\)/)[1];
          } else {
            applyPatch(rows.get(op.key), op.body);
          }
        }
        if (flags.afterCommit) flags.afterCommit();
        return {};
      },
      ensureFolderPath: async (library, folder) => { log.folders.push({ library, folder }); return { id: 'folder' }; },
      uploadFile: async (library, folder, filename) => {
        log.uploads.push({ library, folder, filename });
        const path = `${folder}/${filename}`;
        if (flags.uploadConflict || files.has(path)) throw Object.assign(new Error('nameAlreadyExists'), { status: 409 });
        const item = {
          id: ITEM_ID, driveId: DRIVE_ID, siteId: SITE_ID, versionId: '1.0', eTag: '"{ITEM},1"',
          webUrl: 'https://sandbox.example/brief', size: 100, lastModified: new Date().toISOString(), name: filename,
        };
        files.set(path, item);
        if (flags.afterUpload) flags.afterUpload();
        return item;
      },
      getFileMetadataByPath: async (library, folder, filename) => {
        const item = files.get(`${folder}/${filename}`);
        return item ? { ...item, id: flags.fileIdOverride || item.id } : null;
      },
      downloadFile: async () => { throw new Error('downloadFile must not be called'); },
      deleteFile: jest.fn(async (driveId, itemId) => { log.deletes.push({ driveId, itemId }); }),
      newClaimToken: () => crypto.randomUUID(),
    };
  }

  const world = { request, locations, parent, rows, files, flags, log, client, seedRow, briefDeps, reviewers: [] };
  return world;
}

let world;
beforeEach(() => {
  world = createWorld();
  runPreflight.mockImplementation(async () => ({ siteId: SITE_ID, driveId: DRIVE_ID }));
  createPreRpBriefSandboxDeps.mockImplementation(({ getBuckets }) => world.briefDeps(getBuckets));
});

afterEach(() => {
  // I8/I9 for every test in this file: no production-bound adapter and no
  // LLM entry point was reached, on any path (happy, resume or refusal).
  for (const fn of PRODUCTION_SENTINELS()) expect(fn).not.toHaveBeenCalled();
  jest.clearAllMocks();
});

async function runStep(currentStep, { resources = [provisionLocationResource()], bundle = buildBundle(), runOverrides = {} } = {}) {
  const run0 = baseRun(bundle, { currentStep, ...runOverrides });
  const { ledger, calls, resources: live } = createFakeLedger(run0, resources);
  const result = await advanceRun({
    runId: RUN_ID, ledger, manifest: baseManifest(bundle), bundle,
    deps: { client: world.client, graph: {}, sharePointTarget: () => ({}), stepOrders: STEP_ORDERS },
  });
  return { result, calls, resources: live };
}

const abstractDigest = crypto.createHash('sha256').update(ABSTRACT, 'utf8').digest('hex');

// ─────────────────────────────────────────────────────────────────────────
// seed_abstract
// ─────────────────────────────────────────────────────────────────────────
describe('seed_abstract', () => {
  test('happy path: journals the digest (I1) before one If-Match PATCH, rereads equal (I5), advances', async () => {
    const { result, calls } = await runStep('seed_abstract');
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('render_pre_rp_brief');
    expect(world.client.patch).toHaveBeenCalledTimes(1);
    expect(world.log.patches[0]).toEqual({
      path: `/akoya_requests(${REQUEST_ID})`, body: { wmkf_abstract: ABSTRACT }, headers: { 'If-Match': 'W/"1"' },
    });
    expect(world.request.wmkf_abstract).toBe(ABSTRACT);
    const journal = calls.find((c) => c.op === 'journalPlannedResource');
    expect(journal.plannedIdentity).toEqual({ requestId: REQUEST_ID, field: 'wmkf_abstract', contentHash: abstractDigest });
    const final = calls.filter((c) => c.op === 'recordResourceReadback').at(-1);
    expect(final.outcome).toBe('verified');
    expect(final.readback).toMatchObject({ contentHash: abstractDigest, matched: true, responseStatus: 204 });
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  test('I6: no ledger call carries the abstract text, only its digest', async () => {
    const { calls } = await runStep('seed_abstract');
    expect(JSON.stringify(calls)).not.toContain(ABSTRACT);
  });

  test('resume: the journaled intent exists and the live value already equals -> no write, recovered, advances', async () => {
    world.request.wmkf_abstract = ABSTRACT;
    const prior = {
      resourceId: 2, sequence: 2, step: 'seed_abstract', resourceKind: 'dataverse_request_patch', system: 'dataverse',
      plannedIdentity: { requestId: REQUEST_ID, field: 'wmkf_abstract', contentHash: abstractDigest }, readback: null, outcome: 'dispatched',
    };
    const { result, calls } = await runStep('seed_abstract', { resources: [provisionLocationResource(), prior] });
    expect(result.outcome).toBe('advanced');
    expect(world.client.patch).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
    expect(calls.find((c) => c.op === 'recordResourceReadback').outcome).toBe('recovered');
  });

  test('a different non-empty live abstract -> needs_attention abstract_conflict, never overwritten', async () => {
    world.request.wmkf_abstract = 'Someone else\'s abstract.';
    const { result } = await runStep('seed_abstract');
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.client.patch).not.toHaveBeenCalled();
    expect(world.request.wmkf_abstract).toBe('Someone else\'s abstract.');
  });

  test('I3: a 412 whose reread shows the bundle abstract (a same-value writer) -> decided by value, verified', async () => {
    world.flags.patchStatus = 412;
    world.client.patch.mockImplementationOnce(async (path, body) => {
      world.log.patches.push({ path, body });
      world.request.wmkf_abstract = ABSTRACT;
      return { ok: false, status: 412, text: '' };
    });
    const { result } = await runStep('seed_abstract');
    expect(result.outcome).toBe('advanced');
    expect(world.client.patch).toHaveBeenCalledTimes(1);
  });

  test('I3: a 412 whose reread is not the bundle abstract -> abstract_conflict, exactly one PATCH (never retried)', async () => {
    world.flags.patchStatus = 412;
    const { result } = await runStep('seed_abstract');
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.client.patch).toHaveBeenCalledTimes(1);
  });

  test('I3: a lost PATCH response whose value landed -> verified by reread; one that did not land -> abstract_conflict, one PATCH', async () => {
    world.flags.patchThrows = true;
    world.flags.patchLands = true;
    expect((await runStep('seed_abstract')).result.outcome).toBe('advanced');
    world = createWorld();
    createPreRpBriefSandboxDeps.mockImplementation(({ getBuckets }) => world.briefDeps(getBuckets));
    world.flags.patchThrows = true;
    world.flags.patchLands = false;
    const { result } = await runStep('seed_abstract');
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.client.patch).toHaveBeenCalledTimes(1);
  });

  const OWNERSHIP_MUTATIONS = [
    ['the Test Request marker', (r) => { r.wmkf_istestrequest = false; }],
    ['the run id marker', (r) => { r.wmkf_testcreationrunid = FOREIGN_ROW_ID; }],
    ['the app-user creator', (r) => { r._createdby_value = FOREIGN_ROW_ID; }],
    ['the app-user owner', (r) => { r._ownerid_value = FOREIGN_ROW_ID; }],
  ];

  test.each(OWNERSHIP_MUTATIONS)('I4 (entry): %s changed -> request_readback_mismatch, no journal, no PATCH', async (_label, mutate) => {
    mutate(world.request);
    const { result, calls } = await runStep('seed_abstract');
    expect(result.run.needsAttentionReason).toBe('request_readback_mismatch');
    expect(world.client.patch).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
  });

  test.each(OWNERSHIP_MUTATIONS)('I4 (resume): %s changed with an intent already journaled -> refuses, no PATCH', async (_label, mutate) => {
    mutate(world.request);
    const prior = {
      resourceId: 2, sequence: 2, step: 'seed_abstract', resourceKind: 'dataverse_request_patch', system: 'dataverse',
      plannedIdentity: { requestId: REQUEST_ID, field: 'wmkf_abstract', contentHash: abstractDigest }, readback: null, outcome: 'dispatched',
    };
    const { result } = await runStep('seed_abstract', { resources: [provisionLocationResource(), prior] });
    expect(result.run.needsAttentionReason).toBe('request_readback_mismatch');
    expect(world.client.patch).not.toHaveBeenCalled();
  });

  test('I4 (post-write): ownership re-asserted on the reread after the PATCH too', async () => {
    world.client.patch.mockImplementationOnce(async (path, body) => {
      Object.assign(world.request, body, { wmkf_istestrequest: false });
      return { ok: true, status: 204, text: '' };
    });
    const { result } = await runStep('seed_abstract');
    expect(result.run.needsAttentionReason).toBe('request_readback_mismatch');
  });

  test.each([['null', null], ['blank', '   ']])('I7: a %s bundle abstract -> abstract_conflict before any journal or write', async (_label, abstract) => {
    const { result, calls } = await runStep('seed_abstract', { bundle: buildBundle({ abstract }) });
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.client.patch).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
  });

  test('I7: a journaled intent whose digest is not this bundle\'s abstract -> abstract_conflict, no PATCH', async () => {
    const prior = {
      resourceId: 2, sequence: 2, step: 'seed_abstract', resourceKind: 'dataverse_request_patch', system: 'dataverse',
      plannedIdentity: { requestId: REQUEST_ID, field: 'wmkf_abstract', contentHash: 'f'.repeat(64) }, readback: null, outcome: 'dispatched',
    };
    const { result } = await runStep('seed_abstract', { resources: [provisionLocationResource(), prior] });
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.client.patch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// render_pre_rp_brief
// ─────────────────────────────────────────────────────────────────────────
function briefRows() {
  return [...world.rows.values()].filter((row) => row.wmkf_artifacttype === PRE_RP_BRIEF_CONTRACT.artifactType);
}

async function freshBriefRun(options = {}) {
  world.request.wmkf_abstract = ABSTRACT;
  return runStep('render_pre_rp_brief', options);
}

/** The generation key this run's first attempt would journal (read back from a real run). */
async function renderOnceAndCapture() {
  const first = await freshBriefRun();
  expect(first.result.outcome).toBe('advanced');
  const journal = first.calls.find((c) => c.op === 'journalPlannedResource' && c.step === 'render_pre_rp_brief');
  const resource = first.resources.find((r) => r.step === 'render_pre_rp_brief');
  return { first, generationKey: journal.plannedIdentity.generationKey, resource };
}

describe('render_pre_rp_brief', () => {
  test('happy path: one create, one upload into the brief folder, commit only on the owned row + destination; Ready/Draft, pointer bound; advances', async () => {
    const { result, calls } = await freshBriefRun();
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('start_site_visit');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
    const rows = briefRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ wmkf_operationstatus: READY, wmkf_lifecyclestate: DRAFT, _wmkf_request_value: REQUEST_ID });
    expect(world.request._wmkf_currentprerpbrief_value).toBe(row.wmkf_requestdocumentid);
    expect(world.log.creates).toHaveLength(1);
    expect(world.log.uploads).toEqual([{ library: 'akoya_request', folder: BRIEF_FOLDER, filename: row.wmkf_filename }]);
    for (const op of world.log.commits.flat()) {
      expect([row.wmkf_requestdocumentid, REQUEST_ID]).toContain(op.key);
    }
    expect(world.log.deletes).toEqual([]);
    const final = calls.filter((c) => c.op === 'recordResourceReadback').at(-1);
    expect(final.outcome).toBe('verified');
    expect(final.readback).toMatchObject({
      requestDocumentId: row.wmkf_requestdocumentid, itemId: ITEM_ID, driveId: DRIVE_ID,
      contentHash: crypto.createHash('sha256').update(row.wmkf_contenthash, 'utf8').digest('hex'),
    });
  });

  test('I1: the run-bound clientOperationId and generation key are journaled BEFORE the create; the key binds that id', async () => {
    const { calls } = await freshBriefRun();
    const journalIndex = calls.findIndex((c) => c.op === 'journalPlannedResource' && c.step === 'render_pre_rp_brief');
    expect(journalIndex).toBeGreaterThanOrEqual(0);
    const journal = calls[journalIndex];
    expect(journal.plannedIdentity.clientOperationId).toBe(preRpBriefClientOperationId(RUN_ID));
    expect(journal.plannedIdentity.clientOperationId).toMatch(/^[0-9a-f]{64}$/);
    const [row] = briefRows();
    expect(row.wmkf_generationkey).toBe(journal.plannedIdentity.generationKey);
    // The create happened after the journal: the only readback before it is
    // the in-call upload dispatch record, which comes after the create.
    const firstReadbackIndex = calls.findIndex((c) => c.op === 'recordResourceReadback');
    expect(firstReadbackIndex).toBeGreaterThan(journalIndex);
  });

  test('I6: no ledger call carries the abstract, the brief snapshot or the claim token', async () => {
    const { calls } = await freshBriefRun();
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(ABSTRACT);
    const [row] = briefRows();
    expect(serialized).not.toContain(row.wmkf_claimtoken);
    expect(serialized).not.toContain('presiteinputsnapshotjson');
  });

  test('I10: the create goes through the sandbox createDocument seam (the brief producer\'s own call); SANDBOX_REHEARSAL is forced one layer below (presite-sandbox-deps.test.js)', async () => {
    await freshBriefRun();
    expect(world.log.creates).toHaveLength(1);
    expect(world.log.creates[0].payload['wmkf_Request@odata.bind']).toBe(`/akoya_requests(${REQUEST_ID})`);
    expect(world.log.creates[0].payload.wmkf_sharepointfolderpath).toBe(BRIEF_FOLDER);
    expect(requestDocumentAdapter.create).not.toHaveBeenCalled();
  });

  test('resume after a completed render (READY + pointer): the producer reuses it with no write; verified again; advances', async () => {
    const { resource } = await renderOnceAndCapture();
    const creates = world.log.creates.length;
    const uploads = world.log.uploads.length;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.outcome).toBe('advanced');
    expect(world.log.creates.length).toBe(creates);
    expect(world.log.uploads.length).toBe(uploads);
    expect(second.calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
    expect(briefRows()).toHaveLength(1);
  });

  test('resume: a journaled clientOperationId that is not this run\'s -> pre_rp_brief_ownership_mismatch, no create', async () => {
    world.request.wmkf_abstract = ABSTRACT;
    const tampered = {
      resourceId: 2, sequence: 2, step: 'render_pre_rp_brief', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { requestId: REQUEST_ID, clientOperationId: 'e'.repeat(64), generationKey: 'd'.repeat(64) }, readback: null, outcome: 'planned',
    };
    const { result } = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), tampered] });
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.creates).toHaveLength(0);
  });

  test('resume: the inputs changed since the journaled key (roster drift) -> refuses rather than creating a second row', async () => {
    const { resource } = await renderOnceAndCapture();
    world.reviewers = [{
      suggestionId: FOREIGN_ROW_ID, name: 'TEST · Late Reviewer', reviewReceivedAt: '2026-10-01T00:00:00Z', answers: [],
    }];
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(second.result.errorMessage).toMatch(/different generation key/);
    expect(briefRows()).toHaveLength(1);
  });

  test('the silent no-op trap: this run\'s row GENERATING under a LIVE lease -> refused before the producer; no upload or commit', async () => {
    const { resource, generationKey } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: GENERATING, modifiedon: new Date().toISOString() });
    world.request._wmkf_currentprerpbrief_value = null;
    const uploads = world.log.uploads.length;
    const commits = world.log.commits.length;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(row.wmkf_generationkey).toBe(generationKey);
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(second.result.errorMessage).toMatch(/live lease/);
    expect(world.log.uploads.length).toBe(uploads);
    expect(world.log.commits.length).toBe(commits);
  });

  test('load-bearing verifier: a read-skewed pre-check that misses a live-leased GENERATING row still lands needs_attention (the producer\'s "reused" is not trusted)', async () => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: GENERATING, modifiedon: new Date().toISOString() });
    world.request._wmkf_currentprerpbrief_value = null;
    world.flags.hideRowsFromFindByRequestOnce = true;
    const uploads = world.log.uploads.length;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_verification_failed');
    expect(second.result.errorMessage).toMatch(/not Ready \+ Draft/);
    expect(world.log.uploads.length).toBe(uploads);
    expect(briefRows()).toHaveLength(1);
  });

  test('an EXPIRED-lease GENERATING row with no prior upload is reclaimed, rendered from its stored snapshot, activated -- no second row', async () => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: GENERATING, modifiedon: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    world.request._wmkf_currentprerpbrief_value = null;
    world.files.clear();
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.outcome).toBe('advanced');
    expect(briefRows()).toHaveLength(1);
    expect(row.wmkf_operationstatus).toBe(READY);
    expect(world.log.creates).toHaveLength(1);
  });

  test('a FAILED row whose prior upload is still at its path: the forced create-only upload refuses (I2) -> needs_attention, row FAILED, nothing deleted, no second row', async () => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: FAILED, wmkf_lifecyclestate: DRAFT });
    world.request._wmkf_currentprerpbrief_value = null;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_verification_failed');
    expect(row.wmkf_operationstatus).toBe(FAILED);
    expect(world.log.deletes).toEqual([]);
    expect(briefRows()).toHaveLength(1);
  });

  test('this run\'s row SUPERSEDED -> refused before the producer', async () => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    row.wmkf_lifecyclestate = SUPERSEDED;
    world.request._wmkf_currentprerpbrief_value = null;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
  });

  test('a brief row under another generation key on the destination -> refused, no create (never a second brief)', async () => {
    world.seedRow({ wmkf_requestdocumentid: FOREIGN_ROW_ID, wmkf_generationkey: 'c'.repeat(64), wmkf_operationstatus: READY });
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.creates).toHaveLength(0);
  });

  test('a destination pointer at a brief this run did not produce -> refused, no create', async () => {
    world.request._wmkf_currentprerpbrief_value = FOREIGN_ROW_ID;
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.creates).toHaveLength(0);
  });

  const ROW_MUTATIONS = [
    ['request binding', { _wmkf_request_value: FOREIGN_ROW_ID }, /bound to a different request/],
    ['producer', { wmkf_producer: 'someone-else' }, /governed brief contract/],
    ['template version', { wmkf_templateversion: '999' }, /governed brief contract/],
    ['folder', { wmkf_sharepointfolderpath: `${REQUEST_FOLDER}/Elsewhere` }, /expected brief folder/],
    ['filename', { wmkf_filename: 'Pre-RP-Brief_x_00000000.docx' }, /filename is not derived/],
    ['reopen lineage', { wmkf_reopencycleid: 'D26' }, /guarded-reopen lineage/],
    ['operation status', { wmkf_operationstatus: 999 }, /unrecognized state/],
  ];

  test.each(ROW_MUTATIONS)('I4 (resume boundary): a drifted %s on this run\'s row -> refused before the producer; no upload or commit', async (_label, patch, message) => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: FAILED }, patch);
    world.request._wmkf_currentprerpbrief_value = null;
    const uploads = world.log.uploads.length;
    const commits = world.log.commits.length;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(second.result.errorMessage).toMatch(message);
    expect(world.log.uploads.length).toBe(uploads);
    expect(world.log.commits.length).toBe(commits);
  });

  test('I4 (per-read): a row whose request binding drifts AFTER the pre-check is refused at the producer\'s own lookup; no upload or commit', async () => {
    const { resource } = await renderOnceAndCapture();
    const [row] = briefRows();
    Object.assign(row, { wmkf_operationstatus: FAILED });
    world.request._wmkf_currentprerpbrief_value = null;
    world.files.clear();
    world.flags.onNextGenerationKeyLookup = () => { row._wmkf_request_value = FOREIGN_ROW_ID; };
    const uploads = world.log.uploads.length;
    const commits = world.log.commits.length;
    const second = await runStep('render_pre_rp_brief', { resources: [provisionLocationResource(), resource] });
    expect(second.result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.uploads.length).toBe(uploads);
    expect(world.log.commits.length).toBe(commits);
  });

  test.each(OWNERSHIP_CASES())('I4 (entry): destination %s changed -> request_readback_mismatch; the brief deps are never built', async (_label, mutate) => {
    world.request.wmkf_abstract = ABSTRACT;
    mutate(world.request);
    const { result } = await runStep('render_pre_rp_brief');
    expect(result.run.needsAttentionReason).toBe('request_readback_mismatch');
    expect(createPreRpBriefSandboxDeps).not.toHaveBeenCalled();
  });

  test.each([
    ['program director', '_wmkf_programdirector_value_formatted'],
    ['principal investigator', '_wmkf_projectleader_value_formatted'],
    ['project title', 'akoya_title'],
  ])('I7: a missing %s (a renderer requirement) is refused before any journal or create, never after the row exists', async (_label, field) => {
    world.request[field] = null;
    const { result, calls } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(result.errorMessage).toMatch(/missing brief render input/);
    expect(world.log.creates).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
  });

  test('the builder receives the bundle personnel (the synthetic-PI seam)', async () => {
    await freshBriefRun();
    expect(createPreRpBriefSandboxDeps.mock.calls[0][0].personnel).toEqual({ principalInvestigator: 'Ada Principal', coPrincipalInvestigators: [] });
  });

  test('I4/I7: the destination abstract no longer equals the seeded bundle abstract -> abstract_conflict before any brief call', async () => {
    world.request.wmkf_abstract = 'Drifted abstract.';
    const { result } = await runStep('render_pre_rp_brief');
    expect(result.run.needsAttentionReason).toBe('abstract_conflict');
    expect(world.log.creates).toHaveLength(0);
  });

  const BUCKET_MUTATIONS = [
    ['a second live location', (w) => { w.locations.push({ ...w.locations[0], sharepointdocumentlocationid: FOREIGN_ROW_ID }); }],
    ['a different location id', (w) => { w.locations[0].sharepointdocumentlocationid = FOREIGN_ROW_ID; }],
    ['a different relative url', (w) => { w.locations[0].relativeurl = `${REQUEST_FOLDER}_other`; }],
    ['a location not owned by the app user', (w) => { w.locations[0]._ownerid_value = FOREIGN_ROW_ID; }],
    ['a parent outside the akoya_request library', (w) => { w.locations[0]._parentsiteorlocation_value = FOREIGN_ROW_ID; }],
  ];

  test.each(BUCKET_MUTATIONS)('I7 (getBuckets): %s -> refused before any create', async (_label, mutate) => {
    mutate(world);
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.creates).toHaveLength(0);
    expect(world.log.bucketCalls).toBe(1);
  });

  test('I7 (getBuckets): no journaled provision_location readback -> refused before any create', async () => {
    const { result } = await freshBriefRun({ resources: [] });
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_ownership_mismatch');
    expect(world.log.creates).toHaveLength(0);
  });

  test('I5: the file at the row\'s registered path is a different item -> pre_rp_brief_verification_failed', async () => {
    world.flags.fileIdOverride = OTHER_ITEM_ID;
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_verification_failed');
    expect(result.errorMessage).toMatch(/not its registered item/);
  });

  test('I5: a content hash that is not a fresh render of the stored snapshot -> pre_rp_brief_verification_failed', async () => {
    world.flags.afterCommit = () => {
      const [row] = briefRows();
      row.wmkf_contenthash = 'gdc1:not-the-render';
    };
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_verification_failed');
    expect(result.errorMessage).toMatch(/fresh render/);
  });

  test('I5: a pointer moved off this run\'s row after activation -> pre_rp_brief_verification_failed', async () => {
    world.flags.afterCommit = () => { world.request._wmkf_currentprerpbrief_value = FOREIGN_ROW_ID; };
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('pre_rp_brief_verification_failed');
    expect(result.errorMessage).toMatch(/pointer/);
  });

  test('deleteFile is journal-bound: a rival pointer move during upload makes the producer clean up -- only the exact item this invocation uploaded', async () => {
    world.flags.afterUpload = () => {
      world.seedRow({ wmkf_requestdocumentid: FOREIGN_ROW_ID, wmkf_generationkey: 'c'.repeat(64), wmkf_operationstatus: READY });
      world.request._wmkf_currentprerpbrief_value = FOREIGN_ROW_ID;
    };
    const { result, calls } = await freshBriefRun();
    expect(result.outcome).toBe('needs_attention');
    expect(world.log.deletes).toEqual([{ driveId: DRIVE_ID, itemId: ITEM_ID }]);
    const dispatched = calls.find((c) => c.op === 'recordResourceReadback' && c.outcome === 'dispatched');
    expect(dispatched.readback).toMatchObject({ itemId: ITEM_ID, driveId: DRIVE_ID });
  });

  test('preflight: a drifted Graph site/drive -> preflight_identity_changed before any read or write', async () => {
    runPreflight.mockImplementationOnce(async () => ({ siteId: SITE_ID, driveId: 'b!OTHERDRIVE0123456789ab' }));
    const { result } = await freshBriefRun();
    expect(result.run.needsAttentionReason).toBe('preflight_identity_changed');
    expect(createPreRpBriefSandboxDeps).not.toHaveBeenCalled();
  });
});

function OWNERSHIP_CASES() {
  return [
    ['Test Request marker', (r) => { r.wmkf_istestrequest = false; }],
    ['run id marker', (r) => { r.wmkf_testcreationrunid = FOREIGN_ROW_ID; }],
    ['app-user owner', (r) => { r._ownerid_value = FOREIGN_ROW_ID; }],
  ];
}

describe('seed_abstract -> render_pre_rp_brief (behavioral chain through the successor seam)', () => {
  test('both advance in order; neither marks ready', async () => {
    const seeded = await runStep('seed_abstract');
    expect(seeded.result.run.currentStep).toBe('render_pre_rp_brief');
    const rendered = await runStep('render_pre_rp_brief', { resources: seeded.resources });
    expect(rendered.result.outcome).toBe('advanced');
    expect(rendered.result.run.currentStep).toBe('start_site_visit');
    expect([...seeded.calls, ...rendered.calls].filter((c) => c.op === 'markReady')).toHaveLength(0);
  });
});
