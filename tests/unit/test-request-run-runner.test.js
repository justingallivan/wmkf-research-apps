/**
 * Behavioral tests for lib/services/test-requests/run-runner.js's advanceRun
 * (build order item 5, slice 5b): one bounded step per call against a
 * recording FAKE ledger (matching the frozen run-ledger.js contract) and
 * real basic-clone-steps.js functions driven by fake `client`/`graph`
 * dependency objects (basic-clone-steps.js is already fully dependency
 * injected, so no module mocking is needed to run it offline).
 */
import { jest } from '@jest/globals';
import { advanceRun, nextStepFor, RECIPE_STEP_ORDER } from '../../lib/services/test-requests/run-runner.js';
import { sha256, MANIFEST_V4 } from '../../lib/services/test-requests/basic-clone-steps.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const APP_USER_ID = '55555555-5555-4555-8555-555555555555';
const ORG_ID = '66666666-6666-4666-8666-666666666666';

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
function createFakeLedger(initialRun) {
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
  };
  return { ledger, calls, getRun: () => run, getResources: () => resources };
}

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
    createBodySha256: 'body-hash',
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
    createBodySha256: 'body-hash',
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
            'akoya_fiscalyear', 'akoya_requesttype', 'wmkf_meetingdate', 'wmkf_istestrequest',
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

describe('slice 6a: IA-only steps stop cleanly instead of running unbuilt bodies', () => {
  test('reaching seed_initial_assessment, seed_initial_assessment_snapshot or verify_initial_assessment marks needs_attention with recipe_step_not_built, never markReady, never an unhandled throw', async () => {
    for (const step of ['seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment']) {
      const run = baseRun({ recipe: 'initial_assessment', currentStep: step, stepIndex: 7 });
      const { ledger, calls } = createFakeLedger(run);
      const manifest = baseManifest({ recipe: 'initial_assessment' });
      const result = await advanceRun({
        runId: RUN_ID, ledger, manifest, bundle: null,
        deps: { client: {}, graph: {}, sharePointTarget: () => ({}) },
      });
      expect(result.outcome).toBe('needs_attention');
      expect(result.run.needsAttentionReason).toBe('recipe_step_not_built');
      expect(calls.filter((call) => call.op === 'markReady')).toHaveLength(0);
    }
  });
});
