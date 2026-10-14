# Claude Opus review of ranking responsiveness plan

Date: October 14, 2026. Read-only review of revision 1 against source at 650c217b4. Host authentication verified loggedIn=true, authMethod=claude.ai, subscriptionType=team. CLI invoked with model opus, API/provider credential environment variables removed, read-only tools, no MCP servers and hooks disabled. Result success; no permission denials. Model metadata: claude-opus-5-5, claude-fable-5-1. No API-key authentication or Ultrareview.

## Author disposition

All H1–H3 and M1–M8 findings are incorporated in revision 2: exact expected-own validation; raw acknowledged base view; internal action barriers and separate epoch; explicit error provenance; immediate dispatch without debounce; timeout and route navigation guard; realistic fixtures and real-client integration; manual peer-contention retry; projected status; second-interaction metric; focus management. L2–L5 are also incorporated. L1 is not adopted as content-only confirmation: require an operation receipt, then expected-own validation before draining. Source telemetry attribution remains a measurement task. This disposition is not a second reviewer approval.

## Original review

# Review: Proposal Ranking responsiveness plan (`docs/plans/PROPOSAL_RANKING_RESPONSIVENESS_2026-10-14.md`)

I only read files for this review. Nothing was modified or executed. I couldn't write the plan-mode file or call ExitPlanMode because neither tool was available, so the full review is here. Everything below was checked against source at the current HEAD (`650c217b4` branch tip).

## Verdict: READY WITH NAMED CHANGES

The design is sound:
- Requests are frozen once sent.
- Each save sends the whole assessment.
- The server's list-version check (`workflow.js:158`) rejects stale saves.
- The round ETag check (`workflow-service.js:450-454`) rejects writes built on an old round.
- The plan validates every response.

Because those server checks exist, most failure modes I found end in a rejected request, not lost data, even where the UI barrier slips. The biggest gap is that the success/resume check is left to "implementation tests" (plan L55). Every other invariant depends on it. It doesn't need a redesign, though: it can be computed exactly from the server's reducer, and the plan already names the rule (L55, L64). It just needs to be written down. That is why this isn't NEEDS REWORK.

## Plan claims checked

- **L10:** Correct. Every action goes through `busyRef` at `AssessmentWorkflow.js:602-646`. `editable` at `:755-761` excludes busy/pending, and the confidence fieldset at `:300` uses it. `change` at `:775-795` sets the draft and then calls `execute`. `accept` clears the draft unconditionally at `:573`.
- **L12:** Mostly correct. `client.js:34` allows 4 POSTs, which means 3 rebases, and the test at `client-conflicts.test.js:62` confirms it. One correction: the list-version check is in the reducer (`workflow.js:158`), not `workflow-service.js`. Each save costs about 6 Dataverse round trips: `load` (round + 12 rows), the receipt read, the changeset, then a second `load` at `:630`.
- **Not checked by me:** whether "existing server dependency telemetry" (L73) actually exists.

## Findings, ranked by severity

### HIGH

**H1. The success/resume check isn't specified (plan L55, L64).**
- The response after a commit is a fresh read (`workflow-service.js:630-637`), not the committed state. It can include the same PD's newer edits from another tab.
- A replayed operation that finds its receipt returns the *current* view (`:434-445`), not the view as of that operation.
- If the next save is built from that response's `listVersion`, it silently overwrites the other tab's work.
- A naive whole-object comparison won't work, for three reasons:
  1. Every private save sets `own.co.confirmed = false`, whichever program was saved (`workflow.js:169`).
  2. `co` is stored as `{...person.co, ready}` (`workflow-service.js:557-560`), so the loaded `own.co` carries an extra `ready` key.
  3. Saves bump `version` even when nothing changed (`workflow.js:160-164`).
- **Required plan change:** define the expected own state from the frozen request plus its base view. For `saveAssessment(p, v, s)` against base `B`:
  - `E[p]` gets `s`'s order/boundaries/confidence and `version: v+1`. If `p==='co'`, it also keeps `B.co.sourceVersions` and sets `confirmed:false`.
  - If `B.co` exists, `E.co.confirmed = false`.
  - Other lists and `own.ready` are unchanged.
- Accept a response only if all of the following hold:
  - roundId, viewer, `round.state==='active'`, `policyRevision`, `workflow.stage==='private'`, `preparationVersion` and `revealId` all match.
  - A field-by-field compare passes on each list's order/boundaries/confidence/version, `co.sourceVersions`/`confirmed`, and `own.ready`.
