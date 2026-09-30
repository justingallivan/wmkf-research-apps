/**
 * Non-buffering media helpers for stable Graph drive-item identities.
 * These helpers may return short-lived preauthenticated Microsoft URLs, but
 * never fetch complete media bodies into application memory.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { API_TIMEOUT, GRAPH_BASE } from './constants.js';
import { fetchWithTimeout } from './http.js';

function safeMicrosoftUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Graph returned an invalid preauthenticated media URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Graph returned an unsafe preauthenticated media URL');
  }
  return parsed.toString();
}

/** Resolve metadata plus a fresh short-lived URL without downloading bytes. */
export async function resolveMediaDownloadUrl(svc, driveId, itemId, { timeoutMs = API_TIMEOUT } = {}) {
  if (!driveId || !itemId) throw new Error('resolveMediaDownloadUrl: driveId and itemId are required');
  const token = await svc.getAccessToken();
  const response = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    { headers: svc.buildHeaders(token) },
    timeoutMs,
  );
  if (!response.ok) {
    const body = await response.text();
    throw buildServiceError('graph', response, body.slice(0, 400));
  }
  const item = await response.json();
  if (!item?.id || item.id !== itemId || item.file == null || !item['@microsoft.graph.downloadUrl']) {
    throw new Error('Graph media metadata did not contain the expected file identity and download URL');
  }
  return {
    driveId,
    itemId: item.id,
    filename: item.name || 'Recording.mp4',
    size: Number(item.size) || null,
    mimeType: item.file?.mimeType || 'application/octet-stream',
    malware: item.malware || null,
    downloadUrl: safeMicrosoftUrl(item['@microsoft.graph.downloadUrl']),
  };
}

// Three total attempts, each with an 8-second metadata and 8-second range
// deadline. Only a no-response or 408/429/500/502/503/504 range fetch retries.
// Every retry resolves a fresh short-lived Microsoft URL; no response body is
// read unless a matching 206 Content-Range is verified first.
const RANGE_ATTEMPTS = 3;
const RANGE_FETCH_TIMEOUT_MS = 8_000;
const RANGE_RETRY_DELAYS_MS = [250, 750];
const TRANSIENT_RANGE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read one bounded byte range from Microsoft; rejects an unbounded/full body. */
export async function readMediaRange(svc, driveId, itemId, { start = 0, end = 31 } = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end - start + 1 > 4096) {
    throw new Error('readMediaRange: range must be a positive bounded interval of at most 4096 bytes');
  }
  for (let attempt = 0; attempt < RANGE_ATTEMPTS; attempt += 1) {
    const media = await resolveMediaDownloadUrl(svc, driveId, itemId, { timeoutMs: RANGE_FETCH_TIMEOUT_MS });
    let response;
    try {
      response = await fetchWithTimeout(
        media.downloadUrl,
        { headers: { Range: `bytes=${start}-${end}` }, redirect: 'follow' },
        RANGE_FETCH_TIMEOUT_MS,
      );
    } catch (error) {
      if (!error?.noResponse || attempt === RANGE_ATTEMPTS - 1) {
        throw new Error('Microsoft media range fetch failed after its bounded retry policy.');
      }
      await wait(RANGE_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (TRANSIENT_RANGE_STATUSES.has(response.status)) {
      if (attempt === RANGE_ATTEMPTS - 1) {
        throw new Error(`Microsoft media range fetch remained transient (${response.status}) after ${RANGE_ATTEMPTS} attempts.`);
      }
      await wait(RANGE_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (response.status !== 206) {
      throw new Error(`Microsoft media range read was not bounded (${response.status})`);
    }
    const contentRange = response.headers.get('content-range') || '';
    const match = contentRange.match(/^bytes (\d+)-(\d+)\/\d+$/i);
    const returnedStart = Number(match?.[1]);
    const returnedEnd = Number(match?.[2]);
    if (!match || returnedStart !== start || returnedEnd < returnedStart || returnedEnd > end) {
      throw new Error('Microsoft media range response did not match the requested bound');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== returnedEnd - returnedStart + 1) {
      throw new Error('Microsoft media range response length did not match Content-Range');
    }
    return { ...media, bytes, contentRange };
  }
  throw new Error('Microsoft media range fetch exhausted its bounded retry policy.');
}
