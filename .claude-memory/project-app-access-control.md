---
name: project-app-access-control
description: "App-level access control architecture — Dataverse grants, appRegistry source of truth, React context, default grants, API enforcement, and Q9 transport posture"
metadata:
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: auth
  last_verified: 2026-07-27 via app-access source/tests, read-only live inventory, Q9 plan, and Vercel metadata
---

## Recall Rule

Read this when: adding an app, gating an app-specific route, changing default
grants, working on the React access context, or resuming the Q9 app-access DAL
migration.

Do:

- Treat `shared/config/appRegistry.js` as the source of truth for app
  definitions and `DEFAULT_APP_GRANTS`.
- Enforce app-specific routes with
  `requireAppAccess(req, res, ...appKeys)`; grants live in Dataverse
  `wmkf_appuserappaccesses`.
- Use `AppAccessContext.js` (`hasAccess(appKey)` / `isSuperuser`) for
  client-side gating.
- Regenerate current app and endpoint counts from
  `docs/CANONICAL_COUNTS.md`; do not preserve a hand-maintained count history
  here.

Do not:

- Read app access from Postgres `user_app_access`; it was retired 2026-05-12.
- Remove the legacy `reviewer-finder` / `review-manager` route-gate strings
  just because those apps left `appRegistry.js`. Current routes still accept
  those grants variadically with `reviewers`.
- Treat Q9 as complete. Preferences use a DynamicsService adapter, but
  `dataverse-app-access-service.js` still uses the raw Dataverse client.

## Current contract

- The registry currently defines
  [12](../docs/CANONICAL_COUNTS.md#app-definition-count) apps. New users get
  only `dynamics-explorer` by default.
- API enforcement currently covers
  [87](../docs/CANONICAL_COUNTS.md#requireappaccess-endpoint-count)
  app-specific endpoints.
- `requireAppAccess` checks active status and superuser role fresh on every
  request. It caches ordinary app grants for two minutes.
- Grant lookup failures fail closed without poisoning that cache:
  `requireAppAccess` wraps the Dataverse lookup in `withDalContext`, requests
  `throwOnError`, returns a retryable 503, and does not cache an empty grant
  set. Display-only reads retain their graceful `[]` fallback.
- The admin API uses a strict all-grants read. Grant/revoke responses report
  only identifiers actually completed; a transport error returns non-2xx with
  any completed prefix instead of claiming every requested key succeeded.
- `shared/context/AppAccessContext.js` fetches `/api/app-access` and exposes
  `hasAccess(appKey)` / `isSuperuser` to the UI.
- `reviewers` is the shipped Workbench grant. Legacy reviewer grant strings
  remain accepted by selected API routes as deferred cleanup.

## Q9 rollout boundary

The 2026-07-27 Vercel probe found no `DATAVERSE_DAL_UNIVERSAL` entry in the
current Preview or Production project configuration. The owner accepted that
posture and replaced the low-signal passive soak with deterministic
`DATAVERSE_DAL_UNIVERSAL=on` acceptance. Seven focused suites / 33 tests cover
the ordinary-user lookup, admin list/grant/revoke, fresh-profile default
grants, and partial-failure UI refresh; all passed. A read-only live inventory
found 10 active profiles: two
superusers, six mapped ordinary users with three to five grants, and two
unmapped read-only profiles. No grant, environment variable, deployment, or
saved session changed. Stage 2 is satisfied and Stage 4 is ready to execute;
require a deliberately designated ordinary-user Preview smoke, reversible
grant/revoke restoration check, authenticated reviewer-finder
`analyze`/`discover` check with a known prompt override, and production log
watch at release.

Ground truth: `shared/config/appRegistry.js`,
`shared/context/AppAccessContext.js`, `lib/utils/auth.js`,
`lib/services/dataverse-app-access-service.js`, Dataverse
`wmkf_appuserappaccesses`, and
`docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`.
