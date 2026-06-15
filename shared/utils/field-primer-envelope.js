/**
 * Field Primer envelope + generation-lease helpers — shared by the API route
 * (write/validate) and the Workbench Proposal tab (parse/render), so the stored
 * shape can never drift between producer and consumer.
 *
 * The `wmkf_ai_fieldprimer` Memo holds ONE of:
 *   - a DONE envelope:  { schema: 'field-primer/v1', generatedAt, model, runId,
 *                         promptName, promptVersion, primer }
 *   - a generation LEASE: { schema: 'field-primer/lease', startedAt }  (transient,
 *                         written via an ETag-conditional claim so only one cold
 *                         generation runs per request; auto-expires after the TTL)
 *   - null (never generated)
 */

export const FIELD_PRIMER_ENVELOPE_SCHEMA = 'field-primer/v1';
export const FIELD_PRIMER_LEASE_SCHEMA = 'field-primer/lease';
// Generation (pull + LLM + grounding) is well under a minute; give the lease a
// generous ceiling so a crashed generation's stale lease becomes re-claimable.
export const FIELD_PRIMER_LEASE_TTL_MS = 180_000;

export function isFieldPrimerEnvelope(env) {
  return !!env
    && env.schema === FIELD_PRIMER_ENVELOPE_SCHEMA
    && !!env.primer && typeof env.primer === 'object'
    && typeof env.generatedAt === 'string';
}

function asObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return typeof raw === 'object' ? raw : null;
}

/** Parse a stored value into a DONE envelope, or null if absent/lease/malformed. */
export function parseFieldPrimerEnvelope(raw) {
  const env = asObject(raw);
  return isFieldPrimerEnvelope(env) ? env : null;
}

/**
 * Parse a stored value into a generation lease. Returns { startedAt, nonce, fresh }
 * or null. `nowMs` is passed in by the caller (no Date.now() in shared code).
 * A future-dated lease (age < 0 — clock skew or tampering) is treated as NOT fresh
 * so it can never block generation indefinitely.
 */
export function parseFieldPrimerLease(raw, nowMs) {
  const env = asObject(raw);
  if (!env || env.schema !== FIELD_PRIMER_LEASE_SCHEMA || typeof env.startedAt !== 'string') return null;
  const startedMs = Date.parse(env.startedAt);
  if (Number.isNaN(startedMs)) return null;
  const age = nowMs - startedMs;
  return {
    startedAt: env.startedAt,
    nonce: typeof env.nonce === 'string' ? env.nonce : null,
    fresh: age >= 0 && age < FIELD_PRIMER_LEASE_TTL_MS,
  };
}

export function makeFieldPrimerLease(startedAtIso, nonce) {
  return JSON.stringify({ schema: FIELD_PRIMER_LEASE_SCHEMA, startedAt: startedAtIso, nonce });
}
