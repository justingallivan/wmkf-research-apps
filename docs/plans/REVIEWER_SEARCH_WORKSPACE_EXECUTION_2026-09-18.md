---
title: Reviewer Search Workspace Decomposition Execution Receipt
domain: reviewers
kind: execution-receipt
status: active
summary: Staged ReviewerSearchSection decomposition inventory, prerequisite coverage, and implementation acceptance evidence.
canonical: false
owner: product-engineering
related:
  - docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md
  - docs/audits/REVIEWER_SEARCH_WORKSPACE_OPUS_REVIEW_2026-09-18.md
---

# Reviewer Search Workspace Execution Receipt

## Scope and status

**Change surface:** component-local decomposition of
`shared/components/reviewers/ReviewerSearchSection.js` into presentation leaves,
operation hooks, projection, and a small composition controller. The public facade,
HTTP payloads, persistence, identity policy, and server helper boundaries remain
fixed.

**Entry points:** `shared/components/reviewers/ReviewerSearchSection.js`, its
`ReviewerFindPanel` caller, the institution-stage2 smoke page, and the existing
reviewer unit suites.

**Persistence:** none introduced or migrated. Existing Postgres working-roster and
Dataverse writes remain behind the existing HTTP routes.

**Consumers:** Find workspace cards and modals, Invite/Track callbacks, the smoke
page, named facade exports, and the existing unit/gate surfaces.

**Prior findings being verified:** the plan's §4 stale progress, optimistic rollback,
export lifecycle, ref cleanup, refresh-loop, and unknown-outcome entries; the Opus
review's free-variable, controller-order, and Stage 0 disposition findings.

**Execution status [VERIFIED via command]:** worktree
`/private/tmp/wmkf-reviewer-search`, branch `codex/reviewer-search-decomposition`,
source baseline `71d36f37`. `npm ci` completed without changing `package.json` or
`package-lock.json`; `.agents/skills` is a symlink to `../.claude/skills`. No live
provider or external-state call was made. Stages 0–6 are accepted; later stages remain planned. Stage receipts below distinguish completed evidence
from historical checkpoints.

## Source-to-target map

The following map was derived from the pre-extraction source symbols and
AST-assisted capture analysis, then checked against the function bodies. Line
numbers refer to that baseline; stage receipts record completed moves. Symbol
ownership controls implementation.

| Stage | Target | Current symbols / source region | Return or ownership contract |
|---|---|---|---|
| 1 | `search/candidateKeys.js`, `presentation.js`, `SearchPrimitives.js`, `IdentityComparisonPanel.js`, `CandidateCard.js` | `candKey`, `dedupeByName`, `isApplicantOriginCandidate` (`267–281`); message/label helpers (`121–130`, `283–338`); primitives (`132–170`); comparison constant/panel (`107–265`); institution notice and `CandidateCard` (`340–1269`) | Preserve direct facade exports for `CandidateCard` and `addressTrustFailureMessage`; preserve delegated key/provenance behavior. |
| 2 | `search/SearchControls.js`, `SearchResults.js`, `SearchContactModals.js`, `HandledReviewers.js`, `ApplicantReviewerStatus.js` | Existing JSX blocks (`3063–3763`), including `SEARCH_SOURCES` and `BLOCKED_REFERRAL_REASON` | Markup-only leaves. They receive named props and commands; they do not fetch or own workflow state. |
| 3 | `search/useReviewerRoster.js` | `applyRosterSnapshot` (`1369`), `reloadRoster` (`1385`), `retryRosterLoad` (`1444`) | Returns `{ applyRosterSnapshot, reloadRoster, retryRosterLoad }`; reset effect and roster state remain with the composition owner until Stage 9. |
| 3 | `search/useReviewerRosterActions.js` | `excludeCandidate` (`1926`), `excludeUnverifiedCandidate` (`1956`), `promoteCandidate` (`1980`), `removePreviousResults` (`2018`) | Returns the four commands. Preserve separate rollback semantics and exact `previousSearchRefs` with `updatedAt`. |
| 4 | `search/useReviewerDiscovery.js` | `runSearch` (`1476–1728`) | Returns `{ runSearch }`; ordered SSE phases, local result variables, awaited roster POST, and partial transport handling remain intact. |
| 5 | `search/useApplicantReviewerEnrichment.js` | `enrichRecommended` (`1734–1777`), terminal/cache derivations (`1783–1807`) | Returns `{ enrichRecommended, terminalApplicantKeys, actionableRecommended, haveValidCache }`; owns the applicant auto-effect and its exact dependency list. |
| 6 | `search/useReviewerContactActions.js` | `setManualContact` (`2068–2116`), `applyAuthoritativeRosterCandidate` (`2118–2124`), `persistManualContact` (`2126–2161`), address/identity commands (`2163–2393`) | Returns named contact/remediation commands. `applyAuthoritativeRosterCandidate` is an internal helper. Modal state remains composition-owned and is hoisted before hook evaluation. |
| 7 | `search/useReviewerPromotion.js` | `refreshExpiredVerification` (`2395–2485`), `saveSelected` (`2487–2950`) | Returns `{ refreshExpiredVerification, saveSelected }`; preserves ordinary/applicant endpoint differences, exact result correlation, and generation token. |
| 8 | `search/useReviewerExport.js` | `exportSelected` (`2956–3017`) | Returns `{ exportSelected }`; preserves DTO construction, object URL/download cleanup, and independent export error state. |
| 8 | `search/useReviewerSearchProjection.js` | roster/run merge and handled derivations (`1814–1911`), readiness/count projections (`3021–3058`) | Returns display/handled/COI/unverified/readiness/count projections; no new key, cache, or readiness policy. |
| 9 | `search/useReviewerSearchController.js` | Remaining state/ref declarations (`1292–1367`), reset/prefill effects (`1399–1470`), selection callbacks (`1913–1921`), hook composition and view prop assembly | Owns the one generation/ref lifecycle and all state. Returns the named view props, derived values, and operation commands required by Stage 2 views. It must not contain extracted operation bodies. |

