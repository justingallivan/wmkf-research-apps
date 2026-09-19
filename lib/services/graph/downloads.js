/**
 * GraphService download operations.
 *
 * Download redirects deliberately drop Graph authorization before following
 * the CDN URL. Public facade receivers arrive as `svc`.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { API_TIMEOUT, DOWNLOAD_TIMEOUT, GRAPH_BASE } from './constants.js';
import { validatePath } from './paths.js';
import { fetchWithTimeout } from './http.js';

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
export async function downloadFile(svc, driveId, itemId) {
  const token = await svc.getAccessToken();

  // Step 1: metadata (also yields pre-signed downloadUrl when available)
  const metaResp = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`,
    { headers: svc.buildHeaders(token) },
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
    { headers: svc.buildHeaders(token), redirect: 'manual' },
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
export async function downloadFileVersion(svc, driveId, itemId, versionId) {
  if (!driveId || !itemId || !versionId) {
    throw new Error('downloadFileVersion: driveId, itemId, and versionId are required');
  }
  const token = await svc.getAccessToken();
  const initial = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
      + `/items/${encodeURIComponent(itemId)}`
      + `/versions/${encodeURIComponent(versionId)}/content`,
    { headers: svc.buildHeaders(token), redirect: 'manual' },
    DOWNLOAD_TIMEOUT,
  );
  return downloadRedirectBody(initial, 'file version');
}

/**
 * Convert the current immutable snapshot item to PDF through Microsoft Graph.
 * The caller owns the source-version freeze; this method never restores or
 * mutates the source item.
 */
export async function downloadFileAsPdf(svc, driveId, itemId) {
  if (!driveId || !itemId) {
    throw new Error('downloadFileAsPdf: driveId and itemId are required');
  }
  const token = await svc.getAccessToken();
  const initial = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
      + `/items/${encodeURIComponent(itemId)}/content?format=pdf`,
    { headers: svc.buildHeaders(token), redirect: 'manual' },
    DOWNLOAD_TIMEOUT,
  );
  return downloadRedirectBody(initial, 'PDF conversion');
}

/**
 * Download a file by library name, folder path, and filename.
 * Resolves the path to a drive item and downloads it.
 */
export async function downloadFileByPath(svc, libraryName, folderPath, filename) {
  validatePath(folderPath);
  const driveId = await svc.getDriveId(libraryName);
  const token = await svc.getAccessToken();

  const encodedPath = [...folderPath.split('/'), filename].map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}`;

  // Get item metadata (includes ID)
  const resp = await fetchWithTimeout(url + '?$select=id,name,file,size', {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`File not found: ${filename} (${resp.status}): ${text}`);
  }

  const item = await resp.json();
  return svc.downloadFile(driveId, item.id);
}


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
