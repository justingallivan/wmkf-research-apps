/** @jest-environment jsdom */

let mockAgendaActor = 'pc@example.org';
jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { email: mockAgendaActor } } }) }));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SessionAgendaPanel from '../../shared/components/meeting-tracker/SessionAgendaPanel';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
// Deliberately unrelated to the deleted hard-coded subject/message text, so a
// test asserting these values cannot pass if the component regresses to the
// old hard-coded constants instead of reading the loaded `defaults` state.
const DEFAULTS = {
  subject: 'Admin subject ZZZ',
  message: 'Admin opening message ZZZ',
  source: 'shared', personalStatus: 'absent', sharedStatus: 'available',
};

const session = {
  sessionId: SESSION_ID,
  scheduledStartIso: '2026-09-14T16:00:00.000Z',
  scheduledEndIso: '2026-09-14T17:00:00.000Z',
  ianaTimeZone: 'America/Los_Angeles',
  attendees: [
    { name: 'Alex Staff', email: 'alex@example.org' },
    { name: 'Bailey Board', email: 'bailey@example.org' },
  ],
};
const slots = [{
  wmkf_order: 1,
  wmkf_minutes: 15,
  _wmkf_request_value: REQUEST_ID,
}];
const recipients = {
  staff: [{ ref: { kind: 'staff', profileId: 7 }, name: 'Alex Staff', email: 'alex@example.org' }],
  board: [{ ref: { kind: 'roster', rosterId: 9 }, name: 'Bailey Board', email: 'bailey@example.org' }],
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// The GET response's async chain (fetch -> json -> setState) resolves over
// several microtask hops; a macrotask tick guarantees they have all run
// before the composer is opened, so it reads the loaded `defaults` state.
async function flushLoadStatus() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function prepared(overrides = {}) {
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    to: ['alex@example.org', 'bailey@example.org'],
    cc: [],
    recipientCount: 2,
    subject: DEFAULTS.subject,
    bodyText: 'Exact body\n\nDeliberation session: Monday.\n\nAgenda\n\n9:00 AM–9:15 AM · #1001 · First proposal · Lead PD: Alex Staff · Open briefing',
    state: 'prepared',
    sendRequestedAt: null,
    sentAt: null,
    transportAccepted: false,
    agenda: {
      sessionLine: 'Deliberation session: Mon, September 14, 2026 at 9:00 AM PDT–10:00 AM PDT.',
      slots: [{
        requestId: REQUEST_ID,
        requestNumber: '1001',
        title: 'First proposal',
        leadPdName: 'Alex Staff',
        windowText: '9:00 AM–9:15 AM',
        briefingUrl: 'https://reviews.example.org/external/briefing/token',
      }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockAgendaActor = 'pc@example.org';
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }));
});

afterEach(() => jest.restoreAllMocks());

test('defaults attendees, subject, and message and posts the exact prepare payload', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();

  expect(screen.getByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULTS.subject);
  expect(screen.getByLabelText('Opening message (optional)')).toHaveValue(DEFAULTS.message);
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  await screen.findByText(/First proposal/);
  const prepareCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(prepareCall[0]).toBe(`/api/meeting-tracker/sessions/${SESSION_ID}/agenda`);
  expect(JSON.parse(prepareCall[1].body)).toMatchObject({
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    to: 'alex@example.org, bailey@example.org',
    cc: '',
    subject: DEFAULTS.subject,
  });
  expect(screen.getByText(/9:00 AM–9:15 AM/)).toBeInTheDocument();
});

test('requires confirmation, sends the prepared operation, and renders the exact receipt', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }))
    .mockResolvedValueOnce(response({
      success: true,
      agenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:00:00.000Z' }),
    }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  const sendButton = await screen.findByRole('button', { name: 'Send agenda' });
  expect(sendButton).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(sendButton);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    `/api/meeting-tracker/sessions/${SESSION_ID}/agenda`,
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ operationId: OPERATION_ID }) }),
  ));
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send agenda again…' })).toBeInTheDocument();
});