## Exact free-variable inventory

The lists below name the values a hook must receive or import. `state` means a
read value, `setter` a React state setter, `ref` a mutable ref, `derived` a value
computed by another hook/controller, `command` a sibling callback, and `module` an
existing import or module constant. Browser globals (`fetch`, `window`, `document`,
`URL`, built-ins, and `Error`) remain ambient globals and are not state inputs.

### `useReviewerRoster`

- `applyRosterSnapshot`: setters `setRosterActive`, `setRosterExcluded`,
  `setRosterIneligible`, `setRosterBlocked`, `setRosterHandled`,
  `setRosterSavedKeys`, `setRosterNames`, `setRepairRequestsByCandidateKey`,
  `setRepairRequestsUnavailable`; returns nothing.
- `reloadRoster`: prop `requestId`; ref `genRef`; command `applyRosterSnapshot`;
  returns `null` for no request, stale generation, or failed response, otherwise
  the decoded `data` object.
- `retryRosterLoad`: ref `genRef`; command `reloadRoster`; setters
  `setRosterLoaded`, `setRosterLoadFailed`, `setRosterNote`; returns undefined.
- Module/global dependencies: `encodeURIComponent`, `fetch`, `Array`, `Object`.

### `useReviewerRosterActions`

- `excludeCandidate`: prop `requestId`; ref `genRef`; setters `setCandidates`,
  `setRecCandidates`, `setRosterActive`, `setRosterExcluded`, `setRosterNames`,
  `setSelected`, `setRosterNote`; modules `candKey`, `dedupeByName`,
  `pruneCandidateForRoster`; returns undefined. Stage 0 adds a captured generation
  and guards the catch rollback.
- `excludeUnverifiedCandidate`: prop `requestId`; state `rosterNames`; ref `genRef`;
  setters `setRosterExcluded`, `setRosterNames`, `setRosterNote`; same modules; returns
  undefined. Its failure path must never restore the ephemeral row to active.
- `promoteCandidate`: prop `requestId`; ref `genRef`; command `reloadRoster`; setters
  `setRosterActive`, `setRosterExcluded`, `setRosterNote`; modules `candKey`,
  `dedupeByName`; returns undefined. The existing generation/409 reload branches
  remain explicit.
- `removePreviousResults`: prop `requestId`; state `busy`, `removingPrevious`;
  derived `previousSearchKeys`, `previousSearchRefs`; ref `genRef`; setters
  `setRemovingPrevious`, `setRosterActive`, `setRosterExcluded`,
  `setRosterIneligible`, `setRosterBlocked`, `setRosterHandled`,
  `setRosterSavedKeys`, `setRosterNames`, `setSelected`, `setRosterNote`; returns
  undefined. `window.confirm` and the `updatedAt` references remain unchanged.
- Shared module/global dependencies: `candKey`, `dedupeByName`, `pruneCandidateForRoster`,
  `fetch`, `JSON`, `Array`, `Set`, `Error`, and `window`.

### `useReviewerDiscovery`

`runSearch` closes over props `blobUrl`, `requestId`; state
`excludeText`, `rosterNames`, `rosterLoaded`, `removingPrevious`, `searchSources`,
`reviewerCount`, `additionalNotes`, `referredSeedsText`, and `referredBy`;
derived `savedPoolNames` and `noSourcesSelected`; refs `runningRef` and `genRef`;
command `pushProgress`; setters `setPhase`, `setError`, `setErrorMeta`,
`setProgress`, `setCandidates`, `setUnverified`, `setIdentityComparison`,
`setSelected`, `setPromotionNotice`, `setEnrichNote`, `setAnalysis`,
`setExcludedRemoved`, `setExportError`, `setBlockedReferredSeeds`,
`setRosterActive`, `setRosterIneligible`, `setRosterNames`, `setRosterNote`.

Module dependencies are `parseExcludeList`, `parseReferredSeeds`, `filterExcluded`,
`readSseStream`, `mergeEnrichment`, `rankByRelevance`, `withReviewerCandidateKey`,
`withReviewerProvenance`, `pruneCandidateForRoster`, and `dedupeByName`. It returns
undefined on all paths; early returns are part of the stale-generation contract.
The Stage 0 progress guard must cover SSE progress and the fallback messages after
analysis/discovery/enrichment transport errors (`1514`, `1529`, `1573`, `1586`,
`1608`, `1628`, `1633`), not only the later terminal-result checks.

### `useApplicantReviewerEnrichment`

- `enrichRecommended`: props `blobUrl`, `proposalKey`, `requestId`; state `analysis`;
  refs `genRef`, `recRunningRef`, `mountedRef`; setters `setRecPhase`, `setRecError`,
  `setRecProgress`, `setRecCandidates`, `setRecHandled`, `setRosterIneligible`;
  modules `readSseStream`, `dedupeByName`, `pruneCandidateForRoster`; returns
  undefined. Its SSE progress write at `1752` must be generation-guarded.
- `terminalApplicantKeys`: state `rosterExcluded`, `rosterSavedKeys`; module
  `applicantTerminalSuggestionKeys`; returns a Set.
- `actionableRecommended`: prop `recommended`; module
  `reviewerEngagementProjection`; returns filtered recommendations.
- `haveValidCache`: derived `rosterActive`, `rosterIneligible`,
  `actionableRecommended`, `terminalApplicantKeys`; prop `proposalKey`; module
  `hasValidApplicantEnrichmentCache`; returns a boolean.
