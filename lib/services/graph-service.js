/**
 * Microsoft Graph Service
 *
 * Handles authentication and operations against the Microsoft Graph API,
 * primarily for SharePoint document access.
 *
 * Auth: Client credentials flow using the same Azure AD app registration
 * as Dynamics (DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET)
 * but with a different scope (https://graph.microsoft.com/.default).
 *
 * Telemetry (Workbench Observability Stage 1): the local fetchWithTimeout
 * helper emits one `workbench.dependency` event per fetch attempt — see
 * lib/observability/request-correlation.js.
 */

import { buildServiceError } from '../utils/service-error.js';
import {
  ALLOWED_LIBRARIES,
  API_TIMEOUT,
  DOWNLOAD_TIMEOUT,
  GRAPH_BASE,
  SHAREPOINT_CANONICAL_SITE_URL,
} from './graph/constants.js';
import { validatePath } from './graph/paths.js';
import { getAccessToken, resetAuthCache } from './graph/auth.js';
import { getDriveId, getSiteId, resetResolutionCaches } from './graph/resolution.js';
import { getFileMetadataById, getFileMetadataByPath, listFiles } from './graph/files.js';
import { getFileVersionMetadata, listFileVersions, restoreFileVersion } from './graph/versions.js';
import {
  clampApiTimeout,
  deadlineTimeoutError,
  fetchWithTimeout,
  remainingTimeoutMs,
  safeEmitDependencyEvent,
  waitForPromiseWithin,
} from './graph/http.js';

export { SHAREPOINT_CANONICAL_SITE_URL };

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

export class GraphService {
  // ───────── Auth ─────────

  static async getAccessToken({ timeoutMs = API_TIMEOUT } = {}) {
    return getAccessToken(this, { timeoutMs });
  }

