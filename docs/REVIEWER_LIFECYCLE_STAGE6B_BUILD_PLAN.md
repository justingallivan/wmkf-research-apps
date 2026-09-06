---
title: Reviewer Lifecycle Stage 6B — Build Handoff
domain: reviewer-workbench
kind: plan
status: active
summary: Sequential in-place action lifetime fixes; 6B1, 6B2 and 6B3 are all complete on a branch with independent PASS verdicts; promotion is the next decision.
canonical: false
owner: product-engineering
last_verified: 2026-09-05
related:
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md
  - docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md
  - docs/audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md
  - docs/CI_GATES_REFERENCE.md
---

# Stage 6B: bind action outcomes to their current UI context

## Status and first action

[VERIFIED via frozen commits, tests and independent review] **6B1 is complete**
on branch `codex/reviewer-lifecycle-stage6b`: runtime `9258115a`, test-only review
correction `06725d6c`, full suite 771 suites / 11,216 tests, webpack build, seven
gate pairs and an independent PASS. See the
[Stage 6B1 receipt](audits/REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md).
[VERIFIED via frozen commits, tests and independent review] **6B2 is complete**
on the same branch: runtime `b08c16f6`, review-driven correction `d3ec406a`,
owner-decided permission-loss close `039d5d8e` after a Codex adversarial review, full
suite 771 suites / 11,275 tests, webpack build, seven gate pairs and an independent
PASS after one BLOCK round. See the
[Stage 6B2 receipt](audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md).
[VERIFIED via frozen commits, tests and independent review] **6B3 is complete**
on the same branch: runtime `a6a27ce8`, review-driven correction `b163172a`, full
suite 772 suites / 11,301 tests, webpack build, seven gate pairs and an independent
PASS after one BLOCK round; amendment 6B3a (`3a4bcbbe` runtime, `0a4eafd6` advisory test)
folded the signature and review due date into the session identity after a Codex adversarial
review, and amendment 6B3b (`9a790c64` runtime, `529ee426` advisory test) folded recipient
name, email and affiliation after a second one, and 6B3c (`2622dfc7`) folded the panel-carried
proposal title, abstract, PI and institution after a third, and 6B3d (`be76760f`, host-side in
`ReviewersTab.js`) keeps the same-request proposal on a refetch error after a fourth, and 6B3e
(`5b57991d`, Codex-built via rescue, Claude-reviewed) adds a degraded mode with Retry after a
fifth; the reviewed amendments have independent PASS verdicts, the last full suite is recorded in
the receipt. See the
[Stage 6B3 receipt](audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md).
**Stage 6B is therefore complete on `codex/reviewer-lifecycle-stage6b`.** Nothing is
merged or deployed; promotion (PR, CI, deliberate merge under the release strategy) is
the next owner decision. The three receipts carry the accepted limits that a later
stage inherits: callback promises are observed, not awaited; no post-close
refresh-failure surface exists for the reminder, closeout or materials components; the
closeout modal closes itself on committed permission loss; a membership change during an
in-flight materials send returns the modal to compose while the server-side one-time
release gate bounds a duplicate send; a signature or review-deadline change while the modal
is open resets it the same way, even when the PD's customized due date would have rendered
identically; a recipient name, email or affiliation change and a proposal title, abstract, PI
or institution change (6B3c, `2622dfc7`) do too; co-investigators and unrefetched edits wait
for Stage 6D.
These are subdivisions of original Stage 6B, not additional product features.
Stage 6C extraction is outside this handoff.

[PLANNED, owner-queued 2026-09-05] **Stage 6D — server-side draft fingerprint.** The
materials-modal session key (6B3a–6B3c) can only detect changes the panel has refetched and
cannot see co-investigators at all, because no host carries them. A third Codex adversarial
review asked for a defensible boundary; the owner chose the client key now and queued this
slice: render-emails returns a per-draft fingerprint of every body input (recipient, proposal
including co-PIs, settings); send-emails recomputes it and refuses a stale draft with a new
`skipped` code the modal renders. This changes the render and send contracts and the SSE
vocabulary, so it is a separately planned and reviewed slice, not a 6B amendment. Not started.

