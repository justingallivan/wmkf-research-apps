---
name: project-admin-dashboard
description: "Admin dashboard location, API key centralization, usage logging, and superuser setup"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: global
  last_verified: unknown via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: you need where the admin dashboard lives, how API keys are centralized, where usage is logged, or who is superuser.

Do:
- Use server-side `process.env.CLAUDE_API_KEY` for all routes; users do not supply keys.
- Look to `/admin` for health, usage analytics, role, and app-access management.
- Treat Justin (id=2) as the superuser.

Do not:
- Reintroduce per-user API key entry.
- Assume usage metrics live anywhere other than the `api_usage_log` table.

Ground truth: `pages/admin`, `api_usage_log` table (cited in body); historical for setup specifics.

- API keys are **centralized server-side** — all routes use `process.env.CLAUDE_API_KEY`; users no longer provide their own
- Usage logged to `api_usage_log` table (model, tokens, cost estimate, latency per request)
- Admin dashboard at `/admin` — health status + usage analytics + role management + app access management
- Justin (id=2) has superuser role granted
