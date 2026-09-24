/**
 * Test Request Factory slice 6b, Stage B, item D — the `seed_initial_assessment`
 * step body (lib/services/test-requests/run-runner.js `stepSeedInitialAssessment`).
 *
 * Runs the REAL sandbox Dataverse deps (createIaSandboxDeps, Stage A/B) and the
 * REAL commitReadyLineage/renderInitialAssessmentDocx/hashGovernedDocxContent
 * against a mocked global `fetch` (Dataverse) and a fake `graph` (SharePoint),
 * matching the style of tests/unit/ia-sandbox-deps.test.js's end-to-end test.
 *
 * Proves:
 *  1. Happy path: create -> render/hash -> ETag PATCH -> folder -> upload ->
 *     commitReadyLineage -> advance, never calling markReady.
 *  2. Dispatch-marker rule: an upload attempted with no journaled item stops
 *     the run with ia_upload_ambiguous rather than re-dispatching the PUT.
 *  3. Durability: the uploaded item's id is journaled the moment the PUT
 *     commits (onItemCreated), even if the overall uploadFile call later
 *     rejects (a post-PUT failure) -- proving a crash there still leaves a
 *     recoverable id, not an ambiguous one.
 *  4. Idempotent resume: a row already Ready at this generation key advances
 *     without re-running create/render/upload/commit.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { ledgerReasonOrThrow } from '../../lib/services/test-requests/run-ledger.js';
import { MANIFEST_V4 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { SANDBOX_HOSTS, PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import {
  buildInitialAssessmentIdentity,
} from '../../lib/services/initial-assessment/artifact-model.js';
import {
  SYNTHETIC_PROPOSAL_FILENAME,
  SYNTHETIC_PROPOSAL_TEXT,
} from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const SANDBOX_HOST = SANDBOX_HOSTS[0];
const PROD_HOST = PRODUCTION_HOSTS[0];
const SANDBOX_BASE_URL = `https://${SANDBOX_HOST}/api/data/v9.2`;

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
  // Deliberately a PRODUCTION host: proves the step's writes never fall back
  // to the environment (matches ia-sandbox-deps.test.js's convention).
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
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

const CRLF = '\r\n';

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
function errorResponse(status, body = {}) {
  return Promise.resolve({
    ok: false, status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}
function multipartResponse(ops) {
  const cs = 'changesetresponse_AAA';
  const batch = 'batchresponse_BBB';
  const parts = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${cs}`, ''];
  for (const op of ops) {
    parts.push(`--${cs}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${op.contentId}`, '');
    parts.push(`HTTP/1.1 ${op.status} ${op.reason || ''}`.trim(), 'OData-Version: 4.0', '');
  }
  parts.push(`--${cs}--`, `--${batch}--`, '');
  return {
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? `multipart/mixed; boundary=${batch}` : null) },
    text: () => Promise.resolve(parts.join(CRLF)),
  };
}

const DESTINATION_REQUEST = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '9009009',
  akoya_title: 'Synthetic Fixture Rehearsal',
  wmkf_meetingdate: '2026-06-15',
  '_akoya_applicantid_value_formatted': 'Synthetic University',
};

function fakeClient() {
  return { baseUrl: SANDBOX_BASE_URL, get: jest.fn(async () => ({ ok: true, status: 200, body: DESTINATION_REQUEST })) };
}

function fakeGraph(overrides = {}) {
  return {
    ensureFolderPath: jest.fn(async () => ({ id: 'folder-1' })),
    uploadFile: jest.fn(async (library, folder, filename, content, contentType, { onItemCreated } = {}) => {
      if (onItemCreated) await onItemCreated({ id: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', name: filename, size: content.length, eTag: '"1"' });
      return { siteId: 'site', driveId: 'drive', id: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', versionId: '1.0', eTag: '"1"' };
    }),
    ...overrides,
  };
}

/** Recording fake ledger matching run-ledger.js's shape (mirrors test-request-run-runner.test.js's). */
function createFakeLedger(initialRun) {
  const calls = [];
  let run = { ...initialRun };
  const resources = [];
  let nextSequence = 1;
  let nextResourceId = 1;
  function fenceOk(leaseToken, leaseGeneration, expectedVersion) {
    return run.leaseToken === leaseToken && run.leaseGeneration === leaseGeneration
      && (expectedVersion === undefined || run.version === expectedVersion) && run.lockedUntil !== null;
  }
  const ledger = {
    async getRun(runId) { return runId === run.runId ? { ...run } : null; },
    async claimLease({ expectedVersion, leaseSeconds }) {
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
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      const resource = { resourceId: nextResourceId++, runId, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
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
    currentStep: 'seed_initial_assessment', stepIndex: 7, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: 'bundle-hash', copyPolicyDigest: 'policy-digest',
    sourceRequestId: '55555555-5555-4555-8555-555555555555', sourceRevision: 'rev-1',
    destinationRequestId: REQUEST_ID, destinationLocationId: '66666666-6666-4666-8666-666666666666',
    destinationRequestNumber: '9009009',
    ...overrides,
  };
}
function baseManifest(overrides = {}) {
  return {
    kind: MANIFEST_V4, recipe: 'initial_assessment',
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: '66666666-6666-4666-8666-666666666666', meetingDate: '2026-06-15' },
    source: { requestId: '55555555-5555-4555-8555-555555555555', revision: 'rev-1', requestType: 100000000, bundleSha256: 'bundle-hash' },
    createBodySha256: 'body-hash', copyPolicy: { digest: 'policy-digest' },
    ...overrides,
  };
}

function identityFor() {
  return buildInitialAssessmentIdentity({
    requestId: REQUEST_ID,
    requestNumber: DESTINATION_REQUEST.akoya_requestnum,
    title: DESTINATION_REQUEST.akoya_title,
    institution: 'Synthetic University',
    cycleCode: 'J26', // DESTINATION_REQUEST.wmkf_meetingdate is 2026-06-15 (June -> J26)
    proposalFilename: SYNTHETIC_PROPOSAL_FILENAME,
    proposalText: SYNTHETIC_PROPOSAL_TEXT,
  });
}

async function run(deps) {
  const run0 = baseRun();
  const { ledger, calls, getResources } = createFakeLedger(run0);
  const manifest = baseManifest();
  const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle: null,
    deps: { client: fakeClient(), graph: fakeGraph(), sharePointTarget: () => ({}), ...deps },
  }));
  return { result, calls, getResources };
}