[VERIFIED via source reads and git commands] Source baseline:
`d614de5cf60baeaec8cf21ca8e4dd3c2489d2f7a`, `main`, initially clean.
Line citations below refer to that commit; relocate symbols at execution time.
This document was prepared from source/test inspection. No new runtime tests,
builds, gates, browser write tests, live probes, or deployments were run for it.
Earlier implementation/release receipts remain evidence for their frozen
revisions only. A fresh planning review must be recorded before build pickup.

Read the approved decisions in full. Their lines 143–166 preserve the shipped
status-only lifetime contract and explicitly leave general 6B open. The original
report's lines 281–291 supply the broader in-place lifetime requirement.
No Stage 2–5 structural migration is a prerequisite for these UI fixes.

## Surface and invariants

Change surface: client action ownership and stale outcome suppression.
Entry points: `ReviewerManagePanel`, `ReviewReminderAction`,
`ReviewerCloseoutModal`, and the nested `ReleaseMaterialsModal`.
Existing routes continue owning authorization and mutation response contracts.
Persistence: existing server-owned reviewer suggestions, linked terminal
effects, email delivery/bookkeeping, template preferences and attachment storage;
6B creates no table, field, enum, route or storage contract.
Consumers: current alerts/prompts, clipboard, inline state, modal transitions,
parent refresh callbacks, host loaders, tests and this handoff.

| Invariant | Enforcing or preserved surface | Required proof |
|---|---|---|
| A departed context cannot regain feedback by returning | Committed request/mode/permission/row identity plus monotonic generation | A→B→A and row disappearance/return settle silently |
| A late completion cannot release another operation's UI state | Per-owner operation token, conditional cleanup | Old finally settles while a newer operation stays pending |
| Ordinary same-context refresh is valid | Compare stable IDs and lifecycle context, not object/callback identity | New row objects/current callback still receive valid success |
| Existing pending behavior stays intact | Status mutex, reminder/closeout locks and preview queue remain distinct | Existing reentrant/status and modal tests still exercise real handlers |
| Confirmed mutation and failed refresh differ | Separate callback outcome handling from mutation errors | Throw/reject after success never claims the write failed |
| No automatic replay or rollback | Existing routes and transport call count | Stale outcomes, errors and lost replies cause no second mutation |
| Parent remains refresh owner | Existing external callback contracts; narrow internal completion ownership below | No parallel local roster or invented success overlay |

The status operation remains untouched except necessary wiring verification:
`ReviewerManagePanel.js:1644–1684,1831–1958` owns its synchronous per-reviewer
mutex and operation token, structured 6A outcome validation, current callback,
and matching-token cleanup. Do not replace it with latest-response-only logic.
Its lock is local to one mounted panel; no cross-tab/server guarantee is added.

All requirements below are [PLANNED]. Use small private helpers only where needed
inside the existing file. No exported hook, universal action framework, global
cross-action lock or new cross-action exclusion policy belongs in 6B.
Different action kinds retain their existing ability to run; 6B1 adds feedback
ownership, not new disabled controls or a mutation mutex.

## Common context and side-effect ownership

Capture stable request ID, suggestion ID, action kind, committed context epoch,
and a unique attempt token before the operation's asynchronous work.
For the two terminal variants, use one terminal-action generation with the
captured terminal choice; a newer terminal invocation supersedes older feedback.
Regenerate, revoke and remove have separate action generations.
Within the same action/row, a newer invocation owns subsequent feedback; it does
not cancel or repeat a request already dispatched by an earlier invocation.

Observe committed props, following the status path's layout-effect pattern:
request or mode change, management/read-only change, observed row absence and
unmount permanently invalidate existing attempts. Same-context row object,
name, order or callback replacement alone does not invalidate an attempt.
Keep the submitted row identity/label for outcome text; invoke only the latest
callback belonging to that still-current context.
If a child lacks parent permission/mode information, pass narrow lifetime
context from the panel in its own slice. This does not replace route authorization
or silently change the child's existing submission eligibility rules.

Check currentness after every await and immediately before each externally
visible continuation. Recheck after invoking an external callback before doing
another side effect: that callback may synchronously navigate or unmount.
Fetch completion, JSON parsing, clipboard completion, callback rejection,
timer firing, stream reads and finally cleanup are separate checkpoints.
Maintain owned refs after invalidation as necessary to settle existing locks;
never write component state after unmount or clear another token's state.

