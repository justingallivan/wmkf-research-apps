/**
 * Test Request Factory slice 4b -- the `pre_site_visit` recipe's four step
 * bodies (lib/services/test-requests/run-runner.js `stepSeedPresiteAiRun`/
 * `stepSeedPresiteDraft`/`stepRenderPresite`/`stepVerifyPresite`).
 *
 * `presite-sandbox-deps.js` and `loadPreSiteVisitInputs` (proposal-core-
 * service.js) are module-mocked here: their OWN sandbox-transport/host-
 * validation/sentinel correctness is proven directly in
 * presite-sandbox-deps.test.js. This file drives `advanceRun` with a
 * recording fake ledger and a small, mutable in-memory "world" (Dataverse
 * request-document/AI-run rows, one SharePoint file) standing in for the
 * mocked deps' return values, so every assertion here is about run-runner.js's
 * OWN step orchestration: journal-before-write, exact-id recovery, error
 * classification, and which step reaches which real downstream function.
 * `generatePreSiteVisitArtifact` (artifact-service.js), its lineage/model
 * internals, and `attestDocxPackageAgainstRender` (docx-package-
 * attestation.js) are REAL -- not mocked -- and `renderDocx`/`hashDocx` call
 * the real renderer/hasher, so DOCX bytes and content hashes are genuine.
 *
 * @jest-environment node
 */
// `jest` is used only as the ambient global here (never imported from
// '@jest/globals'): importing it explicitly alongside these jest.mock()
// factory calls breaks babel-plugin-jest-hoist's hoisting -- the hoisted
// jest.mock() calls then run before the import binds, so the manual mock
// factories are silently discarded and the real modules load instead
// (confirmed empirically; neither existing sandbox-deps test file in this
// repo combines the two, which is why this had never been hit before).
import crypto from 'node:crypto';
import JSZip from 'jszip';

jest.mock('../../lib/services/test-requests/presite-sandbox-deps.js', () => ({
  createPresiteAiRunDeps: jest.fn(),
  createPresiteSandboxDeps: jest.fn(),
  createPresiteInputDeps: jest.fn(),
}));
jest.mock('../../lib/services/pre-site-visit/proposal-core-service.js', () => ({
  ...jest.requireActual('../../lib/services/pre-site-visit/proposal-core-service.js'),
  loadPreSiteVisitInputs: jest.fn(),
}));

import { advanceRun, RECIPE_STEP_ORDER } from '../../lib/services/test-requests/run-runner.js';
import {
  createPresiteAiRunDeps, createPresiteSandboxDeps, createPresiteInputDeps,
} from '../../lib/services/test-requests/presite-sandbox-deps.js';
import { loadPreSiteVisitInputs } from '../../lib/services/pre-site-visit/proposal-core-service.js';
import { assertLedgerReceipt, ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
// P3 (Opus round 1): a PARTIAL mock -- runPreflight defaults to a fake
// resolved value matching baseRun()'s expectedGraphSiteId/expectedGraphDriveId
// below (never the real, network-calling implementation, which none of this
// file's fake client/graph objects can satisfy); every other export
// (MANIFEST_V4/sha256/computeRunPlanDigest) stays real.
jest.mock('../../lib/services/test-requests/basic-clone-steps.js', () => ({
  ...jest.requireActual('../../lib/services/test-requests/basic-clone-steps.js'),
  runPreflight: jest.fn(async () => ({ siteId: 'SITE-1', driveId: 'DRIVE-1' })),
}));
import { MANIFEST_V4, sha256, computeRunPlanDigest, runPreflight } from '../../lib/services/test-requests/basic-clone-steps.js';
import { reviewFileCopyPolicyDigest } from '../../lib/services/test-requests/review-file-copy.js';
// Codex adversarial round 2 (finding 3): assertOwnedPresiteFile independently
// recomputes the expected Pre-Site folder via this SAME function -- fixture
// rows must use its real output, never a hand-typed approximation, or the
// new check refuses every fixture regardless of whether anything actually
// drifted.
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';
import {
  buildPreSiteVisitIdentity,
  buildPreSiteVisitInputSnapshot,
  documentFieldsFromSnapshot,
  validateNarrativePrompt,
  UNCHANGED_RETRY_BLOCKED_CODES,
} from '../../lib/services/pre-site-visit/artifact-model.js';
import { PRE_SITE_VISIT_CONTRACT, REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument.js';
import { PROPOSAL_CORE_KEYS, PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA, USER_PROMPT_TEMPLATE, REQUIRED_SYSTEM_ASSERTIONS } from '../../shared/config/prompts/pre-site-visit-proposal-core.js';
import { PRE_SITE_SECTION_FIELDS } from '../../lib/services/test-requests/source-bundle.js';

// P3 (Opus round 1): a PARTIAL mock -- generatePreSiteVisitArtifact defaults
// to calling straight through to the REAL implementation (every other test
// in this file exercises the genuine producer, unmocked), so only the P3
// describe block below, which explicitly overrides it per test with
// mockImplementationOnce, ever sees synthetic behavior. Named ESM exports
// compile to non-configurable getters, so jest.spyOn on a namespace import
// cannot redefine this function directly; a module mock is the only seam.
jest.mock('../../lib/services/pre-site-visit/artifact-service.js', () => {
  const actual = jest.requireActual('../../lib/services/pre-site-visit/artifact-service.js');
  return { ...actual, generatePreSiteVisitArtifact: jest.fn(actual.generatePreSiteVisitArtifact) };
});
import { generatePreSiteVisitArtifact } from '../../lib/services/pre-site-visit/artifact-service.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const PROMPT_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_NUMBER = '1002379';

function proposalCoreFixture() {
  const core = Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, `${key} test content.`]));
  core.personnelDetails = 'Ada Principal (PI) leads modeling.';
  return core;
}

function sectionFieldsFor(core) {
  const SECTION_FIELD_MAP = {
    executiveSummary: 'wmkf_presiteexecutivesummary',
    impactOverview: 'wmkf_presiteimpactoverview',
    methodologyOverview: 'wmkf_presitemethodologyoverview',
    personnelOverview: 'wmkf_presitepersonneloverview',
    keckFundingRationale: 'wmkf_presitekeckfundingrationale',
    backgroundAndImpact: 'wmkf_presitebackgroundandimpact',
    detailedMethodology: 'wmkf_presitedetailedmethodology',
    personnelDetails: 'wmkf_presitepersonneldetails',
  };
  return Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [SECTION_FIELD_MAP[key], core[key]]));
}

function inputFixture(overrides = {}) {
  return {
    context: {
      requestId: REQUEST_ID,
      requestNumber: REQUEST_NUMBER,
      cycleCode: 'D26',
      projectTitle: 'A test project',
      applicantInstitution: 'Applicant University',
      projectPeriod: { startDate: '2027-01-01', endDate: '2029-12-31' },
      personnel: [{ name: 'Ada Principal', role: 'Principal Investigator' }],
      refereeSectionDiagnostics: [],
      documentFields: {
        institutionName: 'Applicant University',
        cityState: 'Atlanta, GA',
        internalProgram: 'Medical Research',
        projectTitle: 'A test project',
        meetingDate: 'December 2026',
        requestedAmount: '$900,000',
        programDirector: 'Pat Director',
        invitedAmount: '$1,000,000',
        totalProjectBudget: '$3,500,000',
        institutionalFundingHistory: 'Applicant University has received 8 awards totaling $9.15 million from WMKF.',
        refereeSection: null,
        ...overrides.documentFields,
      },
      ...overrides.context,
    },
    proposalNarrative: {
      filename: `ProposalNarrative_${REQUEST_NUMBER}.pdf`,
      text: 'Narrative text '.repeat(20),
      siteId: 'site-id', driveId: 'drive-id', itemId: 'narrative-item', versionId: '1.0',
      contentHash: 'a'.repeat(64),
      ...overrides.proposalNarrative,
    },
  };
}

function promptFixture() {
  return {
    wmkf_ai_promptid: PROMPT_ID,
    wmkf_ai_promptname: PRE_SITE_VISIT_CONTRACT.promptName,
    wmkf_promptversion: 4,
    wmkf_ai_promptvariables: JSON.stringify(PROMPT_VARIABLES),
    wmkf_ai_promptoutputschema: JSON.stringify(PROMPT_OUTPUT_SCHEMA),
    wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
    wmkf_ai_systemprompt: REQUIRED_SYSTEM_ASSERTIONS.join('\n'),
  };
}

const BASE_INPUTS = inputFixture();
const BASE_IDENTITY = buildPreSiteVisitIdentity({
  requestId: REQUEST_ID,
  inputSnapshot: buildPreSiteVisitInputSnapshot(BASE_INPUTS),
  promptIdentity: validateNarrativePrompt(promptFixture()),
});

function buildBundle(core = proposalCoreFixture()) {
  return {
    kind: 'test-request-source-bundle/v4',
    version: 4,
    reviewers: [],
    documents: [],
    preSiteVisit: {
      requestDocumentId: 'source-doc-id',
      sectionFields: sectionFieldsFor(core),
      proposalCoreJson: { schemaVersion: 4, proposalCore: core, diagnostics: [] },
    },
  };
}

function baseManifest(bundle, overrides = {}) {
  return {
    kind: MANIFEST_V4,
    recipe: 'pre_site_visit',
    source: { requestId: SOURCE_ID, revision: '1', bundleSha256: sha256(bundle) },
    createBodySha256: 'body-hash',
    copyPolicy: { digest: 'policy-digest' },
    values: { requestId: REQUEST_ID, locationId: LOCATION_ID },
    reviewFilePolicy: { digest: reviewFileCopyPolicyDigest() },
    ...overrides,
  };
}

