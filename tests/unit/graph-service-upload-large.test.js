/** @jest-environment node */
import { GraphService } from '../../lib/services/graph-service.js';

const realFetch = global.fetch;
function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body), text: jest.fn(async () => JSON.stringify(body)), headers: { get: jest.fn(() => null) } };
}
const MiB = 1024 * 1024;
const SIMPLE_THRESHOLD_CONTENT = Buffer.alloc(60 * MiB);
const LARGE_CONTENT = Buffer.alloc(61 * MiB, 7);

beforeEach(() => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = realFetch; });

test('buffers at the exact simple-upload threshold delegate to uploadFile with the same conflict behaviour', async () => {
  const simple = jest.spyOn(GraphService, 'uploadFile').mockResolvedValue({ id: 'simple' });
  const result = await GraphService.uploadFileLarge('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', SIMPLE_THRESHOLD_CONTENT, 'application/pdf', { conflictBehavior: 'replace' });
  expect(result).toEqual({ id: 'simple' });
  expect(simple).toHaveBeenCalledWith('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', expect.any(Buffer), 'application/pdf', { conflictBehavior: 'replace' });
});

test.each([
  ['without a publication facet', {}, '1.0'],
  ['with a newer publication facet', { publication: { versionId: '3.0' } }, '3.0'],
])('large buffers support rename, contiguous unauthenticated chunks, and read back the version (%s)', async (_label, readbackVersion, expectedVersionId) => {
  const content = LARGE_CONTENT;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (String(url) === 'https://up.example/session') {
      const isLast = init.headers['Content-Range'].endsWith(`/${content.length}`) && init.headers['Content-Range'].includes(`-${content.length - 1}/`);
      return isLast ? response(201, { id: 'item-9', name: 'a.pdf', size: content.length, webUrl: 'https://sp/a', eTag: '"e1"', publication: { versionId: '1.0' } }) : response(202, {});
    }
    if (String(url).includes('/items/item-9')) return response(200, { id: 'item-9', size: content.length, eTag: '"e2"', lastModifiedDateTime: '2026-11-21T09:00:00Z', ...readbackVersion });
    throw new Error(`unexpected ${url}`);
  });
  const result = await GraphService.uploadFileLarge('akoya_request', 'Folder/Site Visit - Slides', 'a.pdf', content, 'application/pdf', { conflictBehavior: 'rename', chunkBytes: 20 * MiB });
  const session = calls[0];
  expect(session.url).toBe('https://graph.microsoft.com/v1.0/drives/drive/root:/Folder/Site%20Visit%20-%20Slides/a.pdf:/createUploadSession');
  expect(JSON.parse(session.init.body).item['@microsoft.graph.conflictBehavior']).toBe('rename');
  const puts = calls.filter((c) => c.url === 'https://up.example/session');
  expect(puts.map((c) => c.init.headers['Content-Range'])).toEqual([
    `bytes 0-${20 * MiB - 1}/${content.length}`, `bytes ${20 * MiB}-${40 * MiB - 1}/${content.length}`, `bytes ${40 * MiB}-${60 * MiB - 1}/${content.length}`, `bytes ${60 * MiB}-${content.length - 1}/${content.length}`,
  ]);
  for (const put of puts) { expect(put.init.headers.Authorization).toBeUndefined(); expect(put.init.method).toBe('PUT'); }
  // The PUT publication version remains authoritative when readback has no
  // publication facet; stable readback fields still replace the PUT fields.
  expect(result).toEqual({ siteId: 'site', driveId: 'drive', id: 'item-9', name: 'a.pdf', size: content.length, webUrl: 'https://sp/a', eTag: '"e2"', versionId: expectedVersionId, lastModified: '2026-11-21T09:00:00Z' });
  expect(calls.filter((c) => c.url.includes('/items/item-9'))).toHaveLength(1);
});

