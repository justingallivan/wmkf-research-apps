---
title: Reviewer roster save outcome and recovery plan — 2026-09-30
domain: reviewer-workflow
kind: plan
status: proposed
summary: Fix confirmed silent roster-save failures with per-candidate outcomes, authoritative reload, and save-only retry while preserving existing numeric store callers.
canonical: false
owner: product-engineering
related:
  - docs/plans/REFACTOR_CANDIDATES_SURVEY_2026-09-30.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Reviewer roster save outcome and recovery plan

## Outcome and scope

[PLANNED] Staff must be able to distinguish search results that will survive a reload from results whose save failed. Preserve the current result cards when persistence fails, show an accurate warning, and provide a save-only retry. Only the server's persisted roster may populate durable roster buckets and cross-run search exclusions. This fixes the investigated bug; it does not implement survey candidates C1/C2 or require those refactors first.

[VERIFIED via `git rev-parse HEAD` and `git branch --show-current`] Source baseline: `5ef28251d91100c2b050b3cbef92089e3f9d5c67`, branch `codex/refactor-survey`, worktree `/Users/gallivan/Code/WMKF_Apps-refactor`. This commit contains the survey; runtime source remains the surveyed `cd177c471` base. This document specifies future work. No runtime fix, schema change, production probe, or deployment has occurred as part of this plan.

[ASSUMED] The implementation is Tier 2 under the release strategy's cross-layer rule (§4), with approximately **14–22 engineering hours**, including retained regression tests and review, excluding owner rehearsal/release scheduling. This plan is Tier 0 documentation. Complete it as one bounded feature branch change and deliberately promote it; do not push runtime work directly to `main`.

[PLANNED] Change surface: the existing roster POST outcome contract and the Find panel's persistence/recovery behavior. Entry points: reviewer discovery autosave; singleton verification refresh before promotion; unverified-candidate identity rescue. Persistence: existing Postgres `reviewer_find_roster`; no new table, column, enum, migration, or localStorage. Consumers: Find cards, roster reload, cross-run exclusions, singleton POST callers, shared numeric store callers, tests and source-contract documentation. Prior finding: failed row writes can silently become apparent durable client state.

[PLANNED] Exclude email/ledger work, Factory B4, Dataverse adapter changes, identity/attestation policy, roster key derivation, cap/TTL policy, broad route extraction, archived-code removal and data cleanup. Preserve the other agents' worktree ownership. Recheck active ownership and source before implementation; this plan is not authorization to modify the other checkouts or reopen parked decisions.

## Verified failure and its limits

| Contract hop | Current evidence |
|---|---|
| Search → client results | [VERIFIED via shared/components/reviewers/search/useReviewerDiscovery.js:239, shared/components/reviewers/search/useReviewerDiscovery.js:247] Discovery deduplicates/ranks candidates and displays them before attempting roster persistence. |
| Request → auth/validation | [VERIFIED via pages/api/workbench/reviewer-roster.js:76, pages/api/workbench/reviewer-roster.js:81, pages/api/workbench/reviewer-roster.js:374] Existing 2 MB body limit, app access, GUID, candidate-array and 100-candidate limits apply. |
| Authority → store | [VERIFIED via pages/api/workbench/reviewer-roster.js:394, pages/api/workbench/reviewer-roster.js:230, pages/api/workbench/reviewer-roster.js:455] Server pruning, bound receipts and stored authority reconciliation precede writes. A failure in the preliminary roster read throws to the route's 500 handler. |
| Write → outcome | [VERIFIED via lib/services/reviewer-roster-store.js:112, lib/services/reviewer-roster-store.js:147, lib/services/reviewer-roster-store.js:162] Each insert/update is attempted separately; row errors are logged and swallowed; the returned value counts changed rows. |
| Outcome → response | [VERIFIED via pages/api/workbench/reviewer-roster.js:456] POST responds `200 { success: true, recorded }`, including when every row write failed. |
| Response → false local persistence | [VERIFIED via shared/components/reviewers/search/useReviewerDiscovery.js:272, shared/components/reviewers/search/useReviewerDiscovery.js:282] The client ignores the response body, merges every submitted candidate into roster state, adds every name to exclusions and clears the warning. |
| Next search / reload | [VERIFIED via shared/components/reviewers/search/useReviewerDiscovery.js:63, shared/components/reviewers/search/useReviewerRoster.js:23, shared/components/reviewers/search/useReviewerRoster.js:49] The next search excludes these names; reload replaces local roster buckets from the server snapshot. Unsaved candidates disappear. |

