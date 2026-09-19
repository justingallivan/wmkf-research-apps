/**
 * GraphService version-history reads and restore.
 *
 * Version pagination, current-version identity, salvage bounds, and restore
 * status handling remain in one owner. Public facade receivers arrive as `svc`.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { API_TIMEOUT, GRAPH_BASE } from './constants.js';
import {
  clampApiTimeout,
  fetchWithTimeout,
  remainingTimeoutMs,
} from './http.js';

// Version-history pagination bounds. Three pages at `$top = limit + 1` covers
// ~3x the displayed rows without letting a heavily-edited document turn one
// lazy disclosure into dozens of sequential round-trips. When those pages do
// not contain the drive item's authoritative `publication.versionId`, that one
// version is fetched directly so the bounded scan cannot omit the current editor.
const MAX_VERSION_PAGES = 3;
// Don't start a page we cannot plausibly finish; stop and report instead.
const MIN_VERSION_PAGE_BUDGET_MS = 2_000;

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
export async function listFileVersions(svc,
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
  const token = await svc.getAccessToken({
    timeoutMs: remainingTimeoutMs(deadline, boundedTimeoutMs),
  });
  const encodedDriveId = encodeURIComponent(driveId);
  const encodedItemId = encodeURIComponent(itemId);
  const itemUrl = `${GRAPH_BASE}/drives/${encodedDriveId}/items/${encodedItemId}`
    + '?$select=id,file,publication';
  const itemResp = await fetchWithTimeout(itemUrl, {
    headers: svc.buildHeaders(token),
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
      headers: svc.buildHeaders(token),
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
        headers: svc.buildHeaders(token),
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
/** Resolve one exact historical/current version by stable drive-item identity. */
export async function getFileVersionMetadata(svc, driveId, itemId, versionId) {
  if (!driveId || !itemId || !versionId) {
    throw new Error('getFileVersionMetadata: driveId, itemId, and versionId are required');
  }
  const token = await svc.getAccessToken();
  const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
    + `/items/${encodeURIComponent(itemId)}`
    + `/versions/${encodeURIComponent(versionId)}`;
  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw buildServiceError('graph', resp, text.slice(0, 400));
  }
  const version = await resp.json();
  if (String(version?.id || '') !== String(versionId)) {
    const error = new Error('Graph version metadata did not resolve to the expected identity.');
    error.code = 'graph_version_identity_mismatch';
    throw error;
  }
  return {
    versionId: String(version.id),
    lastModified: version.lastModifiedDateTime || null,
    size: Number.isFinite(version.size) ? version.size : null,
    lastModifiedBy: version.lastModifiedBy?.user?.displayName || null,
  };
}

/**
 * Restore a prior version as a new current version. SharePoint preserves all
 * existing versions; callers own stale-current fencing and post-write readback.
 */
export async function restoreFileVersion(svc, driveId, itemId, versionId) {
  if (!driveId || !itemId || !versionId) {
    throw new Error('restoreFileVersion: driveId, itemId, and versionId are required');
  }
  const token = await svc.getAccessToken();
  const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}`
    + `/items/${encodeURIComponent(itemId)}`
    + `/versions/${encodeURIComponent(versionId)}/restoreVersion`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      ...svc.buildHeaders(token),
      'Content-Type': 'application/json',
    },
  }, API_TIMEOUT);
  if (!resp.ok) {
    const text = await resp.text();
    throw buildServiceError('graph', resp, text.slice(0, 400));
  }
  if (resp.status !== 204) {
    const error = new Error(`Graph version restore returned unexpected status ${resp.status}.`);
    error.code = 'graph_restore_unexpected_status';
    throw error;
  }
}
