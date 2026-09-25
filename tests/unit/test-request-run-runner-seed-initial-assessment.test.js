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
import nodeCrypto from 'node:crypto';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { ledgerReasonOrThrow, assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';
import { MANIFEST_V4 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { SANDBOX_HOSTS, PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import {
  buildInitialAssessmentIdentity,
} from '../../lib/services/initial-assessment/artifact-model.js';
import {
  SYNTHETIC_GENERATED,
  SYNTHETIC_PROPOSAL_FILENAME,
  SYNTHETIC_PROPOSAL_TEXT,
} from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';
import { hashGovernedDocxContent, GOVERNED_DOCX_HASH_PREFIX } from '../../lib/services/documents/governed-docx-hash.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';

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
  // Also the app-suite application id runPreflight's getAppUser reads
  // (must be GUID-shaped): must match APP_USER_ID's systemuserid below only
  // in shape, not value -- the fake client ignores the actual filter.
  process.env.DYNAMICS_CLIENT_ID = '88888888-8888-4888-8888-888888888888';
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

// A real Dataverse response carries the RAW annotation key, not the
// already-processed `_akoya_applicantid_value_formatted` shape -- the step
// must call processAnnotations itself (getIaSeedRequest). Using the raw key
// here is what would have caught the institution-always-empty bug (P1-A):
// with only the processed key, every test still passed even though the real
// step body never invoked processAnnotations.
const DESTINATION_REQUEST = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '9009009',
  akoya_title: 'Synthetic Fixture Rehearsal',
  wmkf_meetingdate: '2026-06-15',
  '_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue': 'Synthetic University',
};

const ORG_ID = '77777777-7777-4777-8777-777777777777';
const APP_USER_ID = '88888888-8888-4888-8888-888888888888';
// Real Graph identifier shapes (ledger KEY_RULES: GRAPH_SITE_ID/GRAPH_DRIVE_ID
// in run-ledger.js) -- a bare "site-1"/"drive-1" fails ledger receipt
// validation once these flow into a journaled readback (P1-B).
const EXPECTED_SITE_ID = 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';
const EXPECTED_DRIVE_ID = 'b!driveIdSample1234567890';
const SHARE_POINT_TARGET = () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' });

/**
 * `stepSeedInitialAssessment` now calls runPreflight (P1-B: bind the step's
 * Graph writes to the run's own verified site/drive, matching every Basic
 * step). This `client` answers both the preflight's org-level reads
 * (mirrors tests/unit/test-request-run-runner.test.js's own
 * `preflightClient()` fixture) and the step's own `/akoya_requests(id)` read.
 */
function fakeClient() {
  return {
    baseUrl: SANDBOX_BASE_URL,
    get: jest.fn(async (requestPath) => {
      if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: DESTINATION_REQUEST };
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
    uploadFile: jest.fn(async (library, folder, filename, content, contentType, { onItemCreated } = {}) => {
      if (onItemCreated) {
        await onItemCreated({
          id: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', name: filename, size: content.length, eTag: '"1"',
          siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID,
        });
      }
      return { siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID, id: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', versionId: '1.0', eTag: '"1"' };
    }),
    ...overrides,
  };
}

/** Recording fake ledger matching run-ledger.js's shape (mirrors test-request-run-runner.test.js's). */
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
      // Real validator (run-ledger.js): every plannedIdentity key/value must
      // satisfy its allowlisted grammar, exactly as Postgres would reject it.
      assertLedgerReceipt(plannedIdentity ?? {}, 'plannedIdentity');
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      const resource = { resourceId: nextResourceId++, runId, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
      // Real validator: catches a receipt shape that doesn't match its
      // allowlisted grammar (e.g. the gdc1:-prefixed governed hash vs the
      // ledger's HEX64 contentHash) instead of silently accepting it.
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
    currentStep: 'seed_initial_assessment', stepIndex: 7, version: 1,
    leaseToken: null, leaseGeneration: 0, lockedUntil: null,
    createBodySha256: 'body-hash', bundleSha256: 'bundle-hash', copyPolicyDigest: 'policy-digest',
    sourceRequestId: '55555555-5555-4555-8555-555555555555', sourceRevision: 'rev-1',
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

async function run(deps, initialResources = []) {
  const run0 = baseRun();
  const { ledger, calls, getResources } = createFakeLedger(run0, initialResources);
  const manifest = baseManifest();
  const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
    runId: RUN_ID, ledger, manifest, bundle: null,
    deps: { client: fakeClient(), graph: fakeGraph(), sharePointTarget: SHARE_POINT_TARGET, ...deps },
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

    const fakeGraphInstance = fakeGraph();
    const { result, calls } = await run({ graph: fakeGraphInstance });

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
    // P2-E: the journaled ledger contentHash ties to BOTH the exact buffer
    // uploadFile received AND the wmkf_contenthash value the PATCH sent --
    // all three are the same governed digest, just encoded two ways.
    const uploadedBuffer = fakeGraphInstance.uploadFile.mock.calls[0][3];
    const rehashedFromUpload = await hashGovernedDocxContent(uploadedBuffer);
    const patchCall = fetch.mock.calls.find(([u, i]) => i?.method === 'PATCH' && String(u).includes('wmkf_requestdocuments('));
    const patchedContentHash = JSON.parse(patchCall[1].body).wmkf_contenthash;
    expect(patchedContentHash).toBe(rehashedFromUpload);
    expect(last.readback.contentHash).toBe(
      Buffer.from(rehashedFromUpload.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex'),
    );
    // F6 (owner decision 2026-09-24): the raw SHA-256 of the exact uploaded
    // bytes is journaled in the SAME merge as uploadAttemptedAt, i.e. before
    // the PUT was dispatched, and equals the buffer uploadFile received.
    const uploadMarker = readbacks.find((r) => r.readback.uploadAttemptedAt);
    expect(uploadMarker.readback.bytesSha256).toBe(nodeCrypto.createHash('sha256').update(uploadedBuffer).digest('hex'));
    expect(last.readback.bytesSha256).toBe(uploadMarker.readback.bytesSha256);
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

describe('governed content hash stability across independent renders (P2-E)', () => {
  it('the same generated content renders to a stable governed hash even though the docx Packer stamps a fresh docProps timestamp each time', async () => {
    const args = { requestNumber: '9009009', title: 'Synthetic Fixture Rehearsal', institution: 'Synthetic University', generated: SYNTHETIC_GENERATED };
    const first = await renderInitialAssessmentDocx(args);
    // A real millisecond apart, so a raw whole-file hash covering docProps'
    // stamped created/modified timestamps would very likely differ.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await renderInitialAssessmentDocx(args);

    const firstGoverned = await hashGovernedDocxContent(first);
    const secondGoverned = await hashGovernedDocxContent(second);
    expect(firstGoverned).toBe(secondGoverned);

    const toHex = (governed) => Buffer.from(governed.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex');
    expect(toHex(firstGoverned)).toBe(toHex(secondGoverned));
    expect(toHex(firstGoverned)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('stepSeedInitialAssessment — registry create dispatch-marker rule', () => {
  it('a create marker with no readable row stops with ambiguous_create_outcome and issues zero POSTs', async () => {
    const { generationKey } = identityFor();
    const run0 = baseRun();
    const { ledger } = createFakeLedger(run0);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: null, leaseGeneration: 0, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey },
    });
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      readback: { generationKey, filename: '9009009 Initial Assessment aaaaaaaa-bbbbbbbb.docx', claimTokenSha256: 'a'.repeat(64), registryCreateAttemptedAt: new Date().toISOString() },
      outcome: 'dispatched',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    let postCount = 0;
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) { postCount += 1; return jsonResponse({}); }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [] }); // no row exists
      throw new Error(`unexpected fetch to ${href}`);
    });
    const graph = fakeGraph();
    const manifest = baseManifest();
    const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: fakeClient(), graph, sharePointTarget: SHARE_POINT_TARGET },
    }));

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
    expect(postCount).toBe(0);
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });

  it('a create response that is lost (an unrelated-looking error) recovers ONLY by finding the row on reread, and never re-POSTs', async () => {
    const { generationKey } = identityFor();
    const state = { row: null, request: { akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' } };
    let postCount = 0;
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
        postCount += 1;
        // The write actually committed server-side (a subsequent GET will
        // find it), but the client-visible response is a generic 500 with
        // wording that does NOT match /duplicate|alternate key/i and a
        // status that is NOT 409/412 -- proving recovery is not gated on
        // guessing the error's shape.
        state.row = {
          wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000000, wmkf_lifecyclestate: 100000000,
          wmkf_generationkey: generationKey, wmkf_claimtoken: JSON.parse(init.body).wmkf_claimtoken,
          wmkf_sharepointfolderpath: JSON.parse(init.body).wmkf_sharepointfolderpath, wmkf_filename: JSON.parse(init.body).wmkf_filename,
          _wmkf_request_value: REQUEST_ID, '@odata.etag': 'W/"row-1"', modifiedon: new Date().toISOString(),
        };
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Something unexpected happened'), json: () => Promise.resolve({}) });
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

    const { result } = await run({});

    expect(result.outcome).toBe('advanced');
    expect(postCount).toBe(1);
  });

  it('a create response that is lost, with NO row ever committed, stops with ambiguous_create_outcome (not ia_claim_lost) and never re-POSTs', async () => {
    let postCount = 0;
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'POST' && href.includes('wmkf_requestdocuments')) {
        postCount += 1;
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Something unexpected happened'), json: () => Promise.resolve({}) });
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [] });
      throw new Error(`unexpected fetch to ${href}`);
    });

    const { result } = await run({});

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
    expect(postCount).toBe(1);
    // The stop is fail-closed but not diagnostics-free: the reason stays the
    // bare code (as the Basic create stop) while the POST's HTTP status reaches
    // the operator through the returned message, which never enters the ledger.
    expect(result.run.lastError).toBe('ambiguous_create_outcome');
    expect(result.errorMessage).toContain('(http 500)');
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
      deps: { client: fakeClient(), graph, sharePointTarget: SHARE_POINT_TARGET },
    }));

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('an upload attempted WITH a journaled item never re-PUTs -- it re-reads the exact item by stable id and proceeds to commit', async () => {
    const { generationKey } = identityFor();
    const run0 = baseRun();
    const { ledger, calls, getResources } = createFakeLedger(run0);
    const claimToken = 'claim-11111111';
    const filename = '9009009 Initial Assessment aaaaaaaa-bbbbbbbb.docx';
    const row = {
      wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000000, wmkf_lifecyclestate: 100000000,
      wmkf_generationkey: generationKey, wmkf_claimtoken: claimToken,
      wmkf_sharepointfolderpath: `9009009_${REQUEST_ID.replace(/-/g, '').toUpperCase()}/Artifacts/Initial Assessment`,
      wmkf_filename: filename, wmkf_contenthash: null,
      _wmkf_request_value: REQUEST_ID, '@odata.etag': 'W/"row-1"', modifiedon: new Date().toISOString(),
    };
    // Pre-seed the resource row: the PUT already committed and its item id
    // (plus driveId/siteId, needed to re-fetch metadata without re-PUTting)
    // was journaled by a prior invocation, which then crashed before the
    // $batch commit.
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: null, leaseGeneration: 0, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey },
    });
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      readback: {
        generationKey, requestDocumentId: REQUEST_DOCUMENT_ID,
        uploadAttemptedAt: new Date().toISOString(),
        itemId: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', driveId: 'b!driveIdSample1234567890', siteId: 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222',
      },
      outcome: 'dispatched',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    const state = { row, request: { akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' } };
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        state.row = { ...state.row, ...JSON.parse(init.body), '@odata.etag': 'W/"row-2"' };
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('/$batch')) {
        const opCount = (String(init.body).match(/Content-ID: \d+/g) || []).length;
        state.row = { ...state.row, wmkf_operationstatus: 100000001, wmkf_sharepointdriveid: 'b!driveIdSample1234567890', wmkf_sharepointitemid: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', '@odata.etag': 'W/"row-3"' };
        state.request = { ...state.request, _wmkf_currentinitialassessment_value: REQUEST_DOCUMENT_ID, '@odata.etag': 'W/"request-2"' };
        return Promise.resolve(multipartResponse(Array.from({ length: opCount }, (_, i) => ({ contentId: i + 1, status: 204 }))));
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [state.row] });
      if (href.includes('akoya_requests(')) return jsonResponse(state.request);
      throw new Error(`unexpected fetch to ${href}`);
    });
    const graph = fakeGraph({
      getFileMetadataById: jest.fn(async (driveId, itemId) => ({
        driveId, id: itemId, name: filename, size: 123, webUrl: 'https://contoso.sharepoint.com/item', eTag: '"1"', versionId: '2.0', lastModified: '2026-09-24T00:00:00Z',
      })),
    });
    const manifest = baseManifest();
    const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: fakeClient(), graph, sharePointTarget: SHARE_POINT_TARGET },
    }));

    expect(result.outcome).toBe('advanced');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    expect(graph.getFileMetadataById).toHaveBeenCalledWith('b!driveIdSample1234567890', '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', { siteId: EXPECTED_SITE_ID });
    const iaResource = getResources().find((r) => r.resourceKind === 'dataverse_request_document');
    expect(iaResource.readback.sourceVersionId).toBe('2.0');
    // P2-E: once an item id is already journaled (upload already committed),
    // the PATCH's own contentHash merge is skipped -- only the terminal
    // merge after commitReadyLineage carries contentHash. (Both would be the
    // same stable value anyway, but this proves the resume branch doesn't
    // redundantly re-journal it.)
    const contentHashReadbacks = calls.filter((c) => c.op === 'recordResourceReadback' && c.readback?.contentHash);
    expect(contentHashReadbacks).toHaveLength(1);
  });

  it('a journaled item on a drive other than the preflight-verified drive stops with preflight_identity_changed before any Graph read', async () => {
    const { generationKey } = identityFor();
    const run0 = baseRun();
    const { ledger } = createFakeLedger(run0);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: null, leaseGeneration: 0, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey },
    });
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      readback: {
        generationKey, requestDocumentId: REQUEST_DOCUMENT_ID,
        uploadAttemptedAt: new Date().toISOString(),
        itemId: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', driveId: 'b!driveIdOther9876543210', siteId: 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222',
      },
      outcome: 'dispatched',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    const row = {
      wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000000, wmkf_lifecyclestate: 100000000,
      wmkf_generationkey: generationKey, wmkf_claimtoken: 'claim-11111111',
      wmkf_sharepointfolderpath: `9009009_${REQUEST_ID.replace(/-/g, '').toUpperCase()}/Artifacts/Initial Assessment`,
      wmkf_filename: '9009009 Initial Assessment aaaaaaaa-bbbbbbbb.docx', wmkf_contenthash: null,
      _wmkf_request_value: REQUEST_ID, '@odata.etag': 'W/"row-1"', modifiedon: new Date().toISOString(),
    };
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [row] });
      if (href.includes('akoya_requests(')) return jsonResponse({ akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' });
      throw new Error(`unexpected fetch to ${href}`);
    });
    const graph = fakeGraph({ getFileMetadataById: jest.fn() });
    const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
      runId: RUN_ID, ledger, manifest: baseManifest(), bundle: null,
      deps: { client: fakeClient(), graph, sharePointTarget: SHARE_POINT_TARGET },
    }));

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('preflight_identity_changed');
    expect(graph.getFileMetadataById).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });

  it('a journaled item that is no longer readable (404) stops with ia_upload_ambiguous, never re-PUTs', async () => {
    const { generationKey } = identityFor();
    const run0 = baseRun();
    const { ledger } = createFakeLedger(run0);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: null, leaseGeneration: 0, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey },
    });
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      readback: {
        generationKey, requestDocumentId: REQUEST_DOCUMENT_ID, uploadAttemptedAt: new Date().toISOString(),
        itemId: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', driveId: 'b!driveIdSample1234567890', siteId: 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222',
      },
      outcome: 'dispatched',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    const row = {
      wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_artifacttype: 100000000, wmkf_operationstatus: 100000000, wmkf_lifecyclestate: 100000000,
      wmkf_generationkey: generationKey, wmkf_claimtoken: 'claim-11111111',
      wmkf_sharepointfolderpath: `9009009_${REQUEST_ID.replace(/-/g, '').toUpperCase()}/Artifacts/Initial Assessment`,
      wmkf_filename: '9009009 Initial Assessment aaaaaaaa-bbbbbbbb.docx', wmkf_contenthash: null,
      _wmkf_request_value: REQUEST_ID, '@odata.etag': 'W/"row-1"', modifiedon: new Date().toISOString(),
    };
    const state = { row };
    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (init?.method === 'PATCH' && href.includes('wmkf_requestdocuments(')) {
        state.row = { ...state.row, ...JSON.parse(init.body), '@odata.etag': 'W/"row-2"' };
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [state.row] });
      throw new Error(`unexpected fetch to ${href} -- the step must stop before any $batch or Graph re-PUT`);
    });
    // getFileMetadataById returns null on a clean 404 (files.js).
    const graph = fakeGraph({ getFileMetadataById: jest.fn(async () => null) });
    const manifest = baseManifest();
    const result = await bypassDynamicsRestrictions('test:seed-initial-assessment', () => advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: fakeClient(), graph, sharePointTarget: SHARE_POINT_TARGET },
    }));

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_upload_ambiguous');
    expect(graph.uploadFile).not.toHaveBeenCalled();
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

