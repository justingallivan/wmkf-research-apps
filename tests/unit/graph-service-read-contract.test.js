/** @jest-environment node */

import { GraphService } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(() => null) },
  };
}

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error('unexpected network in read-contract fixture'); });
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});

test.each([
  ['/leading', 'must not start'],
  ['folder/../escape', 'traversal'],
  ['folder/%2E%2E/escape', 'traversal'],
  ['folder/%ZZ', 'malformed URI'],
])('listFiles rejects unsafe folder path %s', async (folderPath, message) => {
  await expect(GraphService.listFiles('akoya_request', folderPath)).rejects.toThrow(message);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('listFiles encodes segments and preserves files-first depth-first traversal, caps, and depth', async () => {
  global.fetch = jest.fn(async url => {
    if (String(url).includes('/root:/Top%20Folder:/children')) {
      return response(200, { value: [
        { name: 'root.docx', id: 'root', size: 1, webUrl: 'u', file: { mimeType: 'text/plain' } },
        { name: 'Nested Folder', id: 'folder', folder: {} },
      ] });
    }
    if (String(url).includes('/root:/Top%20Folder/Nested%20Folder:/children')) {
      return response(200, { value: [
        { name: 'nested.docx', id: 'nested', size: 2, webUrl: 'u2', file: { mimeType: 'application/pdf' } },
      ] });
    }
    throw new Error(`unexpected URL ${url}`);
  });
  await expect(GraphService.listFiles('akoya_request', 'Top Folder', { recursive: true, maxDepth: 1 }))
    .resolves.toEqual([
      { name: 'root.docx', size: 1, lastModified: undefined, mimeType: 'text/plain', webUrl: 'u', id: 'root', folder: 'Top Folder' },
      { name: 'nested.docx', size: 2, lastModified: undefined, mimeType: 'application/pdf', webUrl: 'u2', id: 'nested', folder: 'Top Folder/Nested Folder' },
    ]);
  global.fetch.mockClear();
  global.fetch.mockImplementation(async url => response(200, { value: [
    { name: 'root.docx', id: 'root', file: { mimeType: 'text/plain' } },
    { name: 'Nested Folder', folder: {} },
  ] }));
  await expect(GraphService.listFiles('akoya_request', 'Top Folder', { recursive: true, maxFiles: 1 }))
    .resolves.toHaveLength(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('listFiles enforces the total walk deadline before the first request', async () => {
  await expect(GraphService.listFiles('akoya_request', 'Folder', { totalTimeoutMs: -1 }))
    .rejects.toThrow('exceeded -1ms walk timeout');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('empty paths preserve each read method\'s root behavior and listing follows governed pagination', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      value: [{ name: 'root.txt', id: 'root', file: { mimeType: 'text/plain' } }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/root:/:/children?$skiptoken=next',
    }))
    .mockResolvedValueOnce(response(200, {
      value: [{ name: 'second.txt', id: 'second', file: { mimeType: 'text/plain' } }],
    }));
  await expect(GraphService.listFiles('akoya_request', '')).resolves.toEqual([
    { name: 'root.txt', size: undefined, lastModified: undefined, mimeType: 'text/plain', webUrl: undefined, id: 'root', folder: '' },
    { name: 'second.txt', size: undefined, lastModified: undefined, mimeType: 'text/plain', webUrl: undefined, id: 'second', folder: '' },
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(2);

  global.fetch = jest.fn().mockResolvedValue(response(404));
  await expect(GraphService.getFileMetadataByPath('akoya_request', '', 'root.txt', { siteId: 'site', driveId: 'drive' }))
    .resolves.toBeNull();
  expect(global.fetch.mock.calls[0][0]).toContain('/root:/root.txt');

  global.fetch = jest.fn(() => { throw new Error('empty ensure path must not fetch'); });
  await expect(GraphService.ensureFolderPath('akoya_request', '', { siteId: 'site', driveId: 'drive' }))
    .resolves.toMatchObject({ siteId: 'site', driveId: 'drive', id: 'root', path: '' });
});

test('listFiles propagates a response-body rejection instead of treating it as an empty folder', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockRejectedValue(new Error('malformed listing body')),
    text: jest.fn(),
    headers: { get: jest.fn(() => null) },
  });
  await expect(GraphService.listFiles('akoya_request', 'Folder')).rejects.toThrow('malformed listing body');
});

test('path metadata uses the cTag fallback while stable identity metadata uses publication only', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      id: 'path-item', name: 'doc.docx', size: 2, webUrl: 'u', cTag: '"c:1"', file: { mimeType: 'text/plain' },
    }))
    .mockResolvedValueOnce(response(200, {
      id: 'stable-item', name: 'doc.docx', size: 2, webUrl: 'u', cTag: '"c:2"', file: { mimeType: 'text/plain' },
    }));
  await expect(GraphService.getFileMetadataByPath('akoya_request', 'Folder', 'doc.docx', { siteId: 'site', driveId: 'drive' }))
    .resolves.toMatchObject({ id: 'path-item', versionId: '"c:1"' });
  await expect(GraphService.getFileMetadataById('drive', 'stable-item', { siteId: 'site' }))
    .resolves.toMatchObject({ id: 'stable-item', versionId: null });
});

test('metadata 404 is null while non-404 errors and identity mismatches remain failures', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(404))
    .mockResolvedValueOnce(response(503, { error: 'down' }))
    .mockResolvedValueOnce(response(200, { id: 'wrong', file: { mimeType: 'text/plain' } }));
  await expect(GraphService.getFileMetadataByPath('akoya_request', 'Folder', 'doc.docx', { siteId: 'site', driveId: 'drive' })).resolves.toBeNull();
  await expect(GraphService.getFileMetadataByPath('akoya_request', 'Folder', 'doc.docx', { siteId: 'site', driveId: 'drive' })).rejects.toMatchObject({ status: 503 });
  await expect(GraphService.getFileMetadataById('drive', 'expected')).rejects.toMatchObject({ code: 'graph_file_identity_mismatch' });
});
