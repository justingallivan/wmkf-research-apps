/**
 * @jest-environment jsdom
 *
 * SessionAgendaPanel — T5 gap-fill (Stage 5a). tests/unit/meeting-tracker-
 * agenda-panel.test.js already pins 2xx success, every status-code branch,
 * and exact request bytes for the file's 3 fetch sites (loadStatus GET,
 * prepare POST, send PATCH), migrated to requestJson/requestEnvelope with
 * tolerantBody: true. This file adds network-rejection and axis (e).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import SessionAgendaPanel from '../../shared/components/meeting-tracker/SessionAgendaPanel';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const session = {
  sessionId: SESSION_ID,
  scheduledStartIso: '2026-09-14T16:00:00.000Z',
  attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }],
};
const slots = [];
const recipients = { staff: [], board: [] };

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('loadStatus: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('loadStatus axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The last agenda could not be loaded.');
});

async function readyPanel() {
  global.fetch = jest.fn().mockResolvedValue(ok({ lastAgenda: null, scheduleChanged: false, defaults: { subject: 's', message: 'm', unavailable: false } }));
  render(<SessionAgendaPanel sessionId={SESSION_ID} session={session} slots={slots} recipients={recipients} />);
  const openButton = await screen.findByRole('button', { name: 'Send agenda…' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.click(openButton);
  return screen.findByRole('button', { name: 'Create preview' });
}

test('prepare axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  const previewButton = await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve(ok({ lastAgenda: null, scheduleChanged: false, defaults: {} }))
  ));
  fireEvent.click(previewButton);
  expect(await screen.findByRole('alert')).toHaveTextContent('The agenda preview could not be created. Please try again.');
});

test('prepare: network rejection is never silent', async () => {
  const previewButton = await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST' ? Promise.reject(new Error('offline')) : Promise.resolve(ok({ lastAgenda: null, scheduleChanged: false, defaults: {} }))
  ));
  fireEvent.click(previewButton);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});
