/**
 * Shared client-side JSON request helper.
 *
 * Purpose: one place for the fetch → parse-body → ok-check → error-message
 * dance that 308 client `fetch(` call sites in `shared/components/**` and
 * `pages/**` (excluding `pages/api/**`) currently hand-roll, each slightly
 * differently. Plain JavaScript, no React import, no side effects at import,
 * so it is usable from hooks, components, pages, and non-component stores.
 *
 * Invariants (each pinned by a unit test in tests/unit/api-request.test.js):
 * 1. `fetch` is resolved as `fetchImpl ?? globalThis.fetch` AT CALL TIME,
 *    never captured at module load — the repo's test convention reassigns
 *    `global.fetch` per test.
 * 2. A plain-object `body` is `JSON.stringify`'d and `Content-Type:
 *    application/json` is added unless the caller already set a
 *    content-type header (case-insensitive). `FormData`, `Blob`, `string`,
 *    and `URLSearchParams` bodies pass through untouched, with no
 *    content-type added. The option list is closed: `method, body, headers,
 *    signal, fallbackMessage, fetchImpl, tolerantBody`.
 * 3. Caller headers are merged over defaults, so headers like `If-Match` and
 *    `lock` survive untouched.
 * 4. Body parse is strict-on-success by default: an empty or unparseable 2xx
 *    body rejects with the native parse error, exactly like a bare
 *    `response.json()` does today (this preserves callers that rely on that
 *    rejection, e.g. an "uncertain outcome" branch on a malformed send-email
 *    receipt). `tolerantBody: true` returns `{}` on an empty/unparseable 2xx
 *    body instead. A non-2xx body is ALWAYS parsed tolerantly (empty or
 *    unparseable -> `{}`, with the native error recorded as `parseError`).
 *    In every mode, a rejection whose `name` is `'AbortError'`, or any
 *    rejection while `signal?.aborted` is true, is rethrown unchanged — an
 *    abort during the body read must never be swallowed into a `{}` result.
 * 5. Success is `response.ok` only. Body-level `ok`/`success` fields are
 *    never read or interpreted by this module.
 * 6. No retry, no redirect on 401/403, no toast, no global error handler.
 *    Those stay at call sites. `AbortError` identity is preserved: this
 *    module never wraps or renames a rejection from `fetch` or the body
 *    read.
 * 7. `ApiRequestError.payload` exposes the raw parsed body so call sites
 *    that read `.details`, `.reason`, or other custom fields keep working.
 * 8. Mechanics: the body parse step calls ONLY `response.json()` and reads
 *    `response.ok` / `response.status`. It never touches `response.headers`,
 *    `text()`, or `body`, so the repo's `{ ok, status, json }` test doubles
 *    keep working.
 *
 * The public default for `deriveErrorMessage`'s `preferParseError` option is
 * `false` — the owner's decision (3) in plan §9, accepted 2026-09-20: a
 * non-2xx non-JSON body surfaces the call site's fallback message rather
 * than the raw parse error. `parseError` is always recorded on
 * `ApiRequestError` regardless of that default.
 *
 * Zero callers through Stage 0; Stage 1 folds four existing partial adapters
 * (readResponse x2, readJson, sendJson) over `readJsonBody`. See
 * docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §3.
 */

export class ApiRequestError extends Error {
  constructor(message, { status, payload, parseError = null } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
    this.parseError = parseError;
  }
}

/**
 * Pure function computing the error message for a non-2xx response.
 * Message rule: a non-empty string `payload.error` wins; else an object
 * `payload.error.message` that is a non-empty string; else a non-empty
 * string `payload.message`; else `fallbackMessage`; else
 * `Request failed (${status})`. An empty string (`''`) at `payload.error` or
 * `payload.message` is treated as absent, falling through to the next rule
 * in the chain — this matches the legacy `body.error || fallback` pattern.
 * A non-string `error.message` (e.g. `{error:{message:5}}`) is ignored and
 * also falls through. When `preferParseError` is true and a `parseError`
 * was recorded, its message is used first, ahead of the body rule (owner
 * decision (3) "decline" branch; not the public default).
 */
export function deriveErrorMessage(payload, parseError, fallbackMessage, status, { preferParseError = false } = {}) {
  if (preferParseError && parseError) {
    return parseError.message;
  }
  if (typeof payload === 'object' && payload !== null) {
    const err = payload.error;
    if (typeof err === 'string' && err !== '') return err;
    if (err && typeof err === 'object' && typeof err.message === 'string' && err.message !== '') return err.message;
    if (typeof payload.message === 'string' && payload.message !== '') return payload.message;
  }
  if (fallbackMessage) return fallbackMessage;
  return `Request failed (${status})`;
}

