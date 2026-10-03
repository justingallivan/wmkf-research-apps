/**
 * Behavioral tests for lib/services/test-requests/run-runner.js's advanceRun
 * (build order item 5, slice 5b): one bounded step per call against a
 * recording FAKE ledger (matching the frozen run-ledger.js contract) and
 * real basic-clone-steps.js functions driven by fake `client`/`graph`
 * dependency objects (basic-clone-steps.js is already fully dependency
 * injected, so no module mocking is needed to run it offline).
 */
import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import {
  advanceRun, nextStepFor, recipeIncludesStep, recipeLeaseSeconds, recordFoundationTransitionBaseline, RECIPE_STEP_ORDER,
} from '../../lib/services/test-requests/run-runner.js';
import {
  bundleSourceOf, compileBody, computeRunPlanDigest, MANIFEST_V4, runPreflight, sha256,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { captureFoundationBaseline } from '../../lib/services/test-requests/foundation-transition.js';
import { assertLedgerReceipt, reviewerAddressSha256 } from '../../lib/services/test-requests/run-ledger.js';
import { reviewFileCopyPolicyDigest } from '../../lib/services/test-requests/review-file-copy.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { SANDBOX_REHEARSAL_COPY_POLICY, copyPolicyDigest } from '../../lib/services/test-requests/bundle-file-copy.js';
import { XLSX_MIME, buildXlsxCopyFixtures } from '../helpers/minimal-xlsx-package.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const APP_USER_ID = '55555555-5555-4555-8555-555555555555';
const ORG_ID = '66666666-6666-4666-8666-666666666666';
// Slice B: the production cast PI and Liaison contacts.
const PI_ID = '88888888-8888-4888-8888-888888888888';
const LIAISON_ID = '99999999-9999-4999-8999-999999999999';
const RESEARCH_LEADER_ID = '15151515-1515-4151-8151-151515151515';
const OTHER_CONTACT = '12121212-1212-4121-8121-121212121212';
const CAST_NAMES = { pi: 'PI', liaison: 'Liaison', research_leader: 'RESEARCH LEADER' };
const CAST_FIRST = { pi: 'TEST · Factory', liaison: 'TEST · Factory', research_leader: 'WMKF' };
const castAddress = (role) => `cast-${role}@example.test`;
const castMember = (role, memberId, overrides = {}) => ({
  memberId, environment: 'production', role, entity: 'contact', status: 'verified',
  firstName: CAST_FIRST[role], lastName: CAST_NAMES[role], addressSha256: reviewerAddressSha256(castAddress(role)).addressSha256, ...overrides,
});
/** The live cast contact row as readCast reads it; `drift` overrides fields. */
const castContactRow = (contactId, statecode, drift = {}) => {
  const role = contactId === LIAISON_ID ? 'liaison' : contactId === RESEARCH_LEADER_ID ? 'research_leader' : 'pi';
  return {
    contactid: contactId, firstname: CAST_FIRST[role], lastname: CAST_NAMES[role], emailaddress1: castAddress(role),
    statecode, _parentcustomerid_value: ORG_ID, ...drift,
  };
};
const VERIFIED_CAST = [castMember('liaison', LIAISON_ID), castMember('pi', PI_ID), castMember('research_leader', RESEARCH_LEADER_ID)];

function ok(body, status = 200) {
  return { ok: true, status, body };
}

function fakeGraph(overrides = {}) {
  return {
    getSiteId: async () => 'site-1',
    getDriveId: async () => 'drive-1',
    ensureFolderPath: async () => ({ id: 'folder-1' }),
    ...overrides,
  };
}

/** A recording fake ledger: satisfies the run-ledger.js shape and records every call. */
function createFakeLedger(initialRun, { castMembers = VERIFIED_CAST } = {}) {
  const calls = [];
  let run = { ...initialRun };
  const resources = [];
  let nextSequence = 1;
  let nextResourceId = 1;

  function bumpVersion() {
    run = { ...run, version: run.version + 1 };
    return run;
  }
  function fenceOk(leaseToken, leaseGeneration, expectedVersion) {
    return run.leaseToken === leaseToken && run.leaseGeneration === leaseGeneration
      && (expectedVersion === undefined || run.version === expectedVersion) && run.lockedUntil !== null;
  }

  const ledger = {
    async getRun(runId) {
      calls.push({ op: 'getRun', runId });
      return runId === run.runId ? { ...run } : null;
    },
    async claimLease({ runId, expectedVersion, leaseSeconds }) {
      calls.push({ op: 'claimLease', runId, expectedVersion, leaseSeconds });
      if (run.version !== expectedVersion || run.lockedUntil !== null) return null;
      run = { ...run, leaseToken: `lease-${run.leaseGeneration + 1}`, leaseGeneration: run.leaseGeneration + 1, lockedUntil: 'future', version: run.version + 1 };
      return { ...run };
    },
    async releaseLease({ runId, leaseToken, leaseGeneration }) {
      calls.push({ op: 'releaseLease', runId, leaseToken, leaseGeneration });
      if (!fenceOk(leaseToken, leaseGeneration)) return null;
      run = { ...run, leaseToken: null, lockedUntil: null };
      return { ...run };
    },
    async advanceStep({
      runId, leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, destinationRequestNumber,
    }) {
      calls.push({ op: 'advanceStep', runId, leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, destinationRequestNumber });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = {
        ...run,
        currentStep: nextStep,
        stepIndex: nextStepIndex,
        status: status ?? run.status,
        destinationRequestNumber: destinationRequestNumber ?? run.destinationRequestNumber,
        version: run.version + 1,
      };
      return { ...run };
    },
    async markReady({ runId, leaseToken, leaseGeneration, expectedVersion, destinationRequestNumber }) {
      calls.push({ op: 'markReady', runId, leaseToken, leaseGeneration, expectedVersion, destinationRequestNumber });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = {
        ...run, status: 'ready', destinationRequestNumber: destinationRequestNumber ?? run.destinationRequestNumber,
        leaseToken: null, lockedUntil: null, version: run.version + 1,
      };
      return { ...run };
    },
    async markNeedsAttention({ runId, leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      calls.push({ op: 'markNeedsAttention', runId, leaseToken, leaseGeneration, expectedVersion, reason, error });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = {
        ...run, status: 'needs_attention', needsAttentionReason: reason, lastError: error ?? run.lastError ?? null,
        leaseToken: null, lockedUntil: null, version: run.version + 1,
      };
      return { ...run };
    },
    async recordError({ runId, leaseToken, leaseGeneration, expectedVersion, error }) {
      calls.push({ op: 'recordError', runId, leaseToken, leaseGeneration, expectedVersion, error: error?.message ?? error });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, lastError: error?.message ?? String(error), version: run.version + 1 };
      return { ...run };
    },
    async journalPlannedResource({ runId, leaseToken, leaseGeneration, step, resourceKind, system, plannedIdentity }) {
      calls.push({ op: 'journalPlannedResource', runId, leaseToken, leaseGeneration, step, resourceKind, system, plannedIdentity });
      const resource = {
        resourceId: nextResourceId++, runId, sequence: nextSequence++, step, resourceKind, system,
        plannedIdentity, readback: null, outcome: 'planned',
      };
      resources.push(resource);
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, runId, leaseToken, leaseGeneration, responseStatus, readback, outcome }) {
      calls.push({ op: 'recordResourceReadback', resourceId, runId, leaseToken, leaseGeneration, responseStatus, readback, outcome });
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.readback = readback;
      resource.outcome = outcome;
      resource.responseStatus = responseStatus;
      return { ...resource };
    },
    async recordResourceFailure({ resourceId, runId, leaseToken, leaseGeneration, outcome, error }) {
      calls.push({ op: 'recordResourceFailure', resourceId, runId, leaseToken, leaseGeneration, outcome, error: error?.message ?? error });
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.outcome = outcome;
      resource.error = error?.message ?? String(error);
      return { ...resource };
    },
    async listRunResources(runId) {
      calls.push({ op: 'listRunResources', runId });
      return resources.map((row) => ({ ...row }));
    },
    async listRunReviewerAssignments(runId) {
      calls.push({ op: 'listRunReviewerAssignments', runId });
      return [];
    },
    async getRunReviewerAssignment() {
      return null;
    },
    async listCastMembers({ environment }) {
      calls.push({ op: 'listCastMembers', environment });
      return castMembers.filter((member) => member.environment === environment).map((member) => ({ ...member }));
    },
  };
  return { ledger, calls, getRun: () => run, getResources: () => resources };
}

// create_request re-hashes the body it POSTs (MVP slice 1), so the fixture
// carries a real body and its real hash.
const FIXTURE_CREATE_BODY = { akoya_requestid: REQUEST_ID, akoya_title: 'TEST: fixture' };
const FIXTURE_BODY_HASH = sha256(FIXTURE_CREATE_BODY);

