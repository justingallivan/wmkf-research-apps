/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import EmailSendFeedback from '../../shared/components/EmailSendFeedback';

test('confirmed sends use concise transport-accurate copy', () => {
  render(<EmailSendFeedback status="sent" />);
  expect(screen.getByRole('status')).toHaveTextContent('Sent for delivery.');
  expect(screen.getByRole('status')).toHaveTextContent('Dynamics accepted the email for delivery.');
  expect(screen.queryByText(/inbox delivery/i)).not.toBeInTheDocument();
});

test('definite failures are assertive and include recovery detail', () => {
  render(
    <EmailSendFeedback
      status="failed"
      message="Your account is not permitted to send from this mailbox."
      details={['No email was sent.']}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Not sent.');
  expect(screen.getByRole('alert')).toHaveTextContent('No email was sent.');
});

test('uncertain sends do not tell the user to retry', () => {
  render(<EmailSendFeedback status="uncertain" />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Send status is uncertain.');
  expect(status).toHaveTextContent('Check the email history before trying again.');
});