Do not turn host callbacks into evidence of successful reconciliation.
`ReviewersTab.js:246–265` invokes three loaders without returning their promises;
its `loadReviewers` catches read errors at lines 139–161. A void callback or
a callback that catches its own errors cannot certify a refreshed list.
Observe a returned promise's rejection without an unhandled rejection; report
refresh failure only while current, separately from the confirmed operation.
Keep external callback arguments and invocation count unchanged. Only the local
6B3 modal/panel handshake may carry the completion-cause metadata defined below.

## 6B1 — token, removal and terminal outcomes

[VERIFIED] Implemented at `9258115a`/`06725d6c`; the requirements below are the
contract that was built and reviewed. Line citations are to the `d614de5c` baseline.

Runtime ownership: only relevant regions of
`shared/components/reviewers/ReviewerManagePanel.js`.
New focused test path (planned):
`tests/unit/reviewer-action-lifetimes.test.js`.
Keep named exports and all route payload/success predicates unchanged.

| Action and baseline source | Existing request and success contract | Continuations to guard |
|---|---|---|
| `handleRegenerateToken`, lines 1743–1765 | POST regenerate-token with suggestionId; HTTP ok and data.ok | fetch; JSON including fallback; before clipboard; clipboard resolution/rejection; success alert/manual-copy prompt; refresh; outer error |
| `handleRevokeToken`, lines 1768–1784 | Existing confirm, POST revoke-token with suggestionId; HTTP ok and data.ok | After confirm revalidate context before dispatch; fetch; JSON/fallback; failure alert; refresh; thrown/rejected paths |
| `handleRemoveReviewer`, lines 1797–1828 | Preserve warning/confirm and DELETE my-candidates with suggestionId; HTTP ok is success | After confirm; fetch; failure-only JSON/fallback; alert; success refresh; thrown/rejected paths |
| `transitionTerminal`, lines 1960–1987 | Preserve distinct withdrawal/release confirm; POST terminal-transition with requestId, one suggestion ID and terminalStatus; HTTP ok and transitioned===1 | After confirm; fetch; JSON/fallback; per-result failure text; refresh; thrown/rejected paths |

For regeneration, check currentness **before starting** clipboard.writeText.
If already stale, never copy or display the returned URL.
If navigation occurs after copying starts, that browser operation is not
cancellable; it may still change the clipboard. Suppress subsequent alert,
manual-copy prompt and refresh. Do not claim it was cancelled, restore an old
clipboard value, issue another token, or add an automatic clipboard retry.
A clipboard rejection permits the existing manual-copy fallback only while
current. Keep it distinct from a regeneration request failure.

Use the unchanged UI controls to exercise each action. Do not mock
`TokenActionsMenu` or call a copied handler implementation.
First make the deferred-fetch/JSON/clipboard failures reproducible against
unchanged runtime; then add the smallest ownership guards.
Preserve current invitation overlays, materials selection and status pending
state while these operations settle.

Reopen the referenced routes and downstream services before edits to record the
unchanged payload/response boundary. No server file belongs in this slice.
If preserving a response requires changing server eligibility/error policy,
stop that dependent change and report it rather than including it in 6B1.

## 6B2 — reminder and closeout component lifetimes

Start only after 6B1's independent review passes.
`ReviewReminderAction` at `ReviewerManagePanel.js:126–195` has a synchronous
send lock, send generation and mounted flag. Its baseline effect invalidates on
unmount, not mounted request/reviewer changes. Preserve all current eligibility
messages, exact request payload and HTTP/data.ok test.
Bind feedback and onSent to request, reviewer, action and available parent
lifetime context. Guard fetch/JSON, both error branches, onSent and owned finally.
Preserve the existing send lock while its attempt settles; returning to the
same identity must not revive feedback or unlock a newer attempt.