[VERIFIED via local fault-injection Jest runs on 2026-09-30] Five server cases exercised the real POST handler and store with mocked SQL: full success, all row writes failing, one of two failing, zero-row/no-exception result, and preflight-read failure. Four rendered-panel cases consumed the server-produced responses and exercised another search and remount. Results:

| Case | POST | Warning | Next-search exclusions | After reload |
|---|---|---|---|---|
| Two successful writes | 200, success true, recorded 2 | None | Both names | Both retained |
| Both row writes fail after preflight succeeds | 200, success true, recorded 0 | **None** | **Both names** | Neither retained |
| Second row write fails | 200, success true, recorded 1 | **None** | **Both names** | Only first retained |
| Preflight read fails | 500 | Shown | Neither name | Neither retained |

[VERIFIED via local Jest output] All nine characterization cases passed by asserting today's behavior, including the defect. The four existing suites `reviewer-roster-store`, `reviewer-roster-endpoint`, `use-reviewer-discovery-t4-matrix`, and `reviewer-search-roster-contract` also passed: **111 tests**. Temporary investigation artifacts were placed outside the repository; they are not a durable test dependency. Implementation must retain the reproduction as ordinary repository regression tests with corrected expectations.

[ASSUMED] Production incidence/frequency remains unknown. The reproduction mocked authentication, attestation verification, database outcomes and upstream search streams; it did not execute actual Postgres conflict semantics or live external writes. “Any database outage does this” is too broad: the preflight-read failure correctly returns 500. A mocked zero-row result establishes count ambiguity, not a real curated-incumbent integration test.

## Invariants

[PLANNED] These are acceptance requirements, not claims of existing protection.

| Invariant | Implementation boundary | Required proof |
|---|---|---|
| Failed writes never become newly persisted client rows or exclusion names | Store → POST → discovery → roster reload | Mixed/all-failed batch, next search and remount tests |
| Failed results remain visible and recoverable without another provider search | Discovery transient state and results controls | Save-only retry invokes no analyze/discover/enrich request |
| A no-op is not automatically a database failure | Store outcome + server reload | Terminal curation and lost-CAS fixtures preserve the incumbent |
| A successful write is not a permanent retention guarantee | Cap followed by authoritative read | Eviction/concurrent removal does not leave phantom durable rows |
| Name matching never substitutes for candidate-key acknowledgement | Response correlation and client parser | Same-name/different-key and server-rebound-key tests |
| Auth, receipts, stored authority and promotion gates remain authoritative | Existing route preprocessing and consumers | Forged/missing/stale receipt and cross-request tests remain green |
| Context changes invalidate every late outcome | Generation checks and save operation ownership | Request/blob change, unmount and out-of-order success/error tests |
| Existing store callers still receive a number | Compatibility wrapper | Address-trust/enrichment tests and direct return-type assertions |
| Roster outcome metadata never becomes stored identity authority | API-only outcome objects | No outcome field written into candidate JSON or used to relax a save gate |

## Proposed contract

### 1. Preserve the numeric store API; expose detailed outcomes separately

[VERIFIED via `codegraph explore "recordSurfaced"`] CodeGraph displays six callers, including the route, address-trust service and applicant enrichment. [VERIFIED via lib/services/reviewer-address-trust-service.js:861, lib/services/reviewer-address-trust-service.js:1137, lib/services/workbench/enrich-recommended-service.js:443] Existing direct consumers compare or add the numeric result. Replacing it wholesale with an object would break them.

[PLANNED] Add `recordSurfacedDetailed` (new symbol) in the existing store and make `recordSurfaced` a compatibility wrapper returning its `.recorded`. There must be one write implementation, not two SQL copies or two execution passes. Preserve ordering, SQL guards, measurements, collector ownership and cap enforcement. The detailed path reports one result for every input item, including invalid/skipped input. Preserve actual per-row partial success; do not introduce a transaction around the batch as an incidental change.

[PLANNED] Outcome vocabulary is API-only and exhaustive:

