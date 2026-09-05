---
title: Reviewer Lifecycle — Approved Receipt, Correction and Batch Policies
kind: decision
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
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

Stage 1C independently confirmed existing behavior. Stages 1D, 1E and 6A were
implemented in place, separately committed, tested, built and independently
reviewed. Stage 6A's exact response/consumer contract was reviewed before edits.
All work in that released milestone is complete; no general action framework
or file moves were included. On 2026-09-05 the owner selected **Stage 6B for
the next session**, starting with token/removal/terminal actions (6B1), then
reminder/closeout (6B2) and materials context safety (6B3), with fresh review
between slices. **This is planned work, not another implemented milestone.**
Use the [Stage 6B build plan](../REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md) and
[remaining readiness audit](REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md).
Stages 2–5, 6C and 7 remain outside the selected next build; their dependencies
and optional portions are classified in that audit.

The local implementation scope included no live lifecycle mutation, email,
cron, schema operation or historical repair. On 2026-09-05 the owner explicitly
approved public publication, resolving the earlier automatic-review block;
the first published branch revision was `d76b3bb5` while main was `90053d11`.
The owner subsequently approved deployment without separate human UAT or a
live rollback drill, with campaign timing permitting. [VERIFIED via GitHub/Vercel
metadata and authenticated browser reads] PR 149 merged as `c19a16d8` and
deployment `dpl_6tVnMbnSMtqwtss15bEdSzBz4ELj` reached READY Production; the
staff Workbench/Track Reviewers read-smoke passed. Human UAT, live lifecycle
write/send testing and rollback execution are not claimed. See
[the release receipt](REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md) for exact final
CI, source/deployment evidence and accepted verification limits.

## Contract-reconcile invariants before implementation

Change surfaces: generic reviewer correction and batch outcome paths; existing
receipt code is verification-only. Entry points: staff reviewer/candidate UI,
their authenticated API routes and services. Persistence: existing Dataverse
reviewer suggestions; no new store/field/enum. Consumers: existing reviewer DTOs,
mutation responses and staff UI refresh/error handling. F1 is refuted for
successful current producers. F3 is fixed at `c51fa34d`; F5's unchecked UI is
fixed at `bab3adea`, and its batch outcomes are fixed at `5b9964c8`.
Source fan-out and caller/adapter contracts were probed
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
and eight detected mutations). Its subsequent production release is recorded
in the release receipt above; that deployment does not expand the frozen test scope.
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

Regressions failed against unchanged runtime before implementation. At Stage 1D,
the complete focused service/route/adapter suites passed 301 tests, compatibility
suites 309, and composed races 185. These proved the six-field closed/complement matrix,
Request/version races, no later side effects on rejection and retained named
operations. Full evidence and limitations are tracked in
[the Stage 1D receipt](REVIEWER_LIFECYCLE_STAGE1D_RECEIPT_2026-09-05.md).
Stage 1E is complete locally at runtime `bab3adea` and test correction
`77720b5a`: full 770 suites / 10,481 tests, webpack build, 59 distinct checks,
and independent review passed. The reviewer required a persisted live-DOM
reentrant mutex test; its narrow re-review passed 200 status tests and proved
mutex removal fails both new normal/StrictMode cases. Final focused coverage
is 9 suites / 271 tests; the full run preceded that test-only correction.
See the Stage 1E receipt for the frozen review and limits.

[VERIFIED via frozen source, tests, build, gates and independent review] Stage 6A
is complete locally at `5b9964c8`: full **770 suites / 10,850 tests**, webpack
build, **59 distinct** sequential gate/self-tests, and independent PASS with
**841 tests across nine suites**. All **15** deliberately broken source variants
were detected, producing 60 expected assertion failures and zero runtime errors.
No implementation correction was required. The actual composed tests preserve
the prior lifecycle regressions and prove authorization-before-write, exact
partial outcomes and committed-but-unconfirmed response loss. See
[the Stage 6A receipt](REVIEWER_LIFECYCLE_STAGE6A_RECEIPT_2026-09-05.md).

## Implemented status feedback and batch outcome contracts

Stage 1E fixes the existing single-reviewer status handler in place: require
both HTTP success and `success:true`, identify the reviewer when reporting
failure, and refresh only after confirmed mutation success. A failure to refresh
after a confirmed write must not be reported as a failed write. Status feedback
and callbacks must remain bound to the current request, reviewer, action and
mounted context; no automatic retry or general action-framework extraction.
The status-only stale-result protection does not claim to complete general 6B.

The Stage 1E implementation supplies a synchronous per-reviewer pending
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
The service supports batches, and its additive response uses
`savedIds`, `failedIds`, and `notAttemptedIds` for both forms. It preserves HTTP 200
for full success and the existing error-only envelopes for route validation,
authorization and service dedicated-target prechecks. Every failure from an
invoked adapter operation retains sanitized HTTP 500 with outcome arrays,
including adapter validation/guard failures before a write. `success:true`
requires every submitted target to have confirmed success. A failed id identifies
an unconfirmed adapter operation; it proves neither that a database write began
nor that it did not commit. Lost responses require reviewing fresh state before
a deliberate retry. No automatic replay or rollback is included.

For a nonempty batch, the service normalizes GUID identity using the authorization
helper's existing trim/lowercase convention and deduplicates in first-occurrence
order. The three arrays partition those unique targets. Single calls preserve
the submitted ID and lifecycle object; the UI compares canonical GUID identities
for either ID format. Existing empty-array HTTP fallback remains; the service
now uses the same nonempty discriminator for
that fallback's dedicated-status precheck. Complete authorization of all
targets still precedes all writes; authorization failures retain their existing
error-only envelope and disclose no per-target authorization results. The actual
UI checks all three own arrays whenever any outcome key is present, rejects
malformed/foreign/contradictory results, refreshes confirmed saves and identifies
the reviewer in outcome feedback. The current single-item action cannot receive
a valid multi-row partition. Its materials-release selection remains unrelated. No new batch screen,
207 status, queue, schema, or cross-request idempotency protocol is introduced.

The owner approved documentation-only follow-up to Claude's independent review
on 2026-09-05. Existing null/empty status clearing on open rows remains; closed
source guards still apply. Stricter status validation and error classification
would be a separate input-policy change, not a required pre-push correction.
See [the review follow-up](REVIEWER_LIFECYCLE_CLAUDE_REVIEW_FOLLOWUP_2026-09-05.md)
for the independently checked findings and unchanged-runtime evidence.
