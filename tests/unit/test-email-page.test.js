/**
 * @jest-environment jsdom
 *
 * T5 matrix for pages/test-email.js's single POST /api/test-email site. No
 * render test existed for this page before (only the API route's own tests);
 * this is that first characterization pass, added per T5's "tests first for
 * every migrated site" rule even though the plan's explicit
 * lacking-a-test-today list omits this file (an enumeration gap, not a
 * signal to skip it).
 *
 * Today's `const data = await resp.json();` has NO catch, so ANY malformed
 * body — 2xx or non-2xx — throws and is caught by the outer try/catch,
 * landing on the 'uncertain' status with the native parse-error message in
 * the parenthetical. This is the same shape as AwardeeTab's send-invite
 * precedent (plan Stage 2 rule (ii)): a non-2xx unparseable body must be
 * mapped back to 'uncertain' via `envelope.error.parseError` after migration,
 * since the helper's non-2xx body parse is always tolerant.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TestEmail from '../../pages/test-email';

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { azureEmail: 'staff@wmkeck.org' } } }) }));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/EmailSendFeedback', () => ({
  __esModule: true,
  default: ({ status, message }) => <div role="status" data-status={status}>{message}</div>,
}));

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('recipient@wmkeck.org'), { target: { value: 'reviewer@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: /Create Draft/i }));
}

afterEach(() => jest.restoreAllMocks());

test('(a) a successful draft response renders the draft feedback', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'draft' }) });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'draft');
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('/api/test-email');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
});

test('(b) data.outcome === "uncertain" is honored regardless of HTTP status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome: 'uncertain', error: 'Timed out.' }) });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
});

test('(b) a non-2xx {error} shows the failed status with the server message', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Dynamics rejected the request.' }) });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'failed');
  expect(status).toHaveTextContent('Dynamics rejected the request.');
});

test('(b) a non-2xx body with no error falls back to "Request failed (status)"', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Request failed (503)');
});

test('(c) a network rejection shows the uncertain status with the connection-ended copy', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
  expect(status).toHaveTextContent(/connection ended before the result could be confirmed.*network down/);
});

test('(d) a malformed 2xx body (bare .json(), no catch, throws today) shows the uncertain status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
  expect(status).toHaveTextContent(/Unexpected end of JSON input/);
});

test('(e) a non-2xx unparseable body (502 gateway page) also shows the uncertain status (today throws here too)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
  render(<TestEmail />);
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
  expect(status).toHaveTextContent(/Unexpected token < in JSON/);
});
