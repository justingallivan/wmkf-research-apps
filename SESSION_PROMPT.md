# Session 483 Prompt: Approved Reviewer Lifecycle Policies

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
  fixed; F3 and F5 were still known-defect characterizations at Stage 1B. The Stage 1A
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
- [VERIFIED via diff and detector] Stop-hook font findings were in unchanged
  email HTML. Shared Impeccable exceptions now permit Arial for `overused-font`
  and `design-system-font` only in `send-emails-service.js`, with reasons in
  `.impeccable/config.json`. The five overused-font warnings and corresponding
  browser-design font warnings are absent; 21 existing style advisories remain
  visible. Runtime code and its frozen review were unchanged.

## Next Items

### Approved Local Work

The owner approved all three recommendations on 2026-09-04. Active branch:
`codex/reviewer-lifecycle-approved-policies`, based on `2a792393`.
The decision and preimplementation invariants are recorded in
`docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md`.

1. **Stage 1C:** preserve existing receipt meaning, including partial/no-file
   staff declarations. Receipt enters Review Received and prevents another
   normal submission; human closeout and honorarium eligibility stay separate.
   Independent verification passed at `2a792393`: 240 clean core tests plus
   27 targeted upload receipt tests. Only the stale no-file route header needed
   correction; no replacement payload fix or backfill is authorized. See the
   Stage 1C review for inherited full verification and isolation limits.
2. **Stage 1D:** block generic invitation/response corrections on Complete,
   withdrew and released. Preserve dedicated closeout notes/eligibility
   correction. **Complete locally at `c51fa34d`**: same authorized Request and
   exact fresh ETag protect the six fields, including false/null attempts;
   rejection precedes token/person side effects. Full **770 suites / 10,291
   tests**, all **59 distinct** sequential gates, webpack build and independent
   review passed. Review added 591 passing tests/probes and detected eight
   broken mutations. No source correction was required.
3. **Stage 1E — complete locally.** The actual status action now confirms HTTP
   and payload success, identifies unconfirmed writes, and separates refresh
   failure. A per-reviewer synchronous mutex and permanent context invalidation
   prevent duplicate calls and stale feedback. Runtime `bab3adea` passed full
   **770 suites / 10,481 tests**, build and **59 distinct** checks. Fresh review
   required only a stronger persisted mutex test, committed as `77720b5a`;
   re-review passed. Final focused **9 suites / 271 tests** cover the test-only
   delta, including **200** status tests. No runtime correction was needed.
4. **Stage 6A:** retain stop on first failure; return successful, failed and
   unattempted identifiers with whole-batch authorization before writes.
   Update actual consumers; the application currently has a single-item status
   action and no batch status-edit screen. No new batch screen is requested.

Stages 1A/1B/1D/1E are implemented in this branch; Stage 1C confirmed existing
receipt semantics. Approved Stage 6A is next, in place.
Each next substage requires its own
scope, regression proof and fresh-context review. No generic command extraction
or file moves yet.

### Remaining Boundaries

- The three policy choices are settled. F3 and F5's unchecked UI response are
  fixed and regression-tested; F5's missing batch outcomes remain for Stage 6A.
- Stage 1E implements per-reviewer pending ownership, an
  operation token, irreversible request/mode/row invalidation and mounted
  checks around every status continuation. Cleanup releases only its matching
  token even after invalidation. Keep refresh failures distinct from confirmed
  saves. The lock is instance-local; broader 6B is not complete.
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

- `docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md`: current
  product authority and exact preimplementation invariants.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1C_REVIEW_2026-09-04.md`: independent
  existing-receipt confirmation and test-isolation limits.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1D_RECEIPT_2026-09-05.md`: protected
  correction implementation, evidence and residual boundaries.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1D_REVIEW_2026-09-05.md`: fresh independent
  review at `c51fa34d`.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1E_RECEIPT_2026-09-05.md`: UI contract,
  validation and instance-local limits; its linked review closes the test gap.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE6A_RECEIPT_2026-09-05.md`: preimplementation
  outcome contract and exact invariants; implementation remains pending.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1B_RECEIPT_2026-09-04.md`: implementation,
  contract, validation and operational limits.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1B_REVIEW_2026-09-04.md`: independent
  review and discriminating mutation evidence.
- `lib/services/review-manager/send-emails-service.js`: fresh conditional
  post-send bookkeeping and preserved streaming/transport contract.
- `tests/unit/send-emails-service.test.js`: error/partial-success complements.
- `tests/integration/reviewer-engagement-races.test.js`: F2/F4 regressions and
  F3 closed-history regressions; F5's batch outcome defect remains characterized.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE1A_RECEIPT_2026-09-04.md`: historical
  conditional-expiry implementation and its parent-date race limit.
- `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md`: original
  historical investigation and accepted staged plan.

## Release and Handoff Boundary

Owner: Codex. Active branch: `codex/reviewer-lifecycle-approved-policies`.
Stage 1B implementation
`08752364` passed focused/full tests, gates, build and fresh-context review.
The implementation and handoff (`e24597b7`) are committed locally. Automatic
approval review rejected publishing this new Stage 1B payload to the public
configured GitHub repository: the current authorization covers implementation
but does not explicitly cover public publication. The owner must approve
publishing Stage 1B's fix, tests and handoff on this branch before retrying the
push. Stage 1A's earlier publication approval did not cover this payload.
No Stage 1B commit has been pushed; its local work is complete and preserved.
The new policy approvals authorize local implementation, not public publication.
No merge to main or production deployment occurred. Keep session evidence on
this deliberate feature branch with its source. No DEVELOPMENT_LOG milestone
is required because no production capability or architecture shipped.
The claim-evidence pilot report was unavailable because local state could not
be read; no unsupported observation row was invented.
