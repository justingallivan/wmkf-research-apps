/**
 * Strict Dataverse record-id (GUID) validation for CLIENT-SUPPLIED selectors.
 *
 * Any value that becomes a Dataverse key predicate — `getRecord(set, id)`,
 * `updateRecord(set, id, …)`, an adapter `findById(id)` / `updateLifecycle(id)` —
 * or is interpolated into an OData `$filter` (`_wmkf_request_value eq ${id}`) is
 * INJECTABLE when it arrives unvalidated from `req.body` / `req.query`.
 * `DynamicsService.getRecord` interpolates the id raw into the request URL
 * (`${entitySet}(${recordId})`, see lib/services/dynamics-service.js), so a
 * crafted value can break out of the key predicate (over-fetch / IDOR) and an
 * unquoted `$filter` interpolation can break out of the filter. Validate at the
 * route edge BEFORE the id reaches any selector. Server-derived ids (read back
 * off a row we already fetched) are trusted and need no re-check.
 *
 * Mirrors the canonical inline check in
 * pages/api/workbench/resolve-request.js; enforced by
 * scripts/check-trust-boundary-guid.js.
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True iff `value` is a string that is exactly a GUID (trimmed). */
export function isGuid(value) {
  return typeof value === 'string' && GUID_RE.test(value.trim());
}

/**
 * True iff `value` is a non-empty array whose every element is a GUID. Use for
 * batch id payloads (`suggestionIds: [...]`) before any element reaches a
 * selector.
 */
export function allGuids(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isGuid);
}

export { GUID_RE };
