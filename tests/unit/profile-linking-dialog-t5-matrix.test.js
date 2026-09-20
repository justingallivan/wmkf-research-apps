/**
 * @jest-environment jsdom
 *
 * ProfileLinkingDialog — T5 matrix (Stage 5a). No RTL test exists today
 * (require-auth-render-race.test.js only mocks the module). The file's 3
 * fetch sites:
 *   - fetchProfiles   GET  /api/user-profiles?linkable=true (strict 2xx,
 *     no catch; failure text is a fixed 'Failed to fetch profiles',
 *     ignoring any server body — preserved via requestEnvelope with the
 *     default strict tolerantBody, ignoring `data` on !ok)
 *   - handleLinkProfile  POST /api/auth/link-profile (bare `.json()`,
 *     migrated to requestEnvelope tolerant, so axis (e) — an unparseable
 *     non-2xx body — now shows the fallback text instead of leaking the
 *     raw parse error, the plan's default D3 policy)
 *   - handleCreateNew    POST /api/auth/link-profile (same shape)
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfileLinkingDialog from '../../shared/components/ProfileLinkingDialog';

jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));

const PROFILE = { id: 'p1', name: 'Pat Person', email: 'pat@example.org' };
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('fetchProfiles: 2xx success renders the profile list', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ profiles: [PROFILE] }) });
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  expect(await screen.findByText('Pat Person')).toBeInTheDocument();
});

test('fetchProfiles: non-2xx is never silent, ignoring any server body (fixed message)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  expect(await screen.findByText('Failed to load existing profiles')).toBeInTheDocument();
  expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
});

test('fetchProfiles: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  expect(await screen.findByText('Failed to load existing profiles')).toBeInTheDocument();
});

test('fetchProfiles: 2xx malformed body still throws (strict, no .catch), never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  expect(await screen.findByText('Failed to load existing profiles')).toBeInTheDocument();
});

async function readyDialog() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ profiles: [PROFILE] }) });
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  await screen.findByText('Pat Person');
  fireEvent.click(screen.getByText('Pat Person'));
}

test('handleLinkProfile: non-2xx {error} surfaces the server message verbatim', async () => {
  await readyDialog();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Already linked' }) });
  fireEvent.click(screen.getByRole('button', { name: /link.*profile/i }));
  expect(await screen.findByText('Already linked')).toBeInTheDocument();
});

test('handleLinkProfile: network rejection is never silent', async () => {
  await readyDialog();
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: /link.*profile/i }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('handleLinkProfile axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  await readyDialog();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  fireEvent.click(screen.getByRole('button', { name: /link.*profile/i }));
  expect(await screen.findByText('Failed to link profile')).toBeInTheDocument();
});

test('handleLinkProfile: request bytes (url, method, headers, exact body) unchanged', async () => {
  await readyDialog();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    captured = [url, opts];
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  fireEvent.click(screen.getByRole('button', { name: /link.*profile/i }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/auth/link-profile');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({ profileId: 'p1' }));
});

test('handleCreateNew axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ profiles: [PROFILE] }) });
  render(<ProfileLinkingDialog session={{ user: { name: 'Pat Person', email: 'pat@example.org' } }} onLinked={jest.fn()} />);
  await screen.findByText('Pat Person');
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  fireEvent.click(screen.getByRole('button', { name: /create.*new/i }));
  expect(await screen.findByText('Failed to create profile')).toBeInTheDocument();
});
