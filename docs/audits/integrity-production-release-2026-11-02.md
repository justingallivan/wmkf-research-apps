# Integrity production release — 2026-11-02

Owner authorized migration, merge and deployed production dry-run, then explicitly approved the first publication after reviewing its results. Publication is verified; the monthly schedule remains off. Source and retention policy passed OAuth-only Fable review/closure. This receipt tracks the live operation; earlier implementation/preflight receipts are historical checkpoints.

## Historical migration checkpoint

Canonical `node scripts/apply-migrations.js` applied only 092: 1 applied, 90 skipped, 91 total. Tracker applied_at `2026-11-02T19:34:27.096Z`, applied_by `owner-approved-integrity-rollout-2026-11-02`. Production target is Neon app project falling-surf-05640504 / neondb, verified against Production Vercel URLs. Before applying, scoped backup archive/checksum/restore proof and full current corpus hash were checked, only 092 was pending, and no corpus lock was present.

Readback: publisher and subject TEXT; dataset singleton table includes source_row_count and retained_records, zero rows. Corpus remains **68,248**, full ordered-row SHA-256 `258a50be7c5d41983f611fb39192e90d9af42ca1b2d891aafed71cb6935184a9`, identical before/after and to the verified backup. No corpus refresh/publication was performed. `scripts/release-retraction-migration.cjs` records the target/backup/pending-set/readback guards and invokes the canonical runner; it does not import data or call the worker.

## Historical promotion and dry-run boundary

Release source is isolated from the dirty main checkout. Current main was merged into the feature branch; only SESSION_PROMPT.md and DEVELOPMENT_LOG.md came in. PR #604 passed every check and merged as b95a6f04c26440d4254a3c529d9fe4f16e93860c. Production deployment dpl_DZhY3LYVyUNbM3dCkJcsbWMTFe3a is Ready; the applications.wmkeck.org alias was verified against that exact deployment. The approved manual dry-run requires the literal production-only RETRACTION_REFRESH_ENABLED=on flag in its deployment; setting that flag does not register a schedule or invoke publication. Existing bearer secret is handled only in memory/private temporary env files, never printed or supplied as a shell argument. Every authorized refresh request in this release must include dryRun=1. Publication requires a later explicit owner approval.

The deployed dry-run completed successfully; exact results and readback are below. Recheck corpus hash/count, empty publication metadata, successful dry-run maintenance receipt, retained manifest and absent cron after the call. If the call fails or is uncertain, inspect authoritative state before any retry. No non-dry-run request is authorized.

## CI fixture reconciliation

The first PR database job found that the older Integrity-review fixture omitted the now-required dataset DTO. The fixture now explicitly uses unrecorded/unmanaged provenance, matching the engine contract; the production approval guard is unchanged. The refresh PG suite is added to the existing Postgres-16 CI job so future changes exercise it automatically. Both Integrity PG suites passed locally together: 19 tests including the full-source rehearsal. No runtime code was weakened or changed for the fixture correction.

The full CI run passed 26,901 tests and identified one stale cron-census assertion. The census now records refresh-retractions as unscheduled operational reference-data work in the cron-only census. It still pins 32 scheduled entries / 31 unique scheduled paths, so this update cannot silently enable the new monthly schedule. Runtime code and vercel.json schedules are unchanged.

## Historical production dry-run — before publication approval

Owner-authorized GET `https://applications.wmkeck.org/api/cron/refresh-retractions?dryRun=1`, exact Ready release `b95a6f04c26440d4254a3c529d9fe4f16e93860c` / deployment `dpl_DZhY3LYVyUNbM3dCkJcsbWMTFe3a`. The first request was rejected 401 before the service because Vercel env pull exports Sensitive CRON_SECRET as a redacted marker. The operational caller was corrected to use the existing local app cron credential when the Production export is redacted, without printing values or changing server authentication. The retry succeeded; no secret rotation, production auth bypass or publication request occurred. The helper also refuses an uninspectable cron registry.

