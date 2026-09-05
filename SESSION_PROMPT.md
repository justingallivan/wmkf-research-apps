# Session 480 Prompt: Reviewer Lifecycle Contract Baseline and First Fixes

## Session 479 Summary

Session 479 completed and promoted the Program Director reviewer-closeout
workflow, refined the reviewer follow-up table, preserved a read-only lifecycle
refactor audit, cleaned obsolete worktrees/branches, and logged one deferred
progress-pill consistency issue.

### What Was Completed

1. **Reviewer closeout and honorarium eligibility reached Production**
   - [VERIFIED via source, focused tests, production build, and Ready Production
     deployment] The lead PD or a superuser can close a received review and
     answer **Should an honorarium be paid?** with Yes or No. No requires a
     reason; notes remain optional otherwise.
   - The ETag-bound write records Complete, the immutable first-completion
     timestamp, notes, and the mapped eligibility disposition on the reviewer
     suggestion row. A later eligibility correction does not restamp completion.
   - Staff upload and partial/no-file receipt paths now atomically write Review
     Received, so the closeout action is available after either receipt path.
   - The application still does not write
     `wmkf_authorizationtoremitpaymentflag`; Operations/Finance retains final
     payment authority. Publishing the existing Ops view in akoyaGO is separate.
   - Runtime/UI commits through `5e101861` reached Ready Production deployment
     `dpl_2uJJQxY9TN4KcfHJGLRS2dW1QVge`.

2. **Reviewer tracking UI was simplified**
   - [VERIFIED via local browser inspection, 56 focused tests, and production
     build] The compact table now combines status and link as Progress, removes
     the wide Notes and Last Action columns, aligns follow-up controls, and
     exposes Close out review directly for received reviews.

3. **Reviewer lifecycle refactor investigation was preserved**
   - `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` is tracked on
     `main` at commit `b6aa318e`.
   - The report is a proposed staged plan pinned to baseline `097b7f17`, not a
     current-source implementation checklist. Its F1 receipt-status defect is
     already partly superseded by `b318ede0`; every other finding must also be
     relocated and reconfirmed before editing.

4. **Obsolete worktrees and their branches were cleaned**
   - [VERIFIED via `git worktree list`] Only the primary checkout remains.
   - Five obsolete worktrees, five local branches, and four remote branches were
     removed after ancestry and dirtiness checks.
   - The detached historical branch `codex/reviewer-closeout-eligibility` still
     exists locally and has diverged from `main` (10 branch-only and 14
     main-only commits as of this handoff). Do not merge or delete it wholesale;
     its relevant closeout implementation already landed through newer commits.

5. **Deferred visual issue was logged**
   - Commit `de79e413` records that Progress pills have inconsistent shapes and
     alignment and that their vertical chronology reverses between active and
     received rows. This is intentionally parked behind lifecycle correctness.

### Commits

- `2631c914` — Build reviewer closeout eligibility workflow
- `75b8ffab` — Record reviewer closeout implementation
- `601ddd3a` — Move reviewer notes into closeout
- `097b7f17` — Simplify reviewer honorarium decision
- `b318ede0` — Align staff receipt lifecycle with closeout
- `b6aa318e` — Preserve reviewer lifecycle refactor investigation
- `5e101861` — Refine reviewer follow-up table layout
- `de79e413` — Log reviewer progress pill consistency issue

## Primary Objective

Begin addressing the issues in
`docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` without treating
its stale baseline or line numbers as current truth.

### Required First Slice: Stage 0 Only

1. Run `/start`, then `/contract-reconcile` in implementation mode.
2. Create a fresh Tier 2 feature branch from current `main`; do not work on the
   old divergent closeout branch and do not push runtime changes directly to
   `main`.
3. Relocate and confirm/refute F1–F6 against current source using CodeGraph first
   and caller/consumer reads after it. Record F1 as already partly fixed, then
   prove the complete producer → DTO → closeout path rather than assuming the
   patch closed the contract.
4. Implement the report's Stage 0 regression harness only:
   - a stateful reviewer-engagement transport fake with row ETags, atomic batch
     behavior, and controlled race pause points;
   - composed contract and race tests beneath the real services/adapters;
   - explicit synthesis-job mocking in `reviewers-service.test.js`, plus a
     separate test for the unavailable dependency path;
   - an alias-aware inventory of lifecycle writers and their intended command,
     receipt-pointer, email-claim, projection, or administrative role.
5. Keep Stage 0 green. Known-defect characterization may document existing
   behavior, but semantic production fixes belong in separately reviewed Stage
   1 commits.
