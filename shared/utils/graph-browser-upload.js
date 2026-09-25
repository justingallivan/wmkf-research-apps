/**
 * Browser-direct Microsoft Graph upload transport.
 *
 * File bytes travel only from the browser to Graph. Application callbacks are
 * metadata-only authorization/status checks and are required before retrying
 * any ambiguous PUT outcome. Graph-confirmed ranges, never XHR progress, own
 * durable progress, throughput, and ETA.
 */

export const GRAPH_UPLOAD_ALIGNMENT_BYTES = 320 * 1024;
export const GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;
export const GRAPH_UPLOAD_STALL_TIMEOUT_MS = 120_000;
export const GRAPH_UPLOAD_RESPONSE_TIMEOUT_MS = 180_000;
export const GRAPH_UPLOAD_OFFLINE_WAIT_MS = 120_000;
export const GRAPH_UPLOAD_MAX_NO_PROGRESS_ATTEMPTS = 3;
export const GRAPH_UPLOAD_MAX_CONSECUTIVE_THROTTLES = 3;
export const GRAPH_UPLOAD_MAX_THROTTLE_WAIT_MS = 120_000;
export const GRAPH_UPLOAD_RATE_STALE_MS = 5_000;

const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_CAP_MS = 30_000;
const DEFAULT_RATE_SAMPLE_MS = 1_000;
const FINGERPRINT_EDGE_BYTES = 1024 * 1024;

function abortError() {
  const error = new Error('Upload stopped.');
  error.name = 'AbortError';
  return error;
}

