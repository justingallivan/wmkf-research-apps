/** @jest-environment node */

import { GraphService } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;
const ENV_KEYS = ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(() => null) },
  };
}

function setCredentials(suffix = '') {
  process.env.DYNAMICS_TENANT_ID = `tenant-${suffix}`;
  process.env.DYNAMICS_CLIENT_ID = `client-${suffix}`;
  process.env.DYNAMICS_CLIENT_SECRET = `secret-${suffix}`;
}

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) delete process.env[key];
});

test('cold and warm token acquisition deduplicates and emits the Graph scope at call time', async () => {
  setCredentials('cold');
  global.fetch = jest.fn().mockResolvedValue(response(200, { access_token: 'token-1', expires_in: 3600 }));
  await expect(GraphService.getAccessToken()).resolves.toBe('token-1');
  await expect(GraphService.getAccessToken()).resolves.toBe('token-1');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const body = global.fetch.mock.calls[0][1].body;
  expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
});

test('concurrent callers share the request while retaining independent deadlines', async () => {
  setCredentials('shared');
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  global.fetch = jest.fn().mockReturnValue(pending);
  jest.useFakeTimers();
  const short = GraphService.getAccessToken({ timeoutMs: 10 });
  const long = GraphService.getAccessToken({ timeoutMs: 100 });
  const shortRejection = expect(short).rejects.toMatchObject({ noResponse: true, isTransient: true });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(10);
  await shortRejection;
  resolve(response(200, { access_token: 'shared-token', expires_in: 3600 }));
  await expect(long).resolves.toBe('shared-token');
});

test('a rejected shared request clears the promise so the next request can retry', async () => {
  setCredentials('retry');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(503, { error: 'temporary' }))
    .mockResolvedValueOnce(response(200, { access_token: 'retry-token', expires_in: 3600 }));
  await expect(GraphService.getAccessToken()).rejects.toMatchObject({ status: 503 });
  await expect(GraphService.getAccessToken()).resolves.toBe('retry-token');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('old success after reset cannot populate or clear the newer pending cache', async () => {
  setCredentials('race');
  let resolveOld;
  let resolveNew;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const newResponse = new Promise(resolve => { resolveNew = resolve; });
  global.fetch = jest.fn()
    .mockReturnValueOnce(oldResponse)
    .mockReturnValueOnce(newResponse);
  const old = GraphService.getAccessToken();
  GraphService.clearCaches();
  const newer = GraphService.getAccessToken();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  resolveOld(response(200, { access_token: 'old-token', expires_in: 3600 }));
  await expect(old).resolves.toBe('old-token');
  jest.useFakeTimers();
  const probe = GraphService.getAccessToken({ timeoutMs: 10 });
  const probeRejection = expect(probe).rejects.toMatchObject({ noResponse: true, isTransient: true });
  await jest.advanceTimersByTimeAsync(10);
  await probeRejection;
  expect(global.fetch).toHaveBeenCalledTimes(2);
  resolveNew(response(200, { access_token: 'new-token', expires_in: 3600 }));
  await expect(newer).resolves.toBe('new-token');
  await expect(GraphService.getAccessToken()).resolves.toBe('new-token');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('old rejection after reset cannot clear the newer pending promise', async () => {
  setCredentials('reject-race');
  let rejectOld;
  let resolveNew;
  const oldResponse = new Promise((_resolve, reject) => { rejectOld = reject; });
  const newResponse = new Promise(resolve => { resolveNew = resolve; });
  global.fetch = jest.fn().mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse);
  const old = GraphService.getAccessToken();
  GraphService.clearCaches();
  const newer = GraphService.getAccessToken();
  rejectOld(new Error('old request failed'));
  await expect(old).rejects.toThrow('old request failed');
  jest.useFakeTimers();
  const probe = GraphService.getAccessToken({ timeoutMs: 10 });
  const probeRejection = expect(probe).rejects.toMatchObject({ noResponse: true, isTransient: true });
  await jest.advanceTimersByTimeAsync(10);
  await probeRejection;
  expect(global.fetch).toHaveBeenCalledTimes(2);
  resolveNew(response(200, { access_token: 'new-token', expires_in: 3600 }));
  await expect(newer).resolves.toBe('new-token');
});

test('old success after the newer request is cached cannot replace the newer token', async () => {
  setCredentials('cached-race');
  let resolveOld;
  let resolveNew;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const newResponse = new Promise(resolve => { resolveNew = resolve; });
  global.fetch = jest.fn().mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse);
  const old = GraphService.getAccessToken();
  GraphService.clearCaches();
  const newer = GraphService.getAccessToken();
  resolveNew(response(200, { access_token: 'new-token', expires_in: 3600 }));
  await expect(newer).resolves.toBe('new-token');
  resolveOld(response(200, { access_token: 'old-token', expires_in: 3600 }));
  await expect(old).resolves.toBe('old-token');
  await expect(GraphService.getAccessToken()).resolves.toBe('new-token');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('credentials and token endpoint are read for each cold request', async () => {
  setCredentials('first');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, { access_token: 'first-token', expires_in: 3600 }))
    .mockResolvedValueOnce(response(200, { access_token: 'second-token', expires_in: 3600 }));
  await expect(GraphService.getAccessToken()).resolves.toBe('first-token');
  GraphService.clearCaches();
  setCredentials('second');
  await expect(GraphService.getAccessToken()).resolves.toBe('second-token');
  expect(global.fetch.mock.calls[0][0]).toContain('/tenant-first/');
  expect(global.fetch.mock.calls[1][0]).toContain('/tenant-second/');
});

test.each([
  ['expired', 0],
  ['exactly at the sixty-second safety window', 60],
])('does not reuse an %s token', async (_label, expiresIn) => {
  setCredentials('expiry');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, { access_token: 'old-token', expires_in: expiresIn }))
    .mockResolvedValueOnce(response(200, { access_token: 'fresh-token', expires_in: 3600 }));
  await expect(GraphService.getAccessToken()).resolves.toBe('old-token');
  await expect(GraphService.getAccessToken()).resolves.toBe('fresh-token');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
