/** @jest-environment node */

import { fingerprintPresentationMediaProofFile } from '../../shared/utils/presentation-media-proof-upload';
import {
  GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
  nextExpectedStart,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../shared/utils/graph-browser-upload';

const CHUNK = GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES;

function fakeFile(size) {
  return {
    size,
    slice: jest.fn((start, end) => ({ start, end, size: end - start })),
  };
}

function xhrFactoryFor(steps, requests = []) {
  return jest.fn(() => {
    const step = steps.shift();
    const xhr = {
      status: 0,
      responseText: '',
      timeout: null,
      headers: {},
      upload: {},
      open: jest.fn((method, url, async) => { requests.push({ xhr, method, url, async }); }),
      setRequestHeader: jest.fn((name, value) => { xhr.headers[name] = value; }),
      getResponseHeader: jest.fn((name) => (name === 'Retry-After' ? step?.retryAfter : null)),
      abort: jest.fn(() => xhr.onabort?.()),
      send: jest.fn((body) => {
        xhr.body = body;
        step?.onSend?.(xhr, body);
        if (step?.kind === 'stall') return;
        if (step?.kind === 'network') return queueMicrotask(() => xhr.onerror());
        for (const loaded of step?.progress || [body.size]) {
          xhr.upload.onprogress?.({ loaded, total: body.size, lengthComputable: true });
        }
        xhr.upload.onload?.();
        if (step?.kind === 'response-stall') return;
        xhr.status = step.status;
        xhr.responseText = JSON.stringify(step.body || {});
        queueMicrotask(() => xhr.onload());
      }),
    };
    return xhr;
  });
}

function openStatus(offset, overrides = {}) {
  return {
    complete: false,
    uploadUrl: 'https://upload.example/session',
    nextExpectedRanges: [`${offset}-`],
    expiresAt: '2026-09-25T20:00:00.000Z',
    ...overrides,
  };
}

test('the code-owned default is 10 MiB and the parser accepts only sequential range syntax', () => {
  expect(CHUNK).toBe(10 * 1024 * 1024);
  expect(CHUNK % (320 * 1024)).toBe(0);
  expect(nextExpectedStart(['655360-'])).toBe(655360);
  expect(nextExpectedStart(['655360-700000'])).toBe(655360);
  expect(() => nextExpectedStart([])).toThrow(expect.objectContaining({ code: 'graph_upload_range_invalid' }));
  expect(() => nextExpectedStart(['bad'])).toThrow(expect.objectContaining({ code: 'graph_upload_range_invalid' }));
});

test('uploads sequential 10 MiB ranges, allows only the final remainder, and verifies final commit through status', async () => {
  const file = fakeFile(CHUNK * 2 + 17);
  const requests = [];
  const xhrFactory = xhrFactoryFor([
    { status: 202, body: { nextExpectedRanges: [`${CHUNK}-`], expirationDateTime: '2026-09-25T18:00:00.000Z' } },
    { status: 202, body: { nextExpectedRanges: [`${CHUNK * 2}-`], expirationDateTime: '2026-09-25T19:00:00.000Z' } },
    { status: 201, body: { id: 'item-1' } },
  ], requests);
  const authorizeStatus = jest.fn(async () => ({ complete: true }));
  const states = [];
  let clock = 0;

  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    onState: (state) => states.push(state),
    now: () => { clock += 1_000; return clock; },
  })).resolves.toMatchObject({ complete: true, nextStart: file.size });

  expect(requests.map(({ xhr }) => xhr.headers['Content-Range'])).toEqual([
    `bytes 0-${CHUNK - 1}/${file.size}`,
    `bytes ${CHUNK}-${CHUNK * 2 - 1}/${file.size}`,
    `bytes ${CHUNK * 2}-${file.size - 1}/${file.size}`,
  ]);
  expect(requests.map(({ xhr }) => xhr.body.size)).toEqual([CHUNK, CHUNK, 17]);
  expect(requests.every(({ xhr }) => xhr.timeout === 0)).toBe(true);
  expect(authorizeStatus).toHaveBeenCalledWith(expect.objectContaining({ reason: 'final_commit', status: 201 }));
  expect(states.at(-1)).toMatchObject({ phase: 'complete', confirmedBytes: file.size, percent: 100, etaSeconds: 0 });
});