- Auto-effect inputs: `actionableRecommended`, `recPhase`, `rosterLoaded`,
  `haveValidCache`, props `blobUrl`/`proposalKey`, ref `recRunningRef`, command
  `enrichRecommended`, setter `setRecPhase`. Its accepted dependency array is
  `[blobUrl, proposalKey, actionableRecommended, recPhase, rosterLoaded,
  haveValidCache, enrichRecommended]`.

### `useReviewerContactActions`

- `setManualContact`: modules `candKey`; setters `setCandidates`,
  `setRecCandidates`, `setRosterActive`; returns undefined.
- `applyAuthoritativeRosterCandidate` (internal): module `candKey`; setters
  `setCandidates`, `setRecCandidates`, `setRosterActive`; returns undefined.
- `persistManualContact`: prop `requestId`; ref `genRef`; command
  `setManualContact`, `applyAuthoritativeRosterCandidate`; setter `setRosterNote`;
  module `candKey`; throws for missing request/key, network failure, or an
  unsuccessful response; returns `false` only after a stale response and
  otherwise resolves undefined.
- `verifyAddressContact`: prop `requestId`; ref `genRef`; command
  `applyAuthoritativeRosterCandidate`; setters `setSelected`, `setRosterNote`;
  modules `candKey`, `addressTrustFailureMessage`; returns `false` only after a
  stale response and `true` after authoritative verification; invalid input,
  network failure, and unsuccessful responses throw, including when an
  authoritative candidate was already applied before a later partial failure.
- `reviewAddressConflict`: prop `requestId`; ref `genRef`; setters
  `setEditingContact`, `setRosterNote`; modules `candKey`,
  `addressTrustFailureMessage`; returns undefined.
- `retryAddressCheck`: prop `requestId`; ref `genRef`; command
  `applyAuthoritativeRosterCandidate`; setter `setRosterNote`; modules `candKey`,
  `getCandidatePromotionDecision`, `addressTrustFailureMessage`; returns undefined.
- `requestAddressRepair`: prop `requestId`; ref `genRef`; setters
  `setRepairRequestsByCandidateKey`, `setRosterNote`; modules `candKey`,
  `getCandidatePromotionDecision`, `getCandidateEmailReadiness`; returns undefined.
- `useLead`: command `setManualContact`; setter `setEditingContact`; returns
  undefined.
- `openIdentityConfirmation`: prop `requestId`; ref `genRef`; setters
  `setConfirmingContact`, `setRosterNote`; modules `candKey`,
  `addressTrustFailureMessage`; returns undefined.
- `confirmIdentityContact`: prop `requestId`; state `unverified`; ref `genRef`;
  command `verifyAddressContact`, `applyAuthoritativeRosterCandidate`; setters
  `setUnverified`, `setRosterActive`; modules `candKey`, `dedupeByName`,
  `pruneCandidateForRoster`; returns `false` for invalid or stale outcomes, and
  otherwise returns the result of `verifyAddressContact` after the confirmation
  PATCH; record/confirm failures throw and a verification throw propagates. The
  explicit `unverified` and `verifyAddressContact` inputs are required; neither
  may be recovered through a broad state object.

### `useReviewerPromotion`

- `refreshExpiredVerification`: prop `requestId`; state `analysis`; ref `genRef`;
  command `pushProgress`; modules `readSseStream`, `mergeEnrichment`,
  `pruneCandidateForRoster`; returns `{ refreshed, failures, stale }`. The
  per-row roster POST loop (`2461–2479`) must check generation before issuing each
  next POST and after each response; an already-issued request cannot be undone.
- `saveSelected`: props `requestId`, `onSaved`; state `selected`, `analysis`;
  derived `displayCandidates`; refs `genRef`, `savingRef`; commands
  `pushProgress`, `refreshExpiredVerification`, `reloadRoster`; setters
  `setSavingCount`, `setPhase`, `setError`, `setErrorMeta`, `setProgress`,
  `setPromotionNotice`, `setCandidates`, `setRecCandidates`, `setRosterActive`,
  `setRosterBlocked`, `setRosterSavedKeys`, `setRosterNote`, `setSelected`;
  modules `isCandidateSelectable`, `provenanceKindOf`, `PROVENANCE_KINDS`,
  `correlateSaveResultsToRosterCandidates`, `candKey`, `dedupeByName`,
  `formatSaveFailureDetails`. Returns undefined, including early stale returns.
  The ordinary save, applicant promotion, exact-key correlation, and unknown-outcome
  asymmetry are separate branches and must not be collapsed.

### `useReviewerExport`

`exportSelected` receives prop `requestId`; state `selected`; derived
`displayCandidates`; refs `exportingRef`, `genRef`, `mountedRef`; setters `setExporting`, `setExportError`;
modules `candKey`, `isCandidateSelectable`, `buildScholarSearchUrl`,
`isRealScholarProfileUrl`; ambient `fetch`, `document`, `URL`; returns undefined.
Stage 0 gives the operation a generation token, prevents a stale request from
creating a download or writing `exportError`, and makes token cleanup conditional so
an old `finally` cannot clear a newer context's export lock.

### `useReviewerSearchProjection`

Inputs are props `proposalKey`, `recommended`; state `rosterActive`, `recCandidates`,
`candidates`, `rosterExcluded`, `rosterIneligible`, `rosterHandled`, `recHandled`,
`unverified`, `sortMode`; external derived inputs `terminalApplicantKeys` and
`engagedSavedIndex`. `rediscoveredEngaged` and `displayCandidates` are calculated
inside this hook and consumed by its later projections, not passed back as inputs.
Module helpers are
`isApplicantOriginCandidate`, `candKey`, `dedupeByName`, `withReviewerProvenance`,
`partitionRediscoveredCandidates`, `reviewerEngagementProjection`,
`isCandidateSelectable`, and `provenanceGroupOf`.

