/** @jest-environment node */

import { GraphService } from '../../lib/services/graph-service';

const originalFetch = global.fetch;

function response(status, body = {}, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => bytes.toString('utf8')),
    arrayBuffer: jest.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    headers: { get: jest.fn((name) => headers[String(name).toLowerCase()] || null) },
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('graph-token');
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site-1');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive-1');
});

afterEach(() => {
  jest.restoreAllMocks();
  GraphService.clearCaches();
  global.fetch = originalFetch;
});

test('creates, reads, and cancels a browser-direct upload session without proxying bytes', async () => {
  global.fetch
    .mockResolvedValueOnce(response(200, {
      uploadUrl: 'https://upload.example/session-secret',
      expirationDateTime: '2026-09-22T13:00:00Z',
      nextExpectedRanges: ['0-'],
    }))
    .mockResolvedValueOnce(response(200, {
      expirationDateTime: '2026-09-22T13:00:00Z',
      nextExpectedRanges: ['10485760-'],
    }))
    .mockResolvedValueOnce(response(204));

  await expect(GraphService.createBrowserUploadSession(
    'akoya_request', 'Requests/Proof folder', 'proof.mp4', { conflictBehavior: 'fail' },
  )).resolves.toMatchObject({
    siteId: 'site-1', driveId: 'drive-1', uploadUrl: 'https://upload.example/session-secret',
  });
  expect(global.fetch.mock.calls[0][0]).toContain('/root:/Requests/Proof%20folder/proof.mp4:/createUploadSession');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer graph-token');
  expect(global.fetch.mock.calls[0][1].body).toContain('"@microsoft.graph.conflictBehavior":"fail"');

  await expect(GraphService.getBrowserUploadSessionStatus('https://upload.example/session-secret'))
    .resolves.toMatchObject({ nextExpectedRanges: ['10485760-'] });
  expect(global.fetch.mock.calls[1][1].headers).toBeUndefined();

  await expect(GraphService.cancelBrowserUploadSession('https://upload.example/session-secret'))
    .resolves.toEqual({ outcome: 'cancelled', status: 204 });
  expect(global.fetch.mock.calls[2][1].method).toBe('DELETE');
  expect(global.fetch.mock.calls[2][1].headers).toBeUndefined();
});

test.each([
  [404, 'gone'],
  [410, 'expired'],
])('upload-session cancellation preserves Microsoft %s as %s', async (status, outcome) => {
  global.fetch.mockResolvedValueOnce(response(status));
  await expect(GraphService.cancelBrowserUploadSession('https://upload.example/session-secret'))
    .resolves.toEqual({ outcome, status });
});

test('resolves one-shot media and reads only the requested signature range', async () => {
  const metadata = {
    id: 'item-1',
    name: 'proof.mp4',
    size: 80_000_000,
    file: { mimeType: 'video/mp4' },
    '@microsoft.graph.downloadUrl': 'https://media.example/one-shot',
  };
  global.fetch
    .mockResolvedValueOnce(response(200, metadata))
    .mockResolvedValueOnce(response(200, metadata))
    .mockResolvedValueOnce(response(206, Buffer.alloc(32), { 'content-range': 'bytes 0-31/80000000' }));

  await expect(GraphService.resolveMediaDownloadUrl('drive-1', 'item-1')).resolves.toMatchObject({
    driveId: 'drive-1', itemId: 'item-1', downloadUrl: 'https://media.example/one-shot', mimeType: 'video/mp4',
  });
  await expect(GraphService.readMediaRange('drive-1', 'item-1', { start: 0, end: 31 })).resolves.toMatchObject({
    itemId: 'item-1', bytes: Buffer.alloc(32), contentRange: 'bytes 0-31/80000000',
  });
  expect(global.fetch.mock.calls[2][0]).toBe('https://media.example/one-shot');
  expect(global.fetch.mock.calls[2][1].headers).toEqual({ Range: 'bytes=0-31' });
});

test('rejects unsafe preauthenticated URLs and any unbounded range response before reading bytes', async () => {
  global.fetch.mockResolvedValueOnce(response(200, {
    uploadUrl: 'http://upload.example/session',
    expirationDateTime: '2026-09-22T13:00:00Z',
  }));
  await expect(GraphService.createBrowserUploadSession('akoya_request', 'Folder', 'proof.mp4'))
    .rejects.toThrow('unsafe upload URL');

  const unbounded = response(200, Buffer.alloc(33));
  global.fetch
    .mockResolvedValueOnce(response(200, {
      id: 'item-1', name: 'proof.mp4', size: 80_000_000, file: { mimeType: 'video/mp4' },
      '@microsoft.graph.downloadUrl': 'https://media.example/one-shot',
    }))
    .mockResolvedValueOnce(unbounded);
  await expect(GraphService.readMediaRange('drive-1', 'item-1', { start: 0, end: 31 }))
    .rejects.toThrow('was not bounded');
  expect(unbounded.arrayBuffer).not.toHaveBeenCalled();
});
