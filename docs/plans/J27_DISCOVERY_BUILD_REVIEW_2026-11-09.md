# J27 Discovery Build Review (step F) — 2026-11-09

Codex adversarial review of `f75704137` and `62855a91b` on `claude/j27-read-model`, brief `CODEX_REVIEW_BRIEF_J27_DISCOVERY_BUILD.md`. Printed in full by the reviewer; recorded here verbatim.

## Findings

1. **PASS — Legacy admission is preserved outside J27+ Research.**

   Evidence: `shared/config/workbenchVisibility.js:90–107`; `lib/services/reviewer-finder/my-proposals-service.js:156–186`.

   [VERIFIED via in-memory execution] A 1,944-case matrix confirmed empty-scope equivalence to `isVisibleRequestRow && isRequestReadyForStaff`, and equivalence outside the readiness-only cohort. Another 48-row matrix exercised the actual post-filter paths in the dashboard, Meeting Tracker selector, Review Panel, briefing, and pre-site service. Reviewer Finder retained its separate status/readiness admission.

   Residual risk: live Dataverse collation was not tested; the existing exact-string status assumption remains.

2. **PASS — The discovery predicate does not fail open on the specified malformed inputs.**

   Evidence: `shared/config/workbenchVisibility.js:58–60`, `:90–107`; `shared/config/requestReadiness.js:12–20`.

   [VERIFIED via in-memory execution] Null/out-of-scope programs, lowercase/padded/malformed cycles, missing cycle information, pre-2027 cycles, and empty scope do not obtain readiness-only admission. False, null, or absent readiness does not admit a J27+ Research row. Non-GUID scope entries throw when validated.

   Residual risk: none found in the specified cases. `isReadinessOnlyRow` classifies the cohort independently of readiness; `isDiscoverableRequestRow` enforces the Boolean.

3. **PASS — The emitted OData filter is a superset, and its OR remains contained.**

   Evidence: `shared/config/workbenchVisibility.js:69–74`; dashboard `:325–333`; program-scope service `:69–82`; review-panel rollout `:29`; briefing `:93–101`; Reviewer Finder `:150–182`.

   [VERIFIED via in-memory execution] Evaluated emitted filters with an independent parser. A ready D26 Research Set-aside row passes the superset but fails the default exact predicate; its J27 counterpart passes both. Both views and the empty-scope wrapper behaved as specified. Captured caller queries rejected out-of-PD, out-of-cycle, out-of-selected-program, or out-of-SE/MR rows wherever those restrictions apply.

   Residual risk: this verifies emitted Boolean structure locally, not execution by Dataverse. The recorded sandbox result remains historical evidence.

4. **PASS WITH QUALIFICATION — Incomplete request scans do not become partial lists or assignment defaults.**

   Evidence: dashboard `:173–178`, `:335–338`; pre-site `:336–342`; panel `:69`; briefing `:103`; Reviewer Finder `:267–272`; program-scope service `:114–136`.

   [VERIFIED via in-memory execution] Injected `capped` and `hasMore` results caused 503 refusal in the dashboard modes, panel, briefing, Reviewer Finder, and pre-site service. A capped assignment scan containing only SoCal assignments selected the Research fallback instead of using the partial assignment set.

   Qualification: assignment discovery still filters and derives candidate IDs before applying `assignmentsCapped` to default selection. Thus “before filtering” is not literally true for that path, but the required conservative fallback is enforced.

   Residual risk: the wider superset can reach existing ceilings sooner, as the plan acknowledges.

5. **PASS — Reviewer Finder preserves its distinct admission and view rules.**

   Evidence: `lib/services/reviewer-finder/my-proposals-service.js:150–186`.

   [VERIFIED via in-memory execution] `actionable` and `all` emitted identical admission filters. A ready J27 Research intake row appeared in both; an unready SoCal Phase II Pending row appeared in neither; a ready Research row with a post-review disposition appeared only in `all`; a D26 intake row remained excluded.

   Residual risk: the projection-contract failure in finding 7 remains.

