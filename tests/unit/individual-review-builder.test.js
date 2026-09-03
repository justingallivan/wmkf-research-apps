/**
 * Shared individual-review DOCX builder contract.
 *
 * @jest-environment node
 */

const fetchAnswersBySuggestion = jest.fn();
jest.mock('../../lib/services/review-answers', () => ({
  fetchAnswersBySuggestion: (...args) => fetchAnswersBySuggestion(...args),
}));

const renderIndividualReviewDocx = jest.fn();
jest.mock('../../lib/services/review-documents/docx-renderer', () => ({
  renderIndividualReviewDocx: (...args) => renderIndividualReviewDocx(...args),
}));

const {
  REVIEW_DOCX_CONTENT_TYPE,
  buildIndividualReviewDocx,
  reviewerTitleAndOrganization,
} = require('../../lib/services/review-documents/individual-review-builder');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const GENERATED_AT = '2026-09-03T18:00:00.000Z';

const answers = [
  {
    questionKey: 'approach',
    questionOrder: 1,
    questionText: 'Comment on the approach.',
    questionType: 'richtext',
    answerHtml: '<p>Strong work.</p>',
    answerText: '',
    answerValue: null,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  fetchAnswersBySuggestion.mockResolvedValue({ [SUGGESTION_ID]: answers });
  renderIndividualReviewDocx.mockResolvedValue(Buffer.from('docx-bytes'));
});

test('builds the approved payload from the persisted answer snapshot and caller-owned timestamp', async () => {
  const payload = await buildIndividualReviewDocx({
    suggestionId: SUGGESTION_ID,
    reviewer: { wmkf_name: 'Dr. Reviewer' },
    request: {
      akoya_requestnum: '1002903',
      akoya_title: 'A Proposal',
      wmkf_organizationname: 'University One',
      _akoya_applicantid_value_formatted: 'Fallback University',
    },
    row: {
      wmkf_reviewertitle: 'Professor',
      wmkf_revieweraffiliation: 'University Two',
      wmkf_reviewreceivedat: '2026-09-02T17:30:00.000Z',
    },
    generatedAtIso: GENERATED_AT,
  });

  expect(fetchAnswersBySuggestion).toHaveBeenCalledWith([SUGGESTION_ID]);
  expect(renderIndividualReviewDocx).toHaveBeenCalledTimes(1);
  expect(renderIndividualReviewDocx.mock.calls[0][0]).toMatchObject({
    header: {
      reviewerName: 'Dr. Reviewer',
      reviewerTitleAndOrganization: 'Professor, University Two',
      requestNumber: '1002903',
      requestTitle: 'A Proposal',
      institution: 'University One',
      submittedAt: '2026-09-02T17:30:00.000Z',
      generatedAtIso: GENERATED_AT,
    },
    sections: [expect.objectContaining({
      questionKey: 'approach',
      questionType: 'richtext',
      state: 'answered',
    })],
  });
  expect(payload).toEqual({
    filename: 'Review-1002903.docx',
    contentType: REVIEW_DOCX_CONTENT_TYPE,
    content: Buffer.from('docx-bytes'),
  });
});

test.each([
  ['organization only', { wmkf_revieweraffiliation: 'University One' }, 'University One'],
  ['title only', { wmkf_reviewertitle: 'Professor' }, 'Professor'],
  ['title already includes organization', {
    wmkf_reviewertitle: 'Professor, University One',
    wmkf_revieweraffiliation: 'University One',
  }, 'Professor, University One'],
  ['neither', {}, null],
])('reviewer title formatter preserves %s behavior', (_label, row, expected) => {
  expect(reviewerTitleAndOrganization(row)).toBe(expected);
});

test('keeps the existing fallback filename when request number is absent', async () => {
  const payload = await buildIndividualReviewDocx({
    suggestionId: SUGGESTION_ID,
    reviewer: {},
    request: {},
    row: {},
    generatedAtIso: GENERATED_AT,
  });
  expect(payload.filename).toBe('Review-copy.docx');
});

test('uses a caller-supplied authoritative answer snapshot without reading it again', async () => {
  const supplied = [{ ...answers[0], answerHtml: '<p>Supplied.</p>' }];
  await buildIndividualReviewDocx({
    suggestionId: SUGGESTION_ID,
    reviewer: {},
    request: {},
    row: {},
    generatedAtIso: GENERATED_AT,
    answerSnapshot: supplied,
  });
  expect(fetchAnswersBySuggestion).not.toHaveBeenCalled();
  expect(renderIndividualReviewDocx.mock.calls[0][0].sections[0]).toMatchObject({
    questionKey: 'approach',
    state: 'answered',
  });
});

test('propagates render failure so the thank-you caller can remain retryable before claim', async () => {
  renderIndividualReviewDocx.mockRejectedValueOnce(new Error('template unavailable'));
  await expect(buildIndividualReviewDocx({
    suggestionId: SUGGESTION_ID,
    reviewer: {},
    request: {},
    row: {},
    generatedAtIso: GENERATED_AT,
  })).rejects.toThrow('template unavailable');
});
