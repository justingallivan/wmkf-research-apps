/**
 * @jest-environment jsdom
 *
 * RequireAuth render race (S398 latency increment C).
 *
 * Baseline bug: authEnabled starts false so children mount at t=0; when
 * /api/auth/status resolves true while useSession() is still 'loading',
 * RequireAuth swapped to a spinner — UNMOUNTING the provider subtree and
 * discarding its in-flight /api/app-access fetch — then remounted everything
 * when the session resolved. These tests pin the fixed contract:
 *   1. children mount exactly ONCE across enabled-flip + loading→authenticated;
 *   2. 'unauthenticated' still replaces children with the sign-in screen;
 *   3. getAuthEnabled dedupes concurrent /api/auth/status lookups and does not
 *      cache failures.
 */
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import RequireAuth from '../../shared/components/RequireAuth';
import { getAuthEnabled, _resetForTests } from '../../shared/utils/auth-enabled';

// Controllable session state — tests mutate sessionState between renders.
let sessionState;
jest.mock('next-auth/react', () => ({
  useSession: () => sessionState,
  signIn: jest.fn(),
}));

jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/workbench/some-id' }),
}));

jest.mock('../../shared/components/ProfileLinkingDialog', () => ({
  __esModule: true,
  default: () => <div>LINKING DIALOG</div>,
}));

const okStatus = (enabled) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ enabled }) });

let mountCount;
let unmountCount;
function MountProbe() {
  useEffect(() => {
    mountCount += 1;
    return () => {
      unmountCount += 1;
    };
  }, []);
  return <div>CHILD CONTENT</div>;
}

beforeEach(() => {
  mountCount = 0;
  unmountCount = 0;
  _resetForTests();
  delete window.__AUTH_ENABLED__;
  sessionState = { data: null, status: 'loading' };
  global.fetch = jest.fn(() => okStatus(true));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('children mount exactly once across enabled-flip and loading→authenticated', async () => {
  const { rerender } = render(
    <RequireAuth>
      <MountProbe />
    </RequireAuth>,
  );

  // t=0: authEnabled=false → children render immediately (designed no-flicker).
  expect(screen.getByText('CHILD CONTENT')).toBeInTheDocument();
  expect(mountCount).toBe(1);

  // /api/auth/status resolves true while the session is still 'loading' —
  // the baseline bug unmounted children here.
  await act(async () => {});
  expect(screen.getByText('CHILD CONTENT')).toBeInTheDocument();
  expect(unmountCount).toBe(0);

  // Session resolves authenticated.
  sessionState = {
    data: { user: { name: 'Staff' } },
    status: 'authenticated',
  };
  rerender(
    <RequireAuth>
      <MountProbe />
    </RequireAuth>,
  );

  expect(screen.getByText('CHILD CONTENT')).toBeInTheDocument();
  expect(mountCount).toBe(1); // never remounted
  expect(unmountCount).toBe(0); // never unmounted
});

test('unauthenticated still replaces children with the sign-in screen', async () => {
  const { rerender } = render(
    <RequireAuth>
      <MountProbe />
    </RequireAuth>,
  );
  await act(async () => {}); // authEnabled=true lands

  sessionState = { data: null, status: 'unauthenticated' };
  rerender(
    <RequireAuth>
      <MountProbe />
    </RequireAuth>,
  );

  expect(screen.queryByText('CHILD CONTENT')).not.toBeInTheDocument();
  expect(screen.getByText('Sign In Required')).toBeInTheDocument();
  expect(unmountCount).toBe(1); // the deliberate teardown, not the race
});

test('getAuthEnabled dedupes concurrent lookups into one fetch', async () => {
  const [a, b] = await Promise.all([getAuthEnabled(), getAuthEnabled()]);
  expect(a).toBe(true);
  expect(b).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);

  // Cached value short-circuits later mounts entirely.
  await expect(getAuthEnabled()).resolves.toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a transient 503 JSON body is not cached as auth-disabled (Codex S398)', async () => {
  // First lookup: 503 with a JSON error body — must NOT land in the cache.
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'temporary' }) }),
  );
  await expect(getAuthEnabled()).resolves.toBe(false);
  expect(window.__AUTH_ENABLED__).toBeUndefined();

  // Recovery: the next mount performs a SECOND fetch and gets the truth.
  global.fetch = jest.fn(() => okStatus(true));
  await expect(getAuthEnabled()).resolves.toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(window.__AUTH_ENABLED__).toBe(true);
});

test('a 200 with an invalid shape is not cached either', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
  );
  await expect(getAuthEnabled()).resolves.toBe(false);
  expect(window.__AUTH_ENABLED__).toBeUndefined();

  global.fetch = jest.fn(() => okStatus(true));
  await expect(getAuthEnabled()).resolves.toBe(true);
});

test('getAuthEnabled resolves false on failure and does not cache it', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
  await expect(getAuthEnabled()).resolves.toBe(false);
  expect(window.__AUTH_ENABLED__).toBeUndefined();

  // Next mount retries and can succeed.
  global.fetch = jest.fn(() => okStatus(true));
  await expect(getAuthEnabled()).resolves.toBe(true);
  expect(window.__AUTH_ENABLED__).toBe(true);
});
