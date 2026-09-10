/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SessionAgendaPanel from '../../shared/components/meeting-tracker/SessionAgendaPanel';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const DEFAULT_MESSAGE = "Here is the agenda for our deliberation session. Each proposal's briefing page opens without a login.";

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

function prepared(overrides = {}) {
  return {
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
    to: ['alex@example.org', 'bailey@example.org'],
    cc: [],
    recipientCount: 2,
    subject: 'Deliberation session agenda — Monday, September 14',
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
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => response({ lastAgenda: null, scheduleChanged: false }));
});

afterEach(() => jest.restoreAllMocks());

test('defaults attendees, subject, and message and posts the exact prepare payload', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));

  expect(screen.getByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue('Deliberation session agenda — Monday, September 14');
  expect(screen.getByLabelText('Message')).toHaveValue(
    "Here is the agenda for our deliberation session. Each proposal's briefing page opens without a login.",
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  await screen.findByText(/First proposal/);
  const prepareCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(prepareCall[0]).toBe(`/api/meeting-tracker/sessions/${SESSION_ID}/agenda`);
  expect(JSON.parse(prepareCall[1].body)).toMatchObject({
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    to: 'alex@example.org, bailey@example.org',
    cc: '',
    subject: 'Deliberation session agenda — Monday, September 14',
  });
  expect(screen.getByText(/9:00 AM–9:15 AM/)).toBeInTheDocument();
});

test('requires confirmation, sends the prepared operation, and renders the exact receipt', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }))
    .mockResolvedValueOnce(response({
      success: true,
      agenda: prepared({ state: 'sent', transportAccepted: true, sentAt: '2026-09-10T19:00:00.000Z' }),
    }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  const sendButton = await screen.findByRole('button', { name: 'Send agenda' });
  expect(sendButton).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(sendButton);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    `/api/meeting-tracker/sessions/${SESSION_ID}/agenda`,
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ operationId: OPERATION_ID }) }),
  ));
  expect(await screen.findByText(/Dynamics accepted this exact email for transport/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send agenda again…' })).toBeInTheDocument();
});

test('a stale send destroys the preview and requires a new confirmation', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false }))
    .mockResolvedValueOnce(response({ success: true, agenda: prepared() }))
    .mockResolvedValueOnce(response({
      error: 'The session schedule changed after this preview.', code: 'agenda_operation_stale',
    }, 409));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByText(/Create a new preview, review it, and then send/)).toBeInTheDocument();
  expect(screen.queryByText(/First proposal/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeInTheDocument();
});

test('a stale unresolved retry restores usable composer defaults', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, pendingSend: pending, scheduleChanged: false }))
    .mockResolvedValueOnce(response({
      error: 'The session schedule changed after this preview.',
      code: 'agenda_operation_stale',
    }, 409));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review unresolved send…' }));
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByLabelText('To')).toHaveValue('alex@example.org, bailey@example.org');
  expect(screen.getByLabelText('Subject')).toHaveValue('Deliberation session agenda — Monday, September 14');
  expect(screen.getByLabelText('Message')).toHaveValue(DEFAULT_MESSAGE);
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
});

test('a prepare-time unresolved conflict pins the existing operation', async () => {
  const pending = prepared({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  expect(await screen.findByText(/Another session agenda send is unresolved/)).toBeInTheDocument();
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  expect(screen.getByText(pending.subject)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));
  expect(await screen.findByText(/Dynamics accepted this exact email for transport/)).toBeInTheDocument();
  const sendCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(sendCall[1].body)).toEqual({ operationId: pending.operationId });
});

test('a terminal retry unblocks a new preview without retaining the failed operation', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, pendingSend: pending, scheduleChanged: false }))
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
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Review unresolved send…' })).not.toBeInTheDocument();
});

test('a 202 unconfirmed transport status stays recoverable on the same operation', async () => {
  const pending = prepared({
    state: 'send_requested',
    sendRequestedAt: '2026-09-10T19:00:00.000Z',
  });
  global.fetch
    .mockResolvedValueOnce(response({ lastAgenda: null, scheduleChanged: false }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText(/First proposal/);
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('has not confirmed transport acceptance');
  expect(screen.queryByText(/Dynamics accepted this exact email for transport/)).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Review unresolved send…' }));
  expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda' }));
  expect(await screen.findByText(/Dynamics accepted this exact email for transport/)).toBeInTheDocument();
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

test('adds tracker directory recipients without creating To/Cc conflicts', async () => {
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={{ ...session, attendees: [] }} slots={slots} recipients={recipients} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Send agenda…' }));
  const composer = screen.getByRole('dialog', { name: 'Send session agenda' });
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
