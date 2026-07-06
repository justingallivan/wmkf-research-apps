/**
 * DynamicsService decomposition — Stage 1 leaf module (Checkpoint A).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the `tokenCache` state
 * (was a module-level `let`), `getAccessToken` (was a static method; uses no
 * `this`), and the token-cache reset (was inlined in the facade's
 * `clearCaches`, now the named `resetTokenCache` export per Q3). The facade
 * keeps a thin `getAccessToken` wrapper that delegates here, and `clearCaches`
 * now calls `resetTokenCache()`.
 *
 * Deps: http (`fetchWithTimeout`), constants (`API_TIMEOUT`), service-error.
 *
 * SECURITY: The returned token grants service-principal-level access to
 * Dynamics 365. It must NEVER be logged to console, included in error
 * messages, returned in API responses, sent via SSE, stored in the database,
 * or passed to third-party APIs (including Claude).
 * See .semgrep/token-audit.yaml for automated enforcement.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { API_TIMEOUT } from './constants.js';
import { fetchWithTimeout } from './http.js';

// Module-level cache (moved verbatim from the facade).
let tokenCache = { token: null, expiresAt: 0 };

/**
 * Get an access token via client credentials grant.
 * Returns a cached token if still valid.
 */
export async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const {
    DYNAMICS_URL,
    DYNAMICS_TENANT_ID,
    DYNAMICS_CLIENT_ID,
    DYNAMICS_CLIENT_SECRET,
  } = process.env;

  if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
    // Forced non-transient: this is a config bug, not a real 500 — retrying
    // can't recover from missing env vars. Round-11 §5 found that without the
    // override, the drain would burn max_attempts retrying a bug it can't fix.
    throw buildServiceError(
      'dataverse',
      { status: 500 },
      'Missing Dynamics 365 environment variables (DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET)',
      { isTransient: false },
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: DYNAMICS_CLIENT_ID,
    client_secret: DYNAMICS_CLIENT_SECRET,
    scope: `${DYNAMICS_URL}/.default`,
  });

  const resp = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const text = await resp.text();
    throw buildServiceError('dataverse', resp, text);
  }

  const data = await resp.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

/**
 * Reset the module-level token cache. Called by the facade's `clearCaches`
 * (Q3 seam) and available for tests/admin reset.
 */
export function resetTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}
