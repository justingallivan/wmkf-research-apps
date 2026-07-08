import { render, screen } from '@testing-library/react';
import RemoveEntirelyModal from '../../shared/components/reviewers/RemoveEntirelyModal';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      suggestionId: SUGGESTION_ID,
      requestId: '22222222-2222-4222-8222-222222222222',
      requestNumber: 'R-1',
      honorarium: null,
      hasSubmittedReview: true,
      answerRowCount: 2,
      contactId: null,
      contactAssociations: null,
      reviewFile: {
        folder: 'REQ-1/Reviewer_Uploads/Jane',
        filename: 'review.pdf',
        wmkf_reviewsharepointfolder: 'REQ-1/Reviewer_Uploads/Jane',
        wmkf_reviewfilename: 'review.pdf',
      },
      reviewSharePointFolder: 'REQ-1/Reviewer_Uploads/Jane',
      reviewFilename: 'review.pdf',
    }),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

test('discloses submitted-review rows separately from best-effort SharePoint cleanup', async () => {
  render(
    <RemoveEntirelyModal
      candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }}
      onClose={jest.fn()}
      onRemoved={jest.fn()}
    />,
  );

  expect(await screen.findByText(/Submitted-review Dataverse rows/)).toBeInTheDocument();
  expect(screen.getByText(/best-effort cleanup of uploaded SharePoint file/)).toBeInTheDocument();
  expect(screen.getByText(/SharePoint review pointer recorded for audit:/)).toHaveTextContent(
    'REQ-1/Reviewer_Uploads/Jane / review.pdf',
  );
  expect(screen.queryByText(/^Their submitted review$/)).not.toBeInTheDocument();
});