function baseRun(overrides = {}) {
  return {
    runId: RUN_ID,
    recipe: 'basic',
    status: 'prepared',
    currentStep: 'fence_source',
    stepIndex: 0,
    version: 1,
    leaseToken: null,
    leaseGeneration: 0,
    lockedUntil: null,
    createBodySha256: FIXTURE_BODY_HASH,
    bundleSha256: 'bundle-hash',
    copyPolicyDigest: 'policy-digest',
    sourceRequestId: SOURCE_ID,
    sourceRevision: 'rev-1',
    destinationRequestId: REQUEST_ID,
    destinationLocationId: LOCATION_ID,
    expectedAppUserId: APP_USER_ID,
    expectedOrganizationId: ORG_ID,
    expectedGraphSiteId: 'site-1',
    expectedGraphDriveId: 'drive-1',
    destinationRequestNumber: null,
    ...overrides,
  };
}

function baseManifest(overrides = {}) {
  return {
    kind: MANIFEST_V4,
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: '2026-12-01' },
    source: { requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000, bundleSha256: 'bundle-hash' },
    createBody: FIXTURE_CREATE_BODY,
    createBodySha256: FIXTURE_BODY_HASH,
    copyPolicy: { digest: 'policy-digest' },
    expectedRequestType: { value: 100000000 },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: ORG_ID },
    expectedGraphSiteId: 'site-1',
    expectedGraphDriveId: 'drive-1',
    ...overrides,
  };
}

describe('advanceRun: caller-error digest refusal', () => {
  test('refuses before claiming any lease when the manifest does not match the reserved run', async () => {
    const { ledger, calls } = createFakeLedger(baseRun());
    const manifest = baseManifest({ createBodySha256: 'WRONG-HASH' });
    await expect(advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: { purpose: 'top secret purpose text' },
      deps: { client: {}, graph: {}, sharePointTarget: () => ({}) },
    })).rejects.toThrow('createBodySha256');
    expect(calls.filter((call) => call.op === 'claimLease')).toHaveLength(0);
    expect(calls.filter((call) => call.op === 'markNeedsAttention')).toHaveLength(0);
  });

  // Opus round-1 P3-1: a run reserved under a LEDGER_RECIPES token with no
  // built RECIPE_STEP_ORDER entry (final_writeup, still unbuilt as of slice
  // 4b) must fail BEFORE any lease claim or client call, not merely later
  // inside a step handler's own nextStepFor call (which would already have
  // run create_request -- a real Dataverse write -- by then). pre_site_visit
  // gained its step order in slice 4b and is exercised as a BUILT recipe
  // elsewhere in this file / test-request-run-runner-verify-reviews.test.js.
  test('refuses before claiming any lease or touching the client when the run\'s recipe has no built step order', async () => {
    // final_writeup's recipeSeedsReviewers is true (rank >= 'reviews'), so
    // assertRunMatchesManifestAndBundle's reviewer-plan-digest recheck runs
    // first (as it does for a real `reviews` run); the manifest/run pair
    // below is built to pass that recheck cleanly so the NEW
    // stepOrderForRecipe fail-closed check (not a digest mismatch) is what
    // actually fires.
    const bundle = { reviewers: [] };
    const bundleSha256 = sha256(bundle);
    const manifest = baseManifest({
      recipe: 'final_writeup',
      reviewFilePolicy: { digest: reviewFileCopyPolicyDigest() },
      source: {
        requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000, bundleSha256,
      },
    });
    const planDigest = computeRunPlanDigest({ manifest, reviewerAddressDigests: [] });
    const { ledger, calls } = createFakeLedger(baseRun({ recipe: 'final_writeup', planDigest, bundleSha256 }));
    const client = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
    const graph = fakeGraph({
      getSiteId: jest.fn(async () => 'site-1'), getDriveId: jest.fn(async () => 'drive-1'),
    });
    await expect(advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph, sharePointTarget: () => ({}) },
    })).rejects.toThrow('Unknown Test Request Factory recipe: final_writeup.');
    expect(calls.filter((call) => call.op === 'claimLease')).toHaveLength(0);
    expect(calls.filter((call) => call.op === 'markNeedsAttention')).toHaveLength(0);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(graph.getSiteId).not.toHaveBeenCalled();
    expect(graph.getDriveId).not.toHaveBeenCalled();
  });
});

describe('advanceRun: lease claim', () => {
  test('lease_unavailable when claimLease returns null, with no step work done', async () => {
    const run = baseRun({ version: 1, leaseToken: 'someone-else', lockedUntil: 'future' });
    const { ledger, calls } = createFakeLedger(run);
    const manifest = baseManifest();
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: {}, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('lease_unavailable');
    expect(calls.map((call) => call.op)).toEqual(['getRun', 'claimLease']);
  });
});

describe('advanceRun: needs_attention on a thrown step', () => {
  test('records the error, marks needs_attention with a reason, and takes no further step', async () => {
    const { ledger, calls } = createFakeLedger(baseRun());
    const manifest = baseManifest();
    const client = { get: jest.fn(async () => { throw new Error('sandbox unreachable'); }) };
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client, graph: {}, sharePointTarget: () => ({ registered: true, key: 'akoyago-shared' }) },
    });
    expect(result.outcome).toBe('needs_attention');
    const ops = calls.map((call) => call.op);
    // One fenced transition carries both the reason and the error; the
    // separate recordError round-trip is gone (Codex round twelve).
    expect(ops).not.toContain('recordError');
    expect(ops).toContain('markNeedsAttention');
    const attention = calls.find((call) => call.op === 'markNeedsAttention');
    expect(attention.reason).toBeInstanceOf(Error);
    expect(attention.error).toBe(attention.reason);
    expect(result.run.lastError).toBeInstanceOf(Error);
    expect(result.errorMessage).toBeTruthy();
  });

  test('a bundle containing purpose text never appears in any ledger call argument', async () => {
    const bundle = { source: { request: { akoya_purpose: 'CONFIDENTIAL GRANT PURPOSE TEXT' } } };
    const { ledger, calls } = createFakeLedger(baseRun({ bundleSha256: sha256(bundle) }));
    const manifest = baseManifest({ source: { requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000, bundleSha256: sha256(bundle) } });
    const client = { get: jest.fn(async () => { throw new Error('boom'); }) };
    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('CONFIDENTIAL GRANT PURPOSE TEXT');
  });
});

describe('advanceRun: create_request dispatch-time checks (MVP slice 1, Codex)', () => {
  const PD_ID = '66666666-6666-4666-8666-666666666666';
  const PROD = 'https://wmkf.crm.dynamics.com';

  test('an edited create body with its hash field left unchanged never reaches Dataverse', async () => {
    const run = baseRun({ currentStep: 'create_request', stepIndex: 1 });
    const { ledger } = createFakeLedger(run);
    const manifest = baseManifest({ createBody: { ...FIXTURE_CREATE_BODY, akoya_requeststatus: 'Approved' } });
    const client = { get: jest.fn(), postWithOptions: jest.fn(), patch: jest.fn() };
    const result = await advanceRun({ runId: RUN_ID, ledger, manifest, bundle: null, deps: { client, graph: fakeGraph(), sharePointTarget: () => ({}) } });
    expect(result.outcome).toBe('needs_attention');
    expect(result.errorMessage).toMatch(/does not hash to the reserved run body/);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.postWithOptions).not.toHaveBeenCalled();
  });

  test('a program director disabled after fence_source stops the production create before any other call', async () => {
    const run = baseRun({
      currentStep: 'create_request', stepIndex: 1, destinationEnvironment: 'production', destinationDataverseHost: 'wmkf.crm.dynamics.com',
    });
    const { ledger } = createFakeLedger(run);
    const manifest = baseManifest({
      target: PROD, targetEnvironment: 'production',
      values: { ...baseManifest().values, programDirectorId: PD_ID, grantProgramId: ORG_ID },
    });
    const get = jest.fn(async (requestPath) => {
      if (requestPath.startsWith(`/systemusers(${PD_ID})`)) {
        return ok({ systemuserid: PD_ID, fullname: 'Staff', isdisabled: true, accessmode: 0, internalemailaddress: 'pd@wmkeck.org' });
      }
      throw new Error(`unexpected call: ${requestPath}`);
    });
    const client = { baseUrl: `${PROD}/api/data/v9.2`, get, postWithOptions: jest.fn() };
    const result = await advanceRun({ runId: RUN_ID, ledger, manifest, bundle: null, deps: { client, graph: fakeGraph(), sharePointTarget: () => ({}) } });
    expect(result.outcome).toBe('needs_attention');
    expect(result.errorMessage).toMatch(/not an enabled staff user/);
    expect(get).toHaveBeenCalledTimes(1);
    expect(client.postWithOptions).not.toHaveBeenCalled();
  });
});

