# Proposal Ranking responsiveness plan

Date: October 14, 2026. Status: revised after Claude Opus review; implementation not started.
Scope: revised ranker's private preparation, especially moving a card and immediately answering confidence. This is separate from the D26 shared-facilitator/schema release work.

## Outcome and current evidence

Let a PD move a card, set confidence and keep editing without waiting for each server response. Show the latest local work immediately while saving it safely in order. Never imply unsaved work is durable.

[VERIFIED source at `650c217b4`] `AssessmentWorkflow.js:602–646` serializes every action through `busyRef`; `editable` at lines 755 onward excludes busy/pending; the confidence fieldset at line 300 uses that same editable value. `change` immediately sets a draft and calls `execute`. `accept` clears the draft on every successful response. Simply enabling the confidence controls would either drop a click at the busy guard or erase it when the earlier save returns.

[VERIFIED source] `client.js` permits at most three peer-only conflict rebases after definite 409 rejection, requiring unchanged own state, actor, workflow and policy. It preserves the final request as `pendingAction` on failure. `workflow-service.js` loads the round and active assessments, checks an operation receipt, validates scope (the reducer checks list version), writes one ETag-fenced changeset, then reloads the round for the response. This is real work on every private edit; no live latency breakdown has yet been measured.

[PLANNED] First improve interaction latency without removing server authorization, readback, round fencing or durable receipt checks. Server-read reductions are conditional follow-up work, not part of the first patch.

## Contract and invariants

Entry points: `AssessmentList` move/position/bar/confidence handlers → `AssessmentWorkflow` private edit controller → `client.js` → existing authenticated ranking API → workflow service/reducer → Dataverse changeset/receipt → authoritative view and local draft.
Persistence: unchanged Dataverse assessment rows, round fence and operation receipts. New queue is component-memory only, never localStorage. Consumers: private list, grade/confidence tiles, validation counts, program navigation, toolbar, recovery controls and lifecycle actions.

| Invariant | Enforcement and verification |
|---|---|
| A newly accepted edit renders immediately | Render the current draft; deferred-response UI test clicks confidence while a move POST is unresolved. |
| One save request in flight per component | A single controller owns dispatch; server requests retain existing concurrency fences. |
| Old responses cannot erase newer edits | Monotonic edit revision separate from scope generation; acknowledge the sent revision only. |
| Sent requests are immutable | Freeze full payload, operation ID, base view and sent revision; subsequent edits only change the queued draft. |
| New requests use authoritative versions | Build request only at dispatch, using the last acknowledged view's ETag/policy/list version. |
| Another tab's work is never overwritten automatically | Existing own-state and scope checks remain; stale-list/own-state change blocks queue. |
| Ambiguous writes cannot be bypassed | Retain exact returned pendingAction and resolve it before dispatching a successor. |
| Workflow actions cannot run ahead of saves | Disable Combine/Confirm/Ready/reset/reopen/reveal/restart until no queued edit, in-flight request or unresolved failure remains. |
| Scope/access changes never replay old work | Bind queue to actor, round, preparation version, program and workflow stage; validate on every response and retry. |
| Shared discussion semantics stay unchanged | Only private `saveAssessment` gets optimistic queuing; shared actions remain serialized and explicitly confirmed where required. |

## Proposed client design

Use one small dedicated private-save controller/hook with testable state transitions, not a general synchronization framework. Keep the existing execute path for lifecycle and shared operations.

Maintain:

- Last acknowledged server view and its concurrency fields.
- Latest local assessment draft (order, bars, confidence), plus increasing edit revision.
- At most one frozen in-flight request: sent draft/revision, base view, exact request, scope epoch.
- At most one queued latest draft. Intermediate unsent versions coalesce; never mutate an in-flight request.
- Explicit saving, unsaved and blocked-recovery state. Separate private saving from the existing exclusive-action busy flag.

For the first implementation, keep MR/SE/combined tabs, cycle/round/section switches and manual Refresh disabled while private work is dirty/saving/blocked. This avoids multi-program queues while still allowing all move/bar/confidence controls within the current editable private list. Find and unanswered-navigation may remain available because they do not change persistence scope. Combined lists that are outdated and ready/closed lists remain non-editable.