describe('stepSeedInitialAssessment — happy path', () => {
  it('creates, renders, patches, uploads and commits the Ready lineage, then advances (never markReady)', async () => {
    const { generationKey } = identityFor();
    const state = { row: null, request: { akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' } };

    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
        state.row = {
          wmkf_requestdocumentid: REQUEST_DOCUMENT_ID,
          wmkf_artifacttype: 100000000,
          wmkf_operationstatus: 100000000, // GENERATING
          wmkf_lifecyclestate: 100000000, // DRAFT
          wmkf_generationkey: generationKey,
          wmkf_claimtoken: JSON.parse(init.body).wmkf_claimtoken,
          wmkf_sharepointfolderpath: JSON.parse(init.body).wmkf_sharepointfolderpath,
          wmkf_filename: JSON.parse(init.body).wmkf_filename,
          _wmkf_request_value: REQUEST_ID,
          '@odata.etag': 'W/"row-1"',
          modifiedon: new Date().toISOString(),
        };
        return jsonResponse(state.row);
      }
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        state.row = { ...state.row, ...JSON.parse(init.body), '@odata.etag': 'W/"row-2"' };
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('/$batch')) {
        const opCount = (String(init.body).match(/Content-ID: \d+/g) || []).length;
        state.row = { ...state.row, wmkf_operationstatus: 100000001, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', '@odata.etag': 'W/"row-3"' };
        state.request = { ...state.request, _wmkf_currentinitialassessment_value: REQUEST_DOCUMENT_ID, '@odata.etag': 'W/"request-2"' };
        return Promise.resolve(multipartResponse(Array.from({ length: opCount }, (_, i) => ({ contentId: i + 1, status: 204 }))));
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: state.row ? [state.row] : [] });
      if (href.includes('akoya_requests(')) return jsonResponse(state.request);
      throw new Error(`unexpected fetch to ${href}`);
    });

    const { result, calls } = await run({});

    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('seed_initial_assessment_snapshot');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
    // Every Dataverse write landed on the sandbox host, never DYNAMICS_URL (a production host).
    for (const [u] of fetch.mock.calls) {
      const href = String(u);
      if (href.includes('login.microsoftonline.com')) continue;
      expect(new URL(href).hostname).toBe(SANDBOX_HOST);
    }
    const readbacks = calls.filter((c) => c.op === 'recordResourceReadback');
    const last = readbacks[readbacks.length - 1];
    expect(last.readback).toMatchObject({
      requestDocumentId: REQUEST_DOCUMENT_ID,
      generationKey,
    });
    expect(last.readback.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Attempt markers were journaled in order before each mutation -- each
    // merge() call resends the FULL current receipt (the copy_file
    // convention above), so the marker introduced by a given call is the
    // one newly present versus the previous call's readback.
    let seenKeys = new Set();
    const markerOrder = [];
    for (const r of readbacks) {
      const marker = Object.keys(r.readback).find((k) => k.endsWith('AttemptedAt') && !seenKeys.has(k));
      if (marker) markerOrder.push(marker);
      seenKeys = new Set(Object.keys(r.readback));
    }
    expect(markerOrder).toEqual(['registryCreateAttemptedAt', 'registryPatchAttemptedAt', 'graphFolderAttemptedAt', 'uploadAttemptedAt', 'changesetAttemptedAt']);
  });
});

