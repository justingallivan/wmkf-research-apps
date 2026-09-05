# Session 483 Prompt: Reviewer Lifecycle After Version-safe Email Bookkeeping

## Session 482 Summary

Codex orchestrated Stage 1B on `codex/reviewer-lifecycle-stage1b`, based on
published Stage 1A commit `4839444c`. Separate agents investigated the contract,
built the service/unit tests, and converted the F4 composed regressions.

### What Was Completed

- [VERIFIED via source and isolated tests] Non-invitation bookkeeping rereads
  the suggestion after delivery, checks its Request/person binding and concrete
  ETag, and derives status/count from that exact row. Numeric 412 conflicts
  retry bookkeeping with a fresh read, at most three attempts. No transport
  resend occurs.
- Receipt timestamp or Review Received suppresses status advancement while
  permitting delivery stamps/count. Complete/withdrew/released, unknown status
  and completion timestamps block non-courtesy writes. Thank-you stays an
  independent stamp, including after Complete. Existing later timestamps survive.
- Delivered recipients remain in sent results even if bookkeeping fails;
  warnings and terminal result/complete events retain their existing shape.
  Inline invitations, capture and markAsSent behavior remain distinct.
- No adapter, route, schema, enum, DTO, UI or email transport changed. F2 remains
  fixed; F3 and F5 remain explicit known-defect characterizations. The Stage 1A
  receipt is now visibly historical so its old F4 claim is not current guidance.

### Commits

- `08752364` — Make reviewer email bookkeeping conditional on fresh state.

### Verification

- [VERIFIED via focused tests] Service unit: **131 tests passed**. Composed
  races: **81 tests passed**. Receipt/count/version regressions failed before
  source edits. Coverage includes real competing HTTP PATCHes, receipts and
  every terminal state, missing versions/bindings, errors, bounded retries,
  no resend, warning/continuation and terminal SSE.
- All **59 distinct** gate/self-test commands passed sequentially (duplicate
  CI/no-write aliases excluded). `npm run build -- --webpack` passed, with
  existing warnings and no migration-manifest or generated tracked diff.
  Changed-file ESLint and diff checks passed.
- [VERIFIED via full Jest JSON] **770 suites / 10,018 tests passed**, zero
  failures, skips or TODOs. Command: `npm test -- --runInBand --watch=false
  --json --outputFile=/tmp/reviewer-stage1b-full.json`.
- [VERIFIED via independent review] `/root/stage1b_fresh_review`: **PASS** at
  `08752364`, no required runtime correction. Independently passed 313 focused
  tests, detected all seven broken in-memory mutations, and passed five extra
  composed probes. The adapter guard-GET 412 wording was qualified and reread.
- No live Dataverse probe, production cron call, migration, backfill, email,
  merge to main or deployment was performed. Existing full-suite diagnostic
  warnings outside the isolated harness remain baseline debt.

## Next Items

### Verified Open

1. **Stage 1E — honest UI mutation failure handling.**
   Evidence: `shared/components/reviewers/ReviewerManagePanel.js:updateStatus`
   still ignores HTTP/payload outcomes, and the rendered
   `tests/unit/reviewer-status-mutation-characterization.test.js` preserves that
   defect. Fix failure reporting before broader UI extraction.

Stages 1A and 1B are implemented in this branch. Only the selected Stage 1B
substage was executed in this session. Each next substage requires its own
scope, regression proof and fresh-context review. No generic command extraction
or file moves yet.

### Owner Decision Needed

- Stage 1C: F1 remains refuted for current successful receipt producers by the
  contract suite. Changing partial/no-file meaning or backfilling historical
  rows requires an owner decision; do not repeat the old payload fix.
- Stage 1D: define allowed historical response corrections on closed
  engagements before changing the generic contract. F3 tests retain the current
  response-only rewrite behavior.
- Stage 6A: approve successful/failed/unattempted identifiers before changing
  the sequential-error batch response retained by F5 tests.
- Separate architectural boundaries: Request ownership/date changes are not
  locked by suggestion ETags. Remove/restore can reuse the same suggestion and
  Request/person bindings while resetting engagement history; the current row
  lacks a distinct generation identifier. Stage 1B does not solve this cycle or
  impose a global counter protocol on other writers/reset operations.

### Parked

Prior parked items were not re-probed as deployment claims: progress-pill
alignment/chronology (`de79e413`), Ops eligibility view, automatic reviewer
reminders and one-click PDF conversion. The reminder scheduler hold remains
covered by its repository gate. The Atlas's manual-post-send versus automated
claim-before-send duplicate-nudge limit still applies.

### Verify Before Acting

- Check branch, HEAD/upstream and dirty work. This branch includes completed
  Stage 0 and Stage 1A; do not switch to divergent historical branches or use
  old audit line numbers as current evidence.
- Reopen source and the Stage 1B receipt. Historical writer inventories are
  frozen comparisons, not the current source of writer counts or open findings.
- Keep fixture-writing gates/self-tests sequential.
- A bookkeeping warning means the email was already delivered. It is not an
  instruction to resend. No durable repair queue or new per-recipient recovery
  field was introduced.
- Production promotion, live cron invocation, backfill and schema operations
  are separate from this source change.

### Do Not Reopen Without a New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding.

## Key Files

- `docs/audits/REVIEWER_LIFECYCLE_STAGE1B_RECEIPT_2026-09-04.md`: implementation,
  contract, validation and operational limits.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1B_REVIEW_2026-09-04.md`: independent
  review and discriminating mutation evidence.
- `lib/services/review-manager/send-emails-service.js`: fresh conditional
  post-send bookkeeping and preserved streaming/transport contract.
- `tests/unit/send-emails-service.test.js`: error/partial-success complements.
- `tests/integration/reviewer-engagement-races.test.js`: F2/F4 regressions and
  remaining F3/F5 characterizations.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1A_RECEIPT_2026-09-04.md`: historical
  conditional-expiry implementation and its parent-date race limit.
- `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md`: original
  historical investigation and accepted staged plan.

## Release and Handoff Boundary

Owner: Codex. Branch: `codex/reviewer-lifecycle-stage1b`. Implementation
`08752364` passed focused/full tests, gates, build and fresh-context review.
The implementation and handoff (`e24597b7`) are committed locally. Automatic
approval review rejected publishing this new Stage 1B payload to the public
configured GitHub repository: the current authorization covers implementation
but does not explicitly cover public publication. The owner must approve
publishing Stage 1B's fix, tests and handoff on this branch before retrying the
push. Stage 1A's earlier publication approval did not cover this payload.
No Stage 1B commit has been pushed; local work is complete and preserved.
No merge to main or production deployment occurred. Keep session evidence on
this deliberate feature branch with its source. No DEVELOPMENT_LOG milestone
is required because no production capability or architecture shipped.
The claim-evidence pilot report was unavailable because local state could not
be read; no unsupported observation row was invented.
