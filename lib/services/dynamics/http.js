/**
 * DynamicsService decomposition — Stage 0 leaf module.
 *
 * Moved verbatim from lib/services/dynamics-service.js: buildHeaders
 * (:137-145, was a static method) and fetchWithTimeout (:1709-1728, was a
 * module-private function). buildHeaders is pure (reads only its `token`
 * arg). fetchWithTimeout takes `timeout` as a parameter — it does NOT read
 * API_TIMEOUT itself, so this module has no dependency on constants.js.
 *
 * Telemetry seam (Workbench Observability Stage 1): fetchWithTimeout emits
 * one `workbench.dependency` event per fetch attempt via emitDependencyEvent
 * (lib/observability/request-correlation.js) — success/http_error path right
 * after the awaited fetch resolves, no-response path right after the
 * structured error is built. The interlock's `assertDataverseOperationAllowed`
 * call stays before the try/timer block and is therefore neither timed nor
 * emitted — a policy denial is not a dependency call.
 */

import { buildNoResponseError } from '../../utils/service-error.js';
import { assertDataverseOperationAllowed } from '../../dataverse/core/interlock.js';
import { emitDependencyEvent } from '../../observability/request-correlation.js';

// Defense in depth: emitDependencyEvent already wraps its whole body in
// try/catch, but guard the call site too (mirrors lib/dataverse/client.js
// emitTelemetry) so a hypothetical throw from the emitter can never escape
// into this seam's try/catch and corrupt the Response/structured-error shape.
function safeEmitDependencyEvent(params) {
  try {
    emitDependencyEvent(params);
  } catch {
    // Telemetry must never break the transport — mirror lib/dataverse/client.js emitTelemetry.
  }
}

export function buildHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'OData-Version': '4.0',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'odata.include-annotations="*",odata.maxpagesize=100',
  };
}

export async function fetchWithTimeout(url, options, timeout) {
  // CONTRACT: this helper installs its own AbortSignal for the timeout.
  // Any caller-provided `options.signal` is silently overwritten — composition
  // with caller signals is not currently supported (round-11 §2). No call site
  // in dynamics-service.js or graph-service.js passes one today; if a future
  // caller needs caller-driven cancellation, compose signals here (AbortSignal.any)
  // rather than picking one over the other.
  //
  // Interlock (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.1) is called
  // BEFORE the try block, deliberately: the catch below wraps any throw into a
  // transient/no-response error for the drain's retry classifier. A policy
  // denial must propagate as-is, never be reclassified as a retryable network
  // failure. `assertDataverseOperationAllowed` self-scopes (no-ops on
  // non-Dataverse URLs and when the flag is off) — no local URL filtering here.
  assertDataverseOperationAllowed({ url, method: options?.method, callerLabel: 'dynamics/http.fetchWithTimeout' });
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
    const structured = buildNoResponseError('dataverse', err);
    safeEmitDependencyEvent({ url, method: options?.method, ms: Date.now() - startedAt, error: structured });
    throw structured;
  } finally {
    clearTimeout(timer);
  }
}
