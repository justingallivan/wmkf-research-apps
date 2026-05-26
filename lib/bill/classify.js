/**
 * Classify a BILL.com API response (success-or-error) into a retry+throw decision.
 *
 * BILL quirks:
 *   - Rate-limit errors come back as 4xx with BDC codes in the body, NOT HTTP 429.
 *   - HTTP 200 can carry an error-array-shaped body (defensive case — rare).
 *   - Error body shape: array of `{ timestamp, code, severity, category, message, detail, help }`.
 *   - All codes prefixed `BDC_`.
 *
 * Categories returned by classify():
 *   'ok'                       - 2xx and body parses as data (or is empty for void responses)
 *   'session_expired'          - BDC_1109: invalidate cache + reauth + retry (internal)
 *   'auth'                     - BDC_1101 / BDC_1102: bad credentials or dev key
 *   'rate_limited_concurrent'  - BDC_1322: retry with exp backoff
 *   'rate_limited_hourly'      - BDC_1144: fail loud — 60-min reset window, useless to retry
 *   'validation'               - 4xx client errors (caller-fixable)
 *   'server'                   - 5xx or unparseable 5xx body
 *   'unknown_client'           - 4xx with unparseable body
 *   'transient'                - network error / abort (no response object)
 */

const BDC_PREFIX = 'BDC_';

const BDC_TO_CATEGORY = {
  BDC_1109: 'session_expired',
  BDC_1101: 'auth',
  BDC_1102: 'auth',
  BDC_1144: 'rate_limited_hourly',
  BDC_1322: 'rate_limited_concurrent',
};

/**
 * Extract BDC codes from a parsed body. BILL's error envelope is an array of
 * error objects; some endpoints may wrap it (e.g. `{ errors: [...] }`).
 * @returns {string[]}
 */
export function extractBdcCodes(parsedBody) {
  if (!parsedBody) return [];
  let arr = null;
  if (Array.isArray(parsedBody)) arr = parsedBody;
  else if (Array.isArray(parsedBody.errors)) arr = parsedBody.errors;
  if (!arr) return [];
  return arr
    .map(e => (e && typeof e.code === 'string' ? e.code : null))
    .filter(c => c && c.startsWith(BDC_PREFIX));
}

/**
 * Check whether a body has the BILL error-envelope shape (array of {code, ...}).
 */
export function looksLikeErrorEnvelope(parsedBody) {
  return extractBdcCodes(parsedBody).length > 0;
}

/**
 * Classify a response. Caller passes either:
 *   { status, parsedBody }     — for response-based classification
 *   { networkError: true }     — for network/abort errors
 *
 * Returns: { category, codes, retryable }
 *   `retryable` is the classifier's recommendation; the call-site still applies
 *   the per-category retry budget.
 */
export function classify({ status, parsedBody, networkError = false }) {
  if (networkError) {
    return { category: 'transient', codes: [], retryable: true };
  }

  const codes = extractBdcCodes(parsedBody);

  // Map by first known BDC code. BILL bodies can carry multiple errors;
  // we classify by the most-specific actionable code (the first known one).
  for (const code of codes) {
    const cat = BDC_TO_CATEGORY[code];
    if (cat) {
      return {
        category: cat,
        codes,
        retryable: cat === 'session_expired'
          || cat === 'rate_limited_concurrent'
          || cat === 'server',
      };
    }
  }

  // 2xx with body that ISN'T error-shaped → ok
  if (status >= 200 && status < 300 && !looksLikeErrorEnvelope(parsedBody)) {
    return { category: 'ok', codes: [], retryable: false };
  }

  // 2xx with body that IS error-shaped but no known BDC code → treat as validation
  if (status >= 200 && status < 300 && looksLikeErrorEnvelope(parsedBody)) {
    return { category: 'validation', codes, retryable: false };
  }

  // 5xx (parseable error array, no known BDC code) → server
  if (status >= 500) {
    return { category: 'server', codes, retryable: true };
  }

  // 4xx with parseable error array → validation
  if (status >= 400 && codes.length > 0) {
    return { category: 'validation', codes, retryable: false };
  }

  // 4xx with unparseable body → unknown_client (no retry)
  if (status >= 400 && status < 500) {
    return { category: 'unknown_client', codes: [], retryable: false };
  }

  // Catch-all
  return { category: 'unknown_client', codes, retryable: false };
}
