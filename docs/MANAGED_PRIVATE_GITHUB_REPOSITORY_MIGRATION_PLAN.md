---
title: Managed Private GitHub Repository Migration Plan
domain: security-operations
kind: plan
status: draft
summary: "Staged move to an IT-managed private GitHub repository while preserving automation and the existing Vercel production project."
canonical: false
cataloged: 2026-09-15
last_verified: 2026-09-15
owner: product-engineering
related:
  - docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md
  - docs/audits/public-repository-pii-history-audit-2026-07-27.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/AGENT_COLLABORATION_PLAN.md
---

# Managed Private GitHub Repository Migration Plan

## Recommendation

Use a **staged in-place transfer**, provided the IT destination is a standard GitHub.com
organization that accepts repository transfers:

1. make the existing personal repository private and validate it without changing ownership;
2. transfer that same private repository into the IT-managed organization;
3. preserve the existing Vercel project and reconnect only its Git repository link; and
4. enable the organization's final branch, Actions, security, and access policies after the
   first post-transfer validation passes.

Do **not** create a blank repository and push only Git history unless direct transfer and GitHub
Enterprise Importer are both unavailable. GitHub's in-place transfer preserves repository
history and identity far more completely: issues, pull requests, wiki, stars, watchers,
webhooks, services, repository secrets, and deploy keys remain associated, and old Git URLs
redirect to the new location. Existing clones should still update `origin` explicitly.

The migration should change one boundary at a time. Combining GitHub ownership, visibility,
Vercel ownership, history rewriting, branch rules, and workflow hardening into one cutover would
make failures difficult to isolate.

**Contract-reconcile verdict:** **READY WITH NAMED CHANGES**. The direct-transfer path is ready
to plan in detail after IT answers the gates below. Execution is not authorized by this draft.

## Change contract

| Contract hop | Surface |
|---|---|
| Entry points | GitHub transfer/visibility settings, organization policies, Vercel Git settings, local Git remotes |
| Persistence | GitHub repository and refs; Actions settings/secrets/environments/artifacts; Vercel project configuration |
| Consumers | Developers and agents, GitHub Actions, Dependabot, Vercel preview/production deployments, public application links |
| Runtime state | Existing Vercel project, domains, environment variables, crons, Blob stores, Neon integration, deployment history |
| Durable guidance | This plan, the public-history remediation plan, setup scripts, current operational docs |

Application request/response, Dataverse schema, and application data migrations are `N/A`. They
remain consumers of the existing Vercel deployment and must not be moved or reconfigured as
part of the GitHub repository cutover.

## Verified baseline — 2026-09-15

### GitHub

| Surface | Current state |
|---|---|
| Repository | `[VERIFIED via GitHub API]` `justingallivan/wmkf-research-apps`, public, personal-account owned, default branch `main` |
| Access | `[VERIFIED via GitHub API]` Justin is the only direct collaborator and has admin access |
| Public network | `[VERIFIED via GitHub API]` zero forks and zero stars; one watcher |
| Repository controls | `[VERIFIED via GitHub API]` no branch protection, repository rulesets, repository webhooks, or deploy keys |
| Actions | `[VERIFIED via source/API]` enabled with all actions allowed and no full-SHA requirement; seven workflow files |
| Actions baseline | `[VERIFIED via GitHub API]` the latest `main` runs for Tests, E2E, Trivy, Gitleaks, and Semgrep succeeded at `d83c8a9e` |
| Actions state | `[VERIFIED via GitHub API]` eight GitHub environments, one repository secret named `CLAUDE_CODE_OAUTH_TOKEN`, and 4,101 artifact records |
| Dependabot | `[VERIFIED via source/API]` weekly npm version updates; alerts and security updates enabled; no Dependabot secrets or private registries |
| Advanced security | `[VERIFIED via GitHub API]` GitHub secret scanning and push protection are currently disabled |
| Repository payload | `[VERIFIED via source]` no submodules or detected Git LFS configuration; zero releases and one tag |

The workflows currently depend on GitHub-authored actions plus
`anthropics/claude-code-action`, `gitleaks/gitleaks-action`,
`aquasecurity/trivy-action`, the `semgrep/semgrep` container image, and GitHub-hosted Ubuntu
runners. `aquasecurity/trivy-action@master`, the Semgrep image, and all tag-pinned actions may
conflict with an organization policy that requires immutable full commit SHAs or approved
publishers.

