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
 * `akoyago.crm.dynamics.com` is named as "Prod" in
 * docs/POSTGRES_TO_DATAVERSE_MIGRATION.md but is NOT included here — plan
 * §3.1 flags this as an open [OWNER DECISION]: confirm whether it still
 * resolves to the production org before Stage 2 wiring. Until that decision
 * lands, a URL on that host classifies as `unknown` (fail closed), not
 * `production`.
 */

/** Hostnames that resolve to the production Dataverse org. */
export const PRODUCTION_HOSTS = ['wmkf.crm.dynamics.com'];

/** Hostnames that resolve to the sandbox Dataverse org. */
export const SANDBOX_HOSTS = ['orgd9e66399.crm.dynamics.com'];
