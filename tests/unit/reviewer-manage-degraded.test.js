/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerManagePanel, { ReviewReminderAction } from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));
jest.mock('../../shared/components/reviewers/email-template-store', () => ({
  ...jest.requireActual('../../shared/components/reviewers/email-template-store'),
  loadEmailTemplates: jest.fn(async () => ({ materials: { subject: 'S', body: 'B' }, followup: {}, thankyou: {} })),
}));
jest.mock('../../shared/components/reviewers/ReviewerCloseoutModal', () => function CloseoutStub() { return null; });

const proposal = { proposalId: 'p1', proposalTitle: 'Proposal', reviewDeadline: '2026-09-09' };
const accepted = { suggestionId: 'a1', name: 'Accepted', email: 'a@example.org', reviewStatus: 'accepted', tokenState: 'active' };
const received = { suggestionId: 'r1', name: 'Received', email: 'r@example.org', reviewStatus: 'review_received', tokenState: 'active' };
const reminderReviewer = { ...accepted, reviewStatus: 'materials_sent', reviewDueReminderEligibility: 'eligible', submitted: false, reviewReceivedAt: null };

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('email-templates')) return Promise.resolve({ ok: true, json: async () => ({}) });
    if (u.includes('release-settings')) return Promise.resolve({ ok: true, json: async () => ({ attachProposalEmail: false }) });
    if (u.includes('materials-preflight')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, fileCount: 0 }) });
    if (u.includes('render-emails')) return Promise.resolve({ ok: true, json: async () => ({ drafts: [{ suggestionId: 'a1', candidateName: 'Accepted', candidateEmail: 'a@example.org', subject: 'S', body: 'B' }] }) });
    throw new Error(`unexpected fetch ${u}`);
  });
});

afterEach(() => jest.restoreAllMocks());

test('degraded disables traced mutation controls and re-enables them', async () => {
  const rows = [accepted, received, { ...reminderReviewer, suggestionId: 'm1', name: 'Reminder' }];
  const { rerender } = render(
    <ReviewerManagePanel proposal={proposal} reviewers={rows} canManage mode="track" showReviewReminderAction />,
  );
  // Not degraded: the reminder row is eligible, so its send control is live.
  expect(screen.getByRole('button', { name: /send reminder to Reminder/i })).toBeEnabled();
  rerender(<ReviewerManagePanel proposal={proposal} reviewers={rows} canManage mode="track" showReviewReminderAction degraded />);
  expect(screen.getByRole('button', { name: /release proposal/i })).toBeDisabled();
  expect(screen.getAllByRole('button', { name: /manage /i })[0]).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close review' })).toBeDisabled();
  // Panel wiring, not the component prop in isolation: the reminder send is
  // gated through the panel's `degraded` prop.
  expect(screen.getByRole('button', { name: /send reminder to Reminder/i })).toBeDisabled();
  render(<ReviewReminderAction requestId="p1" reviewer={reminderReviewer} degraded previewReadOnly={false} />);
  expect(screen.getByRole('button', { name: /send reminder to Accepted/i })).toBeDisabled();
  const calls = global.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /release proposal/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
  fireEvent.click(screen.getByRole('button', { name: /send reminder to Reminder/i }));
  expect(global.fetch.mock.calls.length).toBe(calls);
  rerender(<ReviewerManagePanel proposal={proposal} reviewers={rows} canManage mode="track" showReviewReminderAction degraded={false} />);
  expect(screen.getByRole('button', { name: /release proposal/i })).toBeEnabled();
  expect(screen.getAllByRole('button', { name: /manage /i })[0]).toBeEnabled();
});

test('degraded keeps the mounted materials modal and only disables Send', async () => {
  const { rerender } = render(<ReviewerManagePanel proposal={proposal} reviewers={[accepted]} canManage mode="track" />);
  fireEvent.click(screen.getByRole('button', { name: /release proposal/i }));
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /send 1 email/i })).toBeInTheDocument());
  rerender(<ReviewerManagePanel proposal={proposal} reviewers={[accepted]} canManage mode="track" degraded />);
  expect(screen.getByRole('button', { name: /send 1 email/i })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeEnabled();
});