function baseRun(bundle, overrides = {}) {
  const manifest = baseManifest(bundle);
  return {
    runId: RUN_ID, recipe: 'pre_site_visit', status: 'creating',
    currentStep: 'seed_presite_ai_run', stepIndex: 14, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: sha256(bundle), copyPolicyDigest: 'policy-digest',
    sourceRequestId: SOURCE_ID, sourceRequestNumber: REQUEST_NUMBER, sourceRevision: '1',
    destinationRequestId: REQUEST_ID, destinationLocationId: LOCATION_ID, destinationRequestNumber: REQUEST_NUMBER,
    planDigest: computeRunPlanDigest({ manifest, reviewerAddressDigests: [] }),
    // P3 (Opus round 1): matches the mocked runPreflight's default resolved
    // value below, so the new site/drive identity fence in all four presite
    // steps passes by default; individual tests override one side to prove
    // the fence itself.
    expectedGraphSiteId: 'SITE-1', expectedGraphDriveId: 'DRIVE-1',
    ...overrides,
  };
}

/** Recording fake ledger (matches run-ledger.js's shape; every call runs the real receipt validator). */
function createFakeLedger(initialRun, initialResources = []) {
  const calls = [];
  let run = { ...initialRun };
  const resources = initialResources.map((r) => ({ ...r }));
  let nextSequence = resources.length + 1;
  let nextResourceId = resources.length + 1;
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
    async advanceStep({ leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, destinationRequestNumber }) {
      calls.push({ op: 'advanceStep', nextStep });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, currentStep: nextStep, stepIndex: nextStepIndex, status: status ?? run.status, destinationRequestNumber: destinationRequestNumber ?? run.destinationRequestNumber, version: run.version + 1 };
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
    async journalPlannedResource({ runId, step, resourceKind, system, plannedIdentity }) {
      assertLedgerReceipt(plannedIdentity ?? {}, 'plannedIdentity');
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      const resource = { resourceId: nextResourceId++, runId, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
      if (readback != null) assertLedgerReceipt(readback, 'readback');
      calls.push({ op: 'recordResourceReadback', resourceId, readback, outcome });
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.readback = readback;
      resource.outcome = outcome;
      resource.responseStatus = responseStatus;
      return { ...resource };
    },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
    // pre_site_visit is cumulative on top of `reviews`: assertRunMatchesManifestAndBundle
    // reads the reviewer-assignment projection for any recipe past `verify_reviews`
    // (recipeSeedsReviewers), even though slice 4b's own steps don't journal new
    // assignment rows. No reviewer landed in these fixtures, so both are empty --
    // matching the shape used by test-request-run-runner-verify-reviews.test.js.
    async listRunReviewerAssignments() { return []; },
    async getRunReviewerAssignment() { return null; },
  };
  return { ledger, calls, resources };
}

/** The mutable in-memory Dataverse/Graph world stepXxx's mocked deps read/write. */
function createWorld() {
  const rows = new Map();
  const aiRuns = new Map();
  const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null, _etag: 'request-1' };
  let etag = 1;
  let uploadedBytes = null;
  let uploaded = null;
  const flags = { forceUploadConflict: false, forceAiRunConflict: false, downloadOverrideBuffer: null };

  function applyDocumentPatch(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'wmkf_AIPrompt@odata.bind') target._wmkf_aiprompt_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      else if (key === 'wmkf_AIRun@odata.bind') target._wmkf_airun_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      else if (key === 'wmkf_Request@odata.bind') target._wmkf_request_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      else target[key] = value;
    }
    target._etag = `row-${++etag}`;
    target.modifiedon = new Date().toISOString();
  }

  const { renderPreSiteVisitDocx } = jest.requireActual('../../lib/services/pre-site-visit/docx-renderer.js');
  const { hashGovernedDocxContent } = jest.requireActual('../../lib/services/documents/governed-docx-hash.js');
  const { attestDocxPackageAgainstRender } = jest.requireActual('../../lib/services/test-requests/docx-package-attestation.js');

  const dependencies = {
    getCurrentPrompt: jest.fn(async () => promptFixture()),
    runProposalCore: jest.fn(async () => { throw new Error('presite test double: runProposalCore must never be reached by a correctly seeded row.'); }),
    renderDocx: jest.fn((args) => renderPreSiteVisitDocx(args)),
    hashDocx: jest.fn((buf) => hashGovernedDocxContent(buf)),
    getRequest: jest.fn(async () => ({ ...request })),
    getBuckets: jest.fn(async () => { throw new Error('presite test double: getBuckets must never be reached (the seeded row is always found by generation key).'); }),
    findByGenerationKey: jest.fn(async (key) => ({
      records: [...rows.values()].filter((r) => r.wmkf_generationkey === key).map((r) => ({ ...r })),
    })),
    findByRequest: jest.fn(async () => ({ records: [...rows.values()].map((r) => ({ ...r })) })),
    createDocument: jest.fn(async (payload) => {
      const id = crypto.randomUUID();
      const row = {
        wmkf_requestdocumentid: id, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
        wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
        _etag: `row-${etag}`, createdon: new Date().toISOString(), modifiedon: new Date().toISOString(),
      };
      applyDocumentPatch(row, payload);
      rows.set(id, row);
      return { ...row };
    }),
    updateDocument: jest.fn(async (id, patch, options) => {
      const row = rows.get(id);
      if (!row) throw new Error(`presite test double: row ${id} not found`);
      if (options?.ifMatch && options.ifMatch !== row._etag) throw Object.assign(new Error('conflict'), { status: 412 });
      applyDocumentPatch(row, patch);
    }),
    commitChangeset: jest.fn(async (operations) => {
      for (const op of operations) {
        if (op.entitySet === 'wmkf_requestdocuments') {
          const target = rows.get(op.key);
          if (!target) throw new Error(`presite test double: row ${op.key} not found`);
          if (op.ifMatch && op.ifMatch !== target._etag) throw Object.assign(new Error('conflict'), { status: 412 });
          applyDocumentPatch(target, op.body);
        } else if (op.entitySet === 'akoya_requests') {
          request._wmkf_currentpresitevisit_value = op.body['wmkf_CurrentPreSiteVisit@odata.bind'].match(/\(([^)]+)\)/)?.[1];
          request._etag = `request-${++etag}`;
        }
      }
    }),
    ensureFolderPath: jest.fn(async () => undefined),
    // conflictBehavior: 'fail' is asserted here -- proves the wrapper forces
    // it regardless of what the caller (artifact-service.js, which passes
    // only 5 positional args) supplies.
    uploadFile: jest.fn(async (library, folder, filename, content, contentType, options) => {
      if (options?.conflictBehavior !== 'fail') {
        throw new Error(`presite test double: expected conflictBehavior 'fail', got ${JSON.stringify(options)}`);
      }
      if (flags.forceUploadConflict) throw Object.assign(new Error('SharePoint item already exists'), { status: 409 });
      uploadedBytes = content;
      uploaded = {
        // Codex adversarial round 2 (finding 3): must equal baseRun's
        // expectedGraphSiteId/expectedGraphDriveId ('SITE-1'/'DRIVE-1') --
        // assertOwnedPresiteFile requires the row's OWN bound site/drive
        // (set from this exact response by commitReadyLineage) to equal the
        // run's prepared Graph target.
        siteId: 'SITE-1', driveId: 'DRIVE-1', id: 'item-1', webUrl: 'https://sp.test/x',
        versionId: '1.0', eTag: '"file-1"', size: content.length, lastModified: new Date().toISOString(), name: filename,
      };
      return { ...uploaded };
    }),
    getFileMetadataByPath: jest.fn(async () => (uploaded ? { ...uploaded } : null)),
    downloadFile: jest.fn(async () => ({ buffer: flags.downloadOverrideBuffer || uploadedBytes })),
    deleteFile: jest.fn(async () => undefined),
    newClaimToken: jest.fn(() => crypto.randomUUID()),
    isGuardedReopenSchemaReady: jest.fn(() => false),
    createAiRun: jest.fn(async (payload) => {
      if (flags.forceAiRunConflict) throw Object.assign(new Error('duplicate primary key'), { status: 409 });
      // Codex adversarial round 1: isOwnedStubAiRun rereads by
      // _wmkf_ai_request_value/_wmkf_ai_prompt_value (the readback field
      // names), never the create payload's own bind keys -- translate here
      // exactly like applyDocumentPatch does for the request-document rows,
      // so a REAL seed_presite_ai_run flow produces a row later steps can
      // actually re-verify ownership against.
      const row = { ...payload, _etag: 'ai-run-1' };
      if (row['wmkf_ai_Request@odata.bind']) {
        row._wmkf_ai_request_value = row['wmkf_ai_Request@odata.bind'].match(/\(([^)]+)\)/)?.[1] || null;
        delete row['wmkf_ai_Request@odata.bind'];
      }
      if (row['wmkf_ai_Prompt@odata.bind']) {
        row._wmkf_ai_prompt_value = row['wmkf_ai_Prompt@odata.bind'].match(/\(([^)]+)\)/)?.[1] || null;
        delete row['wmkf_ai_Prompt@odata.bind'];
      }
      aiRuns.set(payload.wmkf_ai_runid, row);
      return { ...row };
    }),
    getAiRunById: jest.fn(async (id) => (aiRuns.has(id) ? { ...aiRuns.get(id) } : null)),
  };

  return {
    dependencies, rows, aiRuns, request, flags,
    get uploadedBytes() { return uploadedBytes; },
    attestDocxPackageAgainstRender,
    // Simulates a completed prior upload (a crash between upload and commit):
    // getFileMetadataByPath/downloadFile read this back without a new
    // uploadFile call, matching what recoverUploadedFile requires.
    seedUploaded(metadata, bytes) {
      uploaded = { ...metadata };
      uploadedBytes = bytes;
    },
    seedRawRow(overrides) {
      const id = overrides.wmkf_requestdocumentid || crypto.randomUUID();
      const row = {
        wmkf_requestdocumentid: id,
        _wmkf_request_value: REQUEST_ID,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
        wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: BASE_IDENTITY.generationKey,
        wmkf_inputfingerprint: BASE_IDENTITY.inputFingerprint,
        wmkf_claimtoken: null,
        // Codex adversarial round 2 (finding 2): assertOwnedPresiteDraft
        // requires the row's bound prompt id (never just name/version) to
        // equal the freshly validated sandbox promptIdentity.
        _wmkf_aiprompt_value: PROMPT_ID,
        wmkf_promptname: PRE_SITE_VISIT_CONTRACT.promptName,
        wmkf_promptversion: 4,
        wmkf_templateid: PRE_SITE_VISIT_CONTRACT.templateId,
        wmkf_templateversion: PRE_SITE_VISIT_CONTRACT.templateVersion,
        wmkf_sharepointfolderpath: `${expectedRequestFolder(REQUEST_NUMBER, REQUEST_ID)}/${PRE_SITE_VISIT_CONTRACT.relativeFolder}`,
        wmkf_filename: `${REQUEST_NUMBER} Pre-Site Visit test.docx`,
        wmkf_attemptcount: 1,
        _etag: 'row-1',
        createdon: new Date().toISOString(),
        modifiedon: new Date().toISOString(),
        ...overrides,
      };
      rows.set(id, row);
      return row;
    },
  };
}

