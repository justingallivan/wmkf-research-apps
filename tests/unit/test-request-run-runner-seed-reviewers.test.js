/**
 * Test Request Factory slice 6c-ii Stage B — the `seed_reviewers` and
 * `seed_review_answers` step bodies (lib/services/test-requests/run-runner.js
 * `stepSeedReviewers` / `stepSeedReviewAnswers`).
 *
 * Uses a recording fake ledger (matching the frozen run-ledger.js contract,
 * extended with listRunReviewerAssignments/getRunReviewerAssignment) and a
 * mocked reviews-sandbox-deps.js (module-mocked, since run-runner.js builds
 * the deps internally rather than accepting them as an argument).
 *
 * @jest-environment node
 */
/* eslint-disable global-require */
jest.mock('../../lib/services/test-requests/reviews-sandbox-deps.js', () => ({
  createReviewsSandboxDeps: jest.fn(),
}));
// Opus round 2, P2: seed-synthetic-review.js's buildCompletionWrite is a real
// (pure) function called directly by run-runner.js, not injected through
// deps -- module-mocked here (real implementation by default, via
// jest.requireActual) so a single test can force it to throw exactly once,
// proving the changeset attempt marker is never written when the (pure)
// build itself fails.
jest.mock('../../lib/services/reviewer-engagement/seed-synthetic-review.js', () => {
  const actual = jest.requireActual('../../lib/services/reviewer-engagement/seed-synthetic-review.js');
  return { ...actual, buildCompletionWrite: jest.fn(actual.buildCompletionWrite) };
});

const { advanceRun } = require('../../lib/services/test-requests/run-runner.js');
const { MANIFEST_V4, sha256, computeRunPlanDigest } = require('../../lib/services/test-requests/basic-clone-steps.js');
const { createReviewsSandboxDeps } = require('../../lib/services/test-requests/reviews-sandbox-deps.js');
const { buildCompletionWrite } = require('../../lib/services/reviewer-engagement/seed-synthetic-review.js');
const { assertLedgerReceipt } = require('../../lib/services/test-requests/run-ledger.js');
const { REVIEW_FILE_COPY_POLICY, reviewFileCopyPolicyDigest } = require('../../lib/services/test-requests/review-file-copy.js');

// F2 (Codex slice 6c-ii Stage C round 1): every test in this file uses a
// single reviewer assignment (sequence 1) with this same fixed placeholder
// addressSha256 -- one shared constant so the manifest's bound planDigest
// and the fake ledger's returned assignment always agree.
const ADDRESS_SHA256 = 'a'.repeat(64);

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const APP_USER_ID = '55555555-5555-4555-8555-555555555555';
const ORG_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_PERSON_A = '77777777-7777-4777-8777-777777777771';
const DEST_PERSON_A = '88888888-8888-4888-8888-888888888881';
const SUGGESTION_A = '99999999-9999-4999-8999-999999999991';

function baseRun(bundleSha256, overrides = {}) {
  return {
    runId: RUN_ID,
    recipe: 'reviews',
    status: 'prepared',
    currentStep: 'seed_reviewers',
    stepIndex: 10,
    version: 1,
    leaseToken: null,
    leaseGeneration: 0,
    lockedUntil: null,
    createBodySha256: 'body-hash',
    bundleSha256,
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
    meetingDate: '2026-12-01',
    ...overrides,
  };
}

function baseManifest(bundleSha256, overrides = {}) {
  return {
    kind: MANIFEST_V4,
    recipe: 'reviews',
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: '2026-12-01' },
    source: { requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000, bundleSha256 },
    createBodySha256: 'body-hash',
    copyPolicy: { digest: 'policy-digest' },
    // F2: bound to the LIVE review-file copy policy (assertRunMatchesManifestAndBundle
    // checks this against reviewFileCopyPolicyDigest() directly, never against
    // a run-row column), so this must be the real function's output, not a placeholder.
    reviewFilePolicy: { version: REVIEW_FILE_COPY_POLICY.version, digest: reviewFileCopyPolicyDigest() },
    expectedRequestType: { value: 100000000 },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: ORG_ID },
    expectedGraphSiteId: 'site-1',
    expectedGraphDriveId: 'drive-1',
    ...overrides,
  };
}

/** Build a matched {run, manifest} pair whose bundleSha256 agrees with the given bundle's real digest. */
function runAndManifestFor(bundle, runOverrides = {}, manifestOverrides = {}) {
  const digest = sha256(bundle);
  const manifest = baseManifest(digest, manifestOverrides);
  // F2: the pre-lease check recomputes planDigest from the manifest plus
  // the ledger's own reviewer-assignment addressSha256 values; every test
  // in this file uses the single ADDRESS_SHA256 assignment (sequence 1), so
  // that is the default here too.
  const planDigest = computeRunPlanDigest({ manifest, reviewerAddressDigests: [ADDRESS_SHA256] });
  return { run: baseRun(digest, { planDigest, ...runOverrides }), manifest };
}

