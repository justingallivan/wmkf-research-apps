/** @jest-environment node */
import { GraphService } from '../../lib/services/graph-service.js';

const realFetch = global.fetch;
function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body), text: jest.fn(async () => JSON.stringify(body)), headers: { get: jest.fn(() => null) } };
}
const MiB = 1024 * 1024;

beforeEach(() => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = realFetch; });

test('small buffers delegate to uploadFile with the same conflict behaviour', async () => {
  const simple = jest.spyOn(GraphService, 'uploadFile').mockResolvedValue({ id: 'simple' });
  const result = await GraphService.uploadFileLarge('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', Buffer.alloc(10), 'application/pdf', { conflictBehavior: 'replace' });
  expect(result).toEqual({ id: 'simple' });
  expect(simple).toHaveBeenCalledWith('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', expect.any(Buffer), 'application/pdf', { conflictBehavior: 'replace' });
});

test('large buffers open an upload session, PUT contiguous Content-Range chunks without Authorization, then read back the version', async () => {
  const content = Buffer.alloc(61 * MiB, 7);
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (String(url) === 'https://up.example/session') {
      const isLast = init.headers['Content-Range'].endsWith(`/${content.length}`) && init.headers['Content-Range'].includes(`-${content.length - 1}/`);
      return isLast ? response(201, { id: 'item-9', name: 'a.pdf', size: content.length, webUrl: 'https://sp/a', eTag: '"e1"', publication: { versionId: '1.0' } }) : response(202, {});
    }
    if (String(url).includes('/items/item-9')) return response(200, { id: 'item-9', size: content.length, eTag: '"e2"', publication: { versionId: '3.0' }, lastModifiedDateTime: '2026-11-21T09:00:00Z' });
    throw new Error(`unexpected ${url}`);
  });
  const result = await GraphService.uploadFileLarge('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', content, 'application/pdf', { conflictBehavior: 'replace', chunkBytes: 20 * MiB });
  const session = calls[0];
  expect(session.url).toBe('https://graph.microsoft.com/v1.0/drives/drive/root:/Folder/Site%20Visit%20-%20Slides/a.pdf:/createUploadSession');
  expect(JSON.parse(session.init.body).item['@microsoft.graph.conflictBehavior']).toBe('replace');
  const puts = calls.filter((c) => c.url === 'https://up.example/session');
  expect(puts.map((c) => c.init.headers['Content-Range'])).toEqual([
    `bytes 0-${20 * MiB - 1}/${content.length}`, `bytes ${20 * MiB}-${40 * MiB - 1}/${content.length}`, `bytes ${40 * MiB}-${60 * MiB - 1}/${content.length}`, `bytes ${60 * MiB}-${content.length - 1}/${content.length}`,
  ]);
  for (const put of puts) { expect(put.init.headers.Authorization).toBeUndefined(); expect(put.init.method).toBe('PUT'); }
  expect(result).toEqual({ siteId: 'site', driveId: 'drive', id: 'item-9', name: 'a.pdf', size: content.length, webUrl: 'https://sp/a', eTag: '"e2"', versionId: '3.0', lastModified: '2026-11-21T09:00:00Z' });
});

test('a failed chunk cancels the session and throws; bad chunk sizes and libraries are refused before any call', async () => {
  const content = Buffer.alloc(61 * MiB, 7);
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (init.method === 'PUT') return response(500, { error: 'boom' });
    return response(204, {});
  });
  await expect(GraphService.uploadFileLarge('akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB })).rejects.toThrow();
  expect(calls.some((c) => c.url === 'https://up.example/session' && c.method === 'DELETE')).toBe(true);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  global.fetch = jest.fn();
  await expect(GraphService.uploadFileLarge('akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 1000 })).rejects.toThrow(/320 KiB/);
  await expect(GraphService.uploadFileLarge('not_allowed', 'F', 'a.pdf', content, 'application/pdf')).rejects.toThrow(/allowlist/);
  expect(global.fetch).not.toHaveBeenCalled();
});
