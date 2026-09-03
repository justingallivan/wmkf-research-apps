/**
 * @jest-environment node
 */

const findReviewDocxBackfillPopulation = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findReviewDocxBackfillPopulation: (...args) => findReviewDocxBackfillPopulation(...args),
}));

const resolveReviewDocxTarget = jest.fn();
const planIndividualReviewFileCandidate = jest.fn();
const preflightReviewDocxWrite = jest.fn();
const ensureIndividualReviewFile = jest.fn();
jest.mock('../../lib/services/review-documents/individual-file-service', () => ({
  resolveReviewDocxTarget: (...args) => resolveReviewDocxTarget(...args),
  planIndividualReviewFileCandidate: (...args) => planIndividualReviewFileCandidate(...args),
  preflightReviewDocxWrite: (...args) => preflightReviewDocxWrite(...args),
  ensureIndividualReviewFile: (...args) => ensureIndividualReviewFile(...args),
}));

const {
  buildReviewDocxBackfillManifest,
  executeReviewDocxBackfill,
  isBlockingReviewDocxBackfillManifest,
  validateReviewDocxBackfillManifest,
} = require('../../lib/services/review-documents/backfill-service');

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const THIRD_ID = '44444444-4444-4444-8444-444444444444';
const TARGET = {
  siteUrl: 'https://appriver3651007194.sharepoint.com/sites/akoyaGO',
  siteId: 'site-1',
  driveId: 'drive-1',
  dynamicsBase: 'https://wmkf.crm.dynamics.com',
};

function eligiblePlan(suggestionId = FIRST_ID, overrides = {}) {
  return {
    suggestionId,
    suggestionEtag: 'W/"1"',
    sourceFingerprint: `source-${suggestionId}`,
    requestId: REQUEST_ID,
    requestNumber: '1002903',
    receivedAt: '2026-09-02T17:30:00.000Z',
    cycleCode: 'D26',
    selected: true,
    disposition: null,
    richTextPresent: true,
    status: 'eligible',
    expectedFolder: `1002903_${REQUEST_ID}/Reviews`,
    expectedFilename: `Review-1002903-Reviewer ${suggestionId.slice(0, 8)}.docx`,
    semanticHash: `gdc1:${suggestionId}`,
    item: null,
    semanticMatch: null,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveReviewDocxTarget.mockResolvedValue(TARGET);
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [{ wmkf_appreviewersuggestionid: FIRST_ID }],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id));
  preflightReviewDocxWrite.mockResolvedValue(TARGET);
  ensureIndividualReviewFile.mockResolvedValue({
    status: 'created',
    expectedFolder: eligiblePlan().expectedFolder,
    expectedFilename: eligiblePlan().expectedFilename,
    semanticHash: `gdc1:${FIRST_ID}`,
    item: { siteId: 'site-1', driveId: 'drive-1', id: 'item-1', name: eligiblePlan().expectedFilename },
  });
});

test('builds a redacted hash-bound dry-run manifest', async () => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    answers: [{ answerText: 'CONFIDENTIAL REVIEW ANSWER' }],
    generatedContent: 'CONFIDENTIAL DOCX BYTES',
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26',
    requestNumber: '1002903',
    observedAt: '2026-09-03T18:00:00.000Z',
  });

  expect(manifest).toMatchObject({
    artifactType: 'review_docx_sharepoint_backfill_v1',
    schemaVersion: 2,
    dryRun: true,
    scope: { cycleCode: 'D26', requestNumber: '1002903', excludedTestRequestNumbers: [] },
    target: {
      siteId: 'site-1', driveId: 'drive-1', dynamicsBase: 'https://wmkf.crm.dynamics.com',
    },
    summary: { population: 1, eligibleMissing: 1, blocking: 0 },
  });
  expect(manifest.populationDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(manifest)).not.toContain('CONFIDENTIAL REVIEW ANSWER');
  expect(JSON.stringify(manifest)).not.toContain('CONFIDENTIAL DOCX BYTES');
  expect(() => validateReviewDocxBackfillManifest(manifest)).not.toThrow();
  expect(resolveReviewDocxTarget).toHaveBeenCalledWith({ requireProductionDataverse: true });

  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.candidates[0].requestNumber = '9999999';
  expect(() => validateReviewDocxBackfillManifest(tampered)).toThrow('hash');
});