test('XHR progress is in-flight only; a 202 range makes bytes confirmed and produces rate/ETA after a meaningful sample', async () => {
  const file = fakeFile(CHUNK * 2);
  const states = [];
  let pause = false;
  const xhrFactory = xhrFactoryFor([
    {
      status: 202,
      progress: [CHUNK / 2],
      body: { nextExpectedRanges: [`${CHUNK}-`], expirationDateTime: '2026-09-25T18:00:00.000Z' },
      onSend: () => { pause = true; },
    },
  ]);
  let clock = 0;
  const result = await uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus: jest.fn(),
    shouldPause: () => pause,
    onState: (state) => states.push(state),
    now: () => { clock += 1_000; return clock; },
  });

  const inFlight = states.find((state) => state.inFlightBytes === CHUNK / 2);
  expect(inFlight).toMatchObject({ phase: 'pausing', confirmedBytes: 0, percent: 0, etaSeconds: null });
  expect(states.some((state) => state.confirmedBytes === CHUNK && state.mbps > 0 && state.etaSeconds > 0)).toBe(true);
  expect(result).toMatchObject({ complete: false, paused: true, reason: 'requested', nextStart: CHUNK });
});

test('a network ambiguity reauthorizes before retry and accepts Graph-confirmed cross-device progress', async () => {
  const file = fakeFile(CHUNK * 2);
  const requests = [];
  const states = [];
  let clock = 0;
  const xhrFactory = xhrFactoryFor([
    { kind: 'network', onSend: () => { clock = 1_000; } },
    { status: 201, onSend: () => { clock = 3_000; } },
  ], requests);
  const authorizeStatus = jest.fn()
    .mockResolvedValueOnce(openStatus(CHUNK))
    .mockResolvedValueOnce({ complete: true });

  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    sleep: jest.fn(async () => {}),
    onState: (state) => states.push(state),
    now: () => clock,
  })).resolves.toMatchObject({ complete: true });

  expect(requests.map(({ xhr }) => xhr.headers['Content-Range'])).toEqual([
    `bytes 0-${CHUNK - 1}/${file.size}`,
    `bytes ${CHUNK}-${file.size - 1}/${file.size}`,
  ]);
  expect(authorizeStatus.mock.calls[0][0]).toMatchObject({ reason: 'graph_upload_network_error', confirmedBytes: 0 });
  expect(states.at(-1).confirmedBytes).toBe(file.size);
  expect(states.at(-1).mbps).toBeCloseTo((8 * CHUNK) / 2_000 / 1_000);
});

test('three ambiguous attempts without Graph-confirmed progress pause instead of spinning', async () => {
  const file = fakeFile(CHUNK);
  const requests = [];
  const xhrFactory = xhrFactoryFor([
    { status: 503 }, { status: 503 }, { status: 503 },
  ], requests);
  const authorizeStatus = jest.fn(async () => openStatus(0));
  const sleep = jest.fn(async () => {});

  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    sleep,
    random: () => 0.5,
  })).resolves.toMatchObject({ complete: false, paused: true, reason: 'retry_exhausted', nextStart: 0 });
  expect(requests).toHaveLength(3);
  expect(authorizeStatus).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
});

test('416 reconciles status before continuing and never starts a replacement upload', async () => {
  const file = fakeFile(CHUNK * 2);
  const requests = [];
  const xhrFactory = xhrFactoryFor([
    { status: 416 },
    { status: 201 },
  ], requests);
  const authorizeStatus = jest.fn()
    .mockResolvedValueOnce(openStatus(CHUNK))
    .mockResolvedValueOnce({ complete: true });
  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
  })).resolves.toMatchObject({ complete: true });
  expect(authorizeStatus.mock.calls[0][0]).toMatchObject({ reason: 'http_416', status: 416 });
  expect(requests[1].xhr.headers['Content-Range']).toBe(`bytes ${CHUNK}-${file.size - 1}/${file.size}`);
});

test('an application status-check failure stops automatic retry without spending more fragment attempts', async () => {
  const file = fakeFile(CHUNK);
  const requests = [];
  const xhrFactory = xhrFactoryFor([{ status: 503 }], requests);
  const appError = Object.assign(new Error('Application temporarily unavailable.'), { status: 503 });
  const authorizeStatus = jest.fn(async () => { throw appError; });
  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
  })).rejects.toBe(appError);
  expect(requests).toHaveLength(1);
});