function operationStatusEnum() {
  // Real string values REQUEST_DOCUMENT_OPERATION_STATUS/LIFECYCLE_STATE map
  // to -- read once, reused everywhere below instead of re-importing per call.
  const { REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE } = jest.requireActual('../../shared/config/requestDocument.js');
  return { REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE };
}
const { REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE } = operationStatusEnum();

let world;

beforeEach(() => {
  world = createWorld();
  loadPreSiteVisitInputs.mockImplementation(async () => world.inputs ?? BASE_INPUTS);
  createPresiteAiRunDeps.mockImplementation(() => ({
    createAiRun: world.dependencies.createAiRun,
    getAiRunById: world.dependencies.getAiRunById,
    getCurrentPrompt: world.dependencies.getCurrentPrompt,
  }));
  createPresiteInputDeps.mockImplementation(() => ({}));
  // Echoes `loadInputs` back UNCHANGED (item 8): the same seam
  // seed_presite_draft/render_presite/verify_presite each construct.
  createPresiteSandboxDeps.mockImplementation(({ loadInputs }) => ({
    ...world.dependencies,
    loadInputs,
    // Mirrors the real presite-sandbox-deps.js wrapper's I2 forcing (item 5):
    // artifact-service.js calls uploadFile with only 5 positional args, so the
    // wrapper -- not the caller -- is what must supply conflictBehavior:
    // 'fail'. presite-sandbox-deps.js itself is module-mocked in this file
    // (its own transport/host-validation is covered directly in
    // presite-sandbox-deps.test.js), so this replicates only that one seam;
    // world.dependencies.uploadFile below asserts the option actually arrived.
    uploadFile: (library, folder, filename, content, contentType) => world.dependencies.uploadFile(
      library, folder, filename, content, contentType, { conflictBehavior: 'fail' },
    ),
  }));

  // P3 (Opus round 1): a prior version of this file spied on DynamicsService
  // here and asserted "not called" -- vacuous, since none of this file's REAL
  // (unmocked) call graph (generatePreSiteVisitArtifact and its
  // artifact-model.js/artifact-lineage.js helpers, attestDocxPackageAgainstRender,
  // renderPreSiteVisitDocx, hashGovernedDocxContent) references
  // DynamicsService at all -- every Dataverse call in this file's own steps
  // goes through the module-mocked presite-sandbox-deps.js/proposal-core-
  // service.js instead. No mutation in these steps could ever have made that
  // spy fire, so it was removed rather than kept as false confidence; I9 is
  // proven directly in presite-sandbox-deps.test.js's own sandbox-host-
  // validation/throwing-sentinel tests, where a real production call would
  // actually be reachable if presite-sandbox-deps.js's own guards failed.
});

afterEach(() => {
  jest.clearAllMocks();
});

const client = { baseUrl: 'https://orgd9e66399.crm.dynamics.com/api/data/v9.2' };
const graph = {}; // forwarded verbatim by the mocked createPresiteSandboxDeps; unused directly

async function runStep(currentStep, { resources = [], runOverrides = {}, bundle = buildBundle() } = {}) {
  const run0 = baseRun(bundle, { currentStep, ...runOverrides });
  const { ledger, calls, resources: liveResources } = createFakeLedger(run0, resources);
  const manifest = baseManifest(bundle);
  const result = await advanceRun({
    runId: RUN_ID, ledger, manifest, bundle,
    deps: { client, graph, sharePointTarget: () => ({}) },
  });
  return { result, calls, resources: liveResources };
}

describe('RECIPE_STEP_ORDER.pre_site_visit shape (sanity for the fixtures below)', () => {
  test('has exactly the four new steps after verify_reviews', () => {
    expect(RECIPE_STEP_ORDER.pre_site_visit.slice(-4)).toEqual([
      'seed_presite_ai_run', 'seed_presite_draft', 'render_presite', 'verify_presite',
    ]);
  });
});

