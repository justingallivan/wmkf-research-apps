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
  // with caller signals is not currently supported (round-11 §2). No call site
  // in graph-service.js passes one today; if a future caller needs caller-driven
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
