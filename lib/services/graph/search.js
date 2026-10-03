/**
 * GraphService SharePoint content search and retry cooldown.
 *
 * Search retry policy and process cooldown remain together so every caller
 * observes the same tenant-throttle behavior. Public facade receivers arrive
 * as `svc`.
 */

import {
  ALLOWED_LIBRARIES,
  API_TIMEOUT,
  GRAPH_BASE,
} from './constants.js';
import { buildServiceError } from '../../utils/service-error.js';
import { configuredSharePointTargetInfo } from '../sharepoint-target-registry.js';
import { fetchWithTimeout } from './http.js';

// searchFiles retry policy. Graph `/search/query` is throttled at the TENANT
// level (`TenantRequestThrottled`), and independent requests/function
// instances can still overlap even though one Explorer request now serializes
// its archive probes. A burst of 429s is therefore an expected failure shape,
// not a fault worth an operational-events row for every retry.
// Retry throttles/transient 5xx with a Retry-After-aware backoff before
// failing; the final failure still logs and throws (S468).
function isRetryableSearchStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
const SEARCH_MAX_ATTEMPTS = 3;
// Fallback (no Retry-After) exponential backoff cap, with ±50% jitter so the
// independent callers do not retry as one synchronized burst.
const SEARCH_BACKOFF_CAP_MS = 5_000;
// A Retry-After the tenant sends is never shortened (Codex adversarial
// finding S468: retrying early against a tenant-level throttle only deepens
// it). If the requested wait exceeds this budget the search is NOT retried;
// the error carries `retryAfterMs` so callers can hold off instead.
const SEARCH_MAX_RETRY_WAIT_MS = 10_000;
// Process-level cooldown: once the tenant answers a search with a Retry-After
// we will not wait out, EVERY searchFiles caller in this process (all chat
// requests on this function instance) fails fast with the remaining wait
// instead of re-entering the throttle. Per instance, so it is a damper, not a
// guarantee; cleared by clearCaches() for tests.
let searchCooldownUntil = 0;
let searchCooldownStatus = null;

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(value, now = Date.now()) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

/**
 * Plan the wait before search attempt `attempt + 1`.
 * Returns `{ waitMs }` to retry, or `{ waitMs: null, retryAfterMs }` when the
 * tenant asked for longer than the retry budget allows (do not retry).
 */
function planSearchRetry(resp, attempt, random = Math.random) {
  const fromHeader = parseRetryAfterMs(resp?.headers?.get?.('retry-after'));
  if (fromHeader != null) {
    if (fromHeader > SEARCH_MAX_RETRY_WAIT_MS) return { waitMs: null, retryAfterMs: fromHeader };
    return { waitMs: fromHeader, retryAfterMs: fromHeader };
  }
  const base = Math.min(500 * 2 ** (attempt - 1), SEARCH_BACKOFF_CAP_MS);
  const jitter = base * (0.5 + random()); // 0.5×–1.5× base
  return { waitMs: Math.round(jitter), retryAfterMs: null };
}

export function resetSearchCooldown() {
  searchCooldownUntil = 0;
  searchCooldownStatus = null;
}

/**
 * Search within SharePoint document contents using the Microsoft Graph Search API.
 * Uses KQL (Keyword Query Language) for full-text content search including PDFs.
 * Results are scoped to the akoyaGO site and post-filtered to allowed libraries.
 *
 * @param {string} query - Search keywords or quoted phrase (e.g. "budget justification")
 * @param {Object} [options]
 * @param {string} [options.libraryName] - Scope to a specific document library
 * @param {string} [options.folderPath] - Scope to a specific folder within the library
 * @returns {Promise<Array<{name, size, lastModified, webUrl, summary, library, folder}>>}
 */
