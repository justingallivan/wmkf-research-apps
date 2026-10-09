/** @jest-environment node */
import { GraphService } from '../../lib/services/graph-service.js';

const realFetch = global.fetch;
const URL_ = 'https://up.example/session?tempauth=secret';
function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body), text: jest.fn(async () => JSON.stringify(body)), headers: { get: jest.fn(() => null) } };
}
afterEach(() => { jest.restoreAllMocks(); global.fetch = realFetch; });

test('PUTs one range unauthenticated and returns the next ranges on 202', async () => {
  global.fetch = jest.fn(async () => response(202, { expirationDateTime: '2026-10-09T00:00:00Z', nextExpectedRanges: ['5-'] }));
  const bytes = Buffer.from('hello');
  await expect(GraphService.putUploadSessionChunk(URL_, { start: 0, bytes, total: 20 })).resolves.toEqual({
    status: 202, nextExpectedRanges: ['5-'], expirationDateTime: '2026-10-09T00:00:00Z', item: null,
  });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe(URL_);
  expect(init.method).toBe('PUT');
  expect(init.headers).toEqual({ 'Content-Length': '5', 'Content-Range': 'bytes 0-4/20' });
  expect(init.body).toBe(bytes);
});

test.each([200, 201])('returns the committed item on %i', async (status) => {
  const item = { id: 'item-1', size: 5, file: {} };
  global.fetch = jest.fn(async () => response(status, item));
  const result = await GraphService.putUploadSessionChunk(URL_, { start: 15, bytes: Buffer.from('hello'), total: 20 });
  expect(result).toMatchObject({ status, item, nextExpectedRanges: [] });
  expect(global.fetch.mock.calls[0][1].headers['Content-Range']).toBe('bytes 15-19/20');
});

test('a failed PUT throws the service error and never cancels the session', async () => {
  global.fetch = jest.fn(async () => response(500, { error: 'boom' }));
  await expect(GraphService.putUploadSessionChunk(URL_, { start: 0, bytes: Buffer.from('hello'), total: 20 }))
    .rejects.toMatchObject({ serviceName: 'graph', status: 500 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

test('a network failure never cancels the session either', async () => {
  global.fetch = jest.fn(async () => { throw new Error('socket hang up'); });
  await expect(GraphService.putUploadSessionChunk(URL_, { start: 0, bytes: Buffer.from('hello'), total: 20 }))
    .rejects.toMatchObject({ noResponse: true });
  expect(global.fetch.mock.calls.every(([, init]) => init?.method === 'PUT')).toBe(true);
});

test('refuses bad arguments and unsafe URLs before any request', async () => {
  global.fetch = jest.fn();
  const bytes = Buffer.from('hello');
  for (const bad of [{ start: 0, bytes: 'hello', total: 20 }, { start: -1, bytes, total: 20 }, { start: 16, bytes, total: 20 }, { start: 0, bytes: Buffer.alloc(0), total: 20 }, {}]) {
    await expect(GraphService.putUploadSessionChunk(URL_, bad)).rejects.toThrow('putUploadSessionChunk');
  }
  await expect(GraphService.putUploadSessionChunk('http://up.example/s', { start: 0, bytes, total: 20 })).rejects.toThrow('unsafe upload URL');
  expect(global.fetch).not.toHaveBeenCalled();
});