describe('advanceRun: production runs write only through the fence (MVP slice 2)', () => {
  const PD_ID = '66666666-6666-4666-8666-666666666666';
  const PROGRAM_ID = '77777777-7777-4777-8777-777777777777';
  const PROD = 'https://wmkf.crm.dynamics.com';

  function productionClient(postWithOptions, liveSourceVersion = 42, extraRoutes = null, castContactState = 0, castDrift = {}) {
    return {
      baseUrl: `${PROD}/api/data/v9.2`,
      postWithOptions,
      async get(rawPath) {
        const requestPath = decodeURIComponent(rawPath);
        const extra = extraRoutes?.(requestPath);
        if (extra) return extra;
        if (requestPath.startsWith(`/systemusers(${PD_ID})`)) {
          return ok({ systemuserid: PD_ID, fullname: 'Staff', isdisabled: false, accessmode: 0, internalemailaddress: 'pd@wmkeck.org' });
        }
        if (requestPath.includes('ManyToOneRelationships')) {
          if (requestPath.includes("'wmkf_programdirector'")) return ok({ value: [{ ReferencedEntity: 'systemuser', ReferencingEntityNavigationPropertyName: 'wmkf_ProgramDirector' }] });
          if (requestPath.includes("'wmkf_grantprogram'")) return ok({ value: [{ ReferencedEntity: 'wmkf_grantprogram', ReferencingEntityNavigationPropertyName: 'wmkf_GrantProgram' }] });
          if (requestPath.includes("'wmkf_projectleader'")) return ok({ value: [{ ReferencedEntity: 'contact', ReferencingEntityNavigationPropertyName: 'wmkf_ProjectLeader' }] });
          if (requestPath.includes("'wmkf_researchleader'")) return ok({ value: [{ ReferencedEntity: 'contact', ReferencingEntityNavigationPropertyName: 'wmkf_ResearchLeader' }] });
          if (requestPath.includes("'akoya_primarycontactid'")) return ok({ value: [{ ReferencedEntity: 'contact', ReferencingEntityNavigationPropertyName: 'akoya_primarycontactid' }] });
          return ok({ value: [{ ReferencedEntity: 'account' }] });
        }
        if (requestPath.includes('PicklistAttributeMetadata')) {
          return ok({ OptionSet: { Options: [{ Value: 100000000, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } });
        }
        if (requestPath.includes('MoneyAttributeMetadata')) return ok({ MinValue: 0, MaxValue: 1_000_000_000 });
        if (requestPath.includes('StringAttributeMetadata') || requestPath.includes('MemoAttributeMetadata')) return ok({ MaxLength: 100 });
        if (requestPath.includes('EntityDefinitions')) {
          const names = [...requestPath.matchAll(/LogicalName eq '([a-z_]+)'/g)].map((m) => m[1]);
          const types = {
            akoya_requestid: 'Uniqueidentifier', akoya_applicantid: 'Lookup', akoya_request: 'Money', akoya_requesttype: 'Picklist',
            wmkf_meetingdate: 'DateOnly', wmkf_istestrequest: 'Boolean', wmkf_respondreminderenabled: 'Boolean',
            wmkf_reviewduereminderenabled: 'Boolean', wmkf_programdirector: 'Lookup', wmkf_grantprogram: 'Lookup',
            wmkf_projectleader: 'Lookup', akoya_primarycontactid: 'Lookup', wmkf_researchleader: 'Lookup',
            akoya_purpose: 'Memo', wmkf_abstract: 'Memo',
          };
          return ok({ value: names.map((field) => ({ LogicalName: field, AttributeType: types[field] ?? 'String', IsValidForCreate: true, RequiredLevel: { Value: 'None' } })) });
        }
        if (requestPath.startsWith('/wmkf_grantprograms')) return ok({ value: [{ wmkf_grantprogramid: PROGRAM_ID, wmkf_name: 'Research' }] });
        if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: false, status: 404, body: null };
        if (requestPath.startsWith(`/akoya_requests(${SOURCE_ID})`)) return ok({
          akoya_requestid: SOURCE_ID, versionnumber: liveSourceVersion, wmkf_abstract: 'Applicant source abstract',
        });
        if (requestPath.startsWith('/accounts')) return ok({ value: [{ accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0 }] });
        if (requestPath.startsWith('/sharepointsites')) return ok({ value: [{ sharepointsiteid: 'site-x', absoluteurl: 'https://example.sharepoint.com/sites/akoyago' }] });
        if (requestPath.startsWith('/sharepointdocumentlocations')) return ok({ value: [{ sharepointdocumentlocationid: 'parent-1', _parentsiteorlocation_value: 'site-x' }] });
        if (requestPath.startsWith('/systemusers')) return ok({ value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] });
        const castContact = /^\/contacts\(([0-9a-f-]{36})\)/.exec(requestPath);
        if (castContact && [PI_ID, LIAISON_ID, RESEARCH_LEADER_ID, OTHER_CONTACT].includes(castContact[1])) return ok(castContactRow(castContact[1], castContactState, castDrift));
        if (requestPath.startsWith('/contacts?')) return ok({ value: [] });
        throw new Error(`unexpected path: ${requestPath}`);
      },
    };
  }

  async function runProductionCreate({ body, liveSourceVersion = 42, castMembers = VERIFIED_CAST, castContactState = 0, castDrift = {}, applicantAbstract, step = 'create_request' }) {
    const sourceRow = {
      akoya_requestid: SOURCE_ID, akoya_requestnum: '1003222', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 42,
      ...(applicantAbstract === undefined ? {} : { wmkf_abstract: applicantAbstract }),
    };
    const bundle = buildSourceBundle({
      sourceRow,
      documents: [], dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date(), reviewers: [],
      ...(applicantAbstract === undefined ? {} : { applicantAbstract }),
    });
    const postWithOptions = jest.fn();
    const client = productionClient(postWithOptions, liveSourceVersion, null, castContactState, castDrift);
    process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
    const values = {
      ...baseManifest().values, testLabel: 'TEST: fence fixture', fiscalYear: 'December 2026',
      programDirectorId: PD_ID, grantProgramId: PROGRAM_ID,
      piContactId: PI_ID, liaisonContactId: LIAISON_ID, researchLeaderContactId: RESEARCH_LEADER_ID,
    };
    if (applicantAbstract !== undefined && body === undefined) {
      const preflight = await runPreflight(client, fakeGraph(), () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' }));
      body = compileBody(preflight, values, bundle.source.request, bundle.abstract);
    }
    const run = baseRun({
      currentStep: step, stepIndex: step === 'fence_source' ? 0 : 1, createBodySha256: sha256(body), bundleSha256: sha256(bundle),
      copyPolicyDigest: copyPolicyDigest(), sourceRevision: bundle.source.request.revision,
      destinationEnvironment: 'production', destinationDataverseHost: 'wmkf.crm.dynamics.com',
    });
    const { ledger } = createFakeLedger(run, { castMembers });
    const manifest = baseManifest({
      target: PROD, targetEnvironment: 'production', createBody: body, createBodySha256: sha256(body), bundle,
      source: {
        requestId: SOURCE_ID, revision: bundle.source.request.revision, requestType: 100000000, bundleSha256: sha256(bundle),
        dataverseHost: bundle.source.dataverseHost, exportedAt: bundle.exportedAt, requestNumber: '1003222',
      },
      copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
      values,
    });
    process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: fakeGraph(), sharePointTarget: () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' }) },
    });
    return { result, postWithOptions, body };
  }

  const legitBody = { akoya_requestid: REQUEST_ID, akoya_title: 'TEST: fixture', akoya_purpose: 'Synthetic purpose', akoya_request: 5000 };

  test('a create body the fence does not admit never reaches the transport', async () => {
    // Hash-consistent but naming another Request GUID: only the fence stops it.
    const { result, postWithOptions } = await runProductionCreate({ body: { ...legitBody, akoya_requestid: SOURCE_ID } });
    expect(result.errorMessage).toMatch(/Production write fence/);
    expect(result.outcome).toBe('needs_attention');
    expect(postWithOptions).not.toHaveBeenCalled();
  });

  test('a source edited between fence_source and create_request stops the create before the POST (Codex, slice 2)', async () => {
    const { result, postWithOptions } = await runProductionCreate({ body: legitBody, liveSourceVersion: 43 });
    expect(result.errorMessage).toMatch(/changed since the bundle export/);
    expect(result.outcome).toBe('needs_attention');
    expect(postWithOptions).not.toHaveBeenCalled();
  });

  test('with the source unchanged, the same setup reaches the transport (the two refusals above are not vacuous)', async () => {
    const { postWithOptions } = await runProductionCreate({
      body: { ...legitBody, 'wmkf_ProjectLeader@odata.bind': `/contacts(${PI_ID})`, 'akoya_primarycontactid@odata.bind': `/contacts(${LIAISON_ID})`, 'wmkf_ResearchLeader@odata.bind': `/contacts(${RESEARCH_LEADER_ID})` },
    });
    expect(postWithOptions).toHaveBeenCalledTimes(1);
  });

  test('v5 fence_source recompiles the exact abstract into the create body before advancing', async () => {
    const applicantAbstract = 'Applicant source abstract';
    const { result, postWithOptions, body } = await runProductionCreate({
      applicantAbstract, step: 'fence_source',
    });
    expect(body.wmkf_abstract).toBe(applicantAbstract);
    // The runner got past its freshly compiled body digest check; this fixture
    // intentionally stops later because it does not seed the full transition baseline.
    expect(result.errorMessage).toMatch(/Foundation account read returned a different row/);
    expect(result.outcome).toBe('needs_attention');
    expect(postWithOptions).not.toHaveBeenCalled();
  });

  describe('cast PI and Liaison (slice B)', () => {
    const castBody = {
      ...legitBody,
      'wmkf_ProjectLeader@odata.bind': `/contacts(${PI_ID})`,
      'akoya_primarycontactid@odata.bind': `/contacts(${LIAISON_ID})`,
      'wmkf_ResearchLeader@odata.bind': `/contacts(${RESEARCH_LEADER_ID})`,
    };

    test('the fence admits the create binding exactly the manifest cast contacts', async () => {
      // The fake transport returns nothing, so the step fails after the POST; the POST itself is the assertion.
      const { postWithOptions } = await runProductionCreate({ body: castBody });
      expect(postWithOptions).toHaveBeenCalledTimes(1);
      expect(postWithOptions.mock.calls[0][1]).toEqual(castBody);
    });

    test('the fence refuses the PI and Liaison swapped (castBinds reach the fence per lookup)', async () => {
      const { result, postWithOptions } = await runProductionCreate({
        body: { ...legitBody, 'wmkf_ProjectLeader@odata.bind': `/contacts(${LIAISON_ID})`, 'akoya_primarycontactid@odata.bind': `/contacts(${PI_ID})`, 'wmkf_ResearchLeader@odata.bind': `/contacts(${RESEARCH_LEADER_ID})` },
      });
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/Production write fence: Request bind .* is not approved/);
      expect(postWithOptions).not.toHaveBeenCalled();
    });

    test('the fence refuses the Research Leader bound to the PI, and a create missing the Research Leader bind', async () => {
      const swapped = await runProductionCreate({ body: { ...castBody, 'wmkf_ResearchLeader@odata.bind': `/contacts(${PI_ID})` } });
      expect(swapped.result.errorMessage).toMatch(/Production write fence: Request bind wmkf_ResearchLeader@odata.bind is not approved/);
      expect(swapped.postWithOptions).not.toHaveBeenCalled();
      const { 'wmkf_ResearchLeader@odata.bind': _rl, ...withoutRl } = castBody;
      const missing = await runProductionCreate({ body: withoutRl });
      expect(missing.result.errorMessage).toMatch(/wmkf_researchleader to the cast contact exactly once/);
      expect(missing.postWithOptions).not.toHaveBeenCalled();
    });

    test('the fence refuses a contact bind outside the manifest cast (castBinds reach the fence)', async () => {
      const { result, postWithOptions } = await runProductionCreate({ body: { ...castBody, 'akoya_primarycontactid@odata.bind': `/contacts(${OTHER_CONTACT})` } });
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/Production write fence: Request bind akoya_primarycontactid@odata.bind is not approved/);
      expect(postWithOptions).not.toHaveBeenCalled();
    });

    test.each([
      ['the ledger Liaison is not verified', { castMembers: [castMember('pi', PI_ID), castMember('liaison', LIAISON_ID, { status: 'dispatched' })] }, /cast is not bindable \(cast_member_unverified\)/],
      ['the ledger PI is a different contact', { castMembers: [castMember('pi', OTHER_CONTACT), castMember('liaison', LIAISON_ID), castMember('research_leader', RESEARCH_LEADER_ID)] }, /cast pi is not the journaled, verified/],
      ['the ledger has no Research Leader', { castMembers: [castMember('pi', PI_ID), castMember('liaison', LIAISON_ID)] }, /cast_member_missing.*research_leader/],
      ['the ledger has no production cast', { castMembers: [] }, /cast is not bindable \(cast_member_missing\)/],
      ['a cast contact is inactive', { castContactState: 1 }, /cast is not bindable \(cast_member_drifted\).*statecode/],
      ['a cast contact\'s email changed after reservation', { castDrift: { emailaddress1: 'someone-else@example.test' } }, /cast_member_drifted.*emailaddress1/],
      ['a cast contact moved to another account', { castDrift: { _parentcustomerid_value: OTHER_CONTACT } }, /cast_member_drifted.*_parentcustomerid_value/],
      ['a cast contact lost its Foundation parent', { castDrift: { _parentcustomerid_value: null } }, /cast_member_drifted.*_parentcustomerid_value/],
      ['a cast contact was renamed', { castDrift: { lastname: 'Someone' } }, /cast_member_drifted.*lastname/],
    ])('the create lease refuses before the POST when %s', async (_label, options, message) => {
      const { result, postWithOptions } = await runProductionCreate({ body: castBody, ...options });
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(message);
      expect(postWithOptions).not.toHaveBeenCalled();
    });
  });

  describe('Foundation transition contract (MVP item 5)', () => {
    const SP_TARGET = () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' });
    const REQUEST_NUMBER = '1009001';
    const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const foundation = (overrides = {}) => ({
      accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0, versionnumber: 100, telephone1: '555-0100',
      akoya_taxstatus: 100000001, wmkf_bmf509: 'Undetermined',
      akoya_goverifytrigger: '2026-08-03T18:15:12Z', akoya_dexempt: '2026-08-03',
      akoya_countofrequests: 10, akoya_countofawards: 0, wmkf_countofdiscretionarygrant: 0, wmkf_countofprogramgrants: 0,
      akoya_totalgrants: 0, wmkf_sumofdiscretionarygrants: 0, wmkf_sumofprogramgrants: 0, akoya_mostrecentgrant: null,
      akoya_guidestarcode: 'G1', akoya_guidestardescription: 'Private foundation', akoya_guidestarirsbmfsubsection: '03',
      akoya_guidestarorganizationname: 'Keck', _primarycontactid_value: '13131313-1313-4131-8131-131313131313',
      ...overrides,
    });

    const ATTRIBUTE_TYPES = {
      akoya_requestid: 'Uniqueidentifier', akoya_applicantid: 'Lookup', akoya_purpose: 'Memo', akoya_request: 'Money',
      akoya_requesttype: 'Picklist', wmkf_meetingdate: 'DateOnly', wmkf_istestrequest: 'Boolean',
      wmkf_respondreminderenabled: 'Boolean', wmkf_reviewduereminderenabled: 'Boolean',
      wmkf_programdirector: 'Lookup', wmkf_grantprogram: 'Lookup', wmkf_projectleader: 'Lookup', akoya_primarycontactid: 'Lookup', wmkf_researchleader: 'Lookup',
    };

    function fixture({ step, account, requestRow = null, documents = [], expectedFiles = 0 }) {
      const bundle = buildSourceBundle({
        sourceRow: {
          akoya_requestid: SOURCE_ID, akoya_requestnum: '1003222', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
          akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 42,
        },
        documents, dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date(), reviewers: [],
      });
      const routes = (requestPath) => {
        if (requestPath === `/accounts(${ORG_ID})`) return ok(account());
        if (requestPath.includes('MoneyAttributeMetadata')) return ok({ MinValue: 0, MaxValue: 1_000_000_000 });
        if (requestPath.includes('/Attributes?') && requestPath.includes('$filter')) {
          const names = [...requestPath.matchAll(/LogicalName eq '([a-z_]+)'/g)].map((m) => m[1]);
          return ok({ value: names.map((field) => ({
            LogicalName: field, AttributeType: ATTRIBUTE_TYPES[field] || 'String', IsValidForCreate: true, RequiredLevel: { Value: 'None' },
          })) });
        }
        if (requestRow && requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) return ok(requestRow);
        if (requestRow && requestPath.startsWith('/sharepointdocumentlocations(parent-1)')) {
          return ok({ sharepointdocumentlocationid: 'parent-1', relativeurl: 'akoya_request', _parentsiteorlocation_value: 'site-x' });
        }
        if (requestRow && requestPath.startsWith('/sharepointdocumentlocations?') && requestPath.includes('_regardingobjectid_value')) {
          return ok({ value: [{
            sharepointdocumentlocationid: LOCATION_ID, relativeurl: `${REQUEST_NUMBER}_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`,
            _parentsiteorlocation_value: 'parent-1', _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
          }] });
        }
        if (requestPath.startsWith('/akoya_requestpayments') || requestPath.startsWith('/emails')) return ok({ value: [] });
        return null;
      };
      const client = productionClient(jest.fn(), 42, routes);
      const manifest = baseManifest({
        target: PROD, targetEnvironment: 'production', bundle,
        source: {
          requestId: SOURCE_ID, revision: bundle.source.request.revision, requestType: 100000000, bundleSha256: sha256(bundle),
          dataverseHost: bundle.source.dataverseHost, exportedAt: bundle.exportedAt, requestNumber: '1003222',
        },
        copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
        values: {
          ...baseManifest().values, programDirectorId: PD_ID, grantProgramId: PROGRAM_ID, testLabel: 'TEST fixture', fiscalYear: 'December 2026',
          piContactId: PI_ID, liaisonContactId: LIAISON_ID, researchLeaderContactId: RESEARCH_LEADER_ID,
        },
        invariants: { expectedSharePointFiles: expectedFiles },
      });
      const run = baseRun({
        currentStep: step, stepIndex: RECIPE_STEP_ORDER.basic.indexOf(step), bundleSha256: sha256(bundle),
        copyPolicyDigest: copyPolicyDigest(), sourceRevision: bundle.source.request.revision,
        destinationEnvironment: 'production', destinationDataverseHost: 'wmkf.crm.dynamics.com',
      });
      return { client, manifest, run, bundle };
    }

    const advance = ({ client, manifest, bundle }, ledger) => advanceRun({
      runId: RUN_ID, ledger, manifest, bundle, deps: { client, graph: fakeGraph({ listFiles: async () => [] }), sharePointTarget: SP_TARGET },
    });

    // The recorder runs at the end of a production fence_source (after the
    // body re-hash and absence check); called directly here because the
    // fixture metadata cannot compile a create body.
    async function recordBaseline(account, ledgerFixture = createFakeLedger(baseRun({ leaseToken: 'lease', leaseGeneration: 1, lockedUntil: 'x' })), liaisonContactId = null, piContactId = null) {
      const { client, run } = fixture({ step: 'fence_source', account });
      const leased = { ...run, leaseToken: 'lease', leaseGeneration: 1 };
      const outcome = await recordFoundationTransitionBaseline({ run: leased, ledger: ledgerFixture.ledger, client, liaisonContactId, piContactId })
        .then((resources) => ({ resources }), (error) => ({ error }));
      return { ...outcome, getResources: ledgerFixture.getResources, ledgerFixture };
    }

    test('the baseline journals the pre-run Primary Contact and the run\'s Liaison as ledger receipt keys', async () => {
      const { resources, error } = await recordBaseline(() => foundation({ _primarycontactid_value: OTHER_CONTACT }), undefined, LIAISON_ID, PI_ID);
      expect(error).toBeUndefined();
      const identity = resources[0].plannedIdentity;
      expect(identity).toMatchObject({ primaryContactId: OTHER_CONTACT, liaisonContactId: LIAISON_ID, piContactId: PI_ID });
      expect(() => assertLedgerReceipt(identity)).not.toThrow();
    });

    test('a production fence_source journals the baseline before advancing to the create', async () => {
      process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
      const setup = fixture({ step: 'fence_source', account: () => foundation() });
      const preflight = await runPreflight(setup.client, fakeGraph(), SP_TARGET);
      const body = compileBody(preflight, setup.manifest.values, bundleSourceOf(setup.manifest).request);
      // Slice B: the cast binds use the navigation properties live metadata resolved.
      expect(body['wmkf_ProjectLeader@odata.bind']).toBe(`/contacts(${PI_ID})`);
      expect(body['akoya_primarycontactid@odata.bind']).toBe(`/contacts(${LIAISON_ID})`);
      setup.manifest.createBody = body;
      setup.manifest.createBodySha256 = sha256(body);
      setup.run.createBodySha256 = sha256(body);
      const { ledger, getResources, getRun } = createFakeLedger(setup.run);
      const result = await advance(setup, ledger);
      expect(result.errorMessage).toBeUndefined();
      expect(result.outcome).toBe('advanced');
      expect(getRun().currentStep).toBe('create_request');
      expect(getResources().map((row) => [row.step, row.resourceKind])).toEqual([['fence_source', 'foundation_transition']]);
    });

    test('a production preflight refuses a cast lookup whose live relationship is not exactly one to contact (slice B)', async () => {
      process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
      const setup = fixture({ step: 'fence_source', account: () => foundation() });
      const wrongTarget = {
        ...setup.client,
        get: (rawPath) => (decodeURIComponent(rawPath).includes("ReferencingAttribute eq 'wmkf_projectleader'")
          ? ok({ value: [{ ReferencedEntity: 'account', ReferencingEntityNavigationPropertyName: 'wmkf_ProjectLeader' }] })
          : setup.client.get(rawPath)),
      };
      await expect(runPreflight(wrongTarget, fakeGraph(), SP_TARGET)).rejects.toThrow(/wmkf_projectleader is not exactly one lookup to contact/);
    });

    test('the pre-create baseline is one digest-only receipt the ledger accepts', async () => {
      const { resources, getResources } = await recordBaseline(() => foundation());
      expect(resources).toHaveLength(1);
      const rows = getResources().filter((row) => row.resourceKind === 'foundation_transition');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ step: 'fence_source', outcome: 'verified' });
      expect(rows[0].plannedIdentity).toMatchObject({ kind: 'foundation_transition', count: 10, organizationId: ORG_ID });
      expect(() => assertLedgerReceipt(rows[0].plannedIdentity)).not.toThrow();
      expect(JSON.stringify(rows[0].plannedIdentity)).not.toMatch(/555-0100|Undetermined/);
    });

    test('a repeated fence_source reuses a matching baseline and refuses a changed one', async () => {
      let phone = '555-0100';
      const first = await recordBaseline(() => foundation({ telephone1: phone }));
      const reused = await recordBaseline(() => foundation({ telephone1: phone }), first.ledgerFixture);
      expect(reused.resources).toEqual([]);
      expect(first.getResources()).toHaveLength(1);

      phone = '555-0199';
      const refused = await recordBaseline(() => foundation({ telephone1: phone }), first.ledgerFixture);
      expect(refused.error.message).toMatch(/changed since this run recorded its pre-create baseline/);
      expect(first.getResources()).toHaveLength(1);
    });

    test('a contract column missing from the read stops the step', async () => {
      const { error, getResources } = await recordBaseline(() => {
        const row = foundation();
        delete row.akoya_goverifytrigger;
        return row;
      });
      expect(error.message).toMatch(/lacks transition-contract column\(s\): akoya_goverifytrigger/);
      expect(getResources()).toHaveLength(0);
    });

    function verifyFixture(accountAfter, requestOverrides = {}, fixtureOptions = {}) {
      const body = {
        akoya_requestid: REQUEST_ID, akoya_title: 'TEST: fixture', akoya_fiscalyear: 'December 2026', akoya_requesttype: 100000000,
        akoya_purpose: 'Synthetic purpose', akoya_request: 5000, akoya_requeststatus: 'Phase II Pending',
      };
      const requestRow = {
        ...body, akoya_requestnum: REQUEST_NUMBER, wmkf_meetingdate: '2026-12-01', _akoya_applicantid_value: ORG_ID,
        _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID,
        wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false, akoya_submissionaccepted: false,
        _wmkf_programdirector_value: PD_ID, _wmkf_grantprogram_value: PROGRAM_ID,
        _wmkf_projectleader_value: PI_ID, _akoya_primarycontactid_value: LIAISON_ID, _wmkf_researchleader_value: RESEARCH_LEADER_ID, ...requestOverrides,
      };
      const withRequest = fixture({ step: 'verify', account: () => accountAfter, requestRow, ...fixtureOptions });
      withRequest.manifest.createBody = body;
      return withRequest;
    }

    async function verifyWith(accountAfter, baseline, requestOverrides = {}) {
      process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
      const setup = verifyFixture(accountAfter, requestOverrides);
      const { ledger, getResources } = createFakeLedger(setup.run);
      if (baseline) {
        await ledger.journalPlannedResource({ step: 'fence_source', resourceKind: 'foundation_transition', system: 'dataverse', plannedIdentity: baseline });
      }
      const result = await advance(setup, ledger);
      return { result, resources: getResources() };
    }

    const baselineFor = (row) => captureFoundationBaseline(row, [], new Date(Date.now() - 60_000));

    test('verify passes the observed GoVerify refresh and records the outcome', async () => {
      const after = foundation({ versionnumber: 140, akoya_goverifytrigger: nowIso(-30_000), akoya_dexempt: nowIso().slice(0, 10), akoya_countofrequests: 11 });
      const { result, resources } = await verifyWith(after, baselineFor(foundation()));
      expect(result.errorMessage).toBeUndefined();
      expect(result.outcome).toBe('ready');
      const outcomeRow = resources.find((row) => row.step === 'verify' && row.resourceKind === 'foundation_transition');
      expect(outcomeRow.readback).toEqual({ kind: 'foundation_transition', outcome: 'refreshed' });
      expect(() => assertLedgerReceipt(outcomeRow.readback)).not.toThrow();
    });

    test('verify fails a protected-column change the sandbox comparison would not see', async () => {
      const { result } = await verifyWith(foundation({ telephone1: '555-0199' }), baselineFor(foundation()));
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/Foundation account protected columns changed during the run/);
      expect(result.errorMessage).not.toMatch(/555-0199/);
    });

    test('verify fails when the Research Leader reads back different from the manifest', async () => {
      const { result } = await verifyWith(foundation(), baselineFor(foundation()), { _wmkf_researchleader_value: PI_ID });
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/cast Research Leader mismatch/);
    });

    test('verify fails when a cast lookup reads back different from the manifest (slice B)', async () => {
      const { result } = await verifyWith(foundation(), baselineFor(foundation()), { _wmkf_projectleader_value: LIAISON_ID });
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/cast PI mismatch/);
      const passing = await verifyWith(foundation(), baselineFor(foundation()));
      expect(passing.result.outcome).toBe('ready');
    });

    // The Liaison-copy allowance needs a baseline journaling the pre-run
    // Primary Contact, which the ledger grammar cannot hold yet (the runner
    // never journals one); built directly here to prove the runner threads
    // the manifest Liaison into the contract.
    test('verify judges the Primary Contact against the Liaison journaled with the baseline', async () => {
      const journaled = captureFoundationBaseline(foundation(), [], new Date(Date.now() - 60_000), { journalPrimaryContact: true, liaisonContactId: LIAISON_ID });
      const copied = await verifyWith(foundation({ _primarycontactid_value: LIAISON_ID }), journaled);
      expect(copied.result.errorMessage).toBeUndefined();
      expect(copied.result.outcome).toBe('ready');
      const other = await verifyWith(foundation({ _primarycontactid_value: PI_ID }), journaled);
      expect(other.result.outcome).toBe('needs_attention');
      expect(other.result.errorMessage).toMatch(/Primary Contact changed to a contact other than the run's cast Liaison/);
    });

    test('verify fails closed without a pre-create baseline', async () => {
      const { result } = await verifyWith(foundation(), null);
      expect(result.outcome).toBe('needs_attention');
      expect(result.errorMessage).toMatch(/pre-create baseline is missing/);
    });

    // A Basic XLSX copy verifies by package comparison: SharePoint rewrites
    // docProps/custom.xml on upload, so exact-hash verification (the PDF
    // path) can never pass. The verify step rebuilds its entries from ledger
    // rows alone, so the copy_file receipt must carry what package mode needs.
    describe('Basic XLSX file copy (package integrity)', () => {
      const SHEET_NAME = 'Project Budget spreadsheet.xlsx';
      // Receipt-shaped Graph ids (the ledger validates them); the bundle's
      // export-time drive id differs from the freshly resolved one.
      const DRIVE = 'b!AAAAAAAAAAAAAAAAAAAAAA';
      const SNAPSHOT_DRIVE = 'b!SNAPSHOTSNAPSHOT0000';
      const SOURCE_ITEM = `01${'A'.repeat(32)}`;
      const NEW_ITEM = `01${'B'.repeat(32)}`;
      const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
      const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
      const foundationAfter = () => foundation({ versionnumber: 140, akoya_goverifytrigger: nowIso(-30_000), akoya_dexempt: nowIso().slice(0, 10), akoya_countofrequests: 11 });
      let xlsx;

      beforeAll(async () => { xlsx = await buildXlsxCopyFixtures(); });

      function xlsxFixture(step, mimeType = XLSX_MIME, sourceBytes = xlsx.source) {
        const document = {
          id: 'inv-xlsx', kind: 'projectBudgetSpreadsheet', library: 'akoya_request', folder: '1003222_E43AE6EA/Phase I', name: SHEET_NAME,
          driveId: SNAPSHOT_DRIVE, graphItemId: SOURCE_ITEM, sharePointSite: SITE, size: sourceBytes.length, mimeType,
          eTag: '"src"', versionId: '1.0', contentHash: sha(sourceBytes),
        };
        const options = { documents: [document], expectedFiles: 1 };
        const setup = step === 'verify'
          ? verifyFixture(foundationAfter(), {}, options)
          : fixture({
            step, account: () => foundation(), documents: options.documents, expectedFiles: 1,
            requestRow: { akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, wmkf_meetingdate: '2026-12-01', _akoya_applicantid_value: ORG_ID },
          });
        setup.run.expectedGraphDriveId = DRIVE;
        setup.run.destinationRequestNumber = REQUEST_NUMBER; // the production fence needs the number
        setup.manifest.expectedGraphDriveId = DRIVE;
        return { ...setup, sourceBytes };
      }

      // A SharePoint that stores `uploadedBytes` in place of what was PUT.
      function sharePointGraph(sourceBytes, uploadedBytes, mimeType) {
        const destination = new Map();
        const itemById = (itemId) => [...destination.values()].find((item) => item.id === itemId) ?? null;
        const graph = fakeGraph({
          clearGraphCaches: () => {},
          getDriveId: async () => DRIVE,
          configuredSharePointTarget: () => ({ ...SITE, registered: true }),
          getFileMetadataById: async (driveId, itemId) => (itemId === SOURCE_ITEM
            ? { id: SOURCE_ITEM, name: SHEET_NAME, size: sourceBytes.length, mimeType, eTag: '"src"', versionId: '1.0' }
            : itemById(itemId)),
          downloadFile: async (driveId, itemId) => {
            if (itemId !== SOURCE_ITEM) return { buffer: itemById(itemId).buffer };
            if (driveId !== DRIVE) throw new Error(`source item is not on drive ${driveId}`); // only the freshly resolved id reaches it
            return { buffer: sourceBytes };
          },
          getFileMetadataByPath: async (library, folder, filename) => destination.get(`${folder}/${filename}`) ?? null,
          uploadFile: async (library, folder, filename, content, contentType, options) => {
            const item = { id: NEW_ITEM, name: filename, size: uploadedBytes.length, eTag: '"new"', versionId: '1.0', buffer: uploadedBytes, folder };
            destination.set(`${folder}/${filename}`, item);
            if (options?.onItemCreated) await options.onItemCreated({ id: item.id, name: filename, size: item.size, eTag: item.eTag });
            return { id: item.id, name: filename, size: item.size, eTag: item.eTag, versionId: '1.0' };
          },
          listFiles: async () => [...destination.values()].map((item) => ({ id: item.id, name: item.name, size: item.size, folder: item.folder })),
        });
        return { graph, destination };
      }

      async function copyThenVerify({ uploadedBytes = xlsx.promoted, mimeType = XLSX_MIME, sourceBytes = xlsx.source } = {}) {
        process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0');
        const copySetup = xlsxFixture('copy_file', mimeType, sourceBytes);
        const { graph } = sharePointGraph(sourceBytes, uploadedBytes, mimeType);
        const { ledger, getResources } = createFakeLedger(copySetup.run);
        const copied = await advanceRun({
          runId: RUN_ID, ledger, manifest: copySetup.manifest, bundle: copySetup.bundle, deps: { client: copySetup.client, graph, sharePointTarget: SP_TARGET },
        });
        // Resume: a fresh ledger holding only the persisted rows (JSON round
        // trip, receipt-validated), so the verify step inflates from rows alone.
        const rows = JSON.parse(JSON.stringify(getResources()));
        for (const row of rows) if (row.readback) assertLedgerReceipt(row.readback);
        const verifySetup = xlsxFixture('verify', mimeType, sourceBytes);
        const resumed = createFakeLedger(verifySetup.run);
        for (const row of rows) resumed.getResources().push(row);
        await resumed.ledger.journalPlannedResource({ step: 'fence_source', resourceKind: 'foundation_transition', system: 'dataverse', plannedIdentity: baselineFor(foundation()) });
        const verified = await advanceRun({
          runId: RUN_ID, ledger: resumed.ledger, manifest: verifySetup.manifest, bundle: verifySetup.bundle, deps: { client: verifySetup.client, graph, sharePointTarget: SP_TARGET },
        });
        return { copied, verified, rows };
      }

      test('reaches verified at copy_file, journals the package-mode keys, and the verify step passes after a resume', async () => {
        const { copied, verified, rows } = await copyThenVerify();
        expect(copied.errorMessage).toBeUndefined();
        const row = rows.find((r) => r.step === 'copy_file' && r.resourceKind === 'sharepoint_file');
        expect(row.outcome).toBe('verified');
        expect(row.readback).toMatchObject({
          mimeType: XLSX_MIME, sourceDriveId: DRIVE, attestedDigest: sha(xlsx.promoted), itemSize: xlsx.promoted.length, size: xlsx.source.length,
        });
        expect(verified.errorMessage).toBeUndefined();
        expect(verified.outcome).toBe('ready');
      });

      test('a copy whose worksheet changed stops at copy_file', async () => {
        const { copied } = await copyThenVerify({ uploadedBytes: xlsx.tampered });
        expect(copied.outcome).toBe('needs_attention');
        expect(copied.errorMessage).toMatch(/Package \(DOCX\/XLSX\) differs from the source/);
      });

      test('a PDF file keeps its receipt: no mimeType, no attestedDigest, the bundle snapshot drive id, and the exact-hash verify passes', async () => {
        const pdf = Buffer.from('%PDF-1.4 synthetic');
        const { copied, verified, rows } = await copyThenVerify({ uploadedBytes: pdf, sourceBytes: pdf, mimeType: 'application/pdf' });
        expect(copied.errorMessage).toBeUndefined();
        const { readback } = rows.find((r) => r.step === 'copy_file' && r.resourceKind === 'sharepoint_file');
        expect(readback).not.toHaveProperty('mimeType');
        expect(readback).not.toHaveProperty('attestedDigest');
        expect(readback.sourceDriveId).toBe(SNAPSHOT_DRIVE);
        expect(verified.outcome).toBe('ready');
      });
    });
  });
});

