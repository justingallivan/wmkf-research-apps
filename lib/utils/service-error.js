/**
 * Structured-error shape for external-service calls.
 *
 * Two builders, one for each fork of "the request didn't succeed":
 *   - buildServiceError(serviceName, resp, body)  — HTTP response with non-2xx status
 *   - buildNoResponseError(serviceName, cause)    — no response at all (timeout, DNS,
 *                                                    socket reset, abort, etc.)
 *
 * Why this exists (drain plan v7 §P1, Codex rounds 6+7): drain code at
 * /api/cron/drain-submissions (forthcoming) classifies failures into a retry
 * taxonomy — duplicate_pk / validation_400 / throttle_429 / transient_5xx /
 * network_no_response / etc. — and decides whether to retry, terminal-fail,
 * or treat-as-success. The classifier reads err.status / err.dataverseCode /
 * err.noResponse / err.isTransient, NOT string-parsing of err.message. Without
 * structured errors at every throw site upstream of the drain, the classifier
 * has to fall back to fragile message-pattern matching.
 *
 * Both builders attach `.serviceName` so a single classifier can fan out by
 * service ('dataverse' vs 'graph' vs 'postgres') without ambiguity.
 *
 * Contract:
 *   err.message       — human-readable; the legacy `err.message` callers see today
 *                       remains unchanged in shape ("<Service> <op> failed (<status>): <body>")
 *   err.serviceName   — 'dataverse' | 'graph' | 'postgres' | 'cloudmersive' | 'drain'
 *   err.status        — HTTP status (number) | null for no-response
 *   err.isTransient   — boolean; true for 429/5xx/no-response, false otherwise
 *   err.dataverseCode — Dataverse `error.code` string (e.g. '0x80060891') when present
 *   err.dataverseMessage — Dataverse `error.message` when present
 *   err.noResponse    — true only for no-response errors
 *   err.causeKind     — 'abort' | 'timeout' | 'socket' | 'dns' | 'unknown' (no-response only)
 *   err.cause         — original Error (no-response only)
 *
 * Adding new fields is fine; removing/renaming any of the above is a breaking
 * contract change for the drain classifier.
 */

export function buildServiceError(serviceName, resp, body) {
  const status = resp?.status ?? null;
  const e = new Error(`${serviceName} failed (${status}): ${typeof body === 'string' ? body : ''}`);
  e.serviceName = serviceName;
  e.status = status;
  e.isTransient = status === 429 || (status >= 500 && status < 600);
  if (typeof body === 'string' && body.length > 0) {
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.error?.code ?? parsed?.code;
      const message = parsed?.error?.message ?? parsed?.message;
      if (code) e.dataverseCode = code;
      if (message) e.dataverseMessage = message;
    } catch {
      // Non-JSON body — that's fine, just keep the raw text in .message.
    }
  }
  return e;
}

export function buildNoResponseError(serviceName, cause) {
  const causeMsg = cause?.message ?? String(cause ?? 'no-response');
  const e = new Error(`${serviceName} no-response: ${causeMsg}`);
  e.serviceName = serviceName;
  e.status = null;
  e.cause = cause;
  e.isTransient = true; // network/timeout/abort are retryable by default
  e.noResponse = true;
  // Best-effort cause tagging for diagnostics. The catch-site upstream may pass
  // either a native fetch error (with .name='AbortError'/.code='ETIMEDOUT') or
  // a wrapped throw — handle both.
  const name = cause?.name;
  const code = cause?.code;
  if (name === 'AbortError') e.causeKind = 'abort';
  else if (code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') e.causeKind = 'timeout';
  else if (code === 'ECONNRESET' || code === 'ECONNREFUSED') e.causeKind = 'socket';
  else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') e.causeKind = 'dns';
  else e.causeKind = 'unknown';
  return e;
}

