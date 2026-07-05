/**
 * SharePoint bucket discovery for Dynamics CRM requests.
 *
 * A "bucket" is a (library, folder) pair where files for a given request might
 * live. Resolving them takes two steps:
 *
 *  1. Query `sharepointdocumentlocations` for rows pointing at the request and
 *     resolve each one's parent location → library name. These are the
 *     "active" buckets that Dynamics knows about.
 *
 *  2. Append speculative archive buckets for `RequestArchive1/2/3`. These hold
 *     migrated content from a previous grants management system; Dynamics
 *     doesn't track them, but the folder name follows the same
 *     `{requestNumber}_{guidNoHyphensUpper}` convention so they can be probed
 *     without an extra round-trip. Newer grants will simply 404 against the
 *     archive libraries — that's expected and handled by the caller's
 *     try/catch around `GraphService.listFiles()`.
 *
 * This helper deliberately stops short of actually listing files. The Graph
 * API call is the caller's job so that consumers can pick their own listing
 * options (recursive depth, file caps) and apply their own classification +
 * de-dupe logic over the results.
 *
 * Used by:
 *   - `pages/api/grant-reporting/lookup-grant.js`
 *   - `pages/api/dynamics-explorer/chat.js` (`list_documents`, `search_documents`)
 */

import * as sharepointDocumentLocationAdapter from '../dataverse/adapters/sharepoint-document-location.js';

const ARCHIVE_LIBRARIES = ['RequestArchive1', 'RequestArchive2', 'RequestArchive3'];

/**
 * Get every plausible (library, folder) bucket where a request's SharePoint
 * documents might live.
 *
 * @param {string} requestId - The akoya_requestid GUID.
 * @param {string} requestNumber - The akoya_requestnum (used to compute the
 *   archive folder name).
 * @returns {Promise<Array<{ library: string, folder: string, source: 'dynamics'|'archive' }>>}
 *   De-duplicated buckets. `source` lets callers label or sort them in UI.
 */
export async function getRequestSharePointBuckets(requestId, requestNumber) {
  if (!requestId) {
    throw new Error('getRequestSharePointBuckets: requestId is required');
  }
  if (!requestNumber) {
    throw new Error('getRequestSharePointBuckets: requestNumber is required');
  }

  // ── Step 1: Dynamics-tracked locations ────────────────────────────────────
  const locResult = await sharepointDocumentLocationAdapter.findByRegardingObject(requestId, {
    select: 'name,relativeurl,_parentsiteorlocation_value',
  });

  // Resolve parent locations → library names. Multiple sharepointdocumentlocation
  // rows on the same request can point at the same library/folder pair, so we
  // de-dupe by composite key after the resolve.
  const parentIds = [
    ...new Set(locResult.records.map(r => r._parentsiteorlocation_value).filter(Boolean)),
  ];

  const parentToLibrary = new Map();
  if (parentIds.length > 0) {
    try {
      const parentResult = await sharepointDocumentLocationAdapter.findByParentIds(parentIds, {
        select: 'sharepointdocumentlocationid,relativeurl',
        top: 10,
      });
      for (const p of parentResult.records) {
        if (p.relativeurl) parentToLibrary.set(p.sharepointdocumentlocationid, p.relativeurl);
      }
    } catch (e) {
      // Non-fatal — fall back to assuming akoya_request below.
    }
  }

  const buckets = new Map();
  for (const loc of locResult.records) {
    if (!loc.relativeurl) continue;
    const lib = parentToLibrary.get(loc._parentsiteorlocation_value) || 'akoya_request';
    const key = `${lib}::${loc.relativeurl}`;
    if (!buckets.has(key)) {
      buckets.set(key, { library: lib, folder: loc.relativeurl, source: 'dynamics' });
    }
  }

  // ── Step 2: speculative archive-library probes ────────────────────────────
  const archiveFolder = `${requestNumber}_${requestId.replace(/-/g, '').toUpperCase()}`;
  for (const library of ARCHIVE_LIBRARIES) {
    const key = `${library}::${archiveFolder}`;
    if (!buckets.has(key)) {
      buckets.set(key, { library, folder: archiveFolder, source: 'archive' });
    }
  }

  return [...buckets.values()];
}

export { ARCHIVE_LIBRARIES };