6. **PASS — Briefing retains SE/MR membership as an additional restriction.**

   Evidence: `lib/services/meeting-tracker/program-briefing-service.js:93–110`.

   [VERIFIED via captured query and in-memory execution] The real SELECT contains both `_akoya_programid_value` and `_wmkf_grantprogram_value`. SE/MR membership remains ANDed with discovery. An otherwise ready Research row outside SE/MR failed the emitted filter; injecting it into a cycle response triggered `briefing_membership_invalid`.

   Residual risk: none found in the specified membership case.

7. **FAIL — Reviewer Finder does not satisfy the required projection contract, and caller-level assertions are missing.**

   Evidence: [Reviewer Finder SELECT](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/reviewer-finder/my-proposals-service.js:164); [projection assertion](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/config/workbenchVisibility.js:82); `tests/unit/workbench-discovery-predicate.test.js:138`.

   [VERIFIED via in-memory execution] Calling `assertDiscoveryQuery` with Reviewer Finder’s actual emitted SELECT and expansion throws:

   ```text
   Discovery select is missing wmkf_triagestatus.
   ```

   The captured queries from the other opted-in readers passed. Sparse-row evaluation did not throw.

   [VERIFIED via repository search] Unit-test references to `assertDiscoveryQuery` occur only in the predicate suite, using constructed queries. The promised assertions on each caller’s real query were not added.

   Residual risk: Reviewer Finder currently uses its own predicate, which does not consume triage, so this is a verified acceptance-contract gap rather than evidence of incorrect admission today.

8. **PASS — Ambiguous Research names disable readiness-only scope; catalog failures propagate.**

   Evidence: `lib/services/workbench/program-scope-service.js:36–48`; briefing `:95`; Reviewer Finder `:150`.

   [VERIFIED via in-memory execution] Two distinct program IDs named Research produced an empty readiness-only scope. A rejected catalog read propagated from briefing and Reviewer Finder instead of silently falling back to legacy admission.

   Residual risk: catalog completeness beyond the bounded read was not verified against live data.

## New Issues

- **P2 — Cycle counts contradict the newly admitted default list.**

  Evidence: [cycle counting](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/dashboard-service.js:208); [count consumer](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/RequestListPanel.js:211); `shared/components/workbench/ScopeSegment.js:34`.

  [VERIFIED via real-module reproduction] With one ordinary, caller-owned, ready J27 Research Set-aside row:

  ```text
  Default proposal list: 1
  Proposal rollup.total: 1
  Cycle count:          0
  Cycle myCount:        0
  Cycle setAsideCount:  1
  Cycle mySetAsideCount:1
  ```

  The consumer therefore renders “Assigned to me (0)” while showing the assigned proposal. D1 changed admission, but the cycle counters still partition exclusively by legacy triage.

  **Required change:** Make default and additional-Set-aside counts reflect discovery membership. Count a readiness-only Set-aside row in default membership without counting it twice when `includeSetAside` is enabled. Preserve historical and non-Research counting. Add a service-to-consumer regression for this case.

- **P2 — The query-contract acceptance gate was not implemented at caller boundaries.**

  Evidence: Reviewer Finder `:164`; `workbench-discovery-predicate.test.js:138`; repository search for `assertDiscoveryQuery`.

  [VERIFIED] Reviewer Finder omits the required triage projection, and existing caller suites do not enforce the real-query contract.

  **Required change:** Apply `withDiscoverySelect` to Reviewer Finder’s proposal SELECT while preserving its own admission predicate. Add `assertDiscoveryQuery` assertions against captured real queries for every opted-in caller, with nonempty Research scope and the specified D26/J27 regression rows.

The remaining Mode A audits found:

- **Whole-flow:** [VERIFIED via source and reproduction] Traced authenticated route → service → request query → completeness check → admission → response → count consumer. The count mismatch is the identified downstream defect.
- **Partial success:** [VERIFIED] Incomplete membership is refused or excluded from assignment defaulting. Mutation/batch-save semantics are N/A.
- **Async/stale state:** [VERIFIED via source] Added catalog reads are awaited and failures propagate. No client state machinery changed; the request-list consumer retains request-generation invalidation.
- **Helper extraction:** [VERIFIED] Reviewer Finder’s status rule and briefing’s SE/MR rule remain distinct.
- **Durable surfaces:** [VERIFIED via diff] No new table, migration, route, or persisted field in step F. Migration/manifest obligations are N/A.
- **Doc reconciliation:** [STALE/CONFLICT] The promised caller projection assertions are absent. No durable documentation was changed during this read-only review.
- **Symbol-consumer fan-out:** [VERIFIED] Admission changed while legacy triage-based cycle counting remained, producing the count defect. The deliberately excluded Final Writeups, dossier, and presentation-service changes are comments only in the reviewed commits.

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Align cycle counts with discovery membership | Complete rows and `discoveryScope` in dashboard cycle listing | Yes, before counting at dashboard `:178–208` | Real dashboard returned one proposal but zero default/personal cycle count | Ready J27 Research Set-aside row; preserve D26/SoCal behavior and prevent double counting | VERIFIED defect; fix not implemented |
| Complete Reviewer Finder projection and enforce actual caller queries | `withDiscoverySelect` and `assertDiscoveryQuery` already exist | Yes, at Reviewer Finder SELECT construction `:164` and mocked adapter boundaries | Actual query failed with missing `wmkf_triagestatus`; other captured projections passed | Assert actual SELECT/expand; omission must fail even when predicate-unit tests pass | VERIFIED gap; fix not implemented |

## Final Verdict

**READY WITH NAMED CHANGES**

Required named changes:

1. Correct cycle/default-assignment counts for readiness-only Set-aside rows.
2. Complete Reviewer Finder’s projection and add the required caller-level query-contract regressions.

The core discovery admission logic passed the adversarial checks performed. Step F does not yet meet the full acceptance contract because of the verified count inconsistency and missing projection enforcement.

Codex session ID: 01a1c18d-e154-7de3-9951-af6648dc9f2d
Resume in Codex: codex resume 01a1c18d-e154-7de3-9951-af6648dc9f2d

## Resolution (Claude, 2026-11-09 UTC, commit `406727a74`)

1. **Cycle counts.** `listCycles` now partitions by discovery membership: a row the default view admits (`isDiscoverableRequestRow(row, false, scope)`) counts as active, every other admitted row as Set aside. The query already ran with `includeSetAside`, so each row lands in exactly one bucket and nothing is double counted. Regression: a ready J27 Research Set-aside row counts `[J27, 1, 0, 1, 0]` and appears in the default proposal list; a D26 Set-aside row still counts `[D26, 0, 1]` and stays out of it.
2. **Projection contract.** The Reviewer Finder select goes through `withDiscoverySelect`; its own admission predicate is unchanged. Every opted-in caller suite now calls `assertDiscoveryQuery` on the real captured `select` and `expand`: dashboard cycle list and proposal list, assignment discovery (`assignmentQueryOptions`), pre-site cycle list, review panel roster, briefing, Reviewer Finder service and route.

Qualification in finding 4 accepted as stated: assignment discovery derives candidate ids before applying the capped flag to default selection; the conservative fallback is enforced and unchanged.

Gates after the fixes: status-enum-parity, dataverse-access-layer, dynamics-context-boundary, route-service-boundary, request-meeting-date-reads, odata-escape, trust-boundary-guid, atlas, doc-symbol-refs, memory-router, types all green. Full unit run: 1515 suites pass; the four red suites are pre-existing on the base commit and untouched (`awardee-tab`, `reviewer-engagement-census`, `reviewer-follow-up`, `workbench-read-coalescing-stage2-characterization`).
