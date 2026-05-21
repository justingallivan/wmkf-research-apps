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
