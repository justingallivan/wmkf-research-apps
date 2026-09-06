// @ts-check
/**
 * Strict concrete-ETag validation for optimistic-concurrency `ifMatch` values.
 *
 * A Dataverse `If-Match` header must be a single, concrete entity-tag —
 * `"1"` or the weak form `W/"1"` — never the wildcard `*` (which means "any
 * version, overwrite unconditionally" and defeats the whole point of a
 * conditional write) and never an empty or malformed quoted-string.
 *
 * Single source of the concrete-ETag rule. Introduced in Stage 5A for new
 * call sites; the four pre-existing inline copies (the adapter's
 * invitation-response guard, `correct-response.js`, `expire-invitation.js`,
 * `record-email-outcome.js`) were consolidated onto it 2026-09-06 (S490).
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isConcreteEtag(value) {
  return typeof value === 'string'
    && value === value.trim()
    && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
}