function bundleWithOneReviewer(overrides = {}) {
  return {
    reviewers: [
      {
        suggestionId: 'source-suggestion-1',
        personId: SOURCE_PERSON_A,
        person: {
          wmkf_name: 'Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
          wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University',
          wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
        },
        personIsSynthetic: false,
        suggestion: {
          wmkf_suggestionlabel: 'Auto', wmkf_programarea: null, wmkf_relevancescore: null, wmkf_matchreason: null,
          wmkf_sources: null, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_declined: false,
          wmkf_responsetype: null, wmkf_emailsentat: null, wmkf_responsereceivedat: null, wmkf_materialssentat: null,
          wmkf_reviewreceivedat: '2026-01-10T00:00:00Z', wmkf_completedat: '2026-01-10T00:00:00Z',
          wmkf_thankyousentat: null, wmkf_reviewstatus: 100000001, wmkf_revieweraffiliation: null,
          wmkf_reviewuploadedbystaff: false, wmkf_reviewerfirstname: null, wmkf_reviewerlastname: null,
          wmkf_reviewernickname: null, wmkf_reviewertitle: null, wmkf_applicantdisposition: null,
        },
        answers: [
          {
            wmkf_questionkey: 'riskLevel', wmkf_questionorder: 1, wmkf_questiontext: 'Risk?', wmkf_questiontype: 'picklist',
            wmkf_answerhtml: null, wmkf_answertext: 'Low', wmkf_answervalue: 1, wmkf_answervalues: null, wmkf_questionoptions: null,
          },
        ],
        reviewForm: 'uploaded',
        files: [],
        ...overrides.reviewer,
      },
    ],
  };
}

/** Recording fake ledger extended with the reviewer-assignment reads. */
function createFakeLedger(initialRun, { assignments = [] } = {}) {
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
    async releaseLease({ leaseToken, leaseGeneration }) {
      calls.push({ op: 'releaseLease', leaseToken, leaseGeneration });
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
    async markReady() {
      throw new Error('markReady must never be called by seed_reviewers/seed_review_answers');
    },
    async markNeedsAttention({ leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      calls.push({ op: 'markNeedsAttention', reason: reason?.code ?? reason });
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, status: 'needs_attention', needsAttentionReason: reason?.code ?? reason, lastError: error ?? run.lastError ?? null, leaseToken: null, lockedUntil: null, version: run.version + 1 };
      return { ...run };
    },
    async journalPlannedResource({ step, resourceKind, system, plannedIdentity }) {
      assertLedgerReceipt(plannedIdentity, 'plannedIdentity');
      const resource = { resourceId: nextResourceId++, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
      assertLedgerReceipt(readback, 'readback');
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.readback = { ...(resource.readback || {}), ...(readback || {}) };
      resource.outcome = outcome;
      resource.responseStatus = responseStatus;
      calls.push({ op: 'recordResourceReadback', resourceId, outcome, readback });
      return { ...resource };
    },
    async recordResourceFailure({ resourceId, outcome, error }) {
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.outcome = outcome;
      resource.error = error?.code ?? error;
      calls.push({ op: 'recordResourceFailure', resourceId, outcome, error: error?.code ?? error });
      return { ...resource };
    },
    async listRunResources() {
      return resources.map((row) => ({ ...row }));
    },
    async listRunReviewerAssignments() {
      return assignments.map(({ address, ...rest }) => ({ ...rest }));
    },
    async getRunReviewerAssignment(_runId, sequence) {
      return assignments.find((a) => a.sequence === sequence) || null;
    },
  };
  return {
    ledger, calls, getRun: () => run, getResources: () => resources,
  };
}

const client = { baseUrl: 'https://sandbox.crm.dynamics.com/api/data/v9.2' };

beforeEach(() => {
  createReviewsSandboxDeps.mockReset();
});

/** The row a correctly created/reused synthetic person reads back as (full projection, marker, active, Contact-less). */
function ownedSyntheticRow(over = {}) {
  return {
    wmkf_potentialreviewersid: DEST_PERSON_A,
    wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
    wmkf_emailaddress: 'throwaway@example.test',
    wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
    wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
    wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
    ...over,
  };
}

describe('stepSeedReviewers: fresh person + suggestion (reused: false)', () => {
  it('happy path: creates the person then the suggestion, and advances (single reviewer)', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const createPerson = jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A }));
    const createSuggestion = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      createSuggestion,
      getPersonById: jest.fn(async () => ownedSyntheticRow()),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { akoya_requestnum: '1000', akoya_title: 'x', wmkf_meetingdate: '2026-12-01' }, text: '' }));

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });

    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('copy_review_file');
    expect(createPerson).toHaveBeenCalledTimes(1);
    expect(createPerson.mock.calls[0][0].wmkf_potentialreviewersid).toBe(DEST_PERSON_A);
    expect(createPerson.mock.calls[0][0].wmkf_issyntheticreviewer).toBe(true);
    expect(createSuggestion).toHaveBeenCalledTimes(1);
    const suggestionBody = createSuggestion.mock.calls[0][0];
    expect(suggestionBody['wmkf_PotentialReviewer@odata.bind']).toBe(`/wmkf_potentialreviewerses(${DEST_PERSON_A})`);
    expect(suggestionBody['wmkf_Request@odata.bind']).toBe(`/akoya_requests(${REQUEST_ID})`);
    const suggestionResource = result.resources.find((r) => r.resourceKind === 'dataverse_reviewer_suggestion');
    expect(suggestionResource.outcome).toBe('verified');
    expect(calls.filter((c) => c.op === 'markReady')).toHaveLength(0);
  });

  it('alternate-key conflict on the person create stops the run with reviewer_person_conflict', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const conflictError = Object.assign(new Error('duplicate alternate key'), { status: 409 });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(async () => { throw conflictError; }),
      getPersonById: jest.fn(),
      createSuggestion: jest.fn(),
      getSuggestionById: jest.fn(),
    });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_person_conflict');
    expect(calls.some((c) => c.op === 'recordResourceFailure' && c.error === 'reviewer_person_conflict')).toBe(true);
  });

  it('dispatch-marker rule: a resource with a prior create attempt never re-POSTs, recovers by GUID', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    // Pre-seed a resource with a dispatched-but-unconfirmed create attempt by
    // driving journalPlannedResource + recordResourceReadback directly before
    // the real advanceRun call runs (simulating a crash between POST and readback).
    const preResource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: ADDRESS_SHA256 },
    });
    await ledger.recordResourceReadback({
      resourceId: preResource.resourceId, readback: { personCreateAttemptedAt: '2026-01-01T00:00:00Z' }, outcome: 'dispatched',
    });
    const createPerson = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      getPersonById: jest.fn(async () => ownedSyntheticRow()),
      createSuggestion: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    // Re-drive using the SAME ledger instance that has the pre-seeded resource:
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(createPerson).not.toHaveBeenCalled();
    expect(result.outcome).toBe('advanced');
  });
});

