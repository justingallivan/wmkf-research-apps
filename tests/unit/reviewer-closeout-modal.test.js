/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import ReviewerCloseoutModal, {
  closeoutDispositionLabel,
} from '../../shared/components/reviewers/ReviewerCloseoutModal';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

const REVIEWER = {
  suggestionId: '11111111-1111-4111-8111-111111111111',
  name: 'Dr. Reviewer',
  reviewStatus: 'review_received',
  honorariumEligibility: null,
  honorariumOptOut: false,
  honorariumRequestId: 'honorarium-1',
  notes: 'Existing context',
};

// Opts out of the honorarium question so "Complete closeout" is enabled
// without first clicking a disposition radio -- keeps the lifetime matrix
// below focused on session identity rather than form completeness.
const OPTOUT_REVIEWER = {
  suggestionId: '22222222-2222-4222-8222-222222222222',
  name: 'Dr. Optout Reviewer',
  reviewStatus: 'review_received',
  honorariumEligibility: null,
  honorariumOptOut: true,
  honorariumRequestId: null,
  notes: '',
};
const OTHER_OPTOUT_REVIEWER = {
  ...OPTOUT_REVIEWER,
  suggestionId: '33333333-3333-4333-8333-333333333333',
  name: 'Dr. Other Optout Reviewer',
};

describe('ReviewerCloseoutModal', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('saves one allowed disposition and refreshes after confirmed success', async () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, changed: true }),
    }));

    render(<ReviewerCloseoutModal
      isOpen
      reviewer={REVIEWER}
      proposal={{ requestNumber: 'R-1001', proposalTitle: 'A Proposal' }}
      onClose={onClose}
      onSaved={onSaved}
    />);
    expect(screen.getByText('R-1001 · A Proposal')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toHaveValue('Existing context');
    expect(screen.getByRole('group', { name: 'Should an honorarium be paid?' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Not applicable' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Closeout notes/ }), {
      target: { value: 'Slow response; useful review.' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));

    await screen.findByRole('button', { name: 'Complete closeout' });
    expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/close-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestionId: REVIEWER.suggestionId,
        disposition: 'eligible',
        notes: 'Slow response; useful review.',
      }),
    });
    expect(onSaved).toHaveBeenCalledWith({ success: true, changed: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('prevents duplicate submissions while the first write is pending', async () => {
    let resolveRequest;
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<ReviewerCloseoutModal isOpen reviewer={REVIEWER} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    const submit = screen.getByRole('button', { name: 'Complete closeout' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ ok: true, json: async () => ({ success: true }) });
      await Promise.resolve();
    });
  });

  test('shows the server error and keeps the dialog open', async () => {
    const onClose = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Closeout prerequisites changed. Reload and try again.' }),
    }));
    render(<ReviewerCloseoutModal isOpen reviewer={REVIEWER} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Closeout prerequisites changed. Reload and try again.');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('unknown stored values fail closed and legacy null remains explicit', () => {
    expect(closeoutDispositionLabel(null)).toBe('Closeout disposition not recorded');
    expect(closeoutDispositionLabel('not_eligible')).toBe('Not eligible');
    render(
      <ReviewerCloseoutModal
        isOpen
        reviewer={{ ...REVIEWER, reviewStatus: 'complete', honorariumEligibility: 'unknown' }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Technical repair is required');
    expect(screen.getByRole('button', { name: 'Save closeout' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toBeDisabled();
  });

  test('No makes notes required and blocks closeout until a reason is entered', () => {
    render(<ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER, notes: '' }} onClose={jest.fn()} />);

    const notes = screen.getByRole('textbox', { name: /Closeout notes/ });
    expect(notes).not.toBeRequired();
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(notes).toBeRequired();
    expect(screen.getByText('(required)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete closeout' })).toBeDisabled();

    fireEvent.change(notes, { target: { value: 'The review did not address the proposal.' } });
    expect(screen.getByRole('button', { name: 'Complete closeout' })).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(notes).not.toBeRequired();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  test('No submits not eligible with the required reason', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    render(<ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER, notes: '' }} onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Closeout notes/ }), {
      target: { value: 'The review did not address the proposal.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/close-review', expect.objectContaining({
        body: JSON.stringify({
          suggestionId: REVIEWER.suggestionId,
          disposition: 'not_eligible',
          notes: 'The review did not address the proposal.',
        }),
      }));
    });
  });

  test('opt-out skips the payment question and records not applicable automatically', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    render(<ReviewerCloseoutModal
      isOpen
      reviewer={{ ...REVIEWER, honorariumOptOut: true, notes: '' }}
      onClose={jest.fn()}
    />);

    expect(screen.queryByText('Should an honorarium be paid?')).not.toBeInTheDocument();
    expect(screen.getByText('The reviewer opted out, so no honorarium decision is needed.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).not.toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/close-review', expect.objectContaining({
        body: JSON.stringify({
          suggestionId: REVIEWER.suggestionId,
          disposition: 'not_applicable',
          notes: '',
        }),
      }));
    });
  });

  test('a missing honorarium link also skips the payment question', () => {
    render(<ReviewerCloseoutModal
      isOpen
      reviewer={{ ...REVIEWER, honorariumOptOut: false, honorariumRequestId: null, notes: '' }}
      onClose={jest.fn()}
    />);

    expect(screen.queryByText('Should an honorarium be paid?')).not.toBeInTheDocument();
    expect(screen.getByText('No honorarium is linked, so no payment decision is needed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete closeout' })).toBeEnabled();
  });
});

