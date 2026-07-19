/**
 * ReviewerIdentityShadowLog — durable, best-effort persistence for the shadow
 * comparisons emitted by lib/services/reviewer-identity-runtime.js.
 *
 * Contract (must hold at every call site):
 * - Non-authoritative observability only. Nothing reads this table on any
 *   reviewer decision path.
 * - Never throws synchronously or asynchronously; a storage outage, timeout,
 *   or schema drift degrades to a console warning.
 * - Stores only the whitelisted scalar fields below. No candidate names,
 *   email addresses, proposal content, provider payloads, identity anchors,
 *   or secrets — candidate_key is the runtime's truncated SHA-256 hash.
 * - Bounded: values are length-clamped here; row lifetime is bounded by
 *   MaintenanceService.cleanupReviewerIdentityShadowLog (retention + row cap).
 * - Circuit breaker: after FAILURE_THRESHOLD consecutive insert failures,
 *   writes are skipped for COOLDOWN_MS so a down database is not hammered
 *   once per candidate.
 */

const { sql } = require('@vercel/postgres');

const MAX_TEXT = 120;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;
const INSERT_TIMEOUT_MS = 2_000;

const breaker = {
  consecutiveFailures: 0,
  suspendedUntil: 0,
};

function clampText(value) {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, MAX_TEXT);
}

function clampBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function breakerOpen(now) {
  return now < breaker.suspendedUntil;
}

function recordFailure(now, error) {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.suspendedUntil = now + COOLDOWN_MS;
    breaker.consecutiveFailures = 0;
  }
  console.warn('[reviewer-identity-shadow-log] insert failed (best-effort, dropped):', error?.message);
}

function recordSuccess() {
  breaker.consecutiveFailures = 0;
  breaker.suspendedUntil = 0;
}

/**
 * Insert one row. Returns a promise that always resolves ('inserted',
 * 'skipped', or 'failed'). Runtime callers await the outcome, and this helper
 * bounds that wait so observability cannot hold the reviewer request open.
 */
function insertRow(row) {
  const now = Date.now();
  if (breakerOpen(now)) return Promise.resolve('skipped');
  try {
    const insertPromise = sql`
      INSERT INTO reviewer_identity_shadow_log
        (run_id, resolver_mode, event_type, candidate_key, legacy_decision,
         works_decision, combined_decision, combined_reason, anchors_agree,
         error_code)
      VALUES
        (${row.runId}, ${row.resolverMode}, ${row.eventType}, ${row.candidateKey},
         ${row.legacyDecision}, ${row.worksDecision}, ${row.combinedDecision},
         ${row.combinedReason}, ${row.anchorsAgree}, ${row.errorCode})
    `;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome, error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (outcome === 'inserted') recordSuccess();
        else recordFailure(Date.now(), error);
        resolve(outcome);
      };
      const timeoutId = setTimeout(() => {
        const error = new Error('reviewer_identity_shadow_log_timeout');
        error.code = 'reviewer_identity_shadow_log_timeout';
        finish('failed', error);
      }, INSERT_TIMEOUT_MS);
      Promise.resolve(insertPromise)
        .then(() => finish('inserted'))
        .catch((error) => finish('failed', error));
    });
  } catch (error) {
    recordFailure(Date.now(), error);
    return Promise.resolve('failed');
  }
}

/**
 * Persist one shadow comparison. Whitelisted fields only; everything else on
 * the entry object is ignored by construction.
 */
function recordShadowComparison(entry = {}) {
  return insertRow({
    runId: clampText(entry.runId),
    resolverMode: clampText(entry.resolverMode) || 'shadow',
    eventType: 'comparison',
    candidateKey: clampText(entry.candidateKey),
    legacyDecision: clampText(entry.legacyDecision),
    worksDecision: clampText(entry.worksDecision),
    combinedDecision: clampText(entry.combinedDecision),
    combinedReason: clampText(entry.combinedReason),
    anchorsAgree: clampBoolean(entry.anchorsAgree),
    errorCode: null,
  });
}

/**
 * Persist one shadow failure. Only a stable error code/name is stored —
 * never the error message, which can echo provider payload fragments.
 */
function recordShadowError(entry = {}) {
  return insertRow({
    runId: clampText(entry.runId),
    resolverMode: clampText(entry.resolverMode) || 'shadow',
    eventType: 'error',
    candidateKey: clampText(entry.candidateKey),
    legacyDecision: null,
    worksDecision: null,
    combinedDecision: null,
    combinedReason: null,
    anchorsAgree: null,
    errorCode: clampText(entry.errorCode) || 'Error',
  });
}

module.exports = {
  recordShadowComparison,
  recordShadowError,
  _internals: {
    MAX_TEXT,
    FAILURE_THRESHOLD,
    COOLDOWN_MS,
    INSERT_TIMEOUT_MS,
    breaker,
    clampText,
    insertRow,
    resetBreaker() {
      breaker.consecutiveFailures = 0;
      breaker.suspendedUntil = 0;
    },
  },
};