describe('advanceRun: create_request resume rules', () => {
  const preflightClient = () => ({
    async get(requestPath) {
      if (requestPath.includes('EntityDefinitions')) {
        if (requestPath.includes('ManyToOneRelationships')) return ok({ value: [{ ReferencedEntity: 'account' }] });
        if (requestPath.includes('PicklistAttributeMetadata')) {
          return ok({ OptionSet: { Options: [{ Value: 100000000, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } });
        }
        if (requestPath.includes('MoneyAttributeMetadata')) return ok({ MinValue: 0, MaxValue: 1 });
        if (requestPath.includes('StringAttributeMetadata') || requestPath.includes('MemoAttributeMetadata')) return ok({ MaxLength: 100 });
        return ok({
          value: [
            'akoya_requestid', 'akoya_applicantid', 'akoya_title', 'akoya_purpose', 'akoya_request',
            'akoya_fiscalyear', 'akoya_requesttype', 'wmkf_meetingdate', 'wmkf_abstract', 'wmkf_istestrequest',
            'wmkf_testcreationrunid', 'wmkf_respondreminderenabled', 'wmkf_reviewduereminderenabled',
          ].map((field) => ({ LogicalName: field, AttributeType: 'String', IsValidForCreate: true, RequiredLevel: { Value: 'None' } })),
        });
      }
      if (requestPath.startsWith('/accounts')) return ok({ value: [{ accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0 }] });
      if (requestPath.startsWith('/sharepointsites')) return ok({ value: [{ sharepointsiteid: 'site-x', absoluteurl: 'https://example.sharepoint.com/sites/akoyago' }] });
      if (requestPath.startsWith('/sharepointdocumentlocations')) return ok({ value: [{ sharepointdocumentlocationid: 'parent-1', _parentsiteorlocation_value: 'site-x' }] });
      if (requestPath.startsWith('/systemusers')) return ok({ value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] });
      if (requestPath.startsWith('/contacts')) return ok({ value: [] });
      throw new Error(`unexpected preflight path: ${requestPath}`);
    },
  });

  test('present and owned by this run: journals a recovered resource, never POSTs', async () => {
    const run = baseRun({ currentStep: 'create_request', stepIndex: 1 });
    const { ledger, calls } = createFakeLedger(run);
    const manifest = baseManifest();
    process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0'); // any valid-shaped GUID for getAppUser
    const base = preflightClient();
    const postWithOptions = jest.fn();
    const client = {
      ...base,
      async get(requestPath) {
        if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) {
          return ok({
            akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
            _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, akoya_requestnum: '9000010',
          });
        }
        return base.get(requestPath);
      },
      postWithOptions,
    };
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client, graph: fakeGraph(), sharePointTarget: () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' }) },
    });
    expect(postWithOptions).not.toHaveBeenCalled();
    expect(result.outcome).toBe('advanced');
    expect(result.run.destinationRequestNumber).toBe('9000010');
    const journaled = calls.find((call) => call.op === 'journalPlannedResource' && call.resourceKind === 'dataverse_request');
    expect(journaled).toBeDefined();
    const readback = calls.find((call) => call.op === 'recordResourceReadback' && call.outcome === 'recovered');
    expect(readback).toBeDefined();
  });

  test('present and NOT owned by this run: permanent needs_attention, never POSTs', async () => {
    const run = baseRun({ currentStep: 'create_request', stepIndex: 1 });
    const { ledger, calls } = createFakeLedger(run);
    const manifest = baseManifest();
    const base = preflightClient();
    const postWithOptions = jest.fn();
    const client = {
      ...base,
      async get(requestPath) {
        if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) {
          return ok({
            akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: 'someone-elses-run',
            _createdby_value: 'someone-else', _ownerid_value: 'someone-else',
          });
        }
        return base.get(requestPath);
      },
      postWithOptions,
    };
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client, graph: fakeGraph(), sharePointTarget: () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' }) },
    });
    expect(postWithOptions).not.toHaveBeenCalled();
    expect(result.outcome).toBe('needs_attention');
    const attention = calls.find((call) => call.op === 'markNeedsAttention');
    expect(attention.reason).toBeInstanceOf(Error);
    expect(attention.reason.code).toBe('preallocated_request_present_not_owned');
    expect(result.errorMessage).toContain('not owned by this run');
  });
});

