# Integrity production release — 2026-11-02

Owner authorized migration, merge and deployed production dry-run, with explicit STOP before first publication and monthly schedule left off. Source and retention policy passed OAuth-only Fable review/closure. This receipt tracks the live operation; earlier implementation/preflight receipts are historical checkpoints.

## Verified migration

Canonical `node scripts/apply-migrations.js` applied only 092: 1 applied, 90 skipped, 91 total. Tracker applied_at `2026-11-02T19:34:27.096Z`, applied_by `owner-approved-integrity-rollout-2026-11-02`. Production target is Neon app project falling-surf-05640504 / neondb, verified against Production Vercel URLs. Before applying, scoped backup archive/checksum/restore proof and full current corpus hash were checked, only 092 was pending, and no corpus lock was present.

Readback: publisher and subject TEXT; dataset singleton table includes source_row_count and retained_records, zero rows. Corpus remains **68,248**, full ordered-row SHA-256 `258a50be7c5d41983f611fb39192e90d9af42ca1b2d891aafed71cb6935184a9`, identical before/after and to the verified backup. No corpus refresh/publication was performed. `scripts/release-retraction-migration.cjs` records the target/backup/pending-set/readback guards and invokes the canonical runner; it does not import data or call the worker.

## Promotion and dry-run boundary

Release source is isolated from the dirty main checkout. Current main was merged into the feature branch; only SESSION_PROMPT.md and DEVELOPMENT_LOG.md came in. PR checks and production promotion are in progress. The approved manual dry-run requires the literal production-only RETRACTION_REFRESH_ENABLED=on flag in its deployment; setting that flag does not register a schedule or invoke publication. Existing bearer secret is handled only in memory/private temporary env files, never printed or supplied as a shell argument. Every authorized refresh request in this release must include dryRun=1. Publication requires a later explicit owner approval.

Live deployment/check receipts and actual dry-run diff will be recorded after execution. Recheck corpus hash/count, empty publication metadata, successful dry-run maintenance receipt, retained manifest and absent cron after the call. If the call fails or is uncertain, inspect authoritative state before any retry. No non-dry-run request is authorized.
