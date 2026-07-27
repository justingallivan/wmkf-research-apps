---
name: project-admin-dashboard
description: "Admin dashboard location, API key centralization, usage logging, and superuser setup"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: global
  last_verified: 2026-07-27 via pages/admin.js, pages/api/admin routes, and current auth/usage source; live user-role assignment not asserted
---

## Recall Rule

Read this when: you need where the admin dashboard lives, how API keys are centralized, where usage is logged, or who is superuser.

Do:
- Use server-side provider credentials; Anthropic paths resolve
  `process.env.CLAUDE_API_KEY`. Users do not supply keys.
- Look to `/admin` for health, usage analytics, role, and app-access management.
- Resolve superuser membership from the current role store; do not hardcode a
  profile ID.

Do not:
- Reintroduce per-user API key entry.
- Assume usage metrics live anywhere other than the `api_usage_log` table.
- Treat the historical Justin/profile-2 grant below as current authorization.

Ground truth: `pages/admin.js`, `pages/api/admin/*`,
`lib/utils/usage-logger.js`, and `lib/utils/auth.js`; historical for setup
specifics.

- Provider API keys are **centralized server-side**; Anthropic paths use
  `process.env.CLAUDE_API_KEY`, while multi-provider paths use their configured
  server-side provider keys. Users no longer provide keys.
- Usage logged to `api_usage_log` table (model, tokens, cost estimate, latency per request)
- Admin dashboard at `/admin` — health status + usage analytics + role management + app access management
- Historical setup record: Justin/profile 2 was granted superuser. Current
  authorization comes from `dynamics_user_roles` and must be queried, not assumed.
