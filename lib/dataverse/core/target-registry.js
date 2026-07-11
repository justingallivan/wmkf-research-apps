/**
 * Dataverse target hostname registry (Session 355 —
 * docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.1).
 *
 * A tracked, code-reviewed registry, not an env-var-inferred classification:
 * changing an org's classification requires a commit, satisfying strategy
 * §12 ("Dataverse target classification is verified, not inferred from a
 * variable name"). `lib/dataverse/core/interlock.js#classifyTarget` matches
 * the ACTUAL request URL's hostname against these lists — never the env var
 * name that happened to supply the URL.
 *
 * Exact-match hostnames only (no wildcards, no env-var extension). Both
 * hostnames below already appear in tracked files:
 * `lib/utils/health-checker.js:103` (fallback) and
 * `scripts/probe-sandbox-schema-perms.js:25`.
 *
 * `akoyago.crm.dynamics.com` is NOT a real org (resolved 2026-07-11, S355,
 * via the read-only Global Discovery probe `scripts/discover-dynamics-envs.js`:
 * the app registration sees exactly two instances — `wmkf`, display name
 * "WM Keck Foundation akoyaGO", and sandbox `orgd9e66399`). An old doc
 * conflated the akoyaGO product name into a hostname. Also deliberately
 * absent: the `<org>.api.crm.dynamics.com` host form Discovery lists — the
 * runtime always uses the plain host, so an `.api.` URL classifies `unknown`
 * (fail closed); investigate the caller before extending this registry.
 */

/** Hostnames that resolve to the production Dataverse org. */
export const PRODUCTION_HOSTS = ['wmkf.crm.dynamics.com'];

/** Hostnames that resolve to the sandbox Dataverse org. */
export const SANDBOX_HOSTS = ['orgd9e66399.crm.dynamics.com'];
