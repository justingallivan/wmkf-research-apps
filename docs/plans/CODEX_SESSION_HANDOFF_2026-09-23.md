# Codex session handoff — 2026-09-23

Owner: Claude Code next. Codex is stopping after committing and pushing this file on `codex/download-filenames-census`. No PR merge, `main` push, tenant edit, or Vercel setting change is authorized by this handoff.

## 1. Open PRs created or touched

Snapshot: `git fetch origin` on 2026-09-23; `origin/main=d2720d781c913211cd05ae6eafa92e578b460c6c`. Only PRs #326 and #327 were created or touched by this Codex session. Both target `main`, have no formal GitHub review decision, and had all checks green before this handoff commit. The handoff commit advances #326 and starts a new check cycle; use its new branch tip from Git after the push.

### PR #326 — [safe download filenames and Pre-RP census](https://github.com/justingallivan/wmkf-research-apps/pull/326)

- Branch `codex/download-filenames-census`; implementation head before this handoff `b53f24f98d51f2ae92da3777b10a1673b775b31c`; base `main`. **Not up to date:** `git rev-list --left-right --count origin/main...origin/codex/download-filenames-census` returned `4 5` (four main-only commits). GitHub reported `MERGEABLE` before this handoff.
- Five download/export API routes now use the shared `Content-Disposition` helper to escape unsafe filenames while retaining each route's access and response contract. The Request Document actor census accepts a missing actor for a Pre-RP brief only when row and event producer both match; focused tests cover mismatches. No production census was run.
- Exact files in the implementation PR diff: `docs/CURRENT_WORK_QUEUE.md`; `docs/plans/DOWNLOAD_FILENAMES_AND_CENSUS_CODEX_BRIEF_2026-09-23.md`; `pages/api/dynamics-explorer/download-document.js`; `pages/api/review-manager/download-review.js`; `pages/api/review-manager/export-reviews.js`; `pages/api/reviewer-finder/cycle-material.js`; `pages/api/workbench/export-candidates.js`; `scripts/probe-request-document-explicit-actor-census.js`; `tests/integration/review-manager-download-review.test.js`; `tests/unit/cycle-material-endpoint.test.js`; `tests/unit/download-review-route.test.js`; `tests/unit/dynamics-explorer-download-document-route.test.js`; `tests/unit/export-reviews-route.test.js`; `tests/unit/request-document-explicit-actor-census.test.js`; `tests/unit/workbench-export-candidates-route.test.js`. This handoff adds `docs/plans/CODEX_SESSION_HANDOFF_2026-09-23.md` to the branch.
- **Status: needs work before promotion.** Checklist:
  - [ ] Refresh against current `origin/main`; check the shared work-queue file and rerun affected gates/CI on the final head.
  - [ ] Confirm the new handoff-commit checks finish green; prior green checks were for `b53f24f98`.
  - [ ] Obtain the owner's release timing and deliberately merge to `main`; verify the resulting Production deployment and filename headers. Reconcile the stale Pre-RP item in `SESSION_PROMPT.md` during Claude's merge handoff.
- Verification actually recorded: `/start` configured checks and self-tests passed before edits (individual command/output counts not retained). Focused Jest invocation for five route suites: **30 passed**; census classifier suite: **6 passed**; `node scripts/probe-request-document-explicit-actor-census.js --self-test`: passed (assertion count not retained). Exact focused Jest argv was not retained. ESLint on changed JavaScript/tests, `npm run check:types`, `npm run check:api-routes` and `:self-test`, `npm run check:route-service-boundary` and `:self-test`, `npm run check:doc-currency` and `:self-test`, and `npm run check:fact-consistency` and `:self-test`: passed (counts not retained). After `b53f24f98`, two focused download-review suites: **7 passed**; ESLint and both route gate pairs passed. `gh pr checks 326` showed Jest, Playwright, Claude review, CodeQL, security scans, and Vercel Preview **passed** on that head; CI test counts were not captured. Local full Jest/build/Playwright: **not run** by Codex for this PR.
- Review: read-only Claude Opus 5.5 OAuth review of `f66e8390a..6922ac1db` found no P1/P2/P3; reviewer ran seven focused suites (**41 passed**) and census self-test. The later integration assertion change was not in that local review range. GitHub `claude-review` passed on `b53f24f98`; `gh pr view` showed no human review, and the PR inline-comment API returned `[]`. Unresolved review comments: **none recorded**; final-head review after this handoff is still pending.
- Release tier: **Tier 1** under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (contained runtime response-header and audit-script changes). `main` auto-deploys Production; merge is the release action. No Dataverse migration, env change, or production census execution is part of this PR.

### PR #327 — [Preview alias CSRF smoke runbook](https://github.com/justingallivan/wmkf-research-apps/pull/327)

