# J27 Step E Review — 2026-11-09

Codex adversarial review of `9469c47b5` and `65ae8d088` on `claude/j27-read-model`, brief `CODEX_REVIEW_BRIEF_J27_STEP_E.md`. Recorded verbatim; the resolution follows in the plan §8.

## Review scope

**Verdict: NEEDS REWORK.** The program gate and passive strip pass, but request-state isolation, Final Writeup updates, and mapping fidelity have reproducible gaps.

[VERIFIED via `git log` and `git rev-parse`] Reviewed `9469c47b5` and program-gate correction `65ae8d088` on `claude/j27-read-model`, with HEAD at `446acf4cb`. Read the brief first and the plan, including §2 C7 and §8.

- **Change surface:** request-page J27 recomputation, tab fact callbacks, minimal strip, and Research program gate.
- **Entry points:** Workbench request page, Overview, Final Writeup, resolve service, dashboard projection.
- **Persistence:** React memory only for the new page facts; existing database reads supply inputs. No new persistence writes.
- **Consumers:** `deriveJ27Stage`, `J27StageStrip`, resolve/dashboard DTOs, tests and plan.
- **Prior findings:** the brief’s six verification claims and the program-gate/no-draft corrections.

Verification used real modules transpiled in memory, React/jsdom rendering, and mocked I/O boundaries. No files were edited, no commits were made, and no Dataverse calls occurred. The pre-existing `package-lock.json` modification remains untouched. Repository test suites and gates were not run; their reported green status is not independently confirmed here.

## Findings

1. **FAIL — Late callbacks can erase the current request’s facts; facts do not reset on navigation.**

   [VERIFIED via source and in-memory React reproduction] Evidence: [request page:95](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/workbench/[requestId].js:95), [request page:113](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/workbench/[requestId].js:113).

   `reportJ27Facts` accepts any nonempty request ID and replaces the single fact object when IDs differ. The render guard prevents A’s values from being applied directly to B, but a late A callback still removes B’s facts: after B’s loaded assessment produced **Deliberations**, invoking A’s saved callback changed B’s strip to **Peer Review**.

   The route is included in `useMemo`, but no route-change reset or generation ownership exists for `j27Facts`. Returning to an earlier request can reuse its retained facts if another request has not replaced them.

   **Residual risk:** the existing navigation test reports late A facts before B has meaningful facts, so it misses the destructive replacement case.

2. **FAIL — Mapping fidelity is incomplete, although several important mappings are correct.**

   [VERIFIED via source and in-memory module/component reproductions] Evidence: [composer:50](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:50), [Overview:86](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/J27Overview.js:86), [transition state:78](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/final-writeup/transition-state.js:78).

   Confirmed correct: reviewer count mapping; presentation ID and stale roster preservation; `ended`/`upcoming`; no-draft versus unrelated failure; and no conversion of `not_checked` or `unverified` into confirmed ended/absent state.

   Two gaps remain:

   - **Legacy compatibility depends incorrectly on Overview.** With no Overview presentation fact, `legacy_review_schedule_unverified` is discarded. The real composer therefore omits `start-group-review`, even though that explicit server compatibility reason permits it. The sibling `legacy_complete_review_without_schedule` case works because it follows the `missing` branch. Ordinary `unverified`/`not_checked` results also leave presentation `not-loaded` when Overview is absent, rather than representing the attempted read’s unknown timing.
   - **Summary freshness never reaches the model.** Overview reduces the summary response to a Boolean; the composer produces only `{status:'present'}`. Even a response containing differing saved/current evidence hashes lost that distinction in the real component reproduction. Moreover, the actual Overview URL does not request `includeReviewerFacts=1`, so its current response lacks the current hash needed to establish freshness. The plan’s `reviewSummary.stale` contract is therefore unimplemented.

   **Residual risk:** the freshness fix must account for the read budget; merely changing the mapper cannot create evidence absent from its caller.

3. **PASS — Undefined handoffs preserve server-decided tier 1 memo keys.**

   [VERIFIED via source and in-memory composer reproduction] Evidence: [composer:28](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:28), [composer:74](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:74).

   Supplying undefined rationale, summary and assessment handoffs left the server input unchanged. Explicit `null` maps to unavailable, while Boolean results override presence. Counts merge into `reviewers` without replacing `anySuggestion`; integrity is preserved.

   **Residual risk:** summary freshness is a separate missing field, as described above.

4. **PASS — The program gate rejects the required complement cases.**

   [VERIFIED via real resolver/input modules with mocked adapters] Evidence: [input gate:147](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/j27-read-model-inputs.js:147), [resolver:104](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/resolve-request-service.js:104).

   J27 Research retained `j27`; J27 SoCal, null program, empty scope and catalog failure did not. D26 also omitted it. Without `j27.input`, the page derives no strip. Dashboard passes its resolved discovery scope into the same gate.

   **Residual risk:** live catalog contents were deliberately not checked.

