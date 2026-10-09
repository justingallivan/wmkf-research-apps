/**
 * Read-only Zoom cloud-recording client (Server-to-Server OAuth). Plan:
 * docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md (Stage 3a).
 *
 * Never writes to or deletes from Zoom. Errors are ZoomClientError with a sanitized code;
 * Zoom response bodies, URLs, the access token and credentials never appear in an error
 * message, log or return value other than the documented listing/download results.
 */

const TOKEN_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 240_000;
const MAX_WINDOW_DAYS = 30;
const MAX_PAGES_PER_WINDOW = 20;
const MAX_REDIRECTS = 5;
const RESOLVE_TIMEOUT_MS = 30_000;
const RANGE_TIMEOUT_MS = 45_000;
const DAY_MS = 86_400_000;

const HTTP_STATUS = Object.freeze({
  zoom_not_configured: 503,
  zoom_auth_failed: 502,
  zoom_scope_missing: 502,
  zoom_not_found: 404,
  zoom_rate_limited: 503,
  zoom_download_invalid: 502,
  zoom_range_unsupported: 502,
  zoom_download_denied: 502,
  zoom_unavailable: 502,
});

export class ZoomClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ZoomClientError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code] || 502;
  }
}

let cachedToken = null;

/** Test seam: forget the cached access token. */
export function resetZoomTokenCache() { cachedToken = null; }

function readCredentials(env = process.env) {
  const accountId = String(env.ZOOM_S2S_ACCOUNT_ID || '').trim();
  const clientId = String(env.ZOOM_S2S_CLIENT_ID || '').trim();
  const clientSecret = String(env.ZOOM_S2S_CLIENT_SECRET || '').trim();
  if (!accountId || !clientId || !clientSecret) throw new ZoomClientError('zoom_not_configured');
  return { accountId, clientId, clientSecret };
}

/** Read only Zoom's numeric `code` from an error body; nothing else from the body is kept. */
async function zoomErrorCode(res) {
  try {
    const body = await res.json();
    return Number.isInteger(body?.code) ? body.code : null;
  } catch { return null; }
}

async function mapFailure(res) {
  const zoomCode = await zoomErrorCode(res);
  if (zoomCode === 4711) return new ZoomClientError('zoom_scope_missing');
  if (res.status === 401) return new ZoomClientError('zoom_auth_failed');
  if (res.status === 403) return new ZoomClientError('zoom_scope_missing');
  if (res.status === 404) return new ZoomClientError('zoom_not_found');
  if (res.status === 429) return new ZoomClientError('zoom_rate_limited');
  return new ZoomClientError('zoom_unavailable');
}

async function timedFetch(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ZoomClientError('zoom_unavailable');
  }
}

/**
 * timedFetch with a caller deadline (epoch ms): the per-call timeout is the smaller of the
 * operation budget and the time left, and an exhausted deadline fails without a request.
 */
async function deadlineFetch(url, init, budgetMs, deadlineMs) {
  const remaining = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : Infinity;
  const timeoutMs = Math.min(budgetMs, remaining);
  if (!(timeoutMs > 0)) throw new ZoomClientError('zoom_unavailable');
  return timedFetch(url, init, timeoutMs);
}

/** Cached Server-to-Server access token, refreshed 60 s before it expires. */
export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cachedToken.value;
  const { accountId, clientId, clientSecret } = readCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await timedFetch(`${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new ZoomClientError(res.status === 429 ? 'zoom_rate_limited'
    : res.status >= 500 ? 'zoom_unavailable' : 'zoom_auth_failed');
  let body;
  try { body = await res.json(); } catch { throw new ZoomClientError('zoom_auth_failed'); }
  const expiresIn = Number(body?.expires_in);
  if (typeof body?.access_token !== 'string' || !body.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ZoomClientError('zoom_auth_failed');
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return cachedToken.value;
}

async function apiGet(path, query) {
  const token = await getAccessToken();
  const suffix = query ? `?${new URLSearchParams(query)}` : '';
  const res = await timedFetch(`${API_BASE}${path}${suffix}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 401) resetZoomTokenCache();
    throw await mapFailure(res);
  }
  try { return await res.json(); } catch { throw new ZoomClientError('zoom_unavailable'); }
}

const ymd = date => date.toISOString().slice(0, 10);

