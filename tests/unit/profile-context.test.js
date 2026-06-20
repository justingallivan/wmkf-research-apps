/**
 * @jest-environment jsdom
 *
 * Regression tests for the S203 atomic ProfileContext refactor
 * (shared/context/ProfileContext.js).
 *
 * Two of the refactor's bugs shipped green through lint + the full unit suite +
 * build because this file had ZERO tests (see
 * .claude-memory/feedback-profile-context-runtime-bugs.md). These tests pin the
 * two CI-invisible failure modes at the unit level so a reintroduction goes red:
 *
 *   1. Init infinite fetch loop — `loadSession` must NOT depend on the
 *      `state.profiles` it mutates, or the init effect retriggers forever.
 *   2. Destructive migration data loss — localStorage legacy keys must only be
 *      purged after a CONFIRMED-successful save (`response.ok`); fetch() does
 *      not throw on HTTP 4xx/5xx.
 *
 * Plus two structural guards for the new useReducer state machine:
 *   3. Switching profiles clears the prior profile's preferences immediately
 *      (no cross-user "flash").
 *   4. An out-of-order (stale) request must not clobber the active one
 *      (activeRequestId fencing).
 */

import { useEffect } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { ProfileProvider, useProfile } from '../../shared/context/ProfileContext';
import { PREFERENCE_KEYS, STORAGE_KEYS } from '../../shared/config/reviewerFinderPreferences';

// --- next-auth/react mock --------------------------------------------------
let mockSession = { data: null, status: 'unauthenticated' };
jest.mock('next-auth/react', () => ({
  useSession: () => mockSession,
}));

const MIGRATION_FLAG = '_legacy_migration_complete';
const SELECTED_PROFILE_KEY = 'selected_user_profile_id';

const PROFILES = [
  { id: 1, name: 'Alice', displayName: 'Alice', isDefault: true },
  { id: 2, name: 'Bob', displayName: 'Bob', isDefault: false },
];

// --- routable fetch mock ---------------------------------------------------
// Configurable per-test handlers keyed by `${method} ${pathname}`.
function makeJsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

let fetchHandlers;
let profilesFetchCount;

function installFetch() {
  profilesFetchCount = 0;
  global.fetch.mockImplementation((url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const u = new URL(url, 'http://localhost');
    const path = u.pathname;

    if (path === '/api/user-profiles' && method === 'GET') {
      profilesFetchCount += 1;
    }

    const key = `${method} ${path}`;
    const handler = fetchHandlers[key];
    if (handler) return handler(u, opts);

    // Sensible defaults so unconfigured calls don't explode.
    if (path === '/api/user-profiles' && method === 'GET') {
      return makeJsonResponse({ profiles: PROFILES });
    }
    if (path === '/api/user-profiles') {
      return makeJsonResponse({ profile: PROFILES[0] });
    }
    if (path === '/api/user-preferences' && method === 'GET') {
      return makeJsonResponse({ preferences: { [MIGRATION_FLAG]: 'true' } });
    }
    if (path === '/api/user-preferences') {
      return makeJsonResponse({ ok: true });
    }
    return makeJsonResponse({});
  });
}

// --- test consumer ---------------------------------------------------------
function Probe() {
  const { status, profileId, profileName, preferences } = useProfile();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="profileId">{String(profileId)}</span>
      <span data-testid="profileName">{String(profileName)}</span>
      <span data-testid="prefKeys">{Object.keys(preferences).sort().join(',')}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <ProfileProvider>
      <Probe />
    </ProfileProvider>,
  );
}

beforeEach(() => {
  fetchHandlers = {};
  localStorage.clear();
  mockSession = { data: null, status: 'unauthenticated' };
  installFetch();
});

describe('ProfileContext — init fetch loop regression (bug 1)', () => {
  it('fetches the profiles list a bounded number of times and then settles', async () => {
    renderProvider();

    // Wait for the provider to reach a terminal state.
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    const countAtReady = profilesFetchCount;

    // Let any runaway effect iterations fire. A loop (loadSession depending on
    // state.profiles) keeps incrementing the count here; the fixed version does
    // not call it again after settling.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(profilesFetchCount).toBe(countAtReady);
    // Default path: one init fetch + the loadSession reuse-from-ref (no refetch).
    expect(countAtReady).toBeLessThanOrEqual(2);
  });
});

