# Session 489 Prompt: Choose the Elective Reviewer Lifecycle Stage

## Session 488 Summary

Stage 6B of the reviewer lifecycle work and Codex's Workbench UI polish were both
promoted to `main` and production. The owner merged after all CI checks passed; no
signed-in browser smoke of the 6B surfaces ran on any environment. The Codex
worktree at `../WMKF_Apps-codex` was torn down and both feature branches were
deleted locally and on origin. This checkout is on `main`.

### What Was Completed

1. **Stage 6B promoted (PR #150 → `600cc972`)** — 32 commits from
   `codex/reviewer-lifecycle-stage6b`; eight CI checks green; production deployment
   `dpl_4Jjwwou9LKd3z29KqgXaLmZMaWQw` Ready. Preflight: `main` had not moved since
   the branch was cut, runtime diff limited to `ReviewerManagePanel.js`,
   `ReviewerCloseoutModal.js`, `ReviewersTab.js`; eleven retained reviewer suites
   1,001 tests green at `3ff9fc35`.
2. **Codex UI features promoted (PR #151 → `3fc0a936`)** — Codex rebased
   `codex/ui-features` (22 commits, 15 UI files, no `pages/api`/`lib`) onto the 6B
   merge from a prompt Claude wrote; the one conflict (`ReviewersTab.js`) was
   resolved by carrying `degraded={Boolean(error)}` into Codex's
   `request-reviewer-table` wrapper. Claude verified independently: ten reviewer
   suites / 534 tests green on `d80c8fe7`; deleting the prop turns
   `reviewers-tab-stale-request.test.js` red (the degraded suite alone does not
   catch it). Production deployment `dpl_3hiiDPpWN1Zt1yAWcQnVXPURQfL8` Ready. The
   permission classifier blocked Claude's `gh pr merge`; the owner ran it.
3. **Docs reconciled (`65e0daf6`)** — plan, 6B1/6B2/6B3 receipts, approved
   decisions, readiness audit, workbench-lifecycle wiki no longer say "not merged";
   6B3 receipt gained a Promotion section (both deployments, missing smoke,
   merge-tree correction). Docs catalog regenerated; all doc gates green.
4. **Local smoke attempt (not completed)** — a dev server on port 3001 with
   `NEXTAUTH_URL=http://localhost:3001` started fine, but Claude-in-Chrome could
   not load any localhost origin (error page, zero server hits) while public sites
   loaded. Port 3000 was held by the Codex worktree's dev server. Recorded in
   `project-vercel-cli-deploy-preview-auth.md`.
5. **Teardown** — Codex dev server stopped, worktree removed, `codex/ui-features`
   and `codex/reviewer-lifecycle-stage6b` deleted locally and on origin.

### Commits (all on `main`)
- `600cc972` — Merge PR #150 (Stage 6B)
- `3fc0a936` — Merge PR #151 (Codex UI features, rebased onto 6B)
- `65e0daf6` — Record the promotions in the lifecycle docs
- Session handoff commit: obtain from `git log`.

## Next Items

**Owner direction at close of Session 487, still standing:** the mandatory path of
the reviewer lifecycle plan is done. Present the elective menu from
`docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` for a fresh
choice; do not assume an order.

### Owner Decision Needed

1. **Which elective stage next.** Options: Stage 6D server-side draft fingerprint
   (queued 2026-09-05; contract and SSE-vocabulary change, needs its own plan and
   planning review); Stage 6C extraction of the modal/action components out of
   `ReviewerManagePanel.js`; alternatives 2, 3, 5 (Stage 4 optional, Stage 7
   blocked behind 3/5). Evidence: readiness audit; plan status section.
2. **Production smoke of the 6B surfaces.** Never run on any environment. Cheapest
   evidence now is production itself: open a request's Reviewers tab, open the
   release-materials and closeout modals, confirm "Send reminder" is present, cancel
   without sending. Evidence: 6B3 receipt Promotion section.

### Verified Open

1. **Reviewer-follow-up host refetch error — FIXED in PR #152 (`e9909e91`, S489).** Remaining,
   pre-existing and out of that fix's scope (Opus finding): a cycles-load failure sets `error`
   while `cycleCode` is empty, so the banner renders with no Try again button and the proposals
   effect never runs (`pages/workbench/reviewer-follow-up.js` cycles effect). Historical text:
   the host emptied its proposal list on a refetch error (the worse form of 6B3d). Evidence:
   `docs/plans/REVIEWER_FOLLOW_UP_REFETCH_RESILIENCE_2026-09-05.md`; PR #152.
2. **Wiki coverage of Codex's UI changes.** PR #151 changed 15 UI files (admin,
   dynamics-explorer, expense-reporter, integrity-screener, workbench nav/artifacts,
   reviewer-follow-up, `ReviewersTab` styling). Only
   `docs/plans/UI_FEATURES_CODEX_HANDOFF_2026-09-05.md` describes them; check
   whether any wiki topic states behavior that changed. Evidence: `git diff --stat 600cc972..3fc0a936`.

### Parked

- Stages 2, 3, 4, 5, 7 of the lifecycle plan. Not re-probed.
- Progress-pill alignment/chronology, Ops eligibility view, automatic reviewer
  reminders (gate-protected hold), one-click PDF conversion. Not re-probed.
- Five stale one-off Preview callbacks remain in the Entra app registration
  (`g0buiqhuh`, `7doz4qxsn`, `15rny26o5`, `git-codex-pau-5b4bef`,
  `git-codex-wor-464bcd`). Owner cleanup; read with `az ad app show`. Not this
  session's scope.

### Verify Before Acting

1. **No Codex worktree exists.** Any Codex task now needs a fresh worktree
   (`parallel-agent-worktree` skill). Codex must never run
   checkout/switch/reset/stash/pull in this checkout. Codex's sandbox has no
   network: a sandboxed `git fetch` silently leaves `origin/main` stale and a
   sandboxed `gh` call fails; run those outside the sandbox.
2. **Two stashes** (`stash@{0}` on main, `stash@{1}` on
   `codex/reviewer-promotion-remediation`, July 2026 reconciliation reports)
   predate this work and were left alone.
3. **Merge preflights:** use `git merge-tree --write-tree A B`. The legacy
   `git merge-tree <base> A B` output has no conflict markers to grep and reported
   zero conflicts for a real one this session.
4. **Local browser smoke:** Claude-in-Chrome could not reach localhost from this
   machine; the Entra localhost port exception (any port on `http://localhost`) is
   documented by Microsoft but unverified here. `.env.local` carries full Azure AD,
   NextAuth, interlock and prod-read config; `AUTH_REQUIRED=true`.
5. **Permission classifier** blocked `gh pr merge` and a chained
   `git rev-parse && npm run report:...` this session; expect to hand merges to the
   owner (`! gh pr merge <n> --merge`).

### Do Not Reopen Without New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding. No new schema, live
lifecycle mutation, email send, cron invocation or backfill is authorized. The
owner chose to FIX the recipient-field, proposal-field and refetch-error findings;
do not relitigate them as "the PD previewed it" limits. The owner chose to promote
6B without a browser smoke; do not reopen that decision, just record the smoke
when it happens.

## Preserve These Contracts

- Shipped status ownership: synchronous per-reviewer mutex within one mounted
  panel, permanent invalidation, matching-token cleanup, 6A outcome parsing.
- Materials modal session identity = isOpen + requestId + `membershipKeyFor`
  (suggestionId, name, email, affiliation) + signature/reviewDueDate +
  `proposalKeyFor` (title, abstract, authors, institution), by VALUE; the
  completion exemption requires all of them unchanged; proposal loading is
  invalidated by open/close, request change and unmount only.
- `ReviewersTab` passes `degraded={Boolean(error)}` to the panel inside Codex's
  `request-reviewer-table` wrapper; `reviewers-tab-stale-request.test.js` pins it.
- Send transmits the previewed body verbatim; only the destination address is
  re-resolved server-side. No server re-render at send outside Stage 6D.
- Payload shapes, SSE vocabulary, preview single-flight and tail serialization,
  send-emails one-time gate: unchanged through 6B and PR #151.

## Orchestration Lessons (one line each)

- Verify another agent's rebase yourself: run the full listed selection (Codex ran
  8 of 10 suites) and remove the carried-over line to prove a test goes red.
