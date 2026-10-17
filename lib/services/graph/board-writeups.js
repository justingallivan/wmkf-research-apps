/** Board folder transport; fixed registered root and create-only child operations. */
import { boardWorkEnabled } from '../board-writeups/mode.js';
import { RESEARCH_BOARD_MATERIALS_TARGET as TARGET } from '../sharepoint-target-registry.js';
import { PRODUCTION_HOSTS } from '../../dataverse/core/target-registry.js';
import { API_TIMEOUT, GRAPH_BASE } from './constants.js';
import { fetchWithBodyTimeout } from './http.js';
import { buildServiceError } from '../../utils/service-error.js';
export function assertBoardWriteEnvironment(env = process.env) {
  let hostname;
  try { hostname = new URL(env.DYNAMICS_SANDBOX_URL || env.DYNAMICS_URL).hostname; } catch { /* fail closed */ }
  if (env.VERCEL_ENV !== 'production' || !boardWorkEnabled(env) || !PRODUCTION_HOSTS.includes(hostname)) {
    throw Object.assign(new Error('Board writes require the enabled production deployment and target.'), { code: 'board_write_target_denied' });
  }
}
async function request(svc, path, method = 'GET', payload = null) {
  const token = await svc.getAccessToken();
  const url = path.startsWith('https:') ? path : `${GRAPH_BASE}${path}`;
  const parsed = new URL(url);
  if (parsed.origin !== new URL(GRAPH_BASE).origin || !parsed.pathname.startsWith('/v1.0/drives/')) throw new Error('Untrusted Graph pagination URL');
  const { response, body } = await fetchWithBodyTimeout(url, { method, headers: { ...svc.buildHeaders(token), 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) }, API_TIMEOUT, r => r.ok ? r.json() : r.text());
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw buildServiceError('graph', response, 'Board folder operation failed');
  return body;
}
const rootPath = `/drives/${encodeURIComponent(TARGET.driveId)}/items/${encodeURIComponent(TARGET.folderId)}`;
export async function boardFolder(svc, cycle, { create = false } = {}) {
  if (!/^[JD]\d{2}$/.test(cycle)) throw new Error('Invalid cycle');
  if (create) assertBoardWriteEnvironment();
  const root = await request(svc, rootPath);
  if (!root?.folder || root.id !== TARGET.folderId || root.webUrl !== TARGET.webUrl || root.parentReference?.driveId !== TARGET.driveId) throw new Error('Board root identity changed');
  let folder = await request(svc, `${rootPath}:/${cycle}`);
  if (!folder && create) {
    try { folder = await request(svc, `${rootPath}/children`, 'POST', { '@microsoft.graph.conflictBehavior': 'fail', name: cycle, folder: {} }); }
    catch (error) { if (error.status !== 409) throw error; folder = await request(svc, `${rootPath}:/${cycle}`); }
  }
  if (!folder) return null;
  if (!folder.folder || folder.name !== cycle || folder.parentReference?.id !== TARGET.folderId || folder.parentReference?.driveId !== TARGET.driveId) throw new Error('Board cycle folder identity changed');
  return { ...TARGET, folderId: folder.id, webUrl: folder.webUrl };
}
export async function boardChildren(svc, cycle) {
  const folder = await boardFolder(svc, cycle);
  if (!folder) return { folder: null, items: [] };
  const items = [];
  let path = `/drives/${encodeURIComponent(folder.driveId)}/items/${encodeURIComponent(folder.folderId)}/children?$top=200`;
  const visited = new Set();
  while (path) {
    if (visited.has(path) || visited.size >= 20) throw new Error('Board listing exceeded safety limit');
    visited.add(path);
    const result = await request(svc, path);
    if (!result || !Array.isArray(result.value)) throw new Error('Board listing unavailable');
    items.push(...result.value);
    if (items.length > 1000) throw new Error('Board listing exceeded safety limit');
    path = result['@odata.nextLink'] || null;
  }
  return { folder, items };
}
export async function boardUploadSession(svc, cycle, filename) {
  assertBoardWriteEnvironment();
  if (!filename.endsWith(' - Writeup.docx') || filename.length > 220 || /["*:<>?\/\\|\x00-\x1f]/.test(filename)) throw new Error('Invalid Board filename');
  const folder = await boardFolder(svc, cycle, { create: true });
  const result = await request(svc, `/drives/${encodeURIComponent(folder.driveId)}/items/${encodeURIComponent(folder.folderId)}:/${encodeURIComponent(filename)}:/createUploadSession`, 'POST', { item: { '@microsoft.graph.conflictBehavior': 'fail', name: filename } });
  const url = new URL(result.uploadUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !result.expirationDateTime) throw new Error('Invalid upload session');
  return { uploadUrl: url.toString(), folder };
}
