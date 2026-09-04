/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel, {
  ReviewReminderAction,
  TokenActionsMenu,
  TokenStateBadge,
} from '../../shared/components/reviewers/ReviewerManagePanel';

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
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
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

  test('uses a fixed six-column grid in read-only mode regardless of affiliation length', async () => {
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
    expect(table).toHaveClass('table-fixed', 'min-w-[64rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(6);
    expect(screen.getByText(longAffiliation)).toHaveClass('line-clamp-2', 'break-words');
    expect(screen.getByText(reviewer.email)).toHaveClass('truncate');
  });

  test('uses the corresponding seven-column grid when management controls are present without a release selection', async () => {
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
    expect(table).toHaveClass('table-fixed', 'min-w-[76rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(7);
  });

  test('separates follow-up and action controls into aligned labeled columns', async () => {
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
    expect(table).toHaveClass('table-fixed', 'min-w-[80rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(8);
    expect(screen.getByRole('columnheader', { name: 'Follow up' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reminder to Joshua Rosenthal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Joshua Rosenthal' })).toBeInTheDocument();
  });
});

describe('direct review follow-up action', () => {
  const originalFetch = global.fetch;
  const reviewer = {
    suggestionId: 'S1',
    name: 'Ada Reviewer',
    reviewStatus: 'materials_sent',
    reviewDueReminderEligibility: 'eligible',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends one request-bound review reminder and refreshes after confirmed success', async () => {
    const onSent = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    render(
      <ReviewReminderAction
        requestId="P1"
        reviewer={reviewer}
        onSent={onSent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/send-review-reminder', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: 'P1', suggestionId: 'S1' }),
    }));
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  test('shows the real control but cannot issue a write in read-only Preview', () => {
    global.fetch = jest.fn();

    render(
      <ReviewReminderAction
        requestId="P1"
        reviewer={reviewer}
        previewReadOnly
      />,
    );

    const button = screen.getByRole('button', {
      name: 'Send reminder to Ada Reviewer (disabled in read-only Preview)',
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('keeps rapid repeat clicks to one reminder send', async () => {
    let resolveRequest;
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));

    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} />);
    const button = screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
    });
  });

  test('does not offer a review-due reminder before materials are sent', () => {
    render(
      <ReviewReminderAction
        requestId="P1"
        reviewer={{ ...reviewer, reviewStatus: 'accepted' }}
      />,
    );

    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument();
  });

  test.each([
    ['token_revoked', /deliberately restore access/i],
    ['token_not_minted', /investigate the Materials history/i],
    ['token_invalid_data', /needs technical review/i],
    ['token_expired', /send an explicit replacement link/i],
    ['token_insufficient_window', /does not cover the deadline/i],
    ['due_date_missing', /set a review due date/i],
  ])('disables the consolidated follow-up action for %s', (eligibility, title) => {
    global.fetch = jest.fn();
    render(
      <ReviewReminderAction
        requestId="P1"
        reviewer={{ ...reviewer, reviewDueReminderEligibility: eligibility }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(title));
    fireEvent.click(button);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
