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

## Re-review (Codex, after the rework commit `4da4947ae`)

**Verdict: NEEDS REWORK.** The rework fixes the destructive cross-request callback, Final Writeup propagation, legacy schedule mapping, and resolution budget. Summary freshness now reaches the page, but a later unknown result incorrectly retains the previous freshness value.

## Review scope

[VERIFIED via Git] Reviewed `4da4947ae` on `claude/j27-read-model`, after reading the brief, previous findings, and plan §8 in the requested order.

- **Change surface:** page facts, tab callbacks, composition, passive strip, and resolution read budget.
- **Entry points:** Workbench page, Overview, Final Writeup, and read-only StaffReviewSummary.
- **Persistence:** new facts reside in React memory; existing services supply persisted evidence.
- **Consumers:** page composer → `deriveJ27Stage` → `J27StageStrip`.
- **Prior findings:** all five P2s from the previous review.

Verification used actual modules transpiled in memory, React/jsdom, and mocked I/O boundaries. No files were edited, no commits or external writes were made, and Dataverse was not contacted. The pre-existing `package-lock.json` modification remains. Repository suites and gates were not run; their status is not independently certified.

## Findings

### 1. PASS with residual limitation — Destructive late callback and navigation reset

[VERIFIED via source and in-memory page reproduction]

Evidence: [request page:95](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/workbench/[requestId].js:95).

- Populated B with assessment facts so its strip showed **Deliberations**.
- Invoked A’s saved callback with conflicting facts.
- B remained **Deliberations**, with its facts preserved.
- A→B→A reset A to its server-derived baseline.

The new request-ID guard prevents the original destructive replacement; the route effect clears retained facts.

**Residual risk:** ownership is by request ID, not visit generation. Invoking the first A visit’s saved callback after returning to A still changes the strip. This is a verified callback-boundary weakness, but normal producers have cancellation/generation checks and keyed remounts. I did **not** establish a normal producer path that triggers it, so I am not treating the synthetic callback alone as another P2.

### 2. PASS — Final Writeup start, poll, and advance reach the page

[VERIFIED via real page/component integration with mocked responses]

Evidence: [reporting effect:329](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:329), [poll/start/advance:397](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/FinalWriteupTab.js:397).

Observed at the page composer:

| Path | Reported transition |
|---|---|
| Initial status | `ready` |
| Successful direct start | `group-review` |
| HTTP 202 followed by status polling | `group-review` |
| Leadership advance after either start path | `leadership-review` |

The strip initially offered **Start group review** and removed that task after the accepted transition. The centralized effect fixes the previously missing propagation.

**Residual risk:** transitions were simulated; no actual transition, document operation, or notification occurred.

### 3. PASS — Legacy schedule exceptions work without Overview

[VERIFIED via real composer and derivation]

Evidence: [schedule mapping:63](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:63).

Without an Overview meeting fact:

- `unverified` + `legacy_review_schedule_unverified` preserved `legacyException: true` and enabled `start-group-review`.
- `missing` + `legacy_complete_review_without_schedule` also enabled it.
- Ordinary `unverified` and `not_checked` retained `ended: null`, did not enable the task, and did not manufacture a verified presentation end.

**Residual risk:** none found in the requested mapping cases.

### 4. FAIL — Unknown summary freshness retains an earlier known value

[VERIFIED via real read-only panel, page state, composer, and rendered strip]

Evidence: [summary reporting:32](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/StaffReviewSummary.js:32), [page merge/reset:100](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/workbench/[requestId].js:100), [composition:82](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:82).

The positive cases work: the existing `includeReviewerFacts=1` read supplies hashes, unequal hashes publish `true`, and matching hashes publish `false`.

The sequential case fails:

1. Open Deliberations and establish freshness.
2. Leave the tab while retaining the same page/request.
3. Reopen Deliberations with `currentEvidenceHash: null`.
4. The panel emits no patch, so page state retains the previous Boolean.

