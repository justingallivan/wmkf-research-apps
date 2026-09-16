/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import EmailSendFeedback from '../../shared/components/EmailSendFeedback';

test('confirmed sends show only the concise outcome, even when a caller supplies technical receipt details', () => {
  render(
    <EmailSendFeedback
      status="sent"
      title="Custom success"
      message="Dynamics accepted the email from sender@example.org to recipient@example.org for delivery."
      details={['Dynamics activity ID: activity-1']}
    />,
  );
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Sent for delivery.');
  expect(status).not.toHaveTextContent('Custom success');
  expect(status).not.toHaveTextContent(/Dynamics accepted/i);
  expect(status).not.toHaveTextContent(/activity ID/i);
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