describe('stepSeedReviewers: create readback ownership (Codex slice round 3)', () => {
  const bundle = bundleWithOneReviewer();
  const { run, manifest } = runAndManifestFor(bundle);
  const assignments = () => [{
    sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
    addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
  }];
  const badRows = [
    ['wrong address', ownedSyntheticRow({ wmkf_emailaddress: 'someone-else@example.test' }), 'reviewer_person_projection_drift'],
    ['Contact-linked', ownedSyntheticRow({ _wmkf_contact_value: '11111111-1111-4111-8111-111111111111' }), 'reviewer_person_not_synthetic'],
    ['inactive', ownedSyntheticRow({ statecode: 1 }), 'reviewer_person_not_synthetic'],
    ['projection drift', ownedSyntheticRow({ wmkf_areaofexpertise: 'DRIFTED' }), 'reviewer_person_projection_drift'],
  ];

  it.each(badRows)('after a successful POST, a %s row at the preallocated GUID is refused, the resource stays dispatched, no suggestion is created', async (_label, row, code) => {
    const { ledger } = createFakeLedger(run, { assignments: assignments() });
    const createPerson = jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A }));
    const createSuggestion = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson, createSuggestion, getPersonById: jest.fn(async () => row), getSuggestionById: jest.fn(),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    const result = await advanceRun({ runId: RUN_ID, ledger, manifest, bundle, deps: { client, graph: {}, sharePointTarget: () => ({}) } });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe(code);
    expect(createPerson).toHaveBeenCalledTimes(1);
    expect(createSuggestion).not.toHaveBeenCalled();
    const personResource = (await ledger.listRunResources()).find((r) => r.resourceKind === 'dataverse_potential_reviewer');
    expect(personResource.outcome).toBe('dispatched');
  });

  it.each(badRows)('dispatch-marker recovery of a %s row is refused without re-POSTing', async (_label, row, code) => {
    const { ledger } = createFakeLedger(run, { assignments: assignments() });
    const preResource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: ADDRESS_SHA256 },
    });
    await ledger.recordResourceReadback({ resourceId: preResource.resourceId, readback: { personCreateAttemptedAt: '2026-01-01T00:00:00Z' }, outcome: 'dispatched' });
    const createPerson = jest.fn();
    const createSuggestion = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson, createSuggestion, getPersonById: jest.fn(async () => row), getSuggestionById: jest.fn(),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    const result = await advanceRun({ runId: RUN_ID, ledger, manifest, bundle, deps: { client, graph: {}, sharePointTarget: () => ({}) } });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe(code);
    expect(createPerson).not.toHaveBeenCalled();
    expect(createSuggestion).not.toHaveBeenCalled();
    const personResource = (await ledger.listRunResources()).find((r) => r.resourceKind === 'dataverse_potential_reviewer');
    expect(personResource.outcome).toBe('dispatched');
  });
});

