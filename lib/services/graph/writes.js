/**
 * GraphService governed folder writes.
 *
 * Folder creation receives the facade as `svc` so nested resolution,
 * authentication, headers, and cancellation behavior remain unchanged.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { ALLOWED_LIBRARIES, API_TIMEOUT, DOWNLOAD_TIMEOUT, GRAPH_BASE } from './constants.js';
import { validatePath } from './paths.js';
import { fetchWithTimeout } from './http.js';

/**
 * Ensure every segment of a governed folder path exists and return the final
 * folder item. Existing segments are read-only; missing segments are created
 * one at a time. A concurrent creator's 409 is reconciled by re-reading the
 * exact cumulative path.
 */
export async function ensureFolderPath(
  svc,
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
  const siteId = assertedSiteId || await svc.getSiteId();
  const [driveId, token] = await Promise.all([
    assertedDriveId || svc.getDriveId(libraryName, { siteId }),
    svc.getAccessToken(),
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
      headers: svc.buildHeaders(token),
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
        ...svc.buildHeaders(token),
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
        headers: svc.buildHeaders(token),
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
export async function uploadFile(
  svc,
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
  const siteId = assertedSiteId || await svc.getSiteId();
  const [driveId, token] = await Promise.all([
    assertedDriveId || svc.getDriveId(libraryName, { siteId }),
    svc.getAccessToken(),
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
      { headers: svc.buildHeaders(token) },
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
 * Replace the bytes of one already-resolved drive item. This deliberately
 * accepts a stable item id rather than a path so a guarded repair cannot
 * create or overwrite a sibling with a coincidentally matching name.
 */
export async function replaceFileContent(
  svc,
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
  const token = await svc.getAccessToken();
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
export async function deleteFile(svc, driveId, itemId) {
  const token = await svc.getAccessToken();
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
