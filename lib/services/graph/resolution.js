/**
 * GraphService SharePoint site and drive resolution owner.
 *
 * Cache keys, TTL behavior, validation, and late in-flight completion remain
 * unchanged from the facade. Operation methods receive the facade as `svc` so
 * spies and subclass receivers continue to govern auth and headers.
 */

import { buildServiceError } from '../../utils/service-error.js';
import {
  ALLOWED_LIBRARIES,
  ALLOWED_SHAREPOINT_HOSTS,
  API_TIMEOUT,
  CACHE_TTL,
  GRAPH_BASE,
  SHAREPOINT_CANONICAL_SITE_URL,
} from './constants.js';
import { fetchWithTimeout } from './http.js';

const siteCache = { siteId: null, fetchedAt: 0 };
const driveCache = new Map(); // libraryName → { driveId, fetchedAt }

/**
 * Resolve the SharePoint site to its Graph API site ID.
 * Uses SHAREPOINT_SITE_URL env var or the known default.
 */
export async function getSiteId(svc) {
  const now = Date.now();
  if (siteCache.siteId && now - siteCache.fetchedAt < CACHE_TTL) {
    return siteCache.siteId;
  }

  const siteUrl = process.env.SHAREPOINT_SITE_URL || SHAREPOINT_CANONICAL_SITE_URL;
  let url;
  try {
    url = new URL(siteUrl);
  } catch {
    throw buildServiceError('graph', { status: 500 }, `SHAREPOINT_SITE_URL is not a valid URL: "${siteUrl}"`, { isTransient: false });
  }
  if (!ALLOWED_SHAREPOINT_HOSTS.has(url.host)) {
    throw buildServiceError(
      'graph',
      { status: 400 },
      `SHAREPOINT_SITE_URL host "${url.host}" is not in the allowlist. ` +
        `Update ALLOWED_SHAREPOINT_HOSTS in lib/services/graph-service.js ` +
        `if a new tenant is legitimately being added.`,
      // 4xx is already non-transient by default; explicit for clarity.
      { isTransient: false },
    );
  }
  const graphUrl = `${GRAPH_BASE}/sites/${url.host}:${url.pathname}`;

  const token = await svc.getAccessToken();
  const resp = await fetchWithTimeout(graphUrl, {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const text = await resp.text();
    throw buildServiceError('graph', resp, text);
  }

  const data = await resp.json();
  siteCache.siteId = data.id;
  siteCache.fetchedAt = now;
  return data.id;
}

/**
 * Get the drive ID for a document library by name.
 * Each SharePoint document library is a separate "drive" in Graph API.
 *
 * Dynamics stores the entity logical name (e.g. "akoya_request") as the
 * relativeurl in sharepointdocumentlocations. In SharePoint, the drive's
 * display name is the friendly name (e.g. "Request"), but the URL slug
 * (last segment of webUrl) matches the Dynamics logical name. We match
 * against both the display name and the URL slug to handle either format.
 */
export async function getDriveId(svc, libraryName, { siteId: suppliedSiteId = null } = {}) {
  // Validate against allowlist (case-insensitive)
  if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
    throw buildServiceError(
      'graph',
      { status: 400 },
      `Document library "${libraryName}" is not in the allowlist. ` +
      `If a new Dynamics entity was configured for document management, ` +
      `add its library name to ALLOWED_LIBRARIES in lib/services/graph-service.js`,
    );
  }

  const now = Date.now();
  const cached = driveCache.get(libraryName);
  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return cached.driveId;
  }

  const siteId = suppliedSiteId || await svc.getSiteId();
  const token = await svc.getAccessToken();
  const resp = await fetchWithTimeout(
    `${GRAPH_BASE}/sites/${siteId}/drives`,
    { headers: svc.buildHeaders(token) },
    API_TIMEOUT,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw buildServiceError('graph', resp, text);
  }

  const data = await resp.json();
  const drives = data.value || [];
  const target = libraryName.toLowerCase();

  // Match by display name first, then by URL slug (last segment of webUrl).
  // Dynamics stores the URL slug (e.g. "akoya_request") as the parent
  // document location's relativeurl, while SharePoint shows the display
  // name (e.g. "Request") as the drive name.
  const drive = drives.find(d => d.name.toLowerCase() === target) ||
    drives.find(d => {
      const slug = d.webUrl ? d.webUrl.split('/').pop().toLowerCase() : '';
      return decodeURIComponent(slug) === target;
    });

  if (!drive) {
    const available = drives.map(d => {
      const slug = d.webUrl ? d.webUrl.split('/').pop() : '';
      return `${d.name} (${slug})`;
    }).join(', ');
    // Library allowed but not found in the live drives list — neither a
    // network failure nor a 4xx response from Graph. Round-11 §4 caught
    // that this stayed as a plain Error, so uploadFile (which transitively
    // calls getDriveId) could surface an unstructured throw to the drain.
    // 404-shape is the right semantic — "the requested library does not
    // exist at this site" — and non-transient (config drift, not a retry).
    throw buildServiceError(
      'graph',
      { status: 404 },
      `Document library "${libraryName}" not found. Available: ${available}`,
      { isTransient: false },
    );
  }

  driveCache.set(libraryName, { driveId: drive.id, fetchedAt: now });
  return drive.id;
}

export function resetResolutionCaches() {
  siteCache.siteId = null;
  siteCache.fetchedAt = 0;
  driveCache.clear();
}
