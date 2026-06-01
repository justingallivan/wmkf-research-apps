---
name: project-app-access-control
description: "App-level access control architecture — Dataverse table, appRegistry as source of truth, React context, default grants, and API enforcement"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- **Dataverse `wmkf_appuserappaccesses`** — per-user app grants; Postgres `user_app_access` retired 2026-05-12 (Wave 1 closeout)
- **`shared/config/appRegistry.js`** — single source of truth for all [18](../docs/CANONICAL_COUNTS.md#app-definition-count) app definitions (keys, names, icons, categories, descriptions); used by Layout nav, home page, admin dashboard, and access control
- **`shared/context/AppAccessContext.js`** — React context; fetches `/api/app-access` on mount, exposes `hasAccess(appKey)` and `isSuperuser`
- New users get only `dynamics-explorer` by default (configured in `DEFAULT_APP_GRANTS` in `appRegistry.js`)
- **API-level enforcement active** — `requireAppAccess(req, res, ...appKeys)` on [55](../docs/CANONICAL_COUNTS.md#requireappaccess-endpoint-count) app endpoints (was ~48 at S154 2026-05-14, then 52 until test-email→requireSuperuser at S198, then 53 until `/api/workbench/applicant-reviewers` at S210, then 54 until `/api/workbench/enrich-recommended` at S211; the pointer target is regenerated from live code)
- **`reviewers` grant SHIPPED (S208), additive** — `appRegistry.js:88` key `reviewers`; the 18 reviewer-finder/review-manager routes accept it *variadically* (`requireAppAccess(req,res,'<old-key>','reviewers')`, e.g. `reviewer-finder/my-proposals.js:38`, `review-manager/reviewers.js:95`). The two legacy keys are **still live, NOT retired** (`appRegistry.js:70,79`); not in `DEFAULT_APP_GRANTS`. **Still future:** collapsing fully to one-tab-per-grant + retiring the old keys. See [[project-reviewer-apps-redesign-direction]].
