# Session 481 Prompt: Reviewer Lifecycle In-place Fixes After Stage 0

## Session 480 Summary

Stage 0 established the reviewer lifecycle regression harness on
`codex/reviewer-lifecycle-stage0`. Codex orchestrated separate receipt-harness,
race/UI, and writer-inventory builders and a fresh-context review. This branch
contains tests, an offline census script, and evidence/handoff documentation;
no application runtime behavior, schema, deployment, email, or external records
were changed.

### What Was Completed

1. **Composed receipt and concurrency baseline**
   - [VERIFIED via focused and full Jest] Six variants across four receipt
     producer families execute real services/adapters/HTTP serialization,
     reviewer DTOs and closeout, with explicit external dependency boundaries.
   - Same-row ETags, parent/child rollback, competing submissions, receipt versus
     withdrawal/release, request binding, immutable first completion, unknown
     persisted values, and post-completion document/thank-you behavior are
     covered. The fake has independent integrity tests and observes unsupported
     requests even if a service catches their errors.
   - F1 is refuted for current successful receipt writes: the status payload fix
     already landed in `b318ede0`. Legacy receipt-plus-old-status rows remain a
     separate characterization; no backfill is authorized.

2. **Current defects are reproducible without changing production semantics**
   - [VERIFIED via real-service/real-adapter race tests] F2 stale-invite overwrite,
     F3 closed-row generic response rewrite, F4 receipt regression/lost reminder
     increment, and F5 partial batch/UI failure handling remain present.
   - Existing terminal/412 protection, no transport resend, and first/middle/last
     batch failure complements are also asserted. UI tests cover pending success
     and failure across request switches and unmounts.
   - Every known-defect test is named explicitly and remains green until the
     corresponding deliberate semantic fix replaces its expectation.

3. **Test isolation and caller inventory**
   - [VERIFIED via 23 focused tests] Reviewers-service explicitly mocks synthesis
     job state and separately proves unavailable-state fallback/logging, with
     SQL/fetch no-call assertions. F6's concrete isolation gap is fixed.
   - [VERIFIED via census and source reads] 55 imported suggestion writer-export
     call sites are separated from 99 reader/pure calls, plus distinct descriptor,
     adapter-internal, raw script, token, reset/merge and administrative paths.
     The read-only script scans 1,282 tracked source/script files on this branch;
     173 recognized calls, zero recognized unresolved computed aliases and zero
     parse errors. Its file-local/static limitations are explicit.
   - Full-suite verification exposed a pre-existing Awardees Layout mock lacking
     PageHeader. A separate minimal test-only repair preserves its five assertions.

### Commits

- `ffc932b7` — Keep session start gate list current (startup maintenance)
- `79434493` — Fix Awardees test fixture for PageHeader
- `b2da65ac` — Establish reviewer lifecycle contract and race baseline

### Verification

- Full Jest: **770 suites / 9,834 tests passed**, no failures or skips.
- All **61** check/self-test commands passed sequentially.
- `npm run build -- --webpack` passed with existing build warnings; migration
  manifest unchanged. Changed-file lint and diff checks passed.
- Fresh review `/root/stage0_fresh_review`: **PASS**, no required corrections,
  against `b2da65ac`; independently ran 119 changed/new and 188 retained tests.
  The complete review is in the Stage 0 review document.
- Full-suite legacy missing-connection-string diagnostics remain in other
  intake/acceptance/coalescing tests; the Stage 0 suites enforce isolated
  boundaries. A green full test suite is not proof of live Dataverse behavior.
- No live/production probes or release were performed. The document-filing test
  simulates the mandatory production-classified preflight entirely inside an
  intercepted in-memory transport and restores its environment afterward.

## Next Items

### Verified Open

1. **Stage 1A — conditional stale-invite expiry.**
   Evidence: `lib/services/reviewer-suggestion-sweep.js:93` and the F2 race tests.
   Re-read eligibility and write against that same suggestion version; handle
   changed/missing versions and 412 without blind overwrite. A suggestion ETag
   does not protect the parent Request's meeting date.
2. **Stage 1B — version-safe post-send bookkeeping.**
   Evidence: `lib/services/review-manager/send-emails-service.js:918` and F4 race
   tests. Preserve delivery outcomes; re-evaluate bookkeeping on the version
   written. Never resend email as a bookkeeping retry.
3. **Stage 1E — honest UI mutation failure handling.**
   Evidence: `shared/components/reviewers/ReviewerManagePanel.js:1788` and the
   new status-mutation characterization suite. Fix HTTP/payload failure reporting
   independently of later UI extraction and broader async state changes.

Execute only the selected authorized substage, replace its known-defect tests
with desired regression assertions, keep it green, and obtain a new-context
review before advancing. No file moves or generic command extraction yet.

### Owner Decision Needed

- **Stage 1C semantics:** all current receipt families are now proven to write
  Review Received and support closeout. Do not redo the old payload correction.
  Any change to the meaning of partial/no-file receipt needs the owner's decision;
  historical row backfill remains unauthorized.
- **Stage 1D:** define allowed historical response corrections on closed
  engagements before changing the generic staff correction contract.
- **Stage 6A:** approve successful/failed/unattempted identifiers before revising
  the existing sequential-error batch response.
- Parent Request ownership changing during multi-record work remains an explicit
  authority-policy question; Stage 0 adds no cross-record authorization lock.

### Parked

Per the prior handoff, not re-probed as deployment claims this session:
progress-pill alignment/chronology (`de79e413`), surfacing the Ops eligibility
view, automatic review reminders, and one-click PDF conversion. The reminder
scheduler hold is independently verified by its passing gate.

### Verify Before Acting

- Start from this branch and inspect its current HEAD/upstream; do not use the
  divergent historical closeout branch as a workspace.
- The original refactor audit is pinned to `097b7f17`; current implementation
  evidence lives in the Stage 0 receipt and writer inventory. Reopen source
  rather than using the original line numbers as current truth.
- Review unknown dirty changes before editing. Gate/self-test batteries remain
  serial. Census is an inventory, not a new enforcement gate.
- No migration, backfill, destructive cleanup, production cron invocation,
  merge to main, or deployment is authorized by this handoff.

### Do Not Reopen Without a New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding.

## Key Files

| Path | Purpose |
|---|---|
| `docs/audits/REVIEWER_LIFECYCLE_STAGE0_RECEIPT_2026-09-04.md` | Current evidence, baseline/final verification and fresh review. |
| `docs/audits/REVIEWER_LIFECYCLE_WRITER_INVENTORY_2026-09-04.md` | Alias-aware writer/read matrix and bounded census reproduction. |
| `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` | Historical findings and staged plan; never a current-source checklist. |
| `tests/helpers/reviewer-engagement-transport.js` | Stateful HTTP fake beneath real transport/service code. |
| `tests/integration/reviewer-engagement-contract.test.js` | Receipt/DTO/closeout, atomic races and postreceipt contracts. |
| `tests/integration/reviewer-engagement-races.test.js` | Current F2–F5 and protected complements. |
| `tests/unit/reviewer-status-mutation-characterization.test.js` | Rendered UI failure/stale-callback baseline. |
| `scripts/inventory-reviewer-lifecycle-writers.js` | Read-only static census; no application imports or live calls. |

## Release Boundary

This work remains on `codex/reviewer-lifecycle-stage0`; review, promotion and
production verification are separate decisions. No DEVELOPMENT_LOG milestone
entry is needed because no production capability or runtime architecture shipped.
The claim-evidence pilot metadata report was unavailable because local state
could not be read; no unsupported zero-advisory observation was recorded.
