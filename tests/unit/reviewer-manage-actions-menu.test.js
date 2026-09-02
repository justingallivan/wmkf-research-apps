/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import {
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
