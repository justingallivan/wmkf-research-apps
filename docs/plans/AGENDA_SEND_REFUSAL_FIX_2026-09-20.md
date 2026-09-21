---
title: Agenda send refusal feedback fix
domain: workbench
kind: plan
status: complete
summary: Released agenda-send refusal feedback fix with preserved pending-operation reconciliation.
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md
  - docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md
---

# Agenda send refusal feedback fix

## Scope and evidence

Owner request: plan the fix, Luna builds, Sol reviews; root adjudicates.
Worktree: `/private/tmp/wmkf-agenda-send-feedback`, branch
`codex/agenda-send-feedback`, base `51be295bd`. The D1 work remains separate.

Change surface: the send-time `agenda_send_unresolved` branch in
`shared/components/meeting-tracker/SessionAgendaPanel.js` and its regression tests.
Entry: confirmation checkbox followed by Send agenda. Persistence changes: none.
Consumers: the real `EmailSendFeedback` component, pending-operation preview,
confirmation gate, and subsequent PATCH for that operation.

[VERIFIED via source at base] `sendAgendaEmail` in
`lib/services/meeting-tracker/agenda-service.js` checks for a competing unresolved
operation before `claimSend` and throws `agenda_send_unresolved` with HTTP 409 and
`pendingSend`. The agenda route preserves the service status and body. The existing
service test "send blocks a prepared sibling operation while another send is
unresolved" asserts no claim, activity creation, or email dispatch.

[VERIFIED via the same service and its concurrent-constraint test] A race can
also produce this 409 after creating a Dynamics email activity: the uniqueness
failure while recording send intent rechecks the competing operation and refuses
before `sendEmail`. The general claim is **no transport dispatch of the refused
operation**, not that no activity or ledger write occurred.

[VERIFIED via source at base] The panel pins `pendingSend` and its preview, clears
confirmation, and sets a recovery notice, but then throws without an `outcome`.
Its catch classifies that throw as uncertain. `EmailSendFeedback` renders failed
as "Not sent." and uncertain as "Send status is uncertain." The earlier operation
is genuinely unresolved; the newly attempted competing operation was refused.

Prior finding: execution log deviation (6), near the end of Stage 5a, and the
active session handoff. The fallback-message investigation was closed; this
outcome-classification follow-up remains open at the base commit.

## Implementation plan

1. Add a failing rendered-panel regression for a prepared operation B whose send
   receives 409 `agenda_send_unresolved` with a different pending operation A.
2. Inside the existing sequence guard, retain the pending preview, confirmation
   reset, and recovery notice. Set `sendFeedback` directly to `status: 'failed'`
   with the message: "This agenda was not sent. Review the earlier unresolved
   send before sending another agenda." Return instead of throwing into the
   generic catch. The surrounding finally continues to clear busy state.
3. Prove that the next explicitly confirmed reconciliation PATCH uses A, not B,
   and creates no additional preview. Preserve the existing prepare-time conflict,
   accepted-send receipt, terminal/stale branches, and genuine uncertainty paths.
4. Run scoped tests, lint, types, and relevant documentation gates; Sol reviews
   the final source/test diff. Root adjudicates before declaring the candidate
   accepted. Record exact evidence and commit on the feature branch.

## Invariants and tests

| Invariant | Verification |
|---|---|
| The refused competing send is definitely not sent | Real panel and real feedback render "Not sent." with exact recovery copy; no uncertain heading in that feedback |
| Earlier unresolved operation is retained | Distinct A/B operation IDs, A preview visible, editable/new-preview controls absent, confirmation unchecked and send disabled |
| No automatic retry | PATCH count remains one after conflict; only explicit re-confirmation causes the second PATCH, whose body contains A |
| Genuine uncertainty is unchanged | Network rejection during send stays uncertain; 202 `agenda_send_unconfirmed` retains same-operation recovery |
| Other refusal branches remain distinct | Existing stale-preview, terminal-send, prepare-time conflict and accepted receipt tests pass |
| A stale response cannot change another interaction | Source review confirms the new state write remains inside the existing sequence guard; no new deferred-response test was added |
| No wire or persistence contract changes | Diff contains no API/service/store/schema edits; existing service/route tests still pass |

Complement check: only the existing non-ok, exact-code, pendingSend branch is
changed. Other HTTP codes, missing pending payloads, network rejections, successful
sends, and 202 unconfirmed outcomes keep their existing branches. Do not globally
map all 409s or all failures to failed. A malformed successful body is outside
this fix and must not acquire new handling incidentally.

## Ownership and validation

Luna owns `SessionAgendaPanel.js`, `tests/unit/meeting-tracker-agenda-panel.test.js`,
and, if needed, `tests/unit/session-agenda-panel-t5-matrix.test.js` after Sol's
bounded plan review. Root owns this plan and durable status reconciliation;
Sol reviews read-only. Shared feedback/helpers, routes, stores, scheduling, and
D1 files are outside the implementation scope.

Tests: agenda panel, T5 matrix, agenda service, agenda route; existing feedback
component suite if applicable. Tests use local mocks only, no real email or live
data writes. The failing regression is run before source edits; then the same
suite and the scoped set must pass. Use real feedback UI, not a mock that merely
echoes the outcome. Lint the changed files; run `check:types`. For changed durable
docs, run doc-currency and its self-test sequentially, docs-catalog, and relevant
symbol-reference checks. Run local agent-invariant checks for worktree setup.

Contract reconciliation: caller → panel state → existing PATCH → authenticated
route → competing-operation guard → 409 body → pending preview and feedback.
Batch/partial success: N/A (one refused operation plus one separate unresolved
operation). Helper extraction: N/A. New durable surfaces/enums/migrations: N/A.
Existing persistence is read by the unchanged server guard; no new write path.

## Release boundary

[VERIFIED via implementation and scoped tests] This is a Tier 2 email-feedback candidate. Local mocked interaction
tests provide Mode A rehearsal evidence; they do not claim a human production
smoke of the refusal. The owner subsequently authorized release in agenda-then-D1
order. Production read-only smoke passed; no real email was sent. Release and
rollback evidence: `docs/plans/AGENDA_D1_RELEASE_2026-09-20.md`.

## Execution and review evidence

Sol plan review: accepted after clarifying the concurrent-constraint case above.
Baseline: four agenda panel/T5/service/route suites, 55 tests, passed locally.
Worktree agent-invariant gate passed (three required symlinks).

[VERIFIED via Luna's red/green run and root's independent final run] Four
agenda panel/T5/service/route suites pass, **56 tests**. The new real-panel
regression failed before the source change and passes after it. It proves
PATCH B is refused, failed feedback is rendered, A is retained, confirmation
is cleared, no automatic retry occurs, and explicit reconciliation PATCHes A.
Existing network-failure and 202 uncertainty tests remain green.

Luna reports scoped ESLint clean and `check:types` passed. Fresh Sol source/test
review: **READY, no blocking findings**. Root independently reviewed the final
diff and accepts the candidate. Sequence-guard verification used source review
rather than the initially proposed additional deferred-response test: the new
feedback write is inside the unchanged guard, and no async machinery changed.

[VERIFIED via Git and Vercel API] Released as `301d4d141`, deployment
`dpl_HoTApcaJCeMFaJEZFHeHWwdfSJZy`. No real email was sent during validation.

Root documentation gates passed: docs-catalog, doc-currency and its 13-fixture
self-test, doc-symbol-refs and its self-test; `git diff --check` is clean.
