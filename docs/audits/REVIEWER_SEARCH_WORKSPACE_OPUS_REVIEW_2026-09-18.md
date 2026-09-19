---
title: Claude Opus Review of Reviewer Search Workspace Plan
domain: reviewers
kind: audit
status: draft
summary: Historical OAuth-authenticated Claude Opus review; named corrections are addressed in the revised plan and tracked in its execution receipt.
canonical: false
owner: product-engineering
related:
  - docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md
---

# Independent Claude Opus review

Review requested and authorized by the owner on 2026-09-18 PT. Executed through
Claude Code 2.1.277 using the verified `claude.ai` OAuth subscription; API-key
environment variables were excluded. The `opus` alias resolved to `claude-opus-5`.
No Ultrareview or direct API-key review was used. Editing tools were unavailable.

Reviewed plan commit: `0b7264c3`. Reviewed document SHA-256:
`32e4163a0531795855f0b7219909dd78a455970da60efcd75363dd738125895e`.
Runtime source baseline: `b400c97d8e5da8d72a5d146500d612a74bade1f8`.

The report below is Claude Opus's review, retained verbatim at its reviewed
snapshot. After this review, the owner authorized plan corrections and isolated
local implementation. The revised plan §10 records disposition; its execution
receipt tracks source changes and stage acceptance. Suggestions in the historical
report about fixing on main or accepting unsafe baseline characterizations do not
override repository rules: bounded fixes precede extraction on the isolated branch.
Review acceptance remains distinct from merge, deployment or live-write approval.

---

## Contract-reconcile Mode A — Review of `docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md` @ 0b7264c3 (source baseline b400c97d)

**Step 0 — Surface.** Change surface: component-local decomposition of `shared/components/reviewers/ReviewerSearchSection.js` (3,767 lines) into leaves/views/hooks under a new `search/` directory, facade preserved. Entry points: `ReviewerFindPanel.js:792–811`, `pages/workbench/institution-stage2-smoke.js:5`, 13 unit test files. Persistence: none changed (Postgres roster + Dataverse pool reached through unchanged HTTP routes). Consumers: Find cards, Invite/Track via `onSaved`/`onNavigate`, server importers of `reviewer-search-logic`. Prior findings verified: the plan's §2 hop table, §3 move table, §4 defect ledger. I did not treat the §9 P-A/P-B/P-C verdicts as evidence.

CodeGraph was available and used first (`codegraph explore`); it returned the facade's exports/callers correctly but did not answer the import-consumer question, so I fell back to Grep for that.

---

## Findings (verification of the plan's own claims)

1. **VERIFIED — Public export surface is exactly three symbols and the plan lists them correctly.**
   Evidence: `ReviewerSearchSection.js:121` (`addressTrustFailureMessage`), `:403` (`CandidateCard`), `:1271` (default). External importers: `pages/workbench/institution-stage2-smoke.js:5`, `ReviewerFindPanel.js:46`, and tests (`reviewer-card-warning-badges-clickable:17`, `reviewer-candidate-email-readiness:3`, `reviewer-repair-alert-guidance:5`, `reviewer-candidate-identity-evidence:6`). No server file imports the facade. Residual risk: none.

2. **VERIFIED — Constants move with their only consumers.** `SEARCH_SOURCES` used only at `:3096` (controls); initial/reset state at `:1338`/`:1406` hardcodes the four keys rather than deriving from the constant, so the move is safe. `BLOCKED_REFERRAL_REASON` only at `:3292` (results). `IDENTITY_COMPARISON_REASON` only at `:245` (comparison panel). Residual risk: none.

3. **VERIFIED — Server consumers of `reviewer-search-logic` exist and the plan's "stays in place" rule is load-bearing.** `pages/api/workbench/reviewer-roster.js:61`, `pages/api/reviewer-finder/discover.js:29`, `lib/services/reviewer-address-trust-service.js:37`, `lib/services/workbench/enrich-recommended-service.js:48`. Residual risk: none.

