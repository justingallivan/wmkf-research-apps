/**
 * @jest-environment node
 */

const getReviewers = jest.fn();
const renderCombinedReviewDocx = jest.fn();

jest.mock('../../lib/services/review-manager/reviewers-service', () => ({
  getReviewers: (...args) => getReviewers(...args),
}));
jest.mock('../../lib/services/review-documents/docx-renderer', () => ({
  renderCombinedReviewDocx: (...args) => renderCombinedReviewDocx(...args),
}));

const { exportCombinedReviews } = require('../../lib/services/review-manager/export-reviews-service');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const GENERATED_AT = '2026-08-20T18:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  renderCombinedReviewDocx.mockResolvedValue(Buffer.from('docx'));
});

test('loads authoritative submitted reviews and renders the combined template', async () => {
  getReviewers.mockResolvedValue({
    liveQuestions: null,
    proposals: [{
      proposalId: REQUEST_ID,
      requestNumber: '26/101 unsafe',
      proposalTitle: 'Proposal',
      proposalAuthors: 'Dr. Lead',
      proposalInstitution: 'University',
      reviewSynthesis: { overall: 'Positive.' },
      reviewSynthesisState: { current: true },
      reviewers: [
        {
          suggestionId: 's1',
          name: 'Submitted',
          reviewReceivedAt: '2026-08-19T00:00:00Z',
          answers: [{
            questionKey: 'rating', questionOrder: 1, questionText: 'Rating', questionType: 'picklist',
            answerValue: 4, answerText: 'Good', questionOptions: [{ value: 4, label: 'Good' }],
          }],
        },
        { suggestionId: 's2', name: 'Pending', reviewReceivedAt: null, answers: [] },
      ],
    }],
  });

  const result = await exportCombinedReviews({
    proposalId: REQUEST_ID,
    azureEmail: 'staff@example.org',
    generatedAtIso: GENERATED_AT,
  });

  expect(getReviewers).toHaveBeenCalledWith({ proposalId: REQUEST_ID, azureEmail: 'staff@example.org' });
  expect(renderCombinedReviewDocx).toHaveBeenCalledTimes(1);
  const report = renderCombinedReviewDocx.mock.calls[0][0];
  expect(report.header).toMatchObject({ requestNumber: '26/101 unsafe', reviewerCount: 1 });
  expect(report.reviewers.map((reviewer) => reviewer.name)).toEqual(['Submitted']);
  expect(result).toEqual({ content: Buffer.from('docx'), filename: 'reviews-26-101-unsafe-20260820.docx' });
});

test('missing request and zero submitted reviews fail before rendering', async () => {
  getReviewers.mockResolvedValueOnce({ proposals: [] });
  await expect(exportCombinedReviews({ proposalId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 404,
    code: 'request_not_found',
  });

  getReviewers.mockResolvedValueOnce({
    proposals: [{ proposalId: REQUEST_ID, reviewers: [{ reviewReceivedAt: null }] }],
  });
  await expect(exportCombinedReviews({ proposalId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    code: 'no_submitted_reviews',
  });
  expect(renderCombinedReviewDocx).not.toHaveBeenCalled();
});