`ReviewerCloseoutModal.js:41–99` initializes disposition/notes once and uses
an unmount generation with a synchronous savingRef. Extend its lifetime to
open/close, request/reviewer identity and parent management/read-only context.
On a new reviewer/request session, initialize form state from that current row
and clear prior feedback; ordinary same-row refresh must not erase unsaved text.
Preserve disposition rules, required notes, captured payload and success test.
Guard fetch, JSON fallback, errors, onSaved, onClose and finally independently.
If onSaved changes/unmounts the session, do not then close a replacement modal.
Handle callback throws/rejections separately from request failure; no resubmission.
Do not add a universal receipt/closeout predicate or move this modal.

Extend `tests/unit/reviewer-manage-actions-menu.test.js` and
`tests/unit/reviewer-closeout-modal.test.js` with real rerenders, not only
unmount tests. Existing reminder cases at lines 240–331 cover request payload,
read-only display, rapid repeats and token eligibility; they are retained evidence.
Read both callers: `ReviewersTab.js:541–558` and
`pages/workbench/reviewer-follow-up.js:107–117`.

## 6B3 — materials-modal lifetime and asynchronous scratch state

Start only after 6B2 review. Keep `ReleaseMaterialsModal` nested for this slice.
[VERIFIED via source] Its epoch increments on isOpen only
(`ReviewerManagePanel.js:531–564`); proposal-load request guards at lines
669–682 do not invalidate preview/send epochs. Preview and send capture that
epoch at lines 777–1026. Templates/attachments remain separate scratch concerns.

Use a modal session identity of open/closed state, request ID, selected
suggestion-ID membership and, since the 6B3a amendment (`3a4bcbbe`, owner decision after a
Codex adversarial review), the two consumed settings values (signature and review due
date) compared by value and, since 6B3b (`9a790c64`, second Codex review), each selected
reviewer's name, email and affiliation by value, plus observed parent permission/read-only
lifetime. Compare stable membership and field VALUES, never array identity, reviewer
display-object identity or `settings` object identity (the panel rebuilds both every render).
External membership changes and request changes invalidate the previous session
even while open; returning does not revive it. Reset drafts/results/error for a
new session, except the explicitly owned completion reset below. Do not normalize
or rewrite the existing request payload.
Keep compose fields/settings and attachment persistence semantics, with one 6B3a
exception: when the committed review-due-date default changes, a due-date field that still
holds the prior default (or is empty) follows the new default; a customized field is kept.
No new cross-request attachment-storage policy is implied by suppressing stale UI writes.

| Owner / baseline region | Preservation and every asynchronous checkpoint |
|---|---|
| Preview, lines 777–888 | Retain snapshot-before-queue, renderingEpochRef, serialized renderTailRef, per-render controller and 45-second timeout. Check before queued work starts, after fetch/JSON, before drafts/step/error, and in owned finally. Invalidate/abort read-only preview on session loss and unmount; a late old finally cannot release a new render. |
| Send, lines 897–1026 | Preserve confirms, draft/attachment payload, existing sending UI and SSE semantics. Guard after fetch/error-body JSON, each reader.read, each event's progress/result/error/complete effects, onEmailsSent and catch. Do not abort/replay email transport as a repair; client stream cancellation is not server rollback. Observe cancellation rejection safely. |
| Proposal loading, lines 610–682 | Retain proposalLoadSeq plus request binding; invalidate on unmount as well as reset. Guard success/failure after fetch and JSON and prevent an old file from becoming the current attachment. |
| Settings/preflight/templates reads, lines 566–608,684–693 | Retain existing cancelled flags and default/fail-soft meanings. Verify each effect's dependencies and cleanup cover its actual owner; no late setting/preflight/template response may repaint a departed owner. |
| Save template, lines 723–734 | Account preference persistence may complete after modal departure. Guard saved feedback after saveEmailTemplates and the 1.5-second timer; clear/own timers without reverting the saved preference. |
| File upload, lines 736–755 | Guard after dynamic import, each upload, error and finally. Check before starting each subsequent file in the old attempt. Already-started bytes may finish; suppress stale attachment/localStorage/UI writes and do not delete uploaded blobs or infer upload rollback. |

[VERIFIED via source] Complete sets step=sent then calls the parent
(`ReviewerManagePanel.js:984–986`); its callback clears selection and refreshes
(lines 2324–2327). That changes selectedList (line 1710) to empty.
An unconditional membership reset would erase the just-completed summary.

