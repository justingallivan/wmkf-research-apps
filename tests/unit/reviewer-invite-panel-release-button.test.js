/**
 * @jest-environment jsdom
 */

// The "release as no longer needed" affordance must be ALWAYS VISIBLE
// (disabled until a still-pending invitee is selected). Owner discoverability
// report 2026-08-07: the previous appear-on-selection version was unfindable
// when the quota email told staff to release pending invitees. Also pins the
// no-internal-scrollbar decision (same report): the list must not cap its
// height and scroll internally.

import { render, screen, fireEvent } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/ReleaseEmailModal', () => function ReleaseEmailModal() {
  return <div data-testid="release-modal" />;
});

const accepted = {
  suggestionId: 'S-acc',
  name: 'Accepted Reviewer',
  email: 'accepted@example.edu',
  invited: true,
  accepted: true,
};
const pending = {
  suggestionId: 'S-pen',
  name: 'Pending Reviewer',
  email: 'pending@example.edu',
  invited: true,
  accepted: false,
  declined: false,
};

function renderPanel(candidates) {
  return render(
    <ReviewerInvitePanel requestId="REQ-1" candidates={candidates} onRefresh={() => {}} />,
  );
}

describe('ReviewerInvitePanel — release-pending affordance', () => {
  test('release button is visible and disabled with nothing selected', () => {
    renderPanel([accepted, pending]);
    const btn = screen.getByRole('button', { name: /release pending invites as no longer needed/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/has not yet responded/i));
  });

  test('selecting a still-pending invitee enables it and shows the count', () => {
    renderPanel([accepted, pending]);
    fireEvent.click(screen.getByRole('checkbox', { name: /select pending reviewer/i }));
    const btn = screen.getByRole('button', { name: /review & release 1 as no longer needed/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(screen.getByTestId('release-modal')).toBeInTheDocument();
  });

  test('accepted rows cannot feed the release flow (checkbox disabled)', () => {
    renderPanel([accepted, pending]);
    expect(screen.getByRole('checkbox', { name: /select accepted reviewer/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /release pending invites as no longer needed/i }),
    ).toBeDisabled();
  });

  test('candidate list does not scroll internally (no max-height overflow container)', () => {
    const { container } = renderPanel([accepted, pending]);
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    expect(list.className).not.toMatch(/max-h-|overflow-y/);
  });
});
