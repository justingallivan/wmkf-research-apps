/**
 * Unit tests for authentication utilities (lib/utils/auth.js).
 *
 * Covers:
 * - requireAuth: unauthenticated → 401, CSRF validation
 * - requireAuthWithProfile: no profile → 403, disabled → 403
 * - requireAppAccess: missing app → 403, superuser bypass, disabled → 403
 * - requireSuperuser: auth + profile + superuser role gate
 * - validateOrigin (tested via requireAuth/requireAppAccess CSRF path)
 */

import {
  mockUnauthenticated,
  mockAuthenticatedUser,
  mockDisabledUser,
  mockNoProfile,
  mockRoleLookupFailure,
  mockIsActiveLookupFailure,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../../helpers/auth-mock';

import {
  requireAuth,
  requireAuthWithProfile,
  requireAppAccess,
  requireSuperuser,
  isAuthRequired,
} from '../../../lib/utils/auth';
import { listAppKeysForUser } from '../../../lib/services/app-access-service';

const defaultListAppKeysForUser = listAppKeysForUser.getMockImplementation();

// Clear the in-memory app-access cache between every test
beforeEach(() => {
  clearAppAccessCache();
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------
describe('requireAuth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('returns session when authenticated', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
    expect(result.user.profileId).toBe(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 on CSRF origin mismatch for POST', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows POST when origin matches NEXTAUTH_URL', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'https://our-app.vercel.app' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
  });

  it('allows POST with no Origin header (server-to-server / cron)', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({ method: 'POST', headers: {} });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
  });

  it('returns 403 on POST with cookies but no Origin or Referer header', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { cookie: 'next-auth.session-token=test' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// validateOrigin — CSRF Referer-fallback + degenerate-config branches
//
// auth.js:33-79. Prior tests cover Origin-match, Origin-mismatch, and the
// no-header cases. These pin the branches the Codebase eval (2026-05-29 #4)
// flagged as untested: the `origin || referer` fallback (auth.js:66), the
// malformed-URL rejection (:71), and the skip-validation escapes when
// NEXTAUTH_URL is unset or unparseable (:53-55, :61-63). All exercised
// through requireAuth on a state-changing (POST) request.
// ---------------------------------------------------------------------------
describe('validateOrigin — Referer fallback + config edge cases', () => {
  const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;
  afterEach(() => {
    if (ORIGINAL_NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it('falls back to Referer when Origin is absent and the Referer origin matches', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { referer: 'https://our-app.vercel.app/some/page' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when Origin is absent and the Referer origin mismatches', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { referer: 'https://evil.com/landing' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('Origin takes precedence over Referer — a bad Origin is rejected even if Referer would match', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: {
        origin: 'https://evil.com',
        referer: 'https://our-app.vercel.app/page',
      },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a malformed Referer (unparseable URL) on the fallback path', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { referer: 'not-a-valid-url' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a malformed Origin (unparseable URL)', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { origin: ':::not a url' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('skips validation (allows) when NEXTAUTH_URL is unset, even on an Origin mismatch', async () => {
    mockAuthenticatedUser(1, []);
    delete process.env.NEXTAUTH_URL;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips validation (allows) when NEXTAUTH_URL is itself unparseable', async () => {
    mockAuthenticatedUser(1, []);
    process.env.NEXTAUTH_URL = 'not-a-url';

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });
    const res = createMockRes();

    const result = await requireAuth(req, res);

    expect(result).toBeTruthy();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireAuthWithProfile
// ---------------------------------------------------------------------------
describe('requireAuthWithProfile', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuthWithProfile(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 when no profile is linked', async () => {
    mockNoProfile();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuthWithProfile(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('profile') })
    );
  });

  it('returns 403 when user is disabled', async () => {
    mockDisabledUser(99);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuthWithProfile(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
  });

  it('returns profileId for valid authenticated user', async () => {
    mockAuthenticatedUser(5, ['reviewer-finder']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuthWithProfile(req, res);

    expect(result).toBe(5);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the is_active check errors', async () => {
    mockIsActiveLookupFailure(42);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAuthWithProfile(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

// ---------------------------------------------------------------------------
// requireAppAccess
// ---------------------------------------------------------------------------
describe('requireAppAccess', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 when no profile is linked', async () => {
    mockNoProfile();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when user lacks the required app', async () => {
    mockAuthenticatedUser(1, ['dynamics-explorer']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('access') })
    );
  });

  it('returns access object when user has the required app', async () => {
    mockAuthenticatedUser(3, ['reviewer-finder', 'dynamics-explorer']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeTruthy();
    expect(result.profileId).toBe(3);
    expect(result.session.user.profileId).toBe(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows access when user has ANY of multiple app keys (OR logic)', async () => {
    mockAuthenticatedUser(1, ['review-manager']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder', 'review-manager');

    expect(result).toBeTruthy();
    expect(result.profileId).toBe(1);
  });

  // Request Workbench (Phase 0): the additive `reviewers` grant is wired as the
  // variadic SECOND key on the 18 reviewer-finder/review-manager routes. A
  // user holding only `reviewers` (no legacy key) must pass both families.
  it('allows a reviewers-only grant via the variadic second key (both families)', async () => {
    mockAuthenticatedUser(8, ['reviewers']);

    const rf = await requireAppAccess(createMockReq(), createMockRes(), 'reviewer-finder', 'reviewers');
    expect(rf).toBeTruthy();
    expect(rf.profileId).toBe(8);

    const rm = await requireAppAccess(createMockReq(), createMockRes(), 'review-manager', 'reviewers');
    expect(rm).toBeTruthy();
    expect(rm.profileId).toBe(8);
  });

  it('superuser bypasses all app checks', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeTruthy();
    expect(result.profileId).toBe(2);
  });

  it('returns 403 for disabled user even with superuser role', async () => {
    mockDisabledUser(99);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'dynamics-explorer');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
  });

  it('returns 403 on CSRF origin mismatch for POST', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    process.env.NEXTAUTH_URL = 'https://our-app.vercel.app';

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });
    const res = createMockRes();

    const result = await requireAppAccess(req, res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // Codebase eval 2026-05-29 #5: is_active was cached on the 2-min app-access
  // TTL, so a deactivated account kept access for up to 2 minutes. is_active is
  // now checked fresh on every request while app grants stay cached.
  it('blocks a deactivated account immediately — is_active is NOT held for the cache TTL', async () => {
    // First request: active + granted. This populates the app-grant cache.
    mockAuthenticatedUser(1, ['reviewer-finder']);
    const first = await requireAppAccess(createMockReq(), createMockRes(), 'reviewer-finder');
    expect(first).toBeTruthy();

    // Account is disabled between requests; the app grant is still cached
    // (clearAppAccessCache is only called in beforeEach, not here), so this
    // exercises the fresh is_active read rather than a cache reload.
    mockDisabledUser(1);
    const res = createMockRes();
    const second = await requireAppAccess(createMockReq(), res, 'reviewer-finder');

    expect(second).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('disabled') })
    );
  });

  it('fails closed with 503 when the fresh is_active check errors', async () => {
    mockIsActiveLookupFailure(7);
    const res = createMockRes();

    const result = await requireAppAccess(createMockReq(), res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('fails closed with 503 when the fresh superuser-role check errors', async () => {
    // is_active resolves fine; the parallel role query rejects. The shared
    // Promise.all catch must still fail closed rather than fall through.
    mockAuthenticatedUser(5, ['reviewer-finder']);
    mockRoleLookupFailure();
    const res = createMockRes();

    const result = await requireAppAccess(createMockReq(), res, 'reviewer-finder');

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('allows an active superuser before loading app grants when Dataverse app access is unavailable', async () => {
    mockAuthenticatedUser(12, [], { isSuperuser: true });
    listAppKeysForUser.mockClear();
    listAppKeysForUser.mockImplementation(() =>
      Promise.reject(new Error('Dataverse app access unavailable')));

    try {
      const res = createMockRes();
      const result = await requireAppAccess(createMockReq(), res, 'reviewer-finder');

      expect(result).toMatchObject({ profileId: 12 });
      expect(res.status).not.toHaveBeenCalled();
      expect(listAppKeysForUser).not.toHaveBeenCalled();
    } finally {
      listAppKeysForUser.mockImplementation(defaultListAppKeysForUser);
    }
  });
});

// ---------------------------------------------------------------------------
// requireSuperuser
// ---------------------------------------------------------------------------
describe('requireSuperuser', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireSuperuser(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 when authenticated user is not a superuser', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireSuperuser(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('returns profileId when authenticated user is a superuser', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireSuperuser(req, res);

    expect(result).toEqual({ profileId: 2 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails closed when role lookup fails', async () => {
    mockAuthenticatedUser(3, []);
    mockRoleLookupFailure();
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireSuperuser(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('bypasses role check when auth is disabled in non-production', async () => {
    mockUnauthenticated();
    process.env.AUTH_REQUIRED = 'false';
    process.env.NODE_ENV = 'test';
    const req = createMockReq();
    const res = createMockRes();

    const result = await requireSuperuser(req, res);

    expect(result).toEqual({ profileId: null });
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isAuthRequired — production fail-closed
// ---------------------------------------------------------------------------
describe('isAuthRequired (production fail-closed)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns true in production when AUTH_REQUIRED is missing and no emergency bypass', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_REQUIRED;
    delete process.env.EMERGENCY_AUTH_BYPASS;
    process.env.AZURE_AD_CLIENT_ID = 'x';
    process.env.AZURE_AD_CLIENT_SECRET = 'x';
    process.env.AZURE_AD_TENANT_ID = 'x';

    expect(isAuthRequired()).toBe(true);
  });

  it('returns true in production when Azure credentials are missing and no emergency bypass', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_REQUIRED = 'true';
    delete process.env.EMERGENCY_AUTH_BYPASS;
    delete process.env.AZURE_AD_CLIENT_ID;
    delete process.env.AZURE_AD_CLIENT_SECRET;
    delete process.env.AZURE_AD_TENANT_ID;

    expect(isAuthRequired()).toBe(true);
  });

  it('returns false in production only when EMERGENCY_AUTH_BYPASS=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMERGENCY_AUTH_BYPASS = 'true';
    delete process.env.AUTH_REQUIRED;
    delete process.env.AZURE_AD_CLIENT_ID;

    expect(isAuthRequired()).toBe(false);
  });

  it('keeps existing dev behavior: false when AUTH_REQUIRED!=true', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_REQUIRED;

    expect(isAuthRequired()).toBe(false);
  });

  it('keeps existing dev behavior: false when Azure credentials missing', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_REQUIRED = 'true';
    delete process.env.AZURE_AD_CLIENT_ID;

    expect(isAuthRequired()).toBe(false);
  });

  it('returns true in dev when AUTH_REQUIRED=true and creds present', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AZURE_AD_CLIENT_ID = 'x';
    process.env.AZURE_AD_CLIENT_SECRET = 'x';
    process.env.AZURE_AD_TENANT_ID = 'x';

    expect(isAuthRequired()).toBe(true);
  });
});