test('orders candidates by code-point keys independent of discovery order', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: SECOND_ID },
      { wmkf_appreviewersuggestionid: FIRST_ID },
    ],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    requestNumber: id === FIRST_ID ? '1000001' : '1000002',
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.candidates.map((candidate) => candidate.suggestionId))
    .toEqual([FIRST_ID, SECOND_ID]);
});

test('blocks two reviews that resolve to the same request-level filename', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: FIRST_ID },
      { wmkf_appreviewersuggestionid: SECOND_ID },
    ],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    expectedFilename: 'Review-1002903-Same Reviewer.docx',
  }));

  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });

  expect(manifest.summary.blocking).toBe(1);
  expect(manifest.anomalies).toContainEqual({
    code: 'duplicate_generated_paths',
    values: [`1002903_${REQUEST_ID}/reviews/review-1002903-same reviewer.docx`],
  });
});

test('rejects a capped discovery before planning candidates', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({ records: [], capped: true });
  await expect(buildReviewDocxBackfillManifest({ cycleCode: 'D26' }))
    .rejects.toThrow('5000-row cap');
  expect(planIndividualReviewFileCandidate).not.toHaveBeenCalled();
});

test('omits a row that became fully filed between discovery and planning', async () => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    status: 'already_filed',
    item: { siteId: 'site-1', driveId: 'drive-1', id: 'item-1', name: eligiblePlan(id).expectedFilename },
    semanticMatch: true,
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.candidates).toEqual([]);
  expect(manifest.summary).toMatchObject({ population: 0, blocking: 0 });
  expect(manifest.summary).not.toHaveProperty('alreadyFiled');
});

test('retains an operator-confirmed test request as a hash-bound nonblocking exclusion', async () => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    requestNumber: '1003223',
    status: 'invalid_snapshot',
    semanticHash: null,
    error: { code: 'invalid_snapshot', message: 'duplicate order' },
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26',
    excludedTestRequestNumbers: ['1003223'],
    observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.scope.excludedTestRequestNumbers).toEqual(['1003223']);
  expect(manifest.candidates[0]).toMatchObject({
    requestNumber: '1003223',
    eligibility: 'excluded_test_request',
    originalEligibility: 'invalid_snapshot',
    exclusion: { kind: 'operator_confirmed_test_request', requestNumber: '1003223' },
  });
  expect(manifest.summary).toMatchObject({
    blocking: 0,
    counts: { excluded_test_request: 1 },
    eligibleMissing: 0,
  });

  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.scope.excludedTestRequestNumbers = [];
  expect(() => validateReviewDocxBackfillManifest(tampered)).toThrow('hash');
});

test('blocks a misspelled or stale test-request exclusion that matches no candidate', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26',
    excludedTestRequestNumbers: ['9999999'],
    observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.summary.blocking).toBe(1);
  expect(manifest.anomalies).toContainEqual({
    code: 'excluded_test_request_not_found',
    requestNumber: '9999999',
  });
});

test('classifies partial pointers and a multi-review smoke scope as blocking', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: FIRST_ID },
      { wmkf_appreviewersuggestionid: SECOND_ID },
      { wmkf_appreviewersuggestionid: THIRD_ID },
    ],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => (
    id === THIRD_ID ? eligiblePlan(id, { status: 'partial_pointer', semanticHash: null }) : eligiblePlan(id)
  ));

  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', requestNumber: '1002903', observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.summary.blocking).toBe(2);
  expect(manifest.anomalies).toContainEqual(expect.objectContaining({
    code: 'request_scope_not_one_eligible_review', eligibleCount: 2,
  }));
  expect(isBlockingReviewDocxBackfillManifest(manifest)).toBe(true);
});

test('fails closed when candidate planning returns a new classification', async () => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    status: 'future_unreviewed_status',
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.summary).toMatchObject({
    blocking: 1,
    counts: { future_unreviewed_status: 1 },
  });
});

