# Neon Marketplace manual check — implementation receipt

Status: deployed via PR #676, merge `f6f5554a1941be8eba3af02ade9c020c4fb85dff`. Migration 111 is applied to production through the canonical runner (one applied, 107 skipped); constraint readback includes Neon. Production deployment `dpl_E6w9H2QbaNpn8CVWrPErWKarpatc` is Ready and serves the production aliases. Account identifiers, database names, tokens and private amounts are intentionally omitted.

## Evidence and API boundary

[VERIFIED via read-only Vercel CLI and signed-in Vercel Marketplace UI, 2026-11-21] Neon is billed through the team's Vercel Marketplace installation. The customer configuration list (`GET /v1/integrations/configurations?view=account`) discovers its installation. The [customer configuration endpoint](https://vercel.com/docs/rest-api/integrations/retrieve-an-integration-configuration) returns plan details and provider-reported current-period spending matching the Marketplace display. The observed `billingPlan`, `billingData.spending` and aggregate billing fields extend the documented response schema; availability is not guaranteed by that schema.

The hosting check's `/v1/billing/charges` FOCUS feed had no Neon or Marketplace records in read-only seven-day and 45-day probes. This establishes absence in the observed windows, not a permanent API guarantee. Neon is therefore checked separately. A partner resources endpoint rejected customer access; the implementation does not use partner APIs or request a Neon integration credential. Paid invoice retrieval/history was not established and is not implemented.

## Contract and invariants

| Invariant | Implementation / verification |
|---|---|
| Existing superuser boundary and actor attribution | Existing Admin POST `action: check` route; no new route or identity input |
| Discovery cannot redirect secrets or cross teams | Fixed Vercel origin, no redirects, explicit team, validated installation ID and matching returned ownership; unit tests |
| Checks remain manual and read-only at providers | Only two GETs, shared within one invocation; no cron, model invocation or provider write |
| Plan and spending fail independently | Two source collectors; shared transport, independent parsing and retained baselines; unit tests |
| Usage movement does not create price changes | Scope-only spending fingerprint; full quoted plan fingerprint; unit tests |
| Partial/error results cannot erase prior success | Existing source baseline and lease fencing; malformed spending, abort and independent failure tests |
| Existing state survives schema expansion | Migration 111 only expands the constraint; isolated PostgreSQL tests preserve a pre-existing snapshot, persist/reload Neon and leave service data unchanged |
| Consumer renders persisted results without saving a review | UI test checks POST and GET reload with distinct persisted text; no PUT |
| Private metadata is discarded | Explicit projected billing fields; fixtures contain excluded secrets and identifiers and assert exclusion |

The existing 90-second lease, 60-second reuse interval, 35-second overall timeout, 12-second requests, 1 MiB responses and 200,000-byte snapshot cap remain. Ambiguous installations and unsupported/oversized shapes are unavailable, never inferred as zero. Spending line totals minus discounts must match reported cents and the outer total. Provider updates older than 48 hours or ended periods require attention. Existing UI generation guards reject late selection results. New helper extraction is limited to Neon discovery/parsing; other provider semantics are unchanged. No new enum status, table, route or background workflow is added.

## Verification and release

[VERIFIED] Five focused Jest suites passed 142 tests, including PostgreSQL migration/persistence and UI reload. Scoped ESLint and TypeScript checks passed. The tracked read-only `scripts/probe-neon-service-checks.cjs --cli-scope=<team-slug>` feeds live CLI responses through the actual collectors; plan and spending both returned successful baselines without attention. The probe writes no service snapshot and never reads CLI credentials.

[VERIFIED via signed-in production Admin, 2026-11-21 18:57 Pacific] The app token successfully read both the Neon plan and reported-period spending. Both sources saved baselines, with no unavailable or attention result. Reload check results returned the same check timestamp (2026-11-22T02:57:11Z), plan and spending, proving persisted readback. The existing Vercel token is reused; no extra credential was provisioned. All PR checks passed before merge, including the full Jest suite, PostgreSQL integration, security analysis, build and repository gates. No human review was saved.

Documentation reconciliation scope is the new Neon contract and the touched Atlas page. Older service-catalog release labels and unrelated project status documentation were not audited; no whole-repository currency claim is made. Existing build-time receipts retain historical evidence, not authority over current deployment state.


## Independent review

An ordinary Claude Opus review ran read-only through the existing Claude.ai OAuth subscription on 2026-11-21; no API-key model calls or metered review product were used. It found no blockers or medium-severity issues. Low-severity findings were addressed: amount-first evidence avoids truncating charges; decimal line totals aggregate exactly before rounding; disabled installations and missing credentials have accurate messages; fingerprinted plan identity/type/scope are visible; a reconciled zero-charge empty period is accepted. Added regression tests cover the arithmetic, zero period and visible fields. The Atlas omission noted during the review was corrected. The subsequent signed-in production check established app-token access as recorded above.