describe('advanceRun: copy_file index derivation', () => {
  test('the file index equals the count of already-verified sharepoint_file resources', async () => {
    const run = baseRun({ currentStep: 'copy_file', stepIndex: 4 });
    const { ledger } = createFakeLedger(run);
    // Pre-seed one verified file resource directly through the ledger's own API.
    const claimed = await ledger.claimLease({ runId: RUN_ID, expectedVersion: 1, leaseSeconds: 300 });
    const resource = await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint', plannedIdentity: { index: 0 },
    });
    await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      responseStatus: null, readback: { index: 0, itemId: 'item-0' }, outcome: 'verified',
    });
    await ledger.releaseLease({ runId: RUN_ID, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration });

    const resources = await ledger.listRunResources(RUN_ID);
    const verifiedCount = resources.filter((row) => row.step === 'copy_file' && row.outcome === 'verified').length;
    expect(verifiedCount).toBe(1); // index 1 is what the next copy_file call must use
  });
});

describe('advanceRun: version threading through a failure', () => {
  test('when the needs_attention transition loses the fence, the outcome is lease_lost and the durable row is re-read', async () => {
    const run = baseRun();
    const { ledger, calls } = createFakeLedger(run);
    const manifest = baseManifest();
    ledger.markNeedsAttention = async (args) => { calls.push({ op: 'markNeedsAttention', ...args }); return null; };
    const client = { get: jest.fn(async () => { throw new Error('boom'); }) };
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('lease_lost');
    expect(result.run.status).not.toBe('needs_attention');
    expect(calls.filter((call) => call.op === 'recordError')).toHaveLength(0);
    expect(calls.filter((call) => call.op === 'getRun').length).toBeGreaterThanOrEqual(2);
  });
});