Before invoking the still-current completion callback, mark that send attempt
finished and retain its recipient snapshot and final sent/failed/skipped arrays.
Use the attempt's accumulated SSE data, including result immediately followed
by complete in one chunk; do not snapshot a stale React state closure.
Complete is not proof that all recipients succeeded. Preserve mixed/all-failed
summaries and existing parent selection clearing and external refresh calls.

Tag that exact parent selection clear with a one-use completion-cause token bound
to request, modal session, send attempt and prior membership. Store cause with the
selection update so a newer external selection update cannot inherit it.
Consume only its matching prior-membership→empty committed transition without
resetting the sent summary. All other membership changes invalidate normally:
untagged empty, different membership, mismatched/expired/reused cause and changes
before completion. Request/mode/permission loss, unmount and close/reopen always
invalidate, even with a matching cause. Never exempt every empty array or ignore
all membership changes while step=sent. Discard the cause on other invalidation.
The finished attempt cannot rerun completion effects or accept late events that
replace its summary. Keep the handshake local to these two components; additive
internal metadata is allowed, but external refresh arguments/count stay unchanged.
Do not introduce an automatic send retry, SSE protocol change or new send lock.

Retain `manage-panel-preview-error-retry.test.js:243–315,382–509`:
close/reopen queue ordering, stale-draft exclusion, abort recovery, timeout and
stale-finally ownership already have real-handler tests. Add mounted request/
membership change, pending JSON, late stream events, clipboard-independent
upload/template cases and callback-driven unmount.

## Regression and disconfirmation matrix

Run real components with isolated transport promises and fake timers where needed.
Unknown test requests must fail; do not permit network/SQL initialization.

| Case | Assertion that matters |
|---|---|
| Current success, rejection, HTTP/payload error and JSON failure for each action | Preserve payload/success predicate, current feedback and one callback; do not silently suppress normal use |
| Each deferred continuation × request A→B→A, mode/permission away-back, row absent-return, unmount | No old state, alert, prompt, clipboard start or callback in the new owner |
| Current clipboard resolve/reject; context lost during clipboard | Current copy/fallback works; started copy may finish but no later stale effects |
| Callback sync navigation, throw, promise rejection, void return | Current callback only; no next stale callback; confirmed save is not relabeled failed |
| Same-context object/callback replacement | Operation remains valid and calls the latest current callback |
| Old finally/timer settles during newer operation | New lock/state survives; old cleanup releases only its own bookkeeping |
| Different reviewer and different action kinds | No introduced global serialization or collateral status/materials-state reset |
| New modal identity while still mounted; same-row form refresh | No prior form/draft/results leak; legitimate same-owner edits survive |
| Partial SSE then session change; upload finishes after departure | No stale panel selection/refresh or attachment persistence; no replay/delete |
| Real parent: mixed/all-failed result→complete, in one chunk and separate chunks | Final arrays and sent summary survive the owned selection clear and refresh; parent selection is cleared |
| External clear before complete; new membership/request or close/reopen after complete | Late completion is rejected or a new session resets normally; no blanket sent/empty exemption |
| Wrong, expired or reused completion cause; duplicate/trailing stream event | No unowned reset exemption, second parent callback or summary overwrite |

[VERIFIED disconfirming evidence] Workbench request navigation already keys the
subtree by request ID (`pages/workbench/[requestId].js:181–188`).
That prevents many mounted-request cases but does not prove reusable component
contracts or suppress unguarded alerts after unmount. Preserve this remount.
ReviewersTab loaders already guard request and generation on success/failure
(`ReviewersTab.js:139–214`); confirmed invite overlays and their timed
reconciliation remain at lines 168–214. Do not rewrite these hosts to make
an isolated component test pass.

For each slice, demonstrate the new regression fails against unchanged runtime.
Then deliberately remove one generation check, one post-JSON/callback checkpoint,
and one token-owned cleanup check in a disposable test copy. Record expected
assertion failures, not syntax/runtime crashes. For 6B1 also remove pre-clipboard
currentness; for 6B3 remove membership invalidation/preview-tail preservation.
Never leave broken variants, skipped assertions or duplicated implementation fixtures.

## Build commands and stage exits

