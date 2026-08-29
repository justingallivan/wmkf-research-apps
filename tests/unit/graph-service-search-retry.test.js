/**
 * @jest-environment node
 */

/**
 * GraphService.searchFiles 429 handling (S468).
 *
 * Graph `/search/query` throttles at the tenant level and the Explorer fans
 * several scoped searches out per question, so 429 is the routine failure
 * shape. These cases pin: transient statuses are retried with a
 * Retry-After-aware backoff, non-transient statuses are not, and the final
 * failure still logs once and throws a structured error.
 */

import { GraphService } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn((name) => headers[String(name).toLowerCase()] ?? null) },
  };
}

const SITE = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';
const hit = {
  resource: {
    name: 'Budget.pdf',
    size: 10,
    lastModifiedDateTime: '2026-01-01T00:00:00Z',
    webUrl: `${SITE}/akoya_request/1001_ABC/Budget.pdf`,
  },
  summary: 'budget',
};
const tokenResponse = () => response(200, { access_token: 'tok', expires_in: 3600 });
const searchOk = () => response(200, { value: [{ hitsContainers: [{ hits: [hit], total: 1 }] }] });
const throttled = (retryAfter) => response(
  429,
  { error: { code: '429', details: [{ code: 'TenantRequestThrottled' }] } },
  retryAfter != null ? { 'retry-after': String(retryAfter) } : {},
);

/** Route by URL shape: token endpoint vs search endpoint; search responses are consumed in order. */
function routeFetch(searchResponses) {
  const searchCalls = [];
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('login.microsoftonline.com')) return tokenResponse();
    if (String(url).endsWith('/search/query')) {
      searchCalls.push(init);
      const next = searchResponses.shift();
      if (!next) throw new Error('searchFiles fetched more times than the fixture allows');
      return typeof next === 'function' ? next() : next;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return searchCalls;
}

/** Start the call, then drive fake timers until it settles. */
async function runWithTimers(promise, totalMs = 30_000, stepMs = 100) {
  let settled = false;
  const guarded = promise.then(
    (v) => { settled = true; return v; },
    (e) => { settled = true; throw e; },
  );
  guarded.catch(() => {});
  for (let elapsed = 0; !settled && elapsed <= totalMs; elapsed += stepMs) {
    await jest.advanceTimersByTimeAsync(stepMs);
  }
  return guarded;
}

beforeEach(() => {
  jest.useFakeTimers();
  GraphService.clearCaches();
  process.env.DYNAMICS_TENANT_ID = 'tenant';
  process.env.DYNAMICS_CLIENT_ID = 'client';
  process.env.DYNAMICS_CLIENT_SECRET = 'secret';
  delete process.env.SHAREPOINT_SITE_URL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('GraphService.searchFiles throttle handling', () => {
  test('a 429 followed by success returns results after one retry and logs nothing', async () => {
    const calls = routeFetch([throttled(), searchOk()]);
    const results = await runWithTimers(GraphService.searchFiles('budget'));
    expect(calls).toHaveLength(2);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Budget.pdf', library: 'akoya_request', folder: '1001_ABC' });
    expect(console.error).not.toHaveBeenCalled();
  });

  test('honours Retry-After before the second attempt', async () => {
    const calls = routeFetch([throttled(2), searchOk()]);
    const promise = GraphService.searchFiles('budget');
    promise.catch(() => {});
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_900);
    expect(calls).toHaveLength(1); // still waiting out the 2s Retry-After
    await jest.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(2);
    await expect(promise).resolves.toHaveLength(1);
  });

  test('gives up after three throttles with one log line and a structured transient error', async () => {
    const calls = routeFetch([throttled(), throttled(), throttled()]);
    let caught;
    try {
      await runWithTimers(GraphService.searchFiles('budget'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/^SharePoint search failed \(429\)/);
    expect(caught).toMatchObject({ status: 429, isTransient: true, attempts: 3, serviceName: 'graph' });
    expect(calls).toHaveLength(3);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toContain('searchFiles failed (429) after 3 attempt(s)');
  });

  test('a transient 503 is retried like a 429', async () => {
    const calls = routeFetch([response(503, { error: 'busy' }), searchOk()]);
    await expect(runWithTimers(GraphService.searchFiles('budget'))).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  test('a 400 (bad query) is not retried and is flagged non-transient', async () => {
    const calls = routeFetch([response(400, { error: { code: 'BadRequest' } })]);
    let caught;
    try {
      await runWithTimers(GraphService.searchFiles('budget'));
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toMatch(/^SharePoint search failed \(400\)/);
    expect(caught).toMatchObject({ status: 400, isTransient: false, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
