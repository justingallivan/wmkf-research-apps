/**
 * Auth policy — single source of truth for "should auth be enforced on this
 * request?". Imported by both the server-side proxy (`proxy.js`) and Node
 * Runtime callers (lib/utils/auth.js).
 *
 * Bundle constraint: this module must not import anything that pulls in Node
 * built-ins or the @vercel/postgres / next-auth/next stack — those break the
 * proxy bundle. It only reads `process.env`, which is available in both
 * runtimes.
 *
 * Why this exists: before the consolidation, the auth gate used a one-line
 *
 *     if (process.env.AUTH_REQUIRED !== 'true') return true;
 *
 * which fails OPEN if AUTH_REQUIRED is missing or wrong in production —
 * the API path's `isAuthRequired()` already failed CLOSED in the same
 * scenario, so the two layers disagreed in the worst direction.
 * `isAuthRequired()` is now defined here and used by both.
 */

const ENV = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AZURE_AD_CLIENT_ID: 'AZURE_AD_CLIENT_ID',
  AZURE_AD_CLIENT_SECRET: 'AZURE_AD_CLIENT_SECRET',
  AZURE_AD_TENANT_ID: 'AZURE_AD_TENANT_ID',
  EMERGENCY_AUTH_BYPASS: 'EMERGENCY_AUTH_BYPASS',
  NODE_ENV: 'NODE_ENV',
};

// One-shot logging so the proxy (called per request) doesn't spam.
const _warned = new Set();
function warnOnce(key, message) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.error(message);
}
function logBypassOnce(message) {
  if (_warned.has('bypass')) return;
  _warned.add('bypass');
  console.warn(message);
}

/**
 * Decide whether auth should be enforced.
 *
 * Production fails closed: returns true unconditionally unless
 * EMERGENCY_AUTH_BYPASS=true is set explicitly. A misconfigured prod deploy
 * (missing AUTH_REQUIRED, missing Azure credentials) does NOT silently
 * disable auth — downstream session checks 401 cleanly instead.
 *
 * Non-production keeps the existing dev/test behavior: auth disabled if
 * AUTH_REQUIRED!='true' or Azure credentials are absent.
 *
 * @returns {boolean}
 */
export function isAuthRequired() {
  const env = process.env;
  const hasCredentials = !!(
    env[ENV.AZURE_AD_CLIENT_ID] &&
    env[ENV.AZURE_AD_CLIENT_SECRET] &&
    env[ENV.AZURE_AD_TENANT_ID]
  );
  const authRequired = env[ENV.AUTH_REQUIRED] === 'true';
  const isProduction = env[ENV.NODE_ENV] === 'production';
  const emergencyBypass = env[ENV.EMERGENCY_AUTH_BYPASS] === 'true';

  if (isProduction && !emergencyBypass) {
    if (!authRequired) {
      warnOnce('prod-auth-required', '[auth-policy] AUTH_REQUIRED!=true in production — enforcing auth (set EMERGENCY_AUTH_BYPASS=true to override)');
    }
    if (!hasCredentials) {
      warnOnce('prod-credentials', '[auth-policy] Azure AD credentials missing in production — enforcing auth (downstream calls will 401 until restored)');
    }
    return true;
  }

  if (isProduction && emergencyBypass) {
    logBypassOnce('[auth-policy] EMERGENCY_AUTH_BYPASS=true in production — authentication is disabled');
  }

  return authRequired && hasCredentials;
}

/**
 * Test-only: reset the one-shot warning memo. Production callers should never
 * need this; tests that exercise multiple environments back-to-back do.
 */
export function _resetWarningsForTests() {
  _warned.clear();
}