describe('stepSeedInitialAssessment — SharePoint site/drive binding (P1-B)', () => {
  it('a drifted Graph site/drive (preflight != run.expectedGraphSiteId/DriveId) stops with preflight_identity_changed before any Graph write', async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes('login.microsoftonline.com')) return tokenResponse();
      throw new Error(`unexpected fetch to ${url} -- the step must stop at preflight, before any Dataverse write`);
    });
    // Preflight resolves a DIFFERENT site/drive than this run's own
    // expectedGraphSiteId/expectedGraphDriveId (baseRun() above) -- drift.
    const graph = fakeGraph({
      getSiteId: jest.fn(async () => 'contoso.sharepoint.com,99999999-9999-9999-9999-999999999999,88888888-8888-8888-8888-888888888888'),
      getDriveId: jest.fn(async () => 'b!driveIdDrifted0000000000'),
    });
    const { result } = await run({ graph });

    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('preflight_identity_changed');
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });

  it('a matching Graph site/drive carries the preflight-verified ids into ensureFolderPath and the upload PUT', async () => {
    const { generationKey } = identityFor();
    const state = { row: null, request: { akoya_requestid: REQUEST_ID, _wmkf_currentinitialassessment_value: null, '@odata.etag': 'W/"request-1"' } };
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
      if (href.includes('/$batch')) {
        const opCount = (String(init.body).match(/Content-ID: \d+/g) || []).length;
        state.row = { ...state.row, wmkf_operationstatus: 100000001, wmkf_sharepointdriveid: EXPECTED_DRIVE_ID, wmkf_sharepointitemid: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', '@odata.etag': 'W/"row-3"' };
        state.request = { ...state.request, _wmkf_currentinitialassessment_value: REQUEST_DOCUMENT_ID, '@odata.etag': 'W/"request-2"' };
        return Promise.resolve(multipartResponse(Array.from({ length: opCount }, (_, i) => ({ contentId: i + 1, status: 204 }))));
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: state.row ? [state.row] : [] });
      if (href.includes('akoya_requests(')) return jsonResponse(state.request);
      throw new Error(`unexpected fetch to ${href}`);
    });
    const graph = fakeGraph();
    const { result } = await run({ graph });

    expect(result.outcome).toBe('advanced');
    expect(graph.ensureFolderPath).toHaveBeenCalledWith(
      'akoya_request', expect.any(String), { siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID },
    );
    expect(graph.uploadFile).toHaveBeenCalledWith(
      'akoya_request', expect.any(String), expect.any(String), expect.any(Buffer), expect.any(String),
      expect.objectContaining({ siteId: EXPECTED_SITE_ID, driveId: EXPECTED_DRIVE_ID, conflictBehavior: 'fail' }),
    );
  });
});

