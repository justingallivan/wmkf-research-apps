---
title: Reviewer Institution COI Precision Plan
domain: reviewer-finder
kind: plan
status: active
summary: "Make institution-COI drops observable, then tighten the COI matcher without changing save policy."
canonical: false
cataloged: 2026-07-03
owner: product-engineering
related:
  - docs/REVIEWER_GATING_STRATEGY_REDESIGN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - scripts/probe-institution-coi-breakdown.mjs
---

# Reviewer Institution COI Precision Plan

## Scope

This is the Contract 5 follow-up for the reviewer-finder institution-COI gate. Phase A and Phase B are implementation scope. Phase C is policy/spec only and must not be enabled in this change.

## Evidence

- [VERIFIED via `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`] S321 found that discovery-time institution-COI drops are structurally invisible because dropped candidates never reach `reviewer_find_roster`; the 120-day probe saw 520 roster candidates, 0 top-level `hasInstitutionCOI`, and 0 ORCID-vs-OpenAlex contradictions, while the offline matcher suite false-positived on 7/10 distinct-institution pairs and missed 0/3 same-institution pairs.
- [VERIFIED via `pages/api/reviewer-finder/discover.js:302`] Track A hard-drops institution-COI candidates with `DeduplicationService.filterConflicts` before the response is returned. The referred-seed path uses the same helper before referred candidates are appended to the selectable set.
- [VERIFIED via `lib/services/discovery-service.js:272`] Track B hard-drops institution-COI candidates inside `DiscoveryService.discover` before `discover.js` sees them.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:198`] The save route still rejects top-level or post-enrichment institution COI, increments `rejectedInstitutionCOI`, and writes no Dataverse rows.
- [VERIFIED via `lib/services/deduplication-service.js:271`] `markInstitutionCOI` already produces the compact soft-flag DTO `{ hasInstitutionCOI, institutionCOIDetails: { piInstitution, reviewerInstitution } }` used by enrichment/recommended paths.
- [VERIFIED via `lib/services/reviewer-roster-store.js:210`] The roster read path renders only `status='active'` as selectable and `status='excluded'` as recoverable. Other statuses still contribute to `allNames`, the cross-run dedup union.
- [VERIFIED via `lib/db/migrations/020_reviewer_find_roster.sql:44`] `reviewer_find_roster.status` is CHECK-constrained to `active | excluded | saved`; a distinct `coi_dropped` status requires a narrow constraint migration.
- [VERIFIED via `rg`] Product callers of `DeduplicationService.institutionsMatch` / `normalizeInstitution` are internal to `deduplication-service.js`; `lib/fundingApis.js` and `lib/services/dataverse-export/disclosure.js` have separate matchers and are out of scope.

## Phase A - Durable Discovery-Drop Ledger

Goal: add observability with no policy change.

Build:

- Add `coi_dropped` to the `reviewer_find_roster.status` constraint with a small Postgres migration and update the fresh-install/migration docs that describe the allowed status set.
- Add a `recordCoiDropped(requestId, candidates, options)` helper in `reviewer-roster-store`.
- Write only a compact pruned candidate blob plus COI details:
  - `name`, current affiliation, provenance/source kind, `hasInstitutionCOI: true`.
  - `institutionCOIDetails.piInstitution` and `institutionCOIDetails.reviewerInstitution`.
  - `institutionCOIDetails.matchSource` or equivalent source metadata so the ledger explains which drop site wrote it.
- Call the helper at the Track A and referred-seed drop sites in `discover.js` when `requestId` is present.
- Extend `DiscoveryService.discover` to return the Track B institution-COI dropped candidates in an internal result field, then record them from `discover.js`. This keeps persistence in the route where `requestId` is available and avoids making the service own request-scoped Postgres writes.
- Preserve display/save behavior: `listForRequest` keeps `coi_dropped` out of `active` and `excluded`, while `allNames` includes it so future runs do not re-surface the same name.
- Extend `scripts/probe-institution-coi-breakdown.mjs` to report `status='coi_dropped'` ledger counts and details.

Tests:

- Unit-test `recordCoiDropped`: status is `coi_dropped`, candidate is pruned/compact, COI details survive, nameless candidates are skipped, and `recordSurfaced` cannot reactivate a `coi_dropped` row.
- Unit-test `listForRequest`: `coi_dropped` contributes to `allNames` but not `active`/`excluded`.
- Unit-test `discover.js` only if existing route test seams make it cheap; otherwise store/helper tests plus existing route coverage are the focused regression guard.

UI decision:

- Defer the optional collapsed "excluded for institution COI" UI in Phase A. The current read contract already makes `coi_dropped` non-selectable and non-promotable. Adding a visible read-only bucket would touch React state/render/tests beyond the minimum observability change.

## Phase B - COI Matcher Precision

Goal: tighten only the institution-COI path.

Build:

- Keep `institutionsMatch` available for any non-COI future dedup semantics, but add a dedicated `institutionsMatchForCOI` and use it from `markInstitutionCOI` and `filterConflicts`.
- `institutionsMatchForCOI` keeps:
  - exact normalized match,
  - abbreviation expansion,
  - exact key-word set equality.
- `institutionsMatchForCOI` removes:
  - bare string containment,
  - broad subset matching with conflict-word exceptions,
  - string-similarity fallback for COI.
- Add narrow campus-qualifier containment for same-system campus suffixes, specifically cases shaped like `University of Michigan, Ann Arbor` vs `University of Michigan`, without making `University of Maryland` match `University of Maryland, Baltimore County` or `University of California, Berkeley` match `University of California, San Francisco`.
- When both sides carry OpenAlex/ROR institution ids, compare ids first. If both sides have ids and they differ, return no match; if they match, return match. If only one side has an id, fall back to name precision rules.
- Accept PI institution inputs as either strings or structured objects while preserving current string callers. Reviewer affiliation ids are optional and can come from candidate/enrichment fields when present.

Tests:

- Land the S321 curated 10 distinct pairs and 3 same-institution pairs in `tests/unit`.
- Add id-first tests: equal OpenAlex/ROR ids match even when names differ; conflicting ids do not match even when names would otherwise match; one-sided ids fall back to name rules.
- Existing current-only institution COI tests continue to pass.

## Phase C - Provenance-Gated Flag-Not-Drop Spec Only

Do not build Phase C in this change.

Spec: after Phase A has durable evidence and Phase B reduces obvious false positives, the owner can decide whether some low-corroboration institution matches should become non-selectable flags instead of hard drops. The likely shape is provenance gated:

- hard-drop when same-institution is corroborated by high-trust current affiliation or matching institution ids,
- flag-not-drop when the match comes from a single stale/OpenAlex-only affiliation string and contradicting ORCID/current-affiliation evidence exists,
- keep the save route fail-closed unless the owner approves an explicit staff override workflow.

Phase C needs a policy decision because it changes which candidates become visible to staff, not just how observability and precision work.

## Rollout

- Apply the migration with the normal existing-DB migration path (`node scripts/apply-migrations.js`) before relying on `coi_dropped` in shared environments.
- No env flags are introduced or toggled.
- Phase A is safe to roll out independently: it records already-dropped rows only.
- Phase B changes the COI predicate, so deploy with the unit matcher suite and probe output reviewed. Re-run the 120-day probe after enough searches accumulate ledger rows.

## Non-Goals

- No Dataverse writes or schema changes.
- No change to the save route's institution-COI rejection policy.
- No changes to `lib/fundingApis.js` or `lib/services/dataverse-export/disclosure.js` matchers.
- No broad reviewer-finder gate redesign beyond Contract 5.
- No Phase C behavior change.

## Residual Risks

- The ledger is name-keyed like the roster; two people with the same normalized name on the same request still collide.
- If `requestId` is absent or invalid, discovery can still hard-drop without a ledger row because the roster is request-scoped.
- Institution ids are sparse in current PI/candidate DTOs. The id-first branch improves precision when ids are present but most comparisons still use names.
- Campus-qualifier handling is intentionally narrow; some true same-institution variants may still be missed until real ledger examples justify adding aliases.
- Phase A records candidate blobs after pruning, so raw provider payloads remain unavailable for forensic review by design.

## Self-Adversarial Review

Findings before implementation:

- [FIXED IN PLAN] The brief suggested "prefer existing status column" and "no schema migration unless truly required." Live migration 020 CHECK-constrains status to three values, so a distinct `coi_dropped` status requires a narrow constraint migration. The plan now includes it.
- [FIXED IN PLAN] The Track B drop site has no `requestId`, so `DiscoveryService` should not write the roster directly. The plan now has Track B return dropped candidates to `discover.js`, where the route can persist them when request-scoped.
- [FIXED IN PLAN] Changing `institutionsMatch` directly could affect future/non-COI dedup semantics even though live product callers are currently internal. The plan now splits a COI-specific matcher and updates only COI call sites.
- [FIXED IN PLAN] A visible UI bucket is optional and not needed for the ledger invariant. The plan now defers it to keep Phase A narrow and avoid accidentally creating a recover/promote path for hard-dropped candidates.

Material deviations from the initial trace:

- The roster status column is not only present; it is CHECK-constrained. This makes a migration required for the requested distinct status.
- Track B is currently code-dormant (`TRACK_B_ENABLED=false`), but the drop path still exists and will be instrumented so the contract remains correct if Track B is re-enabled.
