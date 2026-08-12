/**
 * @jest-environment jsdom
 */

/**
 * DOM-level behavior for the Phase 1 activity drawer
 * (`shared/components/reviewers/ReviewerActivityDrawer.js`).
 *
 * Opus finding 13 called out that no shared accessible drawer primitive exists, so
 * this one hand-rolls focus trapping, Escape close, and focus restoration. Those are
 * exactly the behaviors that look fine in a screenshot and are still broken, so they
 * are pinned here rather than left to a visual pass.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewerActivityDrawer from '../../shared/components/reviewers/ReviewerActivityDrawer';

const REVIEWER = {
  suggestionId: 'sug-1',
  name: 'Dr. Ada Lovelace',
  emailSentAt: '2026-07-01T10:00:00Z',
  materialsSentAt: '2026-07-20T10:00:00Z',
  thankyouSentAt: '2026-07-25T10:00:00Z',
  reminderSentAt: '2026-08-08T10:00:00Z',
  reminderCount: 2,
  reviewReceivedAt: null,
};

describe('ReviewerActivityDrawer', () => {
  it('exposes an accessible dialog labelled for the reviewer', () => {
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={jest.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Activity history' })).toBeInTheDocument();
    expect(screen.getByText('Dr. Ada Lovelace')).toBeInTheDocument();
  });

  it('moves focus into the drawer on open', () => {
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: /close activity history/i })).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the Close button is activated', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close activity history/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab inside the drawer instead of escaping to the page behind it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside-before</button>
        <ReviewerActivityDrawer reviewer={REVIEWER} onClose={jest.fn()} />
        <button type="button">outside-after</button>
      </>,
    );

    const close = screen.getByRole('button', { name: /close activity history/i });
    expect(close).toHaveFocus();

    // Close is the only focusable control in the drawer, so a forward Tab and a
    // backward Shift+Tab must both cycle back to it rather than reaching the
    // buttons rendered outside.
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it('restores focus to the trigger when it unmounts', async () => {
    const user = userEvent.setup();

    function Host() {
      const [open, setOpen] = require('react').useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>History</button>
          {open && (
            <ReviewerActivityDrawer reviewer={REVIEWER} onClose={() => setOpen(false)} />
          )}
        </>
      );
    }

    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'History' });

    await user.click(trigger);
    expect(screen.getByRole('button', { name: /close activity history/i })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders events newest-first with the delivery caveat only on unproven sends', () => {
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={jest.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Review reminder recorded');
    expect(items[0]).toHaveTextContent('2 reminders recorded in total');
    expect(items[items.length - 1]).toHaveTextContent('Invitation recorded');

    // Every event in this fixture is a staff-side send, so each carries the caveat.
    expect(screen.getAllByText(/delivery not confirmed/i)).toHaveLength(items.length);
  });

  it('states the derived, current-engagement scope so staff do not read it as a ledger', () => {
    render(<ReviewerActivityDrawer reviewer={REVIEWER} onClose={jest.fn()} />);

    expect(screen.getByText(/current engagement/i)).toBeInTheDocument();
    expect(screen.getByText(/Deadline extensions are not listed/i)).toBeInTheDocument();
  });

  it('shows an explicit empty state rather than a bare panel', () => {
    render(
      <ReviewerActivityDrawer
        reviewer={{ suggestionId: 'sug-2', name: 'New Reviewer' }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText(/No dated activity recorded for this reviewer yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows released as an undated current-status header without adding a release event', () => {
    render(
      <ReviewerActivityDrawer
        reviewer={{
          suggestionId: 'sug-3',
          name: 'Released Reviewer',
          reviewStatus: 'released',
          reminderSentAt: '2026-08-08T10:00:00Z',
        }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Current status: Released')).toBeInTheDocument();
    expect(screen.getByText(/No lifecycle timestamp is recorded/i)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/Release recorded/i)).not.toBeInTheDocument();
  });
});