describe('stepSeedReviewers: a journaled (terminal) person receipt is re-asserted on resume (Codex reviewer-differs-from-author round)', () => {
  const bundle = bundleWithOneReviewer();
  const { run, manifest } = runAndManifestFor(bundle);
  const assignments = () => [{
    sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
    addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
  }];
  it.each([
    ['inactive', ownedSyntheticRow({ statecode: 1 }), 'reviewer_person_not_synthetic'],
    ['Contact-linked', ownedSyntheticRow({ _wmkf_contact_value: '11111111-1111-4111-8111-111111111111' }), 'reviewer_person_not_synthetic'],
    ['projection-drifted', ownedSyntheticRow({ wmkf_emailaddress: 'someone-else@example.test' }), 'reviewer_person_projection_drift'],
  ])('a row that became %s after the person receipt was written is refused before the suggestion is created', async (_label, rowNow, code) => {
    const { ledger } = createFakeLedger(run, { assignments: assignments() });
    const preResource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: ADDRESS_SHA256 },
    });
    await ledger.recordResourceReadback({ resourceId: preResource.resourceId, readback: { destinationPersonId: DEST_PERSON_A }, outcome: 'verified' });
    const createPerson = jest.fn();
    const createSuggestion = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson, createSuggestion, getPersonById: jest.fn(async () => rowNow), getSuggestionById: jest.fn(),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    const result = await advanceRun({ runId: RUN_ID, ledger, manifest, bundle, deps: { client, graph: {}, sharePointTarget: () => ({}) } });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe(code);
    expect(createPerson).not.toHaveBeenCalled();
    expect(createSuggestion).not.toHaveBeenCalled();
  });
});

describe('stepSeedReviewers: reused person (reused: true)', () => {
  const bundle = bundleWithOneReviewer();
  const { run, manifest } = runAndManifestFor(bundle);

  it('happy path: re-verifies marker/active/no-contact/projection, journals recovered, never creates', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger } = createFakeLedger(run, { assignments });
    const createPerson = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A,
        wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
        wmkf_emailaddress: 'throwaway@example.test',
        wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
        wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(createPerson).not.toHaveBeenCalled();
    const personResource = result.resources.find((r) => r.resourceKind === 'dataverse_potential_reviewer');
    expect(personResource.outcome).toBe('recovered');
    expect(result.outcome).toBe('advanced');
  });

  it('refuses reuse of a row whose marker is not true (reviewer_person_not_synthetic)', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(),
      getPersonById: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_issyntheticreviewer: false })),
      createSuggestion: jest.fn(),
      getSuggestionById: jest.fn(),
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_person_not_synthetic');
  });

  it('refuses reuse of a row whose projection has drifted (reviewer_person_projection_drift)', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(),
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test',
        wmkf_areaofexpertise: 'DRIFTED FIELD', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
        wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion: jest.fn(),
      getSuggestionById: jest.fn(),
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_person_projection_drift');
  });

  it('a lease_lost is reported when the lease is lost before the person resource can be completed', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(),
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: 'Genomics',
        wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology',
        wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    // Steal the lease right after the person resource is journaled recovered,
    // simulating a concurrent worker taking over between the person and
    // suggestion phases of the same --advance call.
    const originalRecordResourceReadback = ledger.recordResourceReadback;
    let stolen = false;
    ledger.recordResourceReadback = async (args) => {
      const result = await originalRecordResourceReadback(args);
      if (!stolen && args.outcome === 'recovered') {
        stolen = true;
        const current = await ledger.getRun(RUN_ID);
        await ledger.releaseLease({ runId: RUN_ID, leaseToken: current.leaseToken, leaseGeneration: current.leaseGeneration });
      }
      return result;
    };

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('lease_lost');
  });
});

