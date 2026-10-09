import { buildNoResponseError } from '../../utils/service-error.js';
import { emitDependencyEvent } from '../../observability/request-correlation.js';
import { API_TIMEOUT } from './constants.js';

export function clampApiTimeout(timeoutMs) {
  return Math.max(1, Math.min(API_TIMEOUT, Number.isFinite(timeoutMs) ? timeoutMs : API_TIMEOUT));
}

export function deadlineTimeoutError(timeoutMs) {
  const error = new Error(`Graph request exceeded its ${timeoutMs}ms caller deadline.`);
  error.name = 'AbortError';
  return buildNoResponseError('graph', error);
}

export function remainingTimeoutMs(deadline, originalTimeoutMs) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw deadlineTimeoutError(originalTimeoutMs);
  return clampApiTimeout(remaining);
}

export async function waitForPromiseWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(deadlineTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Defense in depth: emitDependencyEvent already wraps its whole body in
// try/catch, but guard the call site too (mirrors lib/dataverse/client.js
// emitTelemetry) so a hypothetical throw from the emitter can never escape
// into this seam's try/catch and corrupt the Response/structured-error shape.
export function safeEmitDependencyEvent(params) {
  try {
    emitDependencyEvent(params);
  } catch {
    // Telemetry must never break the transport — mirror lib/dataverse/client.js emitTelemetry.
  }
}

// Telemetry seam (Workbench Observability Stage 1): fetchWithTimeout emits
// one `workbench.dependency` event per fetch attempt via emitDependencyEvent
// (lib/observability/request-correlation.js) — success/http_error path right
// after the awaited fetch resolves, no-response path right after the
// structured error is built. Module-level token/site/drive caches sit above
// this helper, so a cache hit performs no fetch and emits no event.
export async function fetchWithTimeout(url, options, timeout) {
  // CONTRACT: this helper installs its own AbortSignal for the timeout.
  // Any caller-provided `options.signal` is silently overwritten — composition
  // with caller signals is not currently supported (round-11 §2). No Graph caller
  // passes one today; if a future caller needs caller-driven
  // cancellation, compose signals here (AbortSignal.any) rather than picking
  // one over the other.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, response });
    return response;
  } catch (err) {
    // Every no-response throw is wrapped so the drain's retry classifier sees
    // a structured error with err.noResponse / err.isTransient / err.causeKind
    // instead of having to string-parse err.message. See lib/utils/service-error.js.
    const structured = buildNoResponseError('graph', err);
    safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, error: structured });
    throw structured;
  } finally {
    clearTimeout(timer);
  }
}

// Like fetchWithTimeout, but the deadline covers the body read too: one
// AbortController aborts the fetch AND an in-flight response.json()/text(),
// and its timer is cleared only after `readBody(response)` settles. Use for
// calls whose body is read right after the headers (Graph upload sessions).
// Returns { response, body }; the caller decides what a non-ok status means.
// Header and body timeouts both surface as structured no-response errors;
// a body that arrives but fails to parse (SyntaxError) is rethrown unwrapped.
export async function fetchWithBodyTimeout(url, options, timeout, readBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();
  let response = null;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
    // Race the read against the abort signal too: undici aborts an active body
    // read itself, but a body that ignores the signal must still not hang us.
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(Object.assign(new Error('Graph response body timed out'), { name: 'AbortError' }));
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    let body;
    try {
      body = await Promise.race([readBody(response), aborted]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
    }
    safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, response });
    return { response, body };
  } catch (err) {
    const isParseError = response && !controller.signal.aborted && err instanceof SyntaxError;
    if (isParseError) {
      safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, response });
      throw err;
    }
    const structured = buildNoResponseError('graph', controller.signal.aborted && err?.name !== 'AbortError'
      ? Object.assign(new Error('Graph request exceeded its deadline'), { name: 'AbortError' })
      : err);
    safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, error: structured });
    throw structured;
  } finally {
    clearTimeout(timer);
  }
}
