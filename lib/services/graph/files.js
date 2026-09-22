/**
 * GraphService file reads.
 *
 * These operations receive the facade as `svc` so nested resolution and
 * authentication continue through the public receiver. Listing, stable-ID
 * metadata, and path metadata intentionally retain their distinct contracts.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { ALLOWED_LIBRARIES, API_TIMEOUT, GRAPH_BASE } from './constants.js';
import { validatePath } from './paths.js';
import {
  clampApiTimeout,
  fetchWithTimeout,
  remainingTimeoutMs,
} from './http.js';

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
 * @param {boolean} [options.failOnTruncation=false] - Throw instead of
 *   returning a partial inventory when Graph pagination or recursion proves
 *   that `maxFiles` was exceeded.
 * @returns {Array<{name, size, lastModified, mimeType, webUrl, id, folder}>}
 *   Each file's `folder` is the absolute path under the library root where the
 *   file actually lives — pass it back to `downloadFileByPath` and it
 *   resolves correctly even for nested files.
 */
export async function listFiles(svc, libraryName, folderPath, options = {}) {
  const {
    recursive = false,
    maxDepth = 3,
    maxFiles = 500,
    failOnTruncation = false,
    // Wall-clock ceiling on the total walk. Protects against pathological
    // folder structures where maxDepth + maxFiles caps aren't hit but the
    // recursive fan-out still produces N×API_TIMEOUT latency.
    totalTimeoutMs = 30_000,
  } = options;
  validatePath(folderPath);
  const driveId = await svc.getDriveId(libraryName);
  const token = await svc.getAccessToken();

  const deadline = Date.now() + totalTimeoutMs;
  const collected = [];
  let truncated = false;

  const stopAtLimit = () => {
    truncated = true;
    if (failOnTruncation) {
      const error = new Error(
        `listFiles(${libraryName}/${folderPath}) exceeded the ${maxFiles}-file inventory limit`,
      );
      error.code = 'graph_file_list_truncated';
      throw error;
    }
  };

  const walk = async (currentPath, depth) => {
    if (truncated) return;
    if (Date.now() > deadline) {
      throw new Error(
        `listFiles(${libraryName}/${folderPath}) exceeded ${totalTimeoutMs}ms walk timeout`,
      );
    }

    const encodedPath = currentPath.split('/').map(encodeURIComponent).join('/');
    let pageUrl = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/children?$select=name,size,lastModifiedDateTime,file,folder,webUrl,id`;
    const expectedPathPrefix = new URL(`${GRAPH_BASE}/drives/${driveId}/`).pathname;
    const expectedPathAddressedPathname = new URL(pageUrl).pathname;
    const idAddressedPrefix = `${expectedPathPrefix}items/`;
    let pinnedIdAddressedPathname = null;
    const seenPageUrls = new Set();
    const folders = [];

    while (pageUrl) {
      if (Date.now() > deadline) {
        throw new Error(
          `listFiles(${libraryName}/${folderPath}) exceeded ${totalTimeoutMs}ms walk timeout`,
        );
      }
      if (seenPageUrls.has(pageUrl)) throw new Error('Graph file pagination repeated a nextLink.');
      seenPageUrls.add(pageUrl);
      const resp = await fetchWithTimeout(pageUrl, {
        headers: svc.buildHeaders(token),
      }, Math.min(API_TIMEOUT, Math.max(1, deadline - Date.now())));

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to list files in ${libraryName}/${currentPath} (${resp.status}): ${text}`);
      }

      const data = await resp.json();
      const items = Array.isArray(data.value) ? data.value : [];
      for (const item of items) {
        if (item.file != null) {
          if (collected.length >= maxFiles) {
            stopAtLimit();
            return;
          }
          collected.push({
            name: item.name,
            size: item.size,
            lastModified: item.lastModifiedDateTime,
            mimeType: item.file?.mimeType || null,
            webUrl: item.webUrl,
            id: item.id,
            folder: currentPath,
          });
        } else if (item.folder != null) {
          folders.push(item);
        }
      }

      const nextLink = data['@odata.nextLink'];
      if (!nextLink) {
        pageUrl = null;
      } else {
        if (collected.length >= maxFiles && !failOnTruncation) {
          stopAtLimit();
          return;
        }
        const parsedNextLink = new URL(nextLink);
        const idAddressed = parsedNextLink.pathname.startsWith(idAddressedPrefix)
          && parsedNextLink.pathname.endsWith('/children')
          && parsedNextLink.pathname.slice(idAddressedPrefix.length, -'/children'.length).length > 0
          && !parsedNextLink.pathname.slice(idAddressedPrefix.length, -'/children'.length).includes('/');
        const pathAddressed = parsedNextLink.pathname === expectedPathAddressedPathname;
        if (parsedNextLink.origin !== new URL(GRAPH_BASE).origin
            || (!pathAddressed && !idAddressed)
            || (idAddressed && pinnedIdAddressedPathname
              && parsedNextLink.pathname !== pinnedIdAddressedPathname)) {
          throw new Error('Graph file pagination returned an unexpected nextLink.');
        }
        if (idAddressed) pinnedIdAddressedPathname = parsedNextLink.pathname;
        pageUrl = parsedNextLink.toString();
      }
    }

    if (recursive && depth < maxDepth) {
      for (const item of folders) {
        if (collected.length >= maxFiles && !failOnTruncation) {
          stopAtLimit();
          return;
        }
        const childPath = `${currentPath}/${item.name}`;
        await walk(childPath, depth + 1);
        if (truncated) return;
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
export async function getFileMetadataById(
  svc,
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
  const token = await svc.getAccessToken({
    timeoutMs: remainingTimeoutMs(deadline, boundedTimeoutMs),
  });
  const itemTimeoutMs = remainingTimeoutMs(deadline, boundedTimeoutMs);
  const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
    + `/items/${encodeURIComponent(itemId)}`
    + '?$select=id,name,size,webUrl,eTag,cTag,lastModifiedDateTime,parentReference,file,publication';
  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
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
 * Resolve one drive item by its governed path. Returns null on a clean 404;
 * other Graph failures remain errors. Callers persist the returned stable
 * drive/item IDs and never use the path as the registry identity. A guarded
 * writer may supply a pre-resolved site/drive pair so target identity cannot
 * drift between preflight and the path read.
 */
export async function getFileMetadataByPath(
  svc,
  libraryName,
  folderPath,
  filename,
  { siteId: assertedSiteId = null, driveId: assertedDriveId = null } = {},
) {
  if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
    throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
  }
  validatePath(folderPath);
  if (!filename || typeof filename !== 'string') {
    throw new Error('getFileMetadataByPath: filename required');
  }
  if ((assertedSiteId && !assertedDriveId) || (!assertedSiteId && assertedDriveId)) {
    throw new Error('getFileMetadataByPath: siteId and driveId must be supplied together');
  }
  const siteId = assertedSiteId || await svc.getSiteId();
  const [driveId, token] = await Promise.all([
    assertedDriveId || svc.getDriveId(libraryName, { siteId }),
    svc.getAccessToken(),
  ]);
  const encodedPath = [...folderPath.split('/').filter(Boolean), filename]
    .map(encodeURIComponent)
    .join('/');
  const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}`
    + '?$select=id,name,size,webUrl,eTag,cTag,lastModifiedDateTime,parentReference,file,publication';
  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
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