| `outcome` | Meaning | Client treatment |
|---|---|---|
| `written` | SQL reported a changed row | Reconcile through the roster read before claiming current retention |
| `unchanged` | SQL completed with zero changed rows | Read current state; never assume it is active, lost, or a DB error |
| `failed` | The row write raised an error | Keep display result transient; show warning; allow deliberate save retry |
| `invalid` | Input cannot identify a valid recordable candidate | Show a bounded problem; do not silently count it as saved or automatically retry it |

[VERIFIED via lib/services/reviewer-roster-store.js:111, lib/services/reviewer-roster-store.js:135, lib/services/reviewer-roster-store.js:232] Invalid names/keys, terminal curation, CAS misses and cap eviction are distinct mechanisms. [PLANNED] Do not invent a specific “curation” versus “stale” reason from `rowCount: 0`; use the read path for current disposition. Only a thrown write error is `failed`. Report measurement/cap failures through their existing channels; they must not relabel an already committed row write as failed. The post-write read determines what is still retained after cleanup.

### 2. Add a bounded per-input result to POST

[PLANNED] Preserve the current initial-save request body and all validation/authority processing. Add only an optional restrictive retry field `writeMode: "insert_missing"`; reject any other supplied mode. It can prevent conflict updates, never bypass validation, receipts or existing curation guards. Preserve original input positions while pruning/filtering so no blank item silently disappears from the outcome list. Map detailed-store results back to those positions after server key binding. Proposed response (new fields and enum values are not implemented):

```json
{
  "success": false,
  "recorded": 1,
  "outcomeVersion": 1,
  "results": [
    { "inputIndex": 0, "candidateKey": "server-derived-key-A", "existingAtAttempt": false, "outcome": "written" },
    { "inputIndex": 1, "candidateKey": "server-derived-key-B", "existingAtAttempt": false, "outcome": "failed", "code": "roster_write_failed" }
  ],
  "error": "Some search results could not be saved."
}
```

[PLANNED] The illustrated keys are placeholders, not existing identifiers. `candidateKey` is the post-validation server key; invalid items may have `null`. `inputIndex` correlates to the request array and is never an authorization credential. `existingAtAttempt` is a server-derived boolean from the authority preflight for that final key (null for invalid input); retain it with a failed item so a later deletion cannot turn an existing-row refresh into an insertion retry. Missing classification disables write retry. It is a recovery hint, not identity or write authority; the restrictive retry mode still prevents conflict updates in SQL. Keep `recorded` equal to the changed-row total for old callers. `success` is false when any result is `failed` or `invalid`; all `written`/`unchanged` results may return true, but that boolean alone does not assert retention. Empty input returns zero and an empty complete result list. HTTP 200 means the bounded batch was processed and its item outcomes are available; existing 400/auth/method errors and unexpected preflight 500 behavior remain unchanged. No raw SQL messages, receipts or candidate payloads in error details.

[PLANNED] The new discovery consumer must inspect outcomes even on HTTP 200. Require the known version, one result per submitted input index, valid index bounds, known outcomes, valid attempt classification and a nonempty server key for valid items; reject missing/duplicate indices, unknown outcomes and malformed bodies as **unconfirmed**, not saved. Do not deduplicate the result list by name or assume output order. Same-key duplicate inputs still receive separate positional outcomes. Strictly parsed outcomes describe attempts; the subsequent authoritative read describes current state.

### 3. Reconcile persisted state through the existing GET

[VERIFIED via pages/api/workbench/reviewer-roster.js:345, shared/components/reviewers/search/useReviewerRoster.js:49] The existing GET reads Postgres, applies the Dataverse engagement overlay under DAL context and returns the roster; `reloadRoster(expectedGeneration)` applies it with a generation guard. [PLANNED] Pass this existing command into discovery rather than adding another roster endpoint or duplicating the engagement overlay in POST.

