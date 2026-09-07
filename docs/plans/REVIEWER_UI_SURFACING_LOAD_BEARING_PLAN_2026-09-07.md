---
title: Reviewer fiscal-year surfacing load-bearing plan 2026-09-07
status: proposed
summary: "Audit and repair fiscal-year joins and labels where incomplete legacy data can hide requests or misstate reviewer-facing history."
---

# Reviewer fiscal-year surfacing load-bearing plan

## Evidence already collected

- Request Workbench is fixed in `ffeafc47`: cycle options/filtering now use `wmkf_meetingdate`, with explicit off-cycle and no-date buckets.
- Production probe [VERIFIED 2026-09-07]: active `wmkf_appgrantcycle` has 10 rows, while `akoya_request` has 100 distinct nonblank `akoya_fiscalyear` values. Historical values including `June 2020` and `December 2017` have requests but no matching active cycle row.
- Production probe [VERIFIED 2026-09-07]: sampled request data includes malformed/mismatched fiscal-year text (`December2026` on a June 2026 request). Meeting dates are populated in the sampled cohort; off-month meeting dates are common in historical data and must remain visible rather than silently dropped.

## Workstream A — load-bearing grant-cycle counts

1. Trace `pages/api/reviewer-finder/grant-cycles.js` → `lib/services/grant-cycles-dataverse.js::fetchCounts` → `akoya_request` count grouping → cycle response `proposalCount`.
2. Replace the proposal-count join on raw `akoya_fiscalyear` with canonical `wmkf_meetingdate` month windows derived from each cycle's persisted display name/meeting month. Preserve candidate counts and cycle-management writes unchanged.
3. Add a fixture test proving a request with a missing/malformed fiscal-year value still contributes to the correct June/December cycle count, and proving the old fiscal-year grouping would fail that fixture.
4. Run route/service tests plus `check:api-routes`, `check:route-lifecycle-auth`, `check:route-service-boundary`, and `check:trust-boundary-guid` because this is an API-backed read contract.
5. Owner smoke: signed-in Reviewer Finder, verify historical cycles with known requests show nonzero proposal counts and candidate counts remain unchanged.

## Workstream B — lower-risk labels and filters

1. `lib/services/expertise-finder/proposals-service.js::queryProposals` remains a request filter, so verify whether its caller can select cycles absent from `wmkf_appgrantcycle`; if yes, switch the query to a meeting-date month range and retain the response's `fiscalYear` label for compatibility.
2. `lib/services/pre-site-visit/funding-history.js` and `proposal-core-service.js` use fiscal year only for a board-facing “awarded in” label. Prefer a normalized meeting-date label when available; fall back to fiscal year only when no date exists. Add a fixture for malformed fiscal-year text.
3. `lib/services/reviewer-contact-reconciliation.js` already sorts by meeting date and carries fiscal year as bounded context. Confirm no filter/count depends on it; defer code changes unless the probe finds missing meeting dates in the relevant reviewer-linked cohort.
4. Re-probe each changed contract, update the reviewer surfacing handoff, and run component/types/Jest gates plus documentation gates for any durable fact changes.

## Explicit non-goals

- Do not rewrite Dynamics Explorer prompts, export schemas, or honorarium creation contracts in this pass; those are separate consumers with different compatibility requirements.
- Do not backfill `akoya_fiscalyear` blindly. The canonical source for reviewer cycle identity is `wmkf_meetingdate`; any data repair requires a separately authorized write plan.

## Review gate

Claude reviews this plan read-only before implementation. Codex remains implementer unless the owner reassigns a surface. No production write or deployment is part of this plan.
