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
  // NoFile has risk = null and a legacy overall = 99 (the removed "Unable to
  // answer" sentinel); both now decode to "Not provided".
  expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(2);

  // Download link reuses the existing endpoint, keyed by suggestionId.
  const link = screen.getByTitle('Download: review.pdf');
  expect(link.getAttribute('href')).toContain('/api/review-manager/download-review?suggestionId=g1');

  // The no-file submission shows the explicit no-file marker, not a broken link.
  expect(screen.getByText('No file on record')).toBeInTheDocument();
});

test('renders the narrative rich-text answers (Phase 4), not the picklist rows', async () => {
  const reviewer = {
    suggestionId: 'g1',
    name: 'Dr. Narrative',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewerImpact: 3,
    reviewerRisk: 2,
    reviewerOverallRating: 4,
    answers: [
      // Picklist rows must NOT render in the narrative section (shown as cells).
      { questionKey: 'impact', questionOrder: 1, questionType: 'picklist', answerHtml: '', answerText: 'Will result in publications of broad interest', answerValue: 3 },
      { questionKey: 'q2', questionOrder: 2, questionType: 'richtext', questionText: 'Q2 — What specific significant impacts do you foresee?', answerHtml: '<p>This could <strong>reshape</strong> the field.</p>', answerText: '...', answerValue: null },
      // Empty optional richtext: skipped.
      { questionKey: 'q11', questionOrder: 11, questionType: 'richtext', questionText: 'Q11 — Anything else?', answerHtml: '', answerText: '', answerValue: null },
    ],
  };
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: [reviewer] }] }),
  });

  render(<ReviewsTab requestId="req1" />);

  // The richtext question label + its rendered HTML show.
  expect(await screen.findByText('Q2 — What specific significant impacts do you foresee?')).toBeInTheDocument();
  expect(screen.getByText('reshape')).toBeInTheDocument(); // <strong> rendered
  // The empty optional question is not rendered.
  expect(screen.queryByText('Q11 — Anything else?')).not.toBeInTheDocument();
  // The impact picklist label shows once (the rating cell) — the narrative
  // section does NOT add a second copy of the picklist answer.
  expect(screen.getAllByText('Will result in publications of broad interest')).toHaveLength(1);
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
