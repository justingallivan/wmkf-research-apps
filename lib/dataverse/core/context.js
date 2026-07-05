/**
 * DAL/core post-auth trusted context helper (Stage 7).
 *
 * Entry points — routes AFTER `requireAppAccess`/`requireSuperuser`, crons
 * AFTER `verifyCronSecret`, external routes AFTER token verification — call
 * `withDalContext` instead of importing `bypassDynamicsRestrictions` directly
 * from `lib/services/dynamics-context.js`. This does not reinvent the
 * request-scoped AsyncLocalStorage machinery in `dynamics-context.js`; it is
 * a thin, DAL-labeled wrapper over it, so the entity-CRUD fail-closed
 * enforcement in `DynamicsService` (`assertTrustedDalContext`) and adapters
 * see the exact same trusted context regardless of which entry point
 * established it.
 *
 * Why a separate DAL-owned name at all, if it is "just" bypassDynamicsRestrictions:
 *   - it gives every converted entry point one canonical, greppable call
 *     shape (`withDalContext('scope-label', fn)`) instead of importing the
 *     lower-level ALS helper directly, matching the DAL boundary the rest of
 *     this migration draws at `lib/dataverse/core/` + `lib/dataverse/adapters/`.
 *   - it is the seam the Stage-7 canary conversions (work item 4) convert
 *     routes onto, one file per commit, in place of their raw
 *     `bypassDynamicsRestrictions` wrapper.
 *
 * NOT a restrictions-checking context: like `bypassDynamicsRestrictions`,
 * `withDalContext` always runs `fn` with `restrictions: []` (full read
 * access, subject only to the entity-CRUD enforcement below). Dynamics
 * Explorer's field/table-restricted browsing is a separate, exempt tool that
 * continues to call `withDynamicsContext({ restrictions, requestId }, fn)`
 * directly — it is not a DAL application surface.
 */

import { bypassDynamicsRestrictions, getDynamicsContext } from '../../services/dynamics-context.js';

/**
 * Run `fn` inside a DAL-labeled trusted Dataverse context. Call this ONLY
 * after the entry point's own auth/verification has already succeeded
 * (`requireAppAccess`/`requireSuperuser` for routes, `verifyCronSecret` for
 * crons, magic-link token verification for external routes) — this helper
 * does not perform or check auth itself.
 *
 * @param {string} scopeLabel - identifies the entry point establishing this
 *   context (state-leak detection logs; also appears in enforcement error
 *   messages if a nested call runs outside any context).
 * @param {Function} fn - sync or async; its return value is propagated.
 * @returns {*}
 */
export function withDalContext(scopeLabel, fn) {
  if (!scopeLabel || typeof scopeLabel !== 'string') {
    throw new Error('withDalContext: scopeLabel (string) required — label the post-auth entry point establishing this context');
  }
  if (typeof fn !== 'function') {
    throw new Error('withDalContext: fn must be a function');
  }
  return bypassDynamicsRestrictions(scopeLabel, fn);
}

/**
 * Whether the current call is running inside ANY trusted Dataverse context
 * (DAL-established or a legacy `bypassDynamicsRestrictions`/
 * `withDynamicsContext`/`enterDynamicsBypassForScript` scope). Adapters or
 * other DAL internals can use this to fail closed early with a clearer,
 * caller-specific message before delegating to `DynamicsService`, which
 * enforces the same check under `DATAVERSE_DAL_ENFORCEMENT`.
 *
 * @returns {boolean}
 */
export function hasTrustedDalContext() {
  return getDynamicsContext() !== null;
}