test.each([
  'no_cycle',
  'unresolved_relationship',
  'not_found',
  'content_conflict',
])('treats %s as a blocking candidate classification', async (status) => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, { status }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  expect(manifest.summary).toMatchObject({ blocking: 1, counts: { [status]: 1 } });
});

test('rejects a blocking reviewed manifest before rebuilding or write preflight', async () => {
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    status: 'partial_pointer', semanticHash: null,
  }));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  jest.clearAllMocks();
  await expect(executeReviewDocxBackfill(manifest)).rejects.toThrow('blocking');
  expect(resolveReviewDocxTarget).not.toHaveBeenCalled();
  expect(preflightReviewDocxWrite).not.toHaveBeenCalled();
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});

test('aborts population drift before write preflight or ensure', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id, {
    sourceFingerprint: 'changed-source',
  }));

  await expect(executeReviewDocxBackfill(manifest)).rejects.toMatchObject({ code: 'manifest_drift' });
  expect(preflightReviewDocxWrite).not.toHaveBeenCalled();
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});

test('uses the reviewed write set and continues after a row failure', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: FIRST_ID },
      { wmkf_appreviewersuggestionid: SECOND_ID },
    ],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => eligiblePlan(id));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  ensureIndividualReviewFile
    .mockResolvedValueOnce({ status: 'created', item: { id: 'item-1' }, semanticHash: `gdc1:${FIRST_ID}` })
    .mockResolvedValueOnce({ status: 'content_conflict', error: { code: 'content_conflict', message: 'different' } });

  const report = await executeReviewDocxBackfill(manifest);

  expect(preflightReviewDocxWrite).toHaveBeenCalledWith({
    executionMode: 'backfill', suggestionIds: [FIRST_ID, SECOND_ID],
  });
  expect(ensureIndividualReviewFile).toHaveBeenCalledTimes(2);
  expect(ensureIndividualReviewFile).toHaveBeenCalledWith(FIRST_ID, expect.objectContaining({
    expectedSuggestionEtag: 'W/"1"',
    expectedSourceFingerprint: `source-${FIRST_ID}`,
    expectedSemanticHash: `gdc1:${FIRST_ID}`,
  }));
  expect(report).toMatchObject({
    status: 'completed_with_failures',
    summary: { created: 1, failed: 1 },
  });
});

test('never includes an excluded test request in write preflight or ensure', async () => {
  findReviewDocxBackfillPopulation.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: FIRST_ID },
      { wmkf_appreviewersuggestionid: SECOND_ID },
    ],
    capped: false,
  });
  planIndividualReviewFileCandidate.mockImplementation(async (id) => (
    id === SECOND_ID
      ? eligiblePlan(id, { requestNumber: '1003223', status: 'invalid_snapshot', semanticHash: null })
      : eligiblePlan(id)
  ));
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26',
    excludedTestRequestNumbers: ['1003223'],
    observedAt: '2026-09-03T18:00:00.000Z',
  });

  const report = await executeReviewDocxBackfill(manifest);

  expect(preflightReviewDocxWrite).toHaveBeenCalledWith({
    executionMode: 'backfill', suggestionIds: [FIRST_ID],
  });
  expect(ensureIndividualReviewFile).toHaveBeenCalledTimes(1);
  expect(ensureIndividualReviewFile).toHaveBeenCalledWith(FIRST_ID, expect.any(Object));
  expect(report.results).toContainEqual(expect.objectContaining({
    suggestionId: SECOND_ID,
    status: 'skipped',
    reason: 'excluded_test_request',
  }));
});

test('rejects a write-target identity change before ensure', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  preflightReviewDocxWrite.mockResolvedValue({ ...TARGET, driveId: 'other-drive' });
  await expect(executeReviewDocxBackfill(manifest)).rejects.toMatchObject({ code: 'manifest_target_drift' });
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});

test('binds the reviewed Production Dataverse target before ensure', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  preflightReviewDocxWrite.mockResolvedValue({
    ...TARGET, dynamicsBase: 'https://other.crm.dynamics.com',
  });
  await expect(executeReviewDocxBackfill(manifest)).rejects.toMatchObject({
    code: 'manifest_target_drift',
  });
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});