[VERIFIED via lib/services/reviewer-roster-store.js:874, lib/services/reviewer-roster-store.js:891] The current GET projection is not a complete key inventory: `coi_dropped` contributes names only, and `savedKeys` omits non-suggestion-keyed saved rows. [PLANNED] Add an additive read-only `retention: { version: 1, rows: [{ candidateKey, status }] }` projection from every row returned by the same request-scoped Postgres read. Use existing persisted statuses; include saved and COI-ledger keys without exposing their candidate blobs or making those rows actionable. Carry the inventory through engagement reconciliation and the client snapshot. Dataverse `handled` projection takes precedence over an underlying active status for rendering/actions. Preserve existing `savedKeys` semantics. Missing, malformed or unknown retention metadata cannot prove absence. Include the shared `rosterFromRows` removal-response consumer in regression tests, since the additive field also passes through that snapshot path.

[PLANNED] After the POST settles, reload once before marking results retained. Replace durable buckets and `rosterNames` from that snapshot; remove discovery's unconditional append of submitted candidates/names. Include `ineligible`: its early local insertion at `useReviewerDiscovery.js:248` must become transient display state rather than an unacknowledged durable bucket. Keep the existing nonselectable deceased-evidence behavior while correcting persistence bookkeeping.

[PLANNED] Match current records with server-returned keys, preserving any key rebinding in subsequent actions. Curation, handled engagement and saved state in the snapshot win over transient cards: a current terminal/read-only row must not be painted as an active selectable duplicate. An absent item stays transient, even if its write originally reported `written` (for example, it was subsequently removed or cap-evicted). A failed refresh of an existing key does not erase the known persisted incumbent or claim that its old payload was updated. Keep newer local evidence separate from the acknowledged server projection. [VERIFIED via shared/components/reviewers/search/useReviewerSearchProjection.js:61] The current display merge puts transient candidates ahead of durable candidates. [PLANNED] Change this exact persistence-aware projection so the authoritative key/disposition wins for acknowledged or conflicted keys; retain unaffected applicant-lane behavior. Merely replacing the roster arrays is insufficient.

[PLANNED] If the POST response is lost/malformed, attempt the read before any retry. Without trustworthy result-to-key correlation, retain an unconfirmed state instead of guessing by name. If a successful read still cannot restore correlation, offer **Use saved results**: explicitly discard the unmatched transient details and adopt the server snapshot. Explain that those unmatched details may be lost; require that deliberate action, never auto-discard them. Do not promise that repeatedly checking will recover missing correlation. No write retry is enabled for such unmatched items. If GET fails, preserve the last verified roster, retain transient results, show “Couldn't confirm which results were saved. Retry checking before leaving this page.” Block new roster-dependent operations until the existing reconciliation command succeeds; do not add guessed names or overwrite known buckets. A committed POST followed by a failed GET is an uncertain read outcome, not proof that the write failed.

### 4. Make failure and recovery visible

[PLANNED] Add a small current-search persistence state in the controller: pending/unconfirmed items keyed by original correlation plus acknowledged server key where available, a save/reconcile-in-flight flag, and a summary. It is memory-only and reset on request/blob context change and unmount. Failed results remain visible in the current results area with a “Not saved to this request” indicator; unconfirmed results use “Save not confirmed.” These labels describe roster retention, not identity readiness or promotion success.

[PLANNED] For a partial failure, show counts derived from the outcomes and read, for example: “1 of 2 results wasn't saved. Keep this page open and retry saving.” For definite failure with a successful read, offer **Retry saving results**; for an uncertain/read failure offer **Retry checking saves**. Reuse the existing result-note area; do not build a notification framework or background job. Starting a new search replaces current transient results as it does today; the warning must explicitly say that unsaved results will be lost on reload or a new search. Retry is available before doing so.

[PLANNED] A retry first obtains a current snapshot, then submits only unresolved, valid candidates absent from authoritative retention and not blocked by an incumbent terminal state. If an exact key already exists, adopt that authoritative row and remove it from the automatic replay set; a prior failed refresh must not be advertised as having saved the new details. Show “This result is retained, but the latest details were not saved; review the current card.” Use the existing explicit verification/contact action to refresh it. Ambiguous key correlation stays unconfirmed and requires refresh, rather than guessing success. Reuse POST's pruning/receipts, preserve candidate keys, and re-read after writes. For save-only retry POSTs, send `writeMode: "insert_missing"`. The server forces its existing `expectedUpdatedAt: null` conflict guard for that detailed write; if another tab inserts/edits the key after the read, the conflict produces `unchanged`, followed by reconciliation. No client timestamp or write-authority flag is accepted. This preserves the numeric wrapper and normal initial POST semantics while preventing the new retry from replaying an old DTO over any existing row. A failed refresh of a pre-existing row is never eligible for automatic replay, even if a later read finds it absent; retain that attempt classification and require the explicit existing recovery action. No analysis, discovery, enrichment, provider call or automatic retry loop. Serialize retries with search/removal/promotion; disable duplicate clicks while pending. Preserve selection for unaffected candidates. Clearing a warning requires actual acknowledgement/reconciliation, not merely a fulfilled HTTP promise.