/**
 * One host's recorded meetings between `from` and `to` (Dates), one request chain per window
 * of at most 30 days (Zoom's cap), following next_page_token. De-duplicated by occurrence UUID.
 */
export async function listHostRecordings(email, { from, to }) {
  if (typeof email !== 'string' || !email || !(from instanceof Date) || !(to instanceof Date)
    || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new ZoomClientError('zoom_unavailable');
  }
  const byUuid = new Map();
  for (let windowEnd = to; windowEnd >= from;) {
    const windowStart = new Date(Math.max(windowEnd.getTime() - MAX_WINDOW_DAYS * DAY_MS, from.getTime()));
    let next = '';
    let pages = 0;
    do {
      if (pages++ >= MAX_PAGES_PER_WINDOW) throw new ZoomClientError('zoom_unavailable');
      const query = { from: ymd(windowStart), to: ymd(windowEnd), page_size: '300' };
      if (next) query.next_page_token = next;
      const body = await apiGet(`/users/${encodeURIComponent(email)}/recordings`, query);
      for (const meeting of Array.isArray(body?.meetings) ? body.meetings : []) {
        if (typeof meeting?.uuid === 'string') byUuid.set(meeting.uuid, meeting);
      }
      next = typeof body?.next_page_token === 'string' ? body.next_page_token : '';
    } while (next);
    if (windowStart.getTime() <= from.getTime()) break;
    windowEnd = new Date(windowStart.getTime() - DAY_MS);
  }
  return [...byUuid.values()];
}

/** UUIDs that start with "/" or contain "//" must be URL-encoded twice (Zoom API rule). */
export function encodeMeetingUuid(uuid) {
  return uuid.startsWith('/') || uuid.includes('//') ? encodeURIComponent(encodeURIComponent(uuid)) : encodeURIComponent(uuid);
}

/** Current file metadata and fresh download URLs for one occurrence. */
export async function getMeetingRecordings(uuid) {
  if (typeof uuid !== 'string' || uuid.length < 1 || uuid.length > 200 || /[\u0000-\u001f\u007f]/.test(uuid)) {
    throw new ZoomClientError('zoom_not_found');
  }
  return apiGet(`/meetings/${encodeMeetingUuid(uuid)}/recordings`);
}

function assertZoomHttpsUrl(url) {
  const hostOk = url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us');
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') || url.username || url.password || !hostOk) {
    throw new ZoomClientError('zoom_download_invalid');
  }
}

async function readBounded(res, maxBytes) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ZoomClientError('zoom_download_invalid');
  const reader = res.body?.getReader?.();
  if (!reader) throw new ZoomClientError('zoom_download_invalid');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ZoomClientError('zoom_download_invalid');
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (error) {
    if (error instanceof ZoomClientError) throw error;
    throw new ZoomClientError('zoom_unavailable');
  }
  return Buffer.concat(chunks, total);
}

/**
 * Download one recording file. Redirects are followed manually (at most 5): every hop must be
 * https, port 443, free of URL credentials and on zoom.us or a *.zoom.us host, and only the
 * first request carries the bearer token. HTML responses (Zoom's unauthenticated sign-in
 * page answers 200), bodies over maxBytes and a byte count different from expectedBytes
 * are rejected. Returns a Buffer.
 */
export async function downloadRecordingFile(downloadUrl, { maxBytes, expectedBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1
    || expectedBytes > maxBytes) {
    throw new ZoomClientError('zoom_download_invalid');
  }
  let url;
  try { url = new URL(String(downloadUrl)); } catch { throw new ZoomClientError('zoom_download_invalid'); }
  assertZoomHttpsUrl(url);
  const token = await getAccessToken();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await timedFetch(url.toString(),
      { redirect: 'manual', headers: hop === 0 ? { Authorization: `Bearer ${token}` } : {} }, DOWNLOAD_TIMEOUT_MS);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel?.().catch?.(() => {});
      const location = res.headers?.get?.('location');
      if (!location) throw new ZoomClientError('zoom_download_invalid');
      try { url = new URL(location, url); } catch { throw new ZoomClientError('zoom_download_invalid'); }
      assertZoomHttpsUrl(url);
      continue;
    }
    if (!res.ok) throw await mapFailure(res);
    if (String(res.headers?.get?.('content-type') || '').toLowerCase().includes('text/html')) {
      throw new ZoomClientError('zoom_download_invalid');
    }
    const buffer = await readBounded(res, maxBytes);
    if (buffer.length !== expectedBytes) throw new ZoomClientError('zoom_download_invalid');
    return buffer;
  }
  throw new ZoomClientError('zoom_download_invalid');
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * Follow a recording download_url to the final host without transferring the file. Redirects
 * are manual (at most 5), every hop passes assertZoomHttpsUrl, the bearer goes on hop 0 only
 * and every hop asks for `Range: bytes=0-0`. Returns the final URL (a string the caller keeps
 * in memory only) once a hop answers 206; a 200 means Zoom ignored the range and is terminal.
 * The whole resolution is bounded by 30 s and by `deadlineMs`.
 */