6. After Stage 0 passes, proceed only to independent, currently verified fixes:
   Stage 1A (conditional stale-invite expiry), Stage 1B (version-safe post-send
   bookkeeping), and Stage 1E (honest UI mutation failure handling), one
   substage and fresh-context review at a time.

### Owner Decisions Still Needed Before Their Substages

- **Stage 1C:** confirm the intended semantics for partial/no-file receipt.
  Current source advances it to Review Received, but the full four-producer
  composed contract still needs proof; no historical backfill is authorized.
- **Stage 1D:** define exactly which historical staff corrections remain allowed
  on closed reviewer engagements.
- **Stage 6A:** approve the additive successful/failed/unattempted batch outcome
  response before changing the existing sequential-error contract.

## Contract Guardrails

- Preserve current routes, public DTOs, authentication, DAL context, and the
  Dataverse/Postgres ownership split during Stage 0 and in-place fixes.
- Do not combine semantic fixes with file moves.
- Keep receipt, document-pointer, thank-you claim, withdrawal/release,
  acceptance-job, reminder-claim, and invitation bookkeeping as distinct
  operations. A single arbitrary lifecycle patch command is not the goal.
- Preserve If-Match/version decisions through the actual write. A suggestion
  ETag does not lock its parent Request row.
- Do not resend an email to repair bookkeeping after a post-send conflict.
- No schema migration, backfill, destructive data operation, production cron
  invocation, or deployment is authorized by this handoff.
- Run a new-context review after every numbered stage and semantic substage as
  required by the audit. Do not substitute a paid or metered review product.

## Verify Before Acting

1. The audit's evidence baseline is `097b7f17`; current `main` is newer. Relocate
   symbols and rerun tests before repeating any finding as current fact.
2. F1's cited payload mismatch changed in `b318ede0`; prove all four receipt
   producer families through the real DTO and closeout service.
3. `codex/reviewer-closeout-eligibility` is a divergent historical branch, not
   the next-session workspace.
4. Reviewers-service currently swallows synthesis-job read failure in its DTO
   path. Stage 0 must isolate that dependency without merely hiding its error.
5. Gate and self-test commands run sequentially. Read current
   `docs/CI_GATES_REFERENCE.md` and `package.json` before choosing the exact set.

## Parked

- Progress-pill shape/alignment and chronology, recorded in `de79e413`.
- Publishing the reviewer eligibility view in akoyaGO; the app writer is live.
- Automatic review-due reminder scheduling; the cron hold remains in force.
- One-click PDF conversion of canonical review DOCX files.

## Do Not Reopen Without a New Decision

- Automatically marking a reviewer Complete from a thank-you path.
- Writing `wmkf_authorizationtoremitpaymentflag` from this application.
- BILL API reviewer onboarding.

## Key Files

| File | Purpose |
| --- | --- |
| `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` | Baseline findings, staged plan, invariants, and review protocol. |
| `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md` | Approved closeout/payment-authority contract. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Current lifecycle reads/writes and conditional transport boundary. |
| `lib/services/review-receipt-guard.js` | Shared receipt eligibility and same-row-version contract. |
| `lib/services/reviewer-suggestion-sweep.js` | Stale-invitation expiry path (F2 / Stage 1A). |
| `lib/services/review-manager/send-emails-service.js` | Post-send lifecycle bookkeeping (F4 / Stage 1B). |
| `lib/services/reviewer-finder/my-candidates-service.js` | Generic staff correction path (F3 / Stage 1D). |
| `lib/services/review-manager/reviewers-service.js` | Reviewer DTO and synthesis-job dependency (F1/F6). |
| `shared/components/reviewers/ReviewerManagePanel.js` | Reviewer actions and UI mutation handling (F5 / Stage 1E). |
| `lib/services/review-upload.js` | File receipt producer. |
| `lib/services/review-manager/mark-received-no-file-service.js` | Partial/no-file receipt producer. |

## Stage 0 Verification Baseline

Confirm current script names before running. The report requires the existing
focused suites first, followed by the new composed tests, relevant gates and
self-tests sequentially, and a production build. At minimum preserve coverage
for closeout service/route/modal, reviewers service, all four receipt producers,
stale-invite sweep, email bookkeeping, terminal transitions, token flows,
activity-history reset parity, and request-switch/unmount UI behavior.

## Release Boundary

`main` is clean and synchronized with `origin/main` at `de79e413` at handoff.
Reviewer closeout and the compact tracking UI are Production-live. The next
session begins a separate Tier 2 refactor branch; implementation, review,
promotion, and Production verification remain distinct decisions.
