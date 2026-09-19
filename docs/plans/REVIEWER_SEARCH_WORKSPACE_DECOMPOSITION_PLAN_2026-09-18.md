---
title: Reviewer Search Workspace Decomposition Plan
domain: reviewers
kind: plan
status: active
summary: Authorized staged decomposition of ReviewerSearchSection into presentation and explicit workflow hooks, preserving HTTP, persistence, identity, and refresh contracts.
canonical: false
owner: product-engineering
related:
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/atlas/postgres-reviewer-find-roster.md
---

# Reviewer Search Workspace Decomposition

## 1. Decision, scope, and authorization

**[PLANNED] Recommended refactor:** separate the Workbench Reviewers → Find
workspace's rendering, roster operations, search streams, applicant enrichment,
contact remediation, and promotion reconciliation. Preserve the public
`shared/components/reviewers/ReviewerSearchSection.js` entry point.

**Authorization updated 2026-09-18:** the owner authorized plan corrections and
local implementation on an isolated branch, with Luna implementing, Sol reviewing,
and the orchestrator accepting each stage. No merge, deployment or live writes are
authorized. New paths remain proposed until recorded in the execution receipt. This is a maintainability/testability proposal,
not a performance intervention, product redesign, or replacement state machine.

**Baseline:** `b400c97d` on `main`, inspected 2026-09-18 PT. Line references below
are navigation aids at that commit; resolve named symbols at execution time.
Source claims do not establish current deployment or mutable production data.

This is the largest *bounded, defensible remaining responsibility decomposition*
identified in the surveyed code, not a mathematical claim that no larger project
could be invented. The application already has DAL and route/service boundaries;
rebuilding them is not the selected task. A source census over `lib/`, `shared/`,
`pages/`, and `modules/` ranked JS/JSX/TS/TSX files by line count, then the major
candidates were compared for responsibility coupling, blast radius and existing
plans. Size was a search aid, not the sole selection criterion.

| Candidate at baseline | Source evidence | Decision |
|---|---|---|
| ReviewerSearchSection, 3,767 lines | `shared/components/reviewers/ReviewerSearchSection.js`: card 403–1269; workflow 1271–3058; JSX 3059–3767 | Select: one staff workflow contains several independent operation lifecycles and intricate partial-success reconciliation. |
| Admin page, 3,536 lines | `pages/admin.js`: section components and workspace switches | Easier file splitting, less intertwined workflow ownership; not selected. |
| Dynamics Explorer chat, 2,983 lines | `pages/api/dynamics-explorer/chat.js`: tool orchestration, restrictions, Graph access, telemetry | Credible separate refactor, but backend/tool-security blast radius is broader. No claim it lacks value. |
| Reviewer suggestion adapter, 2,486 lines | `lib/dataverse/adapters/reviewer-suggestion.js`: multiple lifecycle operations | Cross-lifecycle persistence boundary; not a Finder-only concern. |
| Save candidates service, 1,788 lines | `lib/services/reviewer-finder/save-candidates-service.js`: compensation 1678–1712, response envelopes 1722–1787 | Keep fixed. An HTTP seam already isolates it; changing it does not enable UI extraction. |
| GraphService, 1,641 lines; Executor, 1,353 lines | `lib/services/graph-service.js`; `lib/services/execute-prompt.js` | Shared contracts with wider fan-out; separate scope. |