test('a stale send destroys the preview and requires a new confirmation', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }))
    .mockResolvedValueOnce(response({
      error: 'The session schedule changed after this preview.', code: 'agenda_operation_stale',
    }, 409));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'custom@example.org' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Custom agenda subject' } });
  fireEvent.change(screen.getByLabelText('Opening message (optional)'), { target: { value: 'Custom agenda message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByText(/Create a new preview, review it, and then send/)).toBeInTheDocument();
  expect(screen.queryByText(/First proposal/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('To')).toHaveValue('custom@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue('Custom agenda subject');
  expect(screen.getByLabelText('Opening message (optional)')).toHaveValue('Custom agenda message');
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeInTheDocument();
});

test('a stale unresolved retry restores usable composer defaults', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, pendingSend: pending, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({
      error: 'The session schedule changed after this preview.',
      code: 'agenda_operation_stale',
    }, 409));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review unresolved send…' }));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULTS.subject);
  expect(screen.getByLabelText('Opening message (optional)')).toHaveValue(DEFAULTS.message);
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
});

test('a prepare-time unresolved conflict pins the existing operation', async () => {
  const pending = prepared({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({
      error: 'A session agenda send is still unresolved.',
      code: 'agenda_send_unresolved',
      pendingSend: pending,
    }, 409))
    .mockResolvedValueOnce(response({
      success: true,
      agenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:02:00.000Z' }),
    }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  expect(await screen.findByText(/Another session agenda send is unresolved/)).toBeInTheDocument();
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  expect(screen.getByText(pending.subject)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  const sendCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(sendCall[1].body)).toEqual({ operationId: pending.operationId });
});

test('a send-time unresolved conflict marks B not sent and preserves A for explicit reconciliation', async () => {
  const earlierPending = prepared({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  const competingPreview = prepared({
    operationId: OPERATION_ID,
    subject: 'Competing B subject',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ success: true, agenda: competingPreview }))
    .mockResolvedValueOnce(response({
      error: 'A session agenda send is still unresolved.',
      code: 'agenda_send_unresolved',
      pendingSend: earlierPending,
    }, 409))
    .mockResolvedValueOnce(response({
      success: true,
      agenda: prepared({
        operationId: earlierPending.operationId,
        state: 'sent',
        transportAccepted: true,
        sentAt: '2026-09-10T19:02:00.000Z',
      }),
    }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText('Competing B subject');
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  const feedback = await screen.findByTestId('agenda-send-feedback');
  expect(feedback).toHaveRole('alert');
  expect(feedback).toHaveTextContent('Not sent.');
  expect(feedback).toHaveTextContent('This agenda was not sent. Review the earlier unresolved send before sending another agenda.');
  expect(feedback).not.toHaveTextContent('Send status is uncertain.');
  expect(feedback).not.toHaveTextContent('Please try again.');
  expect(screen.getByText(earlierPending.subject)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create preview' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/I reviewed the recipients/)).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Send agenda' })).toBeDisabled();
  expect(global.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  const firstPatchCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(firstPatchCalls).toHaveLength(1);
  expect(JSON.parse(firstPatchCalls[0][1].body)).toEqual({ operationId: competingPreview.operationId });

  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
  const patchCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(patchCalls).toHaveLength(2);
  expect(JSON.parse(patchCalls[1][1].body)).toEqual({ operationId: earlierPending.operationId });
});

test('a terminal retry unblocks a new preview without retaining the failed operation', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, pendingSend: pending, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({
      error: 'Dynamics closed this agenda email without an accepted transport status. Create a new preview before sending again.',
      code: 'agenda_send_terminal',
      failedSend: prepared({ state: 'failed' }),
    }, 409));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review unresolved send…' }));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByText(/Dynamics closed this agenda email/)).toBeInTheDocument();
  expect(screen.getByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULTS.subject);
  expect(screen.getByLabelText('Opening message (optional)')).toHaveValue(DEFAULTS.message);
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Review unresolved send…' })).not.toBeInTheDocument();
});

test('a 202 unconfirmed transport status stays recoverable on the same operation', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }))
    .mockResolvedValueOnce(response({
      error: 'Dynamics has not confirmed transport acceptance for this agenda.',
      code: 'agenda_send_unconfirmed',
      pendingSend: pending,
    }, 202))
    .mockResolvedValueOnce(response({
      success: true,
      agenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:02:00.000Z' }),
    }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByTestId('agenda-send-feedback')).toHaveTextContent('has not confirmed transport acceptance');
  expect(screen.queryByText('Sent for delivery.')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Review unresolved send…' }));
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  const prepareCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  const sendCalls = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(prepareCalls).toHaveLength(1);
  expect(sendCalls).toHaveLength(2);
  expect(sendCalls.map(([, options]) => JSON.parse(options.body).operationId)).toEqual([
    OPERATION_ID,
    OPERATION_ID,
  ]);
});

test('shows the sent summary and drift note returned by the server', async () => {
  global.fetch.mockResolvedValueOnce(response({
    lastAgenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:00:00.000Z' }),
    scheduleChanged: true,
  }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(await screen.findByText(/Agenda sent Sep 10, 2026/)).toHaveTextContent('to 2 recipients');
  expect(screen.getByText('Schedule changed since the last agenda.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send agenda again…' })).toBeInTheDocument();
});

test('shows the last sent receipt and a newer unresolved send independently', async () => {
  global.fetch.mockResolvedValueOnce(response({
    lastAgenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T18:00:00.000Z' }),
    pendingSend: prepared({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'send_requested',
      sendRequestedAt: '2026-09-10T19:00:00.000Z',
    }),
    scheduleChanged: true,
  }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(await screen.findByText(/Agenda sent Sep 10, 2026/)).toBeInTheDocument();
  expect(screen.getByText('Schedule changed since the last agenda.')).toBeInTheDocument();
  expect(screen.getByText(/is unresolved/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review unresolved send…' })).toBeInTheDocument();
});

test('shows an unavailable note and leaves the subject and message blank when defaults are not configured', async () => {
  global.fetch.mockResolvedValue(response({
    lastAgenda: null,
    scheduleChanged: false,
    defaults: { subject: '', message: '', source: 'empty', personalStatus: 'absent', sharedStatus: 'unavailable' },
  }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();

  expect(screen.getByLabelText('Subject')).toHaveValue('');
  expect(screen.getByLabelText('Opening message (optional)')).toHaveValue('');
  expect(screen.getByText(/Your saved wording or shared wording could not be loaded/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeDisabled();
});

test('disables Send agenda… until the initial GET resolves, then enables it', async () => {
  let resolveGet;
  global.fetch = jest.fn(() => new Promise((resolve) => { resolveGet = resolve; }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);

  const sendButton = screen.getByRole('button', { name: 'Send agenda…' });
  expect(sendButton).toBeDisabled();

  await act(async () => {
    resolveGet(response({ lastAgenda: null, scheduleChanged: false, defaults: DEFAULTS }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(sendButton).toBeEnabled();
});

test('adds tracker directory recipients without creating To/Cc conflicts', async () => {
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={{ ...session, attendees: [] }} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await flushLoadStatus();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await flushLoadStatus();
  const composer = screen.getByRole('dialog', { name: 'Send discussion session agenda' });
  const directoryButtons = within(composer).getAllByRole('button', { name: 'Add from directory' });
  fireEvent.click(directoryButtons[0]);
  const firstDirectory = screen.getByRole('dialog', { name: /Add recipients to To/ });
  fireEvent.click(within(firstDirectory).getByRole('button', { name: /Alex Staff.*alex@example.org.*Staff/ }));
  expect(screen.getByLabelText('To')).toHaveValue('alex@example.org');
  expect(within(firstDirectory).getByText('Already added')).toBeInTheDocument();
  fireEvent.click(within(firstDirectory).getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(directoryButtons[1]);
  const secondDirectory = screen.getByRole('dialog', { name: /Add recipients to Cc/ });
  expect(within(secondDirectory).getByRole('button', { name: /Alex Staff.*Already added/ })).toBeDisabled();
});

test('Save/Clear default leaves current wording, recipients and preview unchanged; reopen uses refreshed defaults', async () => {
  let saved = { subject: 'Saved {{sessionDate}}', body: '' };
  let releaseSave;
  const defaults = () => ({ subject: saved.subject, message: saved.body, source: 'personal', personalStatus: 'configured', sharedStatus: 'available' });
  const prefs = () => ({ ok: true, configured: true, template: saved, defaults: defaults() });
  global.fetch = jest.fn(async (url, options) => {
    if (url.includes('agenda-email-preferences')) {
      if (options?.method === 'PUT') {
        await new Promise((resolve) => { releaseSave = resolve; }); saved = JSON.parse(options.body).template;
      }
      if (options?.method === 'DELETE') saved = { subject: 'Shared next', body: 'Shared next opening' };
      return response(prefs());
    }
    if (options?.method === 'POST') return response({ success: true, agenda: prepared({ subject: 'One-send subject' }) });
    return response({ defaults: defaults() });
  });
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await flushLoadStatus(); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'One-send subject' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'one-off@example.org' } });
  fireEvent.click(screen.getByText('Your discussion session agenda default wording'));
  const details = screen.getByText('Your discussion session agenda default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('Default subject');
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: 'Future {{sessionDate}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  await waitFor(() => expect(releaseSave).toBeDefined());
  expect(screen.getAllByRole('button', { name: 'Close' }).every((b) => b.disabled)).toBe(true);
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeDisabled();
  await act(async () => { releaseSave(); });
  expect(await screen.findByText(/Saved as your default wording/)).toBeInTheDocument();
  expect(screen.getByText(/Started from your saved wording/)).toBeInTheDocument();
  expect(screen.getByLabelText('Subject')).toHaveValue('One-send subject'); expect(screen.getByLabelText('To')).toHaveValue('one-off@example.org');
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' })); await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Clear my default' })); await screen.findByText(/Your default was cleared/);
  expect(screen.getByLabelText(/I reviewed the recipients/)).toBeChecked();
  expect(screen.getByRole('button', { name: 'Send agenda' })).toBeEnabled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  expect(screen.getByLabelText('Subject')).toHaveValue('Shared next');
  expect(screen.getByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org'); expect(screen.getByLabelText('Cc')).toHaveValue('');
});

test('empty opening allows preview and date/room prop changes require a new review without overwriting edits', async () => {
  global.fetch = jest.fn(async (_url, options) => response(options?.method === 'POST' ? { success: true, agenda: prepared() } : { defaults: { ...DEFAULTS, message: '', source: 'shared', personalStatus: 'absent', sharedStatus: 'available' } }));
  const view = render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await flushLoadStatus(); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
  expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'My raw {{sessionDate}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' })); await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  view.rerender(<SessionAgendaPanel sessionId={SESSION_ID} session={{ ...session, location: 'New room' }} slots={slots} recipients={recipients} />);
  expect(screen.queryByRole('button', { name: 'Send agenda' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Subject')).toHaveValue('My raw {{sessionDate}}');
  view.rerender(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(screen.queryByRole('button', { name: 'Send agenda' })).not.toBeInTheDocument();
});

test('Close remains available during initialization, cancels it and ignores a late response', async () => {
  let resolveOpening;
  global.fetch.mockResolvedValueOnce(response({ defaults: DEFAULTS })).mockImplementationOnce(() => new Promise((resolve) => { resolveOpening = resolve; }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await flushLoadStatus(); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  const close = screen.getAllByRole('button', { name: 'Close' })[0];
  expect(close).toBeEnabled(); expect(close).toHaveFocus();
  fireEvent.click(close); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => { resolveOpening(response({ defaults: { subject: 'Late old subject', message: '' } })); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULTS.subject);
});

test('a stale status read cannot replace defaults saved while it was in flight', async () => {
  let getCount = 0; let oldStatus; let reopening; let saved = false;
  const nextDefaults = { subject: 'Future {{sessionDate}}', message: '', source: 'personal', personalStatus: 'configured', sharedStatus: 'available' };
  global.fetch = jest.fn(async (url, options) => {
    if (url.includes('agenda-email-preferences')) {
      if (options?.method === 'PUT') saved = true;
      return response({ ok: true, configured: saved, template: { subject: saved ? nextDefaults.subject : DEFAULTS.subject, body: '' }, defaults: saved ? nextDefaults : DEFAULTS });
    }
    getCount += 1;
    if (getCount === 3) return new Promise((resolve) => { oldStatus = resolve; });
    if (getCount === 4) return new Promise((resolve) => { reopening = resolve; });
    return response({ defaults: DEFAULTS });
  });
  const view = render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await flushLoadStatus(); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  const details = screen.getByText('Your discussion session agenda default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle')); await screen.findByLabelText('Default subject');
  view.rerender(<SessionAgendaPanel sessionId={SESSION_ID} session={{ ...session, location: 'Changed' }} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(oldStatus).toBeDefined());
  fireEvent.change(screen.getByLabelText('Default subject'), { target: { value: nextDefaults.subject } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); await screen.findByText(/Saved as your default wording/);
  expect(screen.getByText(/Started from shared wording/)).toBeInTheDocument();
  expect(screen.queryByText(/Started from your saved wording/)).not.toBeInTheDocument();
  await act(async () => { oldStatus(response({ defaults: { ...DEFAULTS, subject: 'Stale old default' } })); });
  expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULTS.subject);
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  await waitFor(() => expect(reopening).toBeDefined());
  expect(screen.getByLabelText('Subject')).toHaveValue(nextDefaults.subject); expect(screen.getByLabelText('Subject')).toBeDisabled();
  await act(async () => { reopening(response({ defaults: nextDefaults })); }); expect(screen.getByLabelText('Subject')).toBeEnabled();
});

test('actor change during Save discards the old composer and ignores the late result', async () => {
  let finish;
  global.fetch = jest.fn(async (url, options) => {
    if (url.includes('agenda-email-preferences')) {
      if (options?.method === 'PUT') return new Promise((resolve) => { finish = resolve; });
      return response({ configured: true, template: { subject: 'Old user', body: '' }, defaults: DEFAULTS });
    }
    return response({ defaults: DEFAULTS });
  });
  const view = render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await flushLoadStatus(); fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' })); await flushLoadStatus();
  const details = screen.getByText('Your discussion session agenda default wording').closest('details'); details.open = true; fireEvent(details, new Event('toggle')); await screen.findByLabelText('Default subject');
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' })); await waitFor(() => expect(finish).toBeDefined());
  mockAgendaActor = 'backup@example.org'; view.rerender(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => { finish(response({ ok: true, defaults: { subject: 'Old user secret wording', message: '' }, template: { subject: 'Old user secret wording', body: '' } })); });
  expect(screen.queryByText(/Old user secret wording/)).not.toBeInTheDocument();
  await flushLoadStatus(); expect(screen.getByRole('button', { name: 'Send agenda…' })).toBeEnabled();
});

test('a briefing outage keeps sent and unresolved receipts visible without claiming schedule drift', async () => {
  global.fetch.mockResolvedValue(response({ defaults: DEFAULTS, linksUnavailable: true, scheduleChanged: null,
    lastAgenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:00:00Z' }),
    pendingSend: prepared({ state: 'send_requested', sendRequestedAt: '2026-09-10T19:01:00Z' }) }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(await screen.findByText(/Proposal review packet links could not be confirmed/)).toBeInTheDocument();
  expect(screen.getByText(/Agenda sent/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review unresolved send…' })).toBeEnabled();
  expect(screen.queryByText('Schedule changed since the last agenda.')).not.toBeInTheDocument();
});
