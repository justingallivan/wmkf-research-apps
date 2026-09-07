---
title: Reviewer fiscal-year surfacing load-bearing plan 2026-09-07
status: proposed
summary: "Audit and repair fiscal-year joins and labels where incomplete legacy data can hide requests or misstate reviewer-facing history."
---

# Reviewer fiscal-year surfacing load-bearing plan

## Evidence already collected

- Request Workbench is fixed on this branch in `ffeafc47` [VERIFIED via branch history]; it is pushed but not merged to `main`. Cycle options/filtering now use `wmkf_meetingdate`, with explicit off-cycle and no-date buckets.
- Production probe [VERIFIED 2026-09-07]: active `wmkf_appgrantcycle` has 10 rows, while `akoya_request` has 100 distinct nonblank `akoya_fiscalyear` values. Historical values including `June 2020` and `December 2017` have requests but no matching active cycle row.
- Production probe [VERIFIED 2026-09-07]: sampled request data includes malformed/mismatched fiscal-year text (`December2026` on a June 2026 request). Meeting dates are populated in the sampled cohort; off-month meeting dates are common in historical data and must remain visible rather than silently dropped.

## Workstream A — load-bearing grant-cycle counts

1. Trace `pages/api/reviewer-finder/grant-cycles.js` → `lib/services/grant-cycles-dataverse.js::fetchCounts` → `akoya_request` count grouping → cycle response `proposalCount`.
2. Define the count contract before changing code: `proposalCount` counts only proposal requests (`wmkf_request_type eq 100000001`), while candidate counts remain unchanged. Count every proposal exactly once across canonical cycle buckets, an explicit off-cycle/unmatched-cycle bucket, and a null-meeting-date bucket; expose the sum as `unassigned.proposalCount` where no cycle row can represent it.
3. Parse cycle names with a strict month/year parser. Since `wmkf_appgrantcycle.wmkf_meetingdate` is currently not populated or selected [VERIFIED via `lib/services/grant-cycles-dataverse.js:93-109` and `:226-250`], use validated `wmkf_displayname`/`wmkf_fiscalyearcode` as the temporary cycle-side source and route unparseable names to the unmatched bucket. Do not claim the cycle table has a canonical date until a separately authorized data/schema change supplies one.
4. Use the canonical `lib/utils/cycle-code.js` month-window helper for June/December ranges; use adapter-owned FetchXML or a bounded per-cycle query for the proposal aggregation, and document the 50,000-row aggregate ceiling/failure mode. Keep all Dataverse transport behind the DAL and interlock.
5. Add route/service fixtures that prove: malformed/missing fiscal-year text still counts by meeting date; honorarium/non-proposal rows do not inflate proposal counts; unparseable cycle names are represented; and conservation holds (`sum(per-cycle + off-cycle + null) === total proposal aggregate`). Pin the request filter field and FetchXML/query shape so the old fiscal-year grouping fails the test.
6. Replace the stale route comment claiming every request has a fiscal year and update durable join documentation (`wmkf_app_grant_cycle` schema/Atlas, migration plan, and W4 reconcile contract) to the actual meeting-date/count contract.
7. Owner smoke: use the signed-in Reviewer Finder API consumer that exists today (or `scripts/smoke-grant-cycles-dataverse.js`/`scripts/acceptance-w3.js` if no UI consumer is restored); verify historical cycles with known requests show nonzero proposal counts, candidate counts remain unchanged, and unassigned proposal counts reconcile.

## Workstream B — lower-risk labels and filters

1. `pages/expertise-finder.js:658-666` generates June/December choices client-side from 2020 through the current year, so the caller can select cycles absent from `wmkf_appgrantcycle` [VERIFIED via Claude review]. Do not switch its filter to meeting-date until an explicit off-cycle/other-date UX bucket is designed; otherwise off-cycle records become unreachable. When changing the filter, use `odata.eq` for any retained text fallback and the canonical month-window helper.
2. `lib/services/pre-site-visit/funding-history.js` and `proposal-core-service.js` use fiscal year only for a board-facing “awarded in” label. Prefer a normalized meeting-date label when available; fall back to fiscal year only when no date exists. Add a fixture for malformed fiscal-year text.
3. `lib/services/reviewer-contact-reconciliation.js` already sorts by meeting date and carries fiscal year as bounded context. Confirm no filter/count depends on it; defer code changes unless the probe finds missing meeting dates in the relevant reviewer-linked cohort.
4. Re-probe each changed contract, update the reviewer surfacing handoff, and run relevant gates sequentially with each self-test: `check:api-routes`, `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:trust-boundary-guid`, `check:dataverse-access-layer`, `check:odata-escape`, and `check:dynamics-context-boundary`, plus types/Jest and documentation gates.

## Explicit non-goals

- Do not rewrite Dynamics Explorer prompts, export schemas, or honorarium creation contracts in this pass; those are separate consumers with different compatibility requirements. Explicitly exclude honorarium rows from Workstream A proposal counts rather than assuming their fiscal-year derivation makes them proposals.
- Do not backfill `akoya_fiscalyear` blindly. The canonical source for reviewer cycle identity is `wmkf_meetingdate`; any data repair requires a separately authorized write plan.

## Review findings incorporated

- Claude review [VERIFIED from the owner-provided review]: B1–B8 were blocking. The revised plan adds conservation/unassigned buckets, proposal-type scoping, strict cycle-name parsing, an explicit transport/gate choice, real smoke targets, the Expertise Finder off-cycle warning, canonical helper reuse, durable-doc reconciliation, and paired self-tests.

## Review gate

Claude reviews this plan read-only before implementation. Codex remains implementer unless the owner reassigns a surface. No production write or deployment is part of this plan.