**Existing planning, not erased:** the Deferred section of
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md:717–723` explicitly
postpones this component's decomposition until measured render cost justifies
it. That performance work remains deferred. This new document proposes an
independent maintainability case now authorized by the owner; it does not overturn
that decision or claim measured performance benefit. Searches of `docs/` and
`.claude-memory/` found that deferral and historical feature plans, but no dedicated
stage-by-stage workspace decomposition plan. The completed governed-document
refactor is a predecessor, not unfinished work to repeat.

**Change surface:** component-local organization and tests. Entry points:
ReviewerFindPanel and the institution-stage2 smoke page. Existing persistence:
Postgres working roster and Dataverse saved reviewer pool, reached through
unchanged APIs. Consumers: Find cards, Invite/Track refresh callbacks, smoke page,
existing unit/integration tests. Prior findings: no owner-supplied defect list;
planning review identified async characterization gaps (§4).

**Excluded:** backend/route/adapter changes; schema or data migrations; new caches,
receipts, candidate keys, enums or DTOs; identity/COI policy; enrichment/provider
behavior; SSE parser changes; selective refresh; `onSaved` semantics; dependencies;
new global state/reducer/workflow framework; CSS/copy redesign; unrelated components.
`reviewer-search-logic.js` is shared with server consumers and stays in place.
Do not infer it is client-only because of its directory.

## 2. Verified contract and preserved differences

[VERIFIED via source reads and caller search at baseline]

| Hop | Evidence and contract to preserve |
|---|---|
| Caller | `ReviewerFindPanel.js:792–811` passes request/proposal, ingestion, savedPool, callbacks, manualAddSlot and repairCandidateKey. Parent keeps proposal loading/ingestion/manual-add ownership. |
| Public exports | Default ReviewerSearchSection plus named CandidateCard and addressTrustFailureMessage. `pages/workbench/institution-stage2-smoke.js:5` and tests import the named card from the current facade. Retain direct re-exports, not wrappers with a new component identity. |
| Browser state | `ReviewerSearchSection.js:1292–1442`: state, operation refs and one generation ref. Reset depends on requestId, blobUrl and stable reloadRoster, not simply proposalKey. Do not add `key={requestId}` remounting or change reset dependencies. |
| Search | `:1476–1730`: analyze → discover → enrich → rerank → awaited roster POST. Per-stage terminal-result/transport-error handling differs. Search stays busy through roster persistence. |
| Applicant lane | `:1734–1808`: independent stream and ref; cache validity uses proposalKey, roster terminal keys, expected recommendation set and existing cache helper. Preserve manual refresh and handled/ineligible partitioning. |
| Roster | `pages/api/workbench/reviewer-roster.js`: authenticated GET/POST/PATCH. GET reconciles stored working rows with Dataverse engagement. Browser PATCH saved is rejected; server promotion owns graduation. |
| Ordinary save | `pages/api/reviewer-finder/save-candidates.js:27–73`: POST, requireAppAccess('reviewer-finder','reviewers'), session-derived actor, trusted DAL context, service result/error mapping. `save-candidates-service.js` uses person/researcher/suggestion adapters and roster finalization. No client authorization replaces this. |
| Applicant save | `ReviewerSearchSection.js:2499–2514,2675–2731`: applicant-suggested provenance uses promote-applicant-reviewer with suggestionId and only marked manual fields. Ordinary candidates use save-candidates. Never consolidate these endpoints or payloads. |
| Partial success | `:2544–2615,2733–2942`: exact result correlation, blocked/expired/address/repair outcomes, roster reload on incomplete finalization, onSaved only for current-context success. Counts/names alone cannot identify cards to remove. |
| Key translation | `reviewer-search-logic.js:118–150`: save key differs from roster key. Valid index AND matching save key win; index-less unique match is compatibility fallback; ambiguous/contradictory results stay unbound. |
| Remediation | `:2126–2393`: website/affiliation draft persistence, exact-person/address evidence, partial receipt success, record repair, ephemeral rescue POST → confirm_identity → verify address. Preserve per-operation return false/true/throw behavior used by modals. |
| Consumer | `:2956–3017`: export uses selected selectable rows and independent error surface; `:3059–3767`: readiness groups, status/live region, excluded/ineligible/blocked/unverified, modal placement, manual slot, handled navigation and applicant status. |

Persistence interpretation is source-bounded: the roster store and Atlas distinguish
operational request state from canonical saved Dataverse people/suggestions.
No live database probe was necessary for a UI-only plan, and no claim about current
row counts, schema readiness, or deployment state is made.

Preserved-difference checklist:

- Stable candidate identity is not normalized-name exclusion. `candKey` delegates
  to reviewerCandidateKey; misleading legacy names such as dedupeByName are not
  permission to simplify its delegated dedupeReviewerCandidates semantics.
- Applicant origin is broader than one boolean; use existing provenance helpers.
- Display permissiveness and authoritative promotion are different contracts.
  Preserve every existing readiness rule, including incomplete COI presentation.
- Durable exclusion rollback differs from ephemeral-unverified exclusion rollback.
- A saved Dataverse row with failed roster finalization remains a success requiring
  reconciliation; a transport failure may have committed and requires roster reload.
- An expired attestation refresh is durable per-row acknowledgement (`recorded === 1`),
  then deselection for human review; it is not automatic re-promotion.
- Authority-bearing DTO fields pass through existing prune/correlation helpers.
  No UI hook may mint or reinterpret a server receipt.

## 3. Target ownership and exact move order

The target ownership below is **[PLANNED]**; completed stages and verified existing
paths are recorded in the execution receipt. Paths are beneath
`shared/components/reviewers/search/` unless otherwise stated. No whole-file
rename of the public facade or shared logic file is proposed.

| Stage | New file(s), in creation order | Source slice/symbols |
|---|---|---|
| 0 | Regression prerequisites, bounded safety fixes, execution inventory (§4–5) | Reproduce defects first; commit fixes separately before any move. |
| 1 | `candidateKeys.js`, `presentation.js`, `SearchPrimitives.js`, `IdentityComparisonPanel.js`, `CandidateCard.js` | candKey/dedupeByName/isApplicantOriginCandidate at 267–281 into candidateKeys; addressTrustFailureMessage/formatSaveFailureDetails and label helpers at 121–130,283–338 into presentation; Spinner/Pill/IdentityDecision 132–170; IDENTITY_COMPARISON_REASON (107–119) and comparison 172–265; InstitutionPresentationNotice 340–401 and CandidateCard 403–1269. Keep InstitutionPresentationNotice private in CandidateCard. |
| 2 | `SearchControls.js`, `SearchResults.js`, `SearchContactModals.js`, `HandledReviewers.js`, `ApplicantReviewerStatus.js` | Controls/header/progress inside the first Card (3063–3247), results conditional (3249–3568), both modal conditionals (3569–3594), handled conditional (3601–3638), applicant Card (3645–3763). SEARCH_SOURCES (94–99) moves with controls; BLOCKED_REFERRAL_REASON (101–105) with results. Outer search Card and manual slot stay in facade. Boundaries are complete JSX expressions, with ranges as navigation only. |
| 3 | `useReviewerRoster.js`, `useReviewerRosterActions.js` | applyRosterSnapshot/reloadRoster/retryRosterLoad; excludeCandidate/excludeUnverifiedCandidate/promoteCandidate/removePreviousResults. |
| 4 | `useReviewerDiscovery.js` | runSearch only, retaining local stage variables and ordered awaits. |
| 5 | `useApplicantReviewerEnrichment.js` | enrichRecommended, terminalApplicantKeys/actionableRecommended/cache derivation and auto-enrichment effect. |
| 6 | `useReviewerContactActions.js` | setManualContact through confirmIdentityContact (2068–2393); modal state stays in controller. |
| 7 | `useReviewerPromotion.js` | refreshExpiredVerification + saveSelected (2395–2954), moved together so refresh and reconciliation remain one operation. |
| 8 | `useReviewerExport.js`, `useReviewerSearchProjection.js` | exportSelected; display derivations 1814–1911 and 3021–3057. Use Stage 1 candidateKeys wrappers; no replacement of canonical helpers. |
| 9 | `useReviewerSearchController.js` | Remaining state, refs, reset effects, selection callbacks and hook composition only; all operation bodies already extracted. |
| 10 | Boundary tests and ownership documentation | Remove only now-unused imports/local definitions from owned files; preserve facade exports. |

Stage 1 moves the three key wrappers once, with their exact delegated behavior;
remaining facade code and later hooks import that leaf. Constants move with their
only view consumer as listed. No child imports the facade to recover a missing
local definition. P0/P1 include populated comparison reasons, referral rejection
reasons, and every source-toggle label so missing constants fail before acceptance.

Final dependency direction:

```text
ReviewerFindPanel / smoke page / existing tests
  -> ReviewerSearchSection (same default + named export facade)
     -> useReviewerSearchController (composition and state owner)
        -> roster read, roster actions, discovery, applicant, contact,
           promotion, export, projection hooks
     -> SearchControls / SearchResults / SearchContactModals /
        HandledReviewers / ApplicantReviewerStatus
        -> CandidateCard / IdentityComparisonPanel / primitives
