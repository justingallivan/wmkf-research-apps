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
    expect(fetchCalls[0].url).toBe('https://api.cloudmersive.com/virus/scan/file/advanced');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers.Apikey).toBe('test-key-not-real');
    // /advanced flag headers — defensive defaults except allowHtml.
    expect(fetchCalls[0].init.headers.allowExecutables).toBe('false');
    expect(fetchCalls[0].init.headers.allowMacros).toBe('false');
    expect(fetchCalls[0].init.headers.allowScripts).toBe('false');
    expect(fetchCalls[0].init.headers.allowOleEmbeddedObject).toBe('false');
    expect(fetchCalls[0].init.headers.allowUnsafeArchives).toBe('false');
    expect(fetchCalls[0].init.headers.allowHtml).toBe('true');
    expect(out.detectedThreats).toEqual([]);
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
    expect(out.detectedThreats).toEqual([]);
  });

  test('CleanResult=false + ContainsMacros=true → infected with synthesized foundViruses', async () => {
    mockFetchSequence([
      () => ({
        status: 200,
        body: {
          CleanResult: false,
          FoundViruses: [],
          ContainsMacros: true,
          VerifiedFileFormat: 'docx',
        },
      }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('x'), 'macro.docx');
    expect(out.scan_result).toBe('infected');
    expect(out.foundViruses).toEqual([
      { fileName: 'macro.docx', virusName: 'embedded macro' },
    ]);
    expect(out.detectedThreats).toEqual(['embedded macro']);
    expect(out.verifiedFileFormat).toBe('docx');
  });

  test('multiple Contains* flags → detectedThreats lists all, foundViruses uses first (executable > macros priority)', async () => {
    mockFetchSequence([
      () => ({
        status: 200,
        body: {
          CleanResult: false,
          FoundViruses: [],
          ContainsExecutable: true,
          ContainsMacros: true,
          ContainsScript: true,
        },
      }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('x'), 'multi.docx');
    expect(out.scan_result).toBe('infected');
    expect(out.foundViruses).toEqual([
      { fileName: 'multi.docx', virusName: 'embedded executable' },
    ]);
    expect(out.detectedThreats).toEqual(['embedded executable', 'embedded macro', 'embedded script']);
  });

  test('signature match wins precedence over Contains* synthesis', async () => {
    mockFetchSequence([
      () => ({
        status: 200,
        body: {
          CleanResult: false,
          FoundViruses: [{ FileName: 'eicar.com', VirusName: 'EICAR-Test-Signature' }],
          ContainsMacros: true,
        },
      }),
    ]);
    const { scanBytes } = await loadService();
    const out = await scanBytes(Buffer.from('x'), 'mixed.docx');
    expect(out.scan_result).toBe('infected');
    // Real signature kept, NOT overwritten by synthesized macro entry.
    expect(out.foundViruses).toEqual([
      { fileName: 'eicar.com', virusName: 'EICAR-Test-Signature' },
    ]);
    expect(out.detectedThreats).toEqual(['embedded macro']);
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

  test('a 429 followed by an abort reports the final timeout cause', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      if (fetchCalls.length === 1) {
        return { ok: false, status: 429, text: async () => 'busy' };
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.txt', { timeoutMs: 10, maxAttempts: 2 });
      const outcome = pending.catch((error) => error);
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(10);
      expect(await outcome).toMatchObject({ status: null, noResponse: true, causeKind: 'abort', isTransient: true });
      expect(fetchCalls).toHaveLength(2);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('scanBytes — bounded per-call options and full response deadline', () => {
  test('defaults remain 30 seconds and three attempts; caller can choose a smaller retry budget', async () => {
    mockFetchSequence([() => ({ status: 503, body: 'temporary' })]);
    const { scanBytes, TIMEOUT_MS, MAX_ATTEMPTS } = await loadService();
    expect(TIMEOUT_MS).toBe(30_000);
    expect(MAX_ATTEMPTS).toBe(3);
    await expect(scanBytes(Buffer.from('x'), 'x.txt', { timeoutMs: 90_000, maxAttempts: 1 }))
      .rejects.toMatchObject({ status: 503, serviceName: 'cloudmersive' });
    expect(fetchCalls).toHaveLength(1);
  });

  test.each([
    { timeoutMs: 0, maxAttempts: 1 },
    { timeoutMs: 90_001, maxAttempts: 1 },
    { timeoutMs: 1.5, maxAttempts: 1 },
    { timeoutMs: 90_000, maxAttempts: 0 },
    { timeoutMs: 90_000, maxAttempts: 4 },
    { timeoutMs: 90_000, maxAttempts: 1.5 },
  ])('invalid scanner options are non-transient configuration errors: %j', async (options) => {
    global.fetch = jest.fn();
    const { scanBytes } = await loadService();
    await expect(scanBytes(Buffer.from('x'), 'x.txt', options)).rejects.toMatchObject({
      serviceName: 'cloudmersive', status: 500, isTransient: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('default deadline still aborts a request after 30 seconds', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.txt', { maxAttempts: 1 });
      const outcome = pending.catch((error) => error);
      await jest.advanceTimersByTimeAsync(29_999);
      expect(fetchCalls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ causeKind: 'abort', noResponse: true });
    } finally {
      jest.useRealTimers();
    }
  });

  test('site-visit timeout profile can accept a slow scan after the old 30-second default', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal.addEventListener('abort', abort, { once: true });
        setTimeout(() => {
          init.signal.removeEventListener('abort', abort);
          resolve({ ok: true, status: 200, json: async () => ({ CleanResult: true }) });
        }, 45_000);
      });
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.pptx', { timeoutMs: 90_000, maxAttempts: 2 });
      const outcome = pending.then((value) => value, (error) => error);
      await jest.advanceTimersByTimeAsync(45_000);
      expect(await outcome).toMatchObject({ scan_result: 'clean' });
      expect(fetchCalls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('site-visit timeout profile exhausts after exactly two 90-second attempts', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.pptx', { timeoutMs: 90_000, maxAttempts: 2 });
      const outcome = pending.catch((error) => error);
      await jest.advanceTimersByTimeAsync(90_000);
      expect(fetchCalls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(500);
      expect(fetchCalls).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(90_000);
      expect(await outcome).toMatchObject({ causeKind: 'abort', noResponse: true });
      expect(fetchCalls).toHaveLength(2);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });

  test('timeout includes a successful response body read', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      };
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.txt', { timeoutMs: 10, maxAttempts: 1 });
      const outcome = pending.catch((error) => error);
      await jest.advanceTimersByTimeAsync(10);
      expect(await outcome).toMatchObject({ status: null, noResponse: true, causeKind: 'abort' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('an HTTP error status remains structured if reading its body reaches the deadline', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => {
      fetchCalls.push({ url: _url, init });
      return {
        ok: false,
        status: 500,
        text: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      };
    });
    try {
      const { scanBytes } = await loadService();
      const pending = scanBytes(Buffer.from('x'), 'x.txt', { timeoutMs: 10, maxAttempts: 1 });
      const outcome = pending.catch((error) => error);
      await jest.advanceTimersByTimeAsync(10);
      const error = await outcome;
      expect(error).toMatchObject({ serviceName: 'cloudmersive', status: 500, isTransient: true });
      expect(error).not.toHaveProperty('noResponse');
    } finally {
      jest.useRealTimers();
    }
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