### Vercel

| Surface | Current state |
|---|---|
| Project | `[VERIFIED via Vercel API]` existing project `wmkf_research_apps`, ID `prj_56SJKzNer1aV38kKVoP8tl3X0lf3` |
| Ownership | `[VERIFIED via Vercel API]` Pro scope `justin-gallivans-projects`; Justin is its only member |
| Git link | `[VERIFIED via Vercel API]` GitHub repository ID `1043484183`, owner `justingallivan`, repository `wmkf-research-apps`, production branch `main` |
| Deployments | `[VERIFIED via Vercel API]` current production and preview deployments were triggered from that GitHub repository and are Ready |
| Production surface | `[VERIFIED via Vercel API/source]` seven production aliases, 21 active cron definitions, Web Analytics, 133 environment entries representing 104 unique names |
| Storage/data | `[VERIFIED via Vercel CLI]` four active Blob stores and one Neon integration are connected to this project |
| Extra triggers | `[VERIFIED via Vercel CLI]` no deploy hooks or Vercel team webhooks |

Keeping this project preserves its production aliases, domains, environment variables, crons,
deployments, Blob connections, and database connection. Creating a new Vercel project would
require reconstructing and validating all of those surfaces and is outside this repository-only
migration.

Vercel supports private GitHub organization repositories on Pro teams. For such repositories,
Vercel requires commit authors to have access to the Vercel project. Because the current team has
one member, IT contributors must either be added to this Vercel team or the project must later be
transferred to an IT-managed Pro/Enterprise Vercel team.

### Current repository identity consumers

The old GitHub URL is hard-coded in two user-facing application footers:

- `shared/components/Layout.js`
- `pages/index.js`

It is also emitted as the clone URL in `scripts/setup-git-nosync.sh`. Historical documents contain
old repository and PR URLs; GitHub redirects make those acceptable as historical evidence, but
current UI, setup instructions, badges, and operational commands must use the new location. A
private source link in a public-facing application will appear broken to users without access, so
the owner must decide whether to remove those footer links or expose an authenticated internal
repository link.

## Mandatory decision gates

IT and the repository owner must answer these before scheduling the cutover:

1. **Destination type:** ordinary GitHub.com organization, GitHub Enterprise Cloud with personal
   accounts, Enterprise Managed Users (EMU), or a data-residency `ghe.com` tenant?
2. **Transfer eligibility:** may Justin create/receive a repository in the target organization,
   and is the desired repository name unused? GitHub blocks an in-place transfer into an EMU
   enterprise from outside that enterprise.
3. **Identity:** will Justin be an organization **member** with repository access? Vercel cannot
   connect an organization repository when the operator is only an outside collaborator.
4. **GitHub App approval:** will IT install/approve the Vercel GitHub App for this selected private
   repository and authorize SSO where required?
5. **Actions policy:** are third-party actions and container images allowed? Must actions be pinned
   to full SHAs? Are OIDC (`id-token: write`) and the Claude workflows permitted?
6. **Credential policy:** may the transferred repository retain `CLAUDE_CODE_OAUTH_TOKEN`, or must
   the Claude workflows be disabled/replaced with an organization-approved OAuth integration?
   Do not replace it with a project/provider API key.
7. **Billing:** which account pays for private-repository Actions minutes, artifact storage, and
   cache storage? Public standard runners are free; private-repository usage consumes the target
   account's allowance and may be billed. The existing 4,101 artifact records make retention and
   storage policy worth reviewing before cutover.
8. **Repository rules:** which teams receive admin/maintain/write/read, what is the base permission,
   are private forks allowed, and which checks/reviews/signatures are required on `main`?
9. **Security licensing:** does the organization have GitHub Code Security/Secret Protection for
   private repositories? Dependabot alerts remain available, but GitHub code scanning features
   can change when a public repository becomes private.
10. **Vercel ownership:** keep the current Pro project temporarily, or move it to an IT Vercel team?
    The recommendation is to keep it during the GitHub cutover and treat a Vercel-team transfer as
    a separate project.
11. **Public-history disposition:** sanitize the known public history before transfer, or formally
    accept that already-public historical material will be retained in the managed repository?