  static buildHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
  }

  // ───────── Site Resolution ─────────

  static async getSiteId() {
    return getSiteId(this);
  }

  // ───────── Drive Resolution ─────────

  static async getDriveId(libraryName, { siteId: suppliedSiteId = null } = {}) {
    return getDriveId(this, libraryName, { siteId: suppliedSiteId });
  }

  // ───────── File Operations ─────────

  /**
   * List files in a folder within a document library.
   *
   * @param {string} libraryName - Document library name (e.g. "akoya_request")
   * @param {string} folderPath - Folder path within the library
   * @param {Object} [options]
   * @param {boolean} [options.recursive=false] - Walk subfolders too. Off by
   *   default to preserve existing callers' behavior; turn on when you need to
   *   surface files in arbitrarily-named subfolders (e.g. migrated grants where
   *   files live in `Final Report/`, `Year 1/`, etc.).
   * @param {number} [options.maxDepth=3] - Max recursion depth (0 = top level
   *   only). Root call counts as depth 0.
   * @param {number} [options.maxFiles=500] - Hard cap to prevent runaway walks.
   * @returns {Array<{name, size, lastModified, mimeType, webUrl, id, folder}>}
   *   Each file's `folder` is the absolute path under the library root where
   *   the file actually lives — pass it back to `downloadFileByPath` and it
   *   resolves correctly even for nested files.
   */
  static async listFiles(libraryName, folderPath, options = {}) {
    return listFiles(this, libraryName, folderPath, options);
  }

  /**
   * Read current metadata for a file by its stable Graph drive/item identity.
   * Returns null on a clean 404; other Graph failures remain errors.
   */
  static async getFileMetadataById(
    driveId,
    itemId,
    { siteId = null, timeoutMs = API_TIMEOUT } = {},
  ) {
    return getFileMetadataById(this, driveId, itemId, { siteId, timeoutMs });
  }

  /**
   * List native SharePoint versions for one stable drive item, newest first.
   */
  static async listFileVersions(
    driveId,
    itemId,
    { siteId = null, timeoutMs = API_TIMEOUT, limit = 20 } = {},
  ) {
    return listFileVersions(this, driveId, itemId, { siteId, timeoutMs, limit });
  }

  /** Resolve one exact historical/current version by stable drive-item identity. */
  static async getFileVersionMetadata(driveId, itemId, versionId) {
    return getFileVersionMetadata(this, driveId, itemId, versionId);
  }

  /**
   * Restore a prior version as a new current version.
   */
  static async restoreFileVersion(driveId, itemId, versionId) {
    return restoreFileVersion(this, driveId, itemId, versionId);
  }

  /**
   * Download file content by drive ID and item ID.
   *
   * SharePoint binary downloads have a long-standing gotcha: `/items/{id}/content`
   * issues a 302 redirect to a CDN host, and Node fetch's `redirect:'follow'`
   * forwards the Graph bearer token to that host — where it isn't valid — which
   * surfaces as a 404. We work around this two ways:
   *
   * 1. Prefer the `@microsoft.graph.downloadUrl` pre-signed URL from item
   *    metadata (one round-trip, no redirect, no auth coupling — Microsoft's
   *    recommended path).
   * 2. Fall back to `/content` with `redirect:'manual'`, then refetch the
   *    Location URL **without** the Authorization header. Some items
   *    (checked-out, recently uploaded, certain SharePoint list-backed items)
   *    don't include `@microsoft.graph.downloadUrl` in metadata.
   *
   * @returns {{ buffer: Buffer, mimeType: string, filename: string, size: number }}
   */
  static async downloadFile(driveId, itemId) {
    const token = await this.getAccessToken();

    // Step 1: metadata (also yields pre-signed downloadUrl when available)
    const metaResp = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`,
      { headers: this.buildHeaders(token) },
      API_TIMEOUT,
    );

    if (!metaResp.ok) {
      const text = await metaResp.text();
      throw new Error(`Failed to get file metadata (${metaResp.status}): ${text}`);
    }

    const meta = await metaResp.json();
    const filename = meta.name;
    const mimeType = meta.file?.mimeType || 'application/octet-stream';
    const size = meta.size;

    // Step 2a: try pre-signed downloadUrl first
    const presignedUrl = meta['@microsoft.graph.downloadUrl'];
    if (presignedUrl) {
      const contentResp = await fetchWithTimeout(
        presignedUrl,
        { redirect: 'follow' },
        DOWNLOAD_TIMEOUT,
      );
      if (contentResp.ok) {
        const buffer = Buffer.from(await contentResp.arrayBuffer());
        return { buffer, mimeType, filename, size };
      }
      // fall through to manual-redirect path on failure
      console.warn(
        `[GraphService] downloadUrl fetch failed (${contentResp.status}) for ${filename}; falling back to /content`,
      );
    }

    // Step 2b: manual-redirect path against /content
    //   - redirect:'manual' so we can grab the Location header ourselves
    //   - refetch that URL without the Authorization header
    const initial = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`,
      { headers: this.buildHeaders(token), redirect: 'manual' },
      DOWNLOAD_TIMEOUT,
    );

    if (initial.status === 302 || initial.status === 301) {
      const location = initial.headers.get('location');
      if (!location) {
        throw new Error(`Redirect from /content had no Location header (${initial.status})`);
      }
      const followResp = await fetchWithTimeout(
        location,
        { redirect: 'follow' }, // no auth header — pre-signed URL
        DOWNLOAD_TIMEOUT,
      );
      if (!followResp.ok) {
        throw new Error(`Failed to download file from CDN (${followResp.status})`);
      }
      const buffer = Buffer.from(await followResp.arrayBuffer());
      return { buffer, mimeType, filename, size };
    }

    // Some Graph deployments stream the bytes directly from /content without
    // redirecting — handle that too.
    if (initial.ok) {
      const buffer = Buffer.from(await initial.arrayBuffer());
      return { buffer, mimeType, filename, size };
    }

    throw new Error(`Failed to download file (${initial.status})`);
  }

  /**
   * Download the exact bytes of a prior SharePoint/OneDrive file version.
   * Graph does not support this endpoint for the current version; callers must
   * use downloadFile() while the requested version is still current.
   */
  static async downloadFileVersion(driveId, itemId, versionId) {
    if (!driveId || !itemId || !versionId) {
      throw new Error('downloadFileVersion: driveId, itemId, and versionId are required');
    }
    const token = await this.getAccessToken();
    const initial = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
        + `/items/${encodeURIComponent(itemId)}`
        + `/versions/${encodeURIComponent(versionId)}/content`,
      { headers: this.buildHeaders(token), redirect: 'manual' },
      DOWNLOAD_TIMEOUT,
    );
    return downloadRedirectBody(initial, 'file version');
  }

  /**
   * Convert the current immutable snapshot item to PDF through Microsoft Graph.
   * The caller owns the source-version freeze; this method never restores or
   * mutates the source item.
   */
  static async downloadFileAsPdf(driveId, itemId) {
    if (!driveId || !itemId) {
      throw new Error('downloadFileAsPdf: driveId and itemId are required');
    }
    const token = await this.getAccessToken();
    const initial = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
        + `/items/${encodeURIComponent(itemId)}/content?format=pdf`,
      { headers: this.buildHeaders(token), redirect: 'manual' },
      DOWNLOAD_TIMEOUT,
    );
    return downloadRedirectBody(initial, 'PDF conversion');
  }

  /**
   * Download a file by library name, folder path, and filename.
   * Resolves the path to a drive item and downloads it.
   */
  static async downloadFileByPath(libraryName, folderPath, filename) {
    validatePath(folderPath);
    const driveId = await this.getDriveId(libraryName);
    const token = await this.getAccessToken();

    const encodedPath = [...folderPath.split('/'), filename].map(encodeURIComponent).join('/');
    const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}`;

    // Get item metadata (includes ID)
    const resp = await fetchWithTimeout(url + '?$select=id,name,file,size', {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`File not found: ${filename} (${resp.status}): ${text}`);
    }

    const item = await resp.json();
    return this.downloadFile(driveId, item.id);
  }

  /**
   * Resolve one drive item by its governed path. Returns null on a clean 404;
   * other Graph failures remain errors. Callers persist the returned stable
   * drive/item IDs and never use the path as the registry identity. A guarded
   * writer may supply a pre-resolved site/drive pair so target identity cannot
   * drift between preflight and the path read.
   */
  static async getFileMetadataByPath(
    libraryName,
    folderPath,
    filename,
    { siteId: assertedSiteId = null, driveId: assertedDriveId = null } = {},
  ) {
    return getFileMetadataByPath(this, libraryName, folderPath, filename, {
      siteId: assertedSiteId,
      driveId: assertedDriveId,
    });
  }

  /**
   * Ensure every segment of a governed folder path exists and return the final
   * folder item. Existing segments are read-only; missing segments are created
   * one at a time. A concurrent creator's 409 is reconciled by re-reading the
   * exact cumulative path.
   */
  static async ensureFolderPath(
    libraryName,
    folderPath,
    { siteId: assertedSiteId = null, driveId: assertedDriveId = null, signal = null } = {},
  ) {
    if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
      throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
    }
    if ((assertedSiteId && !assertedDriveId) || (!assertedSiteId && assertedDriveId)) {
      throw new Error('ensureFolderPath: siteId and driveId must be supplied together');
    }
    validatePath(folderPath);
    const siteId = assertedSiteId || await this.getSiteId();
    const [driveId, token] = await Promise.all([
      assertedDriveId || this.getDriveId(libraryName, { siteId }),
      this.getAccessToken(),
    ]);
    const segments = folderPath.split('/').filter(Boolean);
    let parentId = 'root';
    let currentPath = '';

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const encodedPath = currentPath.split('/').map(encodeURIComponent).join('/');
      const getUrl = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}`
        + '?$select=id,name,folder,webUrl,parentReference';
      if (signal?.aborted) throw signal.reason ?? new Error('ensureFolderPath aborted');
      let response = await fetchWithTimeout(getUrl, {
        headers: this.buildHeaders(token),
      }, API_TIMEOUT);
      if (response.ok) {
        const existing = await response.json();
        if (existing.folder == null) {
          throw new Error(`SharePoint path segment "${currentPath}" exists but is not a folder.`);
        }
        parentId = existing.id;
        continue;
      }
      if (response.status !== 404) {
        const text = await response.text();
        throw buildServiceError('graph', response, text.slice(0, 400));
      }

      const childrenUrl = parentId === 'root'
        ? `${GRAPH_BASE}/drives/${driveId}/root/children`
        : `${GRAPH_BASE}/drives/${driveId}/items/${parentId}/children`;
      if (signal?.aborted) throw signal.reason ?? new Error('ensureFolderPath aborted');
      response = await fetchWithTimeout(childrenUrl, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      }, API_TIMEOUT);
      if (response.ok) {
        parentId = (await response.json()).id;
        continue;
      }
      if (response.status === 409) {
        const raced = await fetchWithTimeout(getUrl, {
          headers: this.buildHeaders(token),
        }, API_TIMEOUT);
        if (raced.ok) {
          const existing = await raced.json();
          if (existing.folder == null) {
            throw new Error(`SharePoint path segment "${currentPath}" is not a folder.`);
          }
          parentId = existing.id;
          continue;
        }
      }
      const text = await response.text();
      throw buildServiceError('graph', response, text.slice(0, 400));
    }
    return { siteId, driveId, id: parentId, path: folderPath };
  }

  // ───────── Search ─────────

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
  static async searchFiles(query, { libraryName, folderPath } = {}) {
    if (libraryName && !ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
      throw new Error(
        `Document library "${libraryName}" is not in the allowlist.`
      );
    }

    const siteUrl = (process.env.SHAREPOINT_SITE_URL || SHAREPOINT_CANONICAL_SITE_URL).replace(/\/$/, '');

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

    const token = await this.getAccessToken();
    const requestInit = {
      method: 'POST',
      headers: {
        ...this.buildHeaders(token),
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

  // ───────── Write Operations ─────────

  /**
   * Upload a file (PUT) to a SharePoint document library at a specific folder
   * path. Intermediate folders in the path are created automatically by Graph.
   *
   * Uses simple-upload PUT for files up to UPLOAD_MAX_BYTES. Files larger than
   * that need an upload session (chunked); this caller's domain (review files)
   * caps at 25MB, well within simple PUT.
   *
   * Conflict behavior defaults to `replace` for existing callers. Guarded
   * create-only workflows may request `fail` and reconcile a 409 by identity;
   * append-only workflows may request `rename` to preserve an existing item.
   *
   * @param {string} libraryName - Document library (must be in ALLOWED_LIBRARIES)
   * @param {string} folderPath - Path under the library root (no leading slash)
   * @param {string} filename - Filename to write
   * @param {Buffer} content - File bytes
   * @param {string} [contentType='application/octet-stream'] - Content-Type header
   * @param {'fail'|'replace'|'rename'} [options.conflictBehavior='replace'] - Existing-path behavior
   * @param {string} [options.siteId] - Pre-resolved site identity (requires driveId)
   * @param {string} [options.driveId] - Pre-resolved drive identity (requires siteId)
   * @returns {Promise<{ siteId: string, driveId: string, id: string, name: string, size: number, webUrl: string, eTag: string|null, versionId: string|null, lastModified: string|null }>}
   */
  static async uploadFile(
    libraryName,
    folderPath,
    filename,
    content,
    contentType = 'application/octet-stream',
    { conflictBehavior = 'replace', siteId: assertedSiteId = null, driveId: assertedDriveId = null } = {},
  ) {
    if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
      throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('uploadFile: filename required');
    }
    if (!Buffer.isBuffer(content)) {
      throw new Error('uploadFile: content must be a Buffer');
    }
    if (!['fail', 'replace', 'rename'].includes(conflictBehavior)) {
      throw new Error('uploadFile: conflictBehavior must be "fail", "replace", or "rename"');
    }
    validatePath(folderPath);

    const UPLOAD_MAX_BYTES = 60 * 1024 * 1024; // generous; well above review caps
    if (content.length > UPLOAD_MAX_BYTES) {
      throw new Error(
        `uploadFile: file size ${content.length} exceeds simple-upload limit ` +
          `(${UPLOAD_MAX_BYTES}). Implement createUploadSession for larger files.`,
      );
    }

    if ((assertedSiteId && !assertedDriveId) || (!assertedSiteId && assertedDriveId)) {
      throw new Error('uploadFile: siteId and driveId must be supplied together');
    }
    const siteId = assertedSiteId || await this.getSiteId();
    const [driveId, token] = await Promise.all([
      assertedDriveId || this.getDriveId(libraryName, { siteId }),
      this.getAccessToken(),
    ]);

    const encodedPath = [...folderPath.split('/').filter(Boolean), filename]
      .map(encodeURIComponent)
      .join('/');
    const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/content`
      + `?@microsoft.graph.conflictBehavior=${conflictBehavior}`;

    const resp = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: content,
    }, DOWNLOAD_TIMEOUT);

    if (!resp.ok) {
      const text = await resp.text();
      throw buildServiceError('graph', resp, text.slice(0, 400));
    }

    const item = await resp.json();
    // The upload response carries no `publication` facet, and a content tag
    // (`cTag`) is NOT a SharePoint version. Read the item back by stable id so
    // the registry records the authoritative `publication.versionId` at
    // creation; the same rule `getFileMetadataById` already enforces.
    let versionId = item.publication?.versionId || null;
    let eTag = item.eTag || null;
    let lastModified = item.lastModifiedDateTime || null;
    let size = item.size;
    if (!versionId && item.id) {
      const readBack = await fetchWithTimeout(
        `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(item.id)}`
          + '?$select=id,size,eTag,lastModifiedDateTime,publication',
        { headers: this.buildHeaders(token) },
        DOWNLOAD_TIMEOUT,
      );
      if (readBack.ok) {
        const stable = await readBack.json();
        if (stable?.id === item.id) {
          versionId = stable.publication?.versionId || null;
          eTag = stable.eTag || eTag;
          lastModified = stable.lastModifiedDateTime || lastModified;
          size = stable.size ?? size;
        }
      }
    }
    return {
      siteId,
      driveId,
      id: item.id,
      name: item.name,
      size,
      webUrl: item.webUrl,
      eTag,
      versionId,
      lastModified,
    };
  }

  /**
   * Upload a file of any size supported by the store: simple PUT up to the
   * simple-upload limit, otherwise a Graph upload session sent in 10 MiB
   * chunks (a multiple of the 320 KiB Graph fragment unit). Same return shape
   * and version read-back as uploadFile. First use: applicant site-visit
   * materials (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16), whose owner
   * cap is 100 MB.
   */
  static async uploadFileLarge(
    libraryName,
    folderPath,
    filename,
    content,
    contentType = 'application/octet-stream',
    { conflictBehavior = 'replace', chunkBytes = 10 * 1024 * 1024 } = {},
  ) {
    const SIMPLE_LIMIT = 60 * 1024 * 1024;
    if (!Buffer.isBuffer(content)) throw new Error('uploadFileLarge: content must be a Buffer');
    if (content.length <= SIMPLE_LIMIT) {
      return this.uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });
    }
    if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
      throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
    }
    if (!['fail', 'replace', 'rename'].includes(conflictBehavior)) {
      throw new Error('uploadFileLarge: conflictBehavior must be "fail", "replace", or "rename"');
    }
    if (chunkBytes % (320 * 1024) !== 0) throw new Error('uploadFileLarge: chunkBytes must be a multiple of 320 KiB');
    validatePath(folderPath);
    const siteId = await this.getSiteId();
    const [driveId, token] = await Promise.all([this.getDriveId(libraryName, { siteId }), this.getAccessToken()]);
    const encodedPath = [...folderPath.split('/').filter(Boolean), filename].map(encodeURIComponent).join('/');
    const sessionResp = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/createUploadSession`,
      {
        method: 'POST',
        headers: { ...this.buildHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflictBehavior, name: filename } }),
      },
      API_TIMEOUT,
    );
    if (!sessionResp.ok) {
      const text = await sessionResp.text();
      throw buildServiceError('graph', sessionResp, text.slice(0, 400));
    }
    const { uploadUrl } = await sessionResp.json();
    if (!uploadUrl) throw new Error('uploadFileLarge: Graph returned no upload session URL');

    let item = null;
    for (let start = 0; start < content.length; start += chunkBytes) {
      const end = Math.min(start + chunkBytes, content.length) - 1;
      const chunk = content.subarray(start, end + 1);
      // The upload URL is pre-authorized; Graph rejects an Authorization header here.
      const resp = await fetchWithTimeout(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${content.length}`,
        },
        body: chunk,
      }, DOWNLOAD_TIMEOUT);
      if (!resp.ok) {
        const text = await resp.text();
        try { await fetchWithTimeout(uploadUrl, { method: 'DELETE' }, API_TIMEOUT); } catch {}
        throw buildServiceError('graph', resp, text.slice(0, 400));
      }
      if (resp.status === 200 || resp.status === 201) item = await resp.json();
    }
    if (!item?.id) throw new Error('uploadFileLarge: upload session finished without a drive item');

    // Same authoritative version read-back as uploadFile.
    let versionId = item.publication?.versionId || null;
    let eTag = item.eTag || null;
    let lastModified = item.lastModifiedDateTime || null;
    let size = item.size;
    const readBack = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(item.id)}?$select=id,size,eTag,lastModifiedDateTime,publication,webUrl,name`,
      { headers: this.buildHeaders(token) },
      DOWNLOAD_TIMEOUT,
    );
    if (readBack.ok) {
      const stable = await readBack.json();
      if (stable?.id === item.id) {
        versionId = stable.publication?.versionId || versionId;
        eTag = stable.eTag || eTag;
        lastModified = stable.lastModifiedDateTime || lastModified;
        size = stable.size ?? size;
      }
    }
    return { siteId, driveId, id: item.id, name: item.name, size, webUrl: item.webUrl, eTag, versionId, lastModified };
  }

  /**
   * Replace the bytes of one already-resolved drive item. This deliberately
   * accepts a stable item id rather than a path so a guarded repair cannot
   * create or overwrite a sibling with a coincidentally matching name.
   */
  static async replaceFileContent(
    driveId,
    itemId,
    content,
    contentType = 'application/octet-stream',
    { siteId = null, ifMatch = null } = {},
  ) {
    if (!driveId || !itemId) {
      throw new Error('replaceFileContent: driveId and itemId are required');
    }
    if (!Buffer.isBuffer(content)) {
      throw new Error('replaceFileContent: content must be a Buffer');
    }
    if (!ifMatch || typeof ifMatch !== 'string') {
      throw new Error('replaceFileContent: ifMatch is required');
    }
    const UPLOAD_MAX_BYTES = 60 * 1024 * 1024;
    if (content.length > UPLOAD_MAX_BYTES) {
      throw new Error(`replaceFileContent: file size ${content.length} exceeds simple-upload limit (${UPLOAD_MAX_BYTES}).`);
    }
    const token = await this.getAccessToken();
    const resp = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
        + `/items/${encodeURIComponent(itemId)}/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
          'If-Match': ifMatch,
        },
        body: content,
      },
      DOWNLOAD_TIMEOUT,
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw buildServiceError('graph', resp, text.slice(0, 400));
    }
    const item = await resp.json();
    return {
      siteId,
      driveId,
      id: item.id,
      name: item.name,
      size: item.size,
      webUrl: item.webUrl,
      eTag: item.eTag || null,
      versionId: item.publication?.versionId || item.cTag || null,
      lastModified: item.lastModifiedDateTime || null,
    };
  }

  /**
   * Delete a file by drive item id. Used for cleanup when a multi-step
   * operation (upload several files + Dataverse PATCH) fails partway through.
   *
   * @param {string} driveId
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  static async deleteFile(driveId, itemId) {
    const token = await this.getAccessToken();
    const resp = await fetchWithTimeout(
      `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      API_TIMEOUT,
    );
    if (!resp.ok && resp.status !== 204 && resp.status !== 404) {
      const text = await resp.text();
      throw new Error(`SharePoint delete failed (${resp.status}): ${text.slice(0, 400)}`);
    }
  }

  // ───────── Cache Management ─────────

  static clearCaches() {
    searchCooldownUntil = 0;
    searchCooldownStatus = null;
    resetAuthCache();
    resetResolutionCaches();
  }
}

// ───────── Private Helpers ─────────

async function downloadRedirectBody(initial, label) {
  if (initial.status === 302 || initial.status === 301) {
    const location = initial.headers.get('location');
    if (!location) {
      throw new Error(`Graph ${label} redirect had no Location header (${initial.status})`);
    }
    const followed = await fetchWithTimeout(
      location,
      { redirect: 'follow' },
      DOWNLOAD_TIMEOUT,
    );
    if (!followed.ok) {
      throw new Error(`Graph ${label} download failed (${followed.status})`);
    }
    return Buffer.from(await followed.arrayBuffer());
  }
  if (initial.ok) return Buffer.from(await initial.arrayBuffer());
  const text = await initial.text();
  throw buildServiceError('graph', initial, text.slice(0, 400));
}
