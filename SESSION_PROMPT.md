# Session 488 Prompt: Decide Promotion of Stage 6B; Plan Stage 6D

## Session 487 Summary

Stage 6B of the reviewer lifecycle work is complete on branch
`codex/reviewer-lifecycle-stage6b`: 6B2 (reminder action and closeout modal), 6B3
(materials-release modal) and five owner-decided amendments to 6B3 driven by a
chain of Codex adversarial reviews. Claude (Fable) orchestrated; Sonnet subagents
built each slice with sole file ownership; fresh-context Opus subagents reviewed
with reproduced guard removals; Codex ran an adversarial review after each PASS.
The last amendment (6B3e) was built by Codex through the rescue runtime and
reviewed by Claude directly. **Nothing from this session is merged to `main` or
deployed.** Promotion is a separate, deliberate action under the release strategy.

### What Was Completed

1. **Stage 6B2 (`b08c16f6`, `d3ec406a`, `039d5d8e`)** — `ReviewReminderAction` and
   `ReviewerCloseoutModal` bind feedback to their committed session (request,
   reviewer, permission), release locks by attempt identity, invoke the latest
   committed callbacks without awaiting their promises, and the closeout modal
   closes itself on committed permission loss (owner decision after a Codex
   finding). Opus PASS after one BLOCK round; Codex re-review PASS.
2. **Stage 6B3 (`a6a27ce8`, `b163172a`)** — `ReleaseMaterialsModal` session identity
   (open state, request, sorted membership), a finished send-stream state with a
   local results accumulator, a one-use completion cause exempting the parent's
   post-send selection clear, and attempt-owned upload/save-template lifetimes.
   Opus BLOCK on an over-broad proposal-load invalidation, corrected; PASS.
3. **Amendments after Codex adversarial reviews**, each Opus PASS unless noted:
   6B3a `3a4bcbbe`/`0a4eafd6` (signature and review due date in the key, with a
   due-date follow rule); 6B3b `9a790c64`/`529ee426` (recipient name, email,
   affiliation by value via `membershipKeyFor`); 6B3c `2622dfc7`/`4524eb95`
   (proposal title, abstract, PI, institution via `proposalKeyFor`); 6B3d
   `be76760f`/`0cd466bc` (`ReviewersTab` keeps the same-request proposal on a
   refetch error, case-insensitive GUID guard); 6B3e `5b57991d` (degraded mode:
   Retry control in the error banner, `degraded` prop disables release, row
   actions, reminder send, closeout trigger and the open modal's Send; Codex-built,
   Claude-reviewed with one wiring correction).
4. **Exit evidence at `5b57991d`** — full suite 773 suites / 11,323 tests,
   `check:types`, lint 0 errors / 75 pre-existing warnings, webpack build with no
   generated changes, `git diff --check`, seven runtime gate pairs, doc gates and
   docs catalog, all green. Every frozen commit has a HEAD-logged exit log.
5. **Documentation** — `docs/audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md`
   and `..._STAGE6B3_RECEIPT_2026-09-05.md` (the latter with amendment sections
   6B3a–6B3e, all Codex verdicts quoted, every accepted limit); plan, approved
   decisions, readiness audit and the workbench-lifecycle wiki topic reconciled;
   Stage 6D queued.

### Commits (branch `codex/reviewer-lifecycle-stage6b`, base `dcd58b32`)
- `b08c16f6` `d3ec406a` `b0a94790` `1147ce5d` `039d5d8e` `489e07f2` — Stage 6B2 and its receipt
- `a6a27ce8` `b163172a` `7e05d495` `8c29e67d` — Stage 6B3 and its receipt
- `3a4bcbbe` `0a4eafd6` `11ac925c` — 6B3a
- `9a790c64` `529ee426` `086cffee` — 6B3b
- `2622dfc7` `4524eb95` `7ceca3a7` — 6B3c and the Stage 6D queue entry
- `be76760f` `0cd466bc` `2db6bdfd` — 6B3d
- `5b57991d` `90235820` — 6B3e
- Session handoff commit: obtain from `git log`.

## Next Items

### Owner Decision Needed

1. **Promote the branch.** Tier 1 runtime work: open a PR from
   `codex/reviewer-lifecycle-stage6b` to `main`, let CI run, merge deliberately,
   then watch the deployment (`feedback-deployment-monitoring-use-inspect`).
   Evidence: `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` status section;
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. No browser or live probe
   ran for any 6B slice; a signed-in Workbench smoke on Preview before merge is the
   cheapest missing evidence.
2. **Plan Stage 6D — server-side draft fingerprint.** Queued by the owner
   2026-09-05: render-emails returns a per-draft fingerprint of every body input
   (recipient, proposal including co-investigators, settings); send-emails
   recomputes and refuses a stale draft with a new `skipped` code the modal
   renders. Contract and SSE-vocabulary change; needs its own plan and planning
   review, not a 6B amendment. Evidence: plan status section `[PLANNED]` block;
   6B3 receipt amendment sections 6B3c/6B3d.

### Verified Open

1. **Reviewer-follow-up host refetch error.** `pages/workbench/reviewer-follow-up.js`
   empties its proposal list on a refetch error, unmounting the panel and any open
   modal (the worse form of the 6B3d finding). Pre-existing; the 6B3d/6B3e pattern
   (keep last-known-good for the same scope, degrade controls, offer Retry)
   applies. Evidence: 6B3 receipt 6B3d/6B3e limits; reviewer trace at
   `reviewer-follow-up.js:~198–201`.
2. **Stage 6C extraction** (move the modal and action components out of
   `ReviewerManagePanel.js`). Explicitly outside the 6B handoff; after promotion.

### Parked