4. **VERIFIED — §4 defect ledger items are real, pre-existing source behavior (not plan defects), and the plan classifies them correctly.**
   - 4.1 progress writes before generation checks: `:1514`, `:1573`, `:1628`, `:1752` (setter) vs. checks at `:1534`, `:1588`, `:1641`, `:1757`.
   - 4.2 exclude rollbacks have no generation guard: `:1943–1948`, `:1970–1976`; contrast `promoteCandidate` `:2009–2015`.
   - 4.3 export has no generation capture: `:2956–3017` (`setExportError` at `:3012` post-await).
   - 4.4 unconditional ref clears: `:1726`, `:1775`; reset effect only resets `excludeEditedRef` (`:1414`).
   - 4.5 refresh loop: gen checks at `:2429`, `:2434`, `:2483`; per-row roster POSTs `:2461–2479` have no per-iteration check.
   - 4.6 asymmetry: `receivedResponse = true` at `:2544` precedes `.json().catch(() => ({}))` at `:2545`; the reload path at `:2623` is gated on `!receivedResponse`; applicant failures `:2710–2711` never reconcile via GET.
   Residual risk: named in New Issue 1 — the consequence of 4.2 is understated.

5. **VERIFIED — Composition order in §3 is consistent with actual data dependencies.** `terminalApplicantKeys` (`:1783`, applicant hook) feeds `visibleRecCandidates` (`:1817`, projection); `previousSearchRefs`/`previousSearchKeys` (`:1827–1837`) feed `removePreviousResults` (`:2018`); `displayCandidates` (`:1843`) feeds `saveSelected` (`:2495`) and `exportSelected` (`:2958`); `reloadRoster` (`:1385`) feeds the reset effect, `promoteCandidate`, `saveSelected`. The listed order (roster-read → reset → discovery → applicant → projection → selection → roster-actions → contact → promotion → export) satisfies every edge with no cycle. Residual risk: none.

6. **VERIFIED — Existing tests will keep working across moves.** All component tests mock `sse` by module path (`jest.mock('../../shared/components/reviewers/sse', …)` in history-controls:10, unverified-rescue:19, promotion-reconciliation:10, rediscovery:14); Jest's registry is path-resolved, so a hook in `search/` importing `../sse` still receives the mock. R7 tests stub the whole facade (`reviewer-find-panel-*:10/23`). Residual risk: none.

7. **VERIFIED — Gate G names resolve.** Every `check:*` in §7 exists in `package.json` (`check:status-enum-parity`, `check:api-routes`, `check:route-service-boundary`, `check:reviewer-engagement-boundary`, `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:doc-currency`, `check:types` — each with `:self-test` except types). `check:reviewer-engagement-boundary` scans `shared/` but only flags bindings of four generic writers from the `reviewer-suggestion` adapter (`scripts/check-reviewer-engagement-boundary.js:152–173`); new `search/` files importing `reviewerEngagementProjection`/`buildEngagedSavedIndex` will not trip it. Residual risk: none.

8. **VERIFIED — Stage 1 line ranges match baseline.** `candKey/dedupeByName/isApplicantOriginCandidate` `:267–281`; helpers `:121–130, :283–338`; `Spinner/Pill/IdentityDecision` `:132–170`; comparison `:172–262`; `InstitutionPresentationNotice` `:340–391`; `CandidateCard` `:403–1269`. `CandidateCard` does not reference `candKey` (first use `:1818`), so the card leaf has no back-dependency on the key wrapper. Residual risk: none.

---

## New Issues (ordered by severity)

