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

beforeEach(() => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

test.each(['fail', 'replace', 'rename'])('simple upload preserves the %s conflict mode and publication version without a readback', async (conflictBehavior) => {
  const item = {
    id: `item-${conflictBehavior}`,
    name: 'document.docx',
    size: 4,
    webUrl: 'https://sharepoint.test/document.docx',
    eTag: 'etag',
    publication: { versionId: '4.0' },
    lastModifiedDateTime: '2026-09-19T01:00:00Z',
  };
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/content?@microsoft.graph.conflictBehavior=')) return response(201, item);
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.uploadFile(
    'akoya_request',
    'Folder/Review Files',
    'document.docx',
    Buffer.from('bytes'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { conflictBehavior },
  )).resolves.toMatchObject({ id: item.id, versionId: '4.0', eTag: 'etag' });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain(`conflictBehavior=${conflictBehavior}`);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({
    method: 'PUT',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    body: Buffer.from('bytes'),
  });
});

test('simple upload defaults to replace and rejects an unknown conflict mode before network', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(201, {
    id: 'item-default', name: 'document.txt', size: 4, webUrl: 'https://sharepoint.test/document.txt',
    publication: { versionId: '1.0' },
  }));
  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'document.txt', Buffer.from('bytes'), 'text/plain'))
    .resolves.toMatchObject({ id: 'item-default', versionId: '1.0' });
  expect(global.fetch.mock.calls[0][0]).toContain('conflictBehavior=replace');
  global.fetch.mockClear();
  await expect(GraphService.uploadFile(
    'akoya_request', 'Folder', 'document.txt', Buffer.from('bytes'), 'text/plain', { conflictBehavior: 'merge' },
  )).rejects.toThrow('conflictBehavior must be');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('simple upload reads stable publication metadata only when the PUT has no publication version', async () => {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === 'PUT') return response(201, {
      id: 'item-1', name: 'document.pdf', size: 4, webUrl: 'https://sharepoint.test/document.pdf',
      eTag: 'put-etag', cTag: 'ctag', lastModifiedDateTime: 'put-time',
    });
    if (String(url).includes('/items/item-1')) return response(200, {
      id: 'item-1', size: 5, eTag: 'stable-etag', lastModifiedDateTime: 'stable-time',
      publication: { versionId: '7.0' },
    });
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.uploadFile(
    'akoya_request', 'Folder', 'document.pdf', Buffer.from('bytes'), 'application/pdf',
  )).resolves.toMatchObject({
    id: 'item-1', size: 5, eTag: 'stable-etag', versionId: '7.0', lastModified: 'stable-time',
  });
  expect(calls).toHaveLength(2);
  expect(calls[1].init.headers.Authorization).toBe('Bearer token');
});

test.each([
  ['HTTP failure', () => response(503, { error: 'readback unavailable' }), { versionId: null, eTag: 'put-etag', size: 4 }],
  ['identity mismatch', () => response(200, { id: 'other-item', size: 99, publication: { versionId: '9.0' } }), { versionId: null, eTag: 'put-etag', size: 4 }],
])('successful simple PUT keeps its receipt when readback has a %s', async (_label, readback, expected) => {
  let call = 0;
  global.fetch = jest.fn(async (url, init = {}) => {
    call += 1;
    if (init.method === 'PUT') return response(201, {
      id: 'item-1', name: 'document.pdf', size: 4, webUrl: 'https://sharepoint.test/document.pdf',
      eTag: 'put-etag', lastModifiedDateTime: 'put-time',
    });
    if (call === 2 && String(url).includes('/items/item-1')) return readback();
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'document.pdf', Buffer.from('bytes')))
    .resolves.toMatchObject(expected);
});

