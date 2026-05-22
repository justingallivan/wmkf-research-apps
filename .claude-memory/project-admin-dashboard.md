---
name: project-admin-dashboard
description: "Admin dashboard location, API key centralization, usage logging, and superuser setup"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- API keys are **centralized server-side** — all routes use `process.env.CLAUDE_API_KEY`; users no longer provide their own
- Usage logged to `api_usage_log` table (model, tokens, cost estimate, latency per request)
- Admin dashboard at `/admin` — health status + usage analytics + role management + app access management
- Justin (id=2) has superuser role granted
