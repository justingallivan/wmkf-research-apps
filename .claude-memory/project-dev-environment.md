---
name: project-dev-environment
description: Local dev server setup and .env.local conventions
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- Dev server: `npm run dev` on port 3000
- Auth disabled in dev (`AUTH_REQUIRED=false` in `.env.local`)
- `.env.local` values are quoted (e.g., `DYNAMICS_URL="https://..."`) — scripts that parse it must strip quotes
- `.env.local` has `WAVE1_BACKEND_SETTINGS=dataverse`, `WAVE1_BACKEND_APP_ACCESS=dataverse`, `WAVE1_BACKEND_PREFS=dataverse` (mirroring prod since 2026-05-11). Dispatcher defaults to Dataverse as of 2026-05-12; missing flags now fail loudly instead of silently routing to the dropped Postgres tables.