Returns exactly these named projections: `displayRosterActive`,
`visibleRecCandidates`, `currentRunKeys`, `previousSearchCandidates`,
`previousSearchKeys`, `previousSearchRefs`, `displayCandidates`,
`rediscoveredEngaged`, `handledReviewers`, `incompleteCoiCandidates`,
`incompleteCoiNames`, `incompleteCoiLabel`, `selectableCandidates`, `knownNameKeys`,
`unverifiedToShow`, `readinessSections`, `recCount`, `applicantDisplayCandidates`,
`recVerifiedCount`, and `recIdentityReviewCount`. Selection commands `toggle`,
`toggleAll`, and `allSelected` stay composition-owned because they write the
controller's `selected` state.

### `useReviewerSearchController`

The final hook receives all current facade props: `requestId`, `blobUrl`,
`proposalKey`, `excludedNames`, `exclusionsUnavailable`, `excludedRaw`,
`recommended`, `recommendedFailed`, `knownLookupFailed`, `slotsPopulated`,
`ingestLoading`, `ingestError`, `onRetryIngestion`, `savedPool`, `onSaved`,
`onNavigate`, `manualAddSlot`, `canManage`, and `repairCandidateKey`.

It owns the exact state/setter pairs declared at `1292–1360`: `phase`,
`savingCount`, `progress`, `candidates`, `unverified`, `analysis`,
`identityComparison`, `selected`, `rosterActive`, `rosterExcluded`,
`rosterIneligible`, `rosterBlocked`, `rosterHandled`, `rosterSavedKeys`,
`rosterNames`, `repairRequestsByCandidateKey`, `repairRequestsUnavailable`,
`rosterLoaded`, `rosterLoadFailed`, `rosterNote`, `removingPrevious`,
`excludedOpen`, `error`, `errorMeta`, `promotionNotice`, `enrichNote`,
`excludeText`, `excludedRemoved`, `searchSources`, `reviewerCount`,
`additionalNotes`, `referredSeedsText`, `referredBy`, `blockedReferredSeeds`,
`sortMode`, `exporting`, `exportError`, `recPhase`, `recCandidates`, `recHandled`,
`recProgress`, `recError`, `showPromptEditor`, `editingContact`, and
`confirmingContact`. It owns refs `exportingRef`, `recRunningRef`, `runningRef`,
`savingRef`, `genRef`, `excludeEditedRef`, and the Stage 0 `mountedRef` lifecycle
guard. The reset effect owns the mounted flag and clears operation tokens only for
its current generation, so StrictMode cleanup cannot clear a remounted operation.

It retains `savedPoolNames`, `engagedSavedIndex`, `busy`, `noSourcesSelected`,
`pushProgress`, the reset/prefill effects, `toggle`, `allSelected`, `toggleAll`,
`onExcludeChange`, and the operation-hook composition. AST capture of the current
JSX return identifies these component-local values as the complete Stage 2 view
contract (imports and JSX locals are omitted):

```text
activeInstitutionStage2Presentation, additionalNotes, allSelected, blobUrl,
blockedReferredSeeds, busy, canConfirmCandidateForPromotion, canManage,
candKey, confirmIdentityContact, confirmingContact, displayCandidates,
editingContact, enrichNote, enrichRecommended, error, errorMeta,
excludeCandidate, excludeText, excludeUnverifiedCandidate, excludedOpen,
excludedRaw, excludedRemoved, exclusionsUnavailable, exportError, exportSelected,
exporting, getCandidateEmailReadiness, getCandidatePromotionDecision,
handledReviewers, identityComparison, incompleteCoiCandidates, incompleteCoiLabel,
ingestError, ingestLoading, isApplicantOriginCandidate, isCandidateSelectable,
knownLookupFailed, manualAddSlot, noSourcesSelected, onExcludeChange, onNavigate,
onRetryIngestion, openIdentityConfirmation, persistManualContact, phase,
previousSearchKeys, previousSearchRefs, progress, promoteCandidate,
promotionNotice, proposalKey, readinessSections, recCount, recError,
recIdentityReviewCount, recPhase, recProgress, recVerifiedCount, recommended,
recommendedFailed, referredBy, referredSeedsText, removePreviousResults,
removingPrevious, repairCandidateKey, repairRequestsByCandidateKey,
repairRequestsUnavailable, requestAddressRepair, retryAddressCheck,
retryRosterLoad, reviewAddressConflict, reviewerCount, rosterBlocked,
rosterExcluded, rosterIneligible, rosterLoadFailed, rosterLoaded, rosterNames,
rosterNote, runSearch, saveSelected, savingCount, searchSources, selected,
setAdditionalNotes, setConfirmingContact, setEditingContact, setExcludedOpen,
setReferredBy, setReferredSeedsText, setReviewerCount, setSearchSources,
setShowPromptEditor, setSortMode, showPromptEditor, slotsPopulated, sortMode,
toggle, toggleAll, unverifiedToShow, useLead, verifyAddressContact
```

The list includes the exact `showPromptEditor`/`setShowPromptEditor`,
`recPhase`/`recProgress`/`recError`/`enrichRecommended`,
`blockedReferredSeeds`, `identityComparison`, and roster category arrays used by
the JSX. `genRef` is an internal lifecycle dependency and is not a view prop.
No operation body belongs in this return assembly.

## Stage 0 defect disposition and minimal fix designs

These are `[VERIFIED via source reads and AST capture]` pre-existing behaviors at
the baseline. The designs below are bounded to stale client state/lifecycle. They
do not cancel or undo an already-issued HTTP write, change payloads, or alter the
item-6 unknown-outcome asymmetry.

1. **Progress writes before generation checks.** `pushProgress` writes without a
   generation guard (`1472–1474`); stream callbacks and transport fallback messages
   call it before later checks (`1514`, `1529`, `1573`, `1586`, `1608`, `1628`,
   `1633`). Applicant progress writes directly at `1752`. Refresh progress has a
   check at `2429`, but the helper call must still be generation-owned. Minimal fix:
   carry `myGen`/`expectedGeneration` into progress writes and make the setter no-op
   when the generation or mounted lifecycle is stale. Keep local stream variables
   writable for terminal parsing, but suppress all stale UI state writes.

