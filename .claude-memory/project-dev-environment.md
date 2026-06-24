---
name: project-dev-environment
description: Local dev server setup and .env.local conventions
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dev-env
  last_verified: 2026-05-12 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: setting up or troubleshooting the local dev server / `.env.local`, or assuming where local dev points its data.

Do:
- Run `npm run dev` on port 3000; verify the auth flag from live `.env.local` (currently `AUTH_REQUIRED=true`).
- Strip quotes when parsing `.env.local` values in scripts.
- Do not assume `WAVE1_BACKEND_*` flags are present locally; current services default to Dataverse and fail loudly only when a flag is explicitly set to unsupported `postgres`.

Do not:
- Assume a separate local/test Dataverse store — local dev points at PROD Dataverse (`https://wmkf.crm.dynamics.com`); the sandbox is not drop-in usable (see [[project-dynamics-sandbox-state]]).

Ground truth: `.env.local`, `package.json` scripts; cross-refs [[project-dynamics-sandbox-state]]. Config values may drift — verify against the live `.env.local` rather than this memory.

- Dev server: `npm run dev` on port 3000
- Auth required in the current local `.env.local` (`AUTH_REQUIRED=true`)
- `.env.local` values are quoted (e.g., `DYNAMICS_URL="https://..."`) — scripts that parse it must strip quotes
- `.env.local` currently has no `WAVE1_BACKEND_*` flags. Dispatcher defaults to Dataverse; an explicit `postgres` value fails loudly instead of silently routing to dropped Postgres tables.
- Local dev points at **prod Dataverse** (`DYNAMICS_URL=https://wmkf.crm.dynamics.com`) — there is no separate test store wired in. A sandbox exists but isn't drop-in usable; see [[project-dynamics-sandbox-state]].