hooks and views -> existing shared pure utilities / reviewer-search-logic / sse
```

Never hook → facade, view → operation hook, server → new search modules, or leaf →
controller. Existing server imports of reviewer-search-logic remain legal and
unchanged. No barrel `export *`, generic operation dispatcher, React context,
provider or new dependency is needed.

**State ownership:** the facade retains existing useState cells and one genRef
through Stage 8; Stage 9 moves that composition owner into the controller. Below,
“controller owner” means this single owner, even before the hook exists.
The operation hooks receive explicit named input values, existing refs and named
setters/callbacks, and return only their commands. They do not acquire a second
copy of roster, candidate, selection, phase or generation state. Card-local
expanded/evidence/action busy state stays in CandidateCard. Parent manual-add
state stays in ReviewerFindPanel. Form/modal/selection state remains controller
owned; view components may call passed event handlers but do not fetch.

**Composition order after Stage 9:** state/refs (including modal state) → saved-pool
projections → roster-read hook → original reset and exclusion-prefill effects →
stable pushProgress → discovery hook → applicant hook/effect → display projection →
selection callbacks → roster-action hook → contact-action hook → promotion hook →
export hook → view prop assembly. The reset effect remains in the controller with
its accepted Stage 0 dependency list and reset list. Moving declarations earlier must not
change defaults or cause callbacks to execute during render.

**Explicit dependency discipline:** destructure hook arguments and enumerate scalar,
array, ref and function dependencies as in the old callback. Do not make a newly
allocated `state`, `actions` or `options` object an effect dependency; that can
restart roster loading/enrichment every render. Do not use an empty dependency
array, ref-to-latest conversion, or memoization to hide a stale closure. Preserve
the corrected Stage 0 ref lifecycle; bounded defect fixes follow §4. New search/
hooks must pass `react-hooks/exhaustive-deps` as an error. Include passed-in setters
and refs in dependency arrays; do not suppress warnings to hide extraction bugs.

Controller-to-view interface is named props, grouped by existing view responsibility:
search form/progress, candidate results/selection/actions, contact modal bindings,
handled navigation, applicant ingestion/enrichment. A view gets only the values
and callbacks its JSX reads. Extract operations directly from the facade at Stages 3–8. Stage 9 must not
relocate large operation bodies into a controller bridge.
No fixed LOC target overrides a cohesive function such as saveSelected.

## 4. Assumption and defect ledger

[VERIFIED via source; runtime reproduction NOT performed for these gaps.]

1. **Stale stream progress:** analysis/discovery/enrichment callbacks invoke progress
   setters before subsequent generation checks (`:1511–1534,1570+,1620+`);
   applicant progress does likewise (`:1753–1759`). Existing late-result coverage
   is not proof that every progress frame is guarded.
2. **Optimistic rollback:** excludeCandidate and excludeUnverifiedCandidate catch
   paths (`:1926–1977`) have no generation check, unlike promoteCandidate.
3. **Export:** exportSelected (`:2956–3017`) does not capture genRef; its error,
   finally and download effects need characterization on request change/unmount.
4. **Ref cleanup and lifecycle:** runningRef/recRunningRef clear unconditionally in
   finally. Reset does not reset all operation refs. A new hook must not silently
   change same-context double-submit or cross-context restart behavior.
5. **Refresh loop:** refreshExpiredVerification guards after enrichment and at return;
   inspect each roster POST's stale boundary before moving it. In-flight requests
   cannot be retroactively undone by discarding their UI result.

6. **Unknown-outcome asymmetry:** ordinary save reloads only when fetch rejects
   before receivedResponse becomes true (`:2539–2541,2628–2645`). A response whose
   JSON read fails becomes `{}` and does not take that recovery path. Applicant
   promotion failures (`:2693–2710`) do not use the same GET reconciliation.
   Characterize these three cases separately. This plan neither claims universal
   recovery nor authorizes adding it.

   **Execution characterization [VERIFIED via real store projection and P7 tests]:**
   `reviewer-roster-store.js` only emits saved keys whose row key matches the
   suggestion anchor. A saved ordinary row retaining its original non-suggestion
   key disappears from `active` without appearing in `savedKeys`. After a lost
   response, the current UI can therefore remove that row without confirming
   success or calling `onSaved`; when no cards remain, its action-local error
   notice is also hidden. Preserve this existing limitation during decomposition.
   A separate behavior fix is required before claiming universal recovery.

**Stage 0 disposition: bounded fixes authorized before extraction.** Write deterministic
reproductions against the unchanged implementation for items 1–5. In particular,
an old exclusion rejection can insert request A's candidate into request B's active
UI/submission set; this is a cross-request UI/submission hazard, not proof that the
server would authorize a cross-request write. Never bless that result as baseline.

Commit reproductions and their narrowly scoped fixes separately from file moves;
record observed failure, expected behavior and corrected baseline. Scope is stale
progress/success/failure/cleanup after context change or unmount, generation-owned
running refs allowing a new context to start without an old finally clearing its
lock, export side effects, and stopping subsequent refresh-loop POSTs once stale.
Preserve same-context duplicate-submit behavior. Already-issued writes cannot be
undone by a generation guard. No endpoint, payload, identity or receipt policy may
change. Item 6 is characterization only: retain its existing recovery asymmetry.
If reproduction refutes a source concern, record evidence rather than invent a fix.
If a defect needs changes beyond this scope, stop dependent work for orchestration
review. No unsafe baseline or failed safety assertion is an accepted stage.

## 5. Tests that must exist before movement

**Common rule:** commit a stage's missing characterization tests separately and run
them on the previous accepted implementation before moving production code. Existing
tests may satisfy a requirement; cite their test names rather than duplicate them.
Every mock must contain the unsafe/competing row it claims to exclude. At least one
focused intentional mutation must make each critical test group fail (restore the
mutation immediately; never commit it). No tests may hit live providers/stores.

Existing regression anchors (under `tests/unit/`):

| ID | Existing files | Evidence / remaining obligation |
|---|---|---|
| R1 | `reviewer-search-logic.test.js`, `reviewer-search-rediscovery.test.js`, `reviewer-candidate-email-readiness.test.js` | Pure keys/readiness/dedupe/cache and engaged-row projection. Keep imports and semantics. |
| R2 | `reviewer-search-section-save-stale.test.js` | Late save success/failure, page scrolling and action-local live status. Does not prove all async handlers are safe. |
| R3 | `reviewer-search-promotion-reconciliation.test.js` | Exact indexed result reconciliation, non-2xx partial success, repair/verification, draft persistence, failed roster finalization, durable refresh and manual retry. |
| R4 | `reviewer-search-history-controls.test.js` | Authoritative load gate/retry, previous-result removal, stale responses, applicant cache/manual refresh, terminal stream recovery and refusal. |
| R5 | `reviewer-search-unverified-rescue.test.js` | Real UI rescue/exclude ordering, rollback and late diagnostic results. SSE reader is mocked here. |
| R6 | `reviewer-card-warning-badges-clickable.test.js`, `reviewer-candidate-identity-evidence.test.js`, `reviewer-search-mismatch-banner.test.js`, `reviewer-repair-alert-guidance.test.js` | Named card export, warning actions, evidence and repair wording. |
| R7 | `reviewer-find-panel-stale-ingestion.test.js`, `reviewer-find-panel-manual-add-confirm.test.js` | Parent integration and callback/manual-add boundaries. |

Planned additional files, only if existing cases do not already satisfy the rows:

| ID / before stage | Planned test file | Required cases and falsification |
|---|---|---|
| P0 / 1 | `tests/unit/reviewer-search-public-contract.test.js` | Import old default/named paths; card with populated evidence, read-only/canManage=false, absent remedy callbacks, server repair and unknown status. Assert action availability and callback arguments, not random useId strings. Removing a permission/availability branch must fail. |
| P1 / 2 | `tests/unit/reviewer-search-workspace-composition.test.js` | Populated active/excluded/ineligible/blocked/unverified/handled and applicant statuses; empty/error/loading; same-name distinct keys; sorting, selections, manual slot and modal lifecycle, search form edits and prompt editor. Parent onSaved/onNavigate counts and modal false/throw semantics. Move a slot or wire a wrong action and expect failure. |
| P2 / 0, 3 | `tests/unit/reviewer-search-context-lifecycle.test.js` | Deferred roster GET A→B, same-request blobUrl change, proposalKey-only change, exclusions arriving after edits, rerenders without reload loop, unmount, same-context double-click, prior operation finishing after new context. Assert reset/default/ref behavior from old code. Reproduce §4 separately. |
| P3 / 3 | extend R4/R5 | Active exclusion failure restores the pruned row into rosterActive (including a transient row); unverified exclude failure never becomes active; stale promote 409 reload; scoped remove preserves newer updatedAt, applicant/saved/excluded rows and unaffected selection. Test actual populated complements. |
| P4 / 4 | `tests/unit/reviewer-search-stream-contract.test.js` | Real readSseStream with in-memory fragmented ReadableStream (no mocked parser): UTF-8/chunk splits, progress, complete then transport error, transport error before complete, explicit error, missing body/non-OK. Exercise analyze/discover/enrich through the public component; roster POST awaited, prune payload, rank/off-topic ordering and deceased partition. Late callbacks/success/failure/finally are separately covered under §4. |
| P5 / 5 | extend R4 + P2 | Exact expected applicant keys/cache version/proposal binding; active/ineligible versus excluded/saved terminals; partial cache; handled recommendations; manual refresh; concurrent discovery and applicant streams; no repeated enrich on ordinary rerender. Include unknown/missing fields, not only ideal DTOs. |
| P6 / 6 | extend R3/R5 | Full server-authoritative contact candidate replacement; website/affiliation draft acknowledged first; exact receipt-bound fields; verify returns partialSuccess+receiptRecorded then throws; failed ephemeral record blocks confirm; committed confirm followed by failed address verification remains visible/retryable; request change at each await. |
| P7 / 7 | extend R2/R3; `tests/unit/reviewer-search-save-contract.test.js` | Mixed ordinary/applicant batch; same save key/different roster keys; malformed explicit index; missing-index legacy result; all rejected; partial non-2xx; ordinary pre-response network loss and GET reconciliation; ordinary post-response malformed/unreadable JSON and applicant transport failure without that recovery; roster-finalized false; repair-priority codes; manual fields only in applicant payload. Expired refresh manual field skip, unchanged token, recorded=0/1 per row, partial refresh, no auto-save, context change, onSaved exact count. |
| P8 / 0, 8 | `tests/unit/reviewer-search-export.test.js`; projection cases in P1/R1 | Export includes only selected/selectable DTOs, top-level/enrichment fallbacks, Scholar URL classification, filename fallback, create/revokeObjectURL and anchor cleanup, independent failure surface, duplicate-click behavior; §4 stale/export reproduction. Projection must preserve merge precedence and all readiness buckets with populated conflicting fixtures. |
| P9 / 10 | `tests/unit/reviewer-search-boundary.test.js` | AST check public exports, no cycle/back-import, no new server consumer of search/, no fetching in view modules, no new canonical key/prune/readiness implementation. Include synthetic invalid imports/calls to prove boundary detection, not a grep that always passes. |

P4 must keep existing tests that mock SSE, and supplement them with the real parser.
P7 adds `tests/unit/reviewer-search-http-contract.test.js` and, where needed,
`tests/fixtures/reviewer-search-http-contract.json` for synthetic shared envelopes.
The producer suite asserts current real handlers against the checked-in envelopes;
the consumer suite uses those same envelopes. Neither suite rewrites the oracle
while running. Freeze variable timestamps/IDs deliberately and assert omitted
JSON keys as well as present keys. P7 includes both ordinary save and applicant
promotion handlers and the roster GET snapshot used for recovery. Run existing
`tests/unit/save-candidates-service.test.js` and `tests/unit/reviewer-roster-endpoint.test.js`;
freeze JSON-serialized mixed-success/error envelopes from the actual handlers with
persistence/provider boundaries mocked, then feed those envelopes to the public UI.
Do not mock the save service in the producer contract test. Do not store real
contacts, tokens or receipts in fixtures. An owner-approved sanitized historical
DTO sample is useful at release; missing samples must be declared, not invented.

## 6. Stage execution cards

**Every stage below includes Gate G (§7), a fresh-context review (§8), a clean
stage commit, and a recorded rollback reference. No stage is accepted on scoped
unit tests alone. Prerequisite tests are before, not after, the move.**

### Stage 0 — Baseline, safety fixes and explicit dependency inventory

Prerequisite: authorized isolated branch/worktree, current instructions and source
baseline. Before any refactor, reproduce §4 items 1–5; land only the bounded fixes
with failing-before/passing-after evidence and separate commits. Characterize item
6 without changing it. Add P0–P2 for initial moves and export/lifecycle safety cases
now; remaining prerequisites land immediately before their extraction stages.

Create `docs/plans/REVIEWER_SEARCH_WORKSPACE_EXECUTION_2026-09-18.md` containing a
source-to-target symbol map and exact free-variable inventory for every planned
hook: props, state, setters, refs, derived values, sibling commands, returned names,
and effect/callback dependencies. Use AST-assisted capture analysis, then inspect
closures by hand. Explicitly include rosterNames for exclusion rollback and
unverified plus verifyAddressContact for identity confirmation. Reviewer compares
the proposed signatures to source, not a broad “state bag.” Map R/P requirements
to exact tests. Run G and all check gates; record outputs and corrected baseline.
Exit: all bounded defects resolved or disproved, inventory reviewed, baseline green.
Rollback: revert safety commits separately from tests/docs; no data rollback.

### Stage 1 — Card and local presentation leaves

Before: P0, R6, R1. Move leaves in §3 order; copy all imports they actually use,
including nested shared utility paths. Keep card-local hooks together. Preserve
old named exports by direct re-export and use the new card locally. Move private
InstitutionPresentationNotice with card, and IdentityDecision with primitives.
Keep exact CSS/copy/default props/ARIA. Exit: old import paths render and function
identity is stable; smoke-page import compiles. Rollback: restore definitions and
imports together. Do not remove facade exports in a later cleanup.

### Stage 2 — Workspace view slices

Before: P1, R2–R7. Extract existing JSX blocks in §3 order, wiring named values and
callbacks. Keep the outer search Card, manualAddSlot, handled Card and applicant
Card in the same rendered order; preserve conditional mounting and candidate keys.
SearchResults owns markup only; selection/modals/actions stay with controller owner.
Do not add wrapper DOM nodes just to pass props. Exit: populated and failure-state
composition matches, no new effects/fetches in views. Rollback: inline slices.

### Stage 3 — Roster reads and actions

Before: P3, P2, R3/R4/R5. Extract read callbacks first, then action callbacks. Keep
reset effect and all roster state in controller. Pass stable genRef, requestId and
specific setters. Action hook gets busy/removingPrevious and exact previousSearchRefs
with updatedAt, not just names. Preserve distinct optimistic rollback operations.
Exit: load gating, 409 reconciliation and awaited removal/search exclusion are
unchanged. Stage 0 regression protection must still pass.
Rollback: inline these callbacks; keep tests.

### Stage 4 — Discovery pipeline

Before: P4, R4/R5, P2. Move runSearch as one hook-owned callback with existing
refs, inputs, progress callback and setters. Preserve three transport handlers,
local result variables, all option fields, exclusion union, provenance stamping,
ranking and ineligible roster recording. Do not parallelize ordered phases or
replace SSE reader. Exit: every request payload/ordered call and result partition
matches baseline; current busy state lasts through POST. Stage 0 stream/ref regressions
must remain green. Rollback: inline runSearch.

### Stage 5 — Applicant enrichment

Before: P5, R4/R7. Move cache derivations, command, then auto-effect together;
return terminalApplicantKeys for display use. Use the accepted Stage 0 effect dependencies
and recRunningRef. Discovery and applicant processing remain separate lanes sharing
only the existing analysis snapshot, controller state and generation owner.
Exit: valid cache never repeats work, partial cache does, manual refresh remains
possible, handled rows do not become actionable. Rollback: inline this group.

### Stage 6 — Contact and identity operations

Before: P6, R3/R5/R6. Move local contact transforms first, then draft persistence,
address verify/review/retry/repair, lead handling, openIdentityConfirmation and
confirmIdentityContact. Keep editingContact/confirmingContact state in controller;
hoist both useState declarations above the contact-hook call before evaluating
setter arguments (the original declarations occur after other contact callbacks).
Pass existing set functions; preserve defaults and hook order after the move. Hook returns named commands used by modal bindings.
Do not deduplicate operations with different partial-success or exception behavior.
Exit: request payload order, authority fields, partial receipts and retry surfaces
match producer contracts. Rollback: inline group; no server receipt cleanup.

### Stage 7 — Promotion and refresh

Before: P7, R2/R3, real producer envelope checks. Move refreshExpiredVerification
then saveSelected in one module. Preserve savingRef generation token and finally
condition. All exact-key reconciliation branches stay explicit and in order;
applicant Promise.all behavior and ordinary save order stay unchanged. The browser
still never requests a saved roster transition. Exit: all-success, mixed, all-failed,
unknown-outcome and stale cases preserve exact cards, callback counts and retries.
Rollback: inline both functions together, never manually reset durable rows.

### Stage 8 — Export and display projection

Before: P8 plus R1/P1/P2. Extract export callback without payload changes. Extract
existing useMemo derivations into a projection hook, preserving dependencies and
merge order; ordinary synchronous derivations may stay synchronous. Keep Stage 1
thin candidate-key wrappers unchanged. Do not split existing
reviewer-search-logic or introduce new cache/version rules. Exit: remaining
facade workflow body owns state/reset/composition only, export failure does not replace search
error, all readiness and handled projections unchanged. Rollback: inline these groups.

### Stage 9 — Small controller composition last

Before: all P0–P8 and R1–R7, plus the accepted free-variable inventory. Move only
remaining state/ref declarations, reset/prefill effects, selection callbacks and
hook composition into useReviewerSearchController. Facade calls it once and keeps
public defaults/exports and Stage 2 rendering. Preserve Stage 0 lifecycle and
composition order in §3; do not create a reducer or a second generation owner.
Exit: all commands live in their operation modules; no new request loops, view
behavior or state lifetime changes. Rollback: inline the small composition body.

### Stage 10 — Boundary closure and release handoff

Before: P9 and all prior tests. Add ownership headers, update only documentation
that asserts changed internal ownership, and run scoped /sweep. Remove dead imports
and duplicate local definitions only after caller search. Re-export facade remains.
Verify operation modules import neither facade nor controller; server consumers
still use old helpers. Reject a controller containing the extracted operation bodies. Keep coherent complex operations whole rather than splitting
for a line-count score. Run G and release checks below. Exit: independently reviewed
candidate plus explicit release evidence/remaining limitations; no automatic merge.
Rollback: revert accepted stage commits in reverse dependency order or restore the
recorded pre-refactor revision via the normal reviewed release process.

## 7. Gate G, release and rollback

At every stage, execute serially in the implementation worktree:

```bash
# First run that stage's named test files with --runTestsByPath, then:
npm test -- --runInBand --silent
npm run lint
npm run check:types
# Once search/ exists; preserve zero NEW facade warnings versus baseline:
npx eslint shared/components/reviewers/search --rule 'react-hooks/exhaustive-deps:error'
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:reviewer-engagement-boundary && npm run check:reviewer-engagement-boundary:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run build
```

Add relevant gates if a planned boundary changes; do not silently widen source scope
to repair one. Stages 0 and 10 also run every currently defined check:* gate and its
self-test sequentially (enumerate package.json). Stage 10 runs the synthetic boundary
mutations. Build uses the canonical Next build; a sandbox process/port panic gets
one normal escalation retry per CI_GATES_REFERENCE. Webpack fallback is explicitly
weaker evidence and cannot be called a canonical green build. Record environment
failures distinctly from code failures. Record actual full build/full-suite results in the execution receipt; historical
planning checks in §9 do not establish an implementation pass.

**Branch drift check before every stage:** fetch origin, record feature HEAD and
origin/main, and compare upstream changes with the last reviewed baseline. If
main advanced, merge origin/main into the feature branch (never pull main while
checked out elsewhere, force-reset or rebase accepted stage history), inspect any
conflicts, run G and fresh Sol review before continuing. Coordinate overlapping
ownership if another agent touches these files; do not assume others are frozen.
Source line numbers in this plan never override current symbols.

Stages 1–2 form a useful independently releasable presentation-only group after
Stage 0. Later accepted stages also remain buildable rollback points. Owner release
approval is still required for any group; a partial milestone is not completion of
the full authorized task. Continue unless blocked or asked to pause.

**Release posture [PLANNED]: Tier 2 precaution**, given campaign-critical reviewer
mutations controlled by this UI. Verify the current campaign window at execution;
architecture cleanup waits if the release strategy forbids it. Stage commits stay
on the isolated branch; no stage auto-deploys. Record known-good commit/deployment
before promotion and rehearse rollback to it. Retain public entry points and no
schema migration so code rollback stays viable.

Before owner promotion, run a browser rehearsal against mocked request boundaries
for populated old and new implementations using identical fixtures: load/revisit,
search and partial stream failure, applicant cache/retry, all candidate dispositions,
contact rescue/partial failure, mixed save/unknown response/reconciliation, export,
rapid request/proposal switching, keyboard actions and manual-add slot. Check
console/hydration errors and unexpected network requests. No paid provider calls
or live state changes are necessary for this fixture rehearsal.

A later live rehearsal needs a concrete approved request/actor/action inventory,
provider budget if applicable, and before/after evidence. Local/Preview is not data
isolation. Do not run search, auto-enrichment, promote, exclude, repair, remove or
export against production merely to take screenshots. This plan authorizes no live
writes or sends. Release acceptance records mocked versus live coverage separately;
if required campaign rehearsal cannot run, promotion is blocked, not waived.

If a deployed refactor regresses workflow behavior, evaluate rollback first.
Code rollback does not undo saves or roster writes made by users/rehearsal. Inventory
those independently; no compensating data deletion is part of this refactor.

## 8. Fresh-context review interval and cheaper-model work order

**Planning has three acceptance checkpoints:** P-A scope selection, P-B dependency /
stage / test design, P-C final executable-document review. Each uses a newly spawned
read-only reviewer with `fork_turns: none`, no inherited deliberation and no edit
rights. At P-A give the scope brief/census and baseline (the plan document does not yet
exist); at P-B/P-C give repo path, baseline commit, document path/hash, checkpoint
and the review contract below. Reviewer reads source independently and cites contradictions.
A returning agent with the old conversation is not a fresh-context review.

**Implementation orchestration:** Luna performs reconnaissance, prerequisites,
implementation and builds. A newly spawned Sol (`gpt-5.6-sol`, `fork_turns: none`)
reviews each numbered stage and its next-stage prerequisites; root then accepts
or corrects it. Repeat the same procedure after every numbered stage
(including Stage 0) and after any material correction. Before starting the next
stage, a fresh reviewer rechecks the next stage's prerequisites against the actual
accepted code, not the original plan line numbers. New evidence that invalidates
scope returns to P-B. Do not reuse an earlier verdict after source changes.

Reviewer prompt template:

> Read-only review of CHECKPOINT/STAGE in DOCUMENT at BASELINE/DIFF_COMMIT.
> Ignore the implementer's confidence. Read AGENTS/CLAUDE and contract-reconcile.
> Use CodeGraph first, then source/callers/tests. Verify source-to-target symbol
> ownership, callers and facade exports, state/ref/effect lifetime, HTTP producer
> and consumer agreement, partial-success and unknown-outcome behavior, and each
> prerequisite test's actual failure sensitivity. Challenge one premise explicitly.
> Identify pre-existing defects separately from introduced changes. Check the
> excluded surfaces and proposed rollback. Return READY, READY WITH NAMED CHANGES,
> or NEEDS REWORK with file:line evidence, commands actually run, and untested limits.
> Do not edit files, call providers, perform live writes, or expand the migration.

Record checkpoint, document SHA-256/source commit, reviewer identity, reviewed
scope, findings, disposition, test commands, unresolved risks and verdict in the
implementation receipt. A changed plan portion must be re-reviewed; no automatic
approval by timeout. If fresh review is unavailable, mark the checkpoint pending
and stop dependent work; do not impersonate a fresh reviewer through a self-summary.
Ordinary subagent review is sufficient; no metered review product is authorized.

Limit any stage to two Luna correction rounds on material Sol findings. Root then
takes over unresolved changes or decides a documented nonblocking disposition;
Sol reviews material corrections freshly. Do not cycle on optional style changes,
and do not waive failed safety assertions. Root performs final diff/contract review
and can implement necessary corrections. All agent sessions use subscription OAuth;
no API keys or metered review-product substitution.

Work order for a cheaper implementing model:

1. Read this whole document and the prior stage receipt. Confirm owner execution
   authorization, branch, clean tree and unchanged baseline assumptions.
2. Read only current stage source, full functions, callers and listed tests using
   CodeGraph first. Do not infer a helper contract from its name.
3. Add missing prerequisite tests; run on unchanged implementation; commit green
   tests separately. Stage 0 safety failures follow the bounded fix protocol in §4; later failures
   stop the move for diagnosis, never silently alter behavior inside extraction.
4. Move the exact listed symbols with required imports, preserve exports and args.
   Keep public tests importing the facade. No cleanup of unrelated code.
5. Run stage tests and G; inspect complete diff for accidental policy/DTO changes.
6. Obtain fresh review, resolve findings, rerun affected checks, record receipt and
   commit accepted work. Continue only within authorized stage scope.

## 9. Historical planning evidence and review receipts

These receipts describe the original planning snapshots, before the owner authorized
implementation and the Opus corrections below. They are not current stage acceptance.

**P-A — scope review completed.** Fresh agent `/root/scope_review`, no inherited
conversation; baseline b400c97d. Verdict READY WITH NAMED CHANGES for UI-only scope,
NEEDS REWORK for combined UI/save-service scope. Applied: excluded backend changes,
acknowledged the prior performance deferral, preserved helper/public boundaries,
and added the §4 async defect ledger. Reviewer independently compared Admin,
Dynamics Explorer, adapter, Graph and Executor alternatives. No tests run by reviewer.

**P-B — completed with named corrections applied.** Fresh agent
`/root/design_review`, no inherited conversation; baseline b400c97d; reviewed
snapshot SHA-256 `d5b8e9ea39f02cb2c77bb4779f467966b5ed86fc6806d966dfe644a5c7c179e2`.
Verdict READY WITH NAMED CHANGES: move the three local constants with their view
consumers; characterize ordinary pre-response, post-response and applicant failure
recovery separately. Applied in §§3–5. Root also made candidateKeys' early move
unconditional and named the producer/consumer fixture files. Reviewer independently
ran history-controls and promotion-reconciliation: 2 suites / 35 tests passed.
P-C must recheck these corrections rather than inherit the verdict.
**P-C — READY as an executable planning document.** Fresh agent
`/root/final_plan_review`, no inherited conversation; baseline
`b400c97d8e5da8d72a5d146500d612a74bade1f8`; reviewed snapshot SHA-256
`4a91636513b2a1fd94199991abb4893c7741696a5a4f8f2446c042772a42bf77`.
Independently rechecked constant consumers, early key-wrapper move, controller
reset/effect order, distinct recovery paths, server helper consumers, and producer
fixture requirements. No blocking changes. Reviewer ran save-stale,
save-candidates-service and reviewer-roster-endpoint: 3 suites / 146 tests passed.
After that snapshot, only review/validation receipts and clarification that P-A
used a pre-document scope brief were added; executable migration instructions did
not change. Async gaps remain affected-stage prerequisites, not approved fixes.

[VERIFIED via commands this session] All startup check:* gates/self-tests passed,
including types. Focused behavior baseline: 13 suites / 214 tests passed using R1–R7
files enumerated above (the complete file list is the union of those rows).
The save-candidates-service and reviewer-roster-endpoint baseline also passed:
2 suites / 142 tests. Combined root-run baseline: 15 suites / 356 tests.
Documentation checks passed: doc-currency, docs-catalog, doc-symbol-refs,
build-claim-freshness, fact-consistency, canonical-pointers and harness-framing,
with their defined self-tests run sequentially. These gates have bounded scan
roots and do not validate the architectural claims in this plan.
These are existing tests; proposed P0–P9 additions were not implemented. No migration
source, runtime, configuration, API, schema or test file was changed by planning.

Contract-reconcile audits: whole flow traced through unchanged endpoints; partial
success/key conversion and async gaps explicitly covered; helper semantics frozen;
durable-surface additions are this plan only; schema/manifest/route-count/enum changes
N/A; consumer fan-out checked for default/named exports and server helper imports.
Scoped document reconciliation: new plan is PLANNED, prior performance deferral is
acknowledged and not rewritten as authorization, completed document refactor remains
historical context, Atlas/catalog ownership unchanged. No repository-wide truth-audit
or production readiness claim is made.

**Recommendation evidence:** present component and HTTP seams inspected; existing
regressions executed; disconfirming scope check found a prior deferral and rejected
backend inclusion. Extraction equivalence, added prerequisites, full build, full
suite, browser rehearsal and deployment remain NOT TESTED/PLANNED. Acceptance of
this document means usable planning guidance, not authorization or proof of a
successful migration.

## 10. Opus disposition and execution receipts

Claude Opus reviewed via subscription OAuth; the unmodified report is
`docs/audits/REVIEWER_SEARCH_WORKSPACE_OPUS_REVIEW_2026-09-18.md` (historical verdict:
READY WITH NAMED CHANGES). This revision adopts all seven recommendations: upfront
bounded defect fixes; per-stage branch synchronization; exact hook capture inventory;
controller-last ordering; early modal-state declarations; exhaustive-deps enforcement;
and independently useful presentation stages. No API or paid review product was used.

The owner subsequently authorized implementation with Luna → fresh Sol → root
acceptance. The execution receipt records the revised-plan review, stage commits,
rollback references, tested assumptions, failures, corrections and remaining release
limitations. Source has not changed merely because this plan was revised.
