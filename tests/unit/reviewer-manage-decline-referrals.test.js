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
  const onResolveLegacyReferral = jest.fn();
  const legacy = {
    referralId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    suggestionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    referralIndex: 0,
    referralText: 'Chris Lima, MSK\nKylie Walters, NCI',
    reviewerName: 'Cynthia Wolberger',
    legacy: true,
  };

  await act(async () => {
    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[]}
        mode="track"
        declineReferrals={[legacy]}
        onAddReferral={onAddReferral}
        onResolveLegacyReferral={onResolveLegacyReferral}
      />,
    );
    await Promise.resolve();
  });

  expect(screen.queryByRole('button', { name: /add as candidate/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /dismiss resolved note/i }));
  expect(onResolveLegacyReferral).toHaveBeenCalledWith(legacy);
  expect(onAddReferral).not.toHaveBeenCalled();
});

test('a structured person can only use the normal candidate-add action', async () => {
  const onAddReferral = jest.fn();
  const onResolveLegacyReferral = jest.fn();
  const referral = {
    referralId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:1',
    suggestionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    referralIndex: 1,
    referralName: 'Kylie Walters',
    referralText: 'Kylie Walters · NCI',
    institution: 'NCI',
    reviewerName: 'Cynthia Wolberger',
    legacy: false,
  };

  await act(async () => {
    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[]}
        mode="track"
        declineReferrals={[referral]}
        onAddReferral={onAddReferral}
        onResolveLegacyReferral={onResolveLegacyReferral}
      />,
    );
    await Promise.resolve();
  });

  fireEvent.click(screen.getByRole('button', { name: /add as candidate/i }));
  expect(onAddReferral).toHaveBeenCalledWith(referral);
  expect(screen.queryByRole('button', { name: /dismiss resolved note/i })).not.toBeInTheDocument();
  expect(onResolveLegacyReferral).not.toHaveBeenCalled();
});
