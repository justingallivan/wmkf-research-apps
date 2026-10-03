/**
 * Per-process admission for memory-heavy staged-upload finalizers.
 * This is an instance-local guard, not a distributed lock; durable staging
 * claims remain the authority for ownership and replay safety.
 */
import crypto from 'node:crypto';

const HOLDER = Symbol.for('wmkf.large-upload-admission.v1');
// Assumes the host terminates these 300s routes; 60s grace permits takeover
// if a timed-out invocation leaves process-global state behind.
const STALE_AFTER_MS = 6 * 60 * 1000;
export const LARGE_UPLOAD_RETRY_AFTER_SECONDS = 30;

export function acquireLargeUploadAdmission(now = Date.now()) {
  const current = globalThis[HOLDER];
  const currentIsValid = current
    && typeof current.token === 'string'
    && Number.isFinite(current.acquiredAt);
  const currentIsStale = currentIsValid
    && now >= current.acquiredAt
    && now - current.acquiredAt >= STALE_AFTER_MS;

  if (currentIsValid && !currentIsStale) return null;

  const lease = { token: crypto.randomUUID(), acquiredAt: now };
  globalThis[HOLDER] = lease;
  return lease;
}

export function releaseLargeUploadAdmission(token) {
  const current = globalThis[HOLDER];
  if (!current || current.token !== token) return false;
  delete globalThis[HOLDER];
  return true;
}
