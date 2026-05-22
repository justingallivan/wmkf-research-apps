---
name: project-app-access-control
description: "App-level access control architecture — Dataverse table, appRegistry as source of truth, React context, default grants, and API enforcement"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- **Dataverse `wmkf_appuserappaccesses`** — per-user app grants; Postgres `user_app_access` retired 2026-05-12 (Wave 1 closeout)
- **`shared/config/appRegistry.js`** — single source of truth for all [17](../docs/CANONICAL_COUNTS.md#app-definition-count) app definitions (keys, names, icons, categories, descriptions); used by Layout nav, home page, admin dashboard, and access control
- **`shared/context/AppAccessContext.js`** — React context; fetches `/api/app-access` on mount, exposes `hasAccess(appKey)` and `isSuperuser`
- New users get only `dynamics-explorer` by default (configured in `DEFAULT_APP_GRANTS` in `appRegistry.js`)
- **API-level enforcement active** — `requireAppAccess(req, res, ...appKeys)` on [52](../docs/CANONICAL_COUNTS.md#requireappaccess-endpoint-count) app endpoints (was ~48 at S154 2026-05-14; the pointer target is regenerated from live code)
