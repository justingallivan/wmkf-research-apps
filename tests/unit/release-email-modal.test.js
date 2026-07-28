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
  fireEvent.click(screen.getByRole('button', { name: 'Send and release 1' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Send and release 2' }));

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
