---
name: project-vercel-sensitive-env-pull-empty
description: "Vercel \"Sensitive\" env vars pull back EMPTY via `vercel env pull` — paste secret values by hand"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8dc597af-9665-4032-9b01-5b115bf86112
  status: active
  scope: dev-env
  last_verified: S215 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: syncing env vars from Vercel to local via `vercel env pull` or setting up `.env.local`.

Do:
- Paste freshly-added "Sensitive" secret values into `.env.local` by hand (they pull back empty).
- Keep using the CLI-override dev run command for `AUTH_REQUIRED`/`NEXTAUTH_*`.

Do not:
- Copy Vercel-injected system/build vars (`VERCEL*`, `TURBO_*`, `NX_DAEMON`) into `.env.local` — `VERCEL_ENV=production` triggers prod-fail-closed branches locally.
- Commit a pulled `.env.vercel` (real prod secrets); `.gitignore` covers it as of S215.

Ground truth: historical-only (lesson, not live state). Related: [[project-dev-environment]].

`vercel env pull <file>` returns recently-added secrets with an **empty value** because Vercel now defaults new secrets to **"Sensitive"** (write-only — the value can't be read back, including via pull). Older non-Sensitive vars (`CLAUDE_API_KEY`, `AZURE_AD_CLIENT_SECRET`, `NEXTAUTH_SECRET`) pull populated; newer ones (`ORCID_*`, `NCBI_API_KEY`, `EXTERNAL_LINK_SECRET`, `DVX_BLOB_RW_TOKEN`, `ANTHROPIC_ADMIN_API_KEY`) come back blank.

**Implication:** you cannot sync a freshly-added secret from Vercel → local via pull. Paste the value into `.env.local` by hand.

**Merge hygiene (S215):** `vercel env pull` also writes ~22 Vercel-injected system/build vars (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`, `VERCEL_GIT_*`, `TURBO_*`, `NX_DAEMON`) — never copy these into `.env.local` (`VERCEL_ENV=production` would make local code take prod-fail-closed branches). And `AUTH_REQUIRED`/`NEXTAUTH_*` come with prod values — keep using the CLI-override dev run command, don't put them in the file. `.gitignore` now covers `.env`, `.env.*`, `.env*.bak` (S215) so a pulled `.env.vercel` (real prod secrets) can't be committed.

Related: [[project-dev-environment]].