- Stage 2 shared policy, Stage 3 closeout-command pilot, Stage 4 decomposition,
  Stage 5 pointer/thank-you operations, Stage 7 boundary gate. Not re-probed. See
  `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md`.
- Progress-pill alignment/chronology, Ops eligibility view, automatic reviewer
  reminders (gate-protected hold), one-click PDF conversion. Not re-probed.

### Verify Before Acting

1. **Codex worktree and branch drift.** A separate Codex session ran
   `git checkout main` in this checkout mid-session (15:30:06), voiding a
   background full-suite run. Codex now works in `../WMKF_Apps-codex` on
   `codex/ui-features` and must never run checkout/switch/reset/stash/pull here.
   Every background verification log records HEAD at start and end; treat a
   mismatch as void. Memory: `feedback-verify-branch-before-git-action`.
2. **Two stashes** (`stash@{0}` on main, `stash@{1}` on
   `codex/reviewer-promotion-remediation`, both July 2026 reconciliation reports)
   predate this work and were left alone.
3. **Impeccable hook false positive** (gray-on-white contrast at the closeout
   disposition label) was disclosed; the ignore write via `hook-admin.mjs` was
   blocked by the permission classifier and is NOT persisted. Expect it again.
4. **Accepted limits that later stages inherit** (all in the receipts): callback
   promises observed, not awaited; no post-close refresh-failure surface; closeout
   auto-closes on permission loss; a membership, settings, recipient or proposal
   change during an in-flight materials send returns to compose while the
   server-side one-time gate bounds a duplicate; client keys see only what the
   panel has refetched and never co-investigators (6D); degraded mode is
   advisory, controls re-enable optimistically while a retry loads.
5. **Receipt figures are reviewer-measured.** Builders under-reported red
   baselines twice (12 vs 13; 12 vs 14 split). Leave a placeholder until the
   reviewer's number exists.

### Do Not Reopen Without New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding. No new schema, live
lifecycle mutation, email send, cron invocation or backfill is authorized. The
owner explicitly chose to FIX rather than accept the recipient-field, proposal-
field and refetch-error findings; do not relitigate those as "the PD previewed
it" limits.

## Preserve These Contracts

- Shipped status ownership: synchronous per-reviewer mutex within one mounted
  panel, permanent invalidation, matching-token cleanup, 6A outcome parsing.
- Materials modal session identity = isOpen + requestId + `membershipKeyFor`
  (suggestionId, name, email, affiliation) + signature/reviewDueDate +
  `proposalKeyFor` (title, abstract, authors, institution), by VALUE; the
  completion exemption requires all of them unchanged; proposal loading is
  invalidated by open/close, request change and unmount only.
- Send transmits the previewed body verbatim (PD edits are a feature); only the
  destination address is re-resolved server-side. Do not add server re-render at
  send outside Stage 6D.
- Payload shapes, SSE vocabulary, preview single-flight and tail serialization,
  send-emails one-time gate: unchanged through all of 6B.

## Orchestration Lessons (one line each)

- Await a host callback's promise only when you will report its failure.
- Over-broad invalidation is the same defect class as missing invalidation; a
  brief saying "bump on request change" must not ship as "bump on any change".
- If an argument ("the PD previewed it") did not stop the last fix, it does not
  justify accepting the next one; decide the boundary before building.
- A Codex adversarial chain finds the next boundary each round; set the stopping
  rule up front (this session ran five rounds before the owner called it).
- Codex-built work: reproduce the mutations yourself; its red-first claim was the
  missing test file, not red tests.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` | Execution contract; status marks 6B complete, 6D queued |
| `docs/audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md` | 6B3 plus amendments 6B3a–6B3e, all Codex verdicts, limits |
| `docs/audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md` | 6B2 invariants, reviews, permission-loss close |
| `docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md` | Owner decisions incl. 6D queue |
| `shared/components/reviewers/ReviewerManagePanel.js` | `membershipKeyFor`/`proposalKeyFor` ~551–600; modal ~600–1830; `degraded` gating |
| `shared/components/reviewers/ReviewersTab.js` | `loadReviewers` catch ~154–169; Retry banner ~514; `degraded={Boolean(error)}` |
| `shared/components/reviewers/ReviewerCloseoutModal.js` | 6B2 session binding and permission-loss close |
| `tests/unit/reviewer-materials-modal-lifetimes.test.js` | 43 modal lifetime cases |
| `tests/unit/reviewer-manage-degraded.test.js` | Degraded-mode gating through the panel |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Wiki topic with 6B2/6B3 paragraphs |

## Testing

```sh
# Retained UI selection (all must stay green)
npm test -- --runInBand --watch=false --runTestsByPath tests/unit/reviewer-action-lifetimes.test.js tests/unit/reviewer-status-mutation-characterization.test.js tests/unit/reviewer-manage-actions-menu.test.js tests/unit/reviewer-closeout-modal.test.js tests/unit/manage-panel-preview-error-retry.test.js tests/unit/reviewer-manage-proposal-attachment.test.js tests/unit/reviewers-tab-stale-request.test.js tests/unit/reviewers-tab-post-send-refresh.test.js tests/unit/reviewer-follow-up.test.js tests/unit/reviewer-materials-modal-lifetimes.test.js tests/unit/reviewer-manage-degraded.test.js
# Slice exit
npm test -- --runInBand --watch=false && npm run check:types && npm run lint && npm run build -- --webpack && git diff --check
```

## Handoff and Milestone Determination

No production capability shipped; the branch is unmerged. **No DEVELOPMENT_LOG.md
entry is required.** No CLAUDE.md, schema, API, environment or memory convention
changed. The claim-evidence pilot report recorded no eligible plan/design edit
for this session; no observation row was added.
