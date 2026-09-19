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
import { downloadFile, downloadFileAsPdf, downloadFileByPath, downloadFileVersion } from './graph/downloads.js';
import { resetSearchCooldown, searchFiles } from './graph/search.js';
import { ensureFolderPath } from './graph/writes.js';
import {
  clampApiTimeout,
  deadlineTimeoutError,
  fetchWithTimeout,
  remainingTimeoutMs,
  safeEmitDependencyEvent,
  waitForPromiseWithin,
} from './graph/http.js';

export { SHAREPOINT_CANONICAL_SITE_URL };

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
   * Download file content by drive ID and item ID. */
  static async downloadFile(driveId, itemId) {
    return downloadFile(this, driveId, itemId);
  }

  /**
   * Download the exact bytes of a prior SharePoint/OneDrive file version. */
  static async downloadFileVersion(driveId, itemId, versionId) {
    return downloadFileVersion(this, driveId, itemId, versionId);
  }

  /**
   * Convert the current immutable snapshot item to PDF through Microsoft Graph. */
  static async downloadFileAsPdf(driveId, itemId) {
    return downloadFileAsPdf(this, driveId, itemId);
  }

  /**
   * Download a file by library name, folder path, and filename. */
  static async downloadFileByPath(libraryName, folderPath, filename) {
    return downloadFileByPath(this, libraryName, folderPath, filename);
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
    return ensureFolderPath(this, libraryName, folderPath, {
      siteId: assertedSiteId,
      driveId: assertedDriveId,
      signal,
    });
  }

  // ───────── Search ─────────

  /**
   * Search within SharePoint document contents using the Microsoft Graph Search API.
   */
  static async searchFiles(query, { libraryName, folderPath } = {}) {
    return searchFiles(this, query, { libraryName, folderPath });
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
    resetSearchCooldown();
    resetAuthCache();
    resetResolutionCaches();
  }
}
