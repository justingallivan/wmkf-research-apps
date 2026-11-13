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
  auth-gated smoke. For this project, first inspect the already registered
  `wmkfresearchapps-preview.vercel.app` callback/alias; temporarily repoint that
  stable alias to an attested immutable Preview deployment, then restore and
  verify its prior target after the smoke. Preview code accepts the stable alias as a
  CSRF origin, so a signed-in alias-hosted POST needs no `NEXTAUTH_URL`
  override (`docs/AUTHENTICATION_SETUP.md` Step 2.4); a branch built before
  that change needs a rebase or the Step 2.4 "Older branches" fallback. Add an Entra
  callback only when no already registered stable alias can serve the exact
  deployment.

Do not:
- Run `vercel --prod` merely to duplicate a `main` push.
- Rely on the old preview-URL/Azure-wildcard claim.
- Set a project-wide Preview `NEXTAUTH_URL` or reuse the Production staff host
  for a branch smoke; the override belongs only to the tested Git branch.

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

**NOTED 2026-09-05 (Session 488):** two local-smoke facts. (1) Claude-in-Chrome automation could not load `http://localhost:3000`, `localhost:3001` or `127.0.0.1:3001` from this machine (error page, zero hits in the dev-server log) while a public site loaded in the same tab group [VERIFIED]; a browser-driven local smoke needs the owner's own browser or a fix to the extension's site access. (2) Microsoft's documented localhost exception ignores the port for `http://localhost` redirect URIs, so a `next dev -p 3001` server with `NEXTAUTH_URL=http://localhost:3001` should authenticate against the registered `:3000` callback [ASSUMED per Microsoft docs; the sign-in was never completed because of (1)]. The port-3000 slot was held by the Codex worktree's dev server that day (worktree since removed, Session 488); do not kill another agent's server to free a port without the owner's say-so.

**VERIFIED 2026-08-02:** a non-main branch push created a Git-integrated Preview
with a stable branch alias. A normal Microsoft staff sign-in succeeded only after
that exact alias callback was temporarily added to the Entra app; the callback was
removed after the smoke. Do not infer wildcard support or assume a different branch
alias is registered. Re-attest the exact immutable deployment ID, commit, Preview
class, and alias ownership for every run, and roll back temporary auth/environment
configuration afterward.

**VERIFIED 2026-08-23:** the Entra app already contained
`https://wmkfresearchapps-preview.vercel.app/api/auth/callback/azure-ad`.
Deployment `dpl_4AKs6sf5UcRMUn9f6Vy2AKkmDjuZ` authenticated successfully after
that stable alias was temporarily moved from recorded target
`dpl_A8JPHtBc8ApPtYJ3kzxDYLjsffE9`; the dashboard loaded all 12 apps. <!-- fact-consistency:ignore fact=app-definition-count as-of=2026-08-23 --> Workbench
production reads then failed closed because Preview omitted
`DATAVERSE_ALLOW_PROD_READS`, as the interlock requires. The alias was restored
and re-inspected at its exact prior deployment. No Entra URI or application data
was changed.

**VERIFIED 2026-09-01:** for Workbench reviewer-follow-up UAT, the exact branch
alias callback
`https://wmkfresearchapps-git-codex-wor-464bcd-justin-gallivans-projects.vercel.app/api/auth/callback/azure-ad`
was added to Entra application `a652a292-2574-434c-ae6f-aa01f61d82ad` with Azure
CLI after preserving and re-reading all four prior redirect URIs. Direct branch
sign-in then succeeded and the page displayed its Preview read-only gate.