## Privacy prerequisite

`[VERIFIED via repository audit]` The active public-repository privacy audit still records two
unresolved classes:

1. a tracked expertise-matching roster/assignment duplicate in the current tree; and
2. personal or confidential operational data in reachable Git history.

The prior audit found no probable live credentials in reachable history, but it did not declare
the privacy condition reconciled. Making the repository private prevents future anonymous access;
it does not retract old clones, cached views, detached public forks, or historical blobs already
made public.

Before IT accepts custody, choose one of these explicitly:

- **Sanitize:** execute the separately reviewed, owner-approved
  `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` before transfer. This is a history rewrite and has
  its own freeze, backups, force-push, clone invalidation, PR-ref, Actions-artifact, and Vercel
  deployment risks.
- **Accept:** IT documents acceptance of the historical exposure and imports the history as-is,
  while still resolving or explicitly accepting the current-tree roster duplicate.

Do not combine the history rewrite and organization transfer into the same change window.

## Route selection

| Route | Use when | Preserves | Rebuild burden | Recommendation |
|---|---|---|---|---|
| In-place GitHub transfer | Target is a compatible GitHub.com organization and permits transfer | Git refs, issues, PRs, most repository settings, secrets, redirects | Vercel GitHub App/reconnect, org policies, local remotes | **Preferred** |
| GitHub Enterprise Importer (GEI) | Direct transfer is unavailable, especially enterprise/data-residency scenarios | Git source plus supported repository metadata | Actions secrets/environments/history, Apps, Dependabot alert state, and some policies require recreation | **IT-led fallback with trial migration** |
| Bare mirror into a blank repository | Neither transfer nor GEI is available | Branches/tags/commit graph selected for push | Nearly all repository metadata and integrations | **Last resort** |

GitHub recommends a trial before a GEI production migration and notes that GEI has no delta
migration; production work should pause. GEI does not migrate GitHub Actions secrets, variables,
environments, runners, artifacts, or run history; Dependabot alerts/secrets; GitHub Apps; or commit
status checks. IT must define the supported path if the personal-account source cannot be used
directly by its enterprise migration tooling.

## Execution plan — preferred in-place route

### Phase 1 — Preparation and baseline

1. Record the destination organization, final repository name, visibility, GitHub plan, account
   model, IT owner, application owner, and scheduled freeze window.
2. Resolve every mandatory decision gate above. Stop if EMU/data residency prevents direct
   transfer; switch to the IT-led GEI path.
3. Reconcile local and remote state. The current checkout already contains the unpushed audit
   commit `01f344b5`; include every intended local audit/plan commit in the final source baseline.
   Enumerate all branches, tags, open PRs, Actions runs/artifacts, releases, and worktrees again at
   freeze time.
4. Create an offline, encrypted, access-controlled recovery package:
   - `git bundle` containing every approved branch and tag;
   - GitHub settings inventory containing names/IDs but no secret values;
   - Actions workflow/environment/secret-name inventory;
   - Vercel project snapshot containing project/link/settings and environment-variable names only;
   - last known-good production deployment ID and health evidence.
5. Record a fresh green baseline for all GitHub workflows, the latest Vercel preview and
   production deployments, the seven production aliases, 21 crons, four Blob stores, Neon
   integration, and application health endpoints.
6. Estimate private Actions usage and storage from recent workflow duration, caches, and active
   artifacts; have IT confirm the billing/spend policy will not suspend workflows.

### Phase 2 — Pre-cutover compatibility work

Complete these as ordinary reviewed PRs before the freeze:

1. Resolve or formally accept the public-history privacy prerequisite.
2. Remove or replace the two public GitHub footer links; update `scripts/setup-git-nosync.sh` to
   the final clone URL. Update only current operational references; leave clearly dated historical
   PR links as historical evidence unless IT requires otherwise.
3. Reconcile the workflows with the destination Actions allowlist. If full-SHA pinning is
   mandatory, pin every `uses:` dependency to an approved immutable SHA and pin the Semgrep/Trivy
   supply-chain inputs according to IT policy.
4. Decide whether the Claude workflows and `CLAUDE_CODE_OAUTH_TOKEN` are permitted. Disable them
   before transfer if the destination policy will block or reject that credential.
