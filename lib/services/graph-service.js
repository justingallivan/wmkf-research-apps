/**
 * Microsoft Graph Service
 *
 * Handles authentication and operations against the Microsoft Graph API,
 * primarily for SharePoint document access.
 *
 * Auth: Client credentials flow using the same Azure AD app registration
 * as Dynamics (DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET)
 * but with a different scope (https://graph.microsoft.com/.default).
 */

import { buildServiceError, buildNoResponseError } from '../utils/service-error.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const API_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 60_000;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Version-history pagination bounds. Three pages at `$top = limit + 1` covers
// ~3x the displayed rows without letting a heavily-edited document turn one
// lazy disclosure into dozens of sequential round-trips. When those pages do
// not contain the drive item's authoritative `publication.versionId`, that one
// version is fetched directly so the bounded scan cannot omit the current editor.
const MAX_VERSION_PAGES = 3;
// Don't start a page we cannot plausibly finish; stop and report instead.
const MIN_VERSION_PAGE_BUDGET_MS = 2_000;

// Default SharePoint site URL (confirmed via testing)
const DEFAULT_SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';

// Allowlisted SharePoint hosts. Any SHAREPOINT_SITE_URL env override must land
// on one of these — this prevents a mis-set env var (or a compromised env-var
// admin) from redirecting every Graph call at an attacker-controlled host,
// which would otherwise constitute SSRF via config.
const ALLOWED_SHAREPOINT_HOSTS = new Set([
  'appriver3651007194.sharepoint.com',
]);

// Allowlist of document libraries on the akoyaGO SharePoint site.
// Each entry corresponds to a Dynamics entity with server-side document management enabled.
// If a new entity gets document management, add its library name here.
const ALLOWED_LIBRARIES = new Set([
  'akoya_request',
  'akoya_concept',
  'akoya_phase',
  'akoya_requestpayment',
  'akoya_akoyaapply',
  'akoya_akoyaapplycontact',
  'akoya_goapplystatustracking',
  'akoya_lettertemplatesession',
  'contact',
  'account',
  'requestarchive1',
  'requestarchive2',
  'requestarchive3',
]);

// Separate token cache from Dynamics (different scope)
let tokenCache = { token: null, expiresAt: 0 };
let tokenPromise = null;
let tokenGeneration = 0;
const siteCache = { siteId: null, fetchedAt: 0 };
const driveCache = new Map(); // libraryName → { driveId, fetchedAt }

/**
 * Defense-in-depth: reject paths that could escape the intended folder.
 * folderPath comes from Dynamics data (not user input), but we validate anyway.
 *
 * Decodes once before the `..` check so `%2E%2E` variants are caught alongside
 * literal `..`. Malformed URI encoding is itself rejected.
 */
function validatePath(folderPath) {
  if (folderPath.startsWith('/')) {
    throw new Error(`Invalid path: must not start with "/". Got: "${folderPath}"`);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(folderPath);
  } catch {
    throw new Error(`Invalid path: malformed URI encoding. Got: "${folderPath}"`);
  }
  const segments = decoded.split('/');
  if (segments.some(s => s === '..' || s === '.')) {
    throw new Error(`Invalid path: traversal ("..") not allowed. Got: "${folderPath}"`);
  }
}

export class GraphService {
  // ───────── Auth ─────────

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
  static async getAccessToken({ timeoutMs = API_TIMEOUT } = {}) {
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

  static buildHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
  }

  // ───────── Site Resolution ─────────