Reproduced results:

| Previous evidence | Latest result | Actual composed state |
|---|---|---|
| Matching hashes | Current hash unavailable | `{status:'present', stale:false}` |
| Different hashes | Current hash unavailable | `{status:'present', stale:true}` |

In the second case, the strip continued claiming that reviewer reports had changed. This is a supported service response, not an invented malformed DTO: [handoff service:38](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/staff-review-summary-service.js:38) returns a null current hash when reviewer evidence is unavailable.

**Residual risk:** the page can present an obsolete stale judgment or preserve an unsupported current judgment after a newer read cannot establish freshness.

### 5. PASS — Revised resolution budget matches service invocations

[VERIFIED via real resolver, input assembly, and scope resolver with adapter counters]

Evidence: [resolution:96](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/resolve-request-service.js:96), [scope read:44](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/program-scope-service.js:44), [regression assertion:218](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/tests/unit/workbench-resolve-request-service.test.js:218).

| Case | Suggestion | Catalog | Integrity | `j27` |
|---|---:|---:|---:|---|
| J27 Research | 1 | 1 | 1 | Present |
| J27 SoCal / null program | 1 | 1 | 1 | Absent |
| Empty / failed catalog | 1 | 1 | 1 | Absent |
| D26 | 0 | 0 | 0 | Absent |

C7 and the resolver comment now describe **two incremental Dataverse reads plus one Postgres read**. The regression adds the catalog invocation assertion.

**Residual risk:** these are logical service/adapter read counts. Suggestion retrieval uses paginated `queryAllRecords`; this does not certify an absolute live HTTP-request count or latency.

### 6. PASS — Previously passing contracts remain intact

[VERIFIED via source and in-memory probes]

- Undefined handoffs preserve server memo keys; reviewer counts preserve `anySuggestion` and integrity.
- Research is admitted; SoCal, null program, empty scope, catalog failure, and D26 are excluded as expected.
- The strip has zero interactive descendants, hides `continue-decision-missing`, and renders nothing for `unclassified`.
- The new freshness reporting uses the existing read-only panel request.

Evidence: [composer:76](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/utils/j27PageStage.js:76), [strip:55](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/J27StageStrip.js:55).

## New Issues

- **P2 — Freshness is not invalidated when a subsequent read becomes unknown.** Required change: explicitly replace the previous freshness fact with an unknown state when the new read cannot establish it, including failure paths. Add same-page remount regressions for both `false → unknown` and `true → unknown`; isolated component renders do not cover retained page state.

The generation-boundary limitation in finding 1 remains documented, without a second P2 claim.

## Contract audits

| Audit | Result |
|---|---|
| Whole-flow | Traced existing read → DTO → callback → page facts → composer → model → strip. |
| Partial-success | Summary service preserves prose when evidence fails; page freshness mishandles that partial result. |
| Async/stale-state | Cross-request replacement and navigation reset pass; known-to-unknown freshness fails. |
| Helper extraction | Legacy compatibility and unknown timing preserved; undefined memo semantics preserved. |
| Durable surface | No new schema, migration, route, or persistence write; N/A. |
| Documentation | Current C7 budget agrees with implementation. §8’s “unknown is never current” claim is not fully satisfied. |
| Consumer fan-out | Checked status setters, callback producers, freshness consumer, and strip use. |

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Replace obsolete freshness with explicit unknown | New panel result lacks a current hash | Yes, summary effect and read failure handler | Real page retained prior `true` and `false` across tab remounts | A matching later hash correctly clears `true`; a missing hash does not | VERIFIED |

## Final Verdict

**NEEDS REWORK**

Required named change: complete summary-freshness invalidation and cover sequential known→unknown reads against retained page state.

Codex session ID: 01a1c1a5-dce5-7da1-bea6-7349ac330b34
Resume in Codex: codex resume 01a1c1a5-dce5-7da1-bea6-7349ac330b34