5. Agree on the initial `main` ruleset. Avoid making the first post-transfer repair impossible:
   either validate the rules in a trial repository or grant an explicit, time-bounded migration
   bypass to the IT/repository owners.
6. Have an organization owner install/configure the Vercel GitHub App for the selected destination
   repository. Confirm Justin is an organization member with repository access, not merely an
   outside collaborator.
7. Confirm every human whose commit should produce a Vercel deployment is a member of the Vercel
   Pro/Enterprise team or has an approved invitation path. Test bot-author behavior separately.

### Phase 3 — Separate visibility from ownership

This ordering isolates the two most likely sources of breakage.

1. Freeze merges, pushes, Dependabot merges, and deployment-setting changes.
2. Make the existing personal repository private **without transferring it yet**.
3. Validate while ownership is unchanged:
   - clone/fetch/push authentication;
   - repository secret and eight environments remain present;
   - Dependabot alerts/security updates remain enabled;
   - a test branch produces the expected Actions and Vercel preview results;
   - production aliases, application health, crons, Blob access, and Neon-backed flows remain
     unchanged.
4. Hold at least one normal monitoring interval. If a critical check fails, repair the visibility
   transition before adding organization policies.

### Phase 4 — Transfer to the managed organization

1. Re-run the freeze census and verify no work landed after the private-state baseline.
2. Confirm the target does **not** already contain the final repository name. Creating a same-name
   destination defeats the in-place transfer and its redirects.
3. Use GitHub's repository **Transfer** operation to move the existing private repository to the
   organization. Do not use `git push --mirror` for this path.
4. Verify immediately:
   - destination owner/name, private visibility, repository ID, default branch, branches, tags,
     issues, PRs, releases, Actions workflows/history, environments, repository secret names,
     Dependabot configuration/status, collaborators/teams, and organization rules;
   - the old web and Git URLs redirect, and no new repository has been created at the old path.
5. Update every maintained clone:

   ```bash
   git remote set-url origin https://github.com/<IT-ORG>/<FINAL-REPO>.git
   git fetch --all --prune
   ```

6. In the **existing** Vercel project, verify whether the Git link followed the repository transfer.
   If it did not, configure the target organization's Vercel GitHub App access, then disconnect the
   stale Git link and connect `<IT-ORG>/<FINAL-REPO>`. Keep project ID
   `prj_56SJKzNer1aV38kKVoP8tl3X0lf3` and production branch `main` unchanged.
7. Verify Vercel's project metadata now names the new organization/repository and the same GitHub
   repository ID where the in-place transfer preserves it.

### Phase 5 — Acceptance tests before reopening merges

| Consumer | Acceptance evidence | Blocking result |
|---|---|---|
| Git access | Authorized fresh clone, fetch, feature-branch push, PR creation; unauthorized user denied | Any access mismatch |
| GitHub policies | Required teams, SSO, base permissions, forking, rulesets, and bypass actors match IT's approved matrix | Owner lockout or bypass too broad |
| Core Actions | Tests, E2E, Semgrep, Gitleaks, and Trivy run successfully under organization policy | Missing/blocked action, runner, permission, or billing |
| Claude workflows | Secret name retained and workflow permitted; invoke only with explicit owner authorization | Missing credential, policy block, or unapproved use |
| Dependabot | Configuration recognized, alerts/security updates enabled, and the next/manual update job can create or update a PR | Updates disabled or bot PR cannot run required checks |
| Vercel preview | A non-`main` push creates a Ready preview tied to the new repository; commit status/comment appears | No deployment or wrong repository/author authorization |
| Vercel production | A deliberately approved `main` merge creates one Ready production deployment | Missing, duplicate, or wrong-project deployment |
| Runtime | All seven aliases serve the new deployment; signed-in and public health smokes pass | Domain/auth/data regression |
| Scheduled work | Exactly 21 expected cron definitions remain enabled; no duplicate project runs them | Missing or duplicated schedule |
| Data/storage | Four Blob stores and the Neon integration remain connected; read/write smoke is bounded and approved | Recreated/empty/wrong resource |
| Configuration | Environment-variable name/scope count reconciles against the preflight inventory; values are never exported into the repo | Missing scope/branch override |
| Local operations | Primary checkout and setup instructions use the new remote; no maintained clone can accidentally push to an obsolete destination | Stale operational remote |