- Branch/head `codex/preview-alias-csrf-runbook` at `4b4a7959bda03d8b36edb15daac4eeac0e448f7a`; base `main`. **Not up to date:** `git rev-list --left-right --count origin/main...origin/codex/preview-alias-csrf-runbook` returned `4 2`. GitHub reported `MERGEABLE`.
- Documents a temporary, exact Git-branch-scoped Preview `NEXTAUTH_URL` for signed-in POST smoke through the registered stable alias. The runbook requires a new deployment, validation-only POST, and alias/env rollback. It changes no auth code or Vercel setting.
- Exact files: `.claude-memory/project-branded-domains.md`; `.claude-memory/project-vercel-cli-deploy-preview-auth.md`; `docs/AUTHENTICATION_SETUP.md`; `docs/CREDENTIALS_RUNBOOK.md`; `docs/CURRENT_WORK_QUEUE.md`.
- **Status: needs work before promotion.** Checklist:
  - [ ] Refresh against `origin/main`; merge #326 first or reconcile their shared `docs/CURRENT_WORK_QUEUE.md` changes explicitly.
  - [ ] Coordinate `docs/CREDENTIALS_RUNBOOK.md` with the active Test Request Factory branch before its promotion; rerun relevant doc gates and CI on the final head.
  - [ ] Merge only at the owner's release time. No live Preview env, alias, or Entra change is required to merge this documentation PR.
- Verification actually run: `npm run check:docs-catalog` passed (**302** top-level docs); `npm run check:doc-currency` passed (**8** patterns); `npm run check:fact-consistency` passed (**805** live doc/memory files); `npm run check:memory-router` passed (**272** topic files); `npm run check:doc-symbol-refs` passed (**296** files, **1,781** references); `npm run check:memory-drift:no-write` exited 0 but reported **5** existing findings from a stale committed report (advisory, not refreshed). Self-tests: `npm run check:doc-currency:self-test` **13/13**, `npm run check:fact-consistency:self-test` passed, `npm run check:memory-router:self-test` **20/20**, `npm run check:doc-symbol-refs:self-test` passed; counts for the fact-consistency and doc-symbol self-tests were not retained. `git diff --check` passed. The fixture self-tests initially failed with sandbox `EPERM` in the separate worktree, then passed outside the sandbox; `check:fact-consistency` initially lacked local `node_modules`, then passed with the original checkout's `NODE_PATH`. Full local Jest, build, Playwright, and `check:docs-catalog:self-test`: **not run**. `gh pr checks 327` showed Jest, Claude review, CodeQL, security scans, and Vercel Preview **passed**; CI test counts were not captured.
- Review: first GitHub `claude-review` attempt failed before review because the runner could not verify GitHub's certificate while cloning its plugin; one retry passed. `gh pr view` showed no human review and the inline-comment API returned `[]`. Unresolved review comments: **none recorded**.
- Release tier: **Tier 0** (documentation only). `main` still auto-deploys Production, and the owner has deferred promotion. No production or Preview setting change accompanies the PR.

## 2. Owner decisions and pending decisions

- Session-specific instructions not previously captured as a standing product decision: **“I approve. OAuth login only, no API calls”** authorized the ordinary Claude Opus review through the user's OAuth session, without a direct model API or paid review substitute. **“Sounds good. Proceed”** accepted the separate docs-only Preview runbook PR while Production promotion was unavailable. **“Let's do that then”** selected the read-only callback inventory; it did not authorize deleting tenant callbacks or aliases. The latest handoff explicitly says **“Do not start new work, merge, push to main, or close PRs.”** The PRs and this handoff record the resulting work.
- Pending with owner: when to promote each PR to auto-deploying `main`; whether the two old branch Preview aliases are still needed and when the owner should retire their exact Entra callbacks; and the real sandbox source Request selection for the separate Test Request Factory rehearsal. Do not infer consent for tenant writes from the read-only inventory.

## 3. Local and background state

- Before writing this handoff, `git status --short --branch` in the current checkout printed `## codex/download-filenames-census...origin/codex/download-filenames-census` with no changes. The main, Factory, and Preview-runbook worktrees likewise reported clean tracking branches. During drafting, `git status` printed the following; the only untracked item is this file, to be committed and pushed. `git stash list` printed **nothing**. No other uncommitted Codex changes or known unpushed commits existed at that snapshot.

```text
On branch codex/download-filenames-census
Your branch is up to date with 'origin/codex/download-filenames-census'.

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	docs/plans/CODEX_SESSION_HANDOFF_2026-09-23.md

nothing added to commit but untracked files present (use "git add" to track)
```

- `git worktree list` printed exactly:

```text
/Users/gallivan/Code/WMKF_Apps                                              d2720d781 [main]
/Users/gallivan/.codex/worktrees/preview-alias-csrf-runbook/WMKF_Apps-codex 4b4a7959b [codex/preview-alias-csrf-runbook]
/Users/gallivan/Code/WMKF_Apps-codex                                        b53f24f98 [codex/download-filenames-census]
/Users/gallivan/Code/WMKF_Apps-factory                                      dd7181e39 [codex/test-request-preview-integration]
```

- No Codex-owned local watcher or test process was left running; the two `gh pr checks --watch` sessions were stopped. Pre-handoff PR CI had completed. Pushing this handoff commit will start a new PR #326 check/Preview cycle; its outcome is not claimed here. Claude's independent Factory activity is outside this Codex handoff.

## 4. Live-state claims and scope

- **[VERIFIED via `gh pr view`, `gh pr checks`, `git fetch`, and `git rev-list` on 2026-09-23]** #326 and #327 are open, mergeable, previously green, and each four main commits behind. No PR was merged or closed by Codex.
- **[VERIFIED via `az ad app show --id ... --query web.redirectUris` on 2026-09-23]** The staff SSO registration had nine Web callbacks, including the branch-alias stems `git-codex-pau-5b4bef` and `git-codex-wor-464bcd`.
- **[VERIFIED via `vercel inspect` on 2026-09-23]** Those two aliases still mapped to Ready Preview deployments `dpl_9E2jLgeRTsE9jAQrC7VL5WjhpjfQ` (created September 1) and `dpl_5tfbqmBMqdD6WpZgk64Y7Mez4dHD` (created September 2). **[VERIFIED via `git ls-remote --heads origin`]** No `codex/pau*` or `codex/wor*` remote branch was returned. **[ASSUMED]** Their actual human usage is unknown; no traffic audit was run, so absence of a branch does not prove the aliases or callbacks unused.
- **[VERIFIED via this Codex session's command record]** No Production or sandbox Dataverse row, schema, SharePoint file, Entra registration, Vercel alias, or Vercel environment was written. The only live external reads were GitHub PR/CI state, the staff Entra callback list, and Vercel alias/deployment metadata. Git pushes and PR creation caused Git-integrated Preview deployments; neither was a Production deployment. A Preview env-list attempt failed before returning state, so current `NEXTAUTH_URL` values are **[ASSUMED / unverified]**.

## 5. Hazards and dependencies

- Test Request Factory `codex/test-request-preview-integration` is independently owned. Its branch diff overlaps PR #327 in `docs/CREDENTIALS_RUNBOOK.md`; coordinate that file before merging either branch. It does not overlap PR #326's API/census source files in the current diff. PRs #326 and #327 both edit `docs/CURRENT_WORK_QUEUE.md`; sequence and reconcile them. The four new main commits touch docs/memory/instructions, so refresh both PRs against the latest base.
- The runbook depends on the env names `NEXTAUTH_URL` and `VERCEL_URL`, the existing Entra callback registration, and ordinary staff auth configuration (`AUTH_REQUIRED`, `NEXTAUTH_SECRET`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`). No value is recorded here. The Azure and Vercel CLIs used existing OAuth sessions; no agent/provider API key was used for review.
- `SESSION_PROMPT.md` is shared with Claude's Factory handoff and still has the Pre-RP census gap as open. Codex did not edit it under the original brief. Existing retired branch aliases remain reachable even though their Git branch names are absent; deleting their callbacks would invalidate OAuth redirects on those hosts. `SESSION_PROMPT.md` assigns the tenant write to the owner.

## 6. Recommended next actions, in priority order

1. **PR #326:** review this handoff commit, refresh with current `main`, rerun checks, then obtain the owner's deliberate Tier 1 promotion decision. After merge, verify Production deployment and representative filename headers; reconcile `SESSION_PROMPT.md`.
2. **PR #327:** refresh after #326, reconcile the shared queue and Factory credential-runbook edit, rerun doc/CI checks, then merge at the owner's chosen time. Keep the Preview env/alias procedure as documentation until separately authorized for a live smoke.
3. **Callback cleanup:** ask the owner to decide whether the two still-live old aliases can be retired; re-read exact callback list and alias targets immediately before any owner-run removal. No cleanup write is part of this handoff.

Milestone determination: no Production capability, cutover, incident outcome, or removal shipped in this Codex session; no `DEVELOPMENT_LOG.md` milestone entry is required.

Handoff-document checks: `npm run check:docs-catalog` passed (302 docs); `npm run check:doc-currency` passed (8 patterns); `npm run check:fact-consistency` passed (807 files); `npm run check:doc-symbol-refs` passed (296 files, 1,779 references). Their relevant self-tests passed: doc currency 13/13, fact consistency prose/derive, and doc symbol references fixtures. An initial fact-consistency self-test invocation collided with another self-test's temporary fixture directory; the required sequential rerun passed. Full Jest/build/Playwright were not run for this documentation-only commit.
