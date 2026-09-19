/** @jest-environment node */

import { GraphService } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;

function response(status, body = {}, extra = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(() => null), ...(extra.headers || {}) },
    ...extra,
  };
}

function binaryResponse(status, bytes, extra = {}) {
  return {
    ...response(status, {}, extra),
    arrayBuffer: jest.fn(async () => bytes),
  };
}

beforeEach(() => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('graph-token');
});

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

test('uses the presigned download URL and returns the current-file object shape without CDN auth', async () => {
  const bytes = Buffer.from('proposal bytes');
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/items/item-1') && !String(url).endsWith('/content')) {
      return response(200, {
        name: 'proposal.docx',
        size: bytes.length,
        file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        '@microsoft.graph.downloadUrl': 'https://cdn.example/proposal?sig=abc',
      });
    }
    if (String(url).startsWith('https://cdn.example/')) return binaryResponse(200, bytes);
    throw new Error(`unexpected network request: ${url}`);
  });

  const result = await GraphService.downloadFile('drive-1', 'item-1');

  expect(result).toEqual({
    buffer: bytes,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: 'proposal.docx',
    size: bytes.length,
  });
  expect(Buffer.isBuffer(result.buffer)).toBe(true);
  expect(calls[0].init.headers.Authorization).toBe('Bearer graph-token');
  expect(calls[1].init).toMatchObject({ redirect: 'follow' });
  expect(calls[1].init.headers).toBeUndefined();
});

test('falls back from a non-ok presigned response to a manual Graph redirect without forwarding auth to the CDN', async () => {
  const bytes = Buffer.from('fallback bytes');
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return response(200, {
        name: 'fallback.pdf',
        size: bytes.length,
        file: { mimeType: 'application/pdf' },
        '@microsoft.graph.downloadUrl': 'https://cdn.example/expired',
      });
    }
    if (calls.length === 2) return binaryResponse(403, Buffer.from('expired'));
    if (String(url).endsWith('/content')) {
      return response(302, {}, {
        headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://cdn.example/fresh' : null },
      });
    }
    if (String(url) === 'https://cdn.example/fresh') return binaryResponse(200, bytes);
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.downloadFile('drive-1', 'item-1')).resolves.toEqual({
    buffer: bytes,
    mimeType: 'application/pdf',
    filename: 'fallback.pdf',
    size: bytes.length,
  });
  expect(calls[2].init).toMatchObject({ redirect: 'manual' });
  expect(calls[2].init.headers.Authorization).toBe('Bearer graph-token');
  expect(calls[3].init).toMatchObject({ redirect: 'follow' });
  expect(calls[3].init.headers).toBeUndefined();
});

test('current-file manual fallback reports missing Location and CDN HTTP failures', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      name: 'missing-location.pdf', size: 1, file: { mimeType: 'application/pdf' },
      '@microsoft.graph.downloadUrl': 'https://cdn.example/expired',
    }))
    .mockResolvedValueOnce(response(403, {}))
    .mockResolvedValueOnce(response(302));
  await expect(GraphService.downloadFile('drive', 'item'))
    .rejects.toThrow('Redirect from /content had no Location header (302)');

  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      name: 'cdn-error.pdf', size: 1, file: { mimeType: 'application/pdf' },
      '@microsoft.graph.downloadUrl': 'https://cdn.example/expired',
    }))
    .mockResolvedValueOnce(response(403, {}))
    .mockResolvedValueOnce(response(302, {}, {
      headers: { get: name => name.toLowerCase() === 'location' ? 'https://cdn.example/fresh' : null },
    }))
    .mockResolvedValueOnce(response(502, { error: 'cdn unavailable' }));
  await expect(GraphService.downloadFile('drive', 'item'))
    .rejects.toThrow('Failed to download file from CDN (502)');
  expect(global.fetch.mock.calls[3][1].headers).toBeUndefined();
});

