const { PubMedService } = require('../../lib/services/pubmed-service');

function response(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] || null,
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const originalConfig = {
  requestIntervalMs: PubMedService.requestIntervalMs,
  maxRetries: PubMedService.maxRetries,
  retryBaseMs: PubMedService.retryBaseMs,
  retryJitterMs: PubMedService.retryJitterMs,
};
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  PubMedService.requestIntervalMs = 0;
  PubMedService.maxRetries = 1;
  PubMedService.retryBaseMs = 0;
  PubMedService.retryJitterMs = 0;
  PubMedService.resetRequestGovernorForTests();
});

afterEach(() => {
  PubMedService.requestIntervalMs = originalConfig.requestIntervalMs;
  PubMedService.maxRetries = originalConfig.maxRetries;
  PubMedService.retryBaseMs = originalConfig.retryBaseMs;
  PubMedService.retryJitterMs = originalConfig.retryJitterMs;
  PubMedService.resetRequestGovernorForTests();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('serializes concurrent PubMed requests instead of starting a burst', async () => {
  const first = deferred();
  global.fetch = jest.fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce(response(200));

  const firstRequest = PubMedService.request('https://example.test/one');
  const secondRequest = PubMedService.request('https://example.test/two');
  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).toHaveBeenCalledTimes(1);

  first.resolve(response(200));
  await firstRequest;
  await secondRequest;

  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('paces the next request start through the shared governor', async () => {
  PubMedService.requestIntervalMs = 250;
  const waitSpy = jest.spyOn(PubMedService, 'wait').mockResolvedValue();
  global.fetch = jest.fn().mockResolvedValue(response(200));

  await PubMedService.request('https://example.test/one');
  await PubMedService.request('https://example.test/two');

  expect(waitSpy.mock.calls.some(([delay]) => delay >= 200)).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('retries a 429 and returns the successful response', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(429))
    .mockResolvedValueOnce(response(200));

  const result = await PubMedService.request('https://example.test/retry', {
    operation: 'esearch',
  });

  expect(result.status).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('surfaces an exhausted 429 with its status', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(429))
    .mockResolvedValueOnce(response(429));

  await expect(PubMedService.request('https://example.test/exhausted', {
    operation: 'esearch',
  })).rejects.toMatchObject({
    message: 'PubMed esearch failed (429)',
    status: 429,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('an aborted queued request does not poison later PubMed requests', async () => {
  const controller = new AbortController();
  controller.abort();
  global.fetch = jest.fn().mockResolvedValue(response(200));

  await expect(PubMedService.request('https://example.test/aborted', {
    signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });

  await expect(PubMedService.request('https://example.test/after-abort'))
    .resolves.toMatchObject({ status: 200 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