describe('stepSeedInitialAssessment — dispatch-marker resume rule', () => {
  it('an upload attempted with no journaled item stops with ia_upload_ambiguous, never re-PUTs', async () => {
    const { generationKey } = identityFor();
    const run0 = baseRun();
    const { ledger, calls } = createFakeLedger(run0);
    // Pre-seed a resource row simulating a crash right after the PUT was
    // attempted but before onItemCreated's ledger write landed.
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: null, leaseGeneration: 0, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey },
    });
    // Claim a lease directly so recordResourceReadback's fence matches (mimics an active run).
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      readback: { generationKey, requestDocumentId: REQUEST_DOCUMENT_ID, uploadAttemptedAt: new Date().toISOString() },
      outcome: 'dispatched',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    fetch.mockImplementation((url) => {
      if (String(url).includes('login.microsoftonline.com')) return tokenResponse();
      throw new Error(`unexpected fetch to ${url} -- the step must stop before any further Dataverse call`);
    });
    const graph = fakeGraph();
    const manifest = baseManifest();
    const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: fakeClient(), graph, sharePointTarget: () => ({}) },
    }));

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });
});

describe('stepSeedInitialAssessment — upload durability', () => {
  it('journals the uploaded item id the moment the PUT commits, even when the overall upload call later rejects', async () => {
    const { generationKey } = identityFor();
    const state = { row: null };
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
        state.row = {
          wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000000, wmkf_lifecyclestate: 100000000,
          wmkf_generationkey: generationKey, wmkf_claimtoken: JSON.parse(init.body).wmkf_claimtoken,
          wmkf_sharepointfolderpath: JSON.parse(init.body).wmkf_sharepointfolderpath, wmkf_filename: JSON.parse(init.body).wmkf_filename,
          _wmkf_request_value: REQUEST_ID, '@odata.etag': 'W/"row-1"', modifiedon: new Date().toISOString(),
        };
        return jsonResponse(state.row);
      }
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        state.row = { ...state.row, ...JSON.parse(init.body), '@odata.etag': 'W/"row-2"' };
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: state.row ? [state.row] : [] });
      if (href.includes('akoya_requests(')) return jsonResponse({ akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' });
      throw new Error(`unexpected fetch to ${href}`);
    });

    let capturedResources;
    const graph = fakeGraph({
      uploadFile: jest.fn(async (library, folder, filename, content, contentType, { onItemCreated } = {}) => {
        await onItemCreated({ id: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', name: filename, size: content.length, eTag: '"1"' });
        throw new Error('simulated post-PUT metadata read failure');
      }),
    });
    const { result, getResources } = await run({ graph });
    capturedResources = getResources();

    expect(result.outcome).toBe('needs_attention');
    const iaResource = capturedResources.find((r) => r.resourceKind === 'dataverse_request_document');
    expect(iaResource.readback.itemId).toBe('01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    expect(iaResource.readback.uploadAttemptedAt).toBeTruthy();
  });
});

describe('stepSeedInitialAssessment — idempotent resume', () => {
  it('a Ready row at the generation key advances without re-running create/upload', async () => {
    const { generationKey } = identityFor();
    const readyRow = {
      wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_operationstatus: 100000001, wmkf_generationkey: generationKey,
      wmkf_contenthash: 'a'.repeat(64), '@odata.etag': 'W/"row-1"',
    };
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [readyRow] });
      throw new Error(`unexpected fetch to ${href}`);
    });
    const graph = fakeGraph();
    const { result } = await run({ graph });

    expect(result.outcome).toBe('advanced');
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });
});