test('does not fall back after a presigned request has a network failure', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      name: 'proposal.docx',
      size: 1,
      file: { mimeType: 'application/octet-stream' },
      '@microsoft.graph.downloadUrl': 'https://cdn.example/broken',
    }))
    .mockRejectedValueOnce(new Error('cdn socket reset'));

  await expect(GraphService.downloadFile('drive', 'item')).rejects.toMatchObject({
    serviceName: 'graph',
    noResponse: true,
    isTransient: true,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test.each([301, 302])('follows a %s version redirect and returns raw Buffer bytes', async (status) => {
  const bytes = Buffer.from(`version-${status}`);
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return response(status, {}, {
        headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://cdn.example/version' : null },
      });
    }
    if (String(url) === 'https://cdn.example/version') return binaryResponse(200, bytes);
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.downloadFileVersion('drive/id', 'item/id', '2.0')).resolves.toEqual(bytes);
  expect(calls[0].init.headers.Authorization).toBe('Bearer graph-token');
  expect(calls[1].init).toMatchObject({ redirect: 'follow' });
  expect(calls[1].init.headers).toBeUndefined();
});

test('returns a Buffer for direct PDF bytes and preserves the PDF failure error shape', async () => {
  const bytes = Buffer.from('%PDF-test');
  global.fetch = jest.fn().mockResolvedValueOnce(binaryResponse(200, bytes));

  const result = await GraphService.downloadFileAsPdf('drive/id', 'item/id');
  expect(result).toEqual(bytes);
  expect(Buffer.isBuffer(result)).toBe(true);
  expect(global.fetch.mock.calls[0][0]).toContain('/content?format=pdf');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer graph-token');

  global.fetch = jest.fn().mockResolvedValueOnce(response(500, { error: 'conversion failed' }));
  await expect(GraphService.downloadFileAsPdf('drive', 'item')).rejects.toMatchObject({
    serviceName: 'graph',
    status: 500,
    isTransient: true,
  });
});

test('distinguishes a missing redirect location from a CDN HTTP failure', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response(302));
  await expect(GraphService.downloadFileVersion('drive', 'item', '1.0'))
    .rejects.toThrow('Graph file version redirect had no Location header (302)');

  global.fetch = jest.fn().mockResolvedValueOnce(response(302, {}, {
    headers: { get: (name) => name.toLowerCase() === 'location' ? 'https://cdn.example/version' : null },
  })).mockResolvedValueOnce(response(404, { error: 'gone' }));
  await expect(GraphService.downloadFileVersion('drive', 'item', '1.0'))
    .rejects.toThrow('Graph file version download failed (404)');
});

test('path downloads resolve an item and delegate the bytes to the facade download method', async () => {
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive/id');
  const download = jest.spyOn(GraphService, 'downloadFile').mockResolvedValue({
    buffer: Buffer.from('delegated'),
    mimeType: 'text/plain',
    filename: 'nested file.txt',
    size: 9,
  });
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/root:/Folder/nested%20folder/nested%20file.txt')) {
      return response(200, { id: 'item/id', name: 'nested file.txt', file: {} });
    }
    throw new Error(`unexpected network request: ${url}`);
  });

  await expect(GraphService.downloadFileByPath(
    'akoya_request',
    'Folder/nested folder',
    'nested file.txt',
  )).resolves.toMatchObject({ filename: 'nested file.txt' });
  expect(download).toHaveBeenCalledWith('drive/id', 'item/id');
});

test('current-file downloads preserve filename and size while defaulting a missing MIME type', async () => {
  const bytes = Buffer.from('default mime');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      name: 'unknown.bin',
      size: bytes.length,
    }))
    .mockResolvedValueOnce(binaryResponse(200, bytes));

  await expect(GraphService.downloadFile('drive', 'item')).resolves.toEqual({
    buffer: bytes,
    mimeType: 'application/octet-stream',
    filename: 'unknown.bin',
    size: bytes.length,
  });
});