Reopen normal merges only after every blocking row is green and the owner/IT sign-off is recorded.

### Phase 6 — Post-cutover hardening

1. Remove the temporary migration bypass and enable the final `main` ruleset/branch protections.
2. Re-run the exact repository/API inventory and reconcile current docs with `/sweep`.
3. Review Actions artifact/log retention and cache policy under private-repository billing.
4. Enable organization-approved Dependabot, secret scanning, push protection, and code scanning
   features according to available licensing. Keep the repository's existing Gitleaks and Semgrep
   gates unless IT deliberately replaces them.
5. Review all remaining personal collaborators, GitHub Apps, OAuth grants, and organization secret
   access; reduce them to least privilege.
6. Monitor at least one Dependabot schedule, one weekly Trivy schedule, one full cron day, and the
   next ordinary PR-to-production cycle.
7. Preserve the old repository URL redirect. Do not recreate
   `justingallivan/wmkf-research-apps`, because GitHub warns that doing so permanently removes the
   transfer redirect.

## Separate follow-on: IT-managed Vercel ownership

Do not fold a Vercel-team transfer into the GitHub cutover. The current Vercel project is Pro and
can connect to a private organization repository once App and member access are approved.

If IT later requires Vercel ownership, run a separate contract review and migration window.
Vercel documents that deployments, project configuration, domains/aliases, environment variables,
Git link, security settings, and crons transfer with a project. It also documents important
exceptions: Marketplace integrations, Global Config, monitoring/log data, custom log drains, and
Vercel Blob require separate reconnection or transfer mechanisms. This repository currently has a
Neon integration and four Blob stores, so those exceptions are load-bearing.

## Rollback and containment

- **Visibility stage failure:** keep the repository private, stop pushes, and repair access/App
  permissions. Do not make it public merely to restore automation.
- **Transfer-stage GitHub failure:** stop after the first failing acceptance row. Use the encrypted
  Git bundle and settings inventory as recovery evidence. Transfer back only if IT pre-authorizes
  it and GitHub permits it; do not assume reversal is always available.
- **Vercel Git-link failure:** the last production deployment continues serving. Do not recreate the
  project. Repair App access/reconnect the existing project; an explicitly authorized CLI deploy of
  the frozen known-good commit is the contingency, not the primary path.
- **Actions-policy failure:** keep the repository private and transferred; apply approved workflow
  pinning/allowlist changes under the migration bypass, then remove the bypass after green runs.
- **Runtime failure after production merge:** use Vercel's existing deployment rollback/promotion
  controls, then investigate without changing repository visibility or data resources.

## Contract audits

| Audit | Result |
|---|---|
| Whole-flow | Git ownership/visibility → organization policy/App access → Actions/Dependabot/Vercel → runtime and local consumers are represented |
| Partial success | Each acceptance row blocks reopening; a working clone or deployment alone cannot mark the migration complete |
| Async/stale state | Visibility, transfer, GitHub App authorization, Vercel reconnection, and policy propagation are separate stages with re-read gates |
| Helper extraction | `N/A` — no runtime helper change is proposed |
| Durable surfaces | Execution must update current URLs/setup docs, the privacy plan disposition, repository-operating docs, and the final audit receipt |
| Documentation reconciliation | Execution requires `/sweep`; historical links remain historical while current links are updated structurally |
| Symbol/consumer fan-out | Exact old owner/repository strings were searched; two UI links and one setup-script URL are current consumers |

## Official references

- [GitHub — Transferring a repository](https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/transferring-a-repository)
- [GitHub — Setting repository visibility](https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [GitHub — Actions organization policies](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization)
- [GitHub — Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [GitHub — Configuring Dependabot alerts](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-dependabot-alerts)
- [GitHub — Enterprise Importer migrations](https://docs.github.com/en/migrations/using-github-enterprise-importer/migrating-between-github-products/about-migrations-between-github-products)
- [Vercel — Deploying GitHub projects](https://vercel.com/docs/git/vercel-for-github)
- [Vercel — Deploying private Git repositories](https://vercel.com/docs/git#deploying-private-git-repositories)
- [Vercel — Git settings](https://vercel.com/docs/project-configuration/git-settings)
- [Vercel — Transferring projects](https://vercel.com/docs/projects/transferring-projects)