5. **PASS — The strip is passive and hides the specified presentation-only blocker.**

   [VERIFIED via source and React/jsdom rendering] Evidence: [strip:54](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/J27StageStrip.js:54).

   Rendering all blocker keys produced zero interactive descendants. `continue-decision-missing` was hidden, `unclassified` rendered nothing, and task-label keys matched the model vocabulary. The derived stage feeds the strip, not operation authorization.

   **Residual risk:** this verifies DOM behavior, not a browser screenshot or subjective visual interpretation.

6. **FAIL as written — No additional client fetch was introduced, but the page path has an additional server read.**

   [VERIFIED via real resolver with adapter call counters] Evidence: [resolver:96](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/resolve-request-service.js:96), [scope resolver:44](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/program-scope-service.js:44).

   Resolution now calls the program catalog once, in addition to the existing suggestion and integrity reads. This also happens for J27 SoCal/null-program rows before the gate excludes their stage. D26 makes none of those three J27-specific reads.

   [STALE/CONFLICT] C7 and the resolver comment still state **one incremental Dataverse read plus one Postgres read**. The implementation adds **two Dataverse reads plus one Postgres read**. §8 acknowledges the catalog read, so the documentation is internally inconsistent.

   **Residual risk:** adapter invocation counts were measured; live latency and backend pagination were not.

## New Issues

- **P2 — Request facts lack route-generation ownership.** Evidence: request page:95–115. **Required change:** reject callbacks from another route or generation, and reset/invalidate facts on navigation. Cover B already populated followed by late A, plus A→B→A.

- **P2 — Final Writeup transitions do not update page facts.** [VERIFIED via in-memory React reproduction] Evidence: [FinalWriteupTab:307](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:307), [polling:394](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:394), [start result:434](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:434), [advance result:478](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:478). A simulated successful start changed the real tab to **“Group review is in progress”**, but the callback history still contained only the initial `ready` state. Polling and leadership transitions likewise update local status without reporting facts. **Required change:** publish every accepted status transition under the appropriate stale-generation guard.

- **P2 — Explicit legacy compatibility is lost without an Overview presentation.** Evidence: composer:65–69. **Required change:** preserve both server compatibility reasons independently of whether Overview ran; keep unknown timing explicitly unknown.

- **P2 — Summary freshness is missing from the page contract.** Evidence: Overview:88, composer:35, [summary route:33](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/api/workbench/staff-review-summary.js:33). **Required change:** establish a supported freshness input and preserve it through composition, or explicitly revise the promised contract to defer it. Do not treat unknown freshness as verified current.

- **P2 — Read-budget contract contradicts implementation.** Evidence: resolver:96–104; plan C7 and §8. **Required change:** reconcile the allowed catalog read with the budget and add an exact read-count regression. If zero additional reads remains mandatory, the implementation must change while preserving the program gate.

## Contract audits

| Audit | Result |
|---|---|
| Whole-flow | Traced route → authenticated GET → service/adapters → DTO → tab facts → composer → strip. New persistence writes: N/A. |
| Partial-success | Independent failed reads become unavailable; undefined handoffs preserve server values. Bulk-write success accounting: N/A. |
| Async/stale-state | Failed at page fact ownership and Final Writeup propagation. Overview handoffs check abort state; reviewer progress checks cancellation/token ownership. |
| Helper extraction | Pure composer adds no I/O, but loses compatibility and freshness distinctions. |
| Durable surface | New tables, columns, routes, migrations and cleanup requirements: N/A. |
| Documentation reconciliation | Read-only audit identified the budget contradiction. No reconciliation edits performed. |
| Symbol-consumer fan-out | Traced callback callers, stage consumers, status setters and label maps; found unreported Final Writeup status updates. |

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Bind facts to route generation | Existing `routeStateRef`/generation | Yes, request page | Real page, B populated then late A | B regressed from Deliberations to Peer Review | VERIFIED defect; fix not implemented |
| Report all Final Writeup status changes | Accepted next status | Yes, initial load/poll/start/advance | Real tab with simulated successful start | Tab advanced; callback did not | VERIFIED |
| Preserve legacy reason without Overview | Server `startCompatibilityReason` | Yes, mapper argument | Real composer with both reasons | `missing` exception worked; `unverified` exception failed | VERIFIED |
| Complete freshness contract | Saved and current evidence hashes | **No**, current Overview GET lacks current hash | Real component fed differing hashes; route inspected | Even supplied hashes were discarded | VERIFIED gap; data-source choice unresolved |
| Reconcile read budget | Actual resolver adapter calls | Yes | Real resolver with counters | J27 added catalog call; D26 did not | VERIFIED contradiction |

## Final Verdict

**NEEDS REWORK**

Required named changes: route-generation isolation/reset, complete Final Writeup fact propagation, independent legacy-reason mapping, an explicit summary-freshness contract, and a reconciled read budget with regression coverage.

The program gate, undefined-memo preservation, and passive strip behavior can remain.

Codex session ID: 01a1c19e-2f3c-7bd1-9671-82171c1dfa4d
Resume in Codex: codex resume 01a1c19e-2f3c-7bd1-9671-82171c1dfa4d
