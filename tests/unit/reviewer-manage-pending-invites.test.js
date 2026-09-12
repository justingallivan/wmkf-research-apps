/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));
jest.mock('../../shared/components/reviewers/email-template-store', () => ({
  ...jest.requireActual('../../shared/components/reviewers/email-template-store'),
  loadEmailTemplates: jest.fn(async () => ({ materials: { subject: 'S', body: 'B' }, followup: {}, thankyou: {} })),
}));
jest.mock('../../shared/components/reviewers/ReviewerCloseoutModal', () => function CloseoutStub() { return null; });

const proposal = { proposalId: 'p1', proposalTitle: 'Proposal', reviewDeadline: '2026-09-09' };
const complete = { suggestionId: 'c1', name: 'Done Reviewer', email: 'd@example.org', reviewStatus: 'complete', tokenState: 'active', submitted: true, reviewReceivedAt: '2026-09-08T00:00:00Z' };
const pending = [{ suggestionId: 'i1', name: 'Benjamin Garcia', affiliation: 'Biochemistry and Biophysics, U', email: 'b@example.org', invited: true, accepted: false, declined: false, responseType: null, emailSentAt: '2026-08-20T00:00:00Z' }];

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});
afterEach(() => jest.restoreAllMocks());

test('Track lists invited-but-unanswered reviewers as a trailing group with a jump to Invite', () => {
  const onGoToInvite = jest.fn();
  render(
    <ReviewerManagePanel proposal={proposal} reviewers={[complete]} canManage mode="track" pendingInvites={pending} onGoToInvite={onGoToInvite} />,
  );
  const group = screen.getByTestId('pending-invites');
  expect(group).toHaveTextContent('1 invited, awaiting response');
  expect(group).toHaveTextContent('Benjamin Garcia');
  expect(group).toHaveTextContent('Synthesis waits on every open invitation');
  fireEvent.click(screen.getByRole('button', { name: 'Manage in Invite Reviewers' }));
  expect(onGoToInvite).toHaveBeenCalledTimes(1);
});

test('no group when nothing is pending, and none outside track mode', () => {
  const { rerender } = render(<ReviewerManagePanel proposal={proposal} reviewers={[complete]} canManage mode="track" pendingInvites={[]} />);
  expect(screen.queryByTestId('pending-invites')).not.toBeInTheDocument();
  rerender(<ReviewerManagePanel proposal={proposal} reviewers={[complete]} canManage mode="all" pendingInvites={pending} />);
  expect(screen.queryByTestId('pending-invites')).not.toBeInTheDocument();
});
