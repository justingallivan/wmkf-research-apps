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

  test('uses the corresponding five-column grid when management controls are present', async () => {
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
    expect(table.querySelectorAll('colgroup col')).toHaveLength(5);
    expect(screen.getByRole('columnheader', { name: 'Next action' })).toBeInTheDocument();
  });

  test('combines follow-up and secondary controls into one aligned action lane', async () => {
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
    expect(table.querySelectorAll('colgroup col')).toHaveLength(5);
    expect(screen.queryByRole('columnheader', { name: 'Follow up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'Close review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Joshua Rosenthal' }));
    expect(screen.queryAllByRole('button', { name: 'Close review' })).toHaveLength(1);
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

  // Stage 6B2: bind feedback/onSent/lock release to committed request,
  // reviewer identity and read-only context, mirroring the 6B1 registry
  // pattern's epoch/mounted/generation checkpoints.
  function stagedFetch(stage) {
    if (stage === 'fetch') {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      global.fetch = jest.fn(() => promise);
      return { settle: () => resolve({ ok: true, json: async () => ({ ok: true }) }) };
    }
    if (stage === 'reject') {
      let reject;
      const promise = new Promise((_, r) => { reject = r; });
      global.fetch = jest.fn(() => promise);
      return { settle: () => reject(new Error('offline')) };
    }
    let resolve;
    const jsonPromise = new Promise((r) => { resolve = r; });
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => jsonPromise }));
    return { settle: () => resolve({ ok: true }) };
  }

  const otherReviewer = { ...reviewer, suggestionId: 'S2', name: 'Bea Reviewer' };
  const lifetimeContexts = [
    'request switch',
    'request A to B to A',
    'reviewer identity switch and back',
    'previewReadOnly true then back',
    'unmount',
  ];

  describe.each(['fetch', 'json', 'reject'])('reminder lifetime: deferred %s', (stage) => {
    test.each(lifetimeContexts)('%s leaves a departed attempt silent and releases the lock', async (change) => {
      const onSent = jest.fn();
      const staged = stagedFetch(stage);
      const props = { requestId: 'P1', reviewer, onSent, previewReadOnly: false };
      const { rerender, unmount } = render(<ReviewReminderAction {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
      expect(global.fetch).toHaveBeenCalledTimes(1);

      if (change === 'unmount') {
        unmount();
      } else if (change === 'request switch') {
        rerender(<ReviewReminderAction {...props} requestId="P2" />);
      } else if (change === 'request A to B to A') {
        rerender(<ReviewReminderAction {...props} requestId="P2" />);
        rerender(<ReviewReminderAction {...props} requestId="P1" />);
      } else if (change === 'reviewer identity switch and back') {
        rerender(<ReviewReminderAction {...props} reviewer={otherReviewer} />);
        rerender(<ReviewReminderAction {...props} reviewer={reviewer} />);
      } else {
        rerender(<ReviewReminderAction {...props} previewReadOnly />);
        rerender(<ReviewReminderAction {...props} previewReadOnly={false} />);
      }

      await act(async () => {
        staged.settle();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Neither success ("Reminder sent.") nor a rejection's error copy may
      // reach a departed session: both render via the same role="status"
      // element, so a departed context must show none of it at all.
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(onSent).not.toHaveBeenCalled();

      if (change === 'unmount') return;

      const button = screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // Settle the fresh attempt so it doesn't leave a dangling state update.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    });
  });

  test('same-context churn (new reviewer object, new onSent identity) calls only the latest onSent', async () => {
    const staged = stagedFetch('fetch');
    const oldOnSent = jest.fn();
    const newOnSent = jest.fn();
    const { rerender } = render(
      <ReviewReminderAction requestId="P1" reviewer={reviewer} onSent={oldOnSent} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    rerender(<ReviewReminderAction requestId="P1" reviewer={{ ...reviewer }} onSent={newOnSent} />);

    await act(async () => {
      staged.settle();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();
    expect(newOnSent).toHaveBeenCalledTimes(1);
    expect(oldOnSent).not.toHaveBeenCalled();
  });

  test('onSent sync throw keeps the confirmed feedback and never shows error copy', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const onSent = jest.fn(() => { throw new Error('boom'); });
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} onSent={onSent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('onSent rejected promise keeps the confirmed feedback and issues no second request', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const onSent = jest.fn(() => Promise.reject(new Error('refresh failed')));
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} onSent={onSent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('onSent that never resolves does not hold the send lock or feedback hostage', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const onSent = jest.fn(() => new Promise(() => {})); // never settles
    render(<ReviewReminderAction requestId="P1" reviewer={reviewer} onSent={onSent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();
    // No timer advance, no additional awaiting of the never-resolving promise:
    // the lock must already be released and the button re-enabled.
    expect(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' })).toBeEnabled();
  });

  test('a reviewer switch clears confirmed feedback from the departed session', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const { rerender } = render(<ReviewReminderAction requestId="P1" reviewer={reviewer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('Reminder sent.')).toBeInTheDocument();

    rerender(<ReviewReminderAction requestId="P1" reviewer={otherReviewer} />);
    expect(screen.queryByText('Reminder sent.')).not.toBeInTheDocument();
  });

  test('a request switch clears a confirmed failure message from the departed session', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: false, reason: 'not_found' }) }));
    const { rerender } = render(<ReviewReminderAction requestId="P1" reviewer={reviewer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));
    expect(await screen.findByText('This reviewer is no longer available. Refresh the list.')).toBeInTheDocument();

    rerender(<ReviewReminderAction requestId="P2" reviewer={reviewer} />);
    expect(screen.queryByText('This reviewer is no longer available. Refresh the list.')).not.toBeInTheDocument();
  });
});

describe('reminder lifetime wiring through the panel (D4)', () => {
  const proposal = { proposalId: 'P1', proposalTitle: 'Wiring test' };
  const reviewer = {
    suggestionId: 'S1',
    name: 'Ada Reviewer',
    reviewStatus: 'materials_sent',
    reviewDueReminderEligibility: 'eligible',
    tokenState: 'active',
  };

  function mockPanelFetch(reminderHandler) {
    return jest.fn((url, options) => {
      if (url === '/api/review-manager/send-review-reminder' && options?.method === 'POST') return reminderHandler(url, options);
      if (url === '/api/review-manager/release-settings') return Promise.resolve({ ok: true, json: async () => ({ attachProposalEmail: false }) });
      if (url.startsWith('/api/review-manager/materials-preflight?')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, fileCount: 1 }) });
      if (url.startsWith('/api/user-preferences')) return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url === '/api/review-manager/render-emails') return Promise.resolve({ ok: true, json: async () => ({ drafts: [] }) });
      throw new Error(`Unexpected UI request: ${url}`);
    });
  }

  test('flipping canManage during a pending reminder send does not refresh with the stale attempt', async () => {
    let resolveReminder;
    global.fetch = mockPanelFetch(() => new Promise((resolve) => { resolveReminder = resolve; }));
    const onRefresh = jest.fn();
    const { rerender } = render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage
        showReviewReminderAction
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Ada Reviewer' }));

    rerender(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage={false}
        showReviewReminderAction
        onRefresh={onRefresh}
      />,
    );

    await act(async () => {
      resolveReminder({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('Reminder sent.')).not.toBeInTheDocument();
  });
});
