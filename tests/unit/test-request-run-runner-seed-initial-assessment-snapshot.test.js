/**
 * Test Request Factory slice 6b, Stage C, item B — the
 * `seed_initial_assessment_snapshot` step body
 * (lib/services/test-requests/run-runner.js `stepSeedInitialAssessmentSnapshot`).
 *
 * Runs the REAL `createInitialAssessmentBoardSnapshot`
 * (lib/services/initial-assessment/controls-service.js) and the REAL
 * `createIaSandboxDeps` against a mocked global `fetch` (Dataverse) and a
 * fake `graph` (SharePoint), matching the style of
 * tests/unit/test-request-run-runner-seed-initial-assessment.test.js.
 *
 * Proves:
 *  1. Happy path: the function's own create -> claim -> folder -> upload ->
 *     Ready-PATCH sequence runs unmodified, every mutating dependency is
 *     journaled, and the step advances (never markReady).
 *  2. Dispatch-marker rule: an upload attempted with no journaled item stops
 *     the run with ia_upload_ambiguous before the function is even called.
 *  3. Dispatch-marker rule: a registry create attempted with no readable row
 *     stops with ambiguous_create_outcome, issuing zero further POSTs.
 *  4. Idempotent resume: a Board snapshot already Ready at the same source
 *     identity advances without re-running create/upload.
 *  5. Sandbox target proof: every Dataverse write lands on the sandbox host
 *     even though DYNAMICS_URL is a production host and the interlock is on.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { assertLedgerReceipt, ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import { MANIFEST_V4 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { SANDBOX_HOSTS, PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { hashGovernedDocxContent, GOVERNED_DOCX_HASH_PREFIX } from '../../lib/services/documents/governed-docx-hash.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import { SYNTHETIC_GENERATED } from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SEED_DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_DOCUMENT_ID = '55555555-5555-4555-4555-555555555555';
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
  'REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY',
];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'test';
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  // Deliberately a PRODUCTION host: proves the step's writes never fall back to it.
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = APP_USER_ID;
  process.env.DYNAMICS_CLIENT_SECRET = 's';
  // Mutation check: without ia-sandbox-deps.js's sandboxCreateDocument
  // forcing actorPolicy=SANDBOX_REHEARSAL, controls-service.js's own
  // hardcoded actorPolicy=REQUIRED would reach resolveRequestDocumentActor's
  // REQUIRED branch and throw request_document_actor_unavailable (no
  // actingUserSystemId is ever passed here) -- but only once this readiness
  // flag is 'on'; with it unset (the repo default), schemaReady() short
  // circuits before the policy is even read, silently passing regardless of
  // which policy is used. This flag must be 'on' for the happy-path test
  // below to actually exercise that override.
  process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY = 'on';
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

function fakeClient() {
  return {
    baseUrl: SANDBOX_BASE_URL,
    get: jest.fn(async (requestPath) => {
      if (requestPath.includes('EntityDefinitions')) {
        if (requestPath.includes('ManyToOneRelationships')) return { ok: true, status: 200, body: { value: [{ ReferencedEntity: 'account' }] } };
        if (requestPath.includes('PicklistAttributeMetadata')) {
          return { ok: true, status: 200, body: { OptionSet: { Options: [{ Value: 100000000, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } } };
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
      if (requestPath.startsWith('/accounts')) return { ok: true, status: 200, body: { value: [{ accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0 }] } };
      if (requestPath.startsWith('/sharepointsites')) return { ok: true, status: 200, body: { value: [{ sharepointsiteid: 'site-x', absoluteurl: 'https://example.sharepoint.com/sites/akoyago' }] } };
      if (requestPath.startsWith('/sharepointdocumentlocations')) return { ok: true, status: 200, body: { value: [{ sharepointdocumentlocationid: 'parent-1', _parentsiteorlocation_value: 'site-x' }] } };
      if (requestPath.startsWith('/systemusers')) return { ok: true, status: 200, body: { value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] } };
      if (requestPath.startsWith('/contacts')) return { ok: true, status: 200, body: { value: [] } };
      throw new Error(`unexpected preflight/client path: ${requestPath}`);
    }),
  };
}

function fakeGraph(overrides = {}) {
  return {
    getSiteId: jest.fn(async () => EXPECTED_SITE_ID),
    getDriveId: jest.fn(async () => EXPECTED_DRIVE_ID),
    ensureFolderPath: jest.fn(async () => ({ id: 'folder-1' })),
    getFileMetadataByPath: jest.fn(async () => null),
    getFileMetadataById: jest.fn(async (driveId, itemId) => ({
      driveId, id: itemId, name: 'seed.docx', size: SEED_DOCX_BYTES().length, webUrl: 'https://contoso.sharepoint.com/seed',
      eTag: '"seed-1"', versionId: '1.0', lastModified: '2026-09-24T00:00:00Z',
    })),
    downloadFile: jest.fn(async () => ({ buffer: SEED_DOCX_BYTES() })),
    uploadFile: jest.fn(async (library, folder, filename, content, contentType, { onItemCreated } = {}) => {
      const item = {
        id: '01BCDEFGHIJKLMNOPQRSTUVWXYZ234567A', name: filename, size: content.length, eTag: '"snap-1"',
        siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID,
      };
      if (onItemCreated) await onItemCreated(item);
      return { ...item, versionId: '1.0' };
    }),
    ...overrides,
  };
}

let cachedSeedBytes = null;
function SEED_DOCX_BYTES() {
  return cachedSeedBytes;
}

/** Recording fake ledger matching run-ledger.js's shape. */
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
    async recordResourceFailure({ resourceId, outcome, error }) {
      calls.push({ op: 'recordResourceFailure', resourceId, outcome, error: error?.message ?? error });
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.outcome = outcome;
      resource.error = error?.message ?? String(error);
      return { ...resource };
    },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
  };
  return { ledger, calls, getResources: () => resources };
}