2. **Exclusion rollback crosses request contexts.** `excludeCandidate` catch writes
   `setRosterExcluded`, `setRosterActive`, and `setRosterNote` without a generation
   check (`1943–1948`); unverified rollback has the same shape (`1970–1976`).
   Minimal fix: capture the operation generation before the PATCH and guard every
   rollback setter. The unverified path retains its `nameAlreadyInRoster` rule and
   never restores the row to active. A delayed rejection from request A must not
   put A into request B's display or later save selection.

3. **Export side effects and lock cleanup are unowned.** `exportSelected` uses a
   boolean lock and unconditionally writes the error/finally state after awaits
   (`2956–3017`). Minimal fix: use a generation token for the lock, guard
   `setExportError`, download DOM/object-URL side effects, and `setExporting`, and
   clear the lock only when the finishing token still owns it. Reset/unmount cleanup
   must release the prior token without allowing its old `finally` to clear a newer
   export.

4. **Operation refs have unconditional finally cleanup.** Search and applicant
   operations set `runningRef.current = false` (`1726`) and
   `recRunningRef.current = false` (`1775`) regardless of context. Reset does not
   reset these refs (`1399–1442`). Minimal fix: retain the same-context duplicate
   guard, assign the active generation to each operation lock, clear stale ownership
   during a context/unmount cleanup, and let an old finally clear only its own token.
   StrictMode cleanup/re-run must establish the new lifecycle before new work starts.

5. **Refresh loop continues POSTs after staleness.** The enrichment stream is
   generation-checked before the row loop (`2434`), but each roster POST proceeds
   without a per-iteration check (`2461–2479`); only the final return reports stale
   (`2483`). Minimal fix: check generation before each next POST and after each
   response, stop issuing later rows when stale, and return `stale: true`. An
   in-flight first POST remains an already-issued write and is not undone.

6. **Unknown-outcome asymmetry is characterization only.** Ordinary save marks
   `receivedResponse` before JSON parsing (`2544–2545`) and reloads only in the
   pre-response catch (`2623–2643`); applicant promotion failures return per-row
   failures without the ordinary GET reconciliation (`2694–2711`). Stage 0 records
   these cases in P7 and leaves them unchanged.

## Prerequisite and falsification coverage

The focused cases below must run with mocked fetch/SSE only. Each test fixture must
contain the competing row or delayed response that would make a missing guard fail.
The failing-before output is recorded with the safety fix commit; no live provider,
Dataverse, Postgres, Blob, or external HTTP call is permitted.

| Requirement | Test coverage | Expected falsification |
|---|---|---|
| Context generation and unmount/StrictMode lifecycle | `reviewer-search-stage0-lifecycle.test.js` P2 | A delayed A response cannot set B state after request/blob change or unmount; B can start after A is invalidated; same-context lock remains blocked; pending export completion after unmount has no side effects; StrictMode remount cleanup does not clear a new token. ProposalKey-only changes remain characterized as baseline behavior. |
| Exclusion rollback | `reviewer-search-stage0-lifecycle.test.js` P3 | Delayed rejected PATCH for A does not restore A into B active or selected state; unverified failure never becomes active; same-context rollback remains visible and retryable. |
| Stream progress and stale callbacks | `reviewer-search-stage0-lifecycle.test.js` P4 | Progress/failure/success/finally writes after A→B are ignored, including transport fallback messages; the isolated unguarded mutation renders both stale messages. |
| Applicant enrichment | `reviewer-search-stage0-lifecycle.test.js` P5 | Applicant progress is generation-owned; the isolated unguarded mutation renders stale applicant progress. Existing history-control suites cover valid cache and manual refresh behavior. |
| Refresh loop | `reviewer-search-stage0-lifecycle.test.js` P7 | After generation changes during row 1, no row 2+ roster POST is issued; row 1 may complete and is reported as stale. |
| Export | `reviewer-search-stage0-lifecycle.test.js` P8 | Stale/unmounted export produces no download, stale error, or lock corruption; current-context duplicate click remains blocked and object URLs are cleaned up. |
| Unknown outcomes | P7 save contract | Ordinary pre-response, ordinary post-response malformed JSON, and applicant transport failures retain distinct existing outcomes; no new recovery is inferred. |

Stage 0 now has additive characterization coverage for the deferred presentation
contracts: `tests/unit/reviewer-search-public-contract.test.js` and
`tests/unit/reviewer-search-workspace-composition.test.js` (8 cases total), plus
`tests/unit/reviewer-search-callback-contract.test.js` (6 cases covering exact
`onSaved`/modal callback behavior). `tests/unit/reviewer-search-context-lifecycle.test.js`
adds the four P2 request/proposal lifecycle cases. Together with
`tests/unit/reviewer-search-stage0-lifecycle.test.js` (9 cases), the five new test
files contribute 27 additive cases. P9 boundary coverage remains a Stage 10
prerequisite. Existing R1–R7 suites remain regression anchors and are not replaced
by broad snapshots.

## Verification log

- `[VERIFIED via command]` `npm ci` completed in the isolated worktree; package
  manifest and lockfile are unchanged.
- `[VERIFIED via command]` `.agents/skills` resolves to `../.claude/skills`.
- `[VERIFIED via CodeGraph then source]` parent repository CodeGraph located the
  facade and callers; the worktree has no `.codegraph`, so current worktree source
  and callers are authoritative for this receipt.
- `[VERIFIED via source]` no new table, route, DTO, enum, or durable surface is
  proposed. Durable-surface, symbol-fan-out, and migration audits are N/A.