- A "not merged" report from a sandboxed agent may be a stale ref, not a fact;
  check the shared ref from outside before changing the plan.
- Two unmerged branches showing different UI look like regressions; diff the
  branches before diagnosing.
- When a classifier blocks a one-line merge twice, hand it to the owner; do not
  reshape the command.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` | Status marks 6B promoted; elective stages next |
| `docs/audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md` | 6B3 + amendments; Promotion section with both deployments |
| `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` | Elective menu |
| `docs/plans/UI_FEATURES_CODEX_HANDOFF_2026-09-05.md` | Codex's UI critique and change record |
| `shared/components/reviewers/ReviewersTab.js` | `degraded` wiring inside `request-reviewer-table` wrapper |
| `shared/components/reviewers/ReviewerManagePanel.js` | panel + re-exports; `degraded` gating (6C moved the modal to `ReleaseMaterialsModal.js` and the keys to `reviewer-draft-keys.js`) |
| `pages/workbench/reviewer-follow-up.js` | Codex-rewritten host; refetch-error fix candidate |
| `.claude-memory/project-vercel-cli-deploy-preview-auth.md` | Local/Preview smoke auth facts incl. this session's notes |

## Testing

```sh
# Retained reviewer UI selection (all must stay green)
npm test -- --runInBand --watch=false --runTestsByPath tests/unit/reviewer-action-lifetimes.test.js tests/unit/reviewer-status-mutation-characterization.test.js tests/unit/reviewer-manage-actions-menu.test.js tests/unit/reviewer-closeout-modal.test.js tests/unit/manage-panel-preview-error-retry.test.js tests/unit/reviewer-manage-proposal-attachment.test.js tests/unit/reviewers-tab-stale-request.test.js tests/unit/reviewers-tab-post-send-refresh.test.js tests/unit/reviewers-tab-proposal-binding.test.js tests/unit/reviewers-tab-referral-add.test.js tests/unit/reviewer-follow-up.test.js tests/unit/reviewer-materials-modal-lifetimes.test.js tests/unit/reviewer-manage-degraded.test.js
# Slice exit
npm test -- --runInBand --watch=false && npm run check:types && npm run lint && npm run build -- --webpack && git diff --check
```

## Handoff and Milestone Determination

Production cutover shipped: Stage 6B and the Workbench UI polish are live.
**A DEVELOPMENT_LOG.md entry was added (Session 488).** No CLAUDE.md, schema, API,
environment or memory convention changed. The claim-evidence pilot report recorded
no eligible plan/design edit for this session; no observation row was added.
