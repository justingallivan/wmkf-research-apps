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

const { advanceRun } = require('../../lib/services/test-requests/run-runner.js');
const { MANIFEST_V4, sha256 } = require('../../lib/services/test-requests/basic-clone-steps.js');
const { createReviewsSandboxDeps } = require('../../lib/services/test-requests/reviews-sandbox-deps.js');

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
  return { run: baseRun(digest, runOverrides), manifest: baseManifest(digest, manifestOverrides) };
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
      const resource = { resourceId: nextResourceId++, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
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

describe('stepSeedReviewers: fresh person + suggestion (reused: false)', () => {
  it('happy path: creates the person then the suggestion, and advances (single reviewer)', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments });
    const createPerson = jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A }));
    const createSuggestion = jest.fn(async () => ({ wmkf_appreviewersuggestionid: SUGGESTION_A, _etag: 'W/"1"' }));
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      createSuggestion,
      getPersonById: jest.fn(),
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
    }];
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger } = createFakeLedger(run, { assignments });
    // Pre-seed a resource with a dispatched-but-unconfirmed create attempt by
    // driving journalPlannedResource + recordResourceReadback directly before
    // the real advanceRun call runs (simulating a crash between POST and readback).
    const preResource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_potential_reviewer', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, destinationPersonId: DEST_PERSON_A, sourcePersonId: SOURCE_PERSON_A, addressSha256: 'a'.repeat(64) },
    });
    await ledger.recordResourceReadback({
      resourceId: preResource.resourceId, readback: { personCreateAttemptedAt: '2026-01-01T00:00:00Z' }, outcome: 'dispatched',
    });
    const createPerson = jest.fn();
    createReviewsSandboxDeps.mockReturnValue({
      createPerson,
      getPersonById: jest.fn(async () => ({ wmkf_potentialreviewersid: DEST_PERSON_A, wmkf_issyntheticreviewer: true })),
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

describe('stepSeedReviewers: reused person (reused: true)', () => {
  const bundle = bundleWithOneReviewer();
  const { run, manifest } = runAndManifestFor(bundle);

  it('happy path: re-verifies marker/active/no-contact/projection, journals recovered, never creates', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: true,
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
        wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
});

describe('stepSeedReviewAnswers', () => {
  async function seededLedger(assignments, { reviewForm = 'uploaded', answers } = {}) {
    const bundle = bundleWithOneReviewer({ reviewer: { reviewForm, ...(answers !== undefined ? { answers } : {}) } });
    const { run, manifest } = runAndManifestFor(bundle, { currentStep: 'seed_review_answers', stepIndex: 12 });
    const { ledger } = createFakeLedger(run, { assignments });
    // Pre-seed the seed_reviewers suggestion resource as already verified.
    const resource = await ledger.journalPlannedResource({
      step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
      plannedIdentity: { assignmentSequence: 1, suggestionId: SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
    });
    await ledger.recordResourceReadback({ resourceId: resource.resourceId, readback: { suggestionId: SUGGESTION_A }, outcome: 'verified' });
    return {
      ledger, bundle, run, manifest,
    };
  }

  it('uploaded with answers: dispatches the atomic changeset with filePointers: null and records eTagBefore/eTagAfter/answerCount', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
    expect('wmkf_reviewsharepointfolder' in parentOp.body).toBe(false);
    const answerResource = result.resources.find((r) => r.resourceKind === 'dataverse_review_answer_set');
    expect(answerResource.outcome).toBe('verified');
    expect(answerResource.readback.answerCount).toBe(1);
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('verify_reviews');
  });

  it('unreceived: no changeset dispatched, answerCount 0', async () => {
    const assignments = [{
      sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false,
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
      addressSha256: 'a'.repeat(64), address: 'throwaway@example.test',
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
});