describe('slice 6a: per-recipe step order (RECIPE_STEP_ORDER / nextStepFor)', () => {
  test('basic order is unchanged: fence_source through verify, verify is the final step', () => {
    expect(RECIPE_STEP_ORDER.basic).toEqual([
      'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify',
    ]);
    const transitions = [
      ['fence_source', 'create_request', 1],
      ['create_request', 'correct_meeting_date', 2],
      ['correct_meeting_date', 'provision_location', 3],
      ['provision_location', 'copy_file', 4],
      ['copy_file', 'observe', 5],
      ['observe', 'verify', 6],
    ];
    for (const [from, to, index] of transitions) {
      expect(nextStepFor('basic', from)).toEqual({ step: to, index });
    }
    expect(nextStepFor('basic', 'verify')).toBeNull();
  });

  test('initial_assessment is the Basic steps through verify, then three IA-only steps; verify_initial_assessment is the final step', () => {
    expect(RECIPE_STEP_ORDER.initial_assessment).toEqual([
      'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify',
      'seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment',
    ]);
    const transitions = [
      ['fence_source', 'create_request', 1],
      ['create_request', 'correct_meeting_date', 2],
      ['correct_meeting_date', 'provision_location', 3],
      ['provision_location', 'copy_file', 4],
      ['copy_file', 'observe', 5],
      ['observe', 'verify', 6],
      ['verify', 'seed_initial_assessment', 7],
      ['seed_initial_assessment', 'seed_initial_assessment_snapshot', 8],
      ['seed_initial_assessment_snapshot', 'verify_initial_assessment', 9],
    ];
    for (const [from, to, index] of transitions) {
      expect(nextStepFor('initial_assessment', from)).toEqual({ step: to, index });
    }
    expect(nextStepFor('initial_assessment', 'verify_initial_assessment')).toBeNull();
  });

  test('fails closed on an unrecognized recipe or a step outside the recipe order', () => {
    expect(() => nextStepFor('nonexistent_recipe', 'fence_source')).toThrow('Unknown Test Request Factory recipe');
    expect(() => nextStepFor('basic', 'seed_initial_assessment')).toThrow("not part of the basic recipe's step order");
  });
});

