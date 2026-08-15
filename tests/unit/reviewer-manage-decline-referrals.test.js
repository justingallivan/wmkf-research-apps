/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

const proposal = {
  proposalId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  proposalTitle: 'Referral test',
  reviewDeadline: null,
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  jest.clearAllMocks();
});

test('legacy prose cannot be submitted wholesale as a reviewer name', async () => {
  const onAddReferral = jest.fn();
  const onDismissDeclineReferral = jest.fn();
  const legacy = {
    referralId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    suggestionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    referralIndex: 0,
    referralText: 'Chris Lima, MSK\nKylie Walters, NCI',
    reviewerName: 'Cynthia Wolberger',
    legacy: true,
    dismissible: true,
    referralVersion: 'legacy:Chris Lima, MSK\nKylie Walters, NCI',
  };

  await act(async () => {
    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[]}
        mode="track"
        declineReferrals={[legacy]}
        onAddReferral={onAddReferral}
        onDismissDeclineReferral={onDismissDeclineReferral}
      />,
    );
    await Promise.resolve();
  });

  expect(screen.queryByRole('button', { name: /add as candidate/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /dismiss resolved note/i }));
  expect(onDismissDeclineReferral).toHaveBeenCalledWith(legacy);
  expect(onAddReferral).not.toHaveBeenCalled();
});

test('a structured person can be added or dismissed independently', async () => {
  const onAddReferral = jest.fn();
  const onDismissDeclineReferral = jest.fn();
  const referral = {
    referralId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:1',
    suggestionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    referralIndex: 1,
    referralName: 'Kylie Walters',
    referralText: 'Kylie Walters · NCI',
    institution: 'NCI',
    reviewerName: 'Cynthia Wolberger',
    legacy: false,
    dismissible: true,
    referralVersion: 'structured:[{"n":"Kylie Walters","i":"NCI"}]',
  };

  await act(async () => {
    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[]}
        mode="track"
        declineReferrals={[referral]}
        onAddReferral={onAddReferral}
        onDismissDeclineReferral={onDismissDeclineReferral}
      />,
    );
    await Promise.resolve();
  });

  fireEvent.click(screen.getByRole('button', { name: /add as candidate/i }));
  expect(onAddReferral).toHaveBeenCalledWith(referral);
  fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
  expect(onDismissDeclineReferral).toHaveBeenCalledWith(referral);
});

test('an unreadable reserved referral remains visible but cannot be dismissed', async () => {
  const onDismissDeclineReferral = jest.fn();
  const corrupt = {
    referralId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    suggestionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    referralIndex: 0,
    referralText: 'wmkf-referrals:v2:[{"n":"Future Person"}]',
    reviewerName: 'Cynthia Wolberger',
    legacy: true,
    dismissible: false,
    referralVersion: null,
  };

  await act(async () => {
    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[]}
        mode="track"
        declineReferrals={[corrupt]}
        onDismissDeclineReferral={onDismissDeclineReferral}
      />,
    );
    await Promise.resolve();
  });

  expect(screen.getByText(/cannot be dismissed safely/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  expect(onDismissDeclineReferral).not.toHaveBeenCalled();
});
