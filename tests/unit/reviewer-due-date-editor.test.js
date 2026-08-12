/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerDueDateEditor, { minimumExtensionDate } from '../../shared/components/reviewers/ReviewerDueDateEditor';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

function successfulResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, saved: true, notified: true, effectiveReviewDeadline: '2099-09-15' }),
  };
}

beforeEach(() => {
  global.fetch = jest.fn(async () => successfulResponse());
});

test('Grant extension opens a modal showing the original date and saves with automatic notification', async () => {
  const onSaved = jest.fn();
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      reviewerName="Ada Lovelace"
      effectiveDate="2099-09-01"
      defaultDate="2099-09-01"
      onSaved={onSaved}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /grant extension/i }));
  expect(screen.getByRole('dialog', { name: /grant extension/i })).toBeInTheDocument();
  expect(screen.getByText(/original deadline/i)).toBeInTheDocument();
  expect(screen.getByText('Sep 1, 2099')).toBeInTheDocument();
  const dateInput = screen.getByLabelText(/new deadline/i);
  expect(dateInput).toHaveAttribute('min', '2099-09-02');
  fireEvent.change(dateInput, { target: { value: '2099-09-15' } });
  fireEvent.click(screen.getByRole('button', { name: /save extension/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/review-manager/review-due-extension',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        suggestionId: SUGGESTION_ID,
        reviewDueDateOverride: '2099-09-15',
      }),
    }),
  ));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('an existing extension displays original and extended dates and can be restored', async () => {
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      reviewerName="Ada Lovelace"
      overrideDate="2099-09-15"
      effectiveDate="2099-09-15"
      defaultDate="2099-09-01"
    />,
  );

  expect(screen.getByText('Extended: Sep 15, 2099')).toBeInTheDocument();
  expect(screen.getByText('Original: Sep 1, 2099')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /change extension/i }));
  fireEvent.click(screen.getByRole('button', { name: /restore original deadline/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/review-manager/review-due-extension',
    expect.objectContaining({
      body: JSON.stringify({
        action: 'save',
        suggestionId: SUGGESTION_ID,
        reviewDueDateOverride: null,
      }),
    }),
  ));
});

test('an existing extension exposes an explicit server-fresh resend without changing the date', async () => {
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      reviewerName="Ada Lovelace"
      overrideDate="2099-09-15"
      effectiveDate="2099-09-15"
      defaultDate="2099-09-01"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /change extension/i }));
  fireEvent.click(screen.getByRole('button', { name: /resend deadline email/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/review-manager/review-due-extension',
    expect.objectContaining({
      body: JSON.stringify({ action: 'retry', suggestionId: SUGGESTION_ID }),
    }),
  ));
});

test('shows a reload instruction for a server-side concurrency conflict', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ ok: false, reason: 'conflict' }),
  });
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      effectiveDate="2099-09-01"
      defaultDate="2099-09-01"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /grant extension/i }));
  fireEvent.change(screen.getByLabelText(/new deadline/i), { target: { value: '2099-09-15' } });
  fireEvent.click(screen.getByRole('button', { name: /save extension/i }));

  expect(await screen.findByText(/changed while this dialog was open.*reload/i)).toBeInTheDocument();
});

test('a saved-but-unsent response keeps the modal open and retries from server state', async () => {
  const onSaved = jest.fn();
  global.fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, saved: true, notified: false, retryable: true, reason: 'send_failed' }),
    })
    .mockResolvedValueOnce(successfulResponse());
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      reviewerName="Ada Lovelace"
      effectiveDate="2099-09-01"
      defaultDate="2099-09-01"
      onSaved={onSaved}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /grant extension/i }));
  fireEvent.change(screen.getByLabelText(/new deadline/i), { target: { value: '2099-09-15' } });
  fireEvent.click(screen.getByRole('button', { name: /save extension/i }));

  expect(await screen.findByText(/deadline was saved, but the reviewer notification was not sent/i)).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /retry email/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
    '/api/review-manager/review-due-extension',
    expect.objectContaining({
      body: JSON.stringify({ action: 'retry', suggestionId: SUGGESTION_ID }),
    }),
  ));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('a failed retry keeps the saved-deadline fact visible', async () => {
  global.fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, saved: true, notified: false, retryable: true, reason: 'send_failed' }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, saved: false, notified: false, retryable: true, reason: 'send_failed' }),
    });
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      effectiveDate="2099-09-01"
      defaultDate="2099-09-01"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /grant extension/i }));
  fireEvent.change(screen.getByLabelText(/new deadline/i), { target: { value: '2099-09-15' } });
  fireEvent.click(screen.getByRole('button', { name: /save extension/i }));
  fireEvent.click(await screen.findByRole('button', { name: /retry email/i }));

  expect(await screen.findByText(/deadline is still saved.*could not send the deadline email/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry email/i })).toBeInTheDocument();
});

test('read-only mode shows the dates without extension controls', () => {
  render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      overrideDate="2099-09-15"
      effectiveDate="2099-09-15"
      defaultDate="2099-09-01"
      canManage={false}
    />,
  );

  expect(screen.getByText('Extended: Sep 15, 2099')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('minimum extension date is the later of today and the day after the original', () => {
  expect(minimumExtensionDate('2099-09-01', '2099-08-01')).toBe('2099-09-02');
  expect(minimumExtensionDate('2020-09-01', '2099-08-01')).toBe('2099-08-01');
});

test('ignores a response that finishes after the component unmounts', async () => {
  let finishRequest;
  global.fetch = jest.fn(() => new Promise((resolve) => {
    finishRequest = () => resolve(successfulResponse());
  }));
  const onSaved = jest.fn();
  const { unmount } = render(
    <ReviewerDueDateEditor
      suggestionId={SUGGESTION_ID}
      effectiveDate="2099-09-01"
      defaultDate="2099-09-01"
      onSaved={onSaved}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /grant extension/i }));
  fireEvent.change(screen.getByLabelText(/new deadline/i), { target: { value: '2099-09-15' } });
  fireEvent.click(screen.getByRole('button', { name: /save extension/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  unmount();
  finishRequest();

  await Promise.resolve();
  expect(onSaved).not.toHaveBeenCalled();
});