test.each([
  ['transport failure', () => Promise.reject(new Error('readback socket reset')), { noResponse: true }],
  ['malformed JSON', () => Promise.resolve({ ok: true, status: 200, json: jest.fn(async () => { throw new Error('bad JSON'); }), text: jest.fn(async () => ''), headers: { get: jest.fn(() => null) } }), { message: 'bad JSON' }],
])('successful simple PUT surfaces a readback %s because it is not a publication conflict', async (_label, readback, expected) => {
  global.fetch = jest.fn(async (url, init = {}) => {
    if (init.method === 'PUT') return response(201, {
      id: 'item-1', name: 'document.pdf', size: 4, webUrl: 'https://sharepoint.test/document.pdf',
      eTag: 'put-etag', lastModifiedDateTime: 'put-time',
    });
    if (String(url).includes('/items/item-1')) {
      const result = await readback();
      if (result && result.noResponse) throw result;
      return result;
    }
    throw new Error(`unexpected network request: ${url}`);
  });

  if (_label === 'transport failure') {
    await expect(GraphService.uploadFile('akoya_request', 'Folder', 'document.pdf', Buffer.from('bytes')))
      .rejects.toMatchObject({ serviceName: 'graph', noResponse: true });
  } else {
    await expect(GraphService.uploadFile('akoya_request', 'Folder', 'document.pdf', Buffer.from('bytes')))
      .rejects.toMatchObject(expected);
  }
});

test('upload validates buffer, filename, size, and pinned site/drive identity before network', async () => {
  global.fetch = jest.fn();

  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'doc.pdf', 'bytes')).rejects.toThrow('content must be a Buffer');
  await expect(GraphService.uploadFile('akoya_request', 'Folder', '', Buffer.from('bytes'))).rejects.toThrow('filename required');
  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'doc.pdf', Buffer.alloc(60 * 1024 * 1024 + 1))).rejects.toThrow('exceeds simple-upload limit');
  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'doc.pdf', Buffer.from('bytes'), undefined, { siteId: 'site-only' })).rejects.toThrow('supplied together');
  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'doc.pdf', Buffer.from('bytes'), undefined, { driveId: 'drive-only' })).rejects.toThrow('supplied together');

  expect(GraphService.getSiteId).not.toHaveBeenCalled();
  expect(GraphService.getDriveId).not.toHaveBeenCalled();
  expect(GraphService.getAccessToken).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('stable replacement sends exactly If-Match and preserves cTag only as its legacy fallback version', async () => {
  global.fetch = jest.fn(async (url, init = {}) => {
    if (init.method === 'PUT') return response(200, {
      id: 'item/id', name: 'review.docx', size: 9, webUrl: 'https://sharepoint.test/review',
      eTag: 'new-etag', cTag: 'legacy-ctag', lastModifiedDateTime: '2026-09-19T01:00:00Z',
    });
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.replaceFileContent(
    'drive/id', 'item/id', Buffer.from('new-bytes'), 'application/pdf', { siteId: 'site/id', ifMatch: 'old-etag' },
  )).resolves.toMatchObject({ siteId: 'site/id', versionId: 'legacy-ctag' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({
    method: 'PUT',
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/pdf',
      'If-Match': 'old-etag',
    },
  });
  expect(global.fetch.mock.calls[0][1].headers['conflictBehavior']).toBeUndefined();
});

test('replacement surfaces a 412 once and does not retry the write', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(412, { error: { message: 'etag mismatch' } }));

  await expect(GraphService.replaceFileContent(
    'drive', 'item', Buffer.from('new'), 'application/octet-stream', { ifMatch: 'stale-etag' },
  )).rejects.toMatchObject({ serviceName: 'graph', status: 412, isTransient: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([204, 404])('delete treats %s as an idempotent success', async (status) => {
  global.fetch = jest.fn().mockResolvedValue(response(status));
  await expect(GraphService.deleteFile('drive/id', 'item/id')).resolves.toBeUndefined();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('delete surfaces other HTTP failures without retrying', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(500, { error: 'delete failed' }));
  await expect(GraphService.deleteFile('drive', 'item')).rejects.toThrow('SharePoint delete failed (500)');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
