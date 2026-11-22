# Cloudmersive public pricing and limit checks

Status: deployed via PR #678, merge `12b0733f17e669ef1888cc55fec3f9f291dafa15`. Migration 112 is applied to production via the canonical runner at 2026-11-22T03:52:15Z (one applied, 108 skipped); tracker and constraint readback passed. Production deployment `dpl_7QtLNzqrgg1r7u58pSx5wPp57t2B` is Ready and serves the production aliases. This feature is public-reference monitoring, not account billing integration.

## Contract and evidence

| Invariant | Source and verification |
|---|---|
| Manual superuser action only | Existing Admin POST `action: check` route; actor from authenticated profile; no new route or cron |
| No scans, keys or account requests | Fixed public pricing URL; no request headers with credentials; unit fixture includes a secret and asserts exclusion |
| Independent price/limit results | One per-invocation HTML read, separate collectors and fingerprints; malformed price succeeds for limits and missing qualification succeeds for prices |
| Unsupported data is not unchanged | Explicit extraction/shape/cap checks plus existing retained baselines; malformed/oversized/failed-read regression tests |
| Public limits are not remaining quota | Persistent manual-verification notice and portal link, plus evidence/summary text; UI test before check, on failure and reload |
| Existing persistence survives | Migration 112 expands only the supported-ID constraint; isolated PostgreSQL tests preserve prior snapshot, persist/reload new service and leave its metadata unchanged |
| No human review or provider change | Existing separate check storage and unsaved draft contract; UI test asserts no PUT; upload and scan code untouched |

Entry is `ExternalServicesSection.js` → existing superuser API → `checks.js` → per-source collector → token-fenced `external_service_checks` snapshot → POST/GET DTO → `ExternalServiceCheckResults.js`. No new status enum, table or API route is introduced. Existing generation/abort guards prevent late UI updates after selection changes. Source failures preserve independent successful baselines; pending findings remain pending until an explicit human review under the existing contract. The new helper is limited to this provider's public parsing. No background or streaming path is added.

## Public source boundary

[VERIFIED via public HTML retrieval, 2026-11-21] The [pricing page](https://cloudmersive.com/pricing-small-business) server-renders plan cards, selected USD currency, monthly prices, call capacities, rate/compute limits, file sizes and three qualifying footnotes. The parser accepts 2–20 uniquely named cards including Free Tier and Basic, sorts by name, and validates each projected field. Unknown shapes fail rather than infer. Qualifications are fingerprinted and split into bounded text lines rather than truncated. All output is rendered as text; no scraped HTML is rendered. Published prices and limits may not match negotiated or grandfathered account entitlements.

[UNKNOWN] No supported public account-usage/quota endpoint was established during research. Cloudmersive's [analytics documentation](https://api.cloudmersive.com/api-analytics.asp) describes portal views and optional exports. This is not a claim that no private/enterprise endpoint exists. No authenticated account probe or metered scan was made.

The older credentials runbook's free-tier allowance is not used by this implementation. Current public page values are observations, never proof of this account's plan. Reconciling account entitlements and unrelated historical credential documentation is outside this feature's scope.

## Validation and release boundary

The focused unit/UI/PostgreSQL run passed 99 tests, covering migration expansion, independent comparisons, retained failures, pending changes, manual-verification messaging and excluded provider content. Scoped ESLint and TypeScript passed. Both a downloaded live public response and a direct network read through the actual bounded collectors passed (15 plans; 16 pricing lines and 20 limit/qualification lines). The production build and relevant migration, Atlas, API-route, documentation and secret-scan gates/self-tests passed. Signed-in production Admin verified both public sources at 2026-11-21 20:03:40 Pacific. Both saved baselines; reload returned the same timestamp and evidence. Published qualifications were expanded and checked, and the manual account-verification notice remained visible. No scan, account request or human-review save was made.

All PR checks passed before merge, including the full Jest suite, PostgreSQL integration, build, repository gates and security analysis. Migration 112 preceded deployment; signed-in check and persisted reload passed. No credential setup is needed. The initial ordinary Claude Opus OAuth review found one medium display issue and smaller parser/wording issues. Corrections retain all bounded prior Cloudmersive evidence, reject dropped cards and nested qualifications, preserve explicit qualification markers, distinguish public fetch failures from credential problems, validate the monthly toggle, and use public-only review-draft wording. Regression cases cover late-plan changes, compute-based/unlimited limits, CSS drift, HTTP 403 and annual defaults. The focused follow-up Opus OAuth review confirmed the corrections and found no remaining medium/high issues. Its optional marker-drift and draft-test suggestions were also addressed: expected row and qualification markers now fail closed if moved/removed, and a UI test verifies public-only review evidence. No API-key agent calls or metered review product were used.
