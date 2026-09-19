/**
 * Graph upload-session transport.
 *
 * Large uploads receive the facade as `svc` so their small-buffer branch keeps
 * the existing receiver dispatch to the simple-upload owner.
 */

import { buildServiceError } from '../../utils/service-error.js';
import { ALLOWED_LIBRARIES, API_TIMEOUT, DOWNLOAD_TIMEOUT, GRAPH_BASE } from './constants.js';
import { validatePath } from './paths.js';
import { fetchWithTimeout } from './http.js';

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