test('429 honors Retry-After before status and resets bounded retry state after confirmed progress', async () => {
  const file = fakeFile(CHUNK * 2);
  const requests = [];
  const xhrFactory = xhrFactoryFor([
    { status: 429, retryAfter: '2' },
    { status: 202, body: { nextExpectedRanges: [`${CHUNK}-`] } },
    { status: 201 },
  ], requests);
  const authorizeStatus = jest.fn()
    .mockResolvedValueOnce(openStatus(0))
    .mockResolvedValueOnce({ complete: true });
  const sleep = jest.fn(async () => {});

  await uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    sleep,
  });
  expect(sleep).toHaveBeenCalledWith(2_000, undefined);
  expect(requests).toHaveLength(3);
});

test('the third consecutive 429 pauses and requires a fresh manual Resume status check', async () => {
  const file = fakeFile(CHUNK);
  const xhrFactory = xhrFactoryFor([
    { status: 429, retryAfter: '1' },
    { status: 429, retryAfter: '1' },
    { status: 429, retryAfter: '1' },
  ]);
  const authorizeStatus = jest.fn(async () => openStatus(0));
  const sleep = jest.fn(async () => {});
  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    sleep,
    maxNoProgressAttempts: 10,
  })).resolves.toMatchObject({ complete: false, paused: true, reason: 'throttled' });
  expect(authorizeStatus).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(2);
});

test('aborting during retry backoff cancels the timer and preserves the resumable outcome', async () => {
  jest.useFakeTimers();
  try {
    const controller = new AbortController();
    const pending = uploadBrowserDirectGraphFile({
      file: fakeFile(CHUNK),
      uploadUrl: 'https://upload.example/session',
      xhrFactory: xhrFactoryFor([{ status: 503 }]),
      authorizeStatus: jest.fn(async () => openStatus(0)),
      signal: controller.signal,
      random: () => 0.5,
    });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('continuous XHR progress avoids the inactivity watchdog while a true stall reconciles through status', async () => {
  jest.useFakeTimers();
  try {
    const file = fakeFile(CHUNK);
    const healthyFactory = jest.fn(() => {
      const xhr = {
        status: 0, responseText: '', upload: {}, open: jest.fn(), setRequestHeader: jest.fn(),
        getResponseHeader: jest.fn(), abort: jest.fn(() => xhr.onabort?.()),
        send: jest.fn((body) => {
          setTimeout(() => xhr.upload.onprogress({ loaded: body.size / 2 }), 5);
          setTimeout(() => xhr.upload.onprogress({ loaded: body.size }), 10);
          setTimeout(() => xhr.upload.onload(), 12);
          setTimeout(() => { xhr.status = 201; xhr.onload(); }, 15);
        }),
      };
      return xhr;
    });
    const healthy = uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory: healthyFactory,
      authorizeStatus: jest.fn(async () => ({ complete: true })),
      stallTimeoutMs: 8,
      responseTimeoutMs: 8,
    });
    await jest.advanceTimersByTimeAsync(20);
    await expect(healthy).resolves.toMatchObject({ complete: true });

    const stalledFactory = xhrFactoryFor([{ kind: 'stall' }]);
    const stalled = uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory: stalledFactory,
      authorizeStatus: jest.fn(async () => openStatus(0)),
      stallTimeoutMs: 8,
      responseTimeoutMs: 8,
      maxNoProgressAttempts: 1,
    });
    await jest.advanceTimersByTimeAsync(10);
    await expect(stalled).resolves.toMatchObject({ complete: false, paused: true, reason: 'retry_exhausted' });

    const responseStalledFactory = xhrFactoryFor([{ kind: 'response-stall', status: 0 }]);
    const responseStalled = uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory: responseStalledFactory,
      authorizeStatus: jest.fn(async () => openStatus(0)),
      stallTimeoutMs: 8,
      responseTimeoutMs: 8,
      maxNoProgressAttempts: 1,
    });
    await jest.advanceTimersByTimeAsync(10);
    await expect(responseStalled).resolves.toMatchObject({ complete: false, paused: true, reason: 'retry_exhausted' });

    const duplicateProgressFactory = jest.fn(() => {
      const xhr = {
        status: 0, responseText: '', upload: {}, open: jest.fn(), setRequestHeader: jest.fn(),
        getResponseHeader: jest.fn(), abort: jest.fn(() => {
          xhr.upload.onprogress?.({ loaded: 2 });
          xhr.upload.onload?.();
          xhr.onabort?.();
        }),
        send: jest.fn(() => {
          setTimeout(() => xhr.upload.onprogress({ loaded: 1 }), 1);
          setTimeout(() => xhr.upload.onprogress({ loaded: 1 }), 5);
          setTimeout(() => xhr.upload.onprogress({ loaded: 0 }), 7);
        }),
      };
      return xhr;
    });
    const duplicateProgressStall = uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory: duplicateProgressFactory,
      authorizeStatus: jest.fn(async () => openStatus(0)),
      stallTimeoutMs: 8,
      responseTimeoutMs: 8,
      maxNoProgressAttempts: 1,
    });
    await jest.advanceTimersByTimeAsync(10);
    await expect(duplicateProgressStall).resolves.toMatchObject({
      complete: false, paused: true, reason: 'retry_exhausted',
    });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('a 202 that reaches the declared size still requires exact-item verification', async () => {
  const file = fakeFile(CHUNK);
  const xhrFactory = xhrFactoryFor([{ status: 202, body: { nextExpectedRanges: [`${CHUNK}-`] } }]);
  const authorizeStatus = jest.fn(async () => ({ complete: true }));
  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
  })).resolves.toMatchObject({ complete: true, nextStart: file.size });
  expect(authorizeStatus).toHaveBeenCalledWith(expect.objectContaining({ reason: 'all_ranges_reported' }));
});

