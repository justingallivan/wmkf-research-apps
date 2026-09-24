/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel, {
  ReviewReminderAction,
  TokenActionsMenu,
  TokenStateBadge,
} from '../../shared/components/reviewers/ReviewerManagePanel';
import { reviewerDocumentIsPending } from '../../shared/components/reviewers/reviewer-document-state';

jest.mock('../../shared/components/reviewers/RespondReminderModal', () => function MockReminderModal({ kind, onClose, onStale }) {
  return <div role="dialog" data-testid="reminder-composer" data-kind={kind}><button type="button" onClick={onClose}>Close composer</button><button type="button" onClick={onStale}>Stale reminder</button></div>;
});

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

describe('reviewer management actions menu', () => {
  const reviewer = {
    suggestionId: 'S1',
    name: 'Dr. Test Reviewer',
    reviewStatus: 'materials_sent',
    tokenState: 'active',
    reviewDueReminderEligibility: 'eligible',
    submitted: false,
    reviewReceivedAt: null,
  };

  test('groups status correction and terminal workflows behind one clear action menu', () => {
    const onStatusChange = jest.fn();
    const onTransition = jest.fn();

    render(
      <TokenActionsMenu
        reviewer={reviewer}
        onRegenerate={jest.fn()}
        onRevoke={jest.fn()}
        onRemove={jest.fn()}
        onStatusChange={onStatusChange}
        onTransition={onTransition}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));

    expect(screen.getByText('Correct recorded status')).toBeInTheDocument();
    expect(screen.getByText('Use only to fix the recorded stage. No email is sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record reviewer withdrawal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release from assignment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate link & copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Correct status for Dr. Test Reviewer'), {
      target: { value: 'under_review' },
    });
    expect(onStatusChange).toHaveBeenCalledWith('under_review');

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record reviewer withdrawal' }));
    expect(onTransition).toHaveBeenCalledWith('withdrew');
  });

  test('invalid token metadata renders a data-review warning instead of looking unsent', () => {
    render(<TokenStateBadge state="invalid" expiresAt={null} firstAccessedAt={null} />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.queryByText('Not sent')).not.toBeInTheDocument();
  });

  test('review-received and complete rows use the dedicated closeout action', () => {
    const onCloseReview = jest.fn();
    const { rerender } = render(
      <TokenActionsMenu
        reviewer={{ ...reviewer, reviewStatus: 'review_received' }}
        onCloseReview={onCloseReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(onCloseReview).toHaveBeenCalledTimes(1);

    rerender(
      <TokenActionsMenu
        reviewer={{ ...reviewer, reviewStatus: 'complete' }}
        onCloseReview={onCloseReview}
        onRemove={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));
    expect(screen.queryByText('Correct recorded status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from this request' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit closeout' }));
    expect(onCloseReview).toHaveBeenCalledTimes(2);
  });

  test('invalid token metadata can be revoked but cannot be regenerated', () => {
    const onRevoke = jest.fn();
    render(
      <TokenActionsMenu
        reviewer={{ ...reviewer, tokenState: 'invalid' }}
        onRegenerate={jest.fn()}
        onRevoke={onRevoke}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));

    expect(screen.getByText('Token metadata needs repair. Do not regenerate this link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate link & copy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate link & copy' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['unknown response type', { responseType: 'unknown', reviewStatus: 'accepted' }],
    ['unknown review status', { responseType: 'accepted', reviewStatus: 'unknown' }],
  ])('unknown lifecycle %s cannot regenerate a revoked row', (_label, lifecycle) => {
    render(
      <TokenActionsMenu
        reviewer={{
          ...reviewer,
          ...lifecycle,
          tokenState: 'revoked',
          lifecycleValid: false,
        }}
        onRegenerate={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));

    expect(screen.queryByRole('button', { name: 'Regenerate link & copy' })).not.toBeInTheDocument();
  });

  test('keeps held rows eligible for regeneration', () => {
    const onRegenerate = jest.fn();
    render(
      <TokenActionsMenu
        reviewer={{
          ...reviewer,
          responseType: 'held',
          tokenState: 'revoked',
          lifecycleValid: true,
        }}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate link & copy' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe('reviewer table geometry', () => {
  const proposal = {
    proposalId: 'P1',
    proposalTitle: 'Layout test',
    reviewDeadline: '2026-09-09',
  };
  const longAffiliation = 'The Eugene Bell Center, The Marine Biological Laboratory, Woods Hole, Massachusetts, United States of America';
  const reviewer = {
    suggestionId: 'S1',
    name: 'Joshua Rosenthal',
    affiliation: longAffiliation,
    email: 'jrosenthal@marine-biological-laboratory.example.org',
    reviewStatus: 'materials_sent',
    tokenState: 'active',
    reviewDueReminderEligibility: 'eligible',
  };

  test('uses a compact four-column grid in read-only mode regardless of affiliation length', async () => {
    let container;
    await act(async () => {
      ({ container } = render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[reviewer]}
          canManage={false}
          mode="track"
        />,
      ));
      await Promise.resolve();
    });

    const table = container.querySelector('table');
    expect(table).toHaveClass('table-fixed', 'min-w-[48rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByText(longAffiliation)).toHaveClass('line-clamp-2', 'break-words');
    expect(screen.getByText(reviewer.email)).toHaveClass('truncate');
  });

  test('uses dedicated action columns when management controls are present', async () => {
    let container;
    await act(async () => {
      ({ container } = render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[reviewer]}
          canManage
          mode="track"
        />,
      ));
      await Promise.resolve();
    });

    const table = container.querySelector('table');
    expect(table).toHaveClass('table-fixed', 'min-w-[58rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(7);
    expect(screen.getByRole('columnheader', { name: 'Next action' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Download/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'More' })).toBeInTheDocument();
  });

  test('keeps follow-up controls separate from download and secondary actions', async () => {
    let container;
    await act(async () => {
      ({ container } = render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[reviewer]}
          canManage
          mode="track"
          showReviewReminderAction
        />,
      ));
      await Promise.resolve();
    });

    const table = container.querySelector('table');
    expect(table).toHaveClass('table-fixed', 'min-w-[58rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(7);
    expect(screen.queryByRole('columnheader', { name: 'Follow up' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Download/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Next action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reminder to Joshua Rosenthal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Joshua Rosenthal' })).toBeInTheDocument();
  });

  test('surfaces closeout as the primary row action instead of burying it in the menu', async () => {
    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[{
            ...reviewer,
            reviewStatus: 'review_received',
            reviewReceivedAt: '2026-09-04T12:00:00.000Z',
          }]}
          canManage
          mode="track"
          showReviewReminderAction
        />,
      );
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Joshua Rosenthal' }));
    expect(screen.queryAllByRole('button', { name: 'Mark complete' })).toHaveLength(1);
  });

  test('shows a non-clickable pending download icon while a completed structured review awaits filing', async () => {
    const pending = {
      ...reviewer,
      reviewStatus: 'complete',
      reviewReceivedAt: '2026-09-15T19:03:32.000Z',
      honorariumEligibility: 'eligible',
      reviewSharePointFolder: null,
      answers: [{ questionKey: 'assessment', questionType: 'richtext', answerText: 'Strong proposal.' }],
    };

    expect(reviewerDocumentIsPending(pending)).toBe(true);

    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[pending]}
          canManage
          mode="track"
        />,
      );
      await Promise.resolve();
    });

    const preparing = screen.getByLabelText('Review document for Joshua Rosenthal is being prepared');
    expect(preparing).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link', { name: /Download review from Joshua Rosenthal/i })).not.toBeInTheDocument();

    expect(reviewerDocumentIsPending({ ...pending, reviewStatus: 'review_received' })).toBe(false);
    expect(reviewerDocumentIsPending({ ...pending, reviewSharePointFolder: '1003046_GUID/Reviews' })).toBe(false);
    expect(reviewerDocumentIsPending({ ...pending, answers: [] })).toBe(false);
  });

  test('keeps a no-response row in the dedicated history group without accepted actions', async () => {
    const noResponse = {
      suggestionId: 'S-no-response',
      name: 'No Response Reviewer',
      affiliation: 'Research Institute',
      email: 'no-response@example.org',
      reviewStatus: null,
      responseType: 'no_response',
      responseReceivedAt: '2026-09-05T12:00:00Z',
      meetingDate: '2026-09-10T00:00:00Z',
      withdrawnSufficientAt: null,
      tokenState: 'revoked',
      reviewDueReminderEligibility: 'not_due',
      submitted: false,
      reviewReceivedAt: null,
    };

    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[reviewer]}
          noResponseHistory={[noResponse]}
          canManage
          mode="track"
        />,
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId('no-response-history')).toBeInTheDocument();
    expect(screen.getByText('No-response history (1)')).toBeInTheDocument();
    expect(screen.queryByText('Released')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Select No Response Reviewer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release proposal/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View activity history for No Response Reviewer' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('No response to invitation')).toBeInTheDocument();
    expect(screen.getByText('Recorded by staff')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Manage No Response Reviewer' })).not.toBeInTheDocument();
  });
});

describe('review-due reminder compose action', () => {
  const reviewer = {
    suggestionId: 'S1', name: 'Ada Reviewer', reviewStatus: 'materials_sent',
    reviewDueReminderEligibility: 'eligible',
  };

  test('opens an editable review-due composer without sending immediately', () => {
    global.fetch = jest.fn();
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(screen.getByTestId('reminder-composer')).toHaveAttribute('data-kind', 'reviewdue');
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close composer' }));
    expect(screen.queryByTestId('reminder-composer')).not.toBeInTheDocument();
  });

  test('a stale review-due preview refreshes the parent reviewer list', () => {
    const onRefresh = jest.fn();
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} onSent={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stale reminder' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('read-only Preview cannot open a composer', () => {
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} previewReadOnly />);
    const button = screen.getByRole('button', { name: 'Send reminder to Ada Reviewer (disabled in read-only Preview)' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByTestId('reminder-composer')).not.toBeInTheDocument();
  });

  test('does not offer a review-due reminder before materials are sent', () => {
    render(<ReviewReminderAction requestId="P1" reviewer={{ ...reviewer, reviewStatus: 'accepted' }} />);
    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument();
  });

  test.each(['token_revoked', 'token_not_minted', 'token_invalid_data', 'token_expired', 'token_insufficient_window', 'due_date_missing'])(
    '%s blocks the composer', (eligibility) => {
      render(<ReviewReminderAction requestId="P1" reviewer={{ ...reviewer, reviewDueReminderEligibility: eligibility }} />);
      const button = screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(screen.queryByTestId('reminder-composer')).not.toBeInTheDocument();
    },
  );

  test('request or reviewer context change closes a pending composer', () => {
    const { rerender } = render(<ReviewReminderAction requestId="P1" reviewer={reviewer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(screen.getByTestId('reminder-composer')).toBeInTheDocument();
    rerender(<ReviewReminderAction requestId="P2" reviewer={reviewer} />);
    expect(screen.queryByTestId('reminder-composer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    rerender(<ReviewReminderAction requestId="P2" reviewer={{ ...reviewer, suggestionId: 'S2' }} />);
    expect(screen.queryByTestId('reminder-composer')).not.toBeInTheDocument();
  });
});