**1. HIGH (executability) — The plan is guaranteed to stall at Stage 4 (and likely 5, 9) because it defers a decision it already has the evidence to make.**
Evidence: §4 rule (plan `:215–223`) says a safety assertion that fails on baseline stops the stage pending "separate owner-authorized fix and rebaseline"; Stage 4 exit (plan `:329`) "§4 rollback defect blocks this stage if reproduced and unresolved"; Stage 5 (plan `:339–340`) same for stream/ref. P2 requires "prior operation finishing after new context" (plan `:252`); P3 requires "Exclude failure restores only the original active source" (plan `:253`); P8 requires "§4 stale/export reproduction" (plan `:258`). The source guarantees these fail on baseline: `excludeCandidate`'s catch at `:1945–1947` writes `setRosterActive(dedupeByName([pruned, ...prev]))` with no `genRef` comparison, so after a request switch A→B (reset at `:1399–1442` clears roster state and bumps `genRef`), a late PATCH rejection injects A's candidate into B's `rosterActive`. That row then flows into `displayRosterActive` (`:1814`) → `displayCandidates` (`:1844`) → is selectable → `saveSelected` (`:2487`) POSTs it with `requestId` = B (`:2538`). So 4.2 is not only a UI-state leak; it is a cross-request save hazard. No existing test covers cross-context exclude (R5 `:442` is same-context; history-controls `:758` covers `removePreviousResults`, which has a guard at `:2036`).
Requested correction: add an owner decision gate to Stage 0's exit (not mid-Stage 4): either (a) authorize a bounded pre-refactor fix commit for §4.1–4.3 on `main` with the P2/P3/P8 tests, then rebaseline the plan, or (b) instruct that P2/P3/P8 §4 cases be written as observed-behavior characterizations (test names prefixed `[BASELINE DEFECT]`) so no stage blocks, with fixes tracked separately. Also amend §4.2 to state the cross-request save consequence so the owner is choosing with the real severity in view.

**2. MEDIUM-HIGH (deployment boundary) — Single long-lived branch on a high-churn file with no rebase or incremental-landing instruction.**
Evidence: plan `:424` "Stage commits stay on the isolated branch; no stage auto-deploys"; Stage 10 exit `:390` "no automatic merge"; nowhere does the plan instruct merging `main` into the branch between stages. `git log --since=2026-07-01 -- ReviewerSearchSection.js` = 83 commits (12 since 2026-08-18). `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:142–144`: "Long-running branches are integration risks… deliver it as small, independently safe slices behind stable seams rather than as one final reintegration event." The plan's stages are exactly such slices (facade unchanged, gates green), yet it forbids landing them.
Requested correction: §7 must either (a) permit per-stage (or grouped: 1–2, 4–6, 7–8, 9–10) promotion to `main` under the Tier 2 controls, or (b) require `git merge main` + Gate G + fresh review before every stage starts, and declare a change-freeze policy for `ReviewerSearchSection.js` on `main` for the branch's lifetime. Silence here will produce a multi-thousand-line conflict at Stage 10.

**3. MEDIUM (executability) — Hook signatures are left for the implementer to infer; the plan supplies no free-variable inventory.**
Evidence: §3 `:174–176` "destructure hook arguments and enumerate … dependencies as in the old callback" is the only guidance. `runSearch` (`:1476–1728`) closes over 13 values/props + `genRef` + `runningRef` + 16 setters; `excludeUnverifiedCandidate` (`:1956–1977`) needs `rosterNames`, which Stage 4's card (`:326–327`) does not list; `confirmIdentityContact` (`:2334–2393`) needs `unverified` state and `verifyAddressContact`. A cheaper model will assemble 15–30-argument signatures by hand at each of Stages 4–9.
Requested correction: Stage 0's inventory (plan `:286–288`) must produce, per planned hook, the exact list of props, state values, setters, refs, derived values and sibling-hook commands each moved callback closes over (its argument list) and what it returns, derived from the callback bodies. That artifact is what each stage's fresh review checks the diff against.

