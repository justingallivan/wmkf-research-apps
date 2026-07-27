# Atlas: Reviewer-side Postgres tables (small)

<!-- drain-table:file-purpose=atlas-state-page -->

> **`researcher_keywords` + `proposal_searches` DROPPED 2026-06-04 (S219)** via `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`. `researcher_keywords` (1,028 rows) backed up to Vercel Blob `cleanup-backup/2026-06-04/researcher_keywords.jsonl`; `proposal_searches` was empty. **`search_cache` is NOT dropped** — despite 0 rows it has LIVE callers (`DatabaseService.checkCache`/`cacheSearch` in pubmed/biorxiv/arxiv/chemrxiv services + the `/api/cron/maintenance` `cleanupExpiredCache` cron), so it remains a live literature-search cache. Sections for the two dropped tables retained as historical record.

**Last verified:** 2026-05-07 via `scripts/audit-postgres-state.js`. **Drain-status re-verified 2026-05-19 (S167)** via code grep + Codex independent verification. **`search_cache` live-caller status re-confirmed 2026-06-04 (S219)** — still in active use.

Covers three Postgres tables in the reviewer-finder domain that don't warrant individual pages: `researcher_keywords` (DROPPED 2026-06-04), `proposal_searches` (DROPPED 2026-06-04), `search_cache` (KEPT — live cache). (`playing_with_neon` was a Neon-console tutorial scratch table dropped 2026-05-25 via migration 014; section retained below as a historical record.)

## Historical `researcher_keywords` snapshot (1,028 rows)

**Disposition:** dropped by migration 018. The following schema and row count
describe the final pre-drop snapshot, not a current Postgres source of truth.

Historical schema: `id`, `researcher_id` (FK CASCADE), `keyword`,
`relevance_score` (0-1), `source`
(`publications | profile | manual`), `created_at`. UNIQUE
`(researcher_id, keyword, source)`.

**Historical read/write closeout:** application readers and writers retired
before the drop. Retained backfill or cleanup scripts are migration
archaeology, not current table callers.

**Historical cross-system mapping:** keywords migrated to
`wmkf_potentialreviewer.wmkf_keywords` as a single Memo field after the S213
sidecar collapse. Current authority is the Dataverse person record.

## Historical `proposal_searches` snapshot (0 rows)

**Disposition:** dropped by migration 018. It had no rows and was not a source
of truth at drop time.

Historical schema: 20 columns including `proposal_title`, `proposal_hash`,
`claude_suggestions` (jsonb), `search_queries` (jsonb), `summary_blob_url`,
`request_number`, `user_profile_id`. UNIQUE on `proposal_hash` (implicit via
the retired writer).

**Historical read/write closeout:** no application reader or writer remained
before the drop. Retained admin scripts are not current callers.

**JOIN retired 2026-05-12 (W3 cutover):** the former grant-cycle join was
removed before migration 018. The table drop is complete, not merely
unblocked.

**Dataverse counterpart:** `wmkf_appproposalsearch` schema-as-code exists at `lib/dataverse/schema/wave2/wmkf_app_proposal_search.json`. Live state (S188 audit re-sweep 2026-05-25): **DEPLOYED, 0 rows**. Entity-set name is the unconventional `wmkf_appproposalsearchs` (no `e` before `s` — Dataverse auto-pluralized with `+s` rather than `-ches`). Earlier "NOT deployed" framing (2026-05-07) was a string-mismatch against the wrong entity-set name; same trap the audit script hit and S188 fixed.

**Migration disposition:** complete. Migration 018 dropped the Postgres table;
no cleanup action remains. The separately deployed Dataverse counterpart had
0 rows at the dated S188 probe.

## `search_cache` (0 rows)

**Source of truth:** Postgres-only; cache table.

Schema: `id`, `source`, `query_hash` (sha256), `query_text`, `results` (jsonb), `result_count`, `created_at`, `expires_at`. UNIQUE `(source, query_hash)`. Index on `expires_at` for `cleanup_expired_cache()` plpgsql function.

**Current read/write paths:** `DatabaseService.checkCache` and
`DatabaseService.cacheSearch` are called by the PubMed, bioRxiv, arXiv, and
ChemRxiv services when caching is enabled. `MaintenanceService.cleanupExpiredCache`
is called by `/api/cron/maintenance`.

**Last observed state:** 0 rows at the 2026-05-07 probe. That snapshot does not
mean the cache is disabled. Current source retains optional cache reads/writes
and a maintenance-cron cleanup path.

**Migration disposition:** keep. Migration 018 deliberately excluded
`search_cache` because it has live callers. There is no approved drop action.

## `playing_with_neon` — DROPPED 2026-05-25

Canonical Neon-console tutorial scratch table (10 rows of MD5-prefix names + random floats). Zero callers in source. Dropped via `lib/db/migrations/014_drop_playing_with_neon.sql` after S185 reconcile-script structural fixes surfaced it as the sole real entry in the `postgres_table_mismatch` bucket once the bucket's source-of-truth set was made complete (schema.sql + setup-database.js + migrations).