- `[VERIFIED via command]` Baseline focused run against the frozen source failed
  all seven Stage 0 cases; the full log is `/private/tmp/reviewer-search-stage0-baseline.log`.
  Both exclusion cases established that the request-B row stayed absent/present
  as expected but exposed the stale A rollback note. The search and applicant
  progress cases stopped at the precondition that request B never started (the
  old operation lock), so they do not independently falsify the progress setter.
  The old lock case likewise stopped before its delayed-finally check. The export
  case could not find request B's export control after the context switch, which
  is the stale export-state defect. The refresh case issued two roster POSTs
  after the context changed instead of one.
- `[VERIFIED via command]` With the bounded WIP restored, the focused suite passes
  7/7. A separate mutation that removed only the progress-generation guards,
  while retaining the other WIP fixes, fails both progress cases because the
  stale A messages render; its log is
  `/private/tmp/reviewer-search-stage0-progress-unguarded.log`. The source was
  restored from `/private/tmp/ReviewerSearchSection.stage0-wip.final.js` after
  that falsification run. At this historical checkpoint Gate G and fresh Sol Stage 0 review were still
  pending; the Stage 0 acceptance below records their completion.
- `[VERIFIED via command]` The focused suite now passes 9/9 after adding an
  unmounted export completion check and a StrictMode remount lifecycle check.
  Temporarily removing only the conditional search/export lock cleanup makes the
  captured React handlers issue a third search and third export; the red log is
  `/private/tmp/reviewer-search-stage0-lock-unguarded.log`. The source was
  restored from `/private/tmp/ReviewerSearchSection.stage0-wip.final2.js`.
- `[VERIFIED via command]` Scoped regression suites pass sequentially: save-stale
  4/4 (`/private/tmp/reviewer-search-save-stale.log`), history-controls 19/19
  (`/private/tmp/reviewer-search-history-controls.log`), unverified-rescue 8/8
  (`/private/tmp/reviewer-search-unverified-rescue.log`), and
  promotion-reconciliation 16/16
  (`/private/tmp/reviewer-search-promotion-reconciliation.log`). ESLint passes
  for the bounded runtime and Stage 0 test files.

## Contract-reconcile audit status

- Whole-flow: traced caller → component state → unchanged HTTP routes → existing
  persistence → response correlation → view/tests.
- Partial-success: applicable to save/promotion and refresh; exact identifiers and
  unknown-outcome distinctions are preserved in the Stage 7 inventory.
- Async/stale-state: in scope; all five pre-existing defects and post-await writes
  above have named guards/designs.
- Helper extraction: in scope; key normalization, provenance, display projection,
  and authoritative roster DTO handling remain separate.
- Durable surface: N/A for schema/routes/persistence; this receipt is the only new
  durable document.
- Doc reconcile: this receipt records current execution facts; root-owned plan and
  audit documents are not edited here.
- Symbol-consumer fan-out: N/A for new enums/columns/statuses; public facade exports
  and server `reviewer-search-logic` consumers are explicitly mapped.

## Stage 0 acceptance — 2026-09-18 PT

[VERIFIED via commands and reviews] Accepted by root after Luna implementation,
Sol runtime review (`/root/sol_stage0_review`), correction review
(`/root/sol_stage0_acceptance`), and final prerequisite delta acceptance
(`/root/sol_stage0_prerequisites`). The final delta reviewer confirmed that both
roster GETs are proven dispatched before testing A's stale completion. Root added
the six callback-contract cases and corrected the projection inventory; no backend
or shared helper changed. Original baseline/rollback reference: `8609d6ff`.

- Full Jest after all additive tests: **963 suites / 14,222 tests passed** (Luna
  session 30778, 126.432 seconds). Earlier full run: 961 / 14,212, before the last
  ten additive tests; do not confuse these snapshots.
- Canonical `npm run build` passed; log `/private/tmp/reviewer-search-stage0-build.log`.
- Lint: 0 errors, 104 existing repo warnings; bounded runtime/test lint passed.
  Types and all named G gates/self-tests passed. Serial all-check log:
  `/private/tmp/reviewer-search-stage0-all-checks.log`.
- The initial local `check:agent-invariants` failed because the per-worktree Claude
  project memory link was absent. Root created only that missing host-local link,
  then reran the gate: **3 symlinks passed**. Tracked AGENTS and skills invariants
  remained valid; no source change was needed.
- Source-only characterization of unknown-outcome asymmetry is retained. Actual
  producer/consumer tests for those three cases are still required before Stage 7.
- Remaining stages and mocked browser rehearsal are not yet executed; no release,
  production data probe, provider call, merge or deployment occurred.

**Stage 0 verdict:** accepted; first extraction authorized after the drift check.


## Stage 1 acceptance — local presentation leaves

[VERIFIED via source, tests and fresh review] Luna `/root/luna_stage1` extracted
`candidateKeys.js`, `presentation.js`, `SearchPrimitives.js`,
`IdentityComparisonPanel.js` and `CandidateCard.js`. The institution notice remains
private with the card. The public facade retains direct named exports and its
unchanged workflow/defaults. Existing server-shared logic stayed in place.

- Pre-stage fetch: origin/main unchanged at `b400c97d`; starting/rollback reference
  `cc119614` (includes accepted Stage 0).
- Fresh Sol `/root/sol_stage1_review`: **READY**, no material corrections. Its AST
  comparison matched 17 moved declarations/constants and the facade function and
  remaining constants. Root independently matched 20 top-level bodies/values.
- Luna and independent Sol focused runs: **12 suites / 185 tests passed**. Sol also
  passed strict targeted ESLint with zero warnings and `git diff --check`.
- Gate G: **19 commands passed**, including full **965 suites / 14,230 tests** and
  canonical Next build. Evidence `/private/tmp/reviewer-stage-1-gates/results.json`;
  focused log `/private/tmp/reviewer-search-stage1-focused.log`.
