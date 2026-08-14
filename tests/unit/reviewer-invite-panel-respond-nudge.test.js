/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
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
jest.mock('../../shared/components/reviewers/RespondReminderModal', () => function RespondReminderModal({ candidate, onClose, onSent }) {
  return (
    <div>
      <span>{`Reminder modal for ${candidate.name}`}</span>
      <button type="button" onClick={onSent}>Complete reminder send</button>
      <button type="button" onClick={onClose}>Cancel reminder</button>
    </div>
  );
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

test('opens the editable reminder modal without sending and refreshes only after modal success', () => {
  const onRefresh = jest.fn();
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />);

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));

  expect(screen.getByText('Reminder modal for Dr. Pending')).toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Complete reminder send' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test('cancel closes the modal without refreshing', () => {
  const onRefresh = jest.fn();
  render(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />);

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reminder' }));
  expect(screen.queryByText('Reminder modal for Dr. Pending')).not.toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();
});

test('request identity owns modal state across A → B → A navigation', () => {
  const onRefresh = jest.fn();
  const { rerender } = render(
    <ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Send reminder to Dr. Pending' }));
  expect(screen.getByText('Reminder modal for Dr. Pending')).toBeInTheDocument();
  rerender(<ReviewerInvitePanel requestId="REQ-2" candidates={[pending]} onRefresh={onRefresh} />);
  rerender(<ReviewerInvitePanel requestId="REQ-1" candidates={[pending]} onRefresh={onRefresh} />);
  expect(screen.queryByText('Reminder modal for Dr. Pending')).not.toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();
});
