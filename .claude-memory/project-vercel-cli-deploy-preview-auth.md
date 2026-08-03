---
name: project-vercel-cli-deploy-preview-auth
description: WMKF main auto-deploys through Git integration; auth-gated branch Preview smoke works only with an approved exact callback and exact deployment/alias attestation
metadata:
  type: project
  status: active
---

## Recall Rule

Read this when: deploying from `main`, monitoring a Vercel deployment, or testing
an authenticated preview.

Do:
- Treat push-to-`main` auto-deploy as the owner-confirmed production path.
- Monitor a known deployment with `vercel inspect`; use localhost by default for
  auth-gated smoke, or temporarily register the exact stable branch-alias callback
  and attest that alias to the immutable Preview deployment and commit.

Do not:
- Run `vercel --prod` merely to duplicate a `main` push.
- Rely on the old preview-URL/Azure-wildcard claim.

Ground truth: owner correction S350, `docs/AUTHENTICATION_SETUP.md`, and the
2026-08-02 Reviewer Find read-only Preview preflight recorded in
`docs/REVIEWER_FIND_BROWSER_TEST_PLAN.md`.

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

**VERIFIED 2026-08-02:** a non-main branch push created a Git-integrated Preview
with a stable branch alias. A normal Microsoft staff sign-in succeeded only after
that exact alias callback was temporarily added to the Entra app; the callback was
removed after the smoke. Do not infer wildcard support or assume a different branch
alias is registered. Re-attest the exact immutable deployment ID, commit, Preview
class, and alias ownership for every run, and roll back temporary auth/environment
configuration afterward.

Related: [[project-vercel-sensitive-env-pull-empty]], [[project-dev-environment]], [[project-local-dev-auth-setup]], [[project-branded-domains]].