// Stage 6B2: bind onSaved/onClose/error and the saving lock to committed
// isOpen/reviewer identity/requestId/canManage/previewReadOnly context,
// mirroring the 6B1 registry pattern's epoch/mounted/generation checkpoints.
describe('ReviewerCloseoutModal lifetime', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stagedFetch(stage) {
    if (stage === 'fetch') {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      global.fetch = jest.fn(() => promise);
      return { settle: () => resolve({ ok: true, json: async () => ({ success: true }) }) };
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
    return { settle: () => resolve({ success: true }) };
  }

  const lifetimeContexts = [
    'reviewer switch',
    'reviewer A to B to A',
    'requestId switch',
    'canManage false and back',
    'previewReadOnly true and back',
    'isOpen false and back',
    'unmount',
  ];

  describe.each(['fetch', 'json', 'reject'])('deferred %s', (stage) => {
    test.each(lifetimeContexts)('%s leaves a departed attempt silent and releases the lock', async (change) => {
      const staged = stagedFetch(stage);
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const props = {
        isOpen: true,
        reviewer: OPTOUT_REVIEWER,
        requestId: 'R1',
        canManage: true,
        previewReadOnly: false,
        onSaved,
        onClose,
      };
      const { rerender, unmount } = render(<ReviewerCloseoutModal {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
      expect(global.fetch).toHaveBeenCalledTimes(1);

      if (change === 'unmount') {
        unmount();
      } else if (change === 'reviewer switch') {
        rerender(<ReviewerCloseoutModal {...props} reviewer={OTHER_OPTOUT_REVIEWER} />);
      } else if (change === 'reviewer A to B to A') {
        rerender(<ReviewerCloseoutModal {...props} reviewer={OTHER_OPTOUT_REVIEWER} />);
        rerender(<ReviewerCloseoutModal {...props} reviewer={OPTOUT_REVIEWER} />);
      } else if (change === 'requestId switch') {
        rerender(<ReviewerCloseoutModal {...props} requestId="R2" />);
      } else if (change === 'canManage false and back') {
        rerender(<ReviewerCloseoutModal {...props} canManage={false} />);
        rerender(<ReviewerCloseoutModal {...props} canManage />);
      } else if (change === 'previewReadOnly true and back') {
        rerender(<ReviewerCloseoutModal {...props} previewReadOnly />);
        rerender(<ReviewerCloseoutModal {...props} previewReadOnly={false} />);
      } else {
        rerender(<ReviewerCloseoutModal {...props} isOpen={false} />);
        rerender(<ReviewerCloseoutModal {...props} isOpen />);
      }

      await act(async () => {
        staged.settle();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      if (change === 'unmount') return;

      const submit = screen.getByRole('button', { name: 'Complete closeout' });
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
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

  test('a new session reinitializes disposition/notes from the current row and clears a prior error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'stale error' }) }));
    const { rerender } = render(
      <ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER, notes: 'Old notes' }} onClose={jest.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toHaveValue('Old notes');
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('stale error');

    rerender(
      <ReviewerCloseoutModal
        isOpen
        reviewer={{ ...OTHER_OPTOUT_REVIEWER, notes: 'New row notes' }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toHaveValue('New row notes');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('same-row refresh (new object, same id) preserves typed notes and disposition', () => {
    const { rerender } = render(
      <ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER }} onClose={jest.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: /Closeout notes/ }), {
      target: { value: 'My draft note' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    rerender(<ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER }} onClose={jest.fn()} />);
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toHaveValue('My draft note');
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  });

  test('a management/read-only permission flip does not erase typed notes (ADVISORY-3)', () => {
    const { rerender } = render(
      <ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER }} canManage onClose={jest.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: /Closeout notes/ }), {
      target: { value: 'A draft in progress' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    // The permission flip still invalidates in-flight feedback (it bumps the
    // epoch), but it must not reinitialize the form the way a reviewer/
    // request/open-close identity change does.
    rerender(<ReviewerCloseoutModal isOpen reviewer={{ ...REVIEWER }} canManage={false} onClose={jest.fn()} />);
    expect(screen.getByRole('textbox', { name: /Closeout notes/ })).toHaveValue('A draft in progress');
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  });

  test('onSaved sync throw still closes the modal once, no error copy, one request', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const onClose = jest.fn();
    const onSaved = jest.fn(() => { throw new Error('boom'); });
    render(<ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('onSaved rejected promise still closes the modal once, no error copy, one request', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const onClose = jest.fn();
    const onSaved = jest.fn(() => Promise.reject(new Error('refresh failed')));
    render(<ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('onSaved that never resolves does not hold the modal open or the save lock', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const onClose = jest.fn();
    const onSaved = jest.fn(() => new Promise(() => {})); // never settles
    render(<ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    // No timer advance, no additional awaiting of the never-resolving promise:
    // onClose must already have been called and the lock released.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('onSaved that switches the session prevents closing the replacement modal', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const onClose = jest.fn();
    let rerenderRef;
    const onSaved = jest.fn(() => {
      flushSync(() => {
        rerenderRef(
          <ReviewerCloseoutModal isOpen reviewer={OTHER_OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />,
        );
      });
    });
    const { rerender } = render(
      <ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />,
    );
    rerenderRef = rerender;
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('onSaved that unmounts prevents a stale onClose call', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const onClose = jest.fn();
    let unmountRef;
    const onSaved = jest.fn(() => {
      flushSync(() => { unmountRef(); });
    });
    const { unmount } = render(
      <ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={onSaved} onClose={onClose} />,
    );
    unmountRef = unmount;
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('callback identity churn before settle calls only the latest onSaved/onClose', async () => {
    const staged = stagedFetch('fetch');
    const oldOnSaved = jest.fn();
    const oldOnClose = jest.fn();
    const newOnSaved = jest.fn();
    const newOnClose = jest.fn();
    const { rerender } = render(
      <ReviewerCloseoutModal isOpen reviewer={OPTOUT_REVIEWER} onSaved={oldOnSaved} onClose={oldOnClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete closeout' }));
    rerender(
      <ReviewerCloseoutModal isOpen reviewer={{ ...OPTOUT_REVIEWER }} onSaved={newOnSaved} onClose={newOnClose} />,
    );

    await act(async () => {
      staged.settle();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(newOnSaved).toHaveBeenCalledTimes(1);
    expect(newOnClose).toHaveBeenCalledTimes(1);
    expect(oldOnSaved).not.toHaveBeenCalled();
    expect(oldOnClose).not.toHaveBeenCalled();
  });
});

describe('closeout lifetime wiring through the panel (D4)', () => {
  const originalFetch = global.fetch;
  const proposal = { proposalId: 'P1', proposalTitle: 'Wiring test' };
  const reviewer = {
    suggestionId: '11111111-1111-4111-8111-111111111111',
    name: 'Dr. Reviewer',
    reviewStatus: 'review_received',
    honorariumOptOut: true,
    honorariumRequestId: null,
    notes: '',
    tokenState: 'active',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockPanelFetch(closeoutHandler) {
    return jest.fn((url, options) => {
      if (url === '/api/review-manager/close-review' && options?.method === 'POST') return closeoutHandler(url, options);
      if (url === '/api/review-manager/release-settings') return Promise.resolve({ ok: true, json: async () => ({ attachProposalEmail: false }) });
      if (url.startsWith('/api/review-manager/materials-preflight?')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, fileCount: 1 }) });
      if (url.startsWith('/api/user-preferences')) return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url === '/api/review-manager/render-emails') return Promise.resolve({ ok: true, json: async () => ({ drafts: [] }) });
      throw new Error(`Unexpected UI request: ${url}`);
    });
  }

  test('flipping canManage during a pending closeout save does not refresh or close the stale modal', async () => {
    let resolveCloseout;
    global.fetch = mockPanelFetch(() => new Promise((resolve) => { resolveCloseout = resolve; }));
    const onRefresh = jest.fn();
    const { rerender } = render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete closeout' }));

    rerender(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage={false}
        onRefresh={onRefresh}
      />,
    );

    await act(async () => {
      resolveCloseout({ ok: true, json: async () => ({ success: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('flipping previewReadOnly during a pending closeout save does not refresh or close the stale modal', async () => {
    let resolveCloseout;
    global.fetch = mockPanelFetch(() => new Promise((resolve) => { resolveCloseout = resolve; }));
    const onRefresh = jest.fn();
    const { rerender } = render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete closeout' }));

    rerender(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage
        previewReadOnly
        onRefresh={onRefresh}
      />,
    );

    await act(async () => {
      resolveCloseout({ ok: true, json: async () => ({ success: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('switching proposal.proposalId during a pending closeout save does not refresh or close the stale modal', async () => {
    let resolveCloseout;
    global.fetch = mockPanelFetch(() => new Promise((resolve) => { resolveCloseout = resolve; }));
    const onRefresh = jest.fn();
    const { rerender } = render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        mode="track"
        canManage
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete closeout' }));

    rerender(
      <ReviewerManagePanel
        proposal={{ ...proposal, proposalId: 'P2' }}
        reviewers={[reviewer]}
        mode="track"
        canManage
        onRefresh={onRefresh}
      />,
    );

    await act(async () => {
      resolveCloseout({ ok: true, json: async () => ({ success: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
