# Session 482 Prompt: Reviewer Lifecycle After Conditional Invitation Expiry

## Session 481 Summary

Codex orchestrated Stage 1A on `codex/reviewer-lifecycle-stage1a`, based on
completed Stage 0 commit `a18f219b`. Separate agents investigated the contract,
built the sweep/unit tests, and converted the F2 composed regressions.

### What Was Completed

- [VERIFIED via source and isolated tests] Stale-invite expiry now rereads the
  suggestion, checks pending eligibility and Request binding, rereads the
  parent's meeting date, and patches with that suggestion's exact ETag.
  Newer acceptance, exclusion, removal, receipt/completion state, missing or
  malformed versions and 412 conflicts cannot be blindly overwritten.
- The existing result envelope, bounded attempts, discovery-only dry-run,
  actor forwarding and per-row operational-error continuation remain intact.
  `eligible` is a discovery count; `skipped` includes overflow and safe
  no-write outcomes. No adapter, route, schema or email-transport code changed.
- The transport fixture now distinguishes a structured missing-record GET
  from invalid endpoints. F3/F4/F5 retain their known-defect assertions.
  Stage 0 receipts and inventory are explicitly historical snapshots.

### Commits

- `721f4f3d` — Make stale reviewer invitation expiry conditional on fresh state.

### Verification

- [VERIFIED via Jest JSON] Full suite: **770 suites / 9,913 tests passed**,
  zero failures or skips.
- Focused sweep/race/helper/receipt coverage: **4 suites / 159 tests passed**.
  Three F2 regressions and the expanded unit suite failed against the old
  implementation before the fix. Changed-file lint and diff checks passed.
- All **59 distinct** gate/self-test commands passed sequentially (duplicate
  CI/no-write aliases excluded). `npm run build -- --webpack` passed, with
  existing warnings and no migration-manifest or generated tracked diff.
- Fresh-context review `/root/stage1a_fresh_review`: **PASS** at `721f4f3d`,
  no required runtime corrections; independently reran 159 focused tests and
  performed three discriminating in-memory mutation checks.
- The explicit boundary test proves that a parent meeting-date edit after its
  final read remains outside the suggestion ETag's protection. No cross-record
  lock or Request ownership-policy change was introduced.
- No live Dataverse probe, production cron call, migration, backfill, email,
  merge to main or deployment was performed. Existing full-suite diagnostic
  warnings outside this harness remain baseline debt, not live-I/O proof.

## Next Items

### Verified Open

1. **Stage 1B — version-safe post-send bookkeeping.**
   Evidence: `lib/services/review-manager/send-emails-service.js` and retained
   F4 race tests. Reevaluate status/count on the exact version written after
   delivery. Preserve delivery outcomes; never resend email as a stamp retry.
2. **Stage 1E — honest UI mutation failure handling.**
   Evidence: `shared/components/reviewers/ReviewerManagePanel.js:updateStatus`
   and `tests/unit/reviewer-status-mutation-characterization.test.js`.
   Fix HTTP/payload failure reporting before broader UI extraction.

Stage 1A is complete in this branch. Only the selected substage was
executed. Each subsequent substage requires its own deliberate scope,
regression proof and fresh-context review. No generic command extraction or
file moves yet.

### Owner Decision Needed

- Stage 1C: F1 is refuted for current successful receipt producers. Do not
  repeat the old payload fix. Changing partial/no-file receipt meaning or
  backfilling historical rows requires an owner decision.
- Stage 1D: define permitted historical response corrections on closed
  engagements before changing the generic correction contract.
- Stage 6A: approve successful/failed/unattempted identifiers before changing
  the sequential-error batch response.
- Cross-record Request ownership and meeting-date locking remain separate
  policy/architecture questions.

### Parked

Prior parked items were not re-probed as deployment claims: progress-pill
alignment/chronology (`de79e413`), Ops eligibility view, automatic reviewer
reminders and one-click PDF conversion. The reminder scheduler hold remains
covered by its repository gate.

### Verify Before Acting

- Check branch, HEAD/upstream and dirty work before edits. This branch includes
  the Stage 0 baseline; do not switch to the divergent historical closeout
  branch or treat historical audit line numbers as current source.
- Reopen source and the Stage 1A receipt for present behavior. Stage 0's
  inventory remains useful as a frozen comparison, not a current writer list.
- Keep all fixture-writing gates and their self-tests sequential.
- Production promotion, live cron invocation, backfill and schema operations
  are separate from this completed source change.

### Do Not Reopen Without a New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding.

## Key Files

- `docs/audits/REVIEWER_LIFECYCLE_STAGE1A_RECEIPT_2026-09-04.md`: implementation,
  contract, test evidence and operational limits.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1A_REVIEW_2026-09-04.md`: independent
  review, tests and mutation evidence.
- `lib/services/reviewer-suggestion-sweep.js`: conditional expiry.
- `tests/unit/reviewer-suggestion-sweep.test.js`: eligibility/error/boundary cases.
- `tests/integration/reviewer-engagement-races.test.js`: F2 regressions and
  retained F3/F4/F5 characterizations.
- `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md`: original
  historical investigation and staged plan.

## Release and Handoff Boundary

Owner: Codex. Branch: `codex/reviewer-lifecycle-stage1a`. Implementation
`721f4f3d` passed focused/full tests, gates, build and fresh-context review.
No merge to main or production deployment occurred. Keep session evidence on
this feature branch with the reviewed source. No DEVELOPMENT_LOG milestone
entry is required because no production capability or architecture shipped.
The claim-evidence pilot report was unavailable because local state could not
be read; no unsupported observation row was invented.

[VERIFIED via successful branch push] The owner explicitly approved publishing
the Stage 1A runtime fix, tests and handoff to the public configured GitHub
repository. `codex/reviewer-lifecycle-stage1a` was pushed to `origin` and now
tracks `origin/codex/reviewer-lifecycle-stage1a`. The earlier automatic-review
publication block is resolved. Implementation `721f4f3d`, handoff `836a3772`
and the approval-boundary record `4fddc9a9` are backed up remotely. No merge
to main or production promotion was performed.