- The full run includes eight draft Stage 7 contract tests in separate files. They
  are not part of this extraction acceptance and do not yet satisfy P7's UI cases.

**Stage 1 verdict:** accepted by root; commit `307aa914`.


## Stage 2 acceptance — workspace views

[VERIFIED via source, commands and fresh review] Luna `/root/luna_stage2` extracted
`SearchControls`, `SearchResults`, `SearchContactModals`, `HandledReviewers` and
`ApplicantReviewerStatus`. Search constants moved with their consuming views.
State, commands, outer Card and manual-add placement remain facade-owned.

- Starting/rollback reference: `307aa914`. Upstream remained `b400c97d` at both
  the pre-stage check and the next-stage fetch.
- Fresh Sol `/root/sol_stage2_review`: **READY**; focused P1/R2–R7 **11 suites /
  101 tests**, strict targeted lint and diff checks passed. No effects, fetching
  or workflow state were introduced in views.
- Root AST comparison: facade parameters and every non-render statement match
  `307aa914` exactly. Root also inspected named prop and modal callback bindings.
- Clean full Jest: **964 suites / 14,226 tests passed**, 128.094 seconds,
  `/private/tmp/reviewer-stage-2-gates/full-test-clean.log`. This includes four
  then-current draft P4 cases; unfinished P7 drafts were parked outside discovery.
- Initial full run failed on two concurrently edited future prerequisite tests;
  `/private/tmp/reviewer-stage-2-gates/full-test.log` preserves that failure.
  It was not accepted as a green extraction run.
- Root rejected an initial evidence handoff citing Stage 1 logs. All 18 remaining
  Gate G commands were then executed afresh on Stage 2, serially, with exit 0:
  `/private/tmp/reviewer-stage-2-gates/results.json` records timestamps and logs.
  Canonical `npm run build` compiled successfully with Turbopack; lint, types,
  strict hook-dependency check, boundary and document gates/self-tests passed.
- Sol's next-stage review identified missing roster lifecycle/complement tests.
  P3 wording now explicitly preserves the existing failed-active-exclusion
  behavior: a pruned row is restored into `rosterActive`, even for transient input.
  This clarifies the test obligation and does not authorize a behavior change.

**Stage 2 verdict:** accepted by root. Stage 3 runtime movement remains blocked
until its missing prerequisite tests are committed and freshly reviewed.


## Prerequisite checkpoint before Stage 3

[VERIFIED via current source, focused tests and fresh Sol review] At accepted
Stage 2 `794423e4`, Luna added roster, real-SSE and save HTTP contract tests. Root
made the final bounded corrections after review; no production code changed.

- `reviewer-search-roster-contract.test.js`: five cases, including a populated
  roster clearing immediately on a Blob-only change, deferred GET isolation and
  observable unmount guard, exact timestamped removal/complements, and transient
  active-exclusion rollback. Root's deliberate reset removal failed at the old
  row visibility assertion; `/private/tmp/reviewer-roster-reset-mutation.log`.
- `reviewer-search-stream-contract.test.js`: five cases with real fragmented UTF-8
  streams, observable decoded progress, populated raw data removed from the POST,
  ordered/awaited persistence, discovery and enrichment terminal-then-error
  handling, and failure cases. Replacing pruning with identity failed on retained
  raw `tierResults`; `/private/tmp/reviewer-search-stream-prune-mutation.log`.
- P7's producer/pure-consumer/public-UI files plus shared fixture: 22 cases. The
  producer uses real save, applicant promotion, roster route and projection
  services; the recovery test also uses the real store row projection with SQL
  mocked. Matching single-ordinary and finalized-applicant envelopes cover the
  actual mixed click. Removing pre-response recovery failed the GET-count
  assertion; `/private/tmp/reviewer-recovery-mutation.log`.
- P7 corrections were bounded: root took over after two Luna correction rounds.
  A formerly impossible mocked saved key was replaced by the actual store
  projection. The ordinary non-suggestion row leaves `active` but has no saved
  key, so recovery cannot confirm success or call `onSaved`; an empty roster
  hides its action-local notice. These existing limitations are preserved and
  now documented in the plan. No recovery policy was changed.
- The review concern about missing stale refresh coverage was refuted by the
  existing Stage 0 case `stale refresh stops issuing roster writes after the
  first row` (deferred first POST followed by request change).
- Fresh Sol `/root/sol_prerequisite_delta`: **READY** separately for Stage 3,
  Stage 4 P4 and Stage 7 P7. Final focused run: **5 suites / 32 tests passed**;
  `/private/tmp/reviewer-prereq-root-final.log`. Targeted lint passed.
- All temporary mutations were restored byte-for-byte; facade diff is empty.
  Stage 8 export tests are a separate draft/review obligation, not accepted here.

**Prerequisite verdict:** commit these tests before Stage 3 callback extraction.
Stage 3 and later runtime moves still require their own full G and fresh review.


## Stage 3 acceptance — roster hooks

[VERIFIED via source, commands and fresh review] Luna `/root/luna_stage3` moved
seven callbacks into `useReviewerRoster.js` and `useReviewerRosterActions.js`.
The facade still owns state/reset and the one generation; callbacks receive named
refs and setters with complete dependency arrays.

- Starting/rollback reference: `03e5aad6`; origin/main stayed `b400c97d`.
- Root AST comparison matches all seven callback bodies and parameters exactly.
- Fresh Sol `/root/sol_stage3_review`: **READY**, no material findings. It checked
  stable reload identity, reset order, active/unverified rollback distinction,
  409 reload and awaited timestamped removal with exact response reconciliation.
  Sol focused run: **8 suites / 58 tests**; strict dependency lint passed.