[PLANNED] Every post-await success, failure, pending cleanup and retry uses the captured request generation. Preserve `runningRef` ownership; a prior operation's `finally` may not unlock the new request. Roster reloads also need operation ordering within one generation: serialize mutations and invalidate any older pending read when a newer persistence/reconciliation command starts. Context guards alone do not protect same-request out-of-order responses.

## Sibling consumers and bounded file scope

[VERIFIED via `rg -n "reviewer-roster|recordSurfaced" shared/components/reviewers/search lib/services pages/api/workbench/reviewer-roster.js` after CodeGraph] The current browser POST consumers are discovery, promotion verification refresh, and identity rescue. Other roster requests in these hooks are GET/PATCH. Re-run the census on the implementation head.

| Surface | Planned treatment |
|---|---|
| `lib/services/reviewer-roster-store.js` | Add detailed worker, preserve numeric wrapper and existing SQL guards; add complete retained-key/status read projection |
| `pages/api/workbench/reviewer-roster.js` | Add positional detailed POST results and restrictive insert-missing retry mode after existing authority validation; carry additive GET retention metadata; preserve PATCH policy |
| `useReviewerDiscovery.js`, `useReviewerSearchController.js`, `useReviewerRoster.js` under `shared/components/reviewers/search/` | Explicit save/reconcile state, authoritative durable projection, retry command and operation guards |
| `shared/components/reviewers/search/useReviewerSearchProjection.js` | Make authoritative per-key persistence/disposition win over conflicting transient payloads; preserve unaffected applicant rendering |
| `SearchResults.js`, `CandidateCard.js`, `shared/components/reviewers/ReviewerSearchSection.js` | Wire narrowly scoped persistence summary/action/indicators where existing rendering requires them; avoid general component extraction |
| `shared/components/reviewers/search/useReviewerPromotion.js` | Preserve current singleton acknowledgement invariant; consume detailed success and exact returned key before continuing; no batch optimization |
| `shared/components/reviewers/search/useReviewerContactActions.js` | Identity rescue must not issue confirm-identity PATCH after failed/invalid/unconfirmed prerequisite POST; preserve active-row and current-key checks |
| Address-trust and applicant-enrichment services | Keep numeric store calls and current semantics; regression-test, but do not broaden this fix into their workflows |

[VERIFIED via shared/components/reviewers/search/useReviewerPromotion.js:107, shared/components/reviewers/search/useReviewerPromotion.js:127] Promotion already requires singleton `recorded === 1`, unlike discovery. [VERIFIED via shared/components/reviewers/search/useReviewerContactActions.js:308] Rescue currently tests only HTTP/body success before PATCH. [PLANNED] Share a small response validator only if needed by these consumers; it must validate correlation/outcomes, not combine their different authority or recovery policies. Preserve the numeric count check as an additional compatibility assertion. An `unchanged` rescue result requires a current exact active roster row before proceeding, not permission to reactivate a curated row.

## Implementation sequence and tests

[PLANNED] Implement in this order; each stage keeps the branch reviewable:

1. **Retain red regression tests (2–3 h).** Convert the temporary reproduction into repository route/store and rendered-panel tests. Inject a specific INSERT failure after successful authority reads. Assert the desired warning, accurate exclusions and reload behavior so tests fail on this source baseline. Retain preflight-failure and full-success controls.
2. **Detailed store and route contract (3–4 h).** Add the worker/wrapper and positional outcomes, preserve all existing guards, and test numeric callers. Tests must distinguish changed rows, guarded zero-row results, invalid input and exceptions. No public enum is persisted.
3. **Client reconciliation and save-only retry (5–8 h).** Wire the existing GET, transient indicators, serialized recovery and sibling POST validation. Exercise actual rendered controls and capture outgoing requests, not source-string assertions.
4. **Review, integration checks and durable contract updates (4–7 h).** Run the matrix below, relevant gates/self-tests, fresh contract review, focused documentation sweep, and isolated browser rehearsal. Resolve every failed required check before proposing promotion.