export async function resolveRecordingDownloadUrl(downloadUrl, { bearer, deadlineMs } = {}) {
  if (typeof bearer !== 'string' || !bearer) throw new ZoomClientError('zoom_auth_failed');
  let url;
  try { url = new URL(String(downloadUrl)); } catch { throw new ZoomClientError('zoom_download_invalid'); }
  assertZoomHttpsUrl(url);
  const limit = Math.min(Number.isFinite(deadlineMs) ? deadlineMs : Infinity, Date.now() + RESOLVE_TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers = { Range: 'bytes=0-0' };
    if (hop === 0) headers.Authorization = `Bearer ${bearer}`;
    const res = await deadlineFetch(url.toString(), { redirect: 'manual', headers }, RESOLVE_TIMEOUT_MS, limit);
    if (REDIRECT_STATUSES.includes(res.status)) {
      await res.body?.cancel?.().catch?.(() => {});
      const location = res.headers?.get?.('location');
      if (!location) throw new ZoomClientError('zoom_download_invalid');
      try { url = new URL(location, url); } catch { throw new ZoomClientError('zoom_download_invalid'); }
      assertZoomHttpsUrl(url);
      continue;
    }
    if (res.status === 206) {
      await res.body?.cancel?.().catch?.(() => {});
      return url.toString();
    }
    if (res.ok) {
      await res.body?.cancel?.().catch?.(() => {});
      throw new ZoomClientError('zoom_range_unsupported');
    }
    throw await mapFailure(res);
  }
  throw new ZoomClientError('zoom_download_invalid');
}

/**
 * One byte range from a URL returned by resolveRecordingDownloadUrl; no bearer, no redirects.
 * Requires 206 with exactly `Content-Range: bytes start-end/total`, a body of exactly
 * end-start+1 bytes and a non-HTML type. 401/403/404/410 are returned as `{ bytes: null,
 * status }` (the caller re-resolves once); other failures throw coded errors.
 */
export async function fetchRecordingRange(resolvedUrl, { start, end, total, deadlineMs } = {}) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)
    || start < 0 || end < start || end >= total) {
    throw new ZoomClientError('zoom_download_invalid');
  }
  let url;
  try { url = new URL(String(resolvedUrl)); } catch { throw new ZoomClientError('zoom_download_invalid'); }
  assertZoomHttpsUrl(url);
  const length = end - start + 1;
  const res = await deadlineFetch(url.toString(),
    { redirect: 'manual', headers: { Range: `bytes=${start}-${end}` } }, RANGE_TIMEOUT_MS, deadlineMs);
  if (res.status !== 206) {
    await res.body?.cancel?.().catch?.(() => {});
    if ([401, 403, 404, 410].includes(res.status)) return { bytes: null, status: res.status };
    if (res.status === 429) throw new ZoomClientError('zoom_rate_limited');
    if (res.status >= 500) throw new ZoomClientError('zoom_unavailable');
    throw new ZoomClientError(res.ok ? 'zoom_range_unsupported' : 'zoom_download_invalid');
  }
  if (String(res.headers?.get?.('content-type') || '').toLowerCase().includes('text/html')
    || res.headers?.get?.('content-range') !== `bytes ${start}-${end}/${total}`) {
    await res.body?.cancel?.().catch?.(() => {});
    throw new ZoomClientError('zoom_download_invalid');
  }
  const bytes = await readBounded(res, length);
  if (bytes.length !== length) throw new ZoomClientError('zoom_download_invalid');
  return { bytes, status: 206 };
}
