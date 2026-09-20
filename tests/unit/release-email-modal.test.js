/**
 * @jest-environment jsdom
 */

import { StrictMode } from 'react';
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

test('opens with no reason chosen: nothing rendered, nothing fetched, release disabled', () => {
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID, SECOND_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  expect(screen.getByRole('radio', { name: /^No longer needed/ })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: /^No response/ })).not.toBeChecked();
  expect(screen.queryByRole('checkbox', { name: 'Also send a courtesy note' })).not.toBeInTheDocument();
  expect(screen.queryByText('Rendering emails…')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Release (2)' })).toBeDisabled();
});

test('choosing No longer needed renders the previews once and keeps them when switching reasons', async () => {
  global.fetch.mockResolvedValueOnce(response({
    ok: true,
    drafts: [draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org')],
  }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue('Subject for Dr. First Reviewer');
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  expect(screen.queryByDisplayValue('Subject for Dr. First Reviewer')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Also send a courtesy note' }));
  expect(screen.getByDisplayValue('Subject for Dr. First Reviewer')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
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

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
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

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.change(screen.getAllByLabelText('Message')[0], {
    target: { value: 'Edited complete body' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Release (2)' }));

  await screen.findByText(/1 sent\. 1 issue:/);
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

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
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
    sendEmail: false,
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

  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Also send a courtesy note' }));
  expect(await screen.findByDisplayValue(first.subject)).toBeInTheDocument();
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

test('no response without a courtesy note never requests a preview', async () => {
  global.fetch.mockResolvedValueOnce(response({
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

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/review-manager/withdraw-sufficient');
  expect(global.fetch.mock.calls[0][1].body).toBe(JSON.stringify({
    requestId: REQUEST_ID,
    suggestionIds: [FIRST_ID],
    reason: 'no_response',
    sendEmail: false,
  }));
  expect(onClose).toHaveBeenCalled();
});

test('no longer needed defaults to sending the note, and unticking it releases without an email or a preview', async () => {
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

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  const note = screen.getByRole('checkbox', { name: 'Send a courtesy note' });
  expect(note).toBeChecked();
  await screen.findByDisplayValue('Subject for Dr. First Reviewer');

  fireEvent.click(note);
  expect(note).not.toBeChecked();
  expect(screen.queryByDisplayValue('Subject for Dr. First Reviewer')).not.toBeInTheDocument();
  expect(screen.getByText('No email will be sent. The invitation is recorded as released by the Foundation.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    requestId: REQUEST_ID,
    suggestionIds: [FIRST_ID],
    reason: 'no_longer_needed',
    sendEmail: false,
  });
  expect(onReleased).toHaveBeenCalledWith([{ suggestionId: FIRST_ID, status: 'withdrawn_no_email_by_reason' }]);
  expect(onClose).toHaveBeenCalled();
});

test('T4 request bytes: the render-withdraw-emails POST sends exact method, headers, and body', async () => {
  global.fetch.mockResolvedValueOnce(response({ ok: true, drafts: [] }));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID, SECOND_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/render-withdraw-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: REQUEST_ID, suggestionIds: [FIRST_ID, SECOND_ID] }),
  });
});

test('T4 axis (b): a non-2xx render body surfaces its error verbatim', async () => {
  global.fetch.mockResolvedValueOnce(response({ error: 'render blew up' }, { ok: false, status: 500 }));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  expect(await screen.findByText('render blew up')).toBeInTheDocument();
});

test('T4 axis (c): a render network rejection surfaces its message', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  expect(await screen.findByText('Network error: offline')).toBeInTheDocument();
});

test('T4 axis (d): a malformed 2xx render body is treated as an empty draft list', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn(async () => { throw new Error('bad json'); }) });
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  expect(await screen.findByText('There is nothing to send.')).toBeInTheDocument();
});

test('T4 axis (e): a non-2xx render body that fails to parse falls back to the status message, never silently', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: jest.fn(async () => { throw new Error('bad gateway html'); }) });
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  expect(await screen.findByText('Could not render the emails (502)')).toBeInTheDocument();
});

test('T4 axis (b, send): a non-2xx release body surfaces its error verbatim', async () => {
  global.fetch.mockResolvedValueOnce(response({ error: 'release blew up' }, { ok: false, status: 500 }));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  expect(await screen.findByText('release blew up')).toBeInTheDocument();
});

test('T4 axis (e, send): a non-2xx release body that fails to parse falls back to the status message, never silently', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: jest.fn(async () => { throw new Error('bad gateway html'); }) });
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  expect(await screen.findByText('Release failed (502)')).toBeInTheDocument();
});

test('T4 axis (c, send): a release network rejection reports the uncertain outcome, never silently', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));
  expect(await screen.findByText(/The connection ended before the result could be confirmed.*offline/)).toBeInTheDocument();
});

test('a 200 withdraw-sufficient carrying write_failed rows still surfaces the amber banner and Done', async () => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  const second = draft(SECOND_ID, 'Dr. Second Reviewer', 'second@example.org');
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first, second] }))
    .mockResolvedValueOnce(response({
      withdrawn: 0,
      results: [
        { suggestionId: FIRST_ID, status: 'write_failed' },
        { suggestionId: SECOND_ID, status: 'write_failed' },
      ],
    }, { status: 200 }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID, SECOND_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('button', { name: 'Release (2)' }));

  await screen.findByText(/2 issues:/);
  expect(screen.getByText(
    'Dr. First Reviewer is still invited. The release could not be saved. Retry, and if it keeps failing contact an administrator.',
  )).toBeInTheDocument();
  expect(screen.getByText(
    'Dr. Second Reviewer is still invited. The release could not be saved. Retry, and if it keeps failing contact an administrator.',
  )).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Releasing…' })).not.toBeInTheDocument();
});

