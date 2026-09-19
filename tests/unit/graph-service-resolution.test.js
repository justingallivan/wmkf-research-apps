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
  delete process.env.SHAREPOINT_SITE_URL;
});

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error('unexpected network in resolution fixture'); });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});

test('site resolution uses the canonical site, caches it, and reset/TTL cause a fresh read', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, { id: 'site-one' }))
    .mockResolvedValueOnce(response(200, { id: 'site-two' }))
    .mockResolvedValueOnce(response(200, { id: 'site-three' }));
  await expect(GraphService.getSiteId()).resolves.toBe('site-one');
  await expect(GraphService.getSiteId()).resolves.toBe('site-one');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain('/sites/appriver3651007194.sharepoint.com:/sites/akoyaGO');
  jest.useFakeTimers();
  jest.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
  await expect(GraphService.getSiteId()).resolves.toBe('site-two');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  GraphService.clearCaches();
  await expect(GraphService.getSiteId()).resolves.toBe('site-three');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('site URL parsing rejects invalid URLs and hosts before token/fetch work', async () => {
  process.env.SHAREPOINT_SITE_URL = 'not a url';
  await expect(GraphService.getSiteId()).rejects.toMatchObject({ status: 500, isTransient: false });
  expect(GraphService.getAccessToken).not.toHaveBeenCalled();
  process.env.SHAREPOINT_SITE_URL = 'https://evil.example/sites/akoyaGO';
  await expect(GraphService.getSiteId()).rejects.toMatchObject({ status: 400, isTransient: false });
  expect(GraphService.getAccessToken).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('drive allowlist rejects unknown libraries and returns a structured missing-library error', async () => {
  await expect(GraphService.getDriveId('not-a-library')).rejects.toMatchObject({ status: 400 });
  global.fetch = jest.fn().mockResolvedValue(response(200, { value: [] }));
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' }))
    .rejects.toMatchObject({ status: 404, isTransient: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('drive resolution prefers display name then falls back to decoded URL slug', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, { value: [
      { id: 'slug-id', name: 'Friendly', webUrl: 'https://tenant/akoya_request' },
      { id: 'display-id', name: 'akoya_request', webUrl: 'https://tenant/other' },
    ] }))
    .mockResolvedValueOnce(response(200, { value: [
      { id: 'encoded-id', name: 'Friendly', webUrl: 'https://tenant/akoya%5Frequest' },
    ] }));
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' })).resolves.toBe('display-id');
  GraphService.clearCaches();
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' })).resolves.toBe('encoded-id');
});

test('resolution cache keys preserve caller casing and supplied site bypasses site lookup', async () => {
  const site = jest.spyOn(GraphService, 'getSiteId');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, { value: [{ id: 'upper', name: 'akoya_request', webUrl: 'https://tenant/one' }] }))
    .mockResolvedValueOnce(response(200, { value: [{ id: 'lower', name: 'akoya_request', webUrl: 'https://tenant/two' }] }));
  await expect(GraphService.getDriveId('AKOYA_REQUEST', { siteId: 'site' })).resolves.toBe('upper');
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' })).resolves.toBe('lower');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(site).not.toHaveBeenCalled();
});

test('site resolution preserves the current unfenced late pre-reset cache overwrite', async () => {
  let resolveOld;
  let resolveFresh;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const freshResponse = new Promise(resolve => { resolveFresh = resolve; });
  global.fetch = jest.fn()
    .mockReturnValueOnce(oldResponse)
    .mockReturnValueOnce(freshResponse);
  const old = GraphService.getSiteId();
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  GraphService.clearCaches();
  const fresh = GraphService.getSiteId();
  await Promise.resolve();
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  resolveFresh(response(200, { id: 'fresh-site' }));
  await expect(fresh).resolves.toBe('fresh-site');
  await expect(GraphService.getSiteId()).resolves.toBe('fresh-site');
  resolveOld(response(200, { id: 'stale-site' }));
  await expect(old).resolves.toBe('stale-site');
  // Unlike token generation fencing, resolution currently allows this overwrite.
  await expect(GraphService.getSiteId()).resolves.toBe('stale-site');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('drive resolution preserves the current unfenced late pre-reset cache overwrite', async () => {
  let resolveOld;
  let resolveFresh;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const freshResponse = new Promise(resolve => { resolveFresh = resolve; });
  global.fetch = jest.fn().mockReturnValueOnce(oldResponse).mockReturnValueOnce(freshResponse);
  const old = GraphService.getDriveId('akoya_request', { siteId: 'site' });
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  GraphService.clearCaches();
  const fresh = GraphService.getDriveId('akoya_request', { siteId: 'site' });
  await Promise.resolve();
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  resolveFresh(response(200, { value: [{ id: 'fresh-drive', name: 'akoya_request' }] }));
  await expect(fresh).resolves.toBe('fresh-drive');
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' })).resolves.toBe('fresh-drive');
  resolveOld(response(200, { value: [{ id: 'stale-drive', name: 'akoya_request' }] }));
  await expect(old).resolves.toBe('stale-drive');
  await expect(GraphService.getDriveId('akoya_request', { siteId: 'site' })).resolves.toBe('stale-drive');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
