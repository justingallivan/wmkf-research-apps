/**
 * cloudmersive-scan.test.js
 *
 * Exercises the service envelope without hitting the real Cloudmersive API.
 * Covers:
 *   - happy path: CleanResult=true → scan_result='clean'
 *   - infected:   CleanResult=false → scan_result='infected' + foundViruses
 *   - 5xx-then-clean: transient retry succeeds within MAX_ATTEMPTS
 *   - 5xx-exhaust:    retries up to MAX_ATTEMPTS then throws structured 5xx
 *   - 4xx (auth):     no retry; throws structured error
 *   - network error:  retried; structured noResponse on exhaust
 *   - missing key:    throws non-transient 500 immediately
 *   - bad inputs:     throws non-transient 500 (Buffer + filename guards)
 *
 * EICAR / real-API path is exercised by scripts/smoke-virus-scan.js.
 */

const originalFetch = global.fetch;
const originalKey = process.env.CLOUDMERSIVE_API_KEY;

let fetchCalls = [];

beforeEach(() => {
  fetchCalls = [];
  process.env.CLOUDMERSIVE_API_KEY = 'test-key-not-real';
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
  else process.env.CLOUDMERSIVE_API_KEY = originalKey;
});

// Per-test fresh import (the service has no module-level cache, but isolating
// resetModules keeps test order independence cheap).
async function loadService() {
  let mod;
  await jest.isolateModulesAsync(async () => {
    mod = await import('../../lib/services/cloudmersive-scan.js');
  });
  return mod;
}

function mockFetchSequence(responders) {
  // responders: array of (callIndex, init) => either {status, jsonBody} or
  // an Error to throw. Each call consumes one entry; if exhausted, throws.
  let idx = 0;
  global.fetch = jest.fn(async (url, init) => {
    fetchCalls.push({ url, init });
    if (idx >= responders.length) {
      throw new Error(`fetch called ${idx + 1} times, only ${responders.length} responders configured`);
    }
    const r = responders[idx++];
    const out = await r(idx - 1, init);
    if (out instanceof Error) throw out;
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {})),
      json: async () => out.body ?? {},
    };
  });
}

describe('scanBytes — happy path', () => {
  test('CleanResult=true → scan_result=clean, foundViruses=[]', async () => {
    mockFetchSequence([
      () => ({ status: 200, body: { CleanResult: true, FoundViruses: [] } }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('hello world'), 'hi.txt');
    expect(out.scan_result).toBe('clean');
    expect(out.foundViruses).toEqual([]);
    expect(out.scanner).toBe('cloudmersive');
    expect(typeof out.scannedAt).toBe('string');
    expect(out.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://api.cloudmersive.com/virus/scan/file');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers.Apikey).toBe('test-key-not-real');
  });

  test('Uint8Array input is accepted', async () => {
    mockFetchSequence([
      () => ({ status: 200, body: { CleanResult: true, FoundViruses: [] } }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(new Uint8Array([1, 2, 3]), 'bin');
    expect(out.scan_result).toBe('clean');
  });
});

describe('scanBytes — infected', () => {
  test('CleanResult=false → scan_result=infected, foundViruses populated', async () => {
    mockFetchSequence([
      () => ({
        status: 200,
        body: {
          CleanResult: false,
          FoundViruses: [{ FileName: 'eicar.com', VirusName: 'EICAR-Test-Signature' }],
        },
      }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('X5O!P%@AP'), 'eicar.com');
    expect(out.scan_result).toBe('infected');
    expect(out.foundViruses).toEqual([
      { fileName: 'eicar.com', virusName: 'EICAR-Test-Signature' },
    ]);
  });

  test('missing FoundViruses array still yields infected with []', async () => {
    mockFetchSequence([
      () => ({ status: 200, body: { CleanResult: false } }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('x'), 'x');
    expect(out.scan_result).toBe('infected');
    expect(out.foundViruses).toEqual([]);
  });
});

describe('scanBytes — transient retry', () => {
  test('5xx then 200 → returns clean after retry', async () => {
    mockFetchSequence([
      () => ({ status: 503, body: 'temporarily unavailable' }),
      () => ({ status: 200, body: { CleanResult: true, FoundViruses: [] } }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('x'), 'x.txt');
    expect(out.scan_result).toBe('clean');
    expect(fetchCalls).toHaveLength(2);
  });

  test('5xx × MAX_ATTEMPTS → throws structured 5xx error', async () => {
    mockFetchSequence([
      () => ({ status: 500, body: 'boom' }),
      () => ({ status: 500, body: 'boom' }),
      () => ({ status: 500, body: 'boom' }),
    ]);
    const { scanBytes, MAX_ATTEMPTS } = await loadService();
    expect(MAX_ATTEMPTS).toBe(3);
    await expect(scanBytes(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      status: 500,
      isTransient: true,
    });
    expect(fetchCalls).toHaveLength(3);
  });

  test('network error × MAX_ATTEMPTS → throws structured noResponse error', async () => {
    const netErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    mockFetchSequence([
      () => netErr,
      () => netErr,
      () => netErr,
    ]);
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      noResponse: true,
      isTransient: true,
      causeKind: 'socket',
    });
    expect(fetchCalls).toHaveLength(3);
  });
});

describe('scanBytes — non-retryable', () => {
  test('401 auth fail → no retry, throws structured error', async () => {
    mockFetchSequence([
      () => ({ status: 401, body: 'bad key' }),
    ]);
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      status: 401,
      isTransient: false,
    });
    expect(fetchCalls).toHaveLength(1);
  });

  test('429 rate limit → marked transient, retried up to MAX_ATTEMPTS', async () => {
    // 429 is in the auto-transient list (per service-error.js): retried.
    // This documents the existing taxonomy decision — if we ever want 429
    // to surface immediately for operator alert instead, change here AND
    // the classifier.
    mockFetchSequence([
      () => ({ status: 429, body: 'slow down' }),
      () => ({ status: 429, body: 'slow down' }),
      () => ({ status: 429, body: 'slow down' }),
    ]);
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      status: 429,
      isTransient: true,
    });
    expect(fetchCalls).toHaveLength(3);
  });
});

describe('scanBytes — config / input guards', () => {
  test('missing CLOUDMERSIVE_API_KEY → throws non-transient 500, no fetch', async () => {
    delete process.env.CLOUDMERSIVE_API_KEY;
    global.fetch = jest.fn(async () => {
      throw new Error('fetch should not have been called');
    });
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      status: 500,
      isTransient: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('non-Buffer input → non-transient 500', async () => {
    global.fetch = jest.fn();
    const { scanBytes } = await loadService();
    await expect(scanBytes('not bytes', 'x.txt')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      isTransient: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty filename → non-transient 500', async () => {
    global.fetch = jest.fn();
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), '')).rejects.toMatchObject({
      serviceName: 'cloudmersive',
      isTransient: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