describe('stepSeedReviewAnswers', () => {
  async function seededLedger(assignments, { reviewForm = 'uploaded', answers } = {}) {
    const bundle = bundleWithOneReviewer({ reviewer: { reviewForm, ...(answers !== undefined ? { answers } : {}) } });
    const { run, manifest } = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 });
    const { ledger, calls } = createFakeLedger(run, { assignments });
    // Pre-seed the seed_reviewers suggestion resource as already verified.
    const resource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
    });
    await ledger.recordResourceReadback({ resourceId: resource.resourceId, readback: { suggestionId: SUGGESTION_A }, outcome: 'verified' });
    // Stage C: an `uploaded` review's completion write now reads its file
    // pointers off copy_review_file's own journaled folder resource, so
    // seededLedger pre-seeds that resource exactly as a completed
    // copy_review_file step would have left it, and client.get answers the
    // (now lazily-called) getRequest read stepSeedReviewAnswers needs to
    // reconstruct the full wmkf_reviewsharepointfolder path.
    client.get = jest.fn(async () => ({
      ok: true, status: 200, body: { akoya_requestnum: '1000', akoya_requestid: REQUEST_ID, wmkf_meetingdate: '2026-12-01' }, text: '',
    }));
    if (reviewForm === 'uploaded') {
      const folderResource = await ledger.journalPlannedResource({
        step: 'copy_review_file', resourceKind: 'sharepoint_folder', system: 'sharepoint',
        plannedIdentity: { assignmentSequence: 1, folder: `Reviewer_Uploads/reviewer_abcd1234/attempt_${'a'.repeat(32)}` },
      });
      await ledger.recordResourceReadback({
        resourceId: folderResource.resourceId, readback: { filename: 'Review_1.pdf' }, outcome: 'verified',
      });
    }
    return {
      ledger, bundle, run, manifest, calls,
    };
  }

  it('uploaded with answers: dispatches the atomic changeset with the copy_review_file-journaled pointers and records eTagBefore/eTagAfter/answerCount', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments);
    const runChangeset = jest.fn(async () => ({ ok: true }));
    const getSuggestionById = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(runChangeset).toHaveBeenCalledTimes(1);
    const ops = runChangeset.mock.calls[0][0];
    expect(ops).toHaveLength(2); // one answer + parent PATCH
    const parentOp = ops[ops.length - 1];
    expect(parentOp.body.wmkf_reviewsharepointfolder).toBe(
      `1000_${REQUEST_ID.replace(/-/g, '').toUpperCase()}/Reviewer_Uploads/reviewer_abcd1234/attempt_${'a'.repeat(32)}`,
    );
    expect(parentOp.body.wmkf_reviewfilename).toBe('Review_1.pdf');
    const answerResource = result.resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('verified');
    expect(answerResource.readback.answerCount).toBe(1);
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('verify_reviews');
  });

  it('uploaded review refuses reviews_verification_failed when copy_review_file has not journaled its pointers', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer({ reviewer: { reviewForm: 'uploaded' } });
    const { run, manifest } = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 });
    const { ledger } = createFakeLedger(run, { assignments });
    const resource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
    });
    await ledger.recordResourceReadback({ resourceId: resource.resourceId, readback: { suggestionId: SUGGESTION_A }, outcome: 'verified' });
    // Deliberately no copy_review_file folder resource.
    client.get = jest.fn(async () => ({
      ok: true, status: 200, body: { akoya_requestnum: '1000', akoya_requestid: REQUEST_ID, wmkf_meetingdate: '2026-12-01' }, text: '',
    }));
    createReviewsSandboxDeps.mockReturnValue({
      runChangeset: jest.fn(), getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviews_verification_failed');
  });

  it('unreceived: no changeset dispatched, answerCount 0', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments, { reviewForm: 'unreceived' });
    const runChangeset = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById: jest.fn() });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(runChangeset).not.toHaveBeenCalled();
    const answerResource = result.resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('verified');
    expect(answerResource.readback.answerCount).toBe(0);
  });

  it('received_no_file with zero answers: a single parent-only op through the same changeset transport', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments, { reviewForm: 'received_no_file', answers: [] });
    const runChangeset = jest.fn(async () => ({ ok: true }));
    createReviewsSandboxDeps.mockReturnValue({
      runChangeset, getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
    });
    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(runChangeset.mock.calls[0][0]).toHaveLength(1);
  });

  it('a changeset failure with no confirmed outcome stops the run with reviewer_answers_ambiguous', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments);
    createReviewsSandboxDeps.mockReturnValue({
      runChangeset: jest.fn(async () => { throw new Error('network blip'); }),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
  });

  it('missing suggestion resource (seed_reviewers never ran) refuses with reviewer_answers_ambiguous', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 });
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({ runChangeset: jest.fn(), getSuggestionById: jest.fn() });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
  });

  it('P2-1: a changeset resume with the marker set and wmkf_reviewreceivedat null ends reviewer_answers_ambiguous, runChangeset never called', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle } = await seededLedger(assignments);
    // Pre-seed the answers resource with a dispatched-but-unconfirmed changeset attempt.
    const resources = await ledger.listRunResources();
    const answerResource = resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    await ledger.journalPlannedResource({
      step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, reviewForm: 'uploaded', answerCount: 1 },
    });
    // Replace with a resource carrying the attempt marker (simulating a crash after dispatch, before readback).
    const preResources = await ledger.listRunResources();
    const planned = preResources[preResources.length - 1];
    await ledger.recordResourceReadback({
      resourceId: planned.resourceId, readback: { changesetAttemptedAt: '2026-01-01T00:00:00Z', eTagBefore: 'W/"1"' }, outcome: 'dispatched',
    });
    const runChangeset = jest.fn();
    const getSuggestionById = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, wmkf_reviewreceivedat: null, _etag: 'W/"2"' }));
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });

    const manifestForRun = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 }).manifest;
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest: manifestForRun, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
    expect(runChangeset).not.toHaveBeenCalled();
  });

  // F3 (Codex slice 6c-ii Stage C round 1), I6/I7, mutation M5: a post-
  // changeset readback with no eTag must never record `verified`. The
  // resource stays `dispatched` (attempt marker intact), the step throws
  // (run stops needs_attention with `reviewer_answers_ambiguous`), and the
  // NEXT advance takes the existing `changesetAttemptedAt` resume branch,
  // which repeats the readback ONLY (runChangeset is never called a second
  // time) and records `recovered` once it sees an eTag.
  it('F3: a verified-branch readback with no eTag stays dispatched and throws; the next advance resumes, repeats only the readback, and records recovered', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments);
    const runChangeset = jest.fn(async () => ({ ok: true }));
    const getSuggestionById = jest.fn()
      // Advance 1's guard read (before dispatch): a valid eTag.
      .mockResolvedValueOnce({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })
      // Advance 1's post-changeset readback: NO eTag (the F3 defect this guards against).
      .mockResolvedValueOnce({ wmkf_appreviewersuggestionid: SUGGESTION_A })
      // Advance 2's resume readback: now has an eTag AND wmkf_reviewreceivedat set.
      .mockResolvedValueOnce({ wmkf_appreviewersuggestionid: SUGGESTION_A, wmkf_reviewreceivedat: '2026-01-01T00:00:00Z', _etag: 'W/"2"' });
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });

    const first = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(first.outcome).toBe('needs_attention');
    expect(first.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
    const afterFirst = (await ledger.listRunResources()).find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(afterFirst.outcome).toBe('dispatched');
    expect(afterFirst.readback.changesetAttemptedAt).toBeTruthy();
    expect(afterFirst.readback.eTagAfter).toBeUndefined();
    expect(runChangeset).toHaveBeenCalledTimes(1);

    const second = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const answerResource = second.resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('recovered');
    expect(answerResource.readback.eTagAfter).toBe('W/"2"');
    // The changeset itself is never re-dispatched across the whole sequence.
    expect(runChangeset).toHaveBeenCalledTimes(1);
  });

  // F3, mutation M6: the resume branch reverted to `row._etag || undefined`
  // would silently record `recovered` with no eTag when the row has none.
  // Guarded here directly against a resume-state resource (no verified-
  // branch detour needed): a readback with `wmkf_reviewreceivedat` set but
  // no `_etag` must stay `dispatched` and throw, never record `recovered`.
  it('F3 (M6 guard): a resume-branch readback with wmkf_reviewreceivedat set but no eTag stays dispatched, never recovered, runChangeset never called', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle } = await seededLedger(assignments);
    // Pre-seed the answers resource with a dispatched-but-unconfirmed changeset attempt.
    await ledger.journalPlannedResource({
      step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, reviewForm: 'uploaded', answerCount: 1 },
    });
    const preResources = await ledger.listRunResources();
    const planned = preResources[preResources.length - 1];
    await ledger.recordResourceReadback({
      resourceId: planned.resourceId, readback: { changesetAttemptedAt: '2026-01-01T00:00:00Z', eTagBefore: 'W/"1"' }, outcome: 'dispatched',
    });
    const runChangeset = jest.fn();
    // wmkf_reviewreceivedat IS set (so this is not the P2-1 ambiguous-receivedat
    // case above) but the row carries no _etag at all.
    const getSuggestionById = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, wmkf_reviewreceivedat: '2026-01-01T00:00:00Z' }));
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });

    const manifestForRun = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 }).manifest;
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest: manifestForRun, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
    expect(runChangeset).not.toHaveBeenCalled();
    const answerResource = (await ledger.listRunResources()).find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('dispatched');
  });

  it('a lease_lost is reported when the lease is lost before the answers resource can be completed', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle } = await seededLedger(assignments);
    const runChangeset = jest.fn(async () => ({ ok: true }));
    const getSuggestionById = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });
    // Steal the lease between claim and completion by claiming it a second
    // time out from under the run (simulated: bump the run's lease directly).
    const originalRecordResourceReadback = ledger.recordResourceReadback;
    let stolen = false;
    ledger.recordResourceReadback = async (args) => {
      if (!stolen && args.readback && 'answerCount' in (args.readback || {})) {
        stolen = true;
        await ledger.releaseLease({ runId: RUN_ID, leaseToken: (await ledger.getRun(RUN_ID)).leaseToken, leaseGeneration: (await ledger.getRun(RUN_ID)).leaseGeneration });
      }
      return originalRecordResourceReadback(args);
    };
    const manifestForRun = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 }).manifest;
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest: manifestForRun, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('lease_lost');
  });

  it('Opus round 2, P2: buildCompletionWrite throwing (malformed answer JSON) before the changeset marker leaves no marker; the next --advance dispatches once', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const { ledger, bundle, manifest } = await seededLedger(assignments);
    const runChangeset = jest.fn(async () => ({ ok: true }));
    const getSuggestionById = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({ runChangeset, getSuggestionById });
    // Simulate the real failure mode (a malformed wmkf_answervalues JSON
    // string in the bundle: seed-synthetic-review.js#parseBundleJsonField
    // throws) without needing to actually corrupt the fixture -- the pure
    // build is module-mocked to throw exactly once, then falls back to the
    // real implementation.
    buildCompletionWrite.mockImplementationOnce(() => {
      throw new Error('seed-synthetic-review: bundle wmkf_answervalues is not valid JSON.');
    });

    const first = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(first.outcome).toBe('needs_attention');
    expect(runChangeset).not.toHaveBeenCalled();
    const resourcesAfterFailure = await ledger.listRunResources(RUN_ID);
    const answerResourceAfterFailure = resourcesAfterFailure.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResourceAfterFailure?.readback?.changesetAttemptedAt).toBeUndefined();

    const second = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(second.outcome).toBe('advanced');
    expect(runChangeset).toHaveBeenCalledTimes(1);
    const answerResource = second.resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('verified');
  });
});

