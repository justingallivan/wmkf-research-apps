/**
 * Authentication utilities for API routes
 *
 * Provides server-side session checking and profile ID extraction.
 *
 * Security layers:
 * - CSRF: Origin header validation on state-changing methods (POST/PUT/PATCH/DELETE)
 * - Session revocation: is_active check on user_profiles (2-min cache TTL)
 *
 * Kill Switch: Set AUTH_REQUIRED=false in environment to disable auth.
 * This allows emergency access if Azure AD credentials are misconfigured.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { sql } from '@vercel/postgres';
import { listAppKeysForUser } from '../services/app-access-service';
import { withDalContext } from '../dataverse/core/context';
import { isAuthRequired } from './auth-policy';

// Re-export so existing consumers keep working unchanged.
export { isAuthRequired };

/**
 * Validate the Origin (or Referer) header for CSRF protection.
 * State-changing methods (POST, PUT, PATCH, DELETE) must include an Origin
 * header matching the configured NEXTAUTH_URL. Cookie-bearing requests with
 * neither Origin nor Referer are rejected; cookie-free requests are allowed
 * through for server-to-server callers.
 *
 * @param {Object} req - Next.js API request
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateOrigin(req) {
  const method = (req.method || '').toUpperCase();
  // Only check state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  // Browser requests carrying session cookies should provide Origin/Referer.
  // Allow headerless state-changing calls only when they are cookie-free
  // server-to-server requests.
  if (!origin && !referer) {
    return req.headers?.cookie
      ? { valid: false, reason: 'Missing Origin header' }
      : { valid: true };
  }

  const allowedUrl = process.env.NEXTAUTH_URL;
  if (!allowedUrl) {
    // If NEXTAUTH_URL isn't configured, skip validation
    return { valid: true };
  }

  let allowedOrigin;
  try {
    allowedOrigin = new URL(allowedUrl).origin;
  } catch {
    return { valid: true };
  }

  // Check Origin header first, fall back to Referer
  const sourceUrl = origin || referer;
  let sourceOrigin;
  try {
    sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    return { valid: false, reason: 'Invalid Origin header' };
  }

  if (sourceOrigin !== allowedOrigin) {
    return { valid: false, reason: 'Origin mismatch' };
  }

  return { valid: true };
}

/**
 * Get the authenticated session for an API route
 * Returns null if not authenticated
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @returns {Object|null} Session object or null
 */
export async function getSession(req, res) {
  return await getServerSession(req, res, authOptions);
}

/**
 * Require authentication for an API route
 * Sends 401 response if not authenticated
 *
 * If AUTH_REQUIRED is false (kill switch), allows all requests through
 * with a mock session containing no user data.
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @returns {Object|null} Session object or null (if 401 was sent)
 *
 * @example
 * export default async function handler(req, res) {
 *   const session = await requireAuth(req, res);
 *   if (!session) return; // 401 already sent
 *
 *   // Authenticated - continue with handler
 *   const profileId = session.user.profileId;
 * }
 */
export async function requireAuth(req, res) {
  // Kill switch: if auth not required, allow through with empty session
  if (!isAuthRequired()) {
    return { user: {}, authBypassed: true };
  }

  // CSRF: validate Origin header on state-changing methods
  const originCheck = validateOrigin(req);
  if (!originCheck.valid) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const session = await getSession(req, res);

  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  return session;
}

/**
 * Require authentication and return profile ID
 * Sends 401 if not authenticated, 403 if no profile linked
 *
 * If AUTH_REQUIRED is false (kill switch), falls back to userProfileId
 * from query or body parameters (existing behavior when auth is disabled).
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @returns {number|null} Profile ID or null (if error was sent)
 *
 * @example
 * export default async function handler(req, res) {
 *   const profileId = await requireAuthWithProfile(req, res);
 *   if (profileId === null) return; // Error already sent
 *
 *   // Use profileId for scoped queries
 * }
 */
export async function requireAuthWithProfile(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return null;

  // If auth was bypassed in development, use query/body parameter
  if (session.authBypassed) {
    if (process.env.NODE_ENV === 'production') {
      console.error('AUTH_REQUIRED=false in production — refusing unauthenticated profile access');
      res.status(403).json({ error: 'Authentication is misconfigured' });
      return null;
    }
    const paramProfileId =
      req.query?.userProfileId || req.body?.userProfileId ||
      req.query?.profileId || req.body?.profileId;
    return paramProfileId ? parseInt(paramProfileId, 10) : null;
  }

  const profileId = session.user?.profileId;
  if (!profileId) {
    res.status(403).json({ error: 'No profile linked to this account' });
    return null;
  }

  // Check if user account is still active (session revocation for disabled accounts).
  // Fails closed: if the revocation check can't complete, refuse the request rather
  // than honor a session that may belong to a disabled account.
  try {
    const profileResult = await sql`SELECT is_active FROM user_profiles WHERE id = ${profileId}`;
    if (profileResult.rows.length > 0 && !profileResult.rows[0].is_active) {
      res.status(403).json({ error: 'Account has been disabled' });
      return null;
    }
  } catch (err) {
    console.error('Failed to check is_active for profile', profileId, err.message);
    res.status(503).json({ error: 'Unable to verify account status; please retry' });
    return null;
  }

  return profileId;
}

