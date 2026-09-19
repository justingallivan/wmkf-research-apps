/**
 * GraphService authentication owner.
 *
 * The token cache, shared request, and generation fence live here. The
 * facade keeps its public async method and forwards the receiver plus the
 * bound timeout option so spies, subclasses, and option evaluation remain
 * unchanged.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { API_TIMEOUT } from './constants.js';
import { clampApiTimeout, fetchWithTimeout, waitForPromiseWithin } from './http.js';

// Separate token cache from Dynamics (different scope)
let tokenCache = { token: null, expiresAt: 0 };
let tokenPromise = null;
let tokenGeneration = 0;

/**
 * Get a Graph API access token via client credentials grant.
 * Returns a cached token if still valid.
 *
 * SECURITY: The returned token grants service-principal-level access to
 * Microsoft Graph (SharePoint). It must NEVER be logged to console,
 * included in error messages, returned in API responses, sent via SSE,
 * stored in the database, or passed to third-party APIs (including Claude).
 * See .semgrep/token-audit.yaml for automated enforcement.
 */
export async function getAccessToken(_svc, { timeoutMs = API_TIMEOUT } = {}) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
  if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
    // Forced non-transient: config bug, not a real 500 — see dynamics-service
    // missing-env note. The drain classifier should terminal-fail, not retry.
    throw buildServiceError(
      'graph',
      { status: 500 },
      'Missing Azure AD credentials for Graph API (DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET)',
      { isTransient: false },
    );
  }

  const boundedTimeoutMs = clampApiTimeout(timeoutMs);
  if (!tokenPromise) {
    const generation = tokenGeneration;
    const tokenUrl = `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DYNAMICS_CLIENT_ID,
      client_secret: DYNAMICS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    });

    const request = (async () => {
      const resp = await fetchWithTimeout(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }, API_TIMEOUT);

      if (!resp.ok) {
        const text = await resp.text();
        throw buildServiceError('graph', resp, text);
      }

      const data = await resp.json();
      if (generation === tokenGeneration) {
        tokenCache = {
          token: data.access_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        };
      }
      return data.access_token;
    })();
    const sharedRequest = request.finally(() => {
      if (tokenPromise === sharedRequest) tokenPromise = null;
    });
    tokenPromise = sharedRequest;
  }

  return waitForPromiseWithin(tokenPromise, boundedTimeoutMs);
}

export function resetAuthCache() {
  tokenCache = { token: null, expiresAt: 0 };
  tokenPromise = null;
  tokenGeneration += 1;
}