### Edit and dispatch

1. Apply each interaction against the latest draft, using functional/ref-backed updates to avoid stale closures. Increment edit revision and render the draft immediately. Derive grades, missing-confidence counts and local validation from that draft.
2. Send immediately when idle; coalesce only edits received while a request is in flight. No debounce/timers in the first patch. Skip dispatch if order/boundaries/confidence equal the acknowledged content: no-op saves otherwise increment versions and invalidate the combined list. Keep React state updaters pure; do not dispatch or increment external counters inside them.
3. Dispatch a complete assessment snapshot using the acknowledged list version and scope. Freeze the request and base view and call the existing private conflict-recovery transport. Only one call may be active.
4. While it runs, allow further private edits and replace only the queued latest draft. Render them without waiting.
5. On success, first validate component/scope epoch, actor, active private stage, policy and preparation identity. Advance the acknowledged view, including all authoritative combined invalidation and readiness fields. If no newer edits exist, clear the draft and show Saved. Otherwise retain the latest draft and immediately dispatch its successor against the returned versions. The intermediate response must not call the old unconditional draft-clearing `accept` path.
6. Validate normal responses and receipt replays against the exact expected own state E derived from the frozen request and its base B: replace the saved program with the sent order/boundaries/confidence and sent listVersion + 1; for combined saves retain B.co.sourceVersions and set confirmed=false; for every program save set any existing E.co.confirmed=false. Other lists and own.ready are unchanged. Compare ordered arrays, confidence keys/values, every list version, combined sourceVersions/confirmed, and own.ready field-by-field; normalize only the service's mirrored co.ready representation. Validate roundId, actor, active/private state, policyRevision, preparationVersion and revealId. A mismatch blocks further dispatch, even if the operation receipt confirms the earlier write. A readback can include a subsequent same-PD edit from another tab.
7. Keep the acknowledged server view object itself for transport baseView; do not reconstruct it from E. Existing transport comparisons use JSON serialization. E is a comparison/projection model only. A peer-only round ETag advance is allowed, but newer own content/version is not.

Saving indicator: show “Saving changes…” whenever an active request or successor remains; show “Saved” only after the latest revision is acknowledged. A blocked queue shows a specific unsaved/recovery message. Do not announce every intermediate acknowledgement to screen readers.

### Conflicts and failed/uncertain saves

- Existing proven peer-only 409 recovery stays inside the transport. Its base view is the acknowledged state for that dispatched request, never the newer optimistic draft. Keep the bounded retries and exact final pendingAction semantics.
- On any surfaced failure, stop automatic draining and freeze further edits while retaining the latest draft separately from the failed immutable request. Do not classify a timeout/network failure as proof of rejection.
- For uncertain outcomes, offer Check/retry using the exact final pendingAction (including a replacement operation ID from peer-conflict recovery). Resolve the receipt/server state before any successor. A confirmed older operation does not authorize overwriting subsequent own changes from another tab.
- Resume the successor only when refreshed own state matches the expected result of the resolved request and the same active/private scope remains. If not, block and require deliberate reconciliation; no blind last-write-wins overwrite.
- Definite validation or stale-own-list failures retain unsaved work but do not loop automatically. Provide a clear discard-and-load-current option with confirmation; preserve the draft until that choice. Building a manual merge UI is out of scope.
- On 401/403, invalidate the queue, stop retries and clear private rendered/draft data as today. No persistence of private drafts for later login.
- Visibility refresh must not run while dirty, in flight or blocked. Clean refresh still works. Never clear a queue because the browser becomes visible.
- Add beforeunload warning while work is unsaved, plus a tested Next.js Pages Router in-app navigation guard for suite links/back navigation; beforeunload alone does not cover next/link. Block navigation or require deliberate discard after the request resolves. Child cycle/program handlers and parent actor/round keyed remounts must be covered. Invalidate callbacks on unmount. Aborting a request does not prove that a server write was canceled. This release does not promise offline persistence or recovery after forced browser/process termination.
- StrictMode setup/cleanup must not duplicate dispatch or let late responses mutate a new controller instance. Scope epochs and liveness are separate from edit revision; do not invalidate an in-flight response on each local click.