[PLANNED] Minimum behavioral matrix:

| Scenario | Required assertion |
|---|---|
| Full success | Correct retained cards, no warning, names excluded on next run, same state after reload |
| All writes fail / one fails / first fails | Failed identities remain transient; accurate warning and retry subset; only server-retained names enter dedup |
| No-op for excluded/saved/blocked/coi_dropped/ineligible incumbent | Complete key inventory includes COI-ledger and non-anchored saved rows; preserve server disposition and monotonic eligibility; no reactivation or false DB-failure diagnosis |
| CAS miss / concurrent staff edit | Keep current incumbent and authority; retry insert-missing cannot update a row that appeared after the read; never replay a failed existing-row refresh |
| Invalid/blank item among valid items | Complete positional accounting; valid writes not misattributed; invalid item visibly unresolved |
| Same name with different keys, duplicate input keys, server key rebinding | No name-based acknowledgement; complete indices; follow-up mutations use the correct server key |
| Cap eviction / concurrent removal after a successful write | Absent rows are not claimed retained or added from stale POST payloads |
| POST timeout after commit, malformed 2xx, missing/unknown version/outcome | Reconcile first; never manufacture success or automatically rerun the batch; lost key correlation terminates through deliberate Use saved results, never a name match or endless checking loop |
| GET fails after successful/partial POST | Warning says confirmation is unavailable; last verified roster stays intact; checking retry does not rerun providers |
| Retry after partial failure; double-click | Only eligible unresolved rows attempted; one in-flight operation; no analyze/discover/enrich traffic |
| Request/blob change, unmount, older GET completing late | No stale card/name/warning/selection/in-flight changes in the newer context |
| Deceased result with failed save | Remains read-only transient; never becomes a selectable active row or false durable ineligible row |
| Rescue and promotion singleton callers | No dependent PATCH/promotion after failed or unconfirmed prerequisite save; existing authority checks retained |
| Numeric wrapper + telemetry failure | Existing return type/count preserved; measurement failure does not reverse acknowledged roster write |

[PLANNED] Extend existing suites rather than add a parallel harness: `tests/unit/reviewer-roster-store.test.js`, `tests/unit/reviewer-roster-endpoint.test.js`, `tests/unit/use-reviewer-discovery-t4-matrix.test.js`, `tests/unit/reviewer-search-roster-contract.test.js`, `tests/unit/use-reviewer-roster-t4-matrix.test.js`, `tests/unit/reviewer-search-context-lifecycle.test.js`, `tests/unit/reviewer-search-unverified-rescue.test.js`, `tests/unit/use-reviewer-contact-actions.test.js`, `tests/unit/use-reviewer-promotion-t4-matrix.test.js`, and `tests/unit/reviewer-search-section-save-stale.test.js`. Run `reviewer-address-trust-service`, `workbench-enrich-recommended-service`, `workbench-reviewer-roster-projection-service`, `reviewer-search-logic` and `reviewer-search-boundary` suites as targeted shared-contract checks. Match exact files against the implementation tree before invoking them.

[PLANNED] SQL mocks cannot prove actual conflict/curation/CAS behavior. Add a test using an isolated disposable Postgres fixture for those guards and post-write reads, following the repository's existing test isolation conventions. Never use this worktree's absent `.env.local` as a reason to borrow another agent's credentials or database. Credential-dependent integration/rehearsal reports **skipped** until an isolated target is available; it remains a release prerequisite, not a pass. Keep fast mocked tests runnable without credentials.

[VERIFIED via package.json script inventory] Relevant existing gates include `check:types`, `check:api-routes`, `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:dynamics-context-boundary`, `check:reviewer-engagement-boundary`, `check:status-enum-parity`, `check:atlas`, `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:docs-catalog`, `check:harness-framing`, and `check:secret-scan`. [PLANNED] Run each applicable gate and its available `:self-test` sequentially, using `npm run check:types -- --incremental false` to avoid an unrelated build artifact. Structural gates do not prove per-item persistence or UI honesty: the behavioral and isolated-Postgres tests are load-bearing.

