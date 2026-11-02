# Retraction Watch managed dataset metadata

**[SOURCE-BUILT, NOT DEPLOYED — 2026-11-02]** Migration `092_retraction_dataset.sql` adds `retraction_dataset`, a singleton Postgres reference-data publication record. Read-only production preflight confirmed 68,248 rows, migration 092 pending and metadata absent; no corpus/schema changes were made. See [production preflight](../audits/integrity-production-preflight-2026-11-02.md).

## Producer and persistence

`lib/services/retraction-refresh-service.js` downloads the official Crossref GitLab CSV, validates every row, and bulk-loads TEMP `retraction_refresh_stage` inside one advisory-locked transaction. The stage has no durable rows and is dropped by commit/rollback. Keyed merge preserves existing `retractions.id`; source removals are counted and refused when any foreign key references the corpus. More than a 10% row-count drop requires operator review. No screening history or staff decisions are rewritten.

The transaction publishes corpus changes and `retraction_dataset` together: singleton key 1, monotonic generation, SHA-256 of the actual downloaded bytes, fixed source URL, optional source revision, row count, format version, publication time and last successful full-source check time. Repeated identical bytes do not republish or change generation/publication time; only last_checked_at advances. A→B→A increments generation each changed publication. No metadata row is invented for legacy corpus data.

Migration 092 widens `retractions.publisher` and `subject` to TEXT. The official CSV inspected on 2026-11-02 has maximum lengths 500 and 263 respectively, exceeding the old VARCHAR(255) declarations. Other constrained columns fit that source sample; the service checks actual target widths before COPY and never truncates fields.

`maintenance_runs` records each attempt and safe counts/checksum/header diagnostics. Metadata is authoritative even if post-commit audit logging fails; the response marks auditRecorded=false and an existing system alert is attempted. A lost COMMIT acknowledgement is publication-uncertain, never a claim that the old corpus was preserved. Resource cleanup cannot turn a known committed publication into a failed import.

## Consumers

`lib/services/retraction-dataset.js` reads the publication before and after all people’s corpus queries in `IntegrityService.screenApplicants`. Stable managed generations are saved in each person's `sources.retraction_watch.dataset`; a changed/unverifiable generation clears provisional corpus matches and marks every person's corpus source incomplete before saving or emitting final results. There is no transaction across paid provider calls. The final whole-run event is authoritative for the standalone UI/export and Workbench persistence.

Absent schema or an unpublished singleton is explicit unrecorded provenance, not fabricated metadata. Existing runs keep unknown provenance. A metadata-query failure is unverified and blocks a new approval through explicit source errors and the current-policy dataset validation predicate. UI/history/PDF/Markdown/JSON expose the recorded generation/checksum and publication/check dates; a 45-day freshness warning is based on the last successful full-source check, not the last changed publication. Staleness alone adds no funding/progression/approval gate.

## Operational boundary

The new `/api/cron/refresh-retractions` worker requires a strict bearer secret, `VERCEL_ENV=production`, and literal `RETRACTION_REFRESH_ENABLED=on`. There is no development bypass. The worker is disabled by default; **no cron schedule is registered**. Planned activation is `0 6 1 * *` only after a separately approved initial production refresh/readback. `vercel.json` sets the worker's duration ceiling only, not a schedule.

`scripts/rehearse-retraction-refresh.cjs` defaults to dry-run and requires an explicit loopback-only scratch connection; it never loads app credentials. The legacy `scripts/import-retraction-watch.js` refuses once the managed metadata schema exists. Initial cutover must also prove no previously started legacy import or external scheduler remains active. Out-of-protocol raw SQL writers cannot be covered by the generation guarantee.

## Verification and remaining prerequisites

**[VERIFIED via isolated execution, 2026-11-02]** The full official CSV contained 73,519 records / 67,793,090 bytes, SHA-256 `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`. A temporary loopback Postgres 18.6 rehearsal published it in 11.9 seconds and verified the unchanged-file path; twelve real-database tests covered publication/dry-run/rollback/locking/protected removals/audit failure/A→B→A fencing/schema. This is not a production row count or production performance claim. A separate actual service download completed in 12.5 seconds with identical byte count.

Fable review and source gates/build passed. Production target/schema/reference checks and seven-day PITR coverage are verified in the preflight receipt; tested scoped recovery, external-writer quiet window, owner-approved migration and controlled initial refresh remain prerequisites. Monthly cron activation is a separate later commit and approval. Full provider-backed screening and production freshness remain unverified.
