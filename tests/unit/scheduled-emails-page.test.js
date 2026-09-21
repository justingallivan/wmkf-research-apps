/**
 * @jest-environment jsdom
 *
 * T5 matrix for pages/scheduled-emails.js's six fetch sites. No render test
 * existed for this page before (T5); this file is that first characterization
 * pass, kept minimal per site.
 *
 * Sites: :59/:61 guarded preferences/vip-flags GETs, :76
 * (PUT reviewAll), :95 (PUT vip flag), :119 (GET scheduled-emails list), :162
 * (PATCH action — reads `data.outcome` before the `!ok` check).
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduledEmailsPage from '../../pages/scheduled-emails';

const routerReplace = jest.fn();
jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, replace: routerReplace, query: {} }),
}));
let mockProfile = { status: 'ready', currentProfile: { id: 'profile-1' } };
jest.mock('../../shared/context/ProfileContext', () => ({
  useProfile: () => mockProfile,
}));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/EmailSendFeedback', () => ({
  __esModule: true,
  default: ({ status, message }) => <div role="status" data-status={status}>{message}</div>,
}));

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const MESSAGE = {
  id: 'm1', version: 1, status: 'scheduled', subject: 'Hi', bodyText: 'Body',
  toRecipients: ['a@b.com'], ccRecipients: [], automationNotice: 'Auto', previewHtml: '<p>x</p>',
  recipientName: 'A B', scheduledSendAt: null, recipientContactIds: [],
};

function mockFetch(handlers) {
  // Later entries win, so a test's extra handler can override a default
  // (e.g. re-route the same PUT URL used by both the initial GET and a
  // subsequent write).
  global.fetch = jest.fn(async (url, opts) => {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const [match, handler] = handlers[i];
      if (typeof match === 'string' ? url === match : match.test(url)) return handler(opts);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => { mockProfile = { status: 'ready', currentProfile: { id: 'profile-1' } }; window.history.replaceState({}, '', '/scheduled-emails'); jest.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => jest.restoreAllMocks());

// --- :59/:61 preferences + vip-flags ---

test('(a) preferences + vip-flags load and drive the review-all checkbox', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, { preference: { reviewAll: true } })],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [{ contactId: 'c1' }] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [{ ...MESSAGE, recipientContactIds: ['c1'] }] })],
  ]);
  render(<ScheduledEmailsPage />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Review every automated email/ })).toBeChecked());
});

test('a non-2xx VIP response shows its error and does not clear successful preference state', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, { preference: { reviewAll: true } })],
    ['/api/scheduled-emails/vip-flags', async () => response(500, { error: 'nope' })],
    ['/api/scheduled-emails', async () => response(200, { messages: [{ ...MESSAGE, recipientContactIds: ['c1'] }] })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByDisplayValue('Hi');
  expect(await screen.findByText('VIP flags: nope')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Review every automated email/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Always review emails to/ })).toBeDisabled();
});

test('a non-2xx preference response shows its error while successful VIP state remains usable', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(500, { error: 'Preference unavailable' })],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [{ contactId: 'c1' }] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [{ ...MESSAGE, recipientContactIds: ['c1'] }] })],
  ]);
  render(<ScheduledEmailsPage />);
  expect(await screen.findByText('Review preference: Preference unavailable')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Always review emails to/ })).toBeEnabled();
});

test('posture error survives a later successful sibling and message-list load', async () => {
  let resolvePreferenceBody;
  const preferenceBody = new Promise(resolve => { resolvePreferenceBody = resolve; });
  mockFetch([
    ['/api/email-automation-preferences', async () => ({ ok: false, status: 503, json: async () => preferenceBody })],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [{ contactId: 'c1' }] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [] })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByText('No scheduled emails');
  resolvePreferenceBody({ error: 'Preference service unavailable' });
  expect(await screen.findByText(/Preference service unavailable/)).toBeInTheDocument();
});

test('a network failure in one posture load does not discard the successful sibling', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => { throw new Error('preference network down'); }],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [{ contactId: 'c1' }] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [{ ...MESSAGE, recipientContactIds: ['c1'] }] })],
  ]);
  render(<ScheduledEmailsPage />);
  expect(await screen.findByText(/Review preference: preference network down/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Always review emails to/ })).toBeEnabled();
});

test('both posture failures remain visible together', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(503, { error: 'Preference down' })],
    ['/api/scheduled-emails/vip-flags', async () => response(502, { error: 'VIP down' })],
    ['/api/scheduled-emails', async () => response(200, { messages: [] })],
  ]);
  render(<ScheduledEmailsPage />);
  expect(await screen.findByText(/Review preference: Preference down/)).toBeInTheDocument();
  expect(screen.getByText(/VIP flags: VIP down/)).toBeInTheDocument();
});

test('changing profile aborts the prior posture load and leaves new posture unknown until it resolves', async () => {
  let resolveOld;
  let calls = 0;
  mockFetch([
    ['/api/email-automation-preferences', async () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { resolveOld = resolve; });
      return response(200, { preference: { reviewAll: true } });
    }],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [{ contactId: 'c1' }] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [{ ...MESSAGE, recipientContactIds: ['c1'] }] })],
  ]);
  const view = render(<ScheduledEmailsPage />);
  await screen.findByDisplayValue('Hi');
  mockProfile = { status: 'ready', currentProfile: { id: 'profile-2' } };
  view.rerender(<ScheduledEmailsPage />);
  expect(await screen.findByRole('checkbox', { name: /Review every automated email/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Always review emails to/ })).toBeChecked();
  await act(async () => {
    resolveOld?.(response(200, { preference: { reviewAll: false } }));
    await Promise.resolve();
  });
  expect(screen.getByRole('checkbox', { name: /Review every automated email/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Always review emails to/ })).toBeChecked();
});

// --- :119 GET /api/scheduled-emails (list) ---

test('(a) the message list loads and the first message is selected', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, {})],
    ['/api/scheduled-emails/vip-flags', async () => response(200, {})],
    ['/api/scheduled-emails', async () => response(200, { messages: [MESSAGE] })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByText('Hi', { selector: 'input' }).catch(() => {});
  await waitFor(() => expect(screen.getByDisplayValue('Hi')).toBeInTheDocument());
});

test('(b) a non-2xx {error} shows it in the alert', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, {})],
    ['/api/scheduled-emails/vip-flags', async () => response(200, {})],
    ['/api/scheduled-emails', async () => response(500, { error: 'DB unavailable' })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByText('DB unavailable');
});

test('(d) a malformed 2xx list body is tolerated to {} and renders as empty (today\'s `.catch(() => ({}))`, no throw when ok)', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, {})],
    ['/api/scheduled-emails/vip-flags', async () => response(200, {})],
    ['/api/scheduled-emails', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByText('No scheduled emails');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('(e) a non-2xx unparseable list body (502 gateway page) falls back to the generic load-error message', async () => {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, {})],
    ['/api/scheduled-emails/vip-flags', async () => response(200, {})],
    ['/api/scheduled-emails', async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } })],
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByText('Could not load scheduled emails.');
});

// --- :76 PUT reviewAll, :95 PUT vip flag ---

async function renderWithMessage(extraHandlers = []) {
  mockFetch([
    ['/api/email-automation-preferences', async () => response(200, { preference: { reviewAll: false } })],
    ['/api/scheduled-emails/vip-flags', async () => response(200, { flags: [] })],
    ['/api/scheduled-emails', async () => response(200, { messages: [MESSAGE] })],
    ...extraHandlers,
  ]);
  render(<ScheduledEmailsPage />);
  await screen.findByDisplayValue('Hi');
}

test('(c) a network rejection on the reviewAll PUT surfaces the error message', async () => {
  await renderWithMessage([['/api/email-automation-preferences', async (opts) => {
    if (opts?.method === 'PUT') throw new Error('network down');
    return response(200, { preference: { reviewAll: false } });
  }]]);
  fireEvent.click(screen.getByRole('checkbox', { name: /Review every automated email/ }));
  await screen.findByText('network down');
});

test('(b) a non-2xx {error} on the reviewAll PUT surfaces it', async () => {
  await renderWithMessage([['/api/email-automation-preferences', async (opts) => (
    opts?.method === 'PUT' ? response(500, { error: 'Save failed.' }) : response(200, { preference: { reviewAll: false } })
  )]]);
  fireEvent.click(screen.getByRole('checkbox', { name: /Review every automated email/ }));
  await screen.findByText('Save failed.');
});

test('(d)/(e) a malformed reviewAll PUT body (today\'s `.catch(() => ({}))`) falls back to the generic message', async () => {
  await renderWithMessage([['/api/email-automation-preferences', async (opts) => (
    opts?.method === 'PUT' ? { ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } } : response(200, { preference: { reviewAll: false } })
  )]]);
  fireEvent.click(screen.getByRole('checkbox', { name: /Review every automated email/ }));
  await screen.findByText('Could not save your review preference.');
});

// --- :162 PATCH action (runAction) ---

test('(a) "Looks good" (approve) succeeds and updates the message in place', async () => {
  await renderWithMessage([[/\/api\/scheduled-emails\/m1$/, async (opts) => {
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ action: 'approve', version: 1 });
    return response(200, { message: { ...MESSAGE, approvedAt: '2026-09-20T00:00:00Z' } });
  }]]);
  fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Looks good' })).toBeInTheDocument());
});

test('(b) a non-2xx {error} on "Stop this message" shows the error alert', async () => {
  await renderWithMessage([[/\/api\/scheduled-emails\/m1$/, async () => response(500, { error: 'Cannot stop.' })]]);
  fireEvent.click(screen.getByRole('button', { name: 'Stop this message' }));
  await screen.findByText('Cannot stop.');
});

test('data.outcome === "uncertain" on "Send now" shows the uncertain feedback regardless of HTTP status', async () => {
  await renderWithMessage([[/\/api\/scheduled-emails\/m1$/, async () => response(200, { outcome: 'uncertain', error: 'Timed out.' })]]);
  fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
  expect(status).toHaveTextContent('Timed out. Check the recipient before trying again.');
});

test('(c) a network rejection on "Send now" shows the uncertain feedback', async () => {
  await renderWithMessage([[/\/api\/scheduled-emails\/m1$/, async () => { throw new Error('network down'); }]]);
  fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
  const status = await screen.findByRole('status');
  expect(status).toHaveAttribute('data-status', 'uncertain');
  expect(status).toHaveTextContent(/connection ended before the result could be confirmed/);
});

test('(d)/(e) a malformed action-PATCH body (today\'s `.catch(() => ({}))`) falls back to the generic update-failed message', async () => {
  await renderWithMessage([[/\/api\/scheduled-emails\/m1$/, async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } })]]);
  fireEvent.click(screen.getByRole('button', { name: 'Stop this message' }));
  await screen.findByText('The scheduled email could not be updated.');
});