- Luna focused run: **7 suites / 64 tests**. Gate G completed all **19 commands**,
  including full **969 suites / 14,258 tests** and canonical Turbopack build.
  Evidence: `/private/tmp/reviewer-stage-3-gates/results.json` and its named logs.
  An accidentally repeated gate run was stopped from repeating further; the
  retained final serial evidence starts at 03:33:16 UTC and ends at 03:36:23 UTC.
- The full run includes the four green P8 export cases, to be committed separately
  as prerequisites. Applicant/contact drafts arrived after suite discovery and
  are not claimed as part of this stage's full-suite evidence.

**Stage 3 verdict:** accepted by root. No payload, route, helper or persistence
behavior changed.

## Export prerequisite acceptance before Stage 8

[VERIFIED via source, tests and review] Luna's export suite plus root's bounded
stale-selection case cover DTO field precedence, selected/selectable filtering,
Scholar classification, filename fallback, object-URL/anchor cleanup and separate
error state. Existing Stage 0 tests cover stale/unmounted and duplicate behavior.
Sol `/root/sol_save_prereqs_final` identified the originally vacuous selectability
check; fresh `/root/sol_stage3_review` verified the corrected case's precondition.

- Focused export + Stage 0: **2 suites / 13 tests passed**, with targeted lint;
  `/private/tmp/reviewer-export-prereq-final.log`.
- Removing only the export selectability guard makes the stale-selected case send
  one forbidden POST instead of zero; `/private/tmp/reviewer-export-selectability-mutation.log`.
  Root restored the source and verified callback equivalence including export.
- P8 is accepted for a separate prerequisite commit. Stage 8 runtime movement
  still requires its own G and fresh-context review.


## Stage 4 acceptance — discovery hook

[VERIFIED via source, commands and fresh review] Luna moved `runSearch` into
`useReviewerDiscovery.js` with explicit inputs, refs and setters. Root's AST
comparison against `f650c035` confirms identical callback parameters and body.
Ordered analyze/discover/enrich streams, ranking, partitions, payloads, stale
guards and awaited roster persistence remain unchanged.

- Fresh Sol `/root/sol_stage4_final`: **READY**, 4 suites / 24 tests passed.
- Luna focused verification: **5 suites / 45 tests passed**.
- Full suite: **969 suites / 14,258 tests passed**. Initial repository lint
  failed while a temporary root `.cjs` review draft was present. Moving the draft
  outside the repository allowed lint to pass (0 errors, 104 existing warnings);
  no lint configuration or runtime fix was needed.
- All remaining G checks and canonical Turbopack build passed sequentially. The
  full suite was not needlessly repeated. Original evidence remains at
  `/private/tmp/reviewer-stage-4-gates/results.json`; the merged continuation is
  `/private/tmp/reviewer-stage-4-gates-resume/results.json`.

**Stage 4 verdict:** accepted by root. Starting/rollback reference: `f650c035`.


## Applicant/contact prerequisites before Stages 5–6

[VERIFIED via source, tests and fresh review] Luna added twelve component-level
cases in `reviewer-search-applicant-contact-contract.test.js`. Cache fixtures
exercise ineligible canonical rows, excluded/saved terminals, handled applicants
and same-context rerenders. Four independently deferred streams prove discovery
can render while applicant enrichment remains pending. Contact cases preserve
draft-before-verification ordering, partial authoritative receipts and retryable
confirmation; deferred record, confirmation, draft and verification responses
cannot overwrite a new request's same-key candidate or issue stale follow-up calls.

- Fresh Sol `/root/sol_p5_p6_delta`: **READY** after one correction round; it
  verified populated preconditions and coverage shared with existing cache,
  history, rescue, reconciliation and callback suites.
- Final focused run: **5 suites / 61 tests passed**. Strict new-test lint passed.
- No runtime changes were made for these tests. Stages 5–6 still require their
  own extraction reviews and full G.

**Prerequisite verdict:** accepted by root before Stage 5.


## Stage 5 acceptance — applicant enrichment hook

[VERIFIED via source, commands and fresh review] Luna moved the applicant command,
terminal/actionable/cache derivations and automatic effect together into
`useApplicantReviewerEnrichment.js`. Root AST checks against `49958e13` confirm
identical callback/memo bodies, cache initializer and auto-effect body. Passed refs
and setters are explicit dependencies; state and generation remain facade-owned.

- Fresh Sol `/root/sol_stage5_final`: **READY**, verified captures, cache policy,
  terminal filtering, independent lane and stale completion/progress behavior.
- Luna focused run: **4 suites / 44 tests passed**; strict targeted lint passed.
- Full G: all **19 commands passed**, including **970 suites / 14,270 tests**,
  repository lint (0 errors, 104 existing warnings) and canonical Turbopack build.
  Evidence: `/private/tmp/reviewer-stage-5-gates/results.json`.

**Stage 5 verdict:** accepted by root. Starting/rollback reference: `49958e13`.


## Stage 6 acceptance — contact and identity actions

[VERIFIED via source, commands and fresh review] Luna extracted ten callbacks into
`useReviewerContactActions.js`. Root AST comparison against `212ebeee` confirms
all bodies and parameters match. Both modal state declarations precede the hook
call and retain their null defaults and facade ownership.

- Fresh Sol `/root/sol_stage6_final`: **READY**, checked UI bindings, authority
  fields, payload order, partial receipts, return/throw differences and stale exits.
- Luna focused run: **5 suites / 51 tests passed**; strict targeted lint passed.
- Full G: **19 commands passed**, including **970 suites / 14,270 tests** and
  canonical build. Evidence: `/private/tmp/reviewer-stage-6-gates/results.json`.
- A preparatory browser bundle overlapped active source edits and reported an
  undefined hook. Current source imports and bindings were verified; that run is
  not acceptance evidence. Stage 10 must rebuild against a stable revision.

**Stage 6 verdict:** accepted by root. Starting/rollback reference: `212ebeee`.