Future executor: run `/start` under current authorization, inspect HEAD/dirty
files and coordination, and read this plan/approved decisions/applicable rules.
Recommend branch `codex/reviewer-lifecycle-stage6b`; this planning task created
no branch. Do not edit runtime on main or overlap another writer in this panel.
Use `/contract-reconcile` Mode B; write the slice's exact invariant/await matrix.
Reopen current source through CodeGraph first and verify package commands.

Baseline UI selection (existing files; run before new regression edits):

```sh
npm test -- --runInBand --watch=false --runTestsByPath tests/unit/reviewer-status-mutation-characterization.test.js tests/unit/reviewer-manage-actions-menu.test.js tests/unit/reviewer-closeout-modal.test.js tests/unit/manage-panel-preview-error-retry.test.js tests/unit/reviewer-manage-proposal-attachment.test.js tests/unit/reviewers-tab-stale-request.test.js tests/unit/reviewers-tab-post-send-refresh.test.js tests/unit/reviewer-follow-up.test.js
```

For 6B1 add the planned `reviewer-action-lifetimes.test.js` to that command.
For 6B2/6B3 rerun their changed suites, then this retained UI selection.
At every slice exit, run the full suite and build required by the original
stage contract; record exact HEAD, command, totals, failures and generated diff:

```sh
npm test -- --runInBand --watch=false
npm run check:types
npm run lint
npm run build -- --webpack
git diff --check
git status --short
```

The webpack invocation preserves this refactor's explicit build receipt form;
`package.json:7–8` runs reminder-hold and manifest generation before Next build.
Inspect generated changes; do not claim this was a Turbopack build. If current
release policy additionally requires the canonical build, follow
`docs/CI_GATES_REFERENCE.md` sandbox guidance and record that separately.

Run the following existing gate pairs **serially**, gate then its `:self-test`:
`check:dataverse-access-layer`, `check:route-service-boundary`,
`check:dynamics-context-boundary`, `check:api-routes`,
`check:route-lifecycle-auth`, `check:trust-boundary-guid`,
`check:status-enum-parity`. Command form: `npm run check:NAME`, then
`npm run check:NAME:self-test`; all names are present at the baseline.
For plan/receipt reconciliation also run `check:doc-currency`,
`check:fact-consistency`, `check:doc-symbol-refs` with their self-tests,
then `npm run generate:docs-catalog` and `npm run check:docs-catalog`.
Apply additional current changed-surface gates; gate changes are not planned.
Run no fixture-writing batteries concurrently. Relevant red checks block exit.

## Independent review and handoff

After each slice and every material planning correction, obtain a fresh-context
review of the frozen commit and exact tests. Use the authorized subscription
agent path; no metered review-product substitution. Supply only current commit,
this plan, the original report, approved decisions, stage diff and claimed evidence.

> Read AGENTS/CLAUDE and contract-reconcile. Read-only review of Stage 6B1
> (substitute the actual slice). Reopen current source, both hosts, real UI tests,
> route response boundaries and every changed continuation. Challenge request/
> reviewer/mode/permission changes, A→B→A, pending JSON/clipboard/refresh,
> callback-driven navigation and stale finally. For 6B3 include timers, uploads,
> serialized preview and partial SSE. Prove tests exercise the implementation and
> fail when its guard is removed. Preserve status mutex/6A and all server contracts.
> Return source-cited findings, actual checks, remaining limits and PASS/BLOCK.
> Do not edit, call live writers, deploy or approve a later slice.

Record reviewer context ID, frozen HEAD, searched paths, disconfirming cases,
commands actually run and required corrections in a dated stage receipt.
After PASS, reconcile this plan's status, approved-decision pointers and
SESSION_PROMPT through the coordinating agent; keep earlier receipts historical.
Use `/stop` for session handoff. Commit only completed authorized working changes
under the release strategy; publication/promotion remains a separate action.
If stopping mid-slice, state exact dirty paths, last passing/failing commands,
unresolved findings and the next test/edit; never mark a later slice complete.

Non-goals throughout: no Stage 6C file moves, Stage 7 boundary gate, server auth/
eligibility/ETag changes, status input-policy tightening, historical repair,
schema operation, backfill, automatic resend/retry, deployment or live mutation.
