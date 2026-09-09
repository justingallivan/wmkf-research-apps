/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReleaseEmailModal from '../../shared/components/reviewers/ReleaseEmailModal';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_ID = '33333333-3333-4333-8333-333333333333';

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: jest.fn(async () => body),
  };
}

function draft(suggestionId, name, to) {
  return {
    suggestionId,
    status: 'ok',
    name,
    to,
    from: 'pd@example.org',
    senderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    subject: `Subject for ${name}`,
    bodyText: `Dear ${name},\n\nReviewed body.`,
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('an unmounted in-flight send cannot close or clear a later parent state', async () => {
  let resolveSend;
  const sendResponse = new Promise((resolve) => {
    resolveSend = resolve;
  });
  global.fetch
    .mockResolvedValueOnce(response({
      ok: true,
      drafts: [draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org')],
    }))
    .mockImplementationOnce(() => sendResponse);
  const onClose = jest.fn();
  const onReleased = jest.fn();
  const view = render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={onClose}
      onReleased={onReleased}
    />,
  );

  await screen.findByDisplayValue('Subject for Dr. First Reviewer');
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const close = screen.getByRole('button', { name: 'Close' });
  expect(cancel).toBeDisabled();
  expect(close).toBeDisabled();
  fireEvent.click(cancel);
  fireEvent.click(close);
  expect(onClose).not.toHaveBeenCalled();

  view.unmount();
  await act(async () => {
    resolveSend(response({
      ok: true,
      withdrawn: 1,
      results: [{ suggestionId: FIRST_ID, status: 'withdrawn_emailed' }],
    }));
    await sendResponse;
  });

  expect(onReleased).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('sends complete reviewed rows and names every non-allowlisted result', async () => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  const second = draft(SECOND_ID, 'Dr. Failed Reviewer', 'failed@example.org');
  const results = [
    { suggestionId: FIRST_ID, status: 'withdrawn_emailed' },
    { suggestionId: SECOND_ID, status: 'withdrawn_email_failed' },
  ];
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first, second] }))
    .mockResolvedValueOnce(response({ ok: true, withdrawn: 2, results }));
  const onClose = jest.fn();
  const onReleased = jest.fn();
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID, SECOND_ID]}
      onClose={onClose}
      onReleased={onReleased}
    />,
  );

  await screen.findByDisplayValue(first.subject);
  fireEvent.change(screen.getAllByLabelText('Message')[0], {
    target: { value: 'Edited complete body' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Release (2)' }));

  await screen.findByText(/1 emailed\. 1 issue:/);
  expect(screen.getByText(/Dr\. Failed Reviewer — The reviewer was released, but the email failed/))
    .toBeInTheDocument();
  const sendBody = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(sendBody.overrides).toEqual({
    [FIRST_ID]: {
      subject: first.subject,
      bodyText: 'Edited complete body',
      to: first.to,
      from: first.from,
      senderId: first.senderId,
    },
    [SECOND_ID]: {
      subject: second.subject,
      bodyText: second.bodyText,
      to: second.to,
      from: second.from,
      senderId: second.senderId,
    },
  });
  expect(onReleased).toHaveBeenCalledWith(results);
  expect(onClose).not.toHaveBeenCalled();
});

test('no response hides previews and releases without an email by default', async () => {
  global.fetch.mockResolvedValueOnce(response({
    ok: true,
    drafts: [draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org')],
  })).mockResolvedValueOnce(response({
    ok: true,
    withdrawn: 1,
    results: [{ suggestionId: FIRST_ID, status: 'withdrawn_no_email_by_reason' }],
  }));
  const onClose = jest.fn();
  const onReleased = jest.fn();
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={onClose}
      onReleased={onReleased}
    />,
  );

  await screen.findByDisplayValue('Subject for Dr. First Reviewer');
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  expect(screen.queryByDisplayValue('Subject for Dr. First Reviewer')).not.toBeInTheDocument();
  expect(screen.getByText('No email will be sent. The link is disabled and the invitation is recorded as unanswered.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Also send a courtesy note' })).not.toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  const body = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(body).toEqual({
    requestId: REQUEST_ID,
    suggestionIds: [FIRST_ID],
    reason: 'no_response',
  });
  expect(onReleased).toHaveBeenCalledWith([{ suggestionId: FIRST_ID, status: 'withdrawn_no_email_by_reason' }]);
  expect(onClose).toHaveBeenCalled();
});

test('no response with courtesy note restores previews and posts reviewed overrides', async () => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  global.fetch.mockResolvedValueOnce(response({ ok: true, drafts: [first] }))
    .mockResolvedValueOnce(response({
      ok: true,
      withdrawn: 1,
      results: [{ suggestionId: FIRST_ID, status: 'withdrawn_emailed' }],
    }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Also send a courtesy note' }));
  expect(screen.getByDisplayValue(first.subject)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  const body = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(body.reason).toBe('no_response');
  expect(body.overrides[FIRST_ID]).toEqual({
    subject: first.subject,
    bodyText: first.bodyText,
    to: first.to,
    from: first.from,
    senderId: first.senderId,
  });
});

test('no response without a courtesy note does not wait for the preview request', async () => {
  let resolvePreview;
  const previewPending = new Promise((resolve) => { resolvePreview = resolve; });
  global.fetch
    .mockImplementationOnce(() => previewPending)
    .mockResolvedValueOnce(response({
      ok: true,
      withdrawn: 1,
      results: [{ suggestionId: FIRST_ID, status: 'withdrawn_no_email_by_reason', reason: 'no_response' }],
    }));
  const onClose = jest.fn();
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={onClose}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  expect(screen.getByText('No email will be sent. The link is disabled and the invitation is recorded as unanswered.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Release (1)' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    requestId: REQUEST_ID,
    suggestionIds: [FIRST_ID],
    reason: 'no_response',
  });
  expect(onClose).toHaveBeenCalled();
  resolvePreview(response({ ok: true, drafts: [] }));
});
