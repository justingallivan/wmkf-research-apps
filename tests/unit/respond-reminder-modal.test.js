/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RespondReminderModal from '../../shared/components/reviewers/RespondReminderModal';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const SENDER_ID = '33333333-3333-4333-8333-333333333333';
const candidate = { suggestionId: SUGGESTION_ID, name: 'Dr. Reviewer' };
const draft = {
  suggestionId: SUGGESTION_ID,
  name: 'Dr. Reviewer',
  to: 'reviewer@example.org',
  from: 'pd@keck.org',
  senderId: SENDER_ID,
  subject: 'Original subject',
  bodyText: 'Original body',
};

function response({ ok = true, status = 200, data = {} } = {}) {
  return { ok, status, json: async () => data };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('loads a read-only preview and Cancel performs no send request', async () => {
  global.fetch.mockResolvedValueOnce(response({ data: { ok: true, draft } }));
  const onClose = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={onClose} />);

  expect(await screen.findByDisplayValue('Original subject')).toBeInTheDocument();
  expect(screen.getByText(/fresh, secure.*Accept or decline.*server/i)).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    kind: 'respond',
    action: 'preview',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('sends the edited copy with previewed identities as freshness guards', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ data: { ok: true, draft } }))
    .mockResolvedValueOnce(response({ data: { ok: true } }));
  const onClose = jest.fn();
  const onSent = jest.fn();
  render(
    <RespondReminderModal
      requestId={REQUEST_ID}
      candidate={candidate}
      onClose={onClose}
      onSent={onSent}
    />,
  );

  fireEvent.change(await screen.findByDisplayValue('Original subject'), { target: { value: 'Edited subject' } });
  fireEvent.change(screen.getByDisplayValue('Original body'), { target: { value: 'Edited body' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    kind: 'respond',
    action: 'send',
    reviewed: {
      subject: 'Edited subject',
      bodyText: 'Edited body',
      to: 'reviewer@example.org',
      from: 'pd@keck.org',
      senderId: SENDER_ID,
    },
  });
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText(/Sent for delivery/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('blank edits fail closed in the modal', async () => {
  global.fetch.mockResolvedValueOnce(response({ data: { ok: true, draft } }));
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);

  fireEvent.change(await screen.findByDisplayValue('Original subject'), { target: { value: '   ' } });

  expect(screen.getByText('Subject and message cannot be empty.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeDisabled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('typed stale preview failures are actionable and refresh the parent', async () => {
  global.fetch.mockResolvedValueOnce(response({ ok: false, status: 409, data: { ok: false, reason: 'removed' } }));
  const onStale = jest.fn();
  render(
    <RespondReminderModal
      requestId={REQUEST_ID}
      candidate={candidate}
      onClose={jest.fn()}
      onStale={onStale}
    />,
  );

  expect(await screen.findByText(/removed from the proposal.*restore them first/i)).toBeInTheDocument();
  expect(onStale).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Retry preview' })).toBeInTheDocument();
});

test('T4 request bytes: preview POST sends exact method, headers, and body', async () => {
  global.fetch.mockResolvedValueOnce(response({ data: { ok: true, draft } }));
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByDisplayValue('Original subject');
  expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/send-review-reminder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: REQUEST_ID,
      suggestionId: SUGGESTION_ID,
      kind: 'respond',
      action: 'preview',
    }),
  });
});

test('T4 axis (network): a preview network rejection surfaces its message', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByText('Network error loading preview: offline')).toBeInTheDocument();
});

test('T4 axis (d): a malformed 2xx preview body falls back to the generic load-error message', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByText('Could not load the reminder preview.')).toBeInTheDocument();
});

test('T4 axis (e): a non-2xx preview body that fails to parse is never silent', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } });
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  expect(await screen.findByText('Could not load the reminder preview.')).toBeInTheDocument();
});

test('T4 axis (network, send): a send network rejection reports the uncertain outcome, never "sent"', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ data: { ok: true, draft } }))
    .mockRejectedValueOnce(new Error('offline'));
  const onSent = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  await screen.findByDisplayValue('Original subject');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('The app could not confirm the result. Check reviewer activity before trying again.')).toBeInTheDocument();
  expect(onSent).not.toHaveBeenCalled();
  expect(screen.queryByText(/Sent for delivery/)).not.toBeInTheDocument();
});

test('D10 fix: a malformed 2xx send body reports the uncertain receipt, not failed or sent', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ data: { ok: true, draft } }))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  const onSent = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  await screen.findByDisplayValue('Original subject');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('The app could not confirm the result. Check reviewer activity before trying again.')).toBeInTheDocument();
  expect(onSent).not.toHaveBeenCalled();
  expect(screen.queryByText(/Sent for delivery/)).not.toBeInTheDocument();
  expect(screen.queryByText('Could not send the reminder. Refresh and try again.')).not.toBeInTheDocument();
});

test('T4 axis (e, send): a non-2xx send body that fails to parse is never silent', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ data: { ok: true, draft } }))
    .mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } });
  const onSent = jest.fn();
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} onSent={onSent} />);
  await screen.findByDisplayValue('Original subject');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('Could not send the reminder. Refresh and try again.')).toBeInTheDocument();
  expect(onSent).not.toHaveBeenCalled();
});

test('a send failure with reason "send_unconfirmed" reports the uncertain outcome', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ data: { ok: true, draft } }))
    .mockResolvedValueOnce(response({ ok: true, status: 200, data: { ok: false, reason: 'send_unconfirmed' } }));
  render(<RespondReminderModal requestId={REQUEST_ID} candidate={candidate} onClose={jest.fn()} />);
  await screen.findByDisplayValue('Original subject');
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('Dynamics did not confirm the send. Check reviewer activity before trying again.')).toBeInTheDocument();
});

test('late preview completion after unmount is ignored', async () => {
  let resolvePreview;
  global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolvePreview = resolve; }));
  const onStale = jest.fn();
  const { unmount } = render(
    <RespondReminderModal
      requestId={REQUEST_ID}
      candidate={candidate}
      onClose={jest.fn()}
      onStale={onStale}
    />,
  );

  unmount();
  resolvePreview(response({ ok: false, status: 409, data: { ok: false, reason: 'removed' } }));
  await Promise.resolve();
  await Promise.resolve();

  expect(onStale).not.toHaveBeenCalled();
});
