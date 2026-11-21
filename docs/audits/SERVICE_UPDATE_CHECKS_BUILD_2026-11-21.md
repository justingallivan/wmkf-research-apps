# Manual service update checks — November 21, 2026

Status: source-built on `codex/service-update-checks`; not published or deployed. Implementation began at `434f7f469`; follow-ups include `14afb89c4` and the final reviewed changes in this branch. Migration 108 has only been applied to isolated local test databases.

## Contract reconciliation

| Invariant | Enforcing surface | Verification |
|---|---|---|
| Only authenticated superusers check three supported services | Existing Admin route guard, closed POST payload, check-store allowlist | Route tests reject unauthenticated access and extra fields; PostgreSQL tests reject unsupported IDs before SQL |
| Checks do not complete reviews or change provider settings | Separate `external_service_checks` storage; fixed GET collectors; review draft needs explicit save | PostgreSQL service/version/review readback unchanged; UI draft makes no PUT |
| Repeated and overlapping requests are bounded | Atomic 90-second lease, token-and-expiry fenced completion, one-minute completed-result reuse | PostgreSQL conflict, expired takeover, stale-writer rejection, cooldown reuse |
| A failed source is never a successful no-change result | Independent collectSource outcomes and retained successful baseline | Invalid/oversized/failed source tests, partial success, empty billing unavailable |
| Provider credentials/account identity stay out of retained results | Server-only credentials; fixed destinations; explicit SerpAPI field projection; safe generic failures | Echoed key, email and account ID present in test response but absent from serialized output |
| Late results cannot overwrite another selected service | Client generation guard on success/error/finally; abort guard on history GET | UI selection-switch test; lost POST response recovered by GET without another provider check |
| Existing Anthropic comparison behavior is preserved | Pure `pricing-checks.js` extraction, default fetch behavior retained | Existing pricing-canary, pricing-refresh, and anthropic-admin regression suites |

Trace: Admin button → private superuser POST → check lease → independent bounded collectors → fenced latest snapshot → GET/POST DTO → plain-text panel → optional unsaved Proposed/Investigate human review. Per-source statuses are baseline, unchanged, changed, or unavailable; unknown UI statuses render unavailable. Unsupported services and extra request fields reject. No inference, email/notification, recording reprocessing, provider-setting mutation, or new schedule is part of the manual path. Those effects are N/A, rather than untested claims of successful execution.

## Verification

- 120 tests pass across nine scoped suites, including isolated PostgreSQL and existing Anthropic regressions.
- Fresh database bootstrap replayed all 105 manifest migrations and read back the checks table, migration 108 tracker, 26 services, and one review. Restoring the disposable database to pre-108 and running the canonical upgrade runner applied exactly 108 and skipped 104 existing migrations.
- Production build and type check pass. Changed-runtime ESLint: zero errors; two existing set-state-in-effect warnings in the Admin section.
- Migration manifest, API matrix, Atlas, documentation currency, fact consistency, document-symbol references, secret scan, route/service boundary, and prompt-injection tagging checks pass; available relevant self-tests ran after their gates.
- Direct unauthenticated GET probes of the fixed AssemblyAI Markdown URLs returned HTTP 200, valid expected titles, and bodies below the response cap. No private account APIs were called for this verification.

## Sources and limits

AssemblyAI checks [pricing](https://www.assemblyai.com/pricing.md) and [model guidance](https://www.assemblyai.com/llms/models.md). These are provider claims; whole-document changes can include unrelated products. Excerpts are bounded and do not promise a complete diff or quality benchmark. SerpAPI's [Account API](https://serpapi.com/account-api) documents quota-free account reads and optional renewal dates. Anthropic reuses the existing legacy Admin API comparison; unavailable credentials, unmatched billing rows, or no comparable data remain explicit failures, not a clean bill of health.

Live authenticated provider responses, hosted authorization/save/reload, and deployed behavior remain unverified for this addition. Before promotion, apply migration 108 through the canonical existing-database runner. This build neither publishes the branch nor changes live configuration.

Sweep Mode A scope: manual-check source/storage/consumer facts. Atlas page, Atlas index, API matrix, and service catalog now distinguish branch-built checks from the deployed register. The prior tracker release receipt remains historical evidence of PR #668. Current route count remains 331. No current in-scope claim says the new check runtime is deployed.

## Opus review follow-ups

Claude Opus (`claude-opus-5-5`) reviewed via verified Claude OAuth subscription authentication, with provider API credentials removed from the CLI environment and read-only tools. Marker `SERVICE-UPDATE-CHECKS-20261121-A` requested changes. Corrections: retain unreviewed changes until the next check after a human review save; exclude volatile billing dates/counts from fingerprints; retain known billing drift alongside explicit skipped-row counts; preserve review history if migration 108 is missing; immediately interrupt known failed leases; add a 10-second local pricing statement timeout. The documentation URL was verified and normalized to its current canonical destination. Additional regression tests cover these contracts and optional Anthropic transport injection. Follow-up marker `SERVICE-UPDATE-CHECKS-20261121-B` verified the prior corrections and found one remaining failure-display issue. The final changes keep pending evidence visible and reviewable through source outages, exclude blended billing percentages and routine SerpAPI renewal changes from fingerprints, and require acknowledgement after the previous check completed in database time. Regression tests cover each case. Final marker `SERVICE-UPDATE-CHECKS-20261121-C`: **approved** by Claude Opus through OAuth. See [the final review receipt](SERVICE_UPDATE_CHECKS_OPUS_2026-11-21.md). The final reviewed source passed 120 scoped tests, the production build, type checking, and applicable gates.

Simple-version acknowledgement limits: a later edit to an older review counts as a review. A saved review can also acknowledge a completed check whose POST response was lost before the reviewer saw it; reloading exposes the retained findings. The feature does not offer an explicit per-source acknowledgement ledger. These are documented limitations, not claims of exactly-once human inspection. No changes were published or applied to production.
