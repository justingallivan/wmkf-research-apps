/**
 * Dynamics request-scoped context.
 *
 * Safety contract: every DynamicsService caller must enter a context via
 * withDynamicsContext, bypassDynamicsRestrictions, or the SCRIPT-ONLY
 * enterDynamicsBypassForScript. DynamicsService.checkRestriction() fails
 * closed when no AsyncLocalStorage context is set (see
 * lib/services/dynamics-service.js:213-221).
 *
 * Replaces the module-level `activeRestrictions` / `_restrictionRequestId`
 * globals in `dynamics-service.js`. With Fluid Compute reusing function
 * instances across concurrent requests, module state is unsafe: two requests
 * arriving at the same instance would race on those globals, leaking
 * restrictions from one request into another.
 *
 * `AsyncLocalStorage` gives every request its own isolated store that the
 * runtime threads through awaits automatically. Nested calls (e.g. an entry
 * point sets restrictions, then calls a library that needs to bypass for a
 * single query) replace the store for the inner scope and restore the outer
 * one on return.
 *
 * Usage at entry points:
 *
 *   import { withDynamicsContext, bypassDynamicsRestrictions } from '...';
 *
 *   // Bypass case (writeback endpoints, scripts, audit logging):
 *   return bypassDynamicsRestrictions('review-manager-send', async () => {
 *     // Any DynamicsService.* call inside here runs unrestricted.
 *   });
 *
 *   // Restrictions case (Dynamics Explorer chat):
 *   return withDynamicsContext({ restrictions, requestId }, async () => {
 *     // Queries are checked against `restrictions` per-row.
 *   });
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const dynamicsAls = new AsyncLocalStorage();

/**
 * Run `fn` inside a Dynamics context.
 *
 * @param {{ restrictions: Array, requestId?: string }} ctx
 * @param {Function} fn  Sync or async; its return value is propagated.
 * @returns {*}
 */
export function withDynamicsContext(ctx, fn) {
  if (!ctx || !Array.isArray(ctx.restrictions)) {
    throw new Error('withDynamicsContext: ctx.restrictions must be an Array (use [] for bypass)');
  }
  if (typeof fn !== 'function') {
    throw new Error('withDynamicsContext: fn must be a function');
  }
  return dynamicsAls.run(
    { restrictions: ctx.restrictions, requestId: ctx.requestId || null },
    fn
  );
}

/**
 * Convenience: run `fn` with all restrictions bypassed.
 *
 * @param {string|Function} requestIdOrFn  Optional context label, or the function if no label.
 * @param {Function} [maybeFn]
 */
export function bypassDynamicsRestrictions(requestIdOrFn, maybeFn) {
  let requestId = null;
  let fn = maybeFn;
  if (typeof requestIdOrFn === 'function') {
    fn = requestIdOrFn;
  } else {
    requestId = requestIdOrFn || null;
  }
  return withDynamicsContext({ restrictions: [], requestId }, fn);
}

/**
 * Read the current Dynamics context, or null if none.
 * Used internally by DynamicsService.checkRestriction.
 *
 * @returns {{ restrictions: Array, requestId: string|null }|null}
 */
export function getDynamicsContext() {
  return dynamicsAls.getStore() || null;
}

/**
 * DAL Stage 7 — entity-CRUD fail-closed enforcement.
 *
 * `checkRestriction` (used by reads) has always been fail-closed: no ALS
 * context → throw. Entity-changing calls (createRecord/updateRecord/
 * deleteRecord/disassociate/executeChangeset) historically skipped that
 * check entirely — nothing stopped a raw write from firing with no
 * request-scoped context at all. This section extends the SAME fail-closed
 * posture to writes, gated by an env flag so it can be proven in dev/test
 * before it is ever relied on in prod.
 *
 * "Trusted context" is deliberately the existing ALS store, not a new
 * concept: every current entry point already establishes one via
 * `withDynamicsContext` / `bypassDynamicsRestrictions` (routes, crons,
 * external-token handlers) or `enterDynamicsBypassForScript` (scripts).
 * `lib/dataverse/core/context.js#withDalContext` is a thin, DAL-labeled
 * wrapper over `bypassDynamicsRestrictions` for post-auth call sites — it
 * does not add a second, incompatible notion of trust.
 */
const DAL_ENFORCEMENT_FLAG = 'DATAVERSE_DAL_ENFORCEMENT';

/**
 * Whether entity-CRUD fail-closed enforcement is active in this process.
 *
 * `DATAVERSE_DAL_ENFORCEMENT=on` / `=off` are explicit overrides. With
 * neither set, the default follows `NODE_ENV`: on outside production (dev,
 * test), off in production. Production runs with an explicit `=on` env var
 * (flipped 2026-07-04, Stage 7 plan work item 3), so the NODE_ENV-keyed
 * default is now only the safety net for environments with no explicit
 * setting. There is no committed
 * `.env.development` for this: the repo's `.gitignore` excludes every
 * `.env*` file except `.env.example`, so a real env file can't be the
 * committed mechanism — the NODE_ENV-keyed default is.
 *
 * @returns {boolean}
 */
export function isDalEnforcementOn() {
  const raw = process.env[DAL_ENFORCEMENT_FLAG];
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Fail closed on entity-changing Dataverse calls made with no trusted
 * context, when enforcement is on. No-op when enforcement is off (today's
 * behavior, preserved exactly).
 *
 * @param {string} callerLabel - identifies the throwing call site in the
 *   error message (e.g. `'DynamicsService.createRecord'`,
 *   `'changeset.runChangeset'`).
 * @throws {Error} when enforcement is on and no ALS context is set.
 */
export function assertTrustedDalContext(callerLabel) {
  if (!isDalEnforcementOn()) return;
  if (!getDynamicsContext()) {
    throw new Error(
      `${callerLabel}: no trusted Dataverse context — entity writes require a ` +
      `post-auth DAL context (lib/dataverse/core/context.js#withDalContext, or an ` +
      `existing bypassDynamicsRestrictions/withDynamicsContext/` +
      `enterDynamicsBypassForScript scope). See docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md ` +
      `Stage 7. Set DATAVERSE_DAL_ENFORCEMENT=off to disable this check.`
    );
  }
}

/**
 * ⚠️ SCRIPT-ONLY — DO NOT IMPORT FROM `pages/` OR `lib/`.
 *
 * Open a persistent bypass context for the rest of the current process.
 *
 * Uses `AsyncLocalStorage#enterWith`, which sets the store for the current
 * async context and all descendants without requiring a callback. That makes
 * it UNSAFE in concurrent request handling: under Fluid Compute, function
 * instances are reused across requests, and `enterWith` installs a store that
 * persists past the originating request — every subsequent request on that
 * instance would inherit the bypass, including ones that should be restricted.
 *
 * Scripts run as single-process, single-request CLIs where there are no
 * concurrent contexts to leak into, so `enterWith` is the right shape there:
 * it preserves the "set once at top, run forever" idiom existing scripts use.
 *
 * For routes, libraries, cron handlers, instrumentation, and anything imported
 * at module load: use the callback-scoped `withDynamicsContext` or
 * `bypassDynamicsRestrictions` instead.
 *
 * @param {string} [label]  Optional context label for state-leak detection logs.
 */
export function enterDynamicsBypassForScript(label) {
  dynamicsAls.enterWith({ restrictions: [], requestId: label || null });
}