### Entry barriers and derived state

Split listEditable (may be true during private saving) from actionsEnabled (requires clean queue and no exclusive busy/pending state). Enforce the barrier synchronously inside execute, refresh, loadHistory, exportWorkbook, both open-previous/open-replacement handlers, Continue-to-next-program and cycle/program/section navigation, not just disabled buttons. An already-open confirmation dialog must recheck before dispatch. Give the controller its own scope epoch, separate from the existing generation counter. Audit every setDraft(null): ordinary discard refuses while a request is in flight; auth loss intentionally clears private state and invalidates callbacks.

Compute projectedOwn from acknowledged own plus the latest draft using the same expected-state rules above. Derive allConfident, programProgress, combinedComplete, outdated and combined confirmed labels from that projection. Actions remain disabled until acknowledged even if projected validation is complete. Keep the collective/history consumers of AssessmentList on their existing behavior. Use stable IDs or scope-checked functional changes for private edits; cancel a drop if its source assessment/scope was replaced mid-drag.

### Error classification and recovery details

| Result | Required treatment |
|---|---|
| Network/timeout/unparseable response, any 5xx (including dependency_unavailable after commit), explicit uncertain_outcome | Unknown write outcome. Keep exact final pendingAction; check/replay it before any successor. |
| Definite surfaced stale_scope/conflict/confirmation_stale after bounded transport retries; stale_list, invalid_assessment, invalid_transition, round_closed | Known rejection only when the code came from the POST rejection, not an unrelated failed recovery GET. Keep draft; block automatic draining. |
| operation_id_reused | Integrity failure; block with no automatic retry. |
| 401/403 from POST or internal refresh GET | Invalidate queue, clear private state and stop. |
| Other/unclassified error or missing provenance | Conservatively unknown; never discard or create a new operation on the assumption the old one failed. |

Add a finite dispatch deadline (initially 30 seconds across a transport call and its internal retries), passing an AbortSignal through existing requests. Timeout is uncertain; abort does not undo a server commit. After a surfaced failure the request is no longer locally in flight, but unresolved outcome still blocks new writes. For definite peer contention, offer manual Try again: reload, prove own state equals the frozen base and scope remains valid, then send the latest draft under a fresh operation ID and current concurrency fields. Do not require discard of valid work merely because peers exhausted the retry budget. Record contention frequency in the four-PD rehearsal.

An operation receipt must establish confirmation; matching assessment content alone is not proof the requested operation committed. Even after receipt confirmation, require the expected-own comparison before draining. Recovery must distinguish earlier acknowledged edits from newer unsaved edits; discard applies to the latter and does not roll back committed changes. Move focus to the recovery alert when editing becomes blocked. Keep the saving live-region message stable through the entire drain and announce completion once; maintain keyboard drag-handle/radio focus during ordinary saves.

### Test-fixture corrections required

Existing UI tests mock client.js and several return unrealistic save responses. Correct fixtures around `proposal-ranking-assessment-ui.test.js` lines 104–107, 116, 223 and 283 to return reducer-consistent version increments/combined invalidation. The retry test around lines 308–323 must not call an unchanged initial view a successful acknowledged save. Add controller+real-client integration tests mocking requestEnvelope, in addition to UI mocks, for rebases, internal GET failures and exact pendingAction recovery. Use populated other-tab changes in negative tests. Add the positive keyboard-drop focus test while save remains unresolved.

## Measure before changing server work

[PLANNED] Use a bounded sandbox rehearsal with 23 fictional proposals/four participants. Measure both time to visible confidence selection and time to saved acknowledgement; distinguish cold and warm runs and record repeated samples, request counts, conflict retries and payload sizes. Use browser network timing and existing server dependency telemetry first. Add targeted timing only if those cannot attribute the delay, with no assessments, titles, confidence values or credentials in logs.