## Documentation, rollout and rollback

[PLANNED] During implementation, update the store header/catalog entry, Atlas write/read contract and relevant roster memory to describe the actual new API and recovery behavior; use `/sweep` for this bounded fact change. Do not claim a repository-wide reconciliation. No route count, schema manifest, persisted status inventory or authentication matrix addition is expected because no new route/table/status is planned; existing gates must confirm that assumption. Keep this plan marked proposed until the implementation and its evidence exist, then replace status/summary/body consistently.

[STALE/CONFLICT via docs/atlas/postgres-reviewer-find-roster.md:227 and `rg -n 'recordSurfacedWithStageEvidence' lib/services/reviewer-roster-store.js`] The Atlas describes a stage-evidence writer that is absent from the pinned store. The inspected route uses the count-only `recordSurfaced`. Do not design this bug fix around that prose-only API or build an unrelated stage-evidence migration to make it true. Revalidate the implementation head and flag any newer runtime contract before coding. The broad Atlas discrepancy is outside this plan's document-only change; reconcile the narrow touched contract during implementation without converting historical deployment prose into a current claim.

[PLANNED] Deliver the server contract and client handling together. The new client fails visibly on a legacy/malformed response and attempts safe reconciliation; old open clients can still ignore a richer response, so staff must reload the application after deployment. Rehearse full success, partial failure and save-only recovery with isolated browser/API mocks, then the approved isolated integration target. Record the last-known-good deployment and exact implementation commit. Obtain the release strategy's owner decision before merge/push to `main`; current campaign timing is not assumed.

[PLANNED] Rollback reverts the application change; no schema rollback or deletion is needed. Already persisted roster rows remain valid under the unchanged numeric/SQL contract. Reversion restores the old silent-failure risk, so communicate that limitation and have staff reload. Never “repair” historical uncertainty by replaying searches, deleting roster rows, or sending invitations. This bug's incidence cannot be reconstructed from the mocked evidence alone.

## Review evidence and exit criteria

[PLANNED] `/contract-reconcile` audits: whole-flow and partial-success are covered above; async review covers context and same-context ordering; helper review preserves numeric semantics and authority; durable-surface review confirms no schema/enum expansion; document reconciliation is a future bounded sweep; symbol fan-out covers all POST consumers and the numeric store callers. No new persistent status value is allowed. External sends, migration and destructive-cleanup audits are N/A to this change.

| Recommendation | Verified prerequisite | Evidence tested / disconfirming check | Status |
|---|---|---|---|
| Per-item outcomes instead of count-only inference | Per-row loop and count-only response exist | Injected mixed/all-failed writes reproduced false success; preflight failure did not | [PLANNED] Fix design; implementation not tested |
| Authoritative GET before durable-state updates | Guarded reload/engagement-aware GET exist; complete retention-key metadata must be added | Rendered-panel remount removed unsaved rows; success control retained both | [PLANNED] Additional in-flight reconciliation not yet implemented |
| Preserve numeric wrapper | Direct callers compare/add the count | Caller source inspected; existing store/route suites pass | [PLANNED] New wrapper compatibility must be tested |
| Save-only retry and sibling guards | Current POST is bounded; promotion already checks singleton count | No retry implementation tested; duplicate-click, lost-response and stale-incumbent cases can disconfirm safety | [PLANNED] Required tests before release |

[PLANNED] Acceptance: all failed result rows are visibly unsaved/unconfirmed, remain available until staff explicitly replace/leave the current search, and never become falsely retained/deduped. Persisted rows survive reload; curated rows keep their status; retry performs no provider search; no dependent action proceeds on false acknowledgement; all applicable tests/gates and isolated rehearsal pass. Independent review must explicitly check the response complement, lost-response recovery and terminal-curation cases. A plan or a green source-scanning gate alone is not implementation evidence.

[VERIFIED via fresh read-only contract review of this plan] Review identified missing terminal-key visibility, transient-first rendering, ambiguous existing-row retry and lost-correlation recovery. The revised proposal above explicitly addresses all four; these are design changes, not tested runtime behavior.

[VERIFIED via the investigation described above] Current verdict: the bug is reproduced in isolated tests; production frequency is unknown. [PLANNED] This is the bounded implementation proposal, not a completed fix or production release approval.
