---
name: project-vercel-cli-deploy-preview-auth
description: WMKF Vercel project DOES deploy to production on push to main (git-integration active, owner-corrected S350); to smoke an auth-gated change prefer localhost (registered Azure redirect)
metadata:
  type: project
  status: active
---

## Recall Rule

Read this when: deploying from `main`, monitoring a Vercel deployment, or testing
an authenticated preview.

Do:
- Treat push-to-`main` auto-deploy as the owner-confirmed production path.
- Monitor a known deployment with `vercel inspect`; use localhost for
  auth-gated smoke unless a preview redirect has been verified.

Do not:
- Run `vercel --prod` merely to duplicate a `main` push.
- Rely on the old preview-URL/Azure-wildcard claim.

Ground truth: owner correction S350 and `docs/AUTHENTICATION_SETUP.md`.
Non-main preview URL compatibility remains `UNKNOWN`; push a harmless test
branch and compare its actual callback URL with the registered Azure redirects
before relying on it.

**CORRECTED 2026-07-09 (S350), owner-stated:** pushing to `main` **DOES** trigger a
production Vercel deploy — git-integration is active and "deploys to main on push as
it always does." The prior claim in this file ("no GitHub git-integration; pushing a
branch does NOT trigger a build; deploy is CLI-only", "Verified S242") is **WRONG** and
is retracted. Do NOT run a manual `vercel --prod` to ship main — the push already
deploys it. (S350 also hit an unrelated CLI-deploy failure: `vercel --prod` choked
packaging `.codegraph/daemon.sock` — a live unix socket the tarball can't read; a
`.vercelignore` with `.codegraph` would fix CLI deploys if ever needed, but the git
push is the real deploy path.)

Deploy-monitoring: after a push, confirm readiness with `vercel inspect <deployment-url>`
(deterministic `status ● Ready/Building/Error`), NOT a `vercel ls | grep <hash>` poll —
see [[feedback-deployment-monitoring-use-inspect]].

**Auth-gated smoke (still useful):** to test anything behind `requireAppAccess`/NextAuth,
prefer **localhost** — `http://localhost:3000/api/auth/callback/azure-ad` IS a registered
Azure redirect URI. Do NOT assume `.env.local` already has Azure AD + NextAuth creds
(S346: that file had none — see [[project-local-dev-auth-setup]] for the full checklist:
Azure AD vars, `AUTH_REQUIRED=true`, `EXTERNAL_LINK_SECRET`).

**Needs re-verification (was derived from the now-retracted premise):** whether a
non-main branch push creates a `-git-<branch>-` preview deploy, and whether such a
preview URL matches the Azure `-git-*` redirect wildcard in `docs/AUTHENTICATION_SETUP.md`.
The old AADSTS50011-on-preview claim assumed CLI hash URLs; with git-integration the
preview URL shape may differ. Verify against a real preview before relying on either.

Related: [[project-vercel-sensitive-env-pull-empty]], [[project-dev-environment]], [[project-local-dev-auth-setup]], [[project-branded-domains]].