test('a failed chunk cancels the session and throws; bad chunk sizes and libraries are refused before any call', async () => {
  const content = LARGE_CONTENT;
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
  await expect(GraphService.uploadFileLarge('akoya_request', 'F', 'a.pdf', content, 'application/pdf', { conflictBehavior: 'overwrite' })).rejects.toThrow(/"rename"/);
  await expect(GraphService.uploadFileLarge('akoya_request', 'F', 'a.pdf', Buffer.alloc(10), 'application/pdf', { conflictBehavior: 'overwrite' })).rejects.toThrow(/"rename"/);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an HTTP chunk failure attempts cleanup even when cleanup itself fails, preserving the chunk error', async () => {
  const content = LARGE_CONTENT;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (init.method === 'PUT') return response(500, { error: 'chunk failed' });
    if (init.method === 'DELETE') throw new Error('cleanup unavailable');
    throw new Error(`unexpected ${url}`);
  });

  await expect(GraphService.uploadFileLarge(
    'akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB },
  )).rejects.toMatchObject({ serviceName: 'graph', status: 500 });
  expect(calls.filter(({ init }) => init.method === 'PUT')).toHaveLength(1);
  const cleanup = calls.find(({ init }) => init.method === 'DELETE');
  expect(cleanup).toBeDefined();
  expect(cleanup.init.headers).toBeUndefined();
});

test('a network-thrown chunk does not enter the HTTP-failure cleanup branch', async () => {
  const content = LARGE_CONTENT;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (init.method === 'PUT') throw new Error('upload socket reset');
    throw new Error(`unexpected ${url}`);
  });

  await expect(GraphService.uploadFileLarge(
    'akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB },
  )).rejects.toMatchObject({ serviceName: 'graph', noResponse: true });
  expect(calls.filter(({ init }) => init.method === 'DELETE')).toHaveLength(0);
});

test('all 202 chunk responses fail without a final readback or hidden retry', async () => {
  const content = LARGE_CONTENT;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (String(url) === 'https://up.example/session' && init.method === 'PUT') return response(202, {});
    throw new Error(`unexpected ${url}`);
  });

  await expect(GraphService.uploadFileLarge(
    'akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB },
  )).rejects.toThrow('upload session finished without a drive item');
  expect(calls.filter(({ init }) => init.method === 'PUT')).toHaveLength(4);
  expect(calls.some(({ url }) => url.includes('/items/'))).toBe(false);
});

test('missing upload session URL fails before sending any chunk', async () => {
  const content = LARGE_CONTENT;
  global.fetch = jest.fn().mockResolvedValue(response(200, {}));

  await expect(GraphService.uploadFileLarge(
    'akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB },
  )).rejects.toThrow('no upload session URL');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  ['HTTP failure', () => response(503, { error: 'readback unavailable' }), { versionId: '1.0', eTag: 'put-etag' }],
  ['identity mismatch', () => response(200, { id: 'other-item', publication: { versionId: '9.0' } }), { versionId: '1.0', eTag: 'put-etag' }],
])('final item keeps its PUT publication version when readback has a %s', async (_label, readback, expected) => {
  const content = LARGE_CONTENT;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
    if (String(url) === 'https://up.example/session') {
      const isLast = init.headers['Content-Range'].includes(`-${content.length - 1}/${content.length}`);
      return isLast ? response(201, { id: 'item-9', name: 'a.pdf', size: content.length, eTag: 'put-etag', publication: { versionId: '1.0' } }) : response(202, {});
    }
    if (String(url).includes('/items/item-9')) return readback();
    throw new Error(`unexpected ${url}`);
  });

  await expect(GraphService.uploadFileLarge(
    'akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB },
  )).resolves.toMatchObject(expected);
  expect(calls.filter(({ url }) => url.includes('/items/item-9'))).toHaveLength(1);
});

test('malformed or transport-failed final readback remains an error after the chunked PUT commits', async () => {
  const content = Buffer.alloc(61 * MiB, 7);
  const run = async (readback) => {
    global.fetch = jest.fn(async (url, init = {}) => {
      if (String(url).includes('createUploadSession')) return response(200, { uploadUrl: 'https://up.example/session' });
      if (String(url) === 'https://up.example/session') {
        const isLast = init.headers['Content-Range'].includes(`-${content.length - 1}/${content.length}`);
        return isLast ? response(201, { id: 'item-9', name: 'a.pdf', size: content.length, publication: { versionId: '1.0' } }) : response(202, {});
      }
      if (String(url).includes('/items/item-9')) return readback();
      throw new Error(`unexpected ${url}`);
    });
    return GraphService.uploadFileLarge('akoya_request', 'F', 'a.pdf', content, 'application/pdf', { chunkBytes: 20 * MiB });
  };

  await expect(run(() => ({ ok: true, status: 200, json: jest.fn(async () => { throw new Error('bad readback JSON'); }), text: jest.fn(async () => ''), headers: { get: jest.fn(() => null) } })))
    .rejects.toThrow('bad readback JSON');
  await expect(run(() => Promise.reject(new Error('readback socket reset'))))
    .rejects.toMatchObject({ serviceName: 'graph', noResponse: true });
});