function baseRun(overrides = {}) {
  return {
    runId: RUN_ID, recipe: 'initial_assessment', status: 'creating',
    currentStep: 'seed_initial_assessment_snapshot', stepIndex: 8, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: 'bundle-hash', copyPolicyDigest: 'policy-digest',
    sourceRequestId: '99999999-9999-4999-8999-999999999999', sourceRevision: 'rev-1',
    destinationRequestId: REQUEST_ID, destinationLocationId: '66666666-6666-4666-8666-666666666666',
    destinationRequestNumber: '9009009',
    expectedOrganizationId: ORG_ID, expectedAppUserId: APP_USER_ID,
    expectedGraphSiteId: EXPECTED_SITE_ID, expectedGraphDriveId: EXPECTED_DRIVE_ID,
    ...overrides,
  };
}
function baseManifest(overrides = {}) {
  return {
    kind: MANIFEST_V4, recipe: 'initial_assessment',
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: '66666666-6666-4666-8666-666666666666', meetingDate: '2026-06-15' },
    source: { requestId: '99999999-9999-4999-8999-999999999999', revision: 'rev-1', requestType: 100000000, bundleSha256: 'bundle-hash' },
    createBodySha256: 'body-hash', copyPolicy: { digest: 'policy-digest' },
    ...overrides,
  };
}

function seedResourceRow(overrides = {}) {
  return {
    resourceId: 1, sequence: 1, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
    plannedIdentity: { generationKey: 'a'.repeat(64), folder: 'Artifacts/Initial Assessment' },
    readback: {
      requestDocumentId: SEED_DOCUMENT_ID, generationKey: 'a'.repeat(64), sourceVersionId: '1.0', contentHash: 'b'.repeat(64),
    },
    outcome: 'advanced',
    ...overrides,
  };
}

async function runStep({ deps = {}, resources = [seedResourceRow()], run: runOverrides = {} } = {}) {
  const run0 = baseRun(runOverrides);
  const { ledger, calls, getResources } = createFakeLedger(run0, resources);
  const manifest = baseManifest();
  const result = await bypassDynamicsRestrictions('test:seed-initial-assessment-snapshot', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle: null,
    deps: { client: fakeClient(), graph: fakeGraph(), sharePointTarget: SHARE_POINT_TARGET, ...deps },
  }));
  return { result, calls, getResources };
}

const REQUEST_FOLDER = `9009009_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`;
const IA_FOLDER = `${REQUEST_FOLDER}/Artifacts/Initial Assessment`;

