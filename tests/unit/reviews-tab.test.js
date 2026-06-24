/**
 * @jest-environment jsdom
 *
 * ReviewsTab — read-back of submitted reviews. Renders against the mocked
 * /api/review-manager/reviewers GET: shows only reviewers with a submitted
 * review (reviewReceivedAt), decodes the ratings, and links the file download.
 */
import { render, screen } from '@testing-library/react';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));

const REVIEWERS = [
  {
    suggestionId: 'g1',
    name: 'Dr. Submitted',
    reviewerAffiliation: 'MIT',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewSharePointFolder: 'akoya_request/123/Reviewer_Uploads/x',
    reviewFilename: 'review.pdf',
    reviewerImpact: 4,
    reviewerRisk: 2,
    reviewerOverallRating: 5,
  },
  // Pending — no reviewReceivedAt: must be filtered out.
  { suggestionId: 'g2', name: 'Dr. Pending', reviewStatus: 'materials_sent' },
  // Submitted via "mark received (no file)": ratings present, no SharePoint folder.
  {
    suggestionId: 'g3',
    name: 'Dr. NoFile',
    reviewReceivedAt: '2026-06-19T00:00:00Z',
    reviewUploadedByStaff: true,
    reviewerImpact: 1,
    reviewerRisk: null,
    reviewerOverallRating: 99,
  },
];

afterEach(() => fetch.mockReset());

test('renders submitted reviews with decoded ratings + download link, hides pending', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: REVIEWERS }] }),
  });

  render(<ReviewsTab requestId="req1" />);

  // Count line counts submitted (2) against accepted (3).
  expect(await screen.findByText(/2 of 3 accepted reviewers submitted a review/i)).toBeInTheDocument();

  // Submitted reviewers shown; the pending one is filtered out.
  expect(screen.getByText('Dr. Submitted')).toBeInTheDocument();
  expect(screen.getByText('Dr. NoFile')).toBeInTheDocument();
  expect(screen.queryByText('Dr. Pending')).not.toBeInTheDocument();

  // Decoded ratings (not raw numbers).
  expect(screen.getByText('Will rewrite textbooks')).toBeInTheDocument(); // impact 4
  expect(screen.getByText('Excellent')).toBeInTheDocument(); // overall 5
  expect(screen.getByText('Unable to answer')).toBeInTheDocument(); // overall 99
  expect(screen.getByText('Not provided')).toBeInTheDocument(); // NoFile risk = null

  // Download link reuses the existing endpoint, keyed by suggestionId.
  const link = screen.getByTitle('Download: review.pdf');
  expect(link.getAttribute('href')).toContain('/api/review-manager/download-review?suggestionId=g1');

  // The no-file submission shows the explicit no-file marker, not a broken link.
  expect(screen.getByText('No file on record')).toBeInTheDocument();
});

test('shows an empty state when no reviewer has submitted', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{ proposalId: 'req1', reviewers: [{ suggestionId: 'g2', name: 'Dr. Pending', reviewStatus: 'materials_sent' }] }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);
  expect(await screen.findByText(/No reviews submitted yet/i)).toBeInTheDocument();
});