describe('item 1: seed_presite_ai_run -- stub run via the sandbox only', () => {
  test('happy path: exactly one createAiRun POST with the preallocated GUID, both binds, run source 682090002, notes carrying the run id; the production sentinel is never touched', async () => {
    const { result, resources } = await runStep('seed_presite_ai_run');
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.createAiRun).toHaveBeenCalledTimes(1);
    const [payload] = world.dependencies.createAiRun.mock.calls[0];
    expect(payload.wmkf_ai_runid).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload['wmkf_ai_Request@odata.bind']).toBe(`/akoya_requests(${REQUEST_ID})`);
    expect(payload['wmkf_ai_Prompt@odata.bind']).toBe(`/wmkf_ai_prompts(${PROMPT_ID})`);
    expect(payload.wmkf_ai_runsource).toBe(682090002);
    expect(payload.wmkf_ai_notes).toContain(RUN_ID);
    expect(world.aiRuns.size).toBe(1);
    const readback = resources.find((r) => r.step === 'seed_presite_ai_run')?.readback;
    expect(readback.confirmedRunId).toBe(payload.wmkf_ai_runid);
  });

  test('resume: journaled GUID + readback exists and matches -> recovered, no second POST', async () => {
    const runId = crypto.randomUUID();
    world.aiRuns.set(runId, {
      wmkf_ai_runid: runId, _wmkf_ai_request_value: REQUEST_ID, _wmkf_ai_prompt_value: PROMPT_ID, wmkf_ai_promptversion: 4,
      wmkf_ai_runsource: 682090002, wmkf_ai_status: 682090000, wmkf_ai_notes: `Test Request Factory run ${RUN_ID}`,
    });
    const priorResources = [{
      resourceId: 1, sequence: 1, step: 'seed_presite_ai_run', resourceKind: 'dataverse_ai_run', system: 'dataverse',
      plannedIdentity: { runId }, readback: { runId }, outcome: 'dispatched',
    }];
    const { result } = await runStep('seed_presite_ai_run', { resources: priorResources });
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();
  });

  test('resume: journaled GUID but readback is bound to a different request -> refuses (presite_ai_run_ambiguous)', async () => {
    const runId = crypto.randomUUID();
    world.aiRuns.set(runId, { wmkf_ai_runid: runId, _wmkf_ai_request_value: crypto.randomUUID() });
    const priorResources = [{
      resourceId: 1, sequence: 1, step: 'seed_presite_ai_run', resourceKind: 'dataverse_ai_run', system: 'dataverse',
      plannedIdentity: { runId }, readback: { runId }, outcome: 'dispatched',
    }];
    const { result } = await runStep('seed_presite_ai_run', { resources: priorResources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();
  });

  test.each([
    ['no prompt bound', { _wmkf_ai_prompt_value: null }],
    ['wrong run source', { wmkf_ai_runsource: 999999999 }],
    ['wrong status', { wmkf_ai_status: 999999999 }],
    ['notes do not carry this run\'s id', { wmkf_ai_notes: 'Test Request Factory run some-other-run' }],
  ])('P3: resume with every OTHER field matching but %s -> refuses (presite_ai_run_ambiguous), not silently adopted', async (_label, badField) => {
    const runId = crypto.randomUUID();
    world.aiRuns.set(runId, {
      wmkf_ai_runid: runId, _wmkf_ai_request_value: REQUEST_ID, _wmkf_ai_prompt_value: PROMPT_ID, wmkf_ai_promptversion: 4,
      wmkf_ai_runsource: 682090002, wmkf_ai_status: 682090000, wmkf_ai_notes: `Test Request Factory run ${RUN_ID}`,
      ...badField,
    });
    const priorResources = [{
      resourceId: 1, sequence: 1, step: 'seed_presite_ai_run', resourceKind: 'dataverse_ai_run', system: 'dataverse',
      plannedIdentity: { runId }, readback: { confirmedRunId: runId }, outcome: 'verified',
    }];
    const { result } = await runStep('seed_presite_ai_run', { resources: priorResources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();
  });

  test('resume: journaled GUID absent after an ambiguous POST -> refuses, never re-POSTs blind', async () => {
    const runId = crypto.randomUUID(); // never created in world.aiRuns
    const priorResources = [{
      resourceId: 1, sequence: 1, step: 'seed_presite_ai_run', resourceKind: 'dataverse_ai_run', system: 'dataverse',
      plannedIdentity: { runId }, readback: { runId }, outcome: 'dispatched',
    }];
    const { result } = await runStep('seed_presite_ai_run', { resources: priorResources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();
  });

  test('P3: a failed prompt read journals NOTHING and stays cleanly retryable (not conflated with an ambiguous POST)', async () => {
    world.dependencies.getCurrentPrompt.mockImplementationOnce(async () => { throw new Error('synthetic prompt read failure'); });
    const failed = await runStep('seed_presite_ai_run');
    expect(failed.result.outcome).toBe('needs_attention');
    expect(failed.result.run.needsAttentionReason).not.toBe('presite_ai_run_ambiguous');
    expect(failed.resources).toHaveLength(0);
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();

    // Retry with the SAME (empty) resource list, as a real re-invocation
    // would see: succeeds cleanly, not refused as ambiguous.
    const retried = await runStep('seed_presite_ai_run');
    expect(retried.result.outcome).toBe('advanced');
    expect(world.dependencies.createAiRun).toHaveBeenCalledTimes(1);
  });

  test('P3 follow-up (Opus round 2): a prompt that FAILS validation (no promptId) journals NOTHING, refuses before createAiRun, and stays cleanly retryable', async () => {
    world.dependencies.getCurrentPrompt.mockImplementationOnce(async () => ({ ...promptFixture(), wmkf_ai_promptid: null }));
    const failed = await runStep('seed_presite_ai_run');
    expect(failed.result.outcome).toBe('needs_attention');
    expect(failed.result.run.needsAttentionReason).not.toBe('presite_ai_run_ambiguous');
    expect(failed.resources).toHaveLength(0);
    expect(world.dependencies.createAiRun).not.toHaveBeenCalled();

    const retried = await runStep('seed_presite_ai_run');
    expect(retried.result.outcome).toBe('advanced');
    expect(world.dependencies.createAiRun).toHaveBeenCalledTimes(1);
  });
});

// Codex adversarial round 1: seed_presite_draft/verify_presite now REREAD
// and re-verify full stub-AI-run ownership (isOwnedStubAiRun) against the
// journaled confirmedRunId, not merely trust the marker -- so this fixture
// must also seed a matching, genuinely owned world.aiRuns row, exactly what
// seed_presite_ai_run's own create would have produced.
function seedAiRunResource(resourceId = 1) {
  const runId = crypto.randomUUID();
  world.aiRuns.set(runId, {
    wmkf_ai_runid: runId, _wmkf_ai_request_value: REQUEST_ID, _wmkf_ai_prompt_value: PROMPT_ID, wmkf_ai_promptversion: 4,
    wmkf_ai_runsource: 682090002, wmkf_ai_status: 682090000, wmkf_ai_notes: `Test Request Factory run ${RUN_ID}`,
  });
  return {
    runId,
    resource: {
      resourceId, sequence: resourceId, step: 'seed_presite_ai_run', resourceKind: 'dataverse_ai_run', system: 'dataverse',
      plannedIdentity: { runId }, readback: { confirmedRunId: runId }, outcome: 'verified',
    },
  };
}

// Codex adversarial round 2 (findings 1/2): render_presite/verify_presite now
// require a confirmed seed_presite_draft ledger resource (cross-checked
// against the row's own id) before trusting a row found by generation key --
// every test that seeds a raw row directly (rather than going through a real
// seed_presite_draft step) must also journal this resource, or the new fence
// refuses before ever reaching the producer/verification logic under test.
function seedDraftResourceFor(row, resourceId = 2) {
  return {
    resourceId, sequence: resourceId, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
    plannedIdentity: { generationKey: row.wmkf_generationkey },
    readback: {
      requestDocumentId: row.wmkf_requestdocumentid,
      claimTokenSha256: crypto.createHash('sha256').update(row.wmkf_claimtoken || '').digest('hex'),
    },
    outcome: 'verified',
  };
}

describe('item 2: seed_presite_draft -- seeded row shape', () => {
  test('creates exactly one row: FAILED, a factory code outside UNCHANGED_RETRY_BLOCKED_CODES, run + prompt bound, section fields + core envelope + snapshot present', async () => {
    const { runId, resource } = seedAiRunResource();
    const { result } = await runStep('seed_presite_draft', { resources: [resource] });
    expect(result.outcome).toBe('advanced');
    expect(world.rows.size).toBe(1);
    const [row] = [...world.rows.values()];
    expect(row.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
    expect(UNCHANGED_RETRY_BLOCKED_CODES.has(row.wmkf_lasterrorcode)).toBe(false);
    expect(row._wmkf_airun_value).toBe(runId);
    expect(row._wmkf_aiprompt_value).toBe(PROMPT_ID);
    for (const field of PRE_SITE_SECTION_FIELDS) expect(typeof row[field]).toBe('string');
    expect(row.wmkf_presiteproposalcorejson).toBeTruthy();
    expect(row.wmkf_presiteinputsnapshotjson).toBeTruthy();
    expect(JSON.parse(row.wmkf_presiteinputsnapshotjson)).toEqual(buildPreSiteVisitInputSnapshot(BASE_INPUTS));
  });

  // Codex adversarial round 2 (finding 1/2): before this round, dropping the
  // run bind at seed reached render_presite's producer call and failed
  // there, via `persistedDraft`'s own `!row._wmkf_airun_value` completeness
  // check (`pre_site_visit_draft_incomplete`). The NEW ownership pre-check
  // (`assertOwnedPresiteDraft`, which asserts the bound AI-run BEFORE
  // calling the producer at all) now catches this exact condition earlier,
  // with its own code -- `pre_site_visit_draft_incomplete` remains reachable
  // for a row missing ONLY its core/snapshot pair (item 3's own coverage),
  // just no longer for a missing run bind specifically.
  test('mutation: dropping the run bind at seed now refuses at the NEW ownership pre-check (presite_pointer_mismatch), never reaching the producer', async () => {
    const { resource } = seedAiRunResource();
    await runStep('seed_presite_draft', { resources: [resource] });
    const [row] = [...world.rows.values()];
    // Simulate the mutation directly on the seeded row rather than editing
    // source: the observable is identical (a row whose core+snapshot exist
    // but whose run bind is missing).
    row._wmkf_airun_value = null;
    const draftResource = seedDraftResourceFor(row);
    const { result } = await runStep('render_presite', { resources: [resource, draftResource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
    expect(world.rows.size).toBe(1);
    // Never reached the producer, so the row's own lasterrorcode is
    // untouched (still the factory seed code from seed_presite_draft), not
    // the producer's own completeness code.
    expect(row.wmkf_lasterrorcode).not.toBe('pre_site_visit_draft_incomplete');
  });

  test('resume: row already present with a matching claim token -> recovered, no second create', async () => {
    const { runId, resource } = seedAiRunResource();
    await runStep('seed_presite_draft', { resources: [resource] });
    const [row] = [...world.rows.values()];
    world.dependencies.createDocument.mockClear();
    const draftResource = {
      resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey: row.wmkf_generationkey },
      readback: { requestDocumentId: row.wmkf_requestdocumentid, claimTokenSha256: crypto.createHash('sha256').update(row.wmkf_claimtoken).digest('hex') },
      outcome: 'verified',
    };
    const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(1);
  });

  test('resume: row present but the journaled claim token no longer matches -> refuses (presite_pointer_mismatch)', async () => {
    const { resource } = seedAiRunResource();
    await runStep('seed_presite_draft', { resources: [resource] });
    const [row] = [...world.rows.values()];
    const draftResource = {
      resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey: row.wmkf_generationkey },
      readback: { requestDocumentId: row.wmkf_requestdocumentid, claimTokenSha256: 'f'.repeat(64) },
      outcome: 'verified',
    };
    const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
  });

  test('P2c: ambiguous create (createAttemptedAt journaled, requestDocumentId never confirmed) -> the row IS found by generationKey and its claim token matches -> adopted, no second create', async () => {
    const { runId, resource } = seedAiRunResource();
    const claimToken = crypto.randomUUID();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      wmkf_generationkey: BASE_IDENTITY.generationKey,
      wmkf_claimtoken: claimToken,
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const draftResource = {
      resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey: BASE_IDENTITY.generationKey },
      readback: {
        generationKey: BASE_IDENTITY.generationKey,
        claimTokenSha256: crypto.createHash('sha256').update(claimToken).digest('hex'),
        createAttemptedAt: new Date().toISOString(),
      },
      outcome: 'dispatched',
    };
    const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(1);
    expect(row.wmkf_requestdocumentid).toBeTruthy();
  });

  test('P2c: ambiguous create with a row found by generationKey but a non-matching claim token -> refuses (presite_pointer_mismatch), never re-POSTs blind', async () => {
    const { resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    world.seedRawRow({
      wmkf_generationkey: BASE_IDENTITY.generationKey,
      wmkf_claimtoken: crypto.randomUUID(), // a DIFFERENT claim token than the journaled digest below
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const draftResource = {
      resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey: BASE_IDENTITY.generationKey },
      readback: {
        generationKey: BASE_IDENTITY.generationKey,
        claimTokenSha256: 'f'.repeat(64),
        createAttemptedAt: new Date().toISOString(),
      },
      outcome: 'dispatched',
    };
    const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(1);
  });

  // Codex adversarial round 1 (I4 gap): seed_presite_draft used to trust the
  // journaled confirmedRunId marker at face value, never rereading the
  // actual wmkf_ai_run row -- these two tests mutate the world's copy of
  // that row (exactly what a since-reassigned or corrupted stub AI-run
  // would look like) and prove the NEW reread-and-reverify guard
  // (isOwnedStubAiRun, called before all three seed_presite_draft branches)
  // refuses rather than proceeding on stale trust.
  test('I4: the journaled AI-run\'s request binding no longer matches the destination request -> seed_presite_draft refuses (presite_ai_run_ambiguous)', async () => {
    const { runId, resource } = seedAiRunResource();
    world.aiRuns.get(runId)._wmkf_ai_request_value = crypto.randomUUID();
    const { result } = await runStep('seed_presite_draft', { resources: [resource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(0);
  });

  // Advisor follow-up: a bare isGuid check on the prompt bind would pass a
  // stub run rebound to a DIFFERENT, independently-valid prompt GUID --
  // isOwnedStubAiRun now compares the bound prompt id/version against THIS
  // run's own validated promptIdentity, not merely a shape check.
  test('I4: the journaled AI-run is bound to a different, validly-shaped prompt guid -> seed_presite_draft refuses (presite_ai_run_ambiguous)', async () => {
    const { runId, resource } = seedAiRunResource();
    world.aiRuns.get(runId)._wmkf_ai_prompt_value = crypto.randomUUID();
    const { result } = await runStep('seed_presite_draft', { resources: [resource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(0);
  });

  test('I4: the journaled AI-run\'s prompt version no longer matches -> seed_presite_draft refuses (presite_ai_run_ambiguous)', async () => {
    const { runId, resource } = seedAiRunResource();
    world.aiRuns.get(runId).wmkf_ai_promptversion = 999;
    const { result } = await runStep('seed_presite_draft', { resources: [resource] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(0);
  });
});

describe('item 3: runProposalCore never reached (three distinct fences)', () => {
  test('P2a: a seeded row GENERATING under a LIVE lease refuses (presite_pointer_mismatch) before the producer is ever called -- seed_presite_draft always writes FAILED, so a live-leased GENERATING row here means a concurrent OTHER writer', async () => {
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    world.seedRawRow({
      _wmkf_airun_value: crypto.randomUUID(),
      ...fields,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      modifiedon: new Date().toISOString(), // lease live (just claimed)
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const { result } = await runStep('render_presite');
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
    expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(1);
  });

  test('P2a: a seeded row GENERATING under an EXPIRED lease (this recipe\'s own crashed prior attempt, no prior upload) reclaims and regenerates, not a permanent refusal', async () => {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const claimToken = crypto.randomUUID();
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      // GENERATING_LEASE_MS (artifact-model.js) is well under a day.
      modifiedon: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('advanced');
    const [reclaimed] = [...world.rows.values()];
    expect(reclaimed.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    // Reclaimed with a FRESH claim token (claimExisting always mints a new
    // one on reclaim), never left carrying the stale, crashed attempt's token.
    expect(reclaimed.wmkf_claimtoken).not.toBe(claimToken);
    // No prior upload existed (world.uploaded starts unset), so this path
    // reclaims and re-renders/re-uploads -- recoverUploadedFile runs but
    // returns null at its own first guard (no persisted contentHash yet).
    expect(world.dependencies.uploadFile).toHaveBeenCalledTimes(1);
  });

  test('P2a: a seeded row GENERATING under an EXPIRED lease WITH a prior completed upload (crash between upload and commit) recovers it -- recoverUploadedFile actually recovers, no second upload', async () => {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const claimToken = crypto.randomUUID();
    const snapshot = buildPreSiteVisitInputSnapshot(BASE_INPUTS);
    const documentFields = documentFieldsFromSnapshot(snapshot);
    const { docx } = await world.dependencies.renderDocx({
      documentFields,
      proposalCore: core,
      personnelNames: (snapshot.request?.personnel || []).map((p) => p.name),
      refereeSection: documentFields.refereeSection ?? null,
    });
    const contentHash = await world.dependencies.hashDocx(docx);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_contenthash: contentHash,
      modifiedon: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(snapshot),
    });
    world.seedUploaded({
      siteId: 'SITE-1', driveId: 'DRIVE-1', id: 'item-1', webUrl: 'https://sp.test/x',
      versionId: '1.0', eTag: '"file-1"', size: docx.length, lastModified: new Date().toISOString(),
      name: row.wmkf_filename,
    }, docx);
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
    const [recovered] = [...world.rows.values()];
    expect(recovered.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  });

  test('both core and snapshot fields absent -> the throwing runProposalCore sentinel fires; needs_attention; no second row', async () => {
    const { runId, resource } = seedAiRunResource();
    const row = world.seedRawRow({
      wmkf_claimtoken: null,
      _wmkf_airun_value: runId,
      wmkf_presiteproposalcorejson: null,
      wmkf_presiteinputsnapshotjson: null,
    });
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('needs_attention');
    expect(world.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
    expect(world.rows.size).toBe(1);
  });

  test('a drifted section field (core no longer matches the audited envelope) -> pre_site_visit_core_reconciliation_required; runProposalCore is never reached', async () => {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteexecutivesummary: 'a drifted value that does not match the envelope',
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('needs_attention');
    expect(world.dependencies.runProposalCore).not.toHaveBeenCalled();
    // The fence fires BEFORE the row is ever claimed to GENERATING, so
    // markFailedIfOwned (artifact-lineage.js) intentionally no-ops -- it only
    // patches an owned, in-flight (GENERATING) row -- and the seeded row's own
    // fields are untouched. The specific inner code survives only in the
    // run's surfaced error message; the ledger's own ambient reason always
    // collapses to 'presite_verification_failed' (stepRenderPresite's catch).
    expect(result.errorMessage).toContain('do not match the audited envelope');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
    expect(world.rows.size).toBe(1);
  });

  test('roster drift (item 4): a review landing changes the recomputed generation key before render -> the seeded row is not found and render refuses before calling the producer (Codex round 3), never reaching runProposalCore or the create branch', async () => {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    // A review landed between seed and render: the referee section changes,
    // which changes the input snapshot and therefore the generation key.
    world.inputs = inputFixture({ documentFields: { refereeSection: { text: 'We received one review.', names: ['Dr. A'] } } });
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
    expect(result.errorMessage).toContain('not found by its generation key');
    expect(world.dependencies.runProposalCore).not.toHaveBeenCalled();
    expect(world.dependencies.getBuckets).not.toHaveBeenCalled();
    expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(1);
  });

  test('happy path (matching draft): reaches render/upload/commit without ever calling runProposalCore', async () => {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
    expect(result.outcome).toBe('advanced');
    expect(world.dependencies.runProposalCore).not.toHaveBeenCalled();
    const [rendered] = [...world.rows.values()];
    expect(rendered.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(rendered.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT);
    expect(world.request._wmkf_currentpresitevisit_value).toBe(rendered.wmkf_requestdocumentid);
    expect(world.rows.size).toBe(1);
  });
});

describe('item 5: upload create-only', () => {
  function seedMatchingRow() {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    return { row, resources: [resource, seedDraftResourceFor(row)] };
  }

  // Not tautological: this swaps in the REAL (unmocked) createPresiteSandboxDeps's
  // own uploadFile wrapper for this one test, wired over a fake Graph object
  // this test controls directly -- so the assertion is on what the REAL
  // production wrapper forwards to Graph, not on the mock's own self-check
  // (presite-sandbox-deps.js is otherwise module-mocked for every other test
  // in this file; see presite-sandbox-deps.test.js for the isolated unit
  // proof of this same wrapper).
  test('every upload call carries conflictBehavior: fail, proven through the REAL sandbox uploadFile wrapper (not the mock)', async () => {
    const { resources } = seedMatchingRow();
    const { createPresiteSandboxDeps: realCreatePresiteSandboxDeps } = jest.requireActual(
      '../../lib/services/test-requests/presite-sandbox-deps.js',
    );
    const fakeGraph = { uploadFile: jest.fn((...args) => world.dependencies.uploadFile(...args)) };
    const realDeps = realCreatePresiteSandboxDeps({
      resourceUrl: 'https://orgd9e66399.crm.dynamics.com',
      loadInputs: async () => BASE_INPUTS,
      graph: fakeGraph,
    });
    createPresiteSandboxDeps.mockImplementationOnce(({ loadInputs }) => ({
      ...world.dependencies, loadInputs, uploadFile: realDeps.uploadFile,
    }));
    const { result } = await runStep('render_presite', { resources });
    expect(result.outcome).toBe('advanced');
    expect(fakeGraph.uploadFile).toHaveBeenCalledTimes(1);
    expect(fakeGraph.uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'fail' });
  });

  test('a conflict (409) refuses and never replaces: needs_attention, no updateDocument call after the throw', async () => {
    const { resources } = seedMatchingRow();
    world.flags.forceUploadConflict = true;
    world.dependencies.updateDocument.mockClear();
    const { result } = await runStep('render_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    // The new ownership pre-check (Codex round 2) passes cleanly here, so
    // this proves the 409 is actually reached, not masked by an earlier
    // refusal that would produce the same needs_attention outcome.
    expect(world.dependencies.uploadFile).toHaveBeenCalled();
    // artifact-service.js's own catch writes the FAILED patch through
    // updateDocument (markFailedIfOwned) -- that write is expected. What
    // must never happen is a SECOND successful upload/commit: the row stays
    // un-activated.
    const [row] = [...world.rows.values()];
    expect(row.wmkf_operationstatus).not.toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(world.rows.size).toBe(1);
  });

  // recoverUploadedFile/prepareFreshFilename (artifact-upload-recovery.js,
  // artifact-lineage.js) are the producer's own "crash between upload and
  // commit" resume path, keyed off the persisted filename/contentHash, not
  // the claim token -- so fail-on-conflict (above) never blocks a
  // legitimate resume there. CORRECTION (P2a, Opus round 1): an earlier
  // version of this comment called that path "provably unreachable from
  // render_presite" -- true only while a live lease is held. Since P2a,
  // stepRenderPresite's own pre-render fence (I4, run-runner.js) refuses
  // outright ONLY while the seeded row's lease is still LIVE (a genuine
  // concurrent other writer); an EXPIRED lease (this recipe's own crashed
  // prior attempt) now falls through to generatePreSiteVisitArtifact, which
  // reclaims via claimExisting and DOES reach recoverUploadedFile -- see
  // "item 3: ... P2a: a seeded row GENERATING under an EXPIRED lease ...
  // resumes and completes" above for that path's own coverage.
  // presite-sandbox-deps.test.js proves uploadFile's unconditional 'fail'
  // forcing directly.
});

describe('item 6: verify_presite attestation fail-closed', () => {
  function seedReadyRowAndRender() {
    // The row's own _wmkf_airun_value must equal a REAL, owned stub AI-run
    // journaled as a seed_presite_ai_run resource, now that verify_presite
    // re-asserts ownership (Codex adversarial round 1, I4) instead of only
    // checking the bind field is A guid -- seed a matching world.aiRuns
    // entry and return the resource so callers can thread it through.
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    // Codex adversarial round 2 (findings 1/2): render_presite/verify_presite
    // both now require a confirmed seed_presite_draft resource cross-checked
    // against the row's own id -- thread it alongside the ai-run resource at
    // every call site below.
    return { runId, resources: [resource, seedDraftResourceFor(row)] };
  }

  test('identical promoted bytes: verify_presite reaches markReady', async () => {
    const { resources } = seedReadyRowAndRender();
    const rendered = await runStep('render_presite', { resources });
    expect(rendered.result.outcome).toBe('advanced');
    const { result, calls } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('ready');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });

  // Flipping a byte this close to the end of the file lands in the ZIP
  // end-of-central-directory record, so this proves "refuses an unparseable
  // package" (packagePartsBudgeted/JSZip itself throws), not "refuses an
  // uncharacterized PART delta" -- the two valid-package tests below cover
  // that distinct claim with a package JSZip can actually open.
  test('a corrupted (unparseable) promoted package -> presite_promotion_uncharacterized', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const corrupted = Buffer.from(world.uploadedBytes);
    corrupted[corrupted.length - 10] ^= 0xff;
    world.flags.downloadOverrideBuffer = corrupted;
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_promotion_uncharacterized');
  });

  // A VALID, JSZip-openable promoted package whose only difference from the
  // fresh render is one customXml part shaped like a SharePoint item but
  // with a foreign root (mirrors docx-package-attestation.test.js's own
  // "rejects a foreign customXml item that is not a SharePoint root").
  test('a valid promoted package differing from the render in one customXml part -> presite_promotion_uncharacterized', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const zip = await JSZip.loadAsync(world.uploadedBytes);
    zip.file('customXml/item9.xml', '<payload xmlns="urn:foreign"/>');
    world.flags.downloadOverrideBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_promotion_uncharacterized');
  });

  // Live 2026-09-27 (sandbox Request 1000348): SharePoint re-promotes the v6
  // template's own customXml in place (item1 schema, item3 properties,
  // itemProps1), which the render-baseline attestation now accepts.
  test('SharePoint re-promotion of the template\'s own customXml in place -> ready', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const zip = await JSZip.loadAsync(world.uploadedBytes);
    for (const name of ['customXml/item1.xml', 'customXml/item3.xml', 'customXml/itemProps1.xml']) {
      expect(zip.file(name)).not.toBeNull();
    }
    zip.file('customXml/item1.xml', '<?xml version="1.0" encoding="utf-8"?><ct:contentTypeSchema ct:_="" ma:_="" ma:contentTypeName="Document" xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes"></ct:contentTypeSchema>');
    zip.file('customXml/item3.xml', '<?xml version="1.0" encoding="utf-8"?><p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement/></p:properties>');
    zip.file('customXml/itemProps1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{D1C8FE5D-9651-4E40-959E-1FD4F370C70B}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>');
    world.flags.downloadOverrideBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('ready');
  });

  test('a foreign rewrite of the template\'s own customXml item -> presite_promotion_uncharacterized, naming the part', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const zip = await JSZip.loadAsync(world.uploadedBytes);
    zip.file('customXml/item1.xml', '<payload xmlns="urn:foreign"/>');
    world.flags.downloadOverrideBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const { result } = await runStep('verify_presite', { resources });
    expect(result.run.needsAttentionReason).toBe('presite_promotion_uncharacterized');
    expect(result.errorMessage).toContain('customXml/item1.xml differs from the render and is not a SharePoint re-promotion of the same root');
  });

  test('the failure detail strips control characters from package-controlled part names and stays bounded', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const zip = await JSZip.loadAsync(world.uploadedBytes);
    zip.file('word/media/x\u001b[31mred\u0007.bin', Buffer.alloc(4));
    for (let i = 0; i < 40; i += 1) zip.file(`word/media/${'n'.repeat(300)}${i}.bin`, Buffer.alloc(1));
    world.flags.downloadOverrideBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const { result } = await runStep('verify_presite', { resources });
    expect(result.run.needsAttentionReason).toBe('presite_promotion_uncharacterized');
    expect(result.errorMessage).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(result.errorMessage.length).toBeLessThan(2300);
  });

  // A VALID, JSZip-openable promoted package carrying one extra part that
  // is not any characterized SharePoint addition at all.
  test('a valid promoted package carrying an extra unknown part -> presite_promotion_uncharacterized', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const zip = await JSZip.loadAsync(world.uploadedBytes);
    zip.file('word/media/hidden.bin', Buffer.alloc(4));
    world.flags.downloadOverrideBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_promotion_uncharacterized');
    // The CLI-facing message names the offending part (structure only).
    expect(result.errorMessage).toContain('Failures: unexpected part word/media/hidden.bin');
  });

  // Codex adversarial round 1 (I4 gap): verify_presite used to accept any
  // bound run whose bind field was merely a GUID -- these mutate the same
  // fake AI-run row seed_presite_ai_run would have produced, proving
  // verify_presite now rereads and reverifies full ownership too, not only
  // a shape check.
  test('I4: the journaled AI-run\'s request binding no longer matches -> verify_presite refuses (presite_verification_failed)', async () => {
    const { runId, resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    world.aiRuns.get(runId)._wmkf_ai_request_value = crypto.randomUUID();
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
  });

  // Advisor follow-up: a bare isGuid check on the prompt bind would pass a
  // stub run rebound to a DIFFERENT, independently-valid prompt GUID --
  // isOwnedStubAiRun now compares id/version against THIS run's own
  // validated promptIdentity.
  test('I4: the journaled AI-run is bound to a different, validly-shaped prompt guid -> verify_presite refuses (presite_verification_failed)', async () => {
    const { runId, resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    world.aiRuns.get(runId)._wmkf_ai_prompt_value = crypto.randomUUID();
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
  });

  test('I4: the journaled AI-run\'s prompt version no longer matches -> verify_presite refuses (presite_verification_failed)', async () => {
    const { runId, resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    world.aiRuns.get(runId).wmkf_ai_promptversion = 999;
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
  });

  // Distinct from the two above: this document row is bound to a run GUID
  // that is itself a perfectly valid, fully-owned stub AI-run -- just not
  // the ONE journaled as this run's own seed_presite_ai_run resource. A
  // bare isGuid check would have waved this through; the new equality
  // check (row._wmkf_airun_value === aiRunResource.readback.confirmedRunId)
  // must refuse it before ownership is even reread.
  test('I4: the document is bound to a different, independently-valid run GUID than the journaled one -> verify_presite refuses (presite_verification_failed)', async () => {
    const { resources } = seedReadyRowAndRender();
    await runStep('render_presite', { resources });
    const otherRunId = crypto.randomUUID();
    world.aiRuns.set(otherRunId, {
      wmkf_ai_runid: otherRunId, _wmkf_ai_request_value: REQUEST_ID, _wmkf_ai_prompt_value: PROMPT_ID, wmkf_ai_promptversion: 4,
      wmkf_ai_runsource: 682090002, wmkf_ai_status: 682090000, wmkf_ai_notes: `Test Request Factory run ${RUN_ID}`,
    });
    const [row] = [...world.rows.values()];
    row._wmkf_airun_value = otherRunId;
    const { result } = await runStep('verify_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
  });
});

describe('item 7: only verify_presite marks ready (behavioral)', () => {
  test('seed_presite_ai_run -> seed_presite_draft -> render_presite each advance; verify_presite is the only markReady', async () => {
    const seed1 = await runStep('seed_presite_ai_run');
    expect(seed1.result.outcome).toBe('advanced');
    expect(seed1.calls.filter((c) => c.op === 'markReady')).toHaveLength(0);

    const aiRunResource = seed1.resources.find((r) => r.step === 'seed_presite_ai_run');
    const seed2 = await runStep('seed_presite_draft', { resources: [aiRunResource] });
    expect(seed2.result.outcome).toBe('advanced');
    expect(seed2.calls.filter((c) => c.op === 'markReady')).toHaveLength(0);

    // Codex adversarial round 2 (findings 1/2): render_presite/verify_presite
    // both now require the confirmed seed_presite_draft resource too -- reuse
    // seed2's own full, live resource list (ai-run + draft) rather than
    // hand-rebuilding it.
    const render = await runStep('render_presite', { resources: seed2.resources });
    expect(render.result.outcome).toBe('advanced');
    expect(render.calls.filter((c) => c.op === 'markReady')).toHaveLength(0);

    const verify = await runStep('verify_presite', { resources: seed2.resources });
    expect(verify.result.outcome).toBe('ready');
    expect(verify.calls.filter((c) => c.op === 'markReady')).toHaveLength(1);
  });
});

describe('item 8: seed/render share the same loadInputs seam (snapshot determinism)', () => {
  test('createPresiteSandboxDeps echoes the loadInputs closure back unchanged at every call site (proven directly in presite-sandbox-deps.test.js); here, an unmutated world produces byte-identical snapshots at seed and render time', async () => {
    const { resource } = seedAiRunResource();
    await runStep('seed_presite_draft', { resources: [resource] });
    const [row] = [...world.rows.values()];
    const storedSnapshot = JSON.parse(row.wmkf_presiteinputsnapshotjson);
    const { result } = await runStep('render_presite', {
      resources: [resource, {
        resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: row.wmkf_generationkey },
        readback: { requestDocumentId: row.wmkf_requestdocumentid, claimTokenSha256: crypto.createHash('sha256').update(row.wmkf_claimtoken).digest('hex') },
        outcome: 'verified',
      }],
    });
    expect(result.outcome).toBe('advanced');
    const freshSnapshot = buildPreSiteVisitInputSnapshot(BASE_INPUTS);
    expect(storedSnapshot).toEqual(freshSnapshot);
  });
});

// Codex adversarial round 2: round 1 fixed seed_presite_draft/verify_presite,
// but left the SAME class of gap (I4) at three more boundaries --
// render_presite never reasserted ownership of the row OR its bound stub
// AI-run before calling the producer (findings 1/2); seed_presite_draft's
// own RESUME branches (both P2c-adopt and requestDocumentId-recovery) only
// checked a claim-token digest, never the row's other bound fields (finding
// 2); nothing ever rereads the uploaded FILE's identity before trusting it
// (finding 3). Three shared validators (isOwnedStubAiRun/
// assertOwnedPresiteDraft/assertOwnedPresiteFile, run-runner.js) now close
// all three, applied at every boundary that relies on a previously-seeded
// resource. This block proves each field independently at each boundary.
describe('item 9: draft/file ownership re-asserted at every boundary (Codex adversarial round 2)', () => {
  // assertOwnedPresiteDraft's own field list (the row's OWN bound fields,
  // never the ai-run's -- item 6's own I4 tests already cover the ai-run's
  // fields at render/verify; these are additionally exercised at every
  // boundary via assertOwnedStubAiRun, which assertOwnedPresiteDraft calls
  // last). One mutation per field, each asserted against the SPECIFIC
  // substring the failing check's own message carries, proving which check
  // fired -- not merely that something refused.
  const DRAFT_FIELD_MUTATIONS = [
    ['request bind', (row) => { row._wmkf_request_value = crypto.randomUUID(); }, 'not bound to the destination request'],
    ['artifact type', (row) => { row.wmkf_artifacttype = 999999999; }, 'artifact type or content type'],
    ['content type', (row) => { row.wmkf_contenttype = 'text/plain'; }, 'artifact type or content type'],
    ['prompt bind', (row) => { row._wmkf_aiprompt_value = crypto.randomUUID(); }, 'bound prompt does not equal'],
    ['prompt name', (row) => { row.wmkf_promptname = 'a different prompt name'; }, 'bound prompt does not equal'],
    ['prompt version', (row) => { row.wmkf_promptversion = 999; }, 'bound prompt does not equal'],
    ['template id', (row) => { row.wmkf_templateid = 'a-different-template'; }, 'template id/version'],
    ['template version', (row) => { row.wmkf_templateversion = '999'; }, 'template id/version'],
    ['run link', (row) => { row._wmkf_airun_value = crypto.randomUUID(); }, 'bound AI run does not equal the run journaled'],
  ];

  function seedFullyOwnedRow(overrides = {}) {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
      ...overrides,
    });
    return { runId, resource, row };
  }

  // isOwnedStubAiRun's own field list (assertOwnedStubAiRun, called last
  // inside assertOwnedPresiteDraft) -- mutates the fake AI-RUN row itself
  // (world.aiRuns), not the draft row, so these are independent of
  // DRAFT_FIELD_MUTATIONS above and of item 6's own I4 coverage (which only
  // exercises request/prompt-bind/prompt-version AT VERIFY -- render always
  // runs clean there, then the mutation is applied before verify_presite --
  // via a different fixture path, and never status/runsource/notes at all).
  const RUN_FIELD_MUTATIONS = [
    ['request bind', (aiRun) => { aiRun._wmkf_ai_request_value = crypto.randomUUID(); }],
    ['prompt bind', (aiRun) => { aiRun._wmkf_ai_prompt_value = crypto.randomUUID(); }],
    ['prompt version', (aiRun) => { aiRun.wmkf_ai_promptversion = 999; }],
    ['status', (aiRun) => { aiRun.wmkf_ai_status = 999999999; }],
    ['run source', (aiRun) => { aiRun.wmkf_ai_runsource = 999999999; }],
    ['notes', (aiRun) => { aiRun.wmkf_ai_notes = 'Test Request Factory run some-other-run'; }],
  ];

  describe('at render_presite (pre-call, before generatePreSiteVisitArtifact)', () => {
    test.each(DRAFT_FIELD_MUTATIONS)('%s -> refuses (presite_pointer_mismatch), never uploads or commits', async (_label, mutate, messageContains) => {
      const { resource, row } = seedFullyOwnedRow();
      mutate(row);
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain(messageContains);
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
      expect(world.dependencies.updateDocument).not.toHaveBeenCalled();
    });

    test.each(RUN_FIELD_MUTATIONS)('bound AI-run %s -> refuses (presite_pointer_mismatch) via assertOwnedStubAiRun, never uploads or commits', async (_label, mutate) => {
      const { runId, resource, row } = seedFullyOwnedRow();
      mutate(world.aiRuns.get(runId));
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('no longer the owned stub');
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
      expect(world.dependencies.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('at verify_presite', () => {
    test.each(DRAFT_FIELD_MUTATIONS)('%s -> refuses (presite_verification_failed)', async (_label, mutate, messageContains) => {
      const { resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      await runStep('render_presite', { resources });
      mutate(row);
      const { result } = await runStep('verify_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
      expect(result.errorMessage).toContain(messageContains);
      expect(world.dependencies.downloadFile).not.toHaveBeenCalled();
    });

    test.each(RUN_FIELD_MUTATIONS)('bound AI-run %s -> refuses (presite_verification_failed) via assertOwnedStubAiRun', async (_label, mutate) => {
      const { runId, resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      await runStep('render_presite', { resources });
      mutate(world.aiRuns.get(runId));
      const { result } = await runStep('verify_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
      expect(result.errorMessage).toContain('no longer the owned stub');
      expect(world.dependencies.downloadFile).not.toHaveBeenCalled();
    });

    // assertOwnedPresiteFile's own field list -- checked only once B has
    // already passed, immediately before downloadFile/attestation.
    const FILE_FIELD_MUTATIONS = [
      ['site id', (row) => { row.wmkf_sharepointsiteid = 'A-DIFFERENT-SITE'; }, 'SharePoint site/drive'],
      ['drive id', (row) => { row.wmkf_sharepointdriveid = 'A-DIFFERENT-DRIVE'; }, 'SharePoint site/drive'],
      ['folder path', (row) => { row.wmkf_sharepointfolderpath = 'a/different/folder'; }, 'folder path'],
      // The test fake's getFileMetadataByPath ignores its query args and
      // always returns the last real upload's metadata (it does not model a
      // genuine path-keyed lookup) -- a mutated filename is therefore caught
      // by the found.name !== row.wmkf_filename equality check, not a
      // not-found result; a real Graph read would 404 on the wrong path.
      ['filename', (row) => { row.wmkf_filename = 'a-different-filename.docx'; }, 'file name at the registered path does not equal'],
      ['item id', (row) => { row.wmkf_sharepointitemid = 'a-different-item-id'; }, 'not the item id registered'],
      ['version id', (row) => { row.wmkf_sharepointversionid = 'a-different-version'; }, 'version/eTag'],
    ];
    test.each(FILE_FIELD_MUTATIONS)('file %s -> refuses (presite_verification_failed)', async (_label, mutate, messageContains) => {
      const { resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      await runStep('render_presite', { resources });
      mutate(row);
      const { result } = await runStep('verify_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
      expect(result.errorMessage).toContain(messageContains);
      expect(world.dependencies.downloadFile).not.toHaveBeenCalled();
    });
  });

  describe('at seed_presite_draft resume branches', () => {
    test.each(DRAFT_FIELD_MUTATIONS)('P2c ambiguous-create adopt: %s -> refuses (presite_pointer_mismatch), never re-POSTs', async (_label, mutate, messageContains) => {
      const { runId, resource } = seedAiRunResource();
      const claimToken = crypto.randomUUID();
      const core = proposalCoreFixture();
      const fields = sectionFieldsFor(core);
      const row = world.seedRawRow({
        wmkf_generationkey: BASE_IDENTITY.generationKey,
        wmkf_claimtoken: claimToken,
        _wmkf_airun_value: runId,
        ...fields,
        wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
        wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
      });
      mutate(row);
      const draftResource = {
        resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: BASE_IDENTITY.generationKey },
        readback: {
          generationKey: BASE_IDENTITY.generationKey,
          claimTokenSha256: crypto.createHash('sha256').update(claimToken).digest('hex'),
          createAttemptedAt: new Date().toISOString(),
        },
        outcome: 'dispatched',
      };
      const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain(messageContains);
      expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    });

    test.each(DRAFT_FIELD_MUTATIONS)('requestDocumentId resume: %s -> refuses (presite_pointer_mismatch), never re-POSTs', async (_label, mutate, messageContains) => {
      const { resource } = seedAiRunResource();
      await runStep('seed_presite_draft', { resources: [resource] });
      const [row] = [...world.rows.values()];
      const draftResource = {
        resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: row.wmkf_generationkey },
        readback: { requestDocumentId: row.wmkf_requestdocumentid, claimTokenSha256: crypto.createHash('sha256').update(row.wmkf_claimtoken).digest('hex') },
        outcome: 'verified',
      };
      mutate(row);
      world.dependencies.createDocument.mockClear();
      const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain(messageContains);
      expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    });

    // At both resume branches, seed_presite_draft's own PRE-BRANCH check
    // (before any of the three branches -- the round-1 fix) rereads the
    // journaled AI-run first, so a mutated aiRun row refuses there with its
    // own code (presite_ai_run_ambiguous), before either branch's B call is
    // ever reached. Proven at both boundaries: the guard fires regardless of
    // which branch would otherwise have been taken.
    test.each(RUN_FIELD_MUTATIONS)('P2c ambiguous-create adopt: bound AI-run %s -> refuses at the pre-branch check (presite_ai_run_ambiguous), never re-POSTs', async (_label, mutate) => {
      const { runId, resource } = seedAiRunResource();
      const claimToken = crypto.randomUUID();
      const core = proposalCoreFixture();
      const fields = sectionFieldsFor(core);
      world.seedRawRow({
        wmkf_generationkey: BASE_IDENTITY.generationKey,
        wmkf_claimtoken: claimToken,
        _wmkf_airun_value: runId,
        ...fields,
        wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
        wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
      });
      mutate(world.aiRuns.get(runId));
      const draftResource = {
        resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: BASE_IDENTITY.generationKey },
        readback: {
          generationKey: BASE_IDENTITY.generationKey,
          claimTokenSha256: crypto.createHash('sha256').update(claimToken).digest('hex'),
          createAttemptedAt: new Date().toISOString(),
        },
        outcome: 'dispatched',
      };
      const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
      expect(result.errorMessage).toContain('is missing or no longer bound to the destination request');
      expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    });

    test.each(RUN_FIELD_MUTATIONS)('requestDocumentId resume: bound AI-run %s -> refuses at the pre-branch check (presite_ai_run_ambiguous), never re-POSTs', async (_label, mutate) => {
      const { runId, resource } = seedAiRunResource();
      await runStep('seed_presite_draft', { resources: [resource] });
      const [row] = [...world.rows.values()];
      const draftResource = {
        resourceId: 2, sequence: 2, step: 'seed_presite_draft', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: row.wmkf_generationkey },
        readback: { requestDocumentId: row.wmkf_requestdocumentid, claimTokenSha256: crypto.createHash('sha256').update(row.wmkf_claimtoken).digest('hex') },
        outcome: 'verified',
      };
      mutate(world.aiRuns.get(runId));
      world.dependencies.createDocument.mockClear();
      const { result } = await runStep('seed_presite_draft', { resources: [resource, draftResource] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_ai_run_ambiguous');
      expect(result.errorMessage).toContain('is missing or no longer bound to the destination request');
      expect(world.dependencies.createDocument).not.toHaveBeenCalled();
    });
  });

  // Codex adversarial round 3: the pre-render ownership check used to be
  // conditional on the first lookup finding a row, and the producer's own
  // generation-key lookup was unguarded. Both read-skew shapes must now fail
  // closed before any upload or commit.
  describe('render_presite read skew (Codex adversarial round 3)', () => {
    test('the pre-render lookup finds no row -> refuses (presite_pointer_mismatch) without calling the producer', async () => {
      const { resource, row } = seedFullyOwnedRow();
      world.dependencies.findByGenerationKey.mockImplementationOnce(async () => ({ records: [] }));
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('not found by its generation key');
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
      expect(world.dependencies.updateDocument).not.toHaveBeenCalled();
    });

    test("the producer's own lookup returns a different row than the owned one -> refuses (presite_pointer_mismatch), never uploads or commits", async () => {
      const { resource, row } = seedFullyOwnedRow();
      const realLookup = world.dependencies.findByGenerationKey.getMockImplementation();
      world.dependencies.findByGenerationKey
        .mockImplementationOnce(realLookup)
        .mockImplementationOnce(async (key) => ({
          records: [{ ...row, wmkf_requestdocumentid: crypto.randomUUID(), wmkf_generationkey: key }],
        }));
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('did not return exactly the journaled seeded draft');
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
      expect(world.dependencies.updateDocument).not.toHaveBeenCalled();
    });

    // Codex review of the round-3 closure: an id match is not ownership.
    // Same-id rereads inside the producer are re-validated in full, and the
    // upload/commit side effects are fenced independently of the row.
    test("a same-id producer reread whose request binding drifted -> refuses (presite_pointer_mismatch), never uploads or commits", async () => {
      const { resource, row } = seedFullyOwnedRow();
      const realLookup = world.dependencies.findByGenerationKey.getMockImplementation();
      world.dependencies.findByGenerationKey
        .mockImplementationOnce(realLookup)
        .mockImplementation(async (key) => {
          const found = await realLookup(key);
          return { records: found.records.map((r) => ({ ...r, _wmkf_request_value: crypto.randomUUID() })) };
        });
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('not bound to the destination request');
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
    });

    test('a same-id producer reread whose SharePoint folder drifted -> the destination fence refuses before any folder creation or upload', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const realLookup = world.dependencies.findByGenerationKey.getMockImplementation();
      world.dependencies.findByGenerationKey
        .mockImplementationOnce(realLookup)
        .mockImplementation(async (key) => {
          const found = await realLookup(key);
          return { records: found.records.map((r) => ({ ...r, wmkf_sharepointfolderpath: 'Some/Other/Request/Artifacts/Pre-Site Visit' })) };
        });
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      // The producer wraps the fence's error as a generic 500 (its message is
      // generic); the reason code is carried through body.code.
      expect(world.dependencies.ensureFolderPath).not.toHaveBeenCalled();
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
      expect(world.dependencies.commitChangeset).not.toHaveBeenCalled();
    });

    // The commit fence's refusal side is unreachable through the producer:
    // the per-read ownership check fixes the target row's request binding,
    // and the app's own lineage guards refuse before building a changeset
    // that supersedes another row ("no longer current" / "no current request
    // pointer"). It stays as a backstop; this test pins its allow side.
    test('the happy-path commit passes the commit fence and targets only the owned draft and the destination request', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const { result } = await runStep('render_presite', { resources: [resource, seedDraftResourceFor(row)] });
      expect(result.outcome).toBe('advanced');
      expect(world.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
      const [operations] = world.dependencies.commitChangeset.mock.calls[0];
      expect(operations.length).toBeGreaterThan(0);
      for (const operation of operations) {
        const target = String(operation.key).toLowerCase();
        expect([String(row.wmkf_requestdocumentid).toLowerCase(), String(REQUEST_ID).toLowerCase()]).toContain(target);
      }
    });
  });

  // Two checks are "by construction" at every current call site (the row is
  // always FOUND by generationKey, or matched by an exact-id .find()), so a
  // direct row mutation can never reach them there -- proven instead via a
  // one-off stale/misbehaving read, modeling the actual risk (a read that
  // returns a row whose OWN key doesn't match what was asked for).
  describe('generationKey/requestDocumentId cross-checks (not reachable by direct row mutation at existing call sites)', () => {
    test('render_presite: a findByGenerationKey read that returns a row with a DIFFERENT generation key -> refuses (presite_pointer_mismatch)', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      row.wmkf_generationkey = crypto.randomUUID();
      world.dependencies.findByGenerationKey.mockImplementationOnce(async () => ({ records: [{ ...row }] }));
      const { result } = await runStep('render_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('generation key does not equal');
      expect(world.dependencies.uploadFile).not.toHaveBeenCalled();
    });

    test('verify_presite: a findByGenerationKey read that returns a row with a DIFFERENT generation key -> refuses (presite_verification_failed)', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      await runStep('render_presite', { resources });
      const staleRow = { ...row, wmkf_generationkey: crypto.randomUUID() };
      world.dependencies.findByGenerationKey.mockImplementationOnce(async () => ({ records: [staleRow] }));
      const { result } = await runStep('verify_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
      expect(result.errorMessage).toContain('generation key does not equal');
    });

    // render_presite/verify_presite both cross-check the row's own id
    // against seed_presite_draft's INDEPENDENTLY journaled requestDocumentId
    // (the row is found by generation key/request pointer, NOT by that
    // marker) -- mutate the journaled marker itself, not the row.
    test('render_presite: the journaled seed_presite_draft requestDocumentId no longer matches the row found by generation key -> refuses (presite_pointer_mismatch)', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const draftResource = seedDraftResourceFor(row);
      draftResource.readback.requestDocumentId = crypto.randomUUID();
      const { result } = await runStep('render_presite', { resources: [resource, draftResource] });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_pointer_mismatch');
      expect(result.errorMessage).toContain('id does not equal the journaled seed_presite_draft requestDocumentId');
    });

    test('verify_presite: the journaled seed_presite_draft requestDocumentId no longer matches the row found by request pointer -> refuses (presite_verification_failed)', async () => {
      const { resource, row } = seedFullyOwnedRow();
      const resources = [resource, seedDraftResourceFor(row)];
      await runStep('render_presite', { resources });
      resources[1].readback.requestDocumentId = crypto.randomUUID();
      const { result } = await runStep('verify_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
      expect(result.errorMessage).toContain('id does not equal the journaled seed_presite_draft requestDocumentId');
    });
  });
});

describe('P3 (Opus round 1): render_presite maps specific producer codes to their OWN ledger reason instead of collapsing everything to presite_verification_failed', () => {
  function seedMatchingRowP3() {
    const { runId, resource } = seedAiRunResource();
    const core = proposalCoreFixture();
    const fields = sectionFieldsFor(core);
    const row = world.seedRawRow({
      _wmkf_airun_value: runId,
      ...fields,
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: core, diagnostics: [] }),
      wmkf_presiteinputsnapshotjson: JSON.stringify(buildPreSiteVisitInputSnapshot(BASE_INPUTS)),
    });
    return [resource, seedDraftResourceFor(row)];
  }

  const MAPPINGS = [
    ['claim_lost', 'presite_claim_lost'],
    ['pre_site_visit_snapshot_mismatch', 'presite_snapshot_stale'],
    ['pre_site_visit_upload_identity_incomplete', 'presite_upload_ambiguous'],
  ];

  for (const [producerCode, ledgerReason] of MAPPINGS) {
    test(`producer code "${producerCode}" -> ledger reason "${ledgerReason}"`, async () => {
      const resources = seedMatchingRowP3();
      generatePreSiteVisitArtifact.mockImplementationOnce(async () => {
        const error = new Error(`synthetic ${producerCode}`);
        error.code = producerCode;
        throw error;
      });
      const { result } = await runStep('render_presite', { resources });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe(ledgerReason);
    });
  }

  test('an unrecognized producer code still falls back to presite_verification_failed', async () => {
    const resources = seedMatchingRowP3();
    generatePreSiteVisitArtifact.mockImplementationOnce(async () => {
      const error = new Error('synthetic unmapped');
      error.code = 'some_other_producer_code';
      throw error;
    });
    const { result } = await runStep('render_presite', { resources });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('presite_verification_failed');
  });
});

describe('P3 (Opus round 1): every one of the four presite steps runs the same site/drive identity preflight before any write, mirroring every other writing step', () => {
  test.each(['seed_presite_ai_run', 'seed_presite_draft', 'render_presite', 'verify_presite'])(
    '%s refuses (preflight_identity_changed) when the resolved Graph site/drive has drifted from run.expectedGraphSiteId/expectedGraphDriveId',
    async (step) => {
      runPreflight.mockImplementationOnce(async () => ({ siteId: 'A-DIFFERENT-SITE', driveId: 'DRIVE-1' }));
      const { result } = await runStep(step);
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('preflight_identity_changed');
    },
  );
});