describe('slice 6a: manifest/run recipe binding', () => {
  test('a manifest recipe that does not match the reserved run recipe is refused before any lease claim', async () => {
    const { ledger, calls } = createFakeLedger(baseRun({ recipe: 'initial_assessment' }));
    const manifest = baseManifest({ recipe: 'basic' });
    await expect(advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: {}, graph: {}, sharePointTarget: () => ({}) },
    })).rejects.toThrow('recipe');
    expect(calls.filter((call) => call.op === 'claimLease')).toHaveLength(0);
  });

  test('a manifest with no recipe field (pre-6a v4 manifest) is treated as basic and resumes a basic run', async () => {
    const { ledger, calls } = createFakeLedger(baseRun({ recipe: 'basic' }));
    const manifest = baseManifest(); // no `recipe` key
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: { get: jest.fn(async () => { throw new Error('boom'); }) }, graph: {}, sharePointTarget: () => ({}) },
    });
    // Reaches the step body (needs_attention from the thrown error), proving
    // the recipe compare did not refuse it up front.
    expect(result.outcome).toBe('needs_attention');
    expect(calls.filter((call) => call.op === 'claimLease')).toHaveLength(1);
  });

  test('a same-recipe manifest and run advance normally (recipe compare passes)', async () => {
    const { ledger, calls } = createFakeLedger(baseRun({ recipe: 'initial_assessment' }));
    const manifest = baseManifest({ recipe: 'initial_assessment' });
    await expect(advanceRun({
      runId: RUN_ID, ledger, manifest, bundle: null,
      deps: { client: { get: jest.fn(async () => { throw new Error('boom'); }) }, graph: {}, sharePointTarget: () => ({}) },
    })).resolves.toMatchObject({ outcome: 'needs_attention' });
    expect(calls.filter((call) => call.op === 'claimLease')).toHaveLength(1);
  });
});

