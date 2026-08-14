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