**4. MEDIUM (design/executability) — Stage 3's 1,800-line "mechanical bridge" is the riskiest single move and buys nothing that direct extraction doesn't.**
Evidence: Stage 3 (plan `:312–320`) moves `:1292–3058` intact into one hook whose return object must carry ~100 values, and Stage 2 views take ~50 named props each (the results slice alone reads `rosterNote, promotionNotice, displayCandidates, rosterExcluded/Ineligible/Blocked, phase, identityComparison, enrichNote, incompleteCoi*, previousSearchKeys/Refs, canManage, removePreviousResults, removingPrevious, busy, excludedRemoved, blockedReferredSeeds, unverifiedToShow, selected, sortMode, toggleAll, allSelected, readinessSections, toggle, saveSelected, excludeCandidate, useLead, setEditingContact, enrichRecommended, repairCandidateKey, repairRequestsByCandidateKey, repairRequestsUnavailable, retryRosterLoad, requestAddressRepair, reviewAddressConflict, retryAddressCheck, openIdentityConfirmation, savingCount, exportSelected, exporting, exportError, runSearch, blobUrl, rosterLoaded, excludedOpen, setExcludedOpen, promoteCandidate, excludeUnverifiedCandidate, progress` — `:3249–3568`). Nothing in Stages 4–9 structurally requires the bridge; "controller" in those cards can equally be the facade component body.
Requested correction: reorder so Stages 4–9 extract hooks directly from the component (which remains the composition owner), and make `useReviewerSearchController` the final extraction (what remains: state, reset effect, selection callbacks, prop assembly — ~300–400 lines). Stage 10's "reject a giant controller left intact" (`:387–388`) then becomes structurally impossible rather than a review judgement. If the owner keeps the bridge, the plan should say why it is worth one extra ~1,800-line diff and its inverse rollback.

**5. LOW-MEDIUM (plan instruction defect) — Stage 7 will throw a TDZ `ReferenceError` if followed literally.**
Evidence: `editingContact`/`confirmingContact` `useState` sit at `:2302–2304`, after callbacks that reference their setters (`:1413`, `:2224`, `:2295`). Safe today because closures run later. Stage 7 (plan `:355–356`) says "pass existing set functions" as hook arguments — evaluated during render — but neither Stage 3 nor Stage 7's card says to hoist the `useState` pair above the hook call; the hoist appears only in the post-Stage-9 composition paragraph (`:167`). Any render test catches it instantly, so it is not silent, but it costs a cycle.
Requested correction: Stage 7 card: "Hoist the `editingContact`/`confirmingContact` `useState` pair above the contact-actions hook call before passing setters."

**6. LOW (gate teeth) — "Explicit dependency discipline" has no enforcing gate.**
Evidence: `react-hooks/exhaustive-deps` is `warn` (`node_modules/eslint-plugin-react-hooks/cjs/…development.js:55417`; `eslint.config.mjs` does not escalate it); the source already carries one `eslint-disable-next-line` at `:1441`. Gate G's `npm run lint` will not fail on a dropped dependency, contradicting plan `:174–180`.
Requested correction: Gate G asserts zero new `exhaustive-deps` warnings under `shared/components/reviewers/` vs. the Stage 0 baseline count, or runs eslint on `search/**` with the rule forced to `error`. Also state that passed-in setters/refs must be listed in dependency arrays (they are stable; listing is harmless).

