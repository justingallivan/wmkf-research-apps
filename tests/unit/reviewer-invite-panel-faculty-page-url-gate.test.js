/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});

describe('ReviewerInvitePanel — facultyPageUrl document gate', () => {
  test('does not render a PDF facultyPageUrl as a clickable fallback', () => {
    render(
      <ReviewerInvitePanel
        requestId="REQ-1"
        candidates={[{
          suggestionId: 'S1',
          name: 'Dr X',
          email: null,
          facultyPageUrl: 'https://mit.edu/faculty/example-cv.pdf',
          website: null,
        }]}
        onRefresh={() => {}}
      />,
    );

    expect(screen.queryByRole('link', { name: /find on faculty page/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="https://mit.edu/faculty/example-cv.pdf"]')).toBeNull();
  });
});
