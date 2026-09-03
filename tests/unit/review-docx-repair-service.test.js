/**
 * @jest-environment node
 */

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
  buildReviewDocxRepairManifest,
  executeReviewDocxRepair,
  validateReviewDocxRepairManifest,
  validateRepairScope,
} = require('../../lib/services/review-documents/repair-service');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const TARGET = {
  siteUrl: 'https://appriver3651007194.sharepoint.com/sites/akoyaGO',
  siteId: 'site-1', driveId: 'drive-1', dynamicsBase: 'https://wmkf.crm.dynamics.com',
};
const PLAN = {
  suggestionId: SUGGESTION_ID,
  suggestionEtag: 'W/"1"',
  sourceFingerprint: 'source-hash',
  requestId: '22222222-2222-4222-8222-222222222222',
  requestNumber: '1002874',
  reviewerName: 'Agnes Karasik',
  receivedAt: '2026-08-28T12:00:00.000Z',
  cycleCode: 'D26',
  status: 'eligible_repair',
  priorPointer: {
    folder: '1002874_REQUEST/Reviewer_Uploads/Generated/SUGGESTION',
    filename: 'Review-1002874.docx',
  },
  expectedFolder: '1002874_REQUEST/Reviews',
  expectedFilename: 'Review-1002874-Agnes Karasik.docx',
  semanticHash: 'gdc1:semantic-hash',
  item: null,
  existingSemanticHash: null,
  semanticMatch: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  resolveReviewDocxTarget.mockResolvedValue(TARGET);
  planIndividualReviewFileCandidate.mockResolvedValue(PLAN);
  preflightReviewDocxWrite.mockResolvedValue(TARGET);
  ensureIndividualReviewFile.mockResolvedValue({
    status: 'created',
    expectedFolder: PLAN.expectedFolder,
    expectedFilename: PLAN.expectedFilename,
    semanticHash: PLAN.semanticHash,
    item: { id: 'new-item', name: PLAN.expectedFilename },
  });
});

test('builds a hash-bound one-item repair manifest without review content', async () => {
  const manifest = await buildReviewDocxRepairManifest({
    cycleCode: 'D26', requestNumber: '1002874', suggestionId: SUGGESTION_ID,
    observedAt: '2026-09-03T23:30:00.000Z',
  });
  expect(manifest).toMatchObject({
    artifactType: 'review_docx_sharepoint_repair_v1',
    schemaVersion: 1,
    dryRun: true,
    summary: { blocking: 0, eligibleRepairs: 1 },
    candidate: {
      reviewerName: 'Agnes Karasik',
      priorPointer: PLAN.priorPointer,
      expectedFolder: PLAN.expectedFolder,
      expectedFilename: PLAN.expectedFilename,
    },
  });
  expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(() => validateReviewDocxRepairManifest(manifest)).not.toThrow();
  expect(planIndividualReviewFileCandidate).toHaveBeenCalledWith(SUGGESTION_ID, {
    cycleCode: 'D26', target: TARGET, allowPointerRepair: true,
  });

  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.candidate.expectedFilename = 'other.docx';
  expect(() => validateReviewDocxRepairManifest(tampered)).toThrow('hash');
});

test('blocks a suggestion that resolves to a different request number', async () => {
  planIndividualReviewFileCandidate.mockResolvedValue({ ...PLAN, requestNumber: '9999999' });
  const manifest = await buildReviewDocxRepairManifest({
    cycleCode: 'D26', requestNumber: '1002874', suggestionId: SUGGESTION_ID,
  });
  expect(manifest.summary).toEqual({ blocking: 1, eligibleRepairs: 0 });
  expect(manifest.candidate).toMatchObject({
    status: 'request_mismatch', error: { code: 'request_mismatch' },
  });
});

test('rebuilds the source contract, preflights the exact row, and repairs without cleanup', async () => {
  const manifest = await buildReviewDocxRepairManifest({
    cycleCode: 'D26', requestNumber: '1002874', suggestionId: SUGGESTION_ID,
  });
  const report = await executeReviewDocxRepair(manifest);

  expect(preflightReviewDocxWrite).toHaveBeenCalledWith({
    executionMode: 'backfill', suggestionIds: [SUGGESTION_ID],
  });
  expect(ensureIndividualReviewFile).toHaveBeenCalledWith(SUGGESTION_ID, {
    cycleCode: 'D26',
    executionMode: 'backfill',
    target: TARGET,
    expectedSuggestionEtag: PLAN.suggestionEtag,
    expectedSourceFingerprint: PLAN.sourceFingerprint,
    expectedSemanticHash: PLAN.semanticHash,
    repairFromPointer: PLAN.priorPointer,
  });
  expect(report).toMatchObject({
    status: 'completed',
    priorFileCleanup: 'deferred',
    summary: { repaired: 1, failed: 0 },
  });
});

test('rejects invalid scope and drift before write preflight', async () => {
  expect(() => validateRepairScope({
    cycleCode: 'd26', requestNumber: '1002874', suggestionId: SUGGESTION_ID,
  })).toThrow('exact uppercase');
  const manifest = await buildReviewDocxRepairManifest({
    cycleCode: 'D26', requestNumber: '1002874', suggestionId: SUGGESTION_ID,
  });
  planIndividualReviewFileCandidate.mockResolvedValue({ ...PLAN, sourceFingerprint: 'changed' });
  await expect(executeReviewDocxRepair(manifest)).rejects.toMatchObject({ code: 'manifest_drift' });
  expect(preflightReviewDocxWrite).not.toHaveBeenCalled();
  expect(ensureIndividualReviewFile).not.toHaveBeenCalled();
});
