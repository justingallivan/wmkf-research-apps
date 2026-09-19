/**
 * @jest-environment jsdom
 *
 * S3 prerequisite characterization: a same-request refresh started by the
 * synthesis callback. This intentionally records the current loading-gate
 * behavior so the later retention change can flip only the assertion.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../shared/components/external/RichReviewEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel, disabled }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  ),
}));

const REQUEST_ID = 'req-s3-refresh';
const REVIEWER = {
  suggestionId: 'reviewer-s3-refresh',
  name: 'Baseline Reviewer',
  reviewReceivedAt: '2026-09-18T00:00:00Z',
  reviewerOverallAssessment: 5,
  answers: [],
};

const PROPOSAL = {
  proposalId: REQUEST_ID,
  reviewers: [REVIEWER],
  reviewSynthesis: null,
  reviewSynthesisState: {
    current: false,
    status: 'not_started',
    ready: true,
    canRunManually: true,
    submittedCount: 1,
    blockingCount: 0,
  },
};

afterEach(() => {
  jest.restoreAllMocks();
});

test('same-mount synthesis success starts a held refresh and currently unmounts retained content', async () => {
  let reviewerGets = 0;
  let resolveRefresh;
  const refreshPending = new Promise((resolve) => {
    resolveRefresh = resolve;
  });

  jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets === 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, proposals: [PROPOSAL] }),
        });
      }
      return refreshPending;
    }
    if (href === '/api/review-manager/synthesize-reviews' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true }),
      });
    }
    if (href.includes('/api/workbench/consultant-feedback/consultants')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    if (href.includes('/api/workbench/consultant-feedback?requestId=')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  render(<ReviewsTab requestId={REQUEST_ID} />);

  expect((await screen.findAllByText('Baseline Reviewer')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));

  await waitFor(() => expect(reviewerGets).toBe(2));
  expect(screen.queryByText('Baseline Reviewer')).not.toBeInTheDocument();
  expect(document.querySelector('.animate-spin')).not.toBeNull();

  await act(async () => {
    resolveRefresh({
      ok: true,
      json: async () => ({ success: true, proposals: [PROPOSAL] }),
    });
    await Promise.resolve();
  });
});