// The `recipe_step_not_built` stub this suite previously pinned for
// seed_initial_assessment_snapshot/verify_initial_assessment was slice 6a/
// Stage A-B scaffolding; both step bodies were built in Stage C (slice 6b) and
// now have their own dedicated coverage:
// test-request-run-runner-seed-initial-assessment-snapshot.test.js and
// test-request-run-runner-verify-initial-assessment.test.js.

describe('slice 6c-i: reviews recipe step order (cumulative on initial_assessment)', () => {
  test('reviews is the initial_assessment order plus the four Reviews-only steps; verify_reviews is the final step', () => {
    expect(RECIPE_STEP_ORDER.reviews).toEqual([
      'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify',
      'seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment',
      'seed_reviewers', 'copy_review_file', 'seed_review_answers', 'verify_reviews',
    ]);
    const transitions = [
      ['verify_initial_assessment', 'seed_reviewers', 10],
      ['seed_reviewers', 'copy_review_file', 11],
      ['copy_review_file', 'seed_review_answers', 12],
      ['seed_review_answers', 'verify_reviews', 13],
    ];
    for (const [from, to, index] of transitions) {
      expect(nextStepFor('reviews', from)).toEqual({ step: to, index });
    }
    expect(nextStepFor('reviews', 'verify_reviews')).toBeNull();
  });

  // Slice 4b: pre_site_visit is cumulative on reviews, then its own four steps.
  test('RECIPE_STEP_ORDER.pre_site_visit is the reviews order plus the four Pre-Site steps', () => {
    expect(RECIPE_STEP_ORDER.pre_site_visit).toEqual([
      ...RECIPE_STEP_ORDER.reviews,
      'seed_presite_ai_run', 'seed_presite_draft', 'render_presite', 'verify_presite',
    ]);
    const transitions = [
      ['verify_reviews', 'seed_presite_ai_run', 14],
      ['seed_presite_ai_run', 'seed_presite_draft', 15],
      ['seed_presite_draft', 'render_presite', 16],
      ['render_presite', 'verify_presite', 17],
    ];
    for (const [from, to, index] of transitions) {
      expect(nextStepFor('pre_site_visit', from)).toEqual({ step: to, index });
    }
    expect(nextStepFor('pre_site_visit', 'verify_presite')).toBeNull();
  });
});

// Slice 4b: only verify_presite may markReady for pre_site_visit; the other
// three new steps must always advance (never terminal, never call
// ledger.markReady). Source-inspection check, same style as 4a's
// "stepVerifyReviews is wired through nextStepFor" test above -- a full
// behavioral drive of all four steps lives in
// tests/unit/presite-sandbox-deps.test.js and
// test-request-run-runner-verify-reviews.test.js's behavioral carry-over.
describe('slice 4b: verify_presite is the only markReady in the pre_site_visit recipe', () => {
  test('seed_presite_ai_run/seed_presite_draft/render_presite never call ledger.markReady; verify_presite does', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'lib', 'services', 'test-requests', 'run-runner.js'),
      'utf8',
    );
    function bodyOf(name, nextName) {
      const start = source.indexOf(`async function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = source.indexOf(`\nasync function ${nextName}(`, start);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    }
    expect(bodyOf('stepSeedPresiteAiRun', 'stepSeedPresiteDraft')).not.toMatch(/ledger\.markReady/);
    expect(bodyOf('stepSeedPresiteDraft', 'stepRenderPresite')).not.toMatch(/ledger\.markReady/);
    expect(bodyOf('stepRenderPresite', 'stepVerifyPresite')).not.toMatch(/ledger\.markReady/);
    const verifyStart = source.indexOf('async function stepVerifyPresite(');
    const verifyEnd = source.indexOf('\n// Slice 6a\'s `recipe_step_not_built`', verifyStart);
    expect(verifyEnd).toBeGreaterThan(verifyStart);
    expect(source.slice(verifyStart, verifyEnd)).toMatch(/ledger\.markReady/);
  });
});

// Slice 4a: verify_reviews must ADVANCE when it is not its recipe's last
// step, exactly mirroring verify/verify_initial_assessment, so a later
// cumulative recipe (pre_site_visit and beyond) can continue past it. No
// such recipe has a built RECIPE_STEP_ORDER entry yet, so this proves the
// generic mechanism (shared by all three verifiers) with a synthetic order
// injected through nextStepFor's optional third argument -- the one clean
// seam into the frozen, module-internal RECIPE_STEP_ORDER (see nextStepFor's
// own doc comment).
describe('slice 4a: nextStepFor advance-vs-markReady mechanism (verify_reviews\'s new branch)', () => {
  const SYNTHETIC_ORDERS = Object.freeze({
    reviews: Object.freeze([...RECIPE_STEP_ORDER.reviews]), // real 'reviews': verify_reviews stays terminal
    pre_site_visit: Object.freeze([...RECIPE_STEP_ORDER.reviews, 'seed_presite_ai_run']), // synthetic: verify_reviews is NOT last
  });

  test('terminal branch: real "reviews" order has verify_reviews last -> null (markReady)', () => {
    expect(nextStepFor('reviews', 'verify_reviews', SYNTHETIC_ORDERS)).toBeNull();
  });

  test('advance branch: a synthetic cumulative order continuing past verify_reviews -> the next step', () => {
    expect(nextStepFor('pre_site_visit', 'verify_reviews', SYNTHETIC_ORDERS))
      .toEqual({ step: 'seed_presite_ai_run', index: RECIPE_STEP_ORDER.reviews.length });
  });

  test('the optional third argument defaults to the real, frozen RECIPE_STEP_ORDER (no production call site passes it)', () => {
    expect(nextStepFor('reviews', 'verify_reviews')).toBeNull();
    expect(nextStepFor('basic', 'verify')).toBeNull();
  });

  // Structural, source-inspection check: no real later recipe exists yet
  // (4b builds pre_site_visit's steps), so stepVerifyReviews's OWN
  // advance-vs-markReady wiring cannot be driven behaviorally through
  // advanceRun with real data in this slice -- the nextStepFor tests above
  // prove the shared mechanism, but not that stepVerifyReviews actually
  // calls it instead of unconditionally marking ready. This proves the
  // wiring itself: stepVerifyReviews's terminal branch is now the SAME
  // `nextStepFor(...) === null ? markReady : advance` shape as
  // stepVerify/stepVerifyInitialAssessment, not the old "must be terminal or
  // throw" code.
  test('stepVerifyReviews is wired through nextStepFor + completeCurrentStep, not an unconditional markReady', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'lib', 'services', 'test-requests', 'run-runner.js'),
      'utf8',
    );
    const start = source.indexOf('async function stepVerifyReviews(');
    const end = source.indexOf('\nfunction notBuiltStep', start);
    const body = source.slice(start, end);
    expect(body).toMatch(/nextStepFor\(run\.recipe,\s*VERIFY_REVIEWS_STEP\)\s*===\s*null/);
    expect(body).toMatch(/completeCurrentStep\(ledger,\s*run,\s*VERIFY_REVIEWS_STEP/);
    expect(body).not.toMatch(/must be the terminal step/);
  });
});

describe('slice 6c-i: verify_initial_assessment terminal branch is per-recipe', () => {
  // The full behavioral test (markReady vs. advance, driven through a real
  // stepVerifyInitialAssessment happy path) lives in
  // test-request-run-runner-verify-initial-assessment.test.js. This pins the
  // `nextStepFor` fact that terminal branch is keyed on: the two recipes
  // disagree at the shared step name.
  test('initial_assessment: verify_initial_assessment has no next step (must markReady)', () => {
    expect(nextStepFor('initial_assessment', 'verify_initial_assessment')).toBeNull();
  });

  test('reviews: verify_initial_assessment advances to seed_reviewers (must NOT markReady)', () => {
    expect(nextStepFor('reviews', 'verify_initial_assessment')).toEqual({ step: 'seed_reviewers', index: 10 });
  });
});

// slice 6c-ii Stage C: copy_review_file and verify_reviews are both built.
// See test-request-run-runner-copy-review-file.test.js and
// test-request-run-runner-verify-reviews.test.js for their own coverage.

describe('P1-b: recipeIncludesStep / recipeLeaseSeconds', () => {
  it('recipeIncludesStep reports whether a step is in the recipe order', () => {
    expect(recipeIncludesStep('basic', 'seed_initial_assessment')).toBe(false);
    expect(recipeIncludesStep('initial_assessment', 'seed_initial_assessment')).toBe(true);
    expect(recipeIncludesStep('reviews', 'seed_initial_assessment')).toBe(true);
    expect(recipeIncludesStep('reviews', 'seed_reviewers')).toBe(true);
    expect(recipeIncludesStep('basic', 'seed_reviewers')).toBe(false);
  });

  it('recipeIncludesStep fails closed on an unrecognized recipe', () => {
    expect(() => recipeIncludesStep('nonexistent_recipe', 'fence_source')).toThrow('Unknown Test Request Factory recipe');
  });

  it.each([
    ['basic', 300],
    ['initial_assessment', 900],
    ['reviews', 900],
  ])('recipeLeaseSeconds(%s) is %i', (recipe, seconds) => {
    expect(recipeLeaseSeconds(recipe)).toBe(seconds);
  });
});