Acceptance target: the SECOND interaction (confidence immediately after a move) applies within 100 ms while the FIRST save remains unresolved for 2 seconds. Measure baseline time until confidence becomes usable, not the already-immediate first draft update. Use deferred promises in tests and DevTools network/CPU throttling plus Event Timing/INP in the preview. This is a proposed target, not a guarantee. Successful persistence must eventually exactly match the latest draft. Record p50/p95 save latency and sample size; do not claim an improvement from a single request.

If server latency still matters after this change, propose a separate measured patch. Candidates to investigate: duplicate round/assessment reads, sequential independent reads and response payload size. Keep auth freshness, ETag/receipt recovery, immutable reveal semantics and current readback until a specific replacement is proved equivalent. No cross-user cache, weakened fence or parallel private writes in this plan.

## Tests and rollout

1. Deferred promises: move → confidence before acknowledgement; multiple confidence toggles; second move/bar change; intermediate response arrives with newer draft queued. Assert immediate UI, exact final order/bars/confidence and one active request.
2. Rapid input: immediate idle dispatch, one in-flight request, latest queued snapshot wins, no lost updates from same-tick closures, no-op draft sends nothing. Show Saved only at latest acknowledgement.
3. Concurrency: unchanged-own peer conflict retains safe bounded retry; same-PD second tab, policy change, readiness/reveal/reset/restart/actor switch blocks replay. Include changes to another program and combined confirmation in own-state comparisons.
4. Ambiguity: request commits but response is lost; rebased operation then timeout; exact replay after a later own edit; definitive rejection; retry-read failure; 401/403. No duplicate receipt or overwritten later edit. Preserve latest draft and immutable failed request separately.
5. Lifecycle controls: no combine/confirm/ready/reset/reveal/export/navigation overtakes dirty work; visibility refresh does not erase it; explicit discard is confirmed; unload warning lifecycle; in-app navigation, unmount/StrictMode and late success/error responses.
6. Regression: shared editing remains unchanged, outdated combined list cannot be edited, grades and confidence answers remain consistent after bar/card moves; keyboard, radio focus and unanswered navigation work while saving.
7. Run targeted queue/UI/conflict tests, all ranking suites, lint and types; production build and relevant API/DAL/status/document gates for the actual touched surface. Gate/self-test pairs run sequentially. No schema migration is required by this client-only phase.
8. Deploy to the existing isolated preview, rehearse with independent PD sessions, and compare before/after timings. Do not modify the real D26 round for performance testing. Keep production promotion under the separate D26 release plan.

Rollback: redeploy the prior v2-capable preview/runtime if necessary. There is no new durable format. A user must drain or deliberately discard unsaved local work before a controlled reload; rolling back code does not undo already accepted assessments.

## Contract-reconcile scope and review

Whole flow and stale-state audits apply to every client transition above. Partial success remains one atomic assessment transaction; queued edits are not reported saved until individually acknowledged. Helper extraction is limited to private-save state and cannot absorb lifecycle/shared semantics. Durable-surface audit: no new table/field; client behavior documentation and tests need updates; the API wire contract stays unchanged. Symbol fan-out: audit every `busy`, `editable`, `pending`, `draft`, `accept`, `generation`, navigation and refresh consumer. Documentation reconciliation is limited to this proposed behavior and eventual implementation receipts; this document makes no deployed-performance claim.

Recommendation evidence: the UI busy lock and unconditional draft clearing are source-verified; the queue improvement is PLANNED and untested. Disconfirming test: keep a move response unresolved and confirm confidence updates immediately, then ensure the response cannot remove that choice. Backend bottleneck attribution is UNKNOWN until measured.

Claude Opus review: completed through the Claude CLI OAuth/subscription session. Verdict on revision 1: READY WITH NAMED CHANGES. The review reported claude-opus-5-5 (CLI metadata also lists claude-fable-5-1), no permission denials and success. No API-key authentication or Ultrareview was used. Full review and disposition: `docs/audits/PROPOSAL_RANKING_RESPONSIVENESS_OPUS_2026-10-14.md`. This revision incorporates the named changes; that is author reconciliation, not a claim of a second Opus approval.