describe('P2-1: attempt markers are journaled BEFORE their dispatch, proven on one shared call log', () => {
  it('person: recordResourceReadback(personCreateAttemptedAt, dispatched) precedes createPerson', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const createPerson = jest.fn(async () => {
      calls.push({ op: 'createPerson' });
      return { wmkf_potentialreviewersid: DEST_PERSON_A };
    });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      getPersonById: jest.fn(async () => ownedSyntheticRow()),
      createSuggestion: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const markerIndex = calls.findIndex((c) => c.op === 'recordResourceReadback' && c.readback?.personCreateAttemptedAt && c.outcome === 'dispatched');
    const createIndex = calls.findIndex((c) => c.op === 'createPerson');
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(markerIndex);
  });

  it('mutation guard: deleting personCreateAttemptedAt from the marker readback is caught (dispatched marker must carry it)', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A })),
      getPersonById: jest.fn(async () => ownedSyntheticRow()),
      createSuggestion: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const markerCall = calls.find((c) => c.op === 'recordResourceReadback' && c.readback?.personCreateAttemptedAt);
    expect(markerCall).toBeDefined();
    expect(markerCall.outcome).toBe('dispatched');
  });

  it('suggestion: recordResourceReadback(suggestionCreateAttemptedAt, dispatched) precedes createSuggestion', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const createSuggestion = jest.fn(async () => {
      calls.push({ op: 'createSuggestion' });
      return { wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' };
    });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(),
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: 'Genomics',
        wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology',
        wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion,
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const markerIndex = calls.findIndex((c) => c.op === 'recordResourceReadback' && c.readback?.suggestionCreateAttemptedAt && c.outcome === 'dispatched');
    const createIndex = calls.findIndex((c) => c.op === 'createSuggestion');
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(markerIndex);
  });

  it('changeset: recordResourceReadback(changesetAttemptedAt, dispatched) precedes runChangeset', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer({ reviewer: { reviewForm: 'received_no_file', answers: [], files: [] } });
    const { run, manifest } = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 });
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const resource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
    });
    await ledger.recordResourceReadback({ resourceId: resource.resourceId, readback: { suggestionId: SUGGESTION_A }, outcome: 'verified' });
    const runChangeset = jest.fn(async () => {
      calls.push({ op: 'runChangeset' });
      return { ok: true };
    });
    createReviewsSandboxDeps.mockReturnValue({
      runChangeset, getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' })),
    });
    await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    const markerIndex = calls.findIndex((c) => c.op === 'recordResourceReadback' && c.readback?.changesetAttemptedAt && c.outcome === 'dispatched');
    const dispatchIndex = calls.findIndex((c) => c.op === 'runChangeset');
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(dispatchIndex).toBeGreaterThan(markerIndex);
  });
});