test('a contradictory final response cannot double-count one logical range in throughput', async () => {
  const file = fakeFile(CHUNK);
  let clock = 0;
  const states = [];
  const xhrFactory = xhrFactoryFor([
    { status: 201, onSend: () => { clock = 1_000; } },
    { status: 201, onSend: () => { clock = 3_000; } },
  ]);
  const authorizeStatus = jest.fn()
    .mockResolvedValueOnce(openStatus(0))
    .mockResolvedValueOnce({ complete: true });
  await uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    onState: (state) => states.push(state),
    now: () => clock,
  });
  expect(states.at(-1).mbps).toBeCloseTo((8 * CHUNK) / 2_000 / 1_000);
});

test('offline waiting does not spend the no-progress fragment budget', async () => {
  const file = fakeFile(CHUNK);
  let online = false;
  const waitForOnline = jest.fn(async () => { online = true; return true; });
  const authorizeStatus = jest.fn()
    .mockResolvedValueOnce(openStatus(0))
    .mockResolvedValueOnce({ complete: true });
  const xhrFactory = xhrFactoryFor([{ status: 201 }]);
  await expect(uploadBrowserDirectGraphFile({
    file,
    uploadUrl: 'https://upload.example/session',
    xhrFactory,
    authorizeStatus,
    isOnline: () => online,
    waitForOnline,
    maxNoProgressAttempts: 1,
  })).resolves.toMatchObject({ complete: true });
  expect(waitForOnline).toHaveBeenCalledTimes(1);
});

