---
name: project-app-access-control
description: "App-level access control architecture — Dataverse table, appRegistry as source of truth, React context, default grants, and API enforcement"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: auth
  last_verified: S211 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: adding or wiring app-level access control — a new app, a new app-specific API route, default grants, or the React access context.

Do:
- Treat `shared/config/appRegistry.js` as the single source of truth for app definitions and `DEFAULT_APP_GRANTS`.
- Enforce app-specific routes with `requireAppAccess(req, res, ...appKeys)`; grants live in Dataverse `wmkf_appuserappaccesses`.
- Use `AppAccessContext.js` (`hasAccess(appKey)` / `isSuperuser`) for client-side gating.

Do not:
- Read app access from Postgres `user_app_access` — it was retired 2026-05-12 (Wave 1 closeout).
- Assume the two legacy reviewer keys are retired — they are still live; the `reviewers` grant is additive/variadic. Full collapse to one-tab-per-grant is still future.

Ground truth: `shared/config/appRegistry.js`, `shared/context/AppAccessContext.js`, `lib/utils/auth.js` (`requireAppAccess`), Dataverse `wmkf_appuserappaccesses`; counts regenerated from live code via `docs/CANONICAL_COUNTS.md`. See [[project-reviewer-apps-redesign-direction]].

- **Dataverse `wmkf_appuserappaccesses`** — per-user app grants; Postgres `user_app_access` retired 2026-05-12 (Wave 1 closeout)
- **`shared/config/appRegistry.js`** — single source of truth for all [18](../docs/CANONICAL_COUNTS.md#app-definition-count) app definitions (keys, names, icons, categories, descriptions); used by Layout nav, home page, admin dashboard, and access control
- **`shared/context/AppAccessContext.js`** — React context; fetches `/api/app-access` on mount, exposes `hasAccess(appKey)` and `isSuperuser`
- New users get only `dynamics-explorer` by default (configured in `DEFAULT_APP_GRANTS` in `appRegistry.js`)
- **API-level enforcement active** — `requireAppAccess(req, res, ...appKeys)` on [66](../docs/CANONICAL_COUNTS.md#requireappaccess-endpoint-count) app endpoints (was ~48 at S154 2026-05-14, then 52 until test-email→requireSuperuser at S198, then 53 until `/api/workbench/applicant-reviewers` at S210, then 54 until `/api/workbench/enrich-recommended` at S211, then 55 until `/api/reviewer-finder/prompt-override` at S222, then 56 until `/api/workbench/reviewer-roster` at S224, then 57 until `/api/reviewer-finder/web-suggestions` at S227 (which made it 58); that route was REMOVED S230 (web-discovery abandoned) → back to 57; S236 `/api/workbench/manual-reviewer` makes it 58 again, then `/api/workbench/orcid-lookup` makes it 59; S237 `/api/workbench/reviewer-lookup` (manual-add cross-store dedup) makes it 60; S243 2026-06-11 `/api/reviewer-finder/cycle-material` (Phase-1 private download proxy) makes it 61; S248 2026-06-12 `/api/field-primer/generate` (standalone staff field overview) makes it 62; S258 2026-06-14 `/api/workbench/proposal-documents` makes it 63, then `/api/workbench/download-proposal-document` (Proposal-tab Phase I doc list + scoped download proxy) makes it 64; S260 `/api/workbench/reviewer-rollup` (per-request Overview reviewer-stage rollup) makes it 65; S261 `/api/workbench/triage` (hard-gated triage-status write) makes it 66; the pointer target is regenerated from live code)
- **`reviewers` grant SHIPPED (S208), additive** — `appRegistry.js:88` key `reviewers`; the 18 reviewer-finder/review-manager routes accept it *variadically* (`requireAppAccess(req,res,'<old-key>','reviewers')`, e.g. `reviewer-finder/my-proposals.js:38`, `review-manager/reviewers.js:95`). The two legacy keys are **still live, NOT retired** (`appRegistry.js:70,79`); not in `DEFAULT_APP_GRANTS`. **Still future:** collapsing fully to one-tab-per-grant + retiring the old keys. See [[project-reviewer-apps-redesign-direction]].
