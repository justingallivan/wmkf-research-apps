/**
 * OData query-fragment builders shared by the Dataverse adapters.
 *
 * These are string primitives, extracted verbatim from the per-adapter helpers
 * that predate this module (`escapeOdataString` was hand-copied into contact.js
 * and potential-reviewer.js; reviewer-suggestion.js inlined the same
 * `String(x).replace(/'/g, "''")`). Centralizing them removes that drift while
 * producing byte-identical output — the adapters' characterization tests are the
 * safety net (Stage 2 behavior freeze).
 *
 * Escaping rule: an OData single-quoted string literal escapes an embedded
 * quote by doubling it (`''`). This is NOT SQL-style backslash escaping.
 */

import { isGuid } from '../../utils/guid.js';

/**
 * Escape a value for embedding inside an OData single-quoted string literal.
 * `String(value)` first so non-string inputs match the legacy adapter behavior.
 */
export function escape(value) {
  return String(value).replace(/'/g, "''");
}

/** `field eq 'value'` — quoted, escaped string equality. */
export function eq(field, value) {
  return `${field} eq '${escape(value)}'`;
}

/**
 * `field eq value` — RAW (unquoted) equality for numbers, `null`, booleans, or a
 * caller-escaped lookup value. The caller owns correctness of `value`; use `eq`
 * for user strings and `eqGuid` for client-supplied record ids.
 */
export function eqRaw(field, value) {
  return `${field} eq ${value}`;
}

/**
 * `field eq <guid>` — rejects a non-GUID value BEFORE interpolation, matching the
 * trust-boundary convention enforced by scripts/check-trust-boundary-guid.js
 * (a raw id interpolated into a `$filter` is a filter-injection vector). Callers
 * that already validated the id upstream still pass through unchanged.
 */
export function eqGuid(field, value) {
  if (!isGuid(value)) {
    throw new Error(`odata.eqGuid: ${field} value must be a GUID`);
  }
  return `${field} eq ${value}`;
}

/** `startswith(field,'value')` — quoted, escaped prefix match. */
export function startsWith(field, value) {
  return `startswith(${field},'${escape(value)}')`;
}

/** `contains(field,'value')` — quoted, escaped substring match. */
export function contains(field, value) {
  return `contains(${field},'${escape(value)}')`;
}

/** Join filter fragments with ` and ` (no wrapping parens — the caller adds them). */
export function and(parts) {
  return parts.join(' and ');
}

/** Join filter fragments with ` or ` (no wrapping parens — the caller adds them). */
export function or(parts) {
  return parts.join(' or ');
}

/**
 * Build a `$select` string from a field list. Identical to the `list.join(',')`
 * the adapters have always used; a string passes through unchanged.
 */
export function select(fields) {
  return Array.isArray(fields) ? fields.join(',') : String(fields);
}
