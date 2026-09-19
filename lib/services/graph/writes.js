/**
 * GraphService governed folder writes.
 *
 * Folder creation receives the facade as `svc` so nested resolution,
 * authentication, headers, and cancellation behavior remain unchanged.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { ALLOWED_LIBRARIES, API_TIMEOUT, GRAPH_BASE } from './constants.js';
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