function hasHeader(headers, name) {
  if (!headers) return false;
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

// Excludes FormData, Blob, and URLSearchParams (checked below); everything
// else object-typed — including arrays, Date, class instances,
// ArrayBuffer/TypedArray, and ReadableStream — is treated as a plain object
// and JSON.stringify'd. No live call site sends these body types today (plan
// §2.1); this is documented behavior, not a deliberately widened contract.
function isPlainObjectBody(body) {
  if (body === undefined || body === null) return false;
  if (typeof body !== 'object') return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return false;
  return true;
}

async function doFetch(url, { method = 'GET', body, headers, signal, fetchImpl } = {}) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  let finalBody = body;
  const mergedHeaders = { ...(headers || {}) };
  if (isPlainObjectBody(body)) {
    finalBody = JSON.stringify(body);
    if (!hasHeader(mergedHeaders, 'Content-Type')) {
      mergedHeaders['Content-Type'] = 'application/json';
    }
  }
  const init = { method, signal };
  if (finalBody !== undefined) init.body = finalBody;
  if (Object.keys(mergedHeaders).length > 0) init.headers = mergedHeaders;
  return fetchFn(url, init);
}

/**
 * Internal parse step shared by `readJsonBody`, `requestJson`, and
 * `requestEnvelope`. Returns the parsed body AND the parse outcome so
 * `ApiRequestError.parseError` can be populated.
 *
 * `tolerantBody`: `false` (default) | `true` | `(parseError, response) =>
 * fallbackValue`. Only consulted for a 2xx response; a non-2xx response is
 * always tolerant.
 */
async function parseJsonBody(response, { signal, tolerantBody = false } = {}) {
  try {
    const data = await response.json();
    return { data, parseError: null };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    if (!response.ok) {
      return { data: {}, parseError: err };
    }
    if (tolerantBody === true) {
      return { data: {}, parseError: err };
    }
    if (typeof tolerantBody === 'function') {
      return { data: tolerantBody(err, response), parseError: err };
    }
    throw err;
  }
}

/**
 * Public data-only adapter over `parseJsonBody`, for callers that already
 * hold a `Response` (e.g. the Stage 1 adapters folding `readResponse` /
 * `sendJson`). Returns the parsed body; does not throw on HTTP status.
 */
export async function readJsonBody(response, { signal, tolerantBody = false } = {}) {
  const { data } = await parseJsonBody(response, { signal, tolerantBody });
  return data;
}

/**
 * Throwing form. Default for sites that check `ok` and throw/set an error
 * on failure. Resolves to the parsed body on 2xx. Throws `ApiRequestError`
 * on non-2xx. Network and abort rejections propagate unchanged.
 */
export async function requestJson(url, {
  method = 'GET', body, headers, signal, fallbackMessage, fetchImpl, tolerantBody,
} = {}) {
  const response = await doFetch(url, { method, body, headers, signal, fetchImpl });
  const { data, parseError } = await parseJsonBody(response, { signal, tolerantBody });
  if (!response.ok) {
    throw new ApiRequestError(
      deriveErrorMessage(data, parseError, fallbackMessage, response.status, { preferParseError: false }),
      { status: response.status, payload: data, parseError }
    );
  }
  return data;
}

/**
 * Non-throwing form. For sites that don't check `ok`, that branch on a
 * status code before deciding whether it is an error, or that read `status`
 * on success. `data` is the parsed body: for a 2xx response whose body
 * parses to `null`, a primitive, or an array, `data` is that value as-is
 * (only a parse failure or empty body substitutes `{}`, and only under
 * `tolerantBody`; see invariant 4). Never throws on HTTP status (a
 * body-parse failure can still reject; see invariant 4).
 */
export async function requestEnvelope(url, {
  method = 'GET', body, headers, signal, fallbackMessage, fetchImpl, tolerantBody,
} = {}) {
  const response = await doFetch(url, { method, body, headers, signal, fetchImpl });
  const { data, parseError } = await parseJsonBody(response, { signal, tolerantBody });
  const error = response.ok
    ? null
    : new ApiRequestError(
        deriveErrorMessage(data, parseError, fallbackMessage, response.status, { preferParseError: false }),
        { status: response.status, payload: data, parseError }
      );
  return { ok: response.ok, status: response.status, data, error };
}
