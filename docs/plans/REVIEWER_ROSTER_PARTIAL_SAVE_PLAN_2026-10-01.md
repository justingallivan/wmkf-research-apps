---
title: Reviewer roster partial-save correctness
status: in-progress
domain: architecture
kind: plan
summary: Per-candidate save outcomes and authoritative roster reloads prevent partial database writes from appearing fully saved in reviewer search.
canonical: false
owner: product-engineering
---

# Reviewer roster partial-save correctness

Status: [VERIFIED via source and local validation] Implemented on the feature branch; Sol and root approve. Final Fable implementation review and full-suite validation are pending. Not merged or deployed.
Base: `9505d22b22381f4f338682fd1874a0493b4bfd62` (`main`, PR #391 merged).
Branch: `codex/roster-partial-save`.

## Objective and boundary

[PLANNED] Stop treating an HTTP-200 roster batch response as proof that every search result was persisted. Preserve each row's actual outcome, report partial failure, and derive saved roster buckets and search exclusions from the authoritative GET. This is a correctness fix, not a search/promotion redesign. No schema, provider, credentials, production frequency experiment, new queue, automatic retry, or new promotion/identity authorization gate.

[PLANNED] Tier 2 runtime change, isolated mocked/fixture validation, reviewed PR, deliberate owner-authorized merge. No live production writes during development. Root plans with Fable; Luna implements/tests; Sol reviews; root reviews; Fable adversarially reviews the final implementation. Limit review loops to substantive correctness issues; root resolves minor churn.

## Verified pre-change baseline (base commit above)

- [VERIFIED via `lib/services/reviewer-roster-store.js:92-170`] `recordSurfaced` catches individual SQL failures, skips invalid rows, counts changed rows, and returns a number. Zero changed rows also covers legitimate protected-curation/CAS no-ops. Cap enforcement runs afterward and catches its own errors (`:231-249`). A write acknowledgment does not prove the row survived the cap or later concurrent changes.
- [VERIFIED via `lib/services/workbench/reviewer-roster-service.js:340-410`] The service rejects server-managed applicant rows before writes, prunes/strips browser authority, validates receipts, binds server keys, filters missing-name inputs, preserves stored authority, and returns `{ success: true, recorded }`. Filtering currently loses original input indexes.
- [VERIFIED via `pages/api/workbench/reviewer-roster.js:1-100`] Existing application/role and request-scope checks, 100-candidate cap, and 2 MiB body limit remain the entry contract. No new route is needed.
- [VERIFIED via `shared/components/reviewers/search/useReviewerDiscovery.js:237-312`] Discovery sets current-run cards and an optimistic ineligible bucket, ignores the POST body, then merges all submitted rows/names into saved roster state on any HTTP success. The phase remains busy through POST and generation checks prevent stale completion.
- [VERIFIED via `shared/components/reviewers/search/useReviewerRoster.js`] The controller already has a generation-guarded `reloadRoster`; its GET snapshot includes persisted buckets and allNames. `retryRosterLoad` is the existing read-recovery path.
- [VERIFIED via `shared/components/reviewers/search/useReviewerSearchProjection.js`] Current-run cards win over roster rows in display projection, so merely refreshing saved buckets would still permit a fresh card to shadow restored authority or protected curation.
- [VERIFIED via `shared/components/reviewers/search/useReviewerContactActions.js:296-360` and `useReviewerPromotion.js:80-140`] Two singleton POST consumers also exist: unverified-contact rescue accepts success with recorded zero and then PATCHes; promotion refresh already requires recorded one.
- [VERIFIED via repository caller search] Other numeric store consumers are `reviewer-address-trust-service.js:897,1174` and `workbench/enrich-recommended-service.js:444`; they must keep the numeric default and existing CAS/measurement behavior.
- [VERIFIED via store upsert and `reviewer-roster-service.js:195-310`] Blind delayed replay can replace an active row's unconfirmed contact draft. Existing stored-authority restoration does not make arbitrary replay safe.
- [VERIFIED via Luna baseline] Focused baseline: 134/135 tests passed; existing failure in `reviewer-search-promotion-reconciliation.test.js:141` sees “Saved Reviewer” still rendered. Luna reran the isolated test (1/1), its file (17/17), and the identical five-suite command (135/135): all passed. Treat the initial failure as non-reproduced, rerun during final validation, and do not expand into promotion redesign without recurrence and causal evidence.

The following design sections preserve the approved plan; execution evidence is recorded at the end.

## Response and store contract

[PLANNED] Add an opt-in detailed return to `recordSurfaced`; default remains the existing number. Detailed mode returns `{ recorded, outcomes }`, with exactly one outcome per supplied store input. Each contains inputIndex, server-derived candidateKey (null only when unavailable), and status:

| Status | Meaning | Counts as recorded |
| --- | --- | --- |
| `recorded` | SQL acknowledged a changed row | Yes |
| `unchanged` | Valid row attempted; SQL changed zero rows (protected status/CAS) | No |
| `invalid` | No usable name/key | No |
| `failed` | Row write raised an error | No |

[PLANNED] Keep SQL conflict policy, authority handling, measurements, cap, and default callers unchanged. Per-row failures remain isolated. Do not send database error details to the browser. An `unchanged` outcome is neither a failure nor proof of an active row.

[PLANNED] Service preserves original POST input indexes through filtering and canonical-key binding, requests store details, and emits `{ success, recorded, outcomes }` with exactly one ordered outcome per original input, using final server-bound keys. Filtered invalid rows get `invalid`; duplicates remain separate indexed attempts. `success` is true iff every outcome is recorded or unchanged (including an empty batch); false for any invalid/failed item. HTTP 200 denotes a processed batch, including partial/all row failure. Existing whole-request rejection/error statuses remain unchanged.

[PLANNED] Compact client interpretation must reject incomplete, duplicate-index, unknown-status, or malformed receipts as unknown outcomes, rather than assuming success. Keep this local to reviewer roster callers; do not change generic HTTP helper semantics. Validate recorded totals and successful singleton acknowledgments consistently. Input indexes, not names, associate results; returned keys, not client claims, identify canonical rows.

## Discovery state and recovery

1. [PLANNED] Pass existing reloadRoster and load-state setters from controller into discovery. Keep busy through both POST settlement and the following GET. Check the search generation after every await, including error/recovery paths. Validate the real GET's core arrays (`active`, `excluded`, `ineligible`, `blocked`, `handled`, `savedKeys`, `allNames`) and literal success before applying a snapshot. A malformed successful GET must take the same read-failure/retry path; defaulting an omitted allNames ledger to empty would undermine protected-row reconciliation.
2. [PLANNED] For request-backed searches, remove optimistic writes to saved active/ineligible/name buckets. After any POST outcome (including transport/non-2xx/unknown response), attempt GET. Only `applyRosterSnapshot` populates saved state; no local merge of submitted names. Preserve request-less search behavior.
3. [PLANNED] Reconcile current-run cards as well: for a known response, use the input index and canonical key to adopt the GET active row verbatim; do not let submitted DTOs shadow server-restored fields. Rows protected into excluded/ineligible/blocked/saved/handled buckets stay in those views. Recorded/unchanged rows absent from the active snapshot are not recreated as active cards (cap/concurrency/curation). Failed new rows may remain ephemeral cards, with their canonical key, only if the GET does not already place that key in another bucket and the normalized name is absent from GET allNames; existing rows win. The name condition is conservative uncertainty suppression, not identity matching: GET omits noncanonical saved keys, so absence from visible buckets alone cannot establish that a failed input is new. This may hide a distinct same-name failed result; the warning must not claim it was saved. Invalid rows are not treated as persisted.
4. [PLANNED] Unknown acknowledgments must not manufacture canonical-key mappings or restore protected current-run rows. Show the authoritative roster and a clear “could not confirm all search saves” warning; clear current-run candidates and their selection, leaving the authoritative GET roster visible. Do not claim zero rows saved. No complete-success message for unknown responses.
5. [PLANNED] On failed GET, keep the partial/uncertain warning, clear current-run candidates and their selection, set rosterLoaded false and rosterLoadFailed true, and use the existing “Retry reviewer state” control. This deliberately avoids retaining a stale optimistic DTO across a later read recovery. Avoid claiming stale saved buckets reflect this batch; do not optimistic-merge any new rows. The terminal phase remains results, and SearchResults must render “Retry reviewer state” wired to the existing retryRosterLoad in place of its otherwise disabled “Run another search” button while rosterLoadFailed. A subsequent successful GET restores normal search behavior. Accept the existing clearing of rosterNote during a later explicit read retry/removal; no separate warning state is introduced, and uncertain current-run cards have already been cleared. Context switches/unmounts must suppress old POST/GET success and failure state writes.
6. [PLANNED] Show a concise batch warning for failed/invalid outcomes, with the failed count where known. The existing fresh-search action is recovery: GET allNames excludes durable rows; newly unsaved rows remain eligible for discovery. Rediscovery is not guaranteed to return the identical candidate. No dedicated save-retry button, blind replay, insert-only retry API, or automatic provider rerun in this fix. Keep existing explicit promotion and contact workflows available under their existing contracts.
7. [PLANNED] Cover deceased/ineligible current-run presentation explicitly: request-backed ineligible saved state comes only from GET; request-less search retains existing ineligible display. Count unsaved/unknown deceased results in the batch warning and do not render them. Do not label them durable or revive them as eligible active cards; no separate ephemeral ineligible list is added.

## Other POST consumers

- [PLANNED] Unverified-contact rescue must receive an exact singleton recorded acknowledgment before confirm_identity PATCH. A zero/unchanged/failed/invalid/unknown outcome is a recoverable error, not permission to continue. For unverified rescue, overwrite the candidateKey with the exact singleton recorded outcome key before constructing the confirm_identity PATCH and the resulting local candidate. Keep the original key solely to remove/replace the original ephemeral card. Rebinding is expected because the server pruner omits some browser anchors; refusing every mismatch would block legitimate rescue. No client-selected key becomes authority. Preserve all existing server-side authorization. Check generation immediately after POST before error or success work.
- [PLANNED] Promotion receipt refresh retains singleton processing, exact recorded-one requirement, and matching candidate key (a mismatch remains a refresh failure); validate the detailed acknowledgment and avoid null/malformed-body success. Do not expand this into promotion redesign.

## Invariants and verification

| Invariant | Evidence to add/run |
| --- | --- |
| Default store callers still receive numeric count | Store tests: mixed changed/no-op/error, invalid input, CAS, cap, measurement isolation |
| Every original POST item has one correctly keyed outcome | Service/route tests: filtering, duplicate names/keys, invalid, canonical rebind, protected no-op, partial/all SQL failures, unchanged applicant preflight |
| No fabricated saved state or exclusion | UI test: mixed response + authoritative GET; next search excludes only GET names; all-failed/unknown response warnings |
| Protected rows and stored fields win over current-run data | UI fixtures with excluded/ineligible/blocked/saved/handled, active contact edit, and cap-absent acknowledged row |
| No stale asynchronous state | Deferred POST + deferred GET; request/blob change and unmount; failure branches; busy until GET settles |
| Read recovery is usable | GET fails after successful/partial/unknown POST; Retry reviewer state succeeds without POST replay |
| Singleton callers do not infer persisted row from HTTP success | Rescue no-op/failed/unknown stops PATCH; rescue valid ack carries the returned canonical key through PATCH and local replacement; promotion mismatch refuses continuation; promotion exact-ack contract |
| No adjacent policy changes | Existing identity/receipt/restriction/promotion and roster history tests remain green |

[PLANNED] Existing fixtures needing intentional updates: reviewer-roster-extraction-characterization exact-body assertion; reviewer-search-unverified-rescue recorded-zero test (invert it); reviewer-search-stage0-lifecycle, reviewer-search-history-controls, and reviewer-search-roster-contract POST mocks (give realistic outcomes plus subsequent GET snapshots). Do not weaken assertions or reinterpret all old fixtures as unknown-response tests.

[PLANNED] Tests use production-shaped mocked route/SQL/UI fixtures; no production failure-frequency testing needed. Add a regression demonstrating the old false-success behavior. Run affected Jest suites, type/lint/build, relevant existing gates (discover exact commands in package.json/CI reference), then full suite once final behavior stabilizes. Gate and self-test run sequentially. Attribute the baseline failure with reproducible evidence; fix only if caused by or directly part of this flow.

[PLANNED] Update source contract headers plus narrowly affected Atlas/catalog statements after reading entire durable targets and sweeping matching claims. No new table, migration, route count, or persisted status, so schema/migration/count updates are N/A. Existing auth/security matrix authority remains unchanged. Record actual validation, review receipts, residual limitations, and release/rollback notes in this plan and PR.

## Review and release record

- [VERIFIED review] Fable approved with named changes through OAuth session `fe1bfa2e-2ade-4f76-b51a-08b1422fa6a9`: expose read retry in results, warn-and-drop unsaved deceased results, carry rescue canonical key through PATCH, accept warning clearing after explicit recovery, and update the enumerated legacy fixtures. All are incorporated above. Sol also required clearing uncertain current-run cards/selection before recovery and conservative suppression of failed same-name results because GET omits noncanonical saved keys. No new retry/state/authorization framework is added.
- [VERIFIED source review] During implementation, root and Sol identified that a malformed GET with success but omitted core arrays would invalidate the new protected-row check. Step 1 now requires the existing complete GET shape before application, with the same read-recovery behavior and production-shaped test fixtures; this adds no state or write policy.
- [VERIFIED via commits and reviews] Luna implemented the approved contract in `b757cd30c` and strengthened reconciliation coverage in `30441754d`. Root completed canonical-key, cap-absence, and deferred-GET regressions and source review. Sol approved the combined implementation and focused tests with no remaining substantive finding. Fable implementation verdict is pending.
- [VERIFIED via Luna local runs] Focused implementation tests: 10 suites / 196 tests passed before root's two additional stale-GET cases; final stream contract file: 11/11 passed. Type check, full lint, and canonical build passed. Required gates and available self-tests passed serially: api-routes, atlas, route-service-boundary, dynamics-context-boundary, reviewer-engagement-boundary, status-enum-parity, trust-boundary-guid, doc-currency, doc-symbol-refs, build-claim-freshness, docs-catalog, memory-router, secret-scan. Existing external-token guard warnings and secret-scan MaxListeners warnings were nonblocking. Full Jest and PR are pending.
- [VERIFIED via bounded Mode A reconciliation] Updated source contracts, service/utility catalog, roster Atlas contract, and roster memory for indexed outcomes and GET-derived durable membership. Historical extraction/survey baselines remain historical; broader pre-existing stage-framework documentation is outside this change. No schema, route count, or persisted status changed. This is branch evidence, not a production-state claim.
- [VERIFIED via GitHub file lists, 2026-10-01] Open PRs #392, #332, and #328 do not change the roster runtime files in this fix. Their catalog edits are separate entries; recheck overlap before merge. PR #390 remains the separate dated survey reassessment.
- [PLANNED] Rollback is revert of this runtime PR; no schema/data migration. Merge/deploy require the user's later promotion instruction.
