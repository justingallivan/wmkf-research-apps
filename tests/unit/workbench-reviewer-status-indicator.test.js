import { render, screen } from '@testing-library/react';
import ReviewerStatusIndicator from '../../shared/components/workbench/ReviewerStatusIndicator';

describe('ReviewerStatusIndicator', () => {
  test('shows explicit status counts and scales the bar by reviewers found', () => {
    const { container } = render(
      <ReviewerStatusIndicator reviewers={{
        needed: 3,
        candidates: 3,
        accepted: 1,
        progress: { total: 4, accepted: 1, pending: 1, declined: 1, uninvited: 1 },
      }} />,
    );

    expect(screen.getByText('1/3 accepted · 4 found')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByText('1 declined')).toBeInTheDocument();
    expect(screen.getByText('1 not invited')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '4 reviewers found: 1 accepted, 1 pending, 1 declined, 1 not invited' })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveStyle({ width: '72px' });
  });

  test('retains the old count-only display when progress is absent', () => {
    render(<ReviewerStatusIndicator reviewers={{ needed: 3, candidates: 2, accepted: 1 }} />);

    expect(screen.getByText('1/3 accepted · 2 found')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '2 reviewers found' })).toBeInTheDocument();
    expect(screen.queryByTitle('2 not invited')).not.toBeInTheDocument();
  });
});
