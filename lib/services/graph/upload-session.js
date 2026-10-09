/**
 * Graph upload-session transport.
 *
 * Large uploads receive the facade as `svc` so their small-buffer branch keeps
 * the existing receiver dispatch to the simple-upload owner.
 */

import { buildNoResponseError, buildServiceError } from '../../utils/service-error.js';
import { ALLOWED_LIBRARIES, API_TIMEOUT, DOWNLOAD_TIMEOUT, GRAPH_BASE } from './constants.js';
import { validatePath } from './paths.js';
import { fetchWithTimeout } from './http.js';

function assertPreauthenticatedUploadUrl(uploadUrl) {
  let parsed;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    throw new Error('Graph upload session returned an invalid upload URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Graph upload session returned an unsafe upload URL');
  }
  return parsed.toString();
}

/**
 * Create a preauthenticated Graph upload session without sending file bytes
 * through the application. The caller owns browser chunking and must keep the
 * returned URL out of logs and durable plaintext storage.
 */
export async function createBrowserUploadSession(
  svc,
  libraryName,
  folderPath,
  filename,
  { conflictBehavior = 'fail', siteId: assertedSiteId = null, driveId: assertedDriveId = null } = {},
) {
  if (!ALLOWED_LIBRARIES.has(String(libraryName || '').toLowerCase())) {
    throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
  }
  if (!['fail', 'replace', 'rename'].includes(conflictBehavior)) {
    throw new Error('createBrowserUploadSession: invalid conflict behavior');
  }
  if (!filename || typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
    throw new Error('createBrowserUploadSession: safe filename required');
  }
  if ((assertedSiteId && !assertedDriveId) || (!assertedSiteId && assertedDriveId)) {
    throw new Error('createBrowserUploadSession: siteId and driveId must be supplied together');
  }
  validatePath(folderPath);
  const siteId = assertedSiteId || await svc.getSiteId();
  const [driveId, token] = await Promise.all([
    assertedDriveId || svc.getDriveId(libraryName, { siteId }),
    svc.getAccessToken(),
  ]);
  const encodedPath = [...folderPath.split('/').filter(Boolean), filename]
    .map(encodeURIComponent)
    .join('/');
  const response = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root:/${encodedPath}:/createUploadSession`,
    {
      method: 'POST',
      headers: { ...svc.buildHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflictBehavior, name: filename } }),
    },
    API_TIMEOUT,
  );
  if (!response.ok) {
    const body = await response.text();
    throw buildServiceError('graph', response, body.slice(0, 400));
  }
  const session = await response.json();
  if (!session?.uploadUrl || !session?.expirationDateTime) {
    throw new Error('createBrowserUploadSession: Graph returned an incomplete session');
  }
  return {
    siteId,
    driveId,
    uploadUrl: assertPreauthenticatedUploadUrl(session.uploadUrl),
    expiresAt: session.expirationDateTime,
    nextExpectedRanges: Array.isArray(session.nextExpectedRanges) ? session.nextExpectedRanges : ['0-'],
  };
}

/** Read the current ranges for a preauthenticated session; never adds auth. */
export async function getBrowserUploadSessionStatus(_svc, uploadUrl, { timeoutMs = API_TIMEOUT } = {}) {
  const response = await fetchWithTimeout(
    assertPreauthenticatedUploadUrl(uploadUrl),
    { method: 'GET' },
    timeoutMs,
  );
  if (!response.ok) {
    const error = new Error(`Graph upload-session status failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const session = await response.json();
  return {
    expiresAt: session.expirationDateTime || null,
    nextExpectedRanges: Array.isArray(session.nextExpectedRanges) ? session.nextExpectedRanges : [],
  };
}

/**
 * Cancel a preauthenticated upload session and preserve whether Microsoft
 * confirmed cancellation or merely reported that the session is gone.
 * Callers that own cleanup policy must not collapse a 404 (which may mean the
 * upload committed) into a confirmed cancellation.
 */
export async function cancelBrowserUploadSession(_svc, uploadUrl) {
  const response = await fetchWithTimeout(
    assertPreauthenticatedUploadUrl(uploadUrl),
    { method: 'DELETE' },
    API_TIMEOUT,
  );
  if (![200, 202, 204, 404, 410].includes(response.status)) {
    throw new Error(`Graph upload-session cancellation failed (${response.status})`);
  }
  if (response.status === 404) return { outcome: 'gone', status: response.status };
  if (response.status === 410) return { outcome: 'expired', status: response.status };
  return { outcome: 'cancelled', status: response.status };
}

/** Read a response body within `ms`; on expiry cancel the stream and throw a no-response error. */
async function readBodyWithin(response, read, ms) {
  let timer;
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          response.body?.cancel?.().catch?.(() => {});
          reject(buildNoResponseError('graph', new Error('Graph response body timed out')));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PUT one byte range to an upload session and report Graph's progress. The
 * session is left alone on any failure (unlike uploadFileLarge): the caller
 * owns retry and cancellation. 200/201 carry the committed item; 202 carries
 * the next expected ranges. The URL is pre-authorized, so no Authorization.
 */
export async function putUploadSessionChunk(_svc, uploadUrl, { start, bytes, total, timeoutMs = DOWNLOAD_TIMEOUT } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || !Number.isSafeInteger(start) || start < 0
    || !Number.isSafeInteger(total) || start + bytes.length > total) {
    throw new Error('putUploadSessionChunk: a non-empty Buffer within [start, total) is required');
  }
  const startedAt = Date.now();
  const response = await fetchWithTimeout(assertPreauthenticatedUploadUrl(uploadUrl), {
    method: 'PUT',
    headers: {
      'Content-Length': String(bytes.length),
      'Content-Range': `bytes ${start}-${start + bytes.length - 1}/${total}`,
    },
    body: bytes,
  }, timeoutMs);
  // fetchWithTimeout's timer ends when headers arrive; the body read keeps the same overall budget.
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  if (!response.ok) {
    const text = await readBodyWithin(response, () => response.text(), remainingMs);
    throw buildServiceError('graph', response, text.slice(0, 400));
  }
  const body = await readBodyWithin(response, () => response.json(), remainingMs);
  const committed = response.status === 200 || response.status === 201;
  return {
    status: response.status,
    nextExpectedRanges: Array.isArray(body?.nextExpectedRanges) ? body.nextExpectedRanges : [],
    expirationDateTime: body?.expirationDateTime || null,
    item: committed ? body : null,
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
export async function uploadFileLarge(
  svc,
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
    return svc.uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });
  }
  if (!ALLOWED_LIBRARIES.has(libraryName.toLowerCase())) {
    throw new Error(`Document library "${libraryName}" is not in the allowlist.`);
  }
  if (!['fail', 'replace', 'rename'].includes(conflictBehavior)) {
    throw new Error('uploadFileLarge: conflictBehavior must be "fail", "replace", or "rename"');
  }
  if (chunkBytes % (320 * 1024) !== 0) throw new Error('uploadFileLarge: chunkBytes must be a multiple of 320 KiB');
  validatePath(folderPath);
  const siteId = await svc.getSiteId();
  const [driveId, token] = await Promise.all([svc.getDriveId(libraryName, { siteId }), svc.getAccessToken()]);
  const encodedPath = [...folderPath.split('/').filter(Boolean), filename].map(encodeURIComponent).join('/');
  const sessionResp = await fetchWithTimeout(
    `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/createUploadSession`,
    {
      method: 'POST',
      headers: { ...svc.buildHeaders(token), 'Content-Type': 'application/json' },
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
    { headers: svc.buildHeaders(token) },
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
