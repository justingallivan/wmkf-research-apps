/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';
import { formatReferredByReason } from '../../lib/utils/reviewer-provenance';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});

const panel = (reasoning) => render(
  <ReviewerInvitePanel
    requestId="REQ-1"
    candidates={[{ suggestionId: 'S1', name: 'Lukasz Bugaj', email: 'bugaj@seas.upenn.edu', reasoning }]}
    onRefresh={() => {}}
  />,
);

// The referrer is persisted inside the match reason, so before S424 it could only be
// read as prose in the "Why:" line. It is now its own labeled row.
describe('ReviewerInvitePanel — referral attribution line', () => {
  test('labels the referrer and drops the now-empty rationale', () => {
    panel(formatReferredByReason('Mikhail Shapiro'));

    expect(screen.getByText('Referred by:')).toBeInTheDocument();
    expect(screen.getByText(/Mikhail Shapiro/)).toBeInTheDocument();
    // The prod shape: a referral with no note must not leave a bare "Why:" label.
    expect(screen.queryByText('Why:')).not.toBeInTheDocument();
  });

  test('shows both rows when the referral also carries a note, without repeating the referrer', () => {
    const { container } = panel(formatReferredByReason('Mikhail Shapiro', 'Synthesis expert.'));

    expect(screen.getByText('Referred by:')).toBeInTheDocument();
    expect(screen.getByText('Why:')).toBeInTheDocument();
    expect(screen.getByText(/Synthesis expert\./)).toBeInTheDocument();
    // Exclusion, not absence: the referrer IS present on the card — assert it appears
    // exactly once, so a regression that leaves the clause in the prose fails here.
    expect(container.textContent.match(/Mikhail Shapiro/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Why:\s*Referred by/);
  });

  test('a name carrying a period survives to the card intact', () => {
    panel(formatReferredByReason('Dr. Abby Doyle', 'Synthesis expert.'));
    expect(screen.getByText(/Dr\. Abby Doyle/)).toBeInTheDocument();
  });

  test('an ordinary candidate still shows only the rationale', () => {
    panel('Manually added by staff.');

    expect(screen.queryByText('Referred by:')).not.toBeInTheDocument();
    expect(screen.getByText('Why:')).toBeInTheDocument();
    expect(screen.getByText(/Manually added by staff\./)).toBeInTheDocument();
  });

  test('a candidate with no rationale renders neither row', () => {
    panel(null);

    expect(screen.queryByText('Referred by:')).not.toBeInTheDocument();
    expect(screen.queryByText('Why:')).not.toBeInTheDocument();
  });
});
