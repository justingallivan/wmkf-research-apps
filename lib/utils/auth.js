/**
 * Authentication utilities for API routes
 *
 * Provides server-side session checking and profile ID extraction.
 *
 * Security layers:
 * - CSRF: Origin header validation on state-changing methods (POST/PUT/PATCH/DELETE)
 * - Session revocation: bare requireAuth checks is_active on user_profiles on
 *   every request for non-applicant sessions (by profileId, falling back to
 *   azure_id) — no cache, fails closed on a missing profile or a DB error.
 *   requireAuthWithProfile and requireAppAccess repeat their own live
 *   is_active reads as defense in depth (also uncached; only app grants in
 *   requireAppAccess carry a 2-min cache TTL).
 *
 * Kill switch: AUTH_REQUIRED=false disables auth when NODE_ENV is not
 * `production`. Any production-mode runtime (including Vercel Preview and
 * Production) additionally requires EMERGENCY_AUTH_BYPASS=true and otherwise
 * fails closed.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { sql } from '@vercel/postgres';
import { listAppKeysForUser } from '../services/app-access-service';
import { withDalContext } from '../dataverse/core/context';
import { isAuthRequired } from './auth-policy';
import { APP_REGISTRY } from '../../shared/config/appRegistry';

// Human name for the app a route guards, for user-facing guard messages: the
// first requested key present in APP_REGISTRY (routes list canonical + legacy
// alternate keys, and legacy keys are registry-absent, so this picks the
// canonical name). Falls back for admin/unregistered namespaces and for
// routes that gate on authentication alone (no app keys).
export function appDisplayName(appKeys) {
  for (const key of appKeys) {
    const entry = APP_REGISTRY.find((app) => app.key === key);
    if (entry?.name) return `the ${entry.name} app`;
  }
  return 'this app';
}

// Re-export so existing consumers keep working unchanged.
export { isAuthRequired };

// The branded write-actor mint lives in ./actor-ref.js (a dedicated @ts-check
// module — see its design note) but is surfaced HERE so the sole sanctioned
// mint of an ActorRef is discoverable on the auth-resolver surface, alongside
// requireAppAccess/getSession. Invariant-Map #10; TYPESCRIPT_OPTION_ASSESSMENT §5.
export { actorRefFromSession } from './actor-ref.js';

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

  // Session revocation for every non-applicant caller, including the four
  // "bare" requireAuth routes that don't also call requireAuthWithProfile /
  // requireAppAccess. Applicant sessions have no user_profiles row by design
  // and are skipped; a session with no userType is staff-shaped (staff JWTs
  // predate the userType field) and is checked. Fails closed: no linkable
  // key, zero rows, or a DB error all deny the request.
  if (session.user?.userType !== 'applicant') {
    const profileId = session.user?.profileId;
    const azureId = session.user?.azureId;

    if (!profileId && !azureId) {
      res.status(403).json({ error: 'No profile linked to this account' });
      return null;
    }

    try {
      const profileResult = profileId
        ? await sql`SELECT is_active FROM user_profiles WHERE id = ${profileId}`
        : await sql`SELECT is_active FROM user_profiles WHERE azure_id = ${azureId}`;

      if (profileResult.rows.length === 0 || !profileResult.rows[0].is_active) {
        res.status(403).json({ error: 'Account has been disabled' });
        return null;
      }
    } catch (err) {
      console.error('Failed to check is_active for session', profileId || azureId, err.message);
      res.status(503).json({ error: 'Unable to verify account status; please retry' });
      return null;
    }
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
  // Fails closed on every non-active outcome, including zero rows (a deleted
  // profile is not an active one): if the revocation check can't complete,
  // refuse the request rather than honor a session that may belong to a
  // disabled or deleted account. requireAuth already performed this same
  // check above; this is a deliberate second, defense-in-depth read.
  try {
    const profileResult = await sql`SELECT is_active FROM user_profiles WHERE id = ${profileId}`;
    if (profileResult.rows.length === 0 || !profileResult.rows[0].is_active) {
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

  // is_active and the superuser role are checked FRESH on every request —
  // never cached. Both are security-sensitive: disabling an account is a
  // revocation action (offboarding / compromise) and a superuser role is
  // privilege-escalating, so the 2-min stale-after-revoke window we tolerate
  // for app grants is unsafe for either. This matches requireAuth's and
  // requireAuthWithProfile's live is_active checks (a deliberate third read,
  // defense in depth) and fails closed on zero rows or a NULL is_active —
  // a deleted or not-explicitly-active profile is not an active one. Run as
  // one parallel round-trip; fail closed if the check can't complete.
  let isActive;
  let isSuperuser;
  try {
    const [profileResult, rolesResult] = await Promise.all([
      sql`SELECT is_active FROM user_profiles WHERE id = ${profileId}`,
      sql`SELECT role FROM dynamics_user_roles WHERE user_profile_id = ${profileId}`,
    ]);
    isActive = profileResult.rows.length > 0 && profileResult.rows[0].is_active === true;
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

  // App grants are cached for 2 min — stale tolerance is acceptable here since
  // a late-arriving grant/revoke just delays a route's allow/deny by minutes,
  // and an app grant is not privilege-escalating in the security sense.
  let cached = _appAccessCache.get(profileId);
  if (!cached || Date.now() - cached.loadedAt > APP_ACCESS_TTL_MS) {
    // Fail closed on a lookup error rather than caching an empty grant set: a
    // transient Dataverse blip must not lock a legitimate user out of every app
    // for the full TTL. Mirror the retryable account-status 503 path above.
    let appKeysList;
    try {
      appKeysList = await withDalContext('auth-app-access-lookup', () =>
        listAppKeysForUser(profileId, { throwOnError: true }));
    } catch (err) {
      console.error('Failed to load app grants for profile', profileId, err.message);
      // This is OUR lookup failing (the server's Dataverse grant query), not
      // anything about the user or their access — the user is already inside
      // the app. Wording set verbatim by the owner (2026-08-06) after three
      // rounds: earlier drafts kept implying the user's access was in doubt.
      res.status(503).json({ error: "I'm having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn't resolve, contact an administrator." });
      return null;
    }
    cached = { apps: new Set(appKeysList), loadedAt: Date.now() };
    _appAccessCache.set(profileId, cached);
  }

  // Check if user has ANY of the requested app keys
  const hasAccess = appKeys.length === 0 || appKeys.some(key => cached.apps.has(key));
  if (!hasAccess) {
    res.status(403).json({ error: `Your account does not have access to ${appDisplayName(appKeys)}` });
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