test.each([
  ['write_interlocked', 'Dr. First Reviewer is still invited. The system blocked the release in this environment (Dataverse write interlock). Retry from the production site, or contact an administrator.'],
  ['dataverse_forbidden', 'Dr. First Reviewer is still invited. Dataverse refused to save the release for this account. Retry, and if it fails again contact an administrator.'],
  ['not_found', 'Dr. First Reviewer is still invited. The reviewer record could not be found when saving. Reload and retry.'],
  ['dataverse_unavailable', 'Dr. First Reviewer is still invited. The database did not respond when saving the release. This is usually a temporary blip. Retry, and if it keeps failing contact an administrator.'],
  ['unknown', 'Dr. First Reviewer is still invited. The release could not be saved. Retry, and if it keeps failing contact an administrator.'],
])('write_failed with failure %s renders the matching cause+recovery sentence, no name doubling', async (failure, expectedText) => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first] }))
    .mockResolvedValueOnce(response({
      withdrawn: 0,
      results: [{ suggestionId: FIRST_ID, status: 'write_failed', failure }],
    }, { status: 200 }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));

  await screen.findByText(/1 issue/);
  expect(screen.getByText(expectedText)).toBeInTheDocument();
  // The sentence itself names the reviewer once — no "<Name> — <Name> is..." doubling.
  expect(screen.queryByText(/Dr\. First Reviewer — Dr\. First Reviewer/)).not.toBeInTheDocument();
});

test('a 200 withdraw-sufficient carrying not_pending rows surfaces the amber banner and Done', async () => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  const second = draft(SECOND_ID, 'Dr. Second Reviewer', 'second@example.org');
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first, second] }))
    .mockResolvedValueOnce(response({
      withdrawn: 0,
      results: [
        { suggestionId: FIRST_ID, status: 'not_pending' },
        { suggestionId: SECOND_ID, status: 'not_pending' },
      ],
    }, { status: 200 }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID, SECOND_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('button', { name: 'Release (2)' }));

  await screen.findByText(/2 issues:/);
  expect(screen.getByText(/Dr\. First Reviewer — The reviewer already responded or was already closed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Releasing…' })).not.toBeInTheDocument();
});

test('a 200 withdraw-sufficient with no results array at all falls back to missing_result per row', async () => {
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  const second = draft(SECOND_ID, 'Dr. Second Reviewer', 'second@example.org');
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first, second] }))
    .mockResolvedValueOnce(response({ withdrawn: 0 }, { status: 200 }));
  render(
    <ReleaseEmailModal
      requestId={REQUEST_ID}
      suggestionIds={[FIRST_ID, SECOND_ID]}
      onClose={jest.fn()}
      onReleased={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('button', { name: 'Release (2)' }));

  await screen.findByText(/2 issues:/);
  expect(screen.getByText(/Dr\. First Reviewer — The server did not return a result for this reviewer/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Releasing…' })).not.toBeInTheDocument();
});

test('switching back to No longer needed re-arms the courtesy note default', () => {
  global.fetch.mockResolvedValue(response({ ok: true, drafts: [] }));
  render(<ReleaseEmailModal requestId={REQUEST_ID} suggestionIds={[FIRST_ID]} onClose={jest.fn()} onReleased={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /^No response/ }));
  expect(screen.getByRole('checkbox', { name: 'Also send a courtesy note' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  expect(screen.getByRole('checkbox', { name: 'Send a courtesy note' })).toBeChecked();
});

test('under React.StrictMode the send still settles (double-invoked effects must not leave the mounted guard false)', async () => {
  // Pin for the dev-only hang found in the Stage 4 local rehearsal: StrictMode runs
  // effect cleanup once at mount, and a cleanup-only mounted guard never flips back.
  const first = draft(FIRST_ID, 'Dr. First Reviewer', 'first@example.org');
  global.fetch
    .mockResolvedValueOnce(response({ ok: true, drafts: [first] }))
    .mockResolvedValueOnce(response({
      withdrawn: 0,
      results: [{ suggestionId: FIRST_ID, status: 'write_failed' }],
    }, { status: 200 }));
  render(
    <StrictMode>
      <ReleaseEmailModal
        requestId={REQUEST_ID}
        suggestionIds={[FIRST_ID]}
        onClose={jest.fn()}
        onReleased={jest.fn()}
      />
    </StrictMode>,
  );

  fireEvent.click(screen.getByRole('radio', { name: /^No longer needed/ }));
  await screen.findByDisplayValue(first.subject);
  fireEvent.click(screen.getByRole('button', { name: 'Release (1)' }));

  await screen.findByText(/1 issue/);
  expect(screen.getByText(
    'Dr. First Reviewer is still invited. The release could not be saved. Retry, and if it keeps failing contact an administrator.',
  )).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  expect(screen.queryByText(/Releasing/)).not.toBeInTheDocument();
});
