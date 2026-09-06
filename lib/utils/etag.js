// @ts-check
/**
 * Strict concrete-ETag validation for optimistic-concurrency `ifMatch` values.
 *
 * A Dataverse `If-Match` header must be a single, concrete entity-tag —
 * `"1"` or the weak form `W/"1"` — never the wildcard `*` (which means "any
 * version, overwrite unconditionally" and defeats the whole point of a
 * conditional write) and never an empty or malformed quoted-string.
 *
 * This is the same regex already inlined at four call sites (each guarding a
 * caller-supplied `_etag` before it reaches a conditional write):
 * `lib/dataverse/adapters/reviewer-suggestion.js:1986`,
 * `lib/services/reviewer-finder/my-candidates-service.js:696`,
 * `lib/services/reviewer-engagement/expire-invitation.js:66`,
 * `lib/services/reviewer-engagement/record-email-outcome.js:51`.
 * Centralized here as a single named helper for new call sites (Stage 5A);
 * the four existing inline sites are left as-is (a follow-up, not this
 * stage) to keep this change narrow.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isConcreteEtag(value) {
  return typeof value === 'string'
    && value === value.trim()
    && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
}
