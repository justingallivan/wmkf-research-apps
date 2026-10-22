---
name: project-dev-environment
description: Local dev configuration must be checked per machine and process; preserve local auth settings and verify data targets rather than reusing dated snapshots.
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dev-env
  last_verified: 2026-07-27 via package.json and key-only local .env.local inspection
---

## Recall Rule

Read this when: setting up or troubleshooting the local dev server / `.env.local`, or assuming where local dev points its data.

Do:
- `npm run dev` invokes `next dev` (`package.json`); use the intended available port and a matching local callback origin. Check current configuration rather than assuming port 3000 is free.
- Use gitignored `.env.local` for this repo's local auth configuration; an intentional shell override applies only to that process and is not evidence of file or hosted configuration. For staff sign-in, follow [[project-local-dev-auth-setup]].
- Strip quotes when parsing `.env.local` values in scripts.
- Do not assume `WAVE1_BACKEND_*` flags are present locally; current services default to Dataverse and fail loudly only when a flag is explicitly set to unsupported `postgres`.

Do not:
- Infer a safe data target from the word "local". Inspect the configured target and interlock for the actual process before access; historical production targeting is not permission to read or write production. See [[project-dynamics-sandbox-state]] and [[feedback-never-self-authorize-prod-dataverse-reads]].

Ground truth: `.env.local`, `package.json` scripts; cross-refs [[project-dynamics-sandbox-state]]. Config values may drift — verify against the live `.env.local` rather than this memory.

## Historical machine snapshot — 2026-07-27

[VERIFIED 2026-07-27 via key-only `.env.local` inspection and `package.json`]:
`AUTH_REQUIRED=true`, `NEXTAUTH_URL=http://localhost:3000`,
`DYNAMICS_URL=https://wmkf.crm.dynamics.com`, and the two named Wave-1 backend
flags were absent. Values were quoted, and that machine's local app pointed at
production Dataverse. This is a dated snapshot, not the current configuration of
either Mac or a worktree. Recheck non-secret settings and secret-key presence when
needed, without printing secret values. No machine or environment was re-probed
for the 2026-10-22 guidance repair.
