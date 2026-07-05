/**
 * Logic-level unit tests for lib/services/review-manager/mark-received-no-file-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + external validators mocked; covers BOTH write branches
 * (0 ratings → single patchReviewReceipt PATCH; ≥1 rating → one atomic
 * changeset of parent PATCH + answer upserts), the 400 form-validation error
 * carrying the validator result verbatim as `body`, and the 404 mapping.
 */

const getActiveQuestionSet = jest.fn();
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: (...a) => getActiveQuestionSet(...a),
}));
const validateReviewForm = jest.fn();
jest.mock('../../lib/external/review-form-schema', () => ({
  validateReviewForm: (...a) => validateReviewForm(...a),
}));
const buildRatingSnapshotRows = jest.fn();
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  buildRatingSnapshotRows: (...a) => buildRatingSnapshotRows(...a),
}));
const patchReviewReceipt = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  patchReviewReceipt: (...a) => patchReviewReceipt(...a),
  ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
}));
const answerUpsertDescriptor = jest.fn((suggestionId, row) => ({ upsertFor: row.key }));
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  answerUpsertDescriptor: (...a) => answerUpsertDescriptor(...a),
}));
const runChangeset = jest.fn(async () => {});
const atomicParentWithChildren = jest.fn((x) => ({ atomic: x }));
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: (...a) => runChangeset(...a),
  atomicParentWithChildren: (...a) => atomicParentWithChildren(...a),
}));

const SUG = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'su-1';
const QUESTIONS = [
  { key: 'impact', type: 'picklist' },
  { key: 'comments', type: 'richtext' },
  { key: 'other', type: 'text' },
];

let markReceivedNoFile;
let MarkReceivedNoFileError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/mark-received-no-file-service');
  markReceivedNoFile = mod.markReceivedNoFile;
  MarkReceivedNoFileError = mod.MarkReceivedNoFileError;
});

beforeEach(() => {
  jest.clearAllMocks();
  getActiveQuestionSet.mockResolvedValue(QUESTIONS);
});

test('0 rating rows → single patchReviewReceipt PATCH, no changeset', async () => {
  validateReviewForm.mockReturnValueOnce({ ok: true, dataverseValues: {}, ratings: {} });
  buildRatingSnapshotRows.mockReturnValueOnce([]);
  const out = await markReceivedNoFile({ suggestionId: SUG, structuredData: undefined, actingUserSystemId: ACTOR });
  expect(out).toEqual({ ok: true });
  expect(patchReviewReceipt).toHaveBeenCalledTimes(1);
  const [id, patch, opts] = patchReviewReceipt.mock.calls[0];
  expect(id).toBe(SUG);
  expect(patch.wmkf_reviewuploadedbystaff).toBe(true);
  expect(typeof patch.wmkf_reviewreceivedat).toBe('string');
  expect(opts).toEqual({ actingUserSystemId: ACTOR });
  expect(runChangeset).not.toHaveBeenCalled();
});

test('≥1 rating row → ONE atomic changeset (parent PATCH + answer upserts), no bare PATCH', async () => {
  validateReviewForm.mockReturnValueOnce({
    ok: true,
    dataverseValues: { wmkf_affiliation: 1 },
    ratings: { impact: 4 },
  });
  buildRatingSnapshotRows.mockReturnValueOnce([{ key: 'impact', value: 4 }]);
  const out = await markReceivedNoFile({ suggestionId: SUG, structuredData: { impact: 4 }, actingUserSystemId: ACTOR });
  expect(out).toEqual({ ok: true });
  expect(patchReviewReceipt).not.toHaveBeenCalled();
  expect(runChangeset).toHaveBeenCalledTimes(1);
  const atomicArg = atomicParentWithChildren.mock.calls[0][0];
  expect(atomicArg.parent).toMatchObject({
    method: 'PATCH',
    entitySet: 'wmkf_appreviewersuggestions',
    key: SUG,
  });
  expect(atomicArg.parent.body.wmkf_affiliation).toBe(1);
  expect(atomicArg.children).toEqual([{ upsertFor: 'impact' }]);
  // snapshotKeys = picklist/richtext keys from the live question set
  const snapshotKeys = answerUpsertDescriptor.mock.calls[0][2];
  expect([...snapshotKeys].sort()).toEqual(['comments', 'impact']);
  expect(runChangeset.mock.calls[0][1]).toEqual({ actingUserSystemId: ACTOR });
});

test('form validation failure → 400 MarkReceivedNoFileError with the validator result verbatim as body', async () => {
  const formResult = { ok: false, reason: 'validation', errors: ['impact out of range'] };
  validateReviewForm.mockReturnValueOnce(formResult);
  const err = await markReceivedNoFile({ suggestionId: SUG, structuredData: { impact: 99 }, actingUserSystemId: null })
    .catch((e) => e);
  expect(err).toBeInstanceOf(MarkReceivedNoFileError);
  expect(err.httpStatus).toBe(400);
  expect(err.body).toBe(formResult);
  expect(patchReviewReceipt).not.toHaveBeenCalled();
  expect(runChangeset).not.toHaveBeenCalled();
});

test('404-shaped write failure → 404 with { ok:false, reason:"not_found" } body', async () => {
  validateReviewForm.mockReturnValueOnce({ ok: true, dataverseValues: {}, ratings: {} });
  buildRatingSnapshotRows.mockReturnValueOnce([]);
  patchReviewReceipt.mockRejectedValueOnce(new Error('update failed with 404'));
  const err = await markReceivedNoFile({ suggestionId: SUG, structuredData: undefined, actingUserSystemId: null })
    .catch((e) => e);
  expect(err).toBeInstanceOf(MarkReceivedNoFileError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
});

test('non-404 write failure propagates untyped (shell maps to 500)', async () => {
  validateReviewForm.mockReturnValueOnce({ ok: true, dataverseValues: {}, ratings: {} });
  buildRatingSnapshotRows.mockReturnValueOnce([]);
  patchReviewReceipt.mockRejectedValueOnce(new Error('dataverse 503'));
  const err = await markReceivedNoFile({ suggestionId: SUG, structuredData: undefined, actingUserSystemId: null })
    .catch((e) => e);
  expect(err).not.toBeInstanceOf(MarkReceivedNoFileError);
  expect(err.message).toBe('dataverse 503');
});
