/**
 * @jest-environment jsdom
 */

// "Remove from this request/proposal" must warn when the reviewer has ACCEPTED
// and point to "Record reviewer withdrawal", because Remove erases the
// acceptance (softDelete resets accepted/response/status) and the withdrawal
// path is unreachable afterwards (terminal-transition requires wmkf_accepted).
// Request 1002833, 2026-09-02: an accepted reviewer with materials sent was
// removed instead of withdrawn. The warning is absent for non-accepted rows so
// the ordinary candidate-removal dialog is unchanged.

import { render, screen, fireEvent } from '@testing-library/react';
import { acceptedReviewerRemoveWarning } from '../../shared/components/reviewers/remove-reviewer-confirm';
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
  return null;
});
jest.mock('../../shared/components/reviewers/RemoveEntirelyModal', () => function RemoveEntirelyModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/RespondReminderModal', () => function RespondReminderModal() {
  return null;
});

describe('acceptedReviewerRemoveWarning', () => {
  test('accepted → names the withdrawal action and its location', () => {
    const sameMenu = acceptedReviewerRemoveWarning({ accepted: true, withdrawalLocation: 'same-menu' });
    expect(sameMenu).toContain('accepted the invitation');
    expect(sameMenu).toContain('Record reviewer withdrawal');
    expect(sameMenu).toContain('in this same menu');

    const track = acceptedReviewerRemoveWarning({ accepted: true, withdrawalLocation: 'track-reviewers' });
    expect(track).toContain('Record reviewer withdrawal');
    expect(track).toContain('on their row in Track Reviewers');
  });

  test('not accepted → empty string (dialog unchanged)', () => {
    expect(acceptedReviewerRemoveWarning({ accepted: false, withdrawalLocation: 'same-menu' })).toBe('');
    expect(acceptedReviewerRemoveWarning({ accepted: undefined, withdrawalLocation: 'track-reviewers' })).toBe('');
  });

  test('unknown location falls back to Track Reviewers rather than a blank', () => {
    expect(acceptedReviewerRemoveWarning({ accepted: true, withdrawalLocation: 'nowhere' }))
      .toContain('on their row in Track Reviewers');
  });
});

describe('ReviewerInvitePanel remove confirm wiring', () => {
  const baseProps = { requestId: 'REQ-1', onRefresh: jest.fn(), canManage: true };
  const accepted = {
    suggestionId: 'S-acc', name: 'Accepted Reviewer', email: 'a@example.edu', invited: true, accepted: true,
  };
  const pending = {
    suggestionId: 'S-pen', name: 'Pending Reviewer', email: 'p@example.edu', invited: true, accepted: false, declined: false,
  };

  // jest.setup.js installs the global fetch mock (the panel fetches VIP flags
  // on mount); only assert that no DELETE was issued after a cancelled confirm.
  const deleteCalls = () => fetch.mock.calls.filter((c) => c[1]?.method === 'DELETE');

  let confirmSpy;
  beforeEach(() => {
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false); // cancel → no DELETE
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  // One candidate per render, so the single row "Remove ▾" menu is unambiguous.
  function openRemove() {
    fireEvent.click(screen.getByTitle('Remove this candidate'));
    fireEvent.click(screen.getByText('Remove from this proposal'));
  }

  test('accepted candidate → confirm text carries the withdrawal warning; cancel sends nothing', () => {
    render(<ReviewerInvitePanel {...baseProps} candidates={[accepted]} />);
    openRemove();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const text = confirmSpy.mock.calls[0][0];
    expect(text).toContain('Remove Accepted Reviewer from this request?');
    expect(text).toContain('Record reviewer withdrawal');
    expect(text).toContain('on their row in Track Reviewers');
    expect(deleteCalls()).toHaveLength(0);
  });

  test('pending candidate → ordinary dialog, no withdrawal warning', () => {
    render(<ReviewerInvitePanel {...baseProps} candidates={[pending]} />);
    openRemove();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const text = confirmSpy.mock.calls[0][0];
    expect(text).toContain('Remove Pending Reviewer from this request?');
    expect(text).not.toContain('Record reviewer withdrawal');
    expect(text).toContain('revokes their invitation link');
  });
});