function seedRow(governedHash) {
  return {
    wmkf_requestdocumentid: SEED_DOCUMENT_ID,
    wmkf_artifacttype: 100000000,
    wmkf_operationstatus: 100000001, // READY
    wmkf_lifecyclestate: 100000002, // READY (non-superseded)
    wmkf_producer: 'request-workbench',
    _wmkf_request_value: REQUEST_ID,
    wmkf_generationkey: 'a'.repeat(64),
    wmkf_cyclecode: 'J26',
    wmkf_sharepointfolderpath: IA_FOLDER,
    wmkf_filename: '9009009 Initial Assessment aaaaaaaa-bbbbbbbb.docx',
    wmkf_sharepointdriveid: EXPECTED_DRIVE_ID,
    wmkf_sharepointitemid: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    wmkf_sharepointsiteid: EXPECTED_SITE_ID,
    wmkf_sharepointversionid: '1.0',
    wmkf_contenthash: governedHash,
    '@odata.etag': 'W/"seed-1"',
  };
}

function requestRow() {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '9009009',
    _wmkf_currentinitialassessment_value: SEED_DOCUMENT_ID,
    '@odata.etag': 'W/"request-1"',
  };
}

describe('stepSeedInitialAssessmentSnapshot', () => {
  let governedHash;

  beforeAll(async () => {
    cachedSeedBytes = await renderInitialAssessmentDocx({
      requestNumber: '9009009', title: 'Synthetic Fixture Rehearsal', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED,
    });
    governedHash = await hashGovernedDocxContent(cachedSeedBytes);
  });

  function mockDataverse(state) {
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.startsWith(`https://${SANDBOX_HOST}/api/data/v9.2/akoya_requests(${REQUEST_ID})`)) {
        return jsonResponse(state.request);
      }
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
        const body = JSON.parse(init.body);
        state.snapshot = {
          wmkf_requestdocumentid: SNAPSHOT_DOCUMENT_ID,
          wmkf_artifacttype: body.wmkf_artifacttype,
          wmkf_operationstatus: 100000000, // GENERATING
          wmkf_lifecyclestate: body.wmkf_lifecyclestate,
          wmkf_producer: body.wmkf_producer,
          wmkf_generationkey: body.wmkf_generationkey,
          wmkf_claimtoken: body.wmkf_claimtoken,
          wmkf_cyclecode: body.wmkf_cyclecode,
          wmkf_inputfingerprint: body.wmkf_inputfingerprint,
          wmkf_sourceversionid: body.wmkf_sourceversionid,
          wmkf_sourcecontenthash: body.wmkf_sourcecontenthash,
          _wmkf_sourcedocument_value: SEED_DOCUMENT_ID,
          _wmkf_request_value: REQUEST_ID,
          wmkf_sharepointfolderpath: body.wmkf_sharepointfolderpath,
          wmkf_filename: body.wmkf_filename,
          '@odata.etag': 'W/"snap-1"',
          createdon: new Date().toISOString(),
          modifiedon: new Date().toISOString(),
        };
        return jsonResponse(state.snapshot, 204);
      }
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        const body = JSON.parse(init.body);
        state.snapshot = { ...state.snapshot, ...body, '@odata.etag': `W/"snap-${Math.random()}"` };
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('wmkf_requestdocuments') && href.includes('%24filter=wmkf_generationkey')) {
        const rows = [state.seed, state.snapshot].filter((row) => row && href.includes(encodeURIComponent(row.wmkf_generationkey)));
        return jsonResponse({ value: rows });
      }
      if (href.includes('wmkf_requestdocuments')) {
        const rows = [state.seed, state.snapshot].filter(Boolean);
        return jsonResponse({ value: rows });
      }
      throw new Error(`unexpected fetch to ${href} (${init?.method || 'GET'})`);
    });
  }

  it('creates, folders, uploads and publishes the Board snapshot, then advances (never markReady)', async () => {
    const state = { seed: seedRow(governedHash), snapshot: null, request: requestRow() };
    mockDataverse(state);
    const graph = fakeGraph();
    const { result, calls } = await runStep({ deps: { graph } });
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('verify_initial_assessment');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
    for (const [u] of fetch.mock.calls) {
      const href = String(u);
      if (href.includes('login.microsoftonline.com')) continue;
      expect(new URL(href).hostname).toBe(SANDBOX_HOST);
    }
    expect(graph.ensureFolderPath).toHaveBeenCalledWith('akoya_request', expect.stringContaining('Board Milestones'), { siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID });
    expect(graph.uploadFile).toHaveBeenCalledWith(
      'akoya_request', expect.any(String), expect.any(String), expect.any(Buffer), expect.any(String),
      expect.objectContaining({ siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID, onItemCreated: expect.any(Function) }),
    );
    const readbacks = calls.filter((c) => c.op === 'recordResourceReadback');
    const last = readbacks[readbacks.length - 1];
    expect(last.readback).toMatchObject({ requestDocumentId: SNAPSHOT_DOCUMENT_ID });
    expect(last.readback.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an upload attempted with no journaled item stops with ia_upload_ambiguous before the function is ever called', async () => {
    const resources = [
      seedResourceRow(),
      {
        resourceId: 2, sequence: 2, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: 'c'.repeat(64), folder: 'Board Milestones' },
        readback: { generationKey: 'c'.repeat(64), requestDocumentId: SNAPSHOT_DOCUMENT_ID, uploadAttemptedAt: new Date().toISOString() },
        outcome: 'dispatched',
      },
    ];
    fetch.mockImplementation((url) => {
      if (String(url).includes('login.microsoftonline.com')) return tokenResponse();
      throw new Error(`unexpected fetch to ${url} -- the step must stop before any Dataverse call`);
    });
    const graph = fakeGraph();
    const { result } = await runStep({ deps: { graph }, resources });

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
  });

  it('a registry create attempted with no readable row stops with ambiguous_create_outcome and issues zero further POSTs', async () => {
    const resources = [
      seedResourceRow(),
      {
        resourceId: 2, sequence: 2, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: 'c'.repeat(64), folder: 'Board Milestones' },
        readback: { generationKey: 'c'.repeat(64), registryCreateAttemptedAt: new Date().toISOString() },
        outcome: 'dispatched',
      },
    ];
    let postCount = 0;
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST') { postCount += 1; return jsonResponse({}); }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [] });
      throw new Error(`unexpected fetch to ${href}`);
    });
    const { result } = await runStep({ resources });

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
    expect(postCount).toBe(0);
  });

  it('a Board snapshot already Ready at the source identity advances without re-running create/upload', async () => {
    const identityRow = seedRow(governedHash);
    const state = { seed: identityRow, request: requestRow() };
    // Compute the real generation key the function will derive, by running
    // the happy path once to discover it, then feeding a pre-existing Ready
    // snapshot keyed to that same identity.
    mockDataverse(state);
    const graph = fakeGraph();
    const first = await runStep({ deps: { graph }, resources: [seedResourceRow()] });
    expect(first.result.outcome).toBe('advanced');
    const readyGenerationKey = state.snapshot.wmkf_generationkey;
    state.snapshot = { ...state.snapshot, wmkf_operationstatus: 100000001 }; // READY

    fetch.mockClear();
    const graph2 = fakeGraph();
    const { result } = await runStep({
      deps: { graph: graph2 },
      resources: [seedResourceRow(), {
        resourceId: 2, sequence: 2, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey: readyGenerationKey, folder: 'Board Milestones' }, readback: null, outcome: 'planned',
      }],
    });

    expect(result.outcome).toBe('advanced');
    expect(graph2.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph2.uploadFile).not.toHaveBeenCalled();
  });

  it('a pre-existing (staff-made) GENERATING snapshot row at the same source identity, with no prior ledger resource for this step, is claimed and journaled rather than crashing on a null resource (Stage C round 2, P3-1)', async () => {
    // Discover the real generation key the same way the "already Ready" test
    // above does, then feed a STALE (>15 minute-old) GENERATING row at that
    // key -- as if a staff member (or the app's own admin snapshot flow)
    // started, but never finished, a Board snapshot of this exact source
    // version, entirely outside this run. No ledger resource for this step
    // exists yet, so the first call this run makes against the sandbox deps
    // is `claimSnapshot`'s own updateDocument PATCH (wrappedUpdateDocument),
    // never `wrappedCreateDocument` -- before the P3-1 fix, `merge()` there
    // threw on a null `resource.resourceId`.
    const identityRow = seedRow(governedHash);
    const discoverState = { seed: identityRow, request: requestRow() };
    mockDataverse(discoverState);
    const discover = await runStep({ deps: { graph: fakeGraph() }, resources: [seedResourceRow()] });
    expect(discover.result.outcome).toBe('advanced');
    const generationKey = discoverState.snapshot.wmkf_generationkey;

    const staleClaimToken = 'staff-claim-11111111';
    const state = {
      seed: identityRow,
      snapshot: {
        ...discoverState.snapshot,
        wmkf_operationstatus: 100000000, // force back to GENERATING (the discover run left it READY)
        wmkf_claimtoken: staleClaimToken,
        modifiedon: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // stale: claim lease (15 min) has expired
      },
      request: requestRow(),
    };
    fetch.mockClear();
    mockDataverse(state);
    const graph = fakeGraph();
    const { result, getResources } = await runStep({ deps: { graph }, resources: [seedResourceRow()] });

    // Never an unhandled/generic crash: either it adopts the stale claim and
    // advances, or it stops with a properly coded reason -- never `unknown_error`.
    expect(['advanced', 'needs_attention']).toContain(result.outcome);
    if (result.outcome === 'needs_attention') {
      expect(result.run.needsAttentionReason).not.toBe('unknown_error');
    }
    const snapshotResource = getResources().find((r) => r.step === 'seed_initial_assessment_snapshot');
    expect(snapshotResource).toBeTruthy();
    expect(snapshotResource.readback).toMatchObject({ generationKey });
  });

  it('missing seed step journal (no requestDocumentId/sourceVersionId) stops with ia_pointer_mismatch before any Dataverse call', async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes('login.microsoftonline.com')) return tokenResponse();
      throw new Error(`unexpected fetch to ${url}`);
    });
    const { result } = await runStep({ resources: [] });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
  });

  describe('wrappedCreateDocument lost-response recovery (Stage C round 2, P2 V4)', () => {
    it('a create POST that throws, with NO row ever committed, stops with ambiguous_create_outcome after exactly one POST', async () => {
      const state = { seed: seedRow(governedHash), snapshot: null, request: requestRow() };
      let postCount = 0;
      fetch.mockImplementation((url, init) => {
        const href = String(url);
        if (href.includes('login.microsoftonline.com')) return tokenResponse();
        if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
          postCount += 1;
          // The write never committed server-side: no readable row exists at any generation key.
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Something unexpected happened'), json: () => Promise.resolve({}) });
        }
        if (href.includes('wmkf_requestdocuments') && href.includes('%24filter=wmkf_generationkey')) {
          return jsonResponse({ value: [] });
        }
        if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [state.seed].filter(Boolean) });
        if (href.startsWith(`https://${SANDBOX_HOST}/api/data/v9.2/akoya_requests(${REQUEST_ID})`)) return jsonResponse(state.request);
        throw new Error(`unexpected fetch to ${href} (${init?.method || 'GET'})`);
      });
      const graph = fakeGraph();
      const { result } = await runStep({ deps: { graph } });

      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
      expect(postCount).toBe(1);
      expect(graph.ensureFolderPath).not.toHaveBeenCalled();
      expect(graph.uploadFile).not.toHaveBeenCalled();
    });

    it('a create POST that throws, but the row actually committed (reread finds it), is adopted and never re-POSTed', async () => {
      const state = { seed: seedRow(governedHash), snapshot: null, request: requestRow() };
      let postCount = 0;
      mockDataverse(state);
      // Wrap the base mockDataverse fetch mock so the FIRST POST response is
      // replaced with a lost-response-shaped error (not 409/412, no
      // duplicate-shaped message) while state.snapshot is still committed by
      // the underlying implementation, exactly as a real lost HTTP response
      // would look: the write committed server-side but the client saw a
      // generic failure.
      const baseImpl = fetch.getMockImplementation();
      fetch.mockImplementation(async (url, init) => {
        const href = String(url);
        if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
          postCount += 1;
          await baseImpl(url, init); // let the real handler commit state.snapshot
          return { ok: false, status: 500, text: () => Promise.resolve('Something unexpected happened'), json: () => Promise.resolve({}) };
        }
        return baseImpl(url, init);
      });
      const graph = fakeGraph();
      const { result } = await runStep({ deps: { graph } });

      expect(result.outcome).toBe('advanced');
      expect(postCount).toBe(1);
    });
  });

  it('resuming with a journaled item id stops with ia_upload_ambiguous if the function\'s own path-based recovery resolves to a DIFFERENT item (Stage C round 2, P3-2)', async () => {
    // Discover the real generation key first (same pattern as the other
    // resume tests above).
    const identityRow = seedRow(governedHash);
    const discoverState = { seed: identityRow, request: requestRow() };
    mockDataverse(discoverState);
    const discover = await runStep({ deps: { graph: fakeGraph() }, resources: [seedResourceRow()] });
    expect(discover.result.outcome).toBe('advanced');
    const generationKey = discoverState.snapshot.wmkf_generationkey;
    const claimToken = discoverState.snapshot.wmkf_claimtoken;
    const journaledItemId = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const wrongItemId = '01WRONGITEMSAMPLEIDXXXXXXXXXXXXXX';

    // Resume state: the row is still GENERATING (crashed before the Ready
    // PATCH), and THIS run already journaled itemId=journaledItemId from a
    // prior invocation's onItemCreated callback.
    const state = {
      seed: identityRow,
      snapshot: { ...discoverState.snapshot, wmkf_operationstatus: 100000000, wmkf_claimtoken: claimToken, modifiedon: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
      request: requestRow(),
    };
    fetch.mockClear();
    mockDataverse(state);
    // getFileMetadataByPath resolves to a DIFFERENT item than the one this
    // run journaled -- simulating the path now pointing somewhere else.
    const graph = fakeGraph({
      getFileMetadataByPath: jest.fn(async () => ({ id: wrongItemId, name: 'unexpected.docx' })),
    });
    const { result, getResources } = await runStep({
      deps: { graph },
      resources: [seedResourceRow(), {
        resourceId: 2, sequence: 2, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey, folder: 'Artifacts/Initial Assessment/Board Milestones' },
        readback: { generationKey, uploadAttemptedAt: new Date().toISOString(), itemId: journaledItemId, driveId: EXPECTED_DRIVE_ID, siteId: EXPECTED_SITE_ID },
        outcome: 'dispatched',
      }],
    });

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    const snapshotResource = getResources().find((r) => r.step === 'seed_initial_assessment_snapshot');
    expect(snapshotResource.readback.itemId).toBe(journaledItemId); // never overwritten by the wrong id
  });

  it('resuming with a journaled item id stops with ia_upload_ambiguous if the path read returns NOTHING, never re-uploading (Codex adversarial round 1, F2)', async () => {
    const identityRow = seedRow(governedHash);
    const discoverState = { seed: identityRow, request: requestRow() };
    mockDataverse(discoverState);
    const discover = await runStep({ deps: { graph: fakeGraph() }, resources: [seedResourceRow()] });
    expect(discover.result.outcome).toBe('advanced');
    const generationKey = discoverState.snapshot.wmkf_generationkey;
    const claimToken = discoverState.snapshot.wmkf_claimtoken;
    const journaledItemId = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const state = {
      seed: identityRow,
      snapshot: { ...discoverState.snapshot, wmkf_operationstatus: 100000000, wmkf_claimtoken: claimToken, modifiedon: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
      request: requestRow(),
    };
    fetch.mockClear();
    mockDataverse(state);
    // The path no longer resolves (moved, renamed, deleted, or an
    // inconsistent read). The unmodified production function would treat
    // null as "not uploaded yet" and PUT a second file.
    const graph = fakeGraph({ getFileMetadataByPath: jest.fn(async () => null) });
    const { result, getResources } = await runStep({
      deps: { graph },
      resources: [seedResourceRow(), {
        resourceId: 2, sequence: 2, step: 'seed_initial_assessment_snapshot', resourceKind: 'dataverse_request_document', system: 'dataverse',
        plannedIdentity: { generationKey, folder: 'Artifacts/Initial Assessment/Board Milestones' },
        readback: { generationKey, uploadAttemptedAt: new Date().toISOString(), itemId: journaledItemId, driveId: EXPECTED_DRIVE_ID, siteId: EXPECTED_SITE_ID },
        outcome: 'dispatched',
      }],
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(result.errorMessage).toMatch(/no longer resolves to the previously journaled item/);
    expect(graph.uploadFile).not.toHaveBeenCalled();
    const snapshotResource = getResources().find((r) => r.step === 'seed_initial_assessment_snapshot');
    expect(snapshotResource.readback.itemId).toBe(journaledItemId);
  });
});
