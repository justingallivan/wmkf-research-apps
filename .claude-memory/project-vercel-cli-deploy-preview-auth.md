---
name: project-vercel-cli-deploy-preview-auth
description: WMKF Vercel project deploys via CLI only (no GitHub git-integration); preview hash URLs fail Azure AD redirect — smoke auth-gated changes on localhost or add the exact URL to Azure
metadata:
  type: project
  status: active
---

The `wmkf_research_apps` Vercel project has **no GitHub git-integration**
(`.vercel/project.json` has no gitRepo link; `vercel git` shows none; the whole
deploy history is CLI hash URLs `wmkfresearchapps-<hash>-justin-gallivans-projects.vercel.app`,
zero `-git-<branch>-` deploys). So **pushing a branch does NOT trigger a Vercel
preview build**, and the `-git-*` redirect-URI wildcard registered in Azure
(`docs/AUTHENTICATION_SETUP.md`) never matches a real deploy.

Consequence: a `vercel deploy` preview gets a hash URL that is **not** a
registered Azure AD redirect URI → sign-in fails with `AADSTS50011` redirect-URI
mismatch. Verified S242.

**Why:** every preview hash URL is unique and unregistered; Azure AD requires
exact (or wildcard-matched) redirect URIs.

**How to apply:** to smoke an **auth-gated** change (anything behind
`requireAppAccess`/NextAuth), prefer **localhost** — `http://localhost:3000/api/auth/callback/azure-ad`
IS registered. **Stale claim corrected (S346): do NOT assume `.env.local` already
has the Azure AD + NextAuth creds** — as of S346 that file had none of them at all
(likely fell out of a machine reset or fresh clone), which silently produced a
different, confusing failure mode than a redirect mismatch: see
[[project-local-dev-auth-setup]] for the full checklist (Azure AD vars,
`AUTH_REQUIRED=true`, `EXTERNAL_LINK_SECRET`) this session had to rediscover.
Verify presence before assuming local sign-in works. Otherwise add the exact
preview callback URL to the Azure app registration (`a652a292-…` → Authentication →
Redirect URIs) and don't redeploy (a new deploy = new hash = mismatch again). Do NOT
assume a branch push previews.
Related: [[project-vercel-sensitive-env-pull-empty]], [[project-dev-environment]], [[project-local-dev-auth-setup]].