// --- App access cache ---
// Map<profileId, { apps: Set<string>, loadedAt: number }>
// Only the (non-privilege-escalating) app grants are cached. is_active and the
// superuser role are deliberately NOT cached — see requireAppAccess.
const _appAccessCache = new Map();
const APP_ACCESS_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Clear cached app access for a specific user (or all users if no ID given).
 * Call after granting/revoking app access so changes take effect immediately.
 *
 * @param {number} [profileId] - User to clear, or omit to clear all
 */
export function clearAppAccessCache(profileId) {
  if (profileId) {
    _appAccessCache.delete(profileId);
  } else {
    _appAccessCache.clear();
  }
}

/**
 * Require authentication AND app-level access for an API route.
 * Sends 401 if unauthenticated, 403 if the user lacks access to ALL listed apps.
 * Superusers bypass all app checks.
 *
 * If AUTH_REQUIRED is false (kill switch / dev mode), allows all requests through
 * with a mock result so dev workflow is unchanged.
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @param {...string} appKeys - One or more app keys; user needs ANY of them (OR logic)
 * @returns {{ profileId: number|null, session: Object }|null} - Access info or null (if error was sent)
 *
 * @example
 * export default async function handler(req, res) {
 *   const access = await requireAppAccess(req, res, 'dynamics-explorer');
 *   if (!access) return;
 *   const userProfileId = access.profileId;
 * }
 */
export async function requireAppAccess(req, res, ...appKeys) {
  // Kill switch: if auth not required, allow through
  if (!isAuthRequired()) {
    return { profileId: null, session: { user: {}, authBypassed: true } };
  }

  // CSRF: validate Origin header on state-changing methods
  const originCheck = validateOrigin(req);
  if (!originCheck.valid) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const session = await getSession(req, res);

  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const profileId = session.user?.profileId;
  if (!profileId) {
    res.status(403).json({ error: 'No profile linked to this account' });
    return null;
  }

  // App grants are cached for 2 min — stale tolerance is acceptable here since
  // a late-arriving grant/revoke just delays a route's allow/deny by minutes,
  // and an app grant is not privilege-escalating in the security sense.
  let cached = _appAccessCache.get(profileId);
  if (!cached || Date.now() - cached.loadedAt > APP_ACCESS_TTL_MS) {
    const appKeysList = await withDalContext('auth-app-access-lookup', () =>
      listAppKeysForUser(profileId));
    cached = { apps: new Set(appKeysList), loadedAt: Date.now() };
    _appAccessCache.set(profileId, cached);
  }

  // is_active and the superuser role are checked FRESH on every request —
  // never cached. Both are security-sensitive: disabling an account is a
  // revocation action (offboarding / compromise) and a superuser role is
  // privilege-escalating, so the 2-min stale-after-revoke window we tolerate
  // for app grants is unsafe for either. This matches requireAuthWithProfile's
  // live is_active check. Run as one parallel round-trip; fail closed if the
  // check can't complete.
  let isActive;
  let isSuperuser;
  try {
    const [profileResult, rolesResult] = await Promise.all([
      sql`SELECT is_active FROM user_profiles WHERE id = ${profileId}`,
      sql`SELECT role FROM dynamics_user_roles WHERE user_profile_id = ${profileId}`,
    ]);
    isActive = profileResult.rows.length === 0 || profileResult.rows[0].is_active !== false;
    isSuperuser = rolesResult.rows.some(r => r.role === 'superuser');
  } catch (err) {
    console.error('Failed to verify account status/role for profile', profileId, err.message);
    res.status(503).json({ error: 'Unable to verify account status; please retry' });
    return null;
  }

  // Block disabled accounts (before superuser bypass — disabled means disabled)
  if (!isActive) {
    res.status(403).json({ error: 'Account has been disabled' });
    return null;
  }

  if (isSuperuser) {
    return { profileId, session };
  }

  // Check if user has ANY of the requested app keys
  const hasAccess = appKeys.length === 0 || appKeys.some(key => cached.apps.has(key));
  if (!hasAccess) {
    res.status(403).json({ error: 'You do not have access to this application' });
    return null;
  }

  return { profileId, session };
}

/**
 * Look up the role string for a profile from `dynamics_user_roles`.
 *
 * Returns 'read_only' on miss or DB error so callers default to the least
 * privileged result. Uncached on purpose — role grants are privilege-
 * escalating; we don't want a cache window where a revoked superuser
 * still passes a check. One extra query per gated request.
 *
 * @param {number} profileId
 * @returns {Promise<string>} role name (e.g. 'read_only', 'read_write', 'superuser')
 */
export async function getUserRole(profileId) {
  if (!profileId) return 'read_only';
  try {
    const result = await sql`
      SELECT role FROM dynamics_user_roles
      WHERE user_profile_id = ${profileId}
    `;
    return result.rows[0]?.role || 'read_only';
  } catch {
    return 'read_only';
  }
}

/**
 * Gate an admin/superuser-only route. Combines `requireAuthWithProfile`
 * with a `dynamics_user_roles.role = 'superuser'` check. Sends 401 / 403
 * directly on failure; on success returns `{ profileId }`.
 *
 * Dev-mode kill switch (`AUTH_REQUIRED=false`) bypasses the role check
 * just like other auth helpers — matching the existing per-route pattern.
 *
 * Usage:
 *   const gate = await requireSuperuser(req, res);
 *   if (!gate) return; // response already sent
 *   const { profileId } = gate;
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @returns {Promise<{ profileId: number|null } | null>}
 */
export async function requireSuperuser(req, res) {
  if (!isAuthRequired()) {
    return { profileId: null };
  }

  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return null;

  const role = await getUserRole(profileId);
  if (role !== 'superuser') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }

  return { profileId };
}
