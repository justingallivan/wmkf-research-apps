---
title: Reviewer Lifecycle — Approved Receipt, Correction and Batch Policies
kind: decision
domain: reviewer-workbench
status: in-progress
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Approved reviewer lifecycle decisions

Branch: `codex/reviewer-lifecycle-approved-policies`. Base: `2a792393`, including
the locally completed Stage 1B implementation, review and email-font hook triage.
The owner approved all three recommendations in this task on 2026-09-04.
This records product authority; implementation status is stated separately.
The original refactor report remains a historical investigation.

## Owner-approved policy

1. **Stage 1C — preserve receipt meaning.** A staff declaration that a review
   was received is sufficient, including partial structured feedback or no
   stored file. Recording receipt enters Review Received and locks another
   normal submission. Human closeout, quality judgment and honorarium eligibility
   remain separate. Retain the already implemented receipt payloads; no backfill,
   fabricated answers or new automatic Complete/payment action.
2. **Stage 1D — protect closed invitation/response history.** Generic invitation
   and response corrections must reject Complete, withdrew and released
   engagements. Existing dedicated closeout notes/eligibility correction stays
   available. Exceptional historical repairs require a separate explicit action.
   Do not turn a generic correction into a withdrawal, release or reopening.
3. **Stage 6A — honest partial batch outcomes.** Retain stop on first failure.
   Return and display successful, failed and unattempted reviewer identifiers,
   so successful updates are not reapplied merely because another row failed.
   Whole-batch authorization still precedes any write. This is a deliberate
   response-contract change, not a behavior-preserving extraction.

## Execution scope

Stage 1C receives independent confirmation of existing behavior. Stage 1D is
the first runtime implementation, followed by necessary Stage 1E failure
handling and approved Stage 6A outcomes in place. Each runtime substage is
separately committed, tested, built and independently reviewed. Stage 6A does
not require the mechanical moves of Stages 2–5 to represent outcomes honestly;
no such moves are included here. Its exact response/consumer contract will be
verified before edits, while Stage 1D is being completed.

No live Dataverse, email, cron, schema operation, historical repair, main merge
or production promotion is included. Public publication remains unapproved;
the earlier automatic-review block is not overridden by these policy choices.

## Contract-reconcile invariants before implementation

Change surfaces: generic reviewer correction and batch outcome paths; existing
receipt code is verification-only. Entry points: staff reviewer/candidate UI,
their authenticated API routes and services. Persistence: existing Dataverse
reviewer suggestions; no new store/field/enum. Consumers: existing reviewer DTOs,
mutation responses and staff UI refresh/error handling. F1 is refuted for
successful current producers. F3 is fixed at `c51fa34d`; F5 remains the UI/batch
implementation target. Source fan-out and caller/adapter contracts were probed
before the separately verified implementations.

| Invariant | Intended surface | Verification |
|---|---|---|
| All receipt families preserve the approved existing semantics | Existing receipt services/guard, DTO, closeout | Real-adapter receipt→DTO→closeout tests; repeat/finality and partial/no-file complements |
| Generic corrections cannot rewrite closed invitation/response history | Candidate service and narrow adapter defense | Closed-state matrix, exact version races, no token/person follow-up after rejection |
| Dedicated closeout correction and named lifecycle operations keep their effects | Existing closeout/terminal/invitation callers | Consumer census and retained real-adapter complements |
| Failure is visible and success refresh depends on confirmed success | Existing status action | HTTP/payload/network failure and stale-context tests |
| Batch processing stops at first failure and represents every requested item | Reviewer service, route and actual consumers | First/middle/last failure, success, all-failed, authorization-before-write and response reconciliation |
| No transport resend, data rollback or unrelated extraction is introduced | Changed diff | Frozen-commit independent review plus full tests, gates and build |

## Status

[VERIFIED via independent source/contract review at `2a792393`] Stage 1C's
existing payloads implement the approved receipt policy. The independent clean
core run passed 15 suites / 240 tests; a separate upload receipt selection passed
27 tests. See the Stage 1C review receipt for scope and test-isolation limits.
The no-file route header is corrected to name Review Received and ordinary
resubmission locking; no executable receipt code changed.

[VERIFIED via source, tests, build, gates and independent review] Stage 1D is
complete at frozen `c51fa34d`: full 770 suites / 10,291 tests, 59 distinct
sequential gate/self-tests, webpack build, and independent PASS (591 tests/probes
and eight detected mutations). Deployment remains separate and pending.
Its contract is:

- Protect defined invitation/response inputs (`invited`, `accepted`, `declined`,
  `emailSentAt`, `responseType`, `responseReceivedAt`), including false/null.
- The generic service receives the server-authorized Request id separately from
  the body and checks a fresh suggestion against that binding. Eligible source
  status is explicit null or accepted/materials_sent/under_review/review_received.
  Closed, missing/unknown status or a completion marker fails closed. Receipt
  alone does not add a new restriction before human closeout.
- Require a concrete fresh ETag; send that exact version through the existing
  adapter option. Map stale version or source/binding conflict to 409, with no
  automatic retry. Rejection precedes token follow-up and any person edits.
- The adapter independently detects the six mapped raw fields, checks source
  state and requires a concrete supplied version or its own guard-read version
  when no caller version was supplied. Never upgrade a supplied stale/malformed
  version or add a bypass flag. Existing notes/eligibility, courtesy, deadline,
  metadata and specialized terminal/acceptance operations keep their contracts.
- Inline invitation stamping can fail after delivery on a now-closed source;
  its existing `inviteRecorded:false` response remains. This is not a new
  pre-send authorization check. Legacy generate-email markAsSent raw stamping,
  separate Request ownership changes, restore generations and postcommit token
  or person failure remain distinct existing boundaries.

Regressions failed against unchanged runtime before implementation. The complete
focused service/route/adapter suites now pass 301 tests, compatibility suites 309,
and composed races 185. These prove the six-field closed/complement matrix,
Request/version races, no later side effects on rejection and retained named
operations. Full evidence and limitations are tracked in
[the Stage 1D receipt](REVIEWER_LIFECYCLE_STAGE1D_RECEIPT_2026-09-05.md).
Stage 1E and 6A are still planned; policy approval is not runtime completion.

## Planned outcome contracts

Stage 1E will fix the existing single-reviewer status handler in place: require
both HTTP success and `success:true`, identify the reviewer when reporting
failure, and refresh only after confirmed mutation success. A failure to refresh
after a confirmed write must not be reported as a failed write. Status feedback
and callbacks must remain bound to the current request, reviewer, action and
mounted context; no automatic retry or general action-framework extraction.
The status-only stale-result protection does not claim to complete general 6B.

The fresh Stage 1E planning review requires a synchronous per-reviewer pending
lock plus an operation token. The lock persists until the attempt settles;
request/mode changes, lost permission, row disappearance and unmount permanently
invalidate that attempt's feedback. Returning to the same request or row does
not revive it. Check currentness after fetch and JSON, before alert/refresh,
and after an awaited refresh failure. Cleanup removes only its matching token
and releases the pending control even when feedback was invalidated. Ordinary
same-context object/callback replacements do not invalidate a valid attempt.
Different reviewers remain independent. No latest-result-only substitute is
accepted because it still permits overlapping same-reviewer writes.

This lock belongs to one mounted panel. Remounts, other tabs and backend
generations never observed by the client remain outside that guarantee. A
callback that returns void or handles its own read errors does not certify a
successful refresh. These limits are not reasons to introduce a shared mutation
framework or alter host loaders in Stage 1E.

The Stage 6A probe found one application PATCH caller, always single-item.
The service still supports batches, so its additive response will use
`savedIds`, `failedIds`, and `notAttemptedIds` for both forms. Preserve HTTP 200
for full success, existing typed pre-write errors, and HTTP 500 for unknown
persistence failures. `success:true` requires every submitted target to have
confirmed success. A failed id denotes an attempted, unconfirmed outcome; it
does not prove the server made no write. Lost responses require reviewing fresh
state before a deliberate retry. No automatic replay or rollback is included.

For a nonempty batch, normalize GUID identity using the authorization helper's
existing trim/lowercase convention and deduplicate in first-occurrence order.
The three arrays must partition those unique targets. Keep current empty-array
validation/fallback behavior and characterize it. Complete authorization of all
targets still precedes all writes; authorization failures retain their existing
error-only envelope and disclose no per-target authorization results. The actual
UI will check returned identities, refresh confirmed saves and describe remaining
outcomes. Its materials-release selection remains unrelated. No new batch screen,
207 status, queue, schema, or cross-request idempotency protocol is introduced.