describe('P2-1: suggestion ambiguous-recovery covers both the owned and not-owned outcomes', () => {
  it('owned path: create throws, the row exists and IS owned -> recovers to verified without re-dispatch', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    const createSuggestion = jest.fn(async () => { throw new Error('transient network blip'); });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(),
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: 'Genomics',
        wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology',
        wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion,
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    // reused: true for this assignment so createPerson is never reached; use
    // a reused assignment instead to isolate the suggestion path.
    assignments[0].reused = true;
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(createSuggestion).toHaveBeenCalledTimes(1);
    const suggestionResource = result.resources.find((r) => r.resourceKind === 'dataverse_reviewer_suggestion');
    expect(suggestionResource.outcome).toBe('verified');
    expect(result.outcome).toBe('advanced');
  });

  it('not-owned path: create throws, the row exists but is bound to a DIFFERENT person -> reviewer_suggestion_present_not_owned', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    const createSuggestion = jest.fn(async () => { throw new Error('transient network blip'); });
    createReviewsSandboxDeps.mockReturnValue({
      getPersonById: jest.fn(async () => ({
        wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: 'Genomics',
        wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology',
        wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University',
        wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: null,
      })),
      createSuggestion,
      // Row exists but bound to a DIFFERENT person than destinationPersonId.
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: '00000000-0000-4000-8000-000000000000', _wmkf_request_value: REQUEST_ID })),
    });
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_suggestion_present_not_owned');
  });

  it('resume after reviewer_person_conflict re-reports reviewer_person_conflict, never ambiguous_create_outcome', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    // Pre-seed a person resource already marked rejected/reviewer_person_conflict
    // (simulating a prior --advance that hit the alternate-key conflict).
    const preResource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: ADDRESS_SHA256 },
    });
    await ledger.recordResourceReadback({ resourceId: preResource.resourceId, readback: { personCreateAttemptedAt: '2026-01-01T00:00:00Z' }, outcome: 'dispatched' });
    await ledger.recordResourceFailure({ resourceId: preResource.resourceId, outcome: 'rejected', error: Object.assign(new Error('conflict'), { code: 'reviewer_person_conflict' }) });
    const getPersonById = jest.fn(); // must never be consulted on resume of a rejected resource
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(), getPersonById, createSuggestion: jest.fn(), getSuggestionById: jest.fn(),
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_person_conflict');
    expect(getPersonById).not.toHaveBeenCalled();
  });
});