describe('stepSeedInitialAssessment — idempotent resume', () => {
  // A Ready row exactly as commitReadyLineage leaves it (Codex adversarial
  // round 1, F1; ownership per round 2, F5): the recovery path must prove
  // the row is THIS run's (claim-token digest journaled before the create
  // POST matches the row's retained wmkf_claimtoken) and then journal the
  // item, drive, version and HEX64 content hash from the row, because the
  // snapshot step requires the receipt's sourceVersionId and the verify step
  // anchors to its contentHash.
  const READY_GOVERNED_HASH = `${GOVERNED_DOCX_HASH_PREFIX}${Buffer.alloc(32, 0xab).toString('base64url')}`;
  const READY_ITEM_ID = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const READY_CLAIM_TOKEN = 'claim-token-of-this-run';
  const READY_CLAIM_SHA256 = nodeCrypto.createHash('sha256').update(READY_CLAIM_TOKEN).digest('hex');
  function readyRowFor(generationKey, overrides = {}) {
    return {
      wmkf_requestdocumentid: REQUEST_DOCUMENT_ID, wmkf_operationstatus: 100000001, wmkf_generationkey: generationKey,
      wmkf_claimtoken: READY_CLAIM_TOKEN,
      wmkf_contenthash: READY_GOVERNED_HASH, wmkf_sharepointitemid: READY_ITEM_ID, wmkf_sharepointdriveid: EXPECTED_DRIVE_ID,
      wmkf_sharepointsiteid: EXPECTED_SITE_ID, wmkf_sharepointversionid: '3.0', '@odata.etag': 'W/"row-1"',
      ...overrides,
    };
  }
  /** The receipt this runner journals BEFORE its create POST (claim digest + attempt marker), optionally with later merges. */
  function preCreateReceipt(generationKey, extra = {}) {
    return {
      resourceId: 1, sequence: 1, step: 'seed_initial_assessment', resourceKind: 'dataverse_request_document', system: 'dataverse',
      plannedIdentity: { generationKey }, outcome: 'dispatched',
      readback: { generationKey, claimTokenSha256: READY_CLAIM_SHA256, registryCreateAttemptedAt: new Date().toISOString(), ...extra },
    };
  }
  function mockReadyRow(readyRow) {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [readyRow] });
      throw new Error(`unexpected fetch to ${href}`);
    });
  }

  it('a Ready row this run created (claim digest matches) advances without re-running create/upload, journaling the full receipt the later steps require', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey));
    const graph = fakeGraph();
    const { result, calls } = await run({ graph }, [preCreateReceipt(generationKey)]);

    expect(result.errorMessage).toBeUndefined();
    expect(result.outcome).toBe('advanced');
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
    const readbacks = calls.filter((c) => c.op === 'recordResourceReadback');
    const last = readbacks[readbacks.length - 1].readback;
    expect(last).toMatchObject({
      requestDocumentId: REQUEST_DOCUMENT_ID, generationKey, claimTokenSha256: READY_CLAIM_SHA256,
      itemId: READY_ITEM_ID, driveId: EXPECTED_DRIVE_ID, siteId: EXPECTED_SITE_ID,
      sourceVersionId: '3.0', contentHash: Buffer.alloc(32, 0xab).toString('hex'),
    });
    // The two fields the snapshot step and the verify step key on must be
    // present -- their absence is exactly the stranded-run failure F1 found.
    expect(last.sourceVersionId).toBe('3.0');
    expect(last.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a Ready row at the generation key with NO receipt from this run is refused with ia_pointer_mismatch, never adopted (round 2, F5)', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey));
    const graph = fakeGraph();
    const { result, calls } = await run({ graph });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/this run never journaled a create; refusing to adopt/);
    expect(graph.uploadFile).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op === 'recordResourceReadback' && c.readback?.requestDocumentId)).toHaveLength(0);
  });

  it('a Ready row whose retained claim token is not this run\'s (a staff Generate at the same key) is refused with ia_pointer_mismatch (round 2, F5)', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey, { wmkf_claimtoken: 'somebody-elses-token' }));
    const graph = fakeGraph();
    const { result, calls } = await run({ graph }, [preCreateReceipt(generationKey)]);
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/does not carry this run's claim token/);
    expect(calls.filter((c) => c.op === 'recordResourceReadback' && c.readback?.requestDocumentId)).toHaveLength(0);
  });

  it('a Ready row whose id differs from the requestDocumentId this run journaled after its create is refused with ia_pointer_mismatch (round 2, F5)', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey));
    const graph = fakeGraph();
    const { result } = await run({ graph }, [preCreateReceipt(generationKey, { requestDocumentId: '55555555-5555-4555-8555-555555555555' })]);
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/requestDocumentId .* does not match the previously journaled requestDocumentId/);
  });

  it('a Ready row whose content hash differs from an anchor this run already journaled is refused, and the journaled anchor is never overwritten (round 2, F5)', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey));
    const graph = fakeGraph();
    const earlier = 'c'.repeat(64);
    const { result, getResources } = await run({ graph }, [preCreateReceipt(generationKey, { requestDocumentId: REQUEST_DOCUMENT_ID, contentHash: earlier })]);
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/contentHash .* does not match the previously journaled contentHash/);
    expect(getResources()[0].readback.contentHash).toBe(earlier);
  });

  it('a Ready row missing its SharePoint version stops with ia_pointer_mismatch instead of advancing into a run the snapshot step cannot continue', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey, { wmkf_sharepointversionid: null }));
    const graph = fakeGraph();
    const { result } = await run({ graph }, [preCreateReceipt(generationKey)]);
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/missing its SharePoint item, drive, version, or content hash/);
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });

  it('a Ready row whose item differs from the item this run already journaled stops with ia_pointer_mismatch', async () => {
    const { generationKey } = identityFor();
    mockReadyRow(readyRowFor(generationKey));
    const graph = fakeGraph();
    const journaled = preCreateReceipt(generationKey, { uploadAttemptedAt: new Date().toISOString(), itemId: '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234568', driveId: EXPECTED_DRIVE_ID, siteId: EXPECTED_SITE_ID });
    const { result, getResources } = await run({ graph }, [journaled]);
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ia_pointer_mismatch');
    expect(result.errorMessage).toMatch(/itemId .* does not match the previously journaled itemId/);
    expect(getResources()[0].readback.itemId).toBe('01ABCDEFGHIJKLMNOPQRSTUVWXYZ234568');
  });
});

describe('stepSeedInitialAssessment — trusted DAL context is required (Stage C round 2, P1-B)', () => {
  it('fails closed with no trusted Dataverse context when the caller supplies none (no bypassDynamicsRestrictions, no enterDynamicsBypassForScript)', async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      // A trusted-context failure must stop before any sandbox Dataverse
      // fetch is even attempted (assertTrustedDalContext runs first inside
      // every ia-sandbox-deps.js dependency).
      throw new Error(`unexpected fetch to ${href} -- assertTrustedDalContext should have stopped this step first`);
    });
    const run0 = baseRun();
    const { ledger } = createFakeLedger(run0);
    const manifest = baseManifest();
    // Deliberately NOT wrapped in bypassDynamicsRestrictions (or any other
    // context-establishing helper) -- this is the caller shape a CLI
    // invocation would have without runAdvance's own
    // enterDynamicsBypassForScript fix (scripts/rehearse-test-request-sandbox.mjs).
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: fakeClient(), graph: fakeGraph(), sharePointTarget: SHARE_POINT_TARGET },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.errorMessage).toContain('no trusted Dataverse context');
  });
});