export async function searchFiles(svc, query, { libraryName, folderPath } = {}) {
  if (libraryName && !ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
    throw new Error(
      `Document library "${libraryName}" is not in the allowlist.`
    );
  }

  const target = configuredSharePointTargetInfo();
  if (!target.registered) {
    throw buildServiceError(
      'graph',
      { status: 400 },
      'SHAREPOINT_SITE_URL does not match a registered SharePoint site.',
      { isTransient: false },
    );
  }
  const siteUrl = target.siteUrl.replace(/\/$/, '');

  // Build KQL with path scoping to the site (and optionally library/folder)
  let pathScope = siteUrl;
  if (libraryName) {
    pathScope += `/${libraryName}`;
    if (folderPath) {
      pathScope += `/${folderPath}`;
    }
  }
  const kql = `${query} path:"${pathScope}"`;

  const cooldownRemainingMs = searchCooldownUntil - Date.now();
  if (cooldownRemainingMs > 0) {
    const cooldownStatus = searchCooldownStatus || 429;
    const error = new Error(`SharePoint search failed (${cooldownStatus}): search cooling down for ${Math.ceil(cooldownRemainingMs / 1000)}s after a transient Graph response`);
    error.serviceName = 'graph';
    error.status = cooldownStatus;
    error.isTransient = true;
    error.attempts = 0;
    error.retryAfterMs = cooldownRemainingMs;
    error.cooldown = true;
    throw error;
  }

  const token = await svc.getAccessToken();
  const requestInit = {
    method: 'POST',
    headers: {
      ...svc.buildHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        entityTypes: ['driveItem'],
        query: { queryString: kql },
        region: 'US', // Required for application (client_credentials) permissions
        size: 100,
      }],
    }),
  };

  let resp;
  for (let attempt = 1; ; attempt += 1) {
    resp = await fetchWithTimeout(`${GRAPH_BASE}/search/query`, requestInit, API_TIMEOUT);
    if (resp.ok) break;

    const retryable = isRetryableSearchStatus(resp.status);
    const plan = retryable && attempt < SEARCH_MAX_ATTEMPTS ? planSearchRetry(resp, attempt) : null;
    if (!plan || plan.waitMs == null) {
      const text = await resp.text();
      console.error(
        `[GraphService] searchFiles failed (${resp.status}) after ${attempt} attempt(s):`,
        text.substring(0, 500),
      );
      // Keep the historical message shape (callers surface `err.message`);
      // add the structured fields the rest of the service carries so
      // callers can tell throttling from a bad query and honour the
      // tenant's requested wait.
      const error = new Error(`SharePoint search failed (${resp.status}): ${text}`);
      error.serviceName = 'graph';
      error.status = resp.status;
      error.isTransient = retryable;
      error.attempts = attempt;
      error.retryAfterMs = plan?.retryAfterMs ?? parseRetryAfterMs(resp.headers?.get?.('retry-after'));
      if (retryable && error.retryAfterMs > 0) {
        const candidateUntil = Date.now() + error.retryAfterMs;
        if (candidateUntil >= searchCooldownUntil) {
          searchCooldownUntil = candidateUntil;
          searchCooldownStatus = resp.status;
        }
      }
      throw error;
    }

    // Drain the body so the socket is released, then back off.
    await resp.text().catch(() => '');
    await new Promise(resolve => setTimeout(resolve, plan.waitMs));
  }

  const data = await resp.json();
  const container = data.value?.[0]?.hitsContainers?.[0];
  const hits = container?.hits || [];

  if (process.env.NODE_ENV === 'development') {
    console.log(`[GraphService] searchFiles: ${hits.length} hits, total: ${container?.total || 0}, moreAvailable: ${container?.moreResultsAvailable || false}`);
    if (hits.length > 0) {
      console.log(`[GraphService] First hit:`, JSON.stringify(hits[0]).substring(0, 500));
    }
  }

  // Parse hits and filter to allowed libraries
  const sitePrefix = siteUrl + '/';
  const results = [];

  for (const hit of hits) {
    const resource = hit.resource || {};
    const webUrl = resource.webUrl || '';

    // Parse library and folder from webUrl by stripping the known site prefix
    if (!webUrl.startsWith(sitePrefix)) continue;

    const relativePath = decodeURIComponent(webUrl.substring(sitePrefix.length));
    const segments = relativePath.split('/');
    if (segments.length < 2) continue; // Need at least library/filename

    const library = segments[0];
    const filename = segments[segments.length - 1];
    const folder = segments.length > 2 ? segments.slice(1, -1).join('/') : '';

    // Post-filter: only return results from allowed libraries
    if (!ALLOWED_LIBRARIES.has(library.toLowerCase())) continue;

    results.push({
      name: resource.name || filename,
      size: resource.size || 0,
      lastModified: resource.lastModifiedDateTime || null,
      webUrl,
      summary: hit.summary || '',
      library,
      folder,
    });
  }

  return results;
}
