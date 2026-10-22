---
name: project-vercel-sensitive-env-pull-empty
description: Historical S215 empty Sensitive-variable pulls; preserve local overrides, treat empty values as ambiguous, and provision missing secrets through the credentials runbook.
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
- Treat an empty pull as ambiguous; [[reference-vercel-sensitive-env-unreadable]] owns that evidence boundary. Follow `docs/CREDENTIALS_RUNBOOK.md` for authorized provisioning of missing credentials.
- Preserve existing local configuration. If an env pull is authorized, use a separate gitignored destination and review selected keys before merging; do not overwrite `.env.local` or copy Production callback/auth settings blindly.
- Keep the repo's local auth settings in gitignored `.env.local` as described by [[project-dev-environment]]; intentional shell overrides are process-specific.

Do not:
- Copy Vercel-injected system/build vars (`VERCEL*`, `TURBO_*`, `NX_DAEMON`) into `.env.local` — `VERCEL_ENV=production` triggers prod-fail-closed branches locally.
- Commit a pulled `.env.vercel` (real prod secrets); `.gitignore` covers it as of S215.

Ground truth: historical-only (lesson, not live state). Related: [[project-dev-environment]].

## Historical observation — S215

In S215, `vercel env pull <file>` returned newer Sensitive entries empty. Older
non-Sensitive entries (`CLAUDE_API_KEY`, `AZURE_AD_CLIENT_SECRET`, `NEXTAUTH_SECRET`)
were populated; newer `ORCID_*`, `NCBI_API_KEY`, `EXTERNAL_LINK_SECRET`,
`DVX_BLOB_RW_TOKEN`, and `ANTHROPIC_ADMIN_API_KEY` entries were blank. That inventory
and the then-observed defaults are historical, not current per-key classifications.

**Response then:** the owner supplied unavailable values separately. The enduring
lesson is to provision through an approved source, not infer a missing hosted
value or change its sensitivity merely to make a pull readable.

**Merge hygiene observed in S215:** the pull included about 22 injected
system/build entries (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`,
`VERCEL_GIT_*`, `TURBO_*`, `NX_DAEMON`) and Production auth/callback values.
The session used CLI overrides to avoid importing those values. That workaround
does not prohibit intentionally configured localhost values in `.env.local`.
The current repository `.gitignore` covers `.env`, `.env.*`, and `.env*.bak`;
verify ignore coverage for any new scratch destination and never force-add secrets.

Related: [[project-dev-environment]].