| Result | Production dry-run |
|---|---:|
| Upstream rows | 73,519 |
| Retained reviewed legacy rows | 2 (13045, 67801) |
| Resulting corpus if approved | 73,521 |
| Additions | 5,286 |
| Updates | 1,846 |
| Removals | 13 |
| Worker duration | 10,752 ms |
| Maintenance receipt | 281992, completed |

Raw upstream SHA-256 `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`, identical to the reviewed/rehearsed file. Both retained payload/backup hashes and notice references match the approved manifest. HTTP result success=true, status=dry_run, dryRun=true, published=false, auditRecorded=true. Actual production COPY/TEMP/advisory-lock and hosted time-budget gate is now verified, rather than inferred from local tests.

**Post-call readback:** corpus remains 68,248; full ordered-row hash `258a50be7c5d41983f611fb39192e90d9af42ca1b2d891aafed71cb6935184a9` unchanged from the verified backup and pre-call snapshot. `retraction_dataset` still contains zero rows: no generation or successful publication was invented. Production-only RETRACTION_REFRESH_ENABLED=on enables manual bearer-authenticated work; the cron registry is inspectable and has no refresh-retractions entry. All original schedules remain; monthly activation is OFF.

**STOP:** first publication remains unapproved. Show the exact manifest/diff to the owner and obtain explicit publication authorization before invoking any non-dry-run. Do not register the monthly cron. No paid application-provider screen or historical screening/review rewrite was performed in this release. The two CI fixture/census reconciliations changed test bookkeeping, not the production approval guard or schedule.

Verification: PR Tests workflow 41515365066 concluded success (Jest and PostgreSQL-16 integration), as did every other PR check and Preview deployment. The corrected cron census passes all 18 tests and still pins 32 schedule definitions/31 unique scheduled routes. The operational credential-export correction passed syntax/lint and the actual authenticated deployed dry-run. The source screening/refresh/retention implementation retains the prior Fable READY FOR OWNER REVIEW receipt. Dirty unrelated main-checkout work was preserved.

## Current result — owner-approved first publication verified

[VERIFIED via production service and independent read-only database queries, 2026-11-02] After reviewing the dry-run results, Justin approved the first refresh. No monthly schedule or paid re-screen was authorized or invoked. Immediately before publication, the scoped backup archive checksum and restore proof were revalidated; the live full-row fingerprint still matched that backup. No active corpus writer/lock or running refresh audit was found. The exact Ready release remained b95a6f04c26440d4254a3c529d9fe4f16e93860c. A fresh production dry-run matched every approved count, upstream checksum and retained provenance entry. One subsequent authenticated request used dryRun=0.

Publication succeeded: **73,521 records**, comprising 73,519 upstream and 2 reviewed retained records; **5,286 additions, 1,846 updates, 13 removals**. Generation **1**, published_at **2026-11-02T20:30:58.575Z**, raw source checksum **7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4**. Completed maintenance audit **282049** records published=true and the exact approved changes; worker duration **9,658 ms**.

An operational post-call assertion compared serialized retained JSON by property order and reported a mismatch after successful publication. No request was retried. Independent read-only verification used structural value equality and passed all ten checks: count, singleton, generation, checksum, source count, metadata count, retained provenance, stable retained primary keys, completed publication audit, and absent monthly cron. Retained record 13045 remains primary key 55391; 67801 remains 1014. Published full-row hash: **bdb7e1cce9ff5da5e8fae3395101000335a64ccd5b0b94a55239ef5db2189bea**. No product-code correction was needed.

**Current boundary:** the first refresh is published and verified. The manual worker remains enabled with strict bearer authentication; **monthly scheduling remains OFF**. No screening histories or staff decisions were rewritten, and no provider-backed screening was run. A later monthly activation still requires a separately approved schedule change. Prior hold statements above are historical checkpoints superseded by this explicit approval and readback.
