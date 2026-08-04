/**
 * Shared client-side "is auth enabled?" lookup.
 *
 * RequireAuth and Layout both need /api/auth/status on mount. Fetching it
 * independently produced two identical requests per page load (S398). This
 * helper memoizes BOTH the resolved value (window.__AUTH_ENABLED__ — the
 * pre-existing cache key, kept for back-compat) and the in-flight promise, so
 * concurrent callers on the same page load share one request.
 *
 * Failure behavior preserves each caller's previous posture: the promise
 * resolves false on fetch/parse errors (both callers treated errors as
 * auth-disabled), and a failed lookup is NOT cached, so a later mount retries.
 */

let inFlight = null;

export function getAuthEnabled() {
  if (typeof window !== 'undefined' && window.__AUTH_ENABLED__ !== undefined) {
    return Promise.resolve(window.__AUTH_ENABLED__);
  }
  if (inFlight) return inFlight;
  inFlight = fetch('/api/auth/status')
    .then(async (res) => {
      // A non-2xx or shape-invalid response is a RETRYABLE failure, never a
      // cacheable "auth disabled": a transient 503 JSON body must not disable
      // the client auth gate for the page lifetime (Codex adversarial review,
      // S398 — the old inline code self-healed here because it cached the raw
      // undefined, which the cache check treated as unset).
      if (!res.ok) throw new Error(`auth/status ${res.status}`);
      const data = await res.json();
      if (typeof data.enabled !== 'boolean') {
        throw new Error('auth/status: invalid response shape');
      }
      if (typeof window !== 'undefined') {
        window.__AUTH_ENABLED__ = data.enabled;
      }
      inFlight = null;
      return data.enabled;
    })
    .catch(() => {
      inFlight = null; // do not cache failures — next mount retries
      return false;
    });
  return inFlight;
}

/** Test-only: clear the module-level in-flight memo. */
export function _resetForTests() {
  inFlight = null;
}
