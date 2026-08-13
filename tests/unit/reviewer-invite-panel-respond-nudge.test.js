/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
jest.mock('../../shared/components/reviewers/ReleaseEmailModal', () => function ReleaseEmailModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/RemoveEntirelyModal', () => function RemoveEntirelyModal() {
  return null;
});

const pending = {
  suggestionId: 'S-PENDING',
  name: 'Dr. Pending',
  email: 'pending@example.edu',
  invited: true,
  accepted: false,
  declined: false,
  responseType: null,
  emailSentAt: '2026-08-01T00:00:00Z',
  respondReminderSentAt: '2026-08-10T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  window.confirm.mockRestore();
  window.alert.mockRestore();
});

test('renders the action only for an active pending invite and surfaces last-nudged state', () => {
  render(
    <ReviewerInvitePanel
      requestId="REQ-1"
      candidates={[pending]}
      removedCandidates={[{
        ...pending,
        suggestionId: 'S-REMOVED',
        name: 'Dr. Removed',
        wasInvited: true,
      }]}
    />,
  );

  expect(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send reminder to Dr. Removed' })).not.toBeInTheDocument();
  expect(screen.getByText(/last nudged/i)).toBeInTheDocument();
});

test('confirms the real email, sends kind=respond, and refreshes the current request', async () => {
  const onRefresh = jest.fn();
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />);

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/real email.*cannot be undone/s));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    requestId: 'REQ-1',
    suggestionId: 'S-PENDING',
    kind: 'respond',
  });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});

test.each([
  ['removed', /restore them first/i],
  ['revoked', /access was withdrawn/i],
  ['conflict', /already claimed by another send/i],
])('maps the %s refusal to actionable copy', async (reason, copy) => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, reason }) });
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));

  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(copy)));
});

test('a late response cannot revive state or affect an A → B → A navigation', async () => {
  let resolveFetch;
  global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
  const onRefresh = jest.fn();
  const { rerender } = render(
    <ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));
  rerender(<ReviewerInvitePanel requestId="REQ-2" candidates={[pending]} onRefresh={onRefresh} />);
  rerender(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />);
  expect(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' })).not.toBeDisabled();
  resolveFetch({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'removed' }) });

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(onRefresh).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
});