export class GraphBrowserUploadError extends Error {
  constructor(message, { code, status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'GraphBrowserUploadError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Bind a resumed local file to its size and edge bytes without reading the full media file. */
export async function fingerprintGraphBrowserUploadFile(file, subtle = globalThis.crypto?.subtle) {
  if (!file || !Number.isInteger(file.size) || file.size <= 0 || !subtle?.digest) {
    throw new Error('The selected file cannot be verified for resume.');
  }
  const edge = Math.min(file.size, FINGERPRINT_EDGE_BYTES);
  const [first, last] = await Promise.all([
    file.slice(0, edge).arrayBuffer(),
    file.slice(file.size - edge, file.size).arrayBuffer(),
  ]);
  const prefix = new TextEncoder().encode(`${file.size}:`);
  const input = new Uint8Array(prefix.byteLength + first.byteLength + last.byteLength);
  input.set(prefix);
  input.set(new Uint8Array(first), prefix.byteLength);
  input.set(new Uint8Array(last), prefix.byteLength + first.byteLength);
  const digest = new Uint8Array(await subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseNextExpectedStart(ranges) {
  const first = Array.isArray(ranges) ? ranges[0] : null;
  const match = typeof first === 'string' ? first.match(/^(\d+)-(?:\d+)?$/) : null;
  return match ? Number(match[1]) : Number.NaN;
}

export function nextExpectedStart(ranges) {
  const next = parseNextExpectedStart(ranges);
  if (!Number.isInteger(next)) {
    throw new GraphBrowserUploadError('Microsoft returned an invalid authorized upload range.', {
      code: 'graph_upload_range_invalid',
    });
  }
  return next;
}

function requireRangeStart(ranges, { minimum, maximum, allowEqual, source }) {
  const next = parseNextExpectedStart(ranges);
  const lowerOk = allowEqual ? next >= minimum : next > minimum;
  if (!Number.isInteger(next) || !lowerOk || next > maximum) {
    throw new GraphBrowserUploadError(`Microsoft returned an invalid ${source} upload range.`, {
      code: 'graph_upload_range_invalid',
    });
  }
  return next;
}

function retryAfterMs(value, nowMs) {
  const text = String(value || '').trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

function sleepWithSignal(ms, signal, pauseSignal, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout) {
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (pauseSignal?.aborted) return resolve(false);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      signal?.removeEventListener('abort', onAbort);
      pauseSignal?.removeEventListener('abort', onPause);
      resolve(value);
    };
    const timer = setTimeoutImpl(() => {
      finish(true);
    }, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      pauseSignal?.removeEventListener('abort', onPause);
      reject(abortError());
    };
    const onPause = () => finish(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    pauseSignal?.addEventListener('abort', onPause, { once: true });
  });
}

export function waitForBrowserOnline({
  timeoutMs = GRAPH_UPLOAD_OFFLINE_WAIT_MS,
  signal,
  pauseSignal,
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (navigatorObject?.onLine !== false) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (pauseSignal?.aborted) return resolve('paused');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      windowObject?.removeEventListener?.('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
      pauseSignal?.removeEventListener('abort', onPause);
      resolve(value);
    };
    const onOnline = () => finish(true);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      windowObject?.removeEventListener?.('online', onOnline);
      reject(abortError());
    };
    const onPause = () => finish('paused');
    const timer = setTimeoutImpl(() => finish(false), timeoutMs);
    windowObject?.addEventListener?.('online', onOnline, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    pauseSignal?.addEventListener('abort', onPause, { once: true });
  });
}

export async function withGraphBrowserUploadLock(lockKey, task, locks = globalThis.navigator?.locks) {
  if (typeof lockKey !== 'string' || !lockKey || typeof task !== 'function') {
    throw new GraphBrowserUploadError('The browser upload lock is invalid.', { code: 'graph_upload_lock_invalid' });
  }
  if (!locks?.request) {
    throw new GraphBrowserUploadError(
      'This browser cannot safely coordinate a resumable upload across tabs.',
      { code: 'graph_upload_lock_unsupported' },
    );
  }
  return locks.request(`wmkf:graph-upload:${lockKey}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) {
      throw new GraphBrowserUploadError(
        'This upload is already active in another tab. Pause it there before resuming here.',
        { code: 'graph_upload_lock_unavailable' },
      );
    }
    return task();
  });
}

function uploadFragmentWithXhr({
  uploadUrl,
  contentRange,
  body,
  signal,
  xhrFactory,
  stallTimeoutMs,
  responseTimeoutMs,
  rateStaleMs,
  onUploadProgress,
  setTimeoutImpl,
  clearTimeoutImpl,
  now,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = xhrFactory();
    let settled = false;
    let stallTimer = null;
    let responseTimer = null;
    let rateStaleTimer = null;
    let lastLoaded = 0;
    const clearTimers = () => {
      if (stallTimer !== null) clearTimeoutImpl(stallTimer);
      if (responseTimer !== null) clearTimeoutImpl(responseTimer);
      if (rateStaleTimer !== null) clearTimeoutImpl(rateStaleTimer);
      stallTimer = null;
      responseTimer = null;
      rateStaleTimer = null;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimers();
      signal?.removeEventListener('abort', onSignalAbort);
      callback(value);
    };
    const stopForWatchdog = (code, message) => {
      finish(reject, new GraphBrowserUploadError(message, { code }));
      try { xhr.abort(); } catch {}
    };
    const resetStallTimer = () => {
      if (settled) return;
      if (stallTimer !== null) clearTimeoutImpl(stallTimer);
      stallTimer = setTimeoutImpl(() => stopForWatchdog(
        'graph_upload_stalled',
        'Microsoft upload progress stalled.',
      ), stallTimeoutMs);
    };
    const startResponseTimer = () => {
      if (settled) return;
      if (stallTimer !== null) clearTimeoutImpl(stallTimer);
      if (responseTimer !== null) clearTimeoutImpl(responseTimer);
      stallTimer = null;
      responseTimer = setTimeoutImpl(() => stopForWatchdog(
        'graph_upload_response_timeout',
        'Microsoft did not confirm the uploaded fragment in time.',
      ), responseTimeoutMs);
    };
    const resetRateStaleTimer = () => {
      if (settled) return;
      if (rateStaleTimer !== null) clearTimeoutImpl(rateStaleTimer);
      rateStaleTimer = setTimeoutImpl(() => {
        rateStaleTimer = null;
        onUploadProgress(lastLoaded, { rateStale: true });
      }, rateStaleMs);
    };
    const onSignalAbort = () => xhr.abort();
    xhr.onload = () => finish(resolve, {
      ok: xhr.status >= 200 && xhr.status < 300,
      status: xhr.status,
      retryAfterMs: retryAfterMs(xhr.getResponseHeader?.('Retry-After'), now()),
      json: async () => {
        try {
          return JSON.parse(xhr.responseText || '{}');
        } catch {
          throw new GraphBrowserUploadError('Microsoft returned an invalid upload response.', {
            code: 'graph_upload_response_invalid',
            status: xhr.status,
          });
        }
      },
    });
    xhr.onerror = () => finish(reject, new GraphBrowserUploadError(
      'Microsoft upload connection failed before a response.',
      { code: 'graph_upload_network_error' },
    ));
    xhr.onabort = () => finish(reject, abortError());
    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (settled) return;
        if (!Number.isFinite(event.loaded) || event.loaded < 0) return;
        const loaded = Math.min(event.loaded, body.size);
        if (loaded <= lastLoaded) return;
        lastLoaded = loaded;
        resetStallTimer();
        resetRateStaleTimer();
        onUploadProgress(loaded, { rateStale: false });
      };
      xhr.upload.onload = () => {
        if (settled) return;
        startResponseTimer();
      };
    }
    signal?.addEventListener('abort', onSignalAbort, { once: true });
    try {
      xhr.open('PUT', uploadUrl, true);
      // Native whole-request timeouts misclassify a slow but healthy 10 MiB
      // transfer. The resettable upload and response watchdogs above own time.
      xhr.timeout = 0;
      xhr.setRequestHeader('Content-Range', contentRange);
      resetStallTimer();
      resetRateStaleTimer();
      xhr.send(body);
    } catch (error) {
      finish(reject, error);
    }
  });
}

function transferMetrics({
  confirmedBytes,
  inFlightBytes,
  totalBytes,
  rateConfirmedBytes,
  rateActiveMs,
  minimumRateSampleMs,
}) {
  const mbps = rateConfirmedBytes > 0 && rateActiveMs >= minimumRateSampleMs
    ? (8 * rateConfirmedBytes) / rateActiveMs / 1_000
    : null;
  const etaSeconds = mbps && confirmedBytes < totalBytes
    ? (8 * (totalBytes - confirmedBytes)) / (mbps * 1_000_000)
    : (confirmedBytes >= totalBytes ? 0 : null);
  return {
    confirmedBytes,
    inFlightBytes,
    totalBytes,
    percent: totalBytes > 0 ? (confirmedBytes / totalBytes) * 100 : 0,
    mbps,
    etaSeconds,
  };
}

function retryDelay(attempt, baseMs, capMs, random) {
  const raw = Math.min(capMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.round(raw * (0.5 + random()));
}

function retryableStatus(status) {
  return status === 408 || status === 416 || status === 429 || status === 404 || status === 410 || status >= 500;
}

/**
 * Upload one File sequentially to a preauthenticated Graph session.
 * `authorizeStatus` must independently authorize the caller and return live
 * Graph state. It is called after every ambiguous PUT and after a final 200/201.
 */
export async function uploadBrowserDirectGraphFile({
  file,
  uploadUrl: initialUploadUrl,
  start = 0,
  chunkBytes = GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
  signal,
  pauseSignal,
  shouldPause = () => false,
  onState = () => {},
  authorizeStatus,
  xhrFactory = () => new XMLHttpRequest(),
  stallTimeoutMs = GRAPH_UPLOAD_STALL_TIMEOUT_MS,
  responseTimeoutMs = GRAPH_UPLOAD_RESPONSE_TIMEOUT_MS,
  offlineWaitMs = GRAPH_UPLOAD_OFFLINE_WAIT_MS,
  maxNoProgressAttempts = GRAPH_UPLOAD_MAX_NO_PROGRESS_ATTEMPTS,
  maxConsecutiveThrottles = GRAPH_UPLOAD_MAX_CONSECUTIVE_THROTTLES,
  maxThrottleWaitMs = GRAPH_UPLOAD_MAX_THROTTLE_WAIT_MS,
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
  backoffCapMs = DEFAULT_BACKOFF_CAP_MS,
  minimumRateSampleMs = DEFAULT_RATE_SAMPLE_MS,
  rateStaleMs = GRAPH_UPLOAD_RATE_STALE_MS,
  now = () => Date.now(),
  random = Math.random,
  isOnline = () => globalThis.navigator?.onLine !== false,
  waitForOnline = (options) => waitForBrowserOnline(options),
  sleep = (ms, sleepSignal, waitPauseSignal) => sleepWithSignal(ms, sleepSignal, waitPauseSignal),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  if (!file || !Number.isInteger(file.size) || file.size <= 0) throw new Error('A file is required.');
  if (!initialUploadUrl || typeof authorizeStatus !== 'function'
    || !Number.isInteger(chunkBytes) || chunkBytes <= 0
    || chunkBytes % GRAPH_UPLOAD_ALIGNMENT_BYTES !== 0
    || chunkBytes >= 60 * 1024 * 1024) {
    throw new Error('The upload session contract is invalid.');
  }
  if (!Number.isInteger(start) || start < 0 || start > file.size) {
    throw new Error('The upload resume position is invalid.');
  }
  for (const value of [stallTimeoutMs, responseTimeoutMs, offlineWaitMs, maxNoProgressAttempts,
    maxConsecutiveThrottles, maxThrottleWaitMs, backoffBaseMs, backoffCapMs, minimumRateSampleMs,
    rateStaleMs]) {
    if (!Number.isInteger(value) || value <= 0) throw new Error('The upload retry policy is invalid.');
  }

  let uploadUrl = initialUploadUrl;
  let offset = start;
  let rateConfirmedBytes = 0;
  let rateActiveMs = 0;
  let noProgressAttempts = 0;
  let consecutiveThrottles = 0;
  let throttleWaitMs = 0;
  let expiresAt = null;

  const emit = (phase, extra = {}) => onState({
    phase,
    ...transferMetrics({
      confirmedBytes: offset,
      inFlightBytes: offset,
      totalBytes: file.size,
      rateConfirmedBytes,
      rateActiveMs,
      minimumRateSampleMs,
    }),
    expiresAt,
    ...extra,
  });

  const pauseResult = (reason) => {
    emit('paused', { reason, etaSeconds: null });
    return { complete: false, paused: true, reason, nextStart: offset, expiresAt };
  };

  const reconcile = async ({
    reason,
    status = null,
    countNoProgress = true,
    confirmedByCurrentPut = 0,
    activeMsForCurrentPut = 0,
  }) => {
    emit('reconnecting', { reason, etaSeconds: null, retryAttempt: noProgressAttempts + 1 });
    const live = await authorizeStatus({
      reason,
      status,
      confirmedBytes: offset,
      totalBytes: file.size,
      signal,
    });
    if (live?.complete) {
      rateConfirmedBytes += confirmedByCurrentPut;
      rateActiveMs += activeMsForCurrentPut;
      offset = file.size;
      expiresAt = live.expiresAt || expiresAt;
      emit('complete', { confirmedBytes: file.size, inFlightBytes: file.size, percent: 100, etaSeconds: 0 });
      return { complete: true };
    }
    if (!live?.uploadUrl) {
      throw new GraphBrowserUploadError('The authorized upload status omitted the session URL.', {
        code: 'graph_upload_status_invalid',
      });
    }
    const next = requireRangeStart(live.nextExpectedRanges, {
      minimum: offset,
      maximum: file.size,
      allowEqual: true,
      source: 'status',
    });
    if (next === file.size) {
      throw new GraphBrowserUploadError(
        'Graph reported no missing bytes before the application verified the committed item.',
        { code: 'graph_upload_status_unverified_complete' },
      );
    }
    const progressed = next > offset;
    offset = next;
    uploadUrl = live.uploadUrl;
    expiresAt = live.expiresAt || expiresAt;
    if (progressed) {
      noProgressAttempts = 0;
      consecutiveThrottles = 0;
      throttleWaitMs = 0;
      emit('uploading');
    } else if (countNoProgress) {
      noProgressAttempts += 1;
    }
    return { complete: false, progressed };
  };

  while (offset < file.size) {
    if (signal?.aborted) throw abortError();
    if (shouldPause()) return pauseResult('requested');
    if (!isOnline()) {
      emit('reconnecting', { reason: 'offline', etaSeconds: null });
      const online = await waitForOnline({ timeoutMs: offlineWaitMs, signal, pauseSignal });
      if (online === 'paused' || shouldPause()) return pauseResult('requested');
      if (!online) return pauseResult('offline_timeout');
      emit('reconnecting', { reason: 'online_status_check', etaSeconds: null });
      const live = await reconcile({ reason: 'online', countNoProgress: false });
      if (live.complete) return { complete: true, paused: false, nextStart: file.size, expiresAt };
      if (noProgressAttempts >= maxNoProgressAttempts) return pauseResult('retry_exhausted');
    }

    const endExclusive = Math.min(offset + chunkBytes, file.size);
    const contentRange = `bytes ${offset}-${endExclusive - 1}/${file.size}`;
    const fragment = file.slice(offset, endExclusive);
    const fragmentStart = now();
    let response;
    try {
      emit('uploading');
      response = await uploadFragmentWithXhr({
        uploadUrl,
        contentRange,
        body: fragment,
        signal,
        xhrFactory,
        stallTimeoutMs,
        responseTimeoutMs,
        rateStaleMs,
        setTimeoutImpl,
        clearTimeoutImpl,
        now,
        onUploadProgress: (loaded, { rateStale = false } = {}) => {
          const pausing = shouldPause();
          const metrics = transferMetrics({
            confirmedBytes: offset,
            inFlightBytes: Math.min(offset + loaded, endExclusive),
            totalBytes: file.size,
            rateConfirmedBytes,
            rateActiveMs,
            minimumRateSampleMs,
          });
          onState({
            phase: pausing ? 'pausing' : 'uploading',
            ...metrics,
            // Rate and ETA are based only on confirmed bytes; pausing leaves
            // the current in-flight fragment explicitly non-durable.
            mbps: rateStale ? null : metrics.mbps,
            etaSeconds: pausing || rateStale ? null : metrics.etaSeconds,
            rateStale,
            expiresAt,
          });
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!isOnline()) continue;
      const live = await reconcile({ reason: error?.code || 'network_error' });
      if (live.complete) return { complete: true, paused: false, nextStart: file.size, expiresAt };
      if (noProgressAttempts >= maxNoProgressAttempts) return pauseResult('retry_exhausted');
      if (!live.progressed) {
        const delay = retryDelay(noProgressAttempts, backoffBaseMs, backoffCapMs, random);
        emit('reconnecting', { reason: 'backoff', retryInMs: delay, etaSeconds: null });
        const waited = pauseSignal
          ? await sleep(delay, signal, pauseSignal)
          : await sleep(delay, signal);
        if (waited === false || shouldPause()) return pauseResult('requested');
      }
      continue;
    }
    const fragmentActiveMs = Math.max(0, now() - fragmentStart);

    if (response.status === 200 || response.status === 201) {
      const live = await reconcile({
        reason: 'final_commit',
        status: response.status,
        confirmedByCurrentPut: endExclusive - offset,
        activeMsForCurrentPut: fragmentActiveMs,
      });
      if (live.complete) return { complete: true, paused: false, nextStart: file.size, expiresAt };
      if (noProgressAttempts >= maxNoProgressAttempts) return pauseResult('retry_exhausted');
      continue;
    }

    if (response.ok && response.status === 202) {
      const body = await response.json();
      const next = requireRangeStart(body.nextExpectedRanges, {
        minimum: offset,
        maximum: endExclusive,
        allowEqual: false,
        source: 'fragment',
      });
      rateConfirmedBytes += next - offset;
      rateActiveMs += fragmentActiveMs;
      offset = next;
      expiresAt = body.expirationDateTime || expiresAt;
      noProgressAttempts = 0;
      consecutiveThrottles = 0;
      throttleWaitMs = 0;
      emit('uploading');
      continue;
    }

    if (!retryableStatus(response.status)) {
      throw new GraphBrowserUploadError(`Microsoft rejected upload fragment ${response.status}.`, {
        code: 'graph_upload_rejected',
        status: response.status,
      });
    }

    if (response.status === 429) {
      consecutiveThrottles += 1;
      const delay = response.retryAfterMs ?? retryDelay(consecutiveThrottles, backoffBaseMs, backoffCapMs, random);
      if (consecutiveThrottles >= maxConsecutiveThrottles
        || throttleWaitMs + delay >= maxThrottleWaitMs) return pauseResult('throttled');
      throttleWaitMs += delay;
      emit('reconnecting', { reason: 'throttled', retryInMs: delay, etaSeconds: null });
      // Retry-After governs the next Graph status or PUT request, not just
      // the next fragment PUT.
      const waited = pauseSignal
        ? await sleep(delay, signal, pauseSignal)
        : await sleep(delay, signal);
      if (waited === false || shouldPause()) return pauseResult('requested');
    } else {
      consecutiveThrottles = 0;
    }

    const live = await reconcile({ reason: `http_${response.status}`, status: response.status });
    if (live.complete) return { complete: true, paused: false, nextStart: file.size, expiresAt };
    if (noProgressAttempts >= maxNoProgressAttempts) return pauseResult('retry_exhausted');
    if (!live.progressed && response.status !== 429) {
      const delay = retryDelay(noProgressAttempts, backoffBaseMs, backoffCapMs, random);
      emit('reconnecting', { reason: 'backoff', retryInMs: delay, etaSeconds: null });
      const waited = pauseSignal
        ? await sleep(delay, signal, pauseSignal)
        : await sleep(delay, signal);
      if (waited === false || shouldPause()) return pauseResult('requested');
    }
  }

  const live = await reconcile({ reason: 'all_ranges_reported' });
  if (live.complete) return { complete: true, paused: false, nextStart: file.size, expiresAt };
  throw new GraphBrowserUploadError(
    'Graph reported all ranges uploaded before the application verified the committed item.',
    { code: 'graph_upload_status_unverified_complete' },
  );
}