**AUTHORIZED + VERIFIED 2026-09-01:** the owner explicitly authorized
branch-scoped `DATAVERSE_ALLOW_PROD_READS=yes` for
`codex/workbench-reviewer-follow-up`. It was stored as a Preview Config value and
redeployed as `dpl_2EKZYPN21mRTcUMBHJYrj4sb2AD5`. Signed-in D26 smoke loaded 10
assigned requests, 7 needing attention, 20 active reviewers, and 5 received
reviews. Search reduced Johns Hopkins to one request; All requests showed 10;
returning to Needs attention showed 7. The read-only banner remained present,
and campaign settings, email templates, due-date extension, notes-edit, reviewer
selection, and action controls remained absent. No Preview write acknowledgement
or rehearsal grant was added. Remove both the exact branch callback and the
branch-scoped read variable when this UAT branch is retired.

**VERIFIED 2026-11-09:** a sandbox-backed Preview is the third venue. For the J27
read-model strip smoke on `claude/j27-read-model`, a branch-scoped Preview
`DYNAMICS_URL` pointing at sandbox `orgd9e66399` was added with `vercel env add`
and redeployed as `dpl_8kaj9FtYL6R9JkfAEjZjntE2hoSc`; the stable alias was moved
to it, the owner signed in with the already-registered stable callback, and the
Workbench resolved sandbox request 1000384 and rendered the strip. The interlock
allows preview × sandbox without any read-authorization variable. Memo-column
facts read as unavailable there because the `J27_*_SCHEMA_READY` flags are not
set for Preview; the integrity read failure seen on that run was not diagnosed. The alias was restored to
`dpl_5wQcfshKGG4z8cyeTueXkt9L4sve` and re-inspected. Remove the branch-scoped
`DYNAMICS_URL` when the branch retires. Evidence: plan §9 I8.

**HAZARD, 2026-11-11 (Session 673): `vercel env run` can deploy instead of run.**
With Vercel CLI 65.14, `vercel env run --environment production -- node <path-to-script>`
did not run the script: it created a new Vercel project named after the file and
deployed that file, once to Production and once to Preview. Deleted the same day
with owner approval (`vercel project delete <name> --confirm-name <name> --scope
justin-gallivans-projects`). Do not use `vercel env run` to read a value. To copy
one Config value, `vercel env pull <scratch-file> --environment <env>
[--git-branch <branch>] --yes`, extract the one key, delete the file at once.
Add branch-scoped Preview settings with `vercel env add <NAME> --environment
preview --git-branch <branch> --value <v> --no-sensitive --yes` (or stdin for a
JSON value) so they stay readable as Config.

**VERIFIED 2026-11-11:** the J27 Preview was moved by fast-forwarding
`claude/j27-read-model` to `01a798524`; deployment
`dpl_EQFqtn7LtKy9G3XyNuspzzquvo6z` was attested (branch, commit, Ready) through
`vercel api /v13/deployments/<id>` meta, and the stable alias was moved to it
from `dpl_2GaUBQnXmXsYd2WdYEnxAKfppSxV`. The branch's code accepts the alias as a
CSRF origin and the alias callback was already in Entra, so no URI change.

**Script gotcha, 2026-11-11:** `vercel inspect` prints its details (the `id`
line) on stderr. A polling loop that runs `vercel inspect <url> 2>/dev/null`
gets no id and never matches, so it waits forever on a build that finished in
under a minute. Capture with `2>&1` and parse `awk '$1=="id"{print $2}'`, then
attest branch and commit through `vercel api /v13/deployments/<id>` meta.

**VERIFIED 2026-11-12 (Session 674), Vercel CLI 65.14:** a new branch-scoped
setting reaches a Preview only on a rebuild; `vercel redeploy <deployment-url>
--target preview` rebuilt the same commit with it (about 2 minutes). To find
the build a push made, `vercel ls --meta githubCommitSha=<full sha>` lists it
with its Ready state. Run `vercel env ls` / `env add` from the main checkout
(linked); a worktree without `.vercel` reports "isn't linked to a project".
The positional `vercel env ls preview <branch>` form is deprecated; use
`--environment preview --git-branch <branch>`.

Related: [[project-vercel-sensitive-env-pull-empty]], [[project-dev-environment]], [[project-local-dev-auth-setup]], [[project-branded-domains]].