test('a user pause interrupts offline and retry waits without aborting an active fragment', async () => {
  const offlinePause = new AbortController();
  const offlineWait = jest.fn(({ pauseSignal }) => new Promise((resolve) => {
    pauseSignal.addEventListener('abort', () => resolve('paused'), { once: true });
  }));
  const offlinePending = uploadBrowserDirectGraphFile({
    file: fakeFile(CHUNK),
    uploadUrl: 'https://upload.example/session',
    xhrFactory: jest.fn(),
    authorizeStatus: jest.fn(),
    isOnline: () => false,
    waitForOnline: offlineWait,
    pauseSignal: offlinePause.signal,
  });
  await Promise.resolve();
  offlinePause.abort();
  await expect(offlinePending).resolves.toMatchObject({ paused: true, reason: 'requested', nextStart: 0 });

  const retryPause = new AbortController();
  const retrySleep = jest.fn((_ms, _signal, pauseSignal) => new Promise((resolve) => {
    pauseSignal.addEventListener('abort', () => resolve(false), { once: true });
  }));
  const retryPending = uploadBrowserDirectGraphFile({
    file: fakeFile(CHUNK),
    uploadUrl: 'https://upload.example/session',
    xhrFactory: xhrFactoryFor([{ status: 503 }]),
    authorizeStatus: jest.fn(async () => openStatus(0)),
    sleep: retrySleep,
    pauseSignal: retryPause.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(retrySleep).toHaveBeenCalled();
  retryPause.abort();
  await expect(retryPending).resolves.toMatchObject({ paused: true, reason: 'requested', nextStart: 0 });
});

test('in-flight progress keeps confirmed-fragment speed stable and marks stale rates unknown', async () => {
  jest.useFakeTimers();
  try {
    const file = fakeFile(CHUNK * 2);
    const states = [];
    let clock = 0;
    let secondXhr;
    const xhrFactory = xhrFactoryFor([
      {
        status: 202,
        body: { nextExpectedRanges: [`${CHUNK}-`] },
        onSend: () => { clock = 1_000; },
      },
      {
        kind: 'stall',
        onSend: (xhr) => {
          secondXhr = xhr;
          clock = 10_000;
          xhr.upload.onprogress?.({ loaded: CHUNK / 2 });
        },
      },
    ]);
    const pending = uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory,
      authorizeStatus: jest.fn(async () => openStatus(CHUNK)),
      onState: (state) => states.push(state),
      now: () => clock,
      rateStaleMs: 5_000,
      stallTimeoutMs: 20_000,
      maxNoProgressAttempts: 1,
    });
    await jest.advanceTimersByTimeAsync(0);
    const confirmed = states.find((state) => state.confirmedBytes === CHUNK && state.inFlightBytes === CHUNK);
    const inFlight = states.find((state) => state.confirmedBytes === CHUNK && state.inFlightBytes > CHUNK);
    expect(confirmed.mbps).toBeGreaterThan(0);
    expect(inFlight.mbps).toBeCloseTo(confirmed.mbps);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(states.at(-1)).toMatchObject({ rateStale: true, mbps: null, etaSeconds: null });
    secondXhr.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    jest.useRealTimers();
  }
});

test('malformed, backward, and beyond-fragment 202 ranges fail closed', async () => {
  const file = fakeFile(CHUNK * 2);
  for (const range of ['bad', '0-', `${CHUNK + 1}-`]) {
    const xhrFactory = xhrFactoryFor([{ status: 202, body: { nextExpectedRanges: [range] } }]);
    await expect(uploadBrowserDirectGraphFile({
      file,
      uploadUrl: 'https://upload.example/session',
      xhrFactory,
      authorizeStatus: jest.fn(),
    })).rejects.toMatchObject({ code: 'graph_upload_range_invalid' });
  }
});

test('same-browser lock refuses a second tab and never runs its PUT task', async () => {
  const task = jest.fn();
  const locks = { request: jest.fn(async (_name, options, callback) => {
    expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
    return callback(null);
  }) };
  await expect(withGraphBrowserUploadLock('intent-1', task, locks))
    .rejects.toMatchObject({ code: 'graph_upload_lock_unavailable' });
  expect(task).not.toHaveBeenCalled();
});

test('same-browser locking fails closed when the Web Locks API is unavailable', async () => {
  const task = jest.fn();
  await expect(withGraphBrowserUploadLock('intent-1', task, null))
    .rejects.toMatchObject({ code: 'graph_upload_lock_unsupported' });
  expect(task).not.toHaveBeenCalled();
});

test('resume fingerprint binds size and both file edges without reading middle bytes', async () => {
  const { webcrypto } = await import('node:crypto');
  const size = 3 * 1024 * 1024;
  const bytes = new Uint8Array(size);
  const fileOf = (value) => ({
    size: value.length,
    slice: (start, end) => ({ arrayBuffer: async () => value.slice(start, end).buffer }),
  });
  const original = await fingerprintPresentationMediaProofFile(fileOf(bytes), webcrypto.subtle);
  bytes[0] = 1;
  expect(await fingerprintPresentationMediaProofFile(fileOf(bytes), webcrypto.subtle)).not.toBe(original);
  bytes[0] = 0;
  bytes[size - 1] = 1;
  expect(await fingerprintPresentationMediaProofFile(fileOf(bytes), webcrypto.subtle)).not.toBe(original);
  bytes[size - 1] = 0;
  bytes[1_500_000] = 1;
  expect(await fingerprintPresentationMediaProofFile(fileOf(bytes), webcrypto.subtle)).toBe(original);
  expect(await fingerprintPresentationMediaProofFile(fileOf(bytes.slice(1)), webcrypto.subtle)).not.toBe(original);
});
