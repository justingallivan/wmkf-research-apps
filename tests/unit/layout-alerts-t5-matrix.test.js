/**
 * @jest-environment jsdom
 *
 * Layout — T5 matrix (Stage 5a). No RTL test exercises the admin-alerts
 * nav-badge fetch today. It is a best-effort background feed:
 * `res.ok ? res.json() : null` then `.catch(() => {})` — every failure was
 * already silently swallowed (no badge shown). Migrated to requestEnvelope
 * with tolerantBody: true, D1-preserve (migrated without adding a new
 * guard): 2xx success still sets the count; non-2xx, network rejection,
 * and axis (e) all still resolve to no badge, never throwing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import Layout from '../../shared/components/Layout';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Staff' } }, status: 'authenticated' }),
  signOut: jest.fn(),
}));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: null, profiles: [] }) }));
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: true, hasAccess: () => true }) }));
jest.mock('../../shared/utils/auth-enabled', () => ({ getAuthEnabled: () => Promise.resolve(true) }));
jest.mock('../../shared/config/appRegistry', () => ({ APP_REGISTRY: [] }));
jest.mock('next/link', () => function LinkStub({ href, children }) {
  return <a href={typeof href === 'string' ? href : '#'}>{children}</a>;
});

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

async function renderLayoutAndOpenNav() {
  render(<Layout>content</Layout>);
  await screen.findByText('content');
}

test('alerts feed: 2xx success sets the Admin nav badge', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ critical: 2, error: 1 }) });
  await renderLayoutAndOpenNav();
  await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
  expect(await screen.findByText('3')).toBeInTheDocument();
});

test('alerts feed: non-2xx never throws and shows no badge (fail-open, D1-preserve)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'nope' }) });
  await renderLayoutAndOpenNav();
  await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
  expect(screen.queryByText('nope')).not.toBeInTheDocument();
});

test('alerts feed: network rejection never throws and shows no badge (fail-open, D1-preserve)', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await renderLayoutAndOpenNav();
  await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
  expect(screen.queryByText('offline')).not.toBeInTheDocument();
});

test('alerts feed axis (e): non-2xx unparseable body never throws and shows no badge (fail-open, D1-preserve)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  await renderLayoutAndOpenNav();
  await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
});
