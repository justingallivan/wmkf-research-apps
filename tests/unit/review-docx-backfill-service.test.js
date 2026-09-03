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
    expectedFolder: `1002903_${REQUEST_ID}/Reviewer_Uploads/Generated/${suggestionId}`,
    expectedFilename: 'Review-1002903.docx',
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
    expectedFilename: 'Review-1002903.docx',
    semanticHash: `gdc1:${FIRST_ID}`,
    item: { siteId: 'site-1', driveId: 'drive-1', id: 'item-1', name: 'Review-1002903.docx' },
  });
});

test('builds a redacted hash-bound dry-run manifest', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26',
    requestNumber: '1002903',
    observedAt: '2026-09-03T18:00:00.000Z',
  });

  expect(manifest).toMatchObject({
    artifactType: 'review_docx_sharepoint_backfill_v1',
    schemaVersion: 1,
    dryRun: true,
    scope: { cycleCode: 'D26', requestNumber: '1002903' },
    target: { siteId: 'site-1', driveId: 'drive-1' },
    summary: { population: 1, eligibleMissing: 1, blocking: 0 },
  });
  expect(manifest.populationDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(manifest)).not.toContain('review answer text');
  expect(() => validateReviewDocxBackfillManifest(manifest)).not.toThrow();

  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.candidates[0].requestNumber = '9999999';
  expect(() => validateReviewDocxBackfillManifest(tampered)).toThrow('hash');
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

test('rejects a write-target identity change before ensure', async () => {
  const manifest = await buildReviewDocxBackfillManifest({
    cycleCode: 'D26', observedAt: '2026-09-03T18:00:00.000Z',
  });
  preflightReviewDocxWrite.mockResolvedValue({ ...TARGET, driveId: 'other-drive' });
  await expect(executeReviewDocxBackfill(manifest)).rejects.toMatchObject({ code: 'manifest_target_drift' });
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});
