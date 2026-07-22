import {
  getManualReviewEntryForm,
  submitManualReviewEntry,
  ManualReviewEntryError,
} from '../../lib/services/review-manager/manual-review-entry-service';
import ReviewDraftService from '../../lib/services/review-draft-service';
import {
  getActiveQuestionSet,
  questionSetVersion,
} from '../../lib/external/review-question-fetcher';
import { getByIdWithSelect } from '../../lib/dataverse/adapters/reviewer-suggestion';
import { answerUpsertDescriptor } from '../../lib/dataverse/adapters/review-answer';
import { runChangeset, atomicParentWithChildren } from '../../lib/dataverse/core/changeset';

jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true,
  default: { deleteBySuggestion: jest.fn() },
}));
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: jest.fn(),
  questionSetVersion: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
  getByIdWithSelect: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  answerUpsertDescriptor: jest.fn((_id, row) => ({ row })),
}));
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: jest.fn(),
  atomicParentWithChildren: jest.fn((value) => value),
}));

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const QUESTIONS = [
  { key: 'affiliation', order: 0, label: 'Affiliation', type: 'string', required: true, maxLength: 500 },
  { key: 'impact', order: 1, label: 'Impact', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 3, label: 'High' }] },
  { key: 'risk', order: 2, label: 'Risk', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }] },
  { key: 'overallRating', order: 3, label: 'Overall', type: 'picklist', required: true, options: [{ value: 4, label: 'Excellent' }] },
  { key: 'comments', order: 4, label: 'Comments', type: 'richtext', required: true, maxLength: 5000 },
];
const ANSWERS = {
  affiliation: 'Test University',
  impact: 3,
  risk: 2,
  overallRating: 4,
  comments: '<p>Strong <script>alert(1)</script>proposal.</p>',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  getByIdWithSelect.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_reviewreceivedat: null,
    wmkf_revieweraffiliation: 'Existing University',
    _etag: 'W/"7"',
  });
  getActiveQuestionSet.mockResolvedValue(QUESTIONS);
  questionSetVersion.mockReturnValue('version-1');
  runChangeset.mockResolvedValue({ ok: true });
  ReviewDraftService.deleteBySuggestion.mockResolvedValue(1);
});

afterEach(() => {
  console.error.mockRestore();
});

test('GET context returns the complete live question set and version only for an eligible row', async () => {
  const result = await getManualReviewEntryForm({ suggestionId: SUGGESTION_ID });
  expect(result).toEqual({
    ok: true,
    questions: QUESTIONS,
    setVersion: 'version-1',
    affiliation: 'Existing University',
  });
  expect(getByIdWithSelect).toHaveBeenCalledWith(
    SUGGESTION_ID,
    expect.stringContaining('wmkf_reviewreceivedat'),
  );
});

test('full submit sanitizes, builds the canonical snapshot, and commits parent + children atomically', async () => {
  const result = await submitManualReviewEntry({
    suggestionId: SUGGESTION_ID,
    answers: ANSWERS,
    setVersion: 'version-1',
    actingUserSystemId: 'staff-user-id',
  });

  expect(result.ok).toBe(true);
  expect(result.receivedAt).toEqual(expect.any(String));
  expect(answerUpsertDescriptor).toHaveBeenCalledTimes(4);
  const commentsCall = answerUpsertDescriptor.mock.calls.find(([, row]) => row.questionKey === 'comments');
  expect(commentsCall[1].answerHtml).toBe('<p>Strong proposal.</p>');

  expect(atomicParentWithChildren).toHaveBeenCalledWith({
    parent: expect.objectContaining({
      method: 'PATCH',
      entitySet: 'wmkf_appreviewersuggestions',
      key: SUGGESTION_ID,
      ifMatch: 'W/"7"',
      body: expect.objectContaining({
        wmkf_revieweraffiliation: 'Test University',
        wmkf_reviewreceivedat: expect.any(String),
        wmkf_reviewstatus: 100000003,
        wmkf_reviewuploadedbystaff: true,
      }),
    }),
    children: expect.arrayContaining([
      expect.objectContaining({ row: expect.objectContaining({ questionKey: 'impact', answerValue: 3 }) }),
      expect.objectContaining({ row: expect.objectContaining({ questionKey: 'comments', answerText: 'Strong proposal.' }) }),
    ]),
  });
  expect(runChangeset).toHaveBeenCalledWith(
    expect.any(Object),
    { actingUserSystemId: 'staff-user-id' },
  );
  expect(ReviewDraftService.deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
});

test('refuses a stale question-set version before any write', async () => {
  await expect(submitManualReviewEntry({
    suggestionId: SUGGESTION_ID,
    answers: ANSWERS,
    setVersion: 'old-version',
  })).rejects.toMatchObject({
    httpStatus: 409,
    body: expect.objectContaining({ reason: 'set_changed' }),
  });
  expect(runChangeset).not.toHaveBeenCalled();
});

test('refuses an already-recorded or non-accepted reviewer before loading the form', async () => {
  getByIdWithSelect.mockResolvedValueOnce({
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_reviewreceivedat: '2026-07-22T12:00:00Z',
    _etag: 'W/"8"',
  });
  await expect(getManualReviewEntryForm({ suggestionId: SUGGESTION_ID }))
    .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'review_received_locked' }) });

  getByIdWithSelect.mockResolvedValueOnce({
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_reviewreceivedat: null,
    _etag: 'W/"9"',
  });
  await expect(getManualReviewEntryForm({ suggestionId: SUGGESTION_ID }))
    .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'not_eligible' }) });
  expect(getActiveQuestionSet).not.toHaveBeenCalled();
});

test('maps row-version failure to a retryable conflict and keeps draft cleanup post-commit only', async () => {
  runChangeset.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  await expect(submitManualReviewEntry({
    suggestionId: SUGGESTION_ID,
    answers: ANSWERS,
    setVersion: 'version-1',
  })).rejects.toMatchObject({
    httpStatus: 409,
    body: expect.objectContaining({ reason: 'conflict' }),
  });
  expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
});

test('a post-commit draft cleanup failure is logged but does not turn success into failure', async () => {
  ReviewDraftService.deleteBySuggestion.mockRejectedValueOnce(new Error('postgres unavailable'));
  await expect(submitManualReviewEntry({
    suggestionId: SUGGESTION_ID,
    answers: ANSWERS,
    setVersion: 'version-1',
  })).resolves.toMatchObject({ ok: true });
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining('post-commit draft delete failed'),
    'postgres unavailable',
  );
});

test('exports a typed domain error for route mapping', () => {
  const error = new ManualReviewEntryError('x', 409, { ok: false });
  expect(error).toBeInstanceOf(Error);
  expect(error.httpStatus).toBe(409);
});
