---
title: "Review-synthesis lifecycle implementation audit — 2026-07-28"
domain: reviewer-workbench
kind: audit
status: active
summary: "Evidence-first reconciliation of the release-pending readiness, currentness, manual override, and automatic synthesis implementation."
canonical: false
fact_consistency: point-in-time
owner: product-engineering
related:
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Review-synthesis lifecycle implementation audit — 2026-07-28

## Scope

This Mode-A `/sweep` audit reconciles the fact that the owner-approved
review-synthesis lifecycle is implemented on
`codex/review-synthesis-lifecycle`. It covers the caller → persistence →
consumer contract, automatic retry/deduplication behavior, and durable current
guidance. It does not claim deployment, migration application, environment
enablement, or a signed-in live smoke.

## Evidence matrix

| Claim | Source and contract evidence | Verdict |
| --- | --- | --- |
| Readiness is fail-closed | `review-synthesis-readiness.js` classifies selected, invited/accepted, non-excluded participants; unknown/malformed lifecycle or token dates block. Focused readiness tests cover receipts, terminal outcomes, revoked/expired tokens, active invites, replacement tokens, exclusions, and malformed state. | **VERIFIED in tracked source/tests** |
| Currentness binds to exact inputs | `review-synthesis-content.js` builds the shared digest; readiness hashes that content plus lifecycle classifications. `getReviewSynthesisJobState` requires a completed row with the same request and hash. | **VERIFIED in tracked source/tests** |
| Manual early generation is deliberate | Reviews UI confirms an early run, the route accepts only boolean `confirmEarly`, and the service rejects unresolved participants unless it is true. Every manual run starts a leased ledger row before the Executor call. | **VERIFIED in tracked source/tests** |
| Automatic generation is bounded and race-safe | `/api/cron/drain-review-syntheses` is inert unless the rollout flag is exactly `true`. The drain fails closed on a capped scan, uses `FOR UPDATE SKIP LOCKED`, and revalidates readiness/hash before generation. Retryable failures stop after three claims; terminal dedupe rows are not silently reopened. | **VERIFIED in tracked source/tests** |
| Synthesis content remains in Dataverse | `review_synthesis_jobs` stores request/hash/mode/status/lease/error/run metadata and no review text. Executor persists the bounded JSON memo to `akoya_request.wmkf_reviewsynthesisjson`. | **VERIFIED in tracked source/migration** |
| Partial success is explicit | If Executor persistence succeeds but ledger completion fails, the service returns a 502-class partial error with `writtenToDynamics:true`; it does not report the operation as wholly failed or silently successful. | **VERIFIED in tracked source/tests** |
| Stored output remains visible | The reviewers DTO retains a proposal even with zero accepted rows. `ReviewsTab` renders stored synthesis independently of submitted count and labels it Current/Stale, while job lookup failure degrades to unavailable/stale without hiding review content. | **VERIFIED in tracked source/tests** |
| The Postgres ledger exists in production | Read-only `SELECT to_regclass('public.review_synthesis_jobs')` returned `NULL` on 2026-07-28. | **CLAIM NOT SUPPORTED — migration is not live-applied** |
| Automatic generation is live | The feature branch is not deployed; environment enablement was not asserted or changed. | **CLAIM NOT SUPPORTED — release pending** |

## Producer → persistence → consumer reconciliation

1. Manual producer: `ReviewsTab` → guarded
   `/api/review-manager/synthesize-reviews` → readiness/fingerprint →
   leased manual job → shared Executor → Dataverse memo + AI-run audit →
   lease-conditional ledger completion.
2. Automatic producer: authenticated, feature-gated cron → global participant
   scan → ready fingerprint enqueue → leased claim → readiness/fingerprint
   revalidation → the same synthesis service/Executor → Dataverse memo + job
   completion.
3. Consumer: guarded `/api/review-manager/reviewers` reads the Dataverse memo,
   recomputes the same fingerprint, fail-soft reads latest/matching ledger
   state, and returns `proposal.reviewSynthesisState` to `ReviewsTab`.

## Durable surfaces reconciled

- `docs/APPLICATION_STATE_ATLAS.md` and
  `docs/atlas/postgres-infra-tables.md`
- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/CREDENTIALS_RUNBOOK.md`
- `docs/CURRENT_WORK_QUEUE.md`
- `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`
- `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`
- `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
- `docs/DOCS_CATALOG.md`

Historical point-in-time audits were not rewritten.

## Verdict

**RECONCILED for tracked implementation truth.** The lifecycle contract is
implemented and focused-test-proven, but release completion is intentionally
open. Required rollout order is: apply migration 028 deliberately; deploy with
automation disabled; verify the manual/read-only UI and ledger; enable the
automatic flag; then run a bounded signed-in smoke and inspect job, AI-run,
Dataverse memo, maintenance-run, and logs before declaring the lifecycle live.