  /**
   * Resolve the SharePoint site to its Graph API site ID.
   * Uses SHAREPOINT_SITE_URL env var or the known default.
   */
  static async getSiteId() {
    const now = Date.now();
    if (siteCache.siteId && now - siteCache.fetchedAt < CACHE_TTL) {
      return siteCache.siteId;
    }

    const siteUrl = process.env.SHAREPOINT_SITE_URL || DEFAULT_SITE_URL;
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

    const token = await this.getAccessToken();
    const resp = await fetchWithTimeout(graphUrl, {
      headers: this.buildHeaders(token),
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

  // ───────── Drive Resolution ─────────

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
  static async getDriveId(libraryName, { siteId: suppliedSiteId = null } = {}) {
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

    const siteId = suppliedSiteId || await this.getSiteId();
    const token = await this.getAccessToken();
    const resp = await fetchWithTimeout(
      `${GRAPH_BASE}/sites/${siteId}/drives`,
      { headers: this.buildHeaders(token) },
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
    const {
      recursive = false,
      maxDepth = 3,
      maxFiles = 500,
      // Wall-clock ceiling on the total walk. Protects against pathological
      // folder structures where maxDepth + maxFiles caps aren't hit but the
      // recursive fan-out still produces N×API_TIMEOUT latency.
      totalTimeoutMs = 30_000,
    } = options;
    validatePath(folderPath);
    const driveId = await this.getDriveId(libraryName);
    const token = await this.getAccessToken();

    const deadline = Date.now() + totalTimeoutMs;
    const collected = [];

    const walk = async (currentPath, depth) => {
      if (collected.length >= maxFiles) return;
      if (Date.now() > deadline) {
        throw new Error(
          `listFiles(${libraryName}/${folderPath}) exceeded ${totalTimeoutMs}ms walk timeout`,
        );
      }

      const encodedPath = currentPath.split('/').map(encodeURIComponent).join('/');
      const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/children?$select=name,size,lastModifiedDateTime,file,folder,webUrl,id`;

      const resp = await fetchWithTimeout(url, {
        headers: this.buildHeaders(token),
      }, API_TIMEOUT);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to list files in ${libraryName}/${currentPath} (${resp.status}): ${text}`);
      }

      const data = await resp.json();
      const items = data.value || [];

      // Files first, then recurse into subfolders so the picker order
      // stays predictable (top-level files appear before nested ones).
      for (const item of items) {
        if (collected.length >= maxFiles) return;
        if (item.file != null) {
          collected.push({
            name: item.name,
            size: item.size,
            lastModified: item.lastModifiedDateTime,
            mimeType: item.file?.mimeType || null,
            webUrl: item.webUrl,
            id: item.id,
            folder: currentPath,
          });
        }
      }

      if (recursive && depth < maxDepth) {
        for (const item of items) {
          if (collected.length >= maxFiles) return;
          if (item.folder != null) {
            const childPath = `${currentPath}/${item.name}`;
            await walk(childPath, depth + 1);
          }
        }
      }
    };

    await walk(folderPath, 0);
    return collected;
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
    if (!driveId || typeof driveId !== 'string') {
      throw new Error('getFileMetadataById: driveId required');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('getFileMetadataById: itemId required');
    }
    const boundedTimeoutMs = clampApiTimeout(timeoutMs);
    const deadline = Date.now() + boundedTimeoutMs;
    const token = await this.getAccessToken({
      timeoutMs: remainingTimeoutMs(deadline, boundedTimeoutMs),
    });
    const itemTimeoutMs = remainingTimeoutMs(deadline, boundedTimeoutMs);
    const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
      + `/items/${encodeURIComponent(itemId)}`
      + '?$select=id,name,size,webUrl,eTag,cTag,lastModifiedDateTime,parentReference,file,publication';
    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, itemTimeoutMs);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text();
      throw buildServiceError('graph', resp, text.slice(0, 400));
    }
    const item = await resp.json();
    if (!item?.id || item.id !== itemId || item.file == null) {
      const error = new Error('Graph stable item metadata did not resolve to the expected file.');
      error.code = 'graph_file_identity_mismatch';
      throw error;
    }
    return {
      siteId,
      driveId,
      id: item.id,
      name: item.name,
      size: item.size,
      webUrl: item.webUrl,
      eTag: item.eTag || null,
      versionId: item.publication?.versionId || null,
      lastModified: item.lastModifiedDateTime || null,
      mimeType: item.file?.mimeType || null,
      parentReference: item.parentReference || null,
    };
  }

