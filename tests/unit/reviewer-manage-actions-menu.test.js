/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel, { TokenActionsMenu } from '../../shared/components/reviewers/ReviewerManagePanel';

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

    fireEvent.change(screen.getByLabelText('Correct status for Dr. Test Reviewer'), {
      target: { value: 'under_review' },
    });
    expect(onStatusChange).toHaveBeenCalledWith('under_review');

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Test Reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record reviewer withdrawal' }));
    expect(onTransition).toHaveBeenCalledWith('withdrew');
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

  test('uses the corresponding eight-column grid when management controls are present', async () => {
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
    expect(table).toHaveClass('table-fixed', 'min-w-[72rem]');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(8);
  });
});