**7. LOW (scope hygiene) — No declared minimum-viable stop point.**
Evidence: plan `:221–222` allows unaffected presentation stages to proceed, but does not say that stopping after Stage 2 (+9's projection/export) is an acceptable deliverable. Given Issue 1, that is the most likely real-world outcome.
Requested correction: §1 or §6 names Stages 1–2 as an independently valuable partial deliverable (≈2,000 lines out, no async surface touched), so a stall at Stage 4 is a planned pause rather than an abandoned branch.

**Existing source observation, not a plan defect:** `normalizeReviewerName` is imported at `:62` and never used in the file; Stage 10's dead-import removal will pick it up.

---

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Front-load §4 fix-vs-characterize decision (Issue 1) | Defect at `:1943–1948` reproduces deterministically under delayed rejected PATCH + `requestId` change | Yes — testable with the existing `global.fetch` jest pattern used at history-controls `:758` | Read-through only; NOT executed | Looked for an existing guard or test proving cross-context exclude is safe: none (R5 `:442` same-context; `promoteCandidate` has the guard, exclude does not) | VERIFIED (by reading) |
| Per-stage merge or rebase policy (Issue 2) | Strategy doc `:142–144`; churn count from `git log` | Yes | `git log --since=2026-07-01` = 83 | Does the strategy doc anywhere mandate one long branch for Tier 2? No — Tier 2 (`:119–131`) requires isolation and owner merge decision, not a single terminal merge | VERIFIED |
| Free-variable inventory at Stage 0 (Issue 3) | Callback bodies `:1476–1728`, `:1956–1977`, `:2334–2393` | Yes | Enumerated `runSearch` closures by reading | Could a model derive signatures reliably from "as in the old callback"? Stage 4 card already omits `rosterNames` — the plan itself under-enumerates | VERIFIED |
| Make controller extraction last (Issue 4) | Stages 4–9 cards reference "controller" only as a location | Yes | Traced every hook's inputs to state/props/derivations that exist in the component today | Does any Stage 4–9 step need the bridge to exist? None found; the seam (hook returns → view props) is identical either way | VERIFIED |
| Hoist modal `useState` (Issue 5) | `:2302–2304` vs. `:1413/:2224/:2295` | Yes | Not executed | Would passing a setter declared later work? No — hook arguments are evaluated at call time (TDZ) | VERIFIED (JS semantics) |
| Exhaustive-deps ratchet (Issue 6) | Plugin default `warn`; config not escalated | Yes | Grep of plugin + `eslint.config.mjs` | Is the rule escalated anywhere? No | VERIFIED |

---

## Scope challenge

The selection is defensible: the file is the largest single-owner coupling of six independent async lifecycles, and its Aug–Sep commit history spans both card presentation and save-workflow regions, so decomposition would localize future change. The prior deferral (`WORKBENCH_OBSERVABILITY…:723`) was a performance framing; the plan's maintainability reframing is legitimate and does not overturn it. Excluding backend/`reviewer-search-logic` is correct (four server importers). I did not independently re-run the §1 LOC census; I accepted its coupling argument, not its size ranking.

The real scope question is cost: eleven stages × full Gate G (including `npm run build`) × fresh review is a heavy process whose highest-value, lowest-risk portion is Stages 1–2. Issue 7 asks the plan to say so explicitly.

---

## What I inspected / did not

**Inspected whole:** plan (554 lines); `ReviewerSearchSection.js` `:1–130`, `:132–415`, `:1271–3767` (entire workflow body + JSX); `ReviewerFindPanel.js:785–815`; `reviewer-search-logic.js:100–150`; `pages/api/reviewer-finder/save-candidates.js`; `eslint.config.mjs`; `scripts/check-reviewer-engagement-boundary.js:140–219`; strategy doc `:100–144`; `WORKBENCH_OBSERVABILITY…:712–725`; contract-reconcile SKILL.md. **Symbol-grepped only, not read whole:** `CandidateCard` internals `:415–1269` (module-scope references and hooks enumerated; JSX body not read). Grepped test names and mock patterns in R2–R5; jest.mock lists in the two producer tests.

**Not done:** ran no tests, no build, no gates (none authorized); could not verify the §9 `/root/*` reviewer receipts or snapshot hashes; did not probe any live system; did not read `save-candidates-service.js` or `reviewer-roster.js` bodies (fixed boundaries, plan does not modify them).

**Did prior reviews miss anything material?** Yes, two things: (1) that the §4 blocking rule combined with the verified defects makes a Stage 4 stall a certainty rather than a contingency, and that §4.2 is a cross-request save hazard, not just a UI leak; (2) the absence of any rebase/incremental-landing policy on a file with 83 commits this quarter. The Stage 3 bridge cost and the hook-signature gap are executability findings a cheaper model would hit but that a plan-level reviewer could reasonably have passed over.

---

## Final Verdict

**READY WITH NAMED CHANGES.**

Required named changes before execution authorization: Issues 1 and 2 (owner decision on §4 defects moved to Stage 0 exit with the cross-request consequence stated; per-stage merge/rebase policy). Strongly recommended: Issues 3 and 4 (hook free-variable inventory; controller extraction last). Should fix in the same edit: Issues 5, 6, 7.

Retained prerequisites at execution (unchanged from the plan): all P0–P9 tests written and run green on the *old* implementation before each move; Gate G serial; fresh review per stage; Tier 2 rehearsal before any promotion. No migration implementation is authorized by this review.