describe('Opus round 2, P2: destinationGrantCycleCode throwing before the suggestion marker leaves no marker', () => {
  it('seed_reviewers: a transient Request-read failure on the first --advance never journals suggestionCreateAttemptedAt; the next --advance dispatches once and ends verified', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    const createSuggestion = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A })),
      getPersonById: jest.fn(async () => ownedSyntheticRow()),
      createSuggestion,
      getSuggestionById: jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_potentialreviewer_value: DEST_PERSON_A, _wmkf_request_value: REQUEST_ID })),
    });
    // First --advance: the destination Request read (destinationGrantCycleCode,
    // via client.get) fails transiently. The person create/verify has already
    // committed by the time this throws (person resolution runs first).
    client.get = jest.fn(async () => { throw new Error('transient Dataverse read failure'); });

    const first = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(first.outcome).toBe('needs_attention');
    expect(createSuggestion).not.toHaveBeenCalled();
    const resourcesAfterFailure = await ledger.listRunResources(RUN_ID);
    const suggestionResourceAfterFailure = resourcesAfterFailure.find((r) => r.resourceKind === 'dataverse_reviewer_suggestion');
    expect(suggestionResourceAfterFailure?.readback?.suggestionCreateAttemptedAt).toBeUndefined();

    // Second --advance, same ledger/resources: the read now succeeds.
    client.get = jest.fn(async () => ({ ok: true, status: 200, body: { wmkf_meetingdate: '2026-12-01' }, text: '' }));
    const second = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(second.outcome).toBe('advanced');
    expect(createSuggestion).toHaveBeenCalledTimes(1);
    const suggestionResource = second.resources.find((r) => r.resourceKind === 'dataverse_reviewer_suggestion');
    expect(suggestionResource.outcome).toBe('verified');
  });
});

describe('Opus round 2, P3: the person read-back before verified is proven, not assumed', () => {
  it('createPerson succeeds but the read-back row is missing -> ambiguous_create_outcome, never verified', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A })),
      // The create "succeeded" but the row cannot be read back at all.
      getPersonById: jest.fn(async () => null),
      createSuggestion: jest.fn(),
      getSuggestionById: jest.fn(),
    });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
    const resources = await ledger.listRunResources(RUN_ID);
    const personResource = resources.find((r) => r.resourceKind === 'dataverse_potential_reviewer');
    expect(personResource.outcome).toBe('ambiguous');
    expect(personResource.outcome).not.toBe('verified');
  });

  it('createPerson succeeds but the read-back row has the marker false -> ambiguous_create_outcome, never verified', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: ADDRESS_SHA256, address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    createReviewsSandboxDeps.mockReturnValue({
      createPerson: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A })),
      // The row exists at the preallocated GUID, but is not marked synthetic --
      // e.g. a real reviewer already occupies this id, or the write silently
      // failed to set the marker. Either way, never trust it as verified.
      getPersonById: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_issyntheticreviewer: false })),
      createSuggestion: jest.fn(),
      getSuggestionById: jest.fn(),
    });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client, graph: {}, sharePointTarget: () => ({}) },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('ambiguous_create_outcome');
    const resources = await ledger.listRunResources(RUN_ID);
    const personResource = resources.find((r) => r.resourceKind === 'dataverse_potential_reviewer');
    expect(personResource.outcome).toBe('ambiguous');
    expect(personResource.outcome).not.toBe('verified');
  });
});
