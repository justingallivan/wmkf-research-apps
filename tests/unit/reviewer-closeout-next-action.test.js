/**
 * @jest-environment jsdom
 *
 * Owner decision (2026-09-08): a completed review with a disposition already
 * recorded has no outstanding to-do, so the Next-action cell shows no button
 * for it -- editing stays available only through the row's More menu. See
 * shared/components/reviewers/ReviewerManagePanel.js `closeoutNextAction`
 * (exported via `_managePanelInternals` for this file) and the JSX consumer
 * around the "Next action" column.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel, {
  _managePanelInternals,
} from '../../shared/components/reviewers/ReviewerManagePanel';

const { closeoutNextAction, honorariumEligibilityPillInfo } = _managePanelInternals;

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

describe('closeoutNextAction', () => {
  test('review_received -> Mark complete', () => {
    expect(closeoutNextAction({ reviewStatus: 'review_received' })).toEqual({ label: 'Mark complete' });
  });

  test('complete + null disposition -> Record closeout', () => {
    expect(closeoutNextAction({ reviewStatus: 'complete', honorariumEligibility: null }))
      .toEqual({ label: 'Record closeout' });
  });

  test.each(['eligible', 'not_eligible', 'not_applicable', 'unknown'])(
    'complete + %s disposition -> null (edit only via the More menu)',
    (honorariumEligibility) => {
      expect(closeoutNextAction({ reviewStatus: 'complete', honorariumEligibility })).toBeNull();
    },
  );

  test.each(['accepted', 'materials_sent', 'under_review', 'withdrew', 'released'])(
    'other status (%s) -> null',
    (reviewStatus) => {
      expect(closeoutNextAction({ reviewStatus })).toBeNull();
    },
  );

  test('missing/undefined reviewer -> null', () => {
    expect(closeoutNextAction(undefined)).toBeNull();
    expect(closeoutNextAction({})).toBeNull();
  });
});

describe('Next-action column wiring through the panel', () => {
  const proposal = { proposalId: 'P1', proposalTitle: 'Closeout wiring test' };
  const baseReviewer = {
    suggestionId: 'S1',
    name: 'Dr. Closeout Reviewer',
    tokenState: 'active',
  };

  test('complete + recorded disposition renders no Next-action button, but the More menu still opens the closeout modal', async () => {
    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[{ ...baseReviewer, reviewStatus: 'complete', honorariumEligibility: 'eligible' }]}
          canManage
          mode="track"
        />,
      );
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: 'Record closeout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit closeout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
    expect(screen.getByText('Honorarium eligibility: eligible')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Closeout Reviewer' }));
    const editButton = screen.getByRole('button', { name: 'Edit closeout' });
    expect(editButton).toBeInTheDocument();

    fireEvent.click(editButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit reviewer closeout')).toBeInTheDocument();
  });

  test('complete + no recorded disposition renders the Record closeout primary button', async () => {
    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[{ ...baseReviewer, reviewStatus: 'complete', honorariumEligibility: null }]}
          canManage
          mode="track"
        />,
      );
      await Promise.resolve();
    });

    expect(screen.getByText('Honorarium eligibility not recorded')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Record closeout' });
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit reviewer closeout')).toBeInTheDocument();
  });

  test('review_received still shows Mark complete as the sole primary action, with no menu duplicate', async () => {
    await act(async () => {
      render(
        <ReviewerManagePanel
          proposal={proposal}
          reviewers={[{ ...baseReviewer, reviewStatus: 'review_received' }]}
          canManage
          mode="track"
        />,
      );
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    expect(screen.queryByText(/Honorarium eligibility/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Closeout Reviewer' }));
    expect(screen.queryAllByRole('button', { name: 'Mark complete' })).toHaveLength(1);
  });
});

describe('honorariumEligibilityPillInfo', () => {
  test.each([
    ['eligible', 'Eligible', 'Honorarium eligibility: eligible', 'neutral'],
    ['not_eligible', 'None', 'Honorarium eligibility: not eligible', 'neutral'],
    ['not_applicable', 'N/A', 'Honorarium eligibility: not applicable', 'neutral'],
    [null, 'Undecided', 'Honorarium eligibility not recorded', 'amber'],
    [undefined, 'Undecided', 'Honorarium eligibility not recorded', 'amber'],
    ['bogus', 'Undecided', 'Honorarium eligibility not recorded', 'amber'],
    ['unknown', 'Needs review', 'Honorarium eligibility: saved disposition not recognized; technical repair required', 'amber'],
  ])('%s -> text=%s, label=%s, tone=%s', (value, text, label, tone) => {
    expect(honorariumEligibilityPillInfo(value)).toEqual({ text, label, tone });
  });
});