- Anything else blocks. Apply the same check to replayed receipts.
- Also state that the acknowledged view must be the server response object itself. The transport's rebase check is `JSON.stringify` equality (`client.js:47-48`), so a view rebuilt on the client would make every rebase fail.

**H2. The barrier against lifecycle actions is only enforced by disabled buttons, and `editable` is used for two different things.**
- Reset is gated by `disabled={!editable}` (`:1203`). Once `editable` stays true during saves (which the confidence fieldset at `:300` needs), Reset becomes clickable mid-save.
- The confirm dialog's button is gated only by `busy` (`:1379`).
- `execute` only checks `busyRef` and `pendingRef` (`:603`), so a second concurrent request is reachable.
- `loadHistory` (`:866-868`) and the "Open replacement run" / "Open previous run" handlers (`:1007-1013`, `:1130-1137`) don't check `busyRef` at all. They also bump the shared `generation` counter, which would invalidate an in-flight save if the controller reused it.
- **Required plan changes:**
  - Split `editable` into `listEditable` (active, no exclusive busy, not blocked, stage rules — but *not* private saving) and `actionsEnabled` (clean, nothing in flight, `!busy`, `!pending`).
  - Enforce the clean-state check inside `execute`, `refresh`, `loadHistory`, `exportWorkbook`, the visibility handler, and both open-run handlers, not only on buttons.
  - Give the controller its own epoch counter, separate from `generation`.
  - Route every `setDraft(null)` site through a controller discard that refuses while a request is in flight: `:573`, `:633`, `:834` ("Continue to X →", a program switch the plan doesn't list), `:954`, `:991`, `:1191`.

**H3. Errors aren't sorted into "definitely rejected" and "uncertain" (plan L62-L65).**
- The plan says only that a timeout or network error isn't proof of rejection.
- A commit can succeed and the readback after it can still fail with a 503 `dependency_unavailable` (`workflow-service.js:630` → `load` at `:195`/`:207`). The client sees an error even though the write landed.
- `requireEditable`/`requirePrivate` raise `invalid_transition` 409s (`workflow.js:15-18`, `:68-70`, `:94-95`). These are not in `DEFINITE_CONFLICTS` (`client.js:22`), so they surface immediately.
- **Required plan change:** add a classification table.
  - **Uncertain** (Check/retry using the exact operation): no status, any 5xx including `uncertain_outcome` and `dependency_unavailable`, a timeout, or a response body that won't parse.
  - **Definitely rejected** (keep the draft, never replay the operation automatically): `stale_scope` or `conflict` after the transport has given up, `stale_list`, `invalid_assessment`, `invalid_transition`, `round_closed`, `confirmation_stale`.
  - **Integrity alarm** (block, no retry): `operation_id_reused`.
  - **Auth:** 401/403 from either the POST or the transport's internal GET.

### MEDIUM

**M1. The debounce adds more than it gains (plan L51).**
- Sending immediately when idle, and keeping only the latest draft while a request is in flight, already gives latest-wins with no timers.
- That one change removes the timer hazards under StrictMode and unmount, the max-wait logic, debounce starvation, and the case where an edit made just before navigating is never sent.
- The repo already uses this pattern in v1: `ProposalRankingApp.js:629-725`.
- The cost is at most one extra write per burst of edits.
- **Required:** drop the debounce for the first patch, per the project rule "simplest solution first". If timers are kept, functional `setState` updaters must stay pure: StrictMode calls them twice, so a revision increment or timer scheduled inside one fires twice.
- Also cite `ProposalRankingApp.js:667` as the anti-pattern to avoid. There, a response is skipped without validation when a newer job is queued.

**M2. There is no client-side timeout.** `api-request.js:119-133` passes `signal` through, but nothing sets one. Recovery is only offered after a failure surfaces, so a hung request shows "Saving…" until the platform returns a 504. **Required:** wrap dispatches in `AbortSignal.timeout(N)`, classify the timeout as uncertain, and send it to Check/retry. Discard must not be offered while a request is still in flight.

**M3. `beforeunload` doesn't cover in-app navigation (plan L68).** `Layout.js:2-3` uses `next/link` and `useRouter`, so a route change unmounts the component without firing `beforeunload`. **Required:** add a `routeChangeStart` guard while work is unsaved, or record this as an accepted loss in the plan. The component is keyed on round and actor (`ProposalRankingApp.js:804`), so a parent scope change also unmounts it. Child guards cover the cycle select, but the plan should say so.

**M4. Existing tests encode behavior the plan forbids, and one test layer is missing.**
- `assessment-ui.test.js:308-323` replays, gets back `initial` (own unchanged), and expects "All changes saved". Under the L64 resume rule, that must block.
- Fixtures at `:104-107`, `:116`, `:223` and `:283` return `own` without the reducer's version bump or `co.confirmed=false`.
- **Required:** the plan should name these as fixtures to correct to realistic reducer output, not as reasons to loosen the check.
- The UI suite mocks `client` entirely (`:10-14`), so nothing tests plan item 3 (the transport's rebase combined with the controller). Add an integration test that mocks `requestEnvelope` and uses the real `client.js`.

**M5. Peer contention can block a PD whose work is fine.**
- Every save writes the round row, so 4 PDs editing contend on one ETag.
- After 3 rebases, the error is a definite 409 `conflict` with own state unchanged (`client.js:34`).
- Under L65 that blocks the PD and offers discard, which throws away valid work.
- **Required:** when a definite rejection is followed by a reload showing own state still equal to the base, allow resending the latest draft as a fresh operation (a manual "Try again" or a bounded backoff), without discarding.
- Record how often this happens in the 4-PD rehearsal.

**M6. Derived status still reads the saved view, not the draft (plan L50).**
- These read `view.own`, not the draft:
  - `allConfident` (`:796-800`)
  - `programProgress` (`:801-806`), which drives the tab labels Complete/In progress (`:1195`)
  - `combinedComplete` (`:812`)
  - `outdated` (`:750-754`)
  - `co.confirmed` (`:844`)
- Labels and the Ready/Confirm button will flip when each save is acknowledged, not when the user clicks.
- **Required:** either compute a projected own state (acknowledged own with the draft applied using the reducer rules from H1), or state that these lag by design because actions are disabled while unsaved.

**M7. The acceptance metric measures something that already works (plan L75).** `change` already renders the draft immediately (`:776`). A single confidence click is visibly instant today. The actual problem is that the *next* interaction is dropped or blocked. **Required:** measure "second interaction applied within 100 ms while the first save is unresolved", plus how long until the next control is usable today, as the baseline. Use Event Timing/INP with CPU throttling. Jest deferred promises can test the 2-second delay; the preview can't inject one without code, so use DevTools throttling there.

**M8. Accessibility.**
- When the queue blocks, the fieldset and drag handles become disabled or unmount (`:254`, `:300`), and focus falls to `<body>`. **Required:** move focus to the recovery alert.
- Keep the `role="status"` text (`:969`) at one stable "Saving changes…" across successive requests, and announce "All changes saved" once.
- Add a positive regression test: after a keyboard drag-and-drop, focus stays on the handle while the save is pending. Today the handle unmounts during the save.

### LOW

- **L1.** If a replayed request hits a definite conflict but the reloaded own state matches the expected result, treat it as confirmed: an earlier attempt landed. v1 does the same at `ProposalRankingApp.js:699-706`.
- **L2.** `AssessmentList` sends whole snapshots up (`:113-115`, `:136`, `:329-335`) and moves by index (`:151-152`). Changing this to updater/ID-based edits changes a component that the collective (`:1314`) and history (`:1104`) views also use, so the collective path must stay on `execute`. If the draft is replaced mid-drag, abort the drop.
- **L3.** Skip dispatch when the latest draft equals the acknowledged content. A no-op save still bumps the version and marks the combined list outdated (`workflow.js:160-169`), and per `:1228-1230` a rebuild replaces combined-only changes.
- **L4.** Wording fixes: L12 (list-version check is in the reducer). L94 says "docs/API semantics … need updates", which contradicts the client-only scope; the API is unchanged.
- **L5.** The blocked message after a partial drain should say the earlier edits were saved and only the latest ones weren't, so that "discard" clearly applies only to unsent work.

## Required plan changes before implementation

1. Write the H1 expected-own check into the plan, and state that the acknowledged view is the server response object itself.
2. Split `editable` into `listEditable` / `actionsEnabled`. Enforce the clean-state barrier inside the entry functions. Give the controller its own epoch. Route all six `setDraft(null)` sites through a controller discard.
3. Add the H3 error classification table, including the post-commit readback failure.
4. Replace the debounce with send-when-idle plus in-flight coalescing, or keep it and add the updater-purity rule.
5. Add a client timeout, a `routeChangeStart` guard, and a "Try again" path for peer contention that doesn't require discarding.
6. Name the test fixtures to correct and add the real-`client.js` integration test.
7. Restate the acceptance metric as next-interaction latency with a measured baseline.
8. Add focus management for the blocked state.
