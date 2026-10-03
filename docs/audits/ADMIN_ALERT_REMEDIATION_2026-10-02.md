---
title: Admin alert remediation — scoped evidence (2026-10-02)
domain: operations
kind: audit
status: deployed-verified
summary: "Source evidence and bounded private probe findings for pricing/model and transcription cleanup alerts; deployed remediation and protected runtime verification."
canonical: false
cataloged: 2026-10-02
last_verified: 2026-10-02
owner: product-engineering
related:
  - docs/MODEL_CHANGE_STRATEGY.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/postgres-transcription-pilot.md
---

# Admin alert remediation — scoped evidence

Sweep mode: **Mode A — changed facts**, delegated from contract-reconcile audit 6.
Scope: pricing-report denominators, reviewed model selection and Opus 5.5,
plus the bounded transcription cleanup observation and two documentation gate
filename collisions. At pre-promotion audit creation, runtime changes were **source-built on
`codex/admin-alert-remediation`, not deployed**. Historical/archive evidence
retains its dated boundaries; unrelated domains were not audited.

## Pre-promotion contract evidence

| Claim | Producer | Persistence / source | Consumer | Evidence / status |
|---|---|---|---|---|
| Pricing scope mismatch | Monthly pricing refresh | Old source divided organization cost by app-local `api_usage_log` counts | Drift audit/alert | VERIFIED via before/after source; numerical size/cause of live provider delta not established |
| Matched provider denominator | `anthropic-admin.js` cost and Messages usage reports | Identical 30-day window and daily model/workspace/tier/context/geography cohorts | `buildPricingAuditRows` → `model_pricing_audit` → alerts | VERIFIED via branch source; live report run NOT RUN |
| Alert safety | Pricing refresh and complete report pagination | Existing alert plus append-only audit history | Admin operations alerts | VERIFIED via source: empty/skipped comparisons preserve alert; pagination fails rather than returning partial reports; failed awaited insert cannot resolve alert |
| Cache lifetimes | Messages usage report | Separate 5m and 1h counts | Per-token-type pricing comparisons | VERIFIED via source; old app-local cache denominator removed |
| Opus 5.5 review | Local pricing/capability entries | Explicit `claude-opus-5-5` rows | Cost estimates/request shaping/discovery coverage | VERIFIED via source: $4/$20 per million tokens, 0.05× input cache-read multiplier; model review date 2026-10-02 |
| Automatic tier coverage | Live discovery → resolver | Exact or dated coverage in BOTH registries | Tier resolution | VERIFIED via source; ancestor matches excluded and original degraded fallback ids retained |
| Discovery warning boundary | Pricing canary | Global capability cutoff 2026-09-12 | New unreviewed model alert | VERIFIED via source; model-specific Opus review does not advance global cutoff |

Source paths: `pages/api/cron/pricing-refresh.js`,
`pages/api/cron/pricing-canary.js`, `lib/services/anthropic-admin.js`,
`lib/services/model-resolver.js`, `lib/services/model-capabilities.js`,
`lib/utils/model-pricing.js`. No schema change or historical audit-row rewrite
is part of this remediation. Inserts are individual awaited writes, not one
transaction; partial history is possible on failure. Baseline comparisons exclude
unsupported service tiers, regional premiums, fast mode and non-baseline context;
such billable omissions prevent a clean resolution. Provider costs are cents,
while alert amounts are rendered as dollars per million tokens.

