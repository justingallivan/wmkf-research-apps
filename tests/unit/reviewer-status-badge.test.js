import { render, screen } from '@testing-library/react';
import {
  StatusBadge,
  reviewerHasReceivedReview,
} from '../../shared/components/reviewers/ReviewerManagePanel';

describe('reviewer status badge links', () => {
  test('links received and complete statuses to the request reviews tab', () => {
    const { rerender } = render(
      <StatusBadge status="review_received" href="/workbench/request-a?tab=reviews" />,
    );

    expect(screen.getByRole('link', { name: 'Review Received' })).toHaveAttribute(
      'href',
      '/workbench/request-a?tab=reviews',
    );

    rerender(<StatusBadge status="complete" href="/workbench/request-a?tab=reviews" />);
    expect(screen.getByRole('link', { name: 'Complete' })).toHaveAttribute(
      'href',
      '/workbench/request-a?tab=reviews',
    );
  });

  test('keeps non-submitted statuses as non-links', () => {
    render(<StatusBadge status="materials_sent" />);
    expect(screen.getByText('Materials Sent').tagName).toBe('SPAN');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('treats received timestamps, submitted reviews, and terminal statuses as received', () => {
    expect(reviewerHasReceivedReview({ reviewReceivedAt: '2026-09-06T12:00:00Z' })).toBe(true);
    expect(reviewerHasReceivedReview({ submitted: true, reviewStatus: 'under_review' })).toBe(true);
    expect(reviewerHasReceivedReview({ reviewStatus: 'complete' })).toBe(true);
    expect(reviewerHasReceivedReview({ reviewStatus: 'materials_sent', reminderCount: 2 })).toBe(false);
  });
});
