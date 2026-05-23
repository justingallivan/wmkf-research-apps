/**
 * Drain error classifier — maps a structured error (from
 * `lib/utils/service-error.js` builders, or a raw pg error) to one of the
 * categories the drain state machine acts on.
 *
 * Categories (drain plan v7 §"Error taxonomy" + §"Explicit pg SQLSTATE mapping"):
 *   duplicate_pk          state-specific recovery; else success-advance
 *   validation_400        terminal `failed` immediately
 *   auth_4xx              terminal `failed`; alert system_alerts
 *   not_found_404         terminal `failed`
 *   throttle_429          retry with backoff; max_attempts=10
 *   transient_5xx         retry with backoff; max_attempts=10
 *   network_no_response   retry with backoff; max_attempts=10
 *   pg_transient          retry with backoff; max_attempts=10 (deadlock / serialization)
 *   scan_infected         terminal `failed` (caught at upload; rare to reach drain)
 *   scan_error            retry up to 3; then terminal `failed`
 *   unknown               surface as transient + alert (defensive)
 *
 * Contract: reads structured fields ONLY — never string-parses `err.message`.
 * Returns `{ category, retryable, maxAttempts }`. `maxAttempts` is the per-
 * category cap; callers compare against `submission_jobs.attempts`.
 */
'use strict';

// Per-category retry caps from drain plan v7.
const CAPS = Object.freeze({
  duplicate_pk: 1, // recovery is one-shot; either succeeds or success-advances
  validation_400: 0,
  auth_4xx: 0,
  not_found_404: 0,
  throttle_429: 10,
  transient_5xx: 10,
  network_no_response: 10,
  pg_transient: 10,
  scan_infected: 0,
  scan_error: 3,
  unknown: 10, // defensive — treat opaque errors as transient
});

const PG_DEADLOCK = '40P01';
const PG_SERIALIZATION = '40001';
const PG_UNIQUE_VIOLATION = '23505';
const PG_CONNECTION_FAMILY = ['08000', '08003', '08006', '08001', '08004', '08007'];

function classify(err) {
  if (!err || typeof err !== 'object') {
    return _build('unknown');
  }

  // Postgres branch first — sqlState wins over status when both present
  // because a wrapped pg error may have status=500 set defensively.
  if (err.serviceName === 'postgres' || err.sqlState || err.code?.startsWith?.('08')) {
    const sqlState = err.sqlState ?? err.code ?? null;
    if (sqlState === PG_DEADLOCK || sqlState === PG_SERIALIZATION) return _build('pg_transient');
    if (sqlState === PG_UNIQUE_VIOLATION) return _build('duplicate_pk');
    if (sqlState && PG_CONNECTION_FAMILY.includes(sqlState)) return _build('network_no_response');
    // Native node errors on pg connection failure: ETIMEDOUT / ECONNREFUSED
    if (err.noResponse === true) return _build('network_no_response');
    // 23xxx other (check, not-null, fk) — validation-class
    if (sqlState && /^23/.test(sqlState)) return _build('validation_400');
    // Anything else with a serviceName=postgres tag and no sqlState — treat as transient
    return _build('unknown');
  }

  // No-response branch
  if (err.noResponse === true) return _build('network_no_response');

  // Cloudmersive scan results are pre-classified into `scan_result`; the
  // calling drain step decides infected/error/clean and only THIS classifier
  // is invoked on the residual scan error path.
  if (err.scanResult === 'infected') return _build('scan_infected');
  if (err.serviceName === 'cloudmersive' && err.status >= 500) return _build('scan_error');

  // HTTP status branch
  const status = err.status;
  if (typeof status === 'number') {
    // Duplicate-PK on Create with our GUID (Dataverse) — 412 (precondition)
    // or 409 (conflict). The drain plan calls out both shapes.
    if ((status === 412 || status === 409) && err.serviceName === 'dataverse') {
      return _build('duplicate_pk');
    }
    if (status === 401 || status === 403) return _build('auth_4xx');
    if (status === 404) return _build('not_found_404');
    if (status === 429) return _build('throttle_429');
    if (status === 408) return _build('transient_5xx'); // 408 follows the 5xx path per service-error.js
    if (status >= 500 && status < 600) return _build('transient_5xx');
    if (status >= 400 && status < 500) return _build('validation_400');
  }

  return _build('unknown');
}

function _build(category) {
  const maxAttempts = CAPS[category] ?? CAPS.unknown;
  return {
    category,
    retryable: maxAttempts > 0,
    maxAttempts,
  };
}

module.exports = {
  classify,
  CAPS,
};
