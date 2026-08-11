/**
 * Sanitized adapter error factory.
 *
 * The adapters surface business-rule failures (not transport failures) as an
 * Error carrying a stable machine `code`, an HTTP-ish `status`, and structured
 * `details` — the shape routes already branch on (e.g. a 409 link conflict).
 * That shape was hand-rolled inline in each adapter (see the original
 * `reviewer_linked_elsewhere` / `contact_linked_elsewhere` throws in
 * potential-reviewer.setContactLink); this centralizes it, byte-for-byte.
 *
 * "Sanitized" = the error carries only the fields the adapter chose to expose.
 * It never wraps or forwards a raw Dataverse error payload (which can leak record
 * internals). Transport/Dataverse errors from DynamicsService are NOT wrapped
 * here — adapters deliberately let those propagate unchanged so callers can keep
 * branching on `err.status === 412` etc. (Stage 2 error-contract freeze).
 */

/**
 * Build an adapter business error.
 *
 * @param {string} message human-readable message
 * @param {object} [opts]
 * @param {string} [opts.code]    stable machine code (e.g. 'reviewer_linked_elsewhere')
 * @param {number} [opts.status]  HTTP-ish status (e.g. 409)
 * @param {object} [opts.details] structured, caller-safe context
 * @returns {Error} with `code`/`status`/`details` attached only when provided
 */
export function adapterError(message, { code, status, details } = {}) {
  const err = new Error(message);
  if (code !== undefined) err.code = code;
  if (status !== undefined) err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

// Dataverse ObjectDoesNotExist. Microsoft documents this exact structured code
// for a GET-by-id whose entity exists but whose requested record is gone. A bare
// HTTP 404 is not enough: bad entity-set/path segments are also 404s and must
// remain loud rather than being misclassified as a deleted row.
export const DATAVERSE_RECORD_NOT_FOUND_CODE = '0x80040217';

export function isDataverseRecordNotFound(error) {
  return error?.serviceName === 'dataverse'
    && error?.status === 404
    && String(error?.dataverseCode || '').toLowerCase() === DATAVERSE_RECORD_NOT_FOUND_CODE;
}
