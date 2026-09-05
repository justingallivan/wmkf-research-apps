/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerCloseoutModal, {
  closeoutDispositionLabel,
} from '../../shared/components/reviewers/ReviewerCloseoutModal';

const REVIEWER = {
  suggestionId: '11111111-1111-4111-8111-111111111111',
  name: 'Dr. Reviewer',
  reviewStatus: 'review_received',
  honorariumEligibility: null,
  honorariumOptOut: false,
  honorariumRequestId: 'honorarium-1',
  notes: 'Existing context',
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

  test('opt-out skips the payment question and records not applicable automatically', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    render(<ReviewerCloseoutModal
      isOpen
      reviewer={{ ...REVIEWER, honorariumOptOut: true, honorariumRequestId: null, notes: '' }}
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