Provider references supporting the root lane's model/report review:
- [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api)
- [Opus 5.5 overview](https://platform.claude.com/docs/en/models/opus-5-5/overview)
- [Opus 5.5 changes](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)
- [API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

## Private probe boundary

**[VERIFIED via root lane's private Production read-only probe, 2026-10-02.]**
One expired job remains: content purge and provider cleanup are marked, audio
deletion was observed, the watched input pathname is retained, and
`local_cleanup_completed` is false. There is no processing backlog. This is a
conservative late-upload watch, not evidence of readable transcript content or
an active transcription backlog. No private identifiers, paths, content, secrets,
usage counts or raw operational receipts are retained here. This docs lane did
not repeat the probe or make a live mutation.

Corrected provider cost/usage reports were **NOT RUN**: the sensitive Admin key
was unavailable to the local environment pull. Source scope mismatch is proven;
actual corrected provider comparisons and post-deployment behavior remain UNKNOWN.

## Restatements and validation

Live stale pricing restatements were structurally corrected in the infrastructure
Atlas, route security matrix, credit-monitoring memory, model-change runbook,
service catalog and credentials runbook. Production resolver assertions in the
runbook are now explicitly dated historical observations. The memory's obsolete
migration high-water assertion was replaced with the authoritative manifest
pointer. Historical cost observations and archived audits remain historical.
Unrelated caching examples and usage-ledger descriptions retain their own scope.

Two transcription Atlas filename collisions were annotated with the existing
`drain-table:ignore` reason marker in the Session Prompt and transcription Atlas;
no historical handoff fact or gate scanner was changed.

Disconfirming source checks: old app-token denominator no longer appears in the
pricing-refresh runtime; ancestor-only candidates are filtered before selection;
missing/repeated pagination tokens and pagination exhaustion throw; skipped
comparisons do not take the alert-resolution branch. Same-term durable searches
were repeated after edits. Relevant sequential gates/self-tests passed (agent invariants, API routes, Atlas,
doc currency, fact consistency, canonical pointers, drain mentions, symbol refs,
docs catalog, build claims, prompt tagging, memory router, model registry,
model warming, secrets, harness framing and types). Focused Jest coverage passed:
7 suites, 118 tests. Changed-file ESLint and diff whitespace checks passed.
A fresh independent source review approved the patch and report-completeness
hardening. The webpack production build passed; canonical Turbopack could not
build because this isolated checkout shares dependencies through an external
symlink. CI must provide the canonical build signal with installed dependencies.

Remaining live STALE in the scoped searched restatements: 0 identified.
Remaining UNKNOWN: corrected provider live run, current production effective
model resolution, deployment and operational follow-up. Verdict:
**SCOPED SOURCE AUDIT COMPLETE; production execution pending owner promotion.**

## Promotion and rollback

This runtime branch requires a deliberate owner decision before merge/push to
`main` under the campaign release strategy. Before promotion, review current-head
CI and rehearse the matched provider reports using the protected production
runtime, where the Admin key is available; no private content or generated model
request is required. After promotion, run pricing refresh and the model canary,
then read back audit/alert state. Preserve standing alerts if evidence is partial.
The transcription late-upload watch remains intentionally open; no cleanup safety
contract was changed.

[VERIFIED via Vercel production deployment inventory, 2026-10-02] The READY
production baseline is commit `6f759ef094435d6c6134e522443f9bec630f72d1` at
`wmkfresearchapps-1tif2ht07-justin-gallivans-projects.vercel.app`.
If this patch causes model/request or pricing-check failures after promotion,
restore that deployment with the platform rollback control, verify aliases and
cron health, then revert this branch's runtime commit through a reviewed PR.
No migration or audit-history rollback is required. This rollback paragraph was recorded before promotion; the production milestone
is now recorded in DEVELOPMENT_LOG.md.

## Production outcome — 2026-10-02 PT

[VERIFIED via GitHub checks/merge, Vercel deployment and read-only Postgres
maintenance/alert receipts] All PR #420 checks passed, including canonical build
and full tests. The owner explicitly authorized merge after CI passed. Merge
commit `a829ba94c6f5df071efd1f1065e4cf2b29d2482c` is READY in Production at
`wmkfresearchapps-o55ex8qx0-justin-gallivans-projects.vercel.app`, deployment
`dpl_7j1s4yFvR7pEfve4wra7teUygLKb`. The protected platform triggered both
pricing-refresh and pricing-canary; both completed. Pricing refresh produced
15 comparisons with no flagged drift and auto-resolved the standing pricing alert.
This establishes the corrected audit outcome, not exact retrospective attribution
of every old inflated estimate.

The latest canary reports `claude-sonnet-5-5` as the remaining unreviewed model;
Opus 5.5 is covered. Sonnet 5.5 is excluded from automatic tier selection. The
existing keyed alert retains its original Opus wording because AlertService
reuses open alerts without updating their payload; maintenance-run details are
the current diagnostic evidence. No manual alert clearance or registry-wide
review cutoff advancement occurred. Reviewing Sonnet 5.5 is separate follow-up.
The conservative transcription watch remains intentionally open.

The pre-promotion UNKNOWN and pending statements above describe the audit at
creation. The protected pricing/model runs and deployment are now verified;
actual effective model resolution and calendar-triggered cleanup closure remain
unverified. No migration or content-bearing external request was needed.
