/**
 * @jest-environment jsdom
 *
 * A structured review may be closed before the hourly DOCX filer commits its
 * SharePoint pointer. ReviewersTab should quietly reconcile that pointer so the
 * download control becomes active without a manual page reload.
 */
import { act, render, screen } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => {
  return {
    __esModule: true,
    default: function ManagePanelStub({ reviewers }) {
      const row = reviewers?.[0] || {};
      return <div data-testid="review-pointer">{row.reviewSharePointFolder || 'pending'}</div>;
    },
  };
});
jest.mock('../../shared/components/reviewers/ReviewerFindPanel', () => function FindPanelStub() { return null; });
jest.mock('../../shared/components/reviewers/ReviewerInvitePanel', () => function InvitePanelStub() { return null; });
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => function EmailTemplatesModalStub() { return null; });
jest.mock('../../shared/components/reviewers/CampaignConfigModal', () => function CampaignConfigModalStub() { return null; });

jest.mock('next/router', () => ({
  useRouter: () => ({
    query: { sub: 'track' },
    pathname: '/workbench/[requestId]',
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';

const REQUEST_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
const originalFetch = global.fetch;
const REVIEWER = {
  suggestionId: 'bbbbbbbb-2222-2222-2222-222222222222',
  name: 'Liang Huang',
  reviewStatus: 'complete',
  reviewReceivedAt: '2026-09-15T19:03:32.000Z',
  honorariumEligibility: 'eligible',
  reviewSharePointFolder: null,
  answers: [{ questionKey: 'assessment', questionType: 'richtext', answerText: 'Strong proposal.' }],
};

function response(body) {
  return Promise.resolve({ ok: true, json: async () => body });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

test('re-fetches a pending structured-review pointer and paints the download-ready row', async () => {
  jest.useFakeTimers();
  let reviewerReads = 0;
  global.fetch = jest.fn((url) => {
    const path = String(url);
    if (path.includes('/api/review-manager/reviewers')) {
      reviewerReads += 1;
      const reviewer = reviewerReads === 1
        ? REVIEWER
        : { ...REVIEWER, reviewSharePointFolder: '1003046_GUID/Reviews' };
      return response({ success: true, proposals: [{ proposalId: REQUEST_ID, reviewers: [reviewer] }] });
    }
    if (path.includes('/api/reviewer-finder/my-candidates')) {
      return response({ proposals: [{ proposalId: REQUEST_ID, candidates: [], removedCandidates: [] }] });
    }
    if (path.includes('/api/workbench/decline-referrals')) return response({ referrals: [] });
    throw new Error(`Unexpected fetch: ${path}`);
  });

  render(<ReviewersTab requestId={REQUEST_ID} />);
  await flush();
  expect(screen.getByTestId('review-pointer')).toHaveTextContent('pending');

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(reviewerReads).toBe(2);
  expect(screen.getByTestId('review-pointer')).toHaveTextContent('1003046_GUID/Reviews');

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  expect(reviewerReads).toBe(2);
});