describe('ProfileContext — destructive migration data-loss regression (bug 2)', () => {
  // Authenticated so init takes the profileId path → loadSession → migrate.
  function authenticate(profileId = 1) {
    mockSession = { data: { user: { profileId } }, status: 'authenticated' };
  }

  function seedLegacyLocalStorage() {
    // CURRENT_CYCLE is stored as a plain string; the others as base64 JSON.
    localStorage.setItem(STORAGE_KEYS.CURRENT_CYCLE, 'J26');
    localStorage.setItem(
      STORAGE_KEYS.SENDER_INFO,
      btoa(JSON.stringify({ name: 'Alice', email: 'alice@wmkeck.org', signature: 'Cheers' })),
    );
  }

  it('PRESERVES localStorage when the migration save fails (HTTP 500)', async () => {
    authenticate(1);
    seedLegacyLocalStorage();

    fetchHandlers['GET /api/user-preferences'] = () =>
      makeJsonResponse({ preferences: {} }); // no MIGRATION_FLAG → migration runs
    fetchHandlers['POST /api/user-preferences'] = () =>
      makeJsonResponse({ error: 'boom' }, { ok: false, status: 500 });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    // The save was rejected — the legacy keys must still be there.
    expect(localStorage.getItem(STORAGE_KEYS.CURRENT_CYCLE)).toBe('J26');
    expect(localStorage.getItem(STORAGE_KEYS.SENDER_INFO)).not.toBeNull();
  });

  it('purges localStorage only after a confirmed-successful save', async () => {
    authenticate(1);
    seedLegacyLocalStorage();

    fetchHandlers['GET /api/user-preferences'] = () =>
      makeJsonResponse({ preferences: {} });
    fetchHandlers['POST /api/user-preferences'] = () =>
      makeJsonResponse({ ok: true });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    expect(localStorage.getItem(STORAGE_KEYS.CURRENT_CYCLE)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.SENDER_INFO)).toBeNull();
    // Migrated prefs surfaced to consumers.
    expect(screen.getByTestId('prefKeys').textContent).toContain(PREFERENCE_KEYS.SENDER_INFO);
    expect(screen.getByTestId('prefKeys').textContent).toContain(PREFERENCE_KEYS.EMAIL_SIGNATURE);
  });

  it('copies legacy SENDER_INFO to EMAIL_SIGNATURE even when the old migration flag is already set', async () => {
    authenticate(1);
    const legacySender = JSON.stringify({ name: 'Alice', email: 'alice@wmkeck.org', signature: 'Cheers' });
    fetchHandlers['GET /api/user-preferences'] = () =>
      makeJsonResponse({
        preferences: {
          [MIGRATION_FLAG]: 'true',
          [PREFERENCE_KEYS.SENDER_INFO]: legacySender,
        },
      });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    expect(screen.getByTestId('prefKeys').textContent).toContain(PREFERENCE_KEYS.EMAIL_SIGNATURE);
  });
});

describe('ProfileContext — state-machine structural guards', () => {
  it('clears the prior profile preferences immediately on switch (no stale flash)', async () => {
    // Start authenticated on profile 1 with a known preference.
    mockSession = { data: { user: { profileId: 1 } }, status: 'authenticated' };
    fetchHandlers['GET /api/user-preferences'] = (u) => {
      const pid = u.searchParams.get('profileId');
      if (pid === '1') {
        return makeJsonResponse({
          preferences: { [MIGRATION_FLAG]: 'true', [PREFERENCE_KEYS.EMAIL_TEMPLATE]: 'tmpl-1' },
        });
      }
      // Profile 2 GET hangs forever, so we can observe the loading window.
      return new Promise(() => {});
    };

    const handle = {};
    function Capture() {
      const c = useProfile();
      useEffect(() => { handle.current = c; });
      return <Probe />;
    }
    render(
      <ProfileProvider>
        <Capture />
      </ProfileProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('profileId').textContent).toBe('1'));
    expect(screen.getByTestId('prefKeys').textContent).toContain(PREFERENCE_KEYS.EMAIL_TEMPLATE);

    // Switch to profile 2 — its GET never resolves, so we sit in loading.
    await act(async () => {
      handle.current.selectProfile(2);
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('loading'));
    // The old profile's preferences must NOT still be showing.
    expect(screen.getByTestId('prefKeys').textContent).toBe('');
    expect(screen.getByTestId('profileId').textContent).toBe('2');
  });

  it('ignores a stale (out-of-order) request resolving after a newer one', async () => {
    mockSession = { data: { user: { profileId: 1 } }, status: 'authenticated' };

    let resolveProfile1Prefs;
    fetchHandlers['GET /api/user-preferences'] = (u) => {
      const pid = u.searchParams.get('profileId');
      if (pid === '1') {
        // Defer profile 1's prefs so we can resolve it AFTER switching to 2.
        return new Promise((resolve) => {
          resolveProfile1Prefs = () =>
            resolve({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  preferences: { [MIGRATION_FLAG]: 'true', [PREFERENCE_KEYS.EMAIL_TEMPLATE]: 'STALE-1' },
                }),
            });
        });
      }
      return makeJsonResponse({
        preferences: { [MIGRATION_FLAG]: 'true', [PREFERENCE_KEYS.EMAIL_TEMPLATE]: 'fresh-2' },
      });
    };

    const handle = {};
    function Capture() {
      const c = useProfile();
      useEffect(() => { handle.current = c; });
      return <Probe />;
    }
    render(
      <ProfileProvider>
        <Capture />
      </ProfileProvider>,
    );

    // Init kicked off profile 1's load (now pending). Switch to profile 2,
    // which resolves immediately.
    await act(async () => {
      handle.current.selectProfile(2);
    });
    await waitFor(() => expect(screen.getByTestId('profileId').textContent).toBe('2'));
    expect(screen.getByTestId('prefKeys').textContent).toContain(PREFERENCE_KEYS.EMAIL_TEMPLATE);

    // Now let the STALE profile-1 request resolve. activeRequestId fencing must
    // drop it — neither the profile nor its prefs may overwrite profile 2.
    await act(async () => {
      resolveProfile1Prefs();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId('profileId').textContent).toBe('2');
    expect(screen.getByTestId('profileName').textContent).toBe('Bob');
  });
});
