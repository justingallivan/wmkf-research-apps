/** @jest-environment node */
import { ReadableStream } from 'node:stream/web';
import { GraphService } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;
const metadata = (extra = {}) => ({ ok: true, status: 200,
  json: async () => ({ name: 'transcript.json', size: 1, ...extra }) });
function body(chunks, contentLength = null) {
  const cancel = jest.fn();
  const stream = new ReadableStream({
    start(controller) { for (const value of chunks) controller.enqueue(Buffer.from(value)); },
    cancel,
  });
  return { ok: true, status: 200, headers: { get: () => contentLength }, body: stream, cancel };
}
beforeEach(() => jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('synthetic-token'));
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

test.each(['presigned', 'redirect', 'direct'])('caps actual streamed bytes on %s path despite small metadata', async path => {
  const content = body(['123', '456']);
  global.fetch = jest.fn().mockResolvedValueOnce(metadata(path === 'presigned'
    ? { '@microsoft.graph.downloadUrl': 'https://cdn.example/test' } : {}));
  if (path === 'redirect') global.fetch.mockResolvedValueOnce({ status: 302, ok: false,
    headers: { get: () => 'https://cdn.example/test' } });
  global.fetch.mockResolvedValueOnce(content);
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 }))
    .rejects.toMatchObject({ code: 'graph_download_size_limit' });
  expect(content.cancel).toHaveBeenCalledTimes(1);
});

test('rejects an oversized header before reading and cancels the body', async () => {
  const content = body(['1'], '100');
  global.fetch = jest.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(content);
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 }))
    .rejects.toMatchObject({ code: 'graph_download_size_limit' });
  expect(content.cancel).toHaveBeenCalledTimes(1);
});

test('rejects oversized metadata before requesting content', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(metadata({ size: 6 }));
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 }))
    .rejects.toMatchObject({ code: 'graph_download_size_limit' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('does not fall back to an unbounded buffer when no stream is available', async () => {
  const content = { ok: true, status: 200, arrayBuffer: jest.fn(), headers: { get: () => null } };
  global.fetch = jest.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(content);
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 }))
    .rejects.toThrow('requires a readable body');
  expect(content.arrayBuffer).not.toHaveBeenCalled();
});

test('propagates a stream failure without returning partial bytes', async () => {
  const content = { ok: true, status: 200, headers: { get: () => null },
    body: new ReadableStream({ start(controller) { controller.error(new Error('synthetic read failure')); } }) };
  global.fetch = jest.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(content);
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 })).rejects.toThrow('synthetic read failure');
});

test('accepts exactly the limit without changing the download result shape', async () => {
  const content = { ok: true, status: 200, headers: { get: () => null },
    body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('12345')); controller.close(); } }) };
  global.fetch = jest.fn().mockResolvedValueOnce(metadata({ size: 5 })).mockResolvedValueOnce(content);
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes: 5 })).resolves.toEqual({
    buffer: Buffer.from('12345'), size: 5, filename: 'transcript.json', mimeType: 'application/octet-stream',
  });
});

test.each([0, -1, 1.5, '5', Infinity])('rejects invalid cap %s before auth or network', async maxBytes => {
  global.fetch = jest.fn();
  await expect(GraphService.downloadFile('drive', 'item', { maxBytes })).rejects.toThrow(TypeError);
  expect(GraphService.getAccessToken).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