  /**
   * List native SharePoint versions for one stable drive item, newest first.
   *
   * This is the human-edit audit surface: pilot owner-decision 6 settled that
   * SharePoint native version history — not a Dataverse mirror — is the record of
   * who edited a governed artifact, so `lastModifiedBy` is the point of the read,
   * not decoration.
   *
   * Read-only. Restoring a version is deliberately NOT implemented here; that is
   * the administrator half, blocked on the outstanding SharePoint permission
   * evidence (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`).
   *
   * Do NOT try to replace this with `$orderby`. Probed live 2026-08-10 against a
   * real governed artifact: `/versions?$orderby=lastModifiedDateTime desc` and
   * the ascending form both return **HTTP 200 and the identical order**, so the
   * parameter is accepted and silently ignored — a success status here is not
   * evidence of support. `$top` does page (a 2-version item with `$top=1`
   * returned one row plus an `@odata.nextLink`). Default order was newest-first
   * in that observation, but one item with two versions is not a contract, which
   * is why the ordering below stays defensive.
   *
   * Graph returns a heterogeneous shape across tenants and item types, so every
   * entry field is treated as optional and an entry without an `id` is skipped
   * rather than surfaced half-populated. Graph ordering is not contractual, so
   * observed pages are sorted together before the response is capped. The drive
   * item's `publication.versionId` is the authoritative current identity;
   * response position never determines `isCurrent`, and that version is fetched
   * directly BEFORE paginating so no scan outcome can omit or discard it.
   *
   * @returns {{ versions: Array, hasMore: boolean, limit: number }} newest first
   */
  static async listFileVersions(
    driveId,
    itemId,
    { siteId = null, timeoutMs = API_TIMEOUT, limit = 20 } = {},
  ) {
    if (!driveId || typeof driveId !== 'string') {
      throw new Error('listFileVersions: driveId required');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('listFileVersions: itemId required');
    }
    const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 20;
    const boundedTimeoutMs = clampApiTimeout(timeoutMs);
    const deadline = Date.now() + boundedTimeoutMs;
    const token = await this.getAccessToken({
      timeoutMs: remainingTimeoutMs(deadline, boundedTimeoutMs),
    });
    const encodedDriveId = encodeURIComponent(driveId);
    const encodedItemId = encodeURIComponent(itemId);
    const itemUrl = `${GRAPH_BASE}/drives/${encodedDriveId}/items/${encodedItemId}`
      + '?$select=id,file,publication';
    const itemResp = await fetchWithTimeout(itemUrl, {
      headers: this.buildHeaders(token),
    }, remainingTimeoutMs(deadline, boundedTimeoutMs));
    if (itemResp.status === 404) return null;
    if (!itemResp.ok) {
      const text = await itemResp.text();
      throw buildServiceError('graph', itemResp, text.slice(0, 400));
    }
    const item = await itemResp.json();
    if (!item?.id || item.id !== itemId || item.file == null) {
      const error = new Error('Graph stable item metadata did not resolve to the expected file.');
      error.code = 'graph_file_identity_mismatch';
      throw error;
    }
    const currentVersionId = item.publication?.versionId != null
      ? String(item.publication.versionId)
      : null;
    const mapVersionEntry = (entry, observedIndex) => {
      const id = entry?.id != null ? String(entry.id) : null;
      if (!id) return null;
      return {
        versionId: id,
        lastModified: entry.lastModifiedDateTime || null,
        size: Number.isFinite(entry.size) ? entry.size : null,
        // Display name only — no UPN/email, matching the names-stay-minimal norm.
        lastModifiedBy: entry.lastModifiedBy?.user?.displayName || null,
        isCurrent: currentVersionId != null && id === currentVersionId,
        observedIndex,
      };
    };

    const usable = [];

    // Materialize the authoritative current version BEFORE paginating.
    //
    // The earlier design fetched it afterwards, only when the bounded scan had
    // not observed it — which meant the fetch inherited whatever budget the scan
    // had left. When the scan stopped BECAUSE the budget was gone, this fetch
    // then threw and destroyed every page it had just salvaged. Ordering it
    // first removes that interaction entirely: it runs on a full budget, and
    // nothing it can do endangers rows that do not exist yet. It costs one extra
    // request when the current version would also have appeared on page one;
    // that is the price of the failure mode not existing.
    if (currentVersionId != null) {
      const currentUrl = `${GRAPH_BASE}/drives/${encodedDriveId}`
        + `/items/${encodedItemId}/versions/${encodeURIComponent(currentVersionId)}`;
      const currentResp = await fetchWithTimeout(currentUrl, {
        headers: this.buildHeaders(token),
      }, remainingTimeoutMs(deadline, boundedTimeoutMs));
      if (!currentResp.ok) {
        const text = await currentResp.text();
        throw buildServiceError('graph', currentResp, text.slice(0, 400));
      }
      const currentVersion = mapVersionEntry(await currentResp.json(), 0);
      if (!currentVersion || currentVersion.versionId !== currentVersionId) {
        const error = new Error('Graph current version did not resolve to the expected identity.');
        error.code = 'graph_version_identity_mismatch';
        throw error;
      }
      usable.push(currentVersion);
    }

    // `$top` controls page size, not the result cap: Graph ordering is not
    // contractual, so a newer/current version may be on a later page.
    let pageUrl = `${GRAPH_BASE}/drives/${encodedDriveId}`
      + `/items/${encodedItemId}/versions`
      + `?$top=${boundedLimit + 1}`;
    const seenPageUrls = new Set();
    let pagesFetched = 0;
    let stoppedEarly = false;
    while (pageUrl) {
      // Bound the work two ways, and STOP rather than throw once at least one
      // page is in hand. Letting `remainingTimeoutMs` throw here would discard
      // every page already fetched plus the authoritative current identity, so
      // the documents with the richest edit history — the ones whose audit trail
      // matters most — would show nothing at all. A truncated-but-honest list
      // beats that; `hasMore` tells the caller the set is incomplete.
      //
      // Before the first page there is nothing to salvage, so the deadline is
      // allowed to throw and the caller reports `unavailable` instead of
      // claiming the file has no versions.
      if (pagesFetched > 0
        && (pagesFetched >= MAX_VERSION_PAGES
          || deadline - Date.now() < MIN_VERSION_PAGE_BUDGET_MS)) {
        stoppedEarly = true;
        break;
      }
      if (seenPageUrls.has(pageUrl)) {
        throw new Error('Graph version pagination repeated a nextLink.');
      }
      seenPageUrls.add(pageUrl);
      let resp;
      try {
        resp = await fetchWithTimeout(pageUrl, {
          headers: this.buildHeaders(token),
        }, remainingTimeoutMs(deadline, boundedTimeoutMs));
      } catch (error) {
        if (pagesFetched === 0) throw error;
        stoppedEarly = true;
        break;
      }
      if (!resp.ok) {
        // A 404 HERE is not "the file is missing" — item metadata above already
        // proved the item exists, and the caller maps a null return to
        // `missing`, which would tell staff the registered SharePoint file could
        // not be found while this same read was demonstrably looking at it. Only
        // the item-metadata 404 is authoritative about absence. A versions
        // endpoint 404 is treated like any other failure: salvage after a page,
        // otherwise fail loud into `unavailable`.
        if (pagesFetched > 0
          && (resp.status === 404 || resp.status === 429 || resp.status >= 500)) {
          stoppedEarly = true;
          break;
        }
        const text = await resp.text();
        throw buildServiceError('graph', resp, text.slice(0, 400));
      }
      let body;
      try {
        body = await resp.json();
      } catch (error) {
        if (pagesFetched === 0) throw error;
        stoppedEarly = true;
        break;
      }
      pagesFetched += 1;
      const entries = Array.isArray(body?.value) ? body.value : [];
      for (const entry of entries) {
        const version = mapVersionEntry(entry, usable.length);
        // The current entry was fetched up front, so skip the page copy rather
        // than listing that version twice.
        if (!version || version.versionId === currentVersionId) continue;
        usable.push(version);
      }
      const nextLink = body?.['@odata.nextLink'];
      if (!nextLink) {
        pageUrl = null;
        continue;
      }
      const parsedNextLink = new URL(nextLink);
      const expectedPath = `/v1.0/drives/${encodedDriveId}/items/${encodedItemId}/versions`;
      if (parsedNextLink.origin !== new URL(GRAPH_BASE).origin
        || parsedNextLink.pathname !== expectedPath) {
        throw new Error('Graph version pagination returned an unexpected nextLink.');
      }
      pageUrl = parsedNextLink.toString();
    }
    // Current identity wins even if its timestamp is absent or Graph placed it
    // on a later page. Remaining parseable timestamps sort newest-first; entries
    // without timestamps retain their observed order after timestamped entries.
    usable.sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      const rightTime = Date.parse(right.lastModified || '');
      const leftTime = Date.parse(left.lastModified || '');
      if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
        return Number.isFinite(leftTime) ? -1 : 1;
      }
      return left.observedIndex - right.observedIndex;
    });
    const hasMore = usable.length > boundedLimit || stoppedEarly;
    return {
      siteId,
      driveId,
      itemId,
      versions: usable.slice(0, boundedLimit).map(({ observedIndex: _observedIndex, ...version }) => (
        version
      )),
      hasMore,
      limit: boundedLimit,
    };
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
   * drive/item IDs and never use the path as the registry identity.
   */
  static async getFileMetadataByPath(libraryName, folderPath, filename) {
    validatePath(folderPath);
    if (!filename || typeof filename !== 'string') {
      throw new Error('getFileMetadataByPath: filename required');
    }
    const siteId = await this.getSiteId();
    const [driveId, token] = await Promise.all([
      this.getDriveId(libraryName, { siteId }),
      this.getAccessToken(),
    ]);
    const encodedPath = [...folderPath.split('/').filter(Boolean), filename]
      .map(encodeURIComponent)
      .join('/');
    const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}`
      + '?$select=id,name,size,webUrl,eTag,cTag,lastModifiedDateTime,parentReference,file,publication';
    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);
    if (resp.status === 404) return null;
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
      mimeType: item.file?.mimeType || null,
      parentReference: item.parentReference || null,
    };
  }

  /**
   * Ensure every segment of a governed folder path exists and return the final
   * folder item. Existing segments are read-only; missing segments are created
   * one at a time. A concurrent creator's 409 is reconciled by re-reading the
   * exact cumulative path.
   */
  static async ensureFolderPath(libraryName, folderPath) {
    validatePath(folderPath);
    const siteId = await this.getSiteId();
    const [driveId, token] = await Promise.all([
      this.getDriveId(libraryName, { siteId }),
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

    const siteUrl = (process.env.SHAREPOINT_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');

    // Build KQL with path scoping to the site (and optionally library/folder)
    let pathScope = siteUrl;
    if (libraryName) {
      pathScope += `/${libraryName}`;
      if (folderPath) {
        pathScope += `/${folderPath}`;
      }
    }
    const kql = `${query} path:"${pathScope}"`;

    const token = await this.getAccessToken();
    const resp = await fetchWithTimeout(`${GRAPH_BASE}/search/query`, {
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
    }, API_TIMEOUT);

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[GraphService] searchFiles failed (${resp.status}):`, text.substring(0, 500));
      throw new Error(`SharePoint search failed (${resp.status}): ${text}`);
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
   * Conflict behavior is `replace` — re-uploads overwrite existing files,
   * relying on SharePoint's built-in versioning to preserve history.
   *
   * @param {string} libraryName - Document library (must be in ALLOWED_LIBRARIES)
   * @param {string} folderPath - Path under the library root (no leading slash)
   * @param {string} filename - Filename to write
   * @param {Buffer} content - File bytes
   * @param {string} [contentType='application/octet-stream'] - Content-Type header
   * @returns {Promise<{ siteId: string, driveId: string, id: string, name: string, size: number, webUrl: string, eTag: string|null, versionId: string|null, lastModified: string|null }>}
   */
  static async uploadFile(libraryName, folderPath, filename, content, contentType = 'application/octet-stream') {
    if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
      throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('uploadFile: filename required');
    }
    if (!Buffer.isBuffer(content)) {
      throw new Error('uploadFile: content must be a Buffer');
    }
    validatePath(folderPath);

    const UPLOAD_MAX_BYTES = 60 * 1024 * 1024; // generous; well above review caps
    if (content.length > UPLOAD_MAX_BYTES) {
      throw new Error(
        `uploadFile: file size ${content.length} exceeds simple-upload limit ` +
          `(${UPLOAD_MAX_BYTES}). Implement createUploadSession for larger files.`,
      );
    }

    const siteId = await this.getSiteId();
    const [driveId, token] = await Promise.all([
      this.getDriveId(libraryName, { siteId }),
      this.getAccessToken(),
    ]);

    const encodedPath = [...folderPath.split('/').filter(Boolean), filename]
      .map(encodeURIComponent)
      .join('/');
    const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/content?@microsoft.graph.conflictBehavior=replace`;

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
    tokenCache = { token: null, expiresAt: 0 };
    tokenPromise = null;
    tokenGeneration += 1;
    siteCache.siteId = null;
    siteCache.fetchedAt = 0;
    driveCache.clear();
  }
}

// ───────── Private Helpers ─────────

function clampApiTimeout(timeoutMs) {
  return Math.max(1, Math.min(API_TIMEOUT, Number.isFinite(timeoutMs) ? timeoutMs : API_TIMEOUT));
}

function deadlineTimeoutError(timeoutMs) {
  const error = new Error(`Graph request exceeded its ${timeoutMs}ms caller deadline.`);
  error.name = 'AbortError';
  return buildNoResponseError('graph', error);
}

function remainingTimeoutMs(deadline, originalTimeoutMs) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw deadlineTimeoutError(originalTimeoutMs);
  return clampApiTimeout(remaining);
}

async function waitForPromiseWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(deadlineTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url, options, timeout) {
  // CONTRACT: this helper installs its own AbortSignal for the timeout.
  // Any caller-provided `options.signal` is silently overwritten — composition
  // with caller signals is not currently supported (round-11 §2). No call site
  // in graph-service.js passes one today; if a future caller needs caller-driven
  // cancellation, compose signals here (AbortSignal.any) rather than picking
  // one over the other.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // Every no-response throw is wrapped so the drain's retry classifier sees
    // a structured error with err.noResponse / err.isTransient / err.causeKind
    // instead of having to string-parse err.message. See lib/utils/service-error.js.
    throw buildNoResponseError('graph', err);
  } finally {
    clearTimeout(timer);
  }
}
