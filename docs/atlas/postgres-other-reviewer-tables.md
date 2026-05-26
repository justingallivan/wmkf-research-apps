# Atlas: Reviewer-side Postgres tables (small / DRAIN-ONLY)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-05-07 via `scripts/audit-postgres-state.js`. **Drain-status re-verified 2026-05-19 (S167)** via code grep + Codex independent verification — none of these tables have live application readers/writers.

Covers three Postgres tables in the reviewer-finder domain that don't warrant individual pages: `researcher_keywords`, `proposal_searches`, `search_cache`. (`playing_with_neon` was a Neon-console tutorial scratch table dropped 2026-05-25 via migration 014; section retained below as a historical record.)

## `researcher_keywords` (1,028 rows)

**Source of truth:** Postgres-only.

Schema: `id`, `researcher_id` (FK CASCADE), `keyword`, `relevance_score` (0-1), `source` (`publications | profile | manual`), `created_at`. UNIQUE `(researcher_id, keyword, source)`.

**Read/write paths:** Live application readers/writers retired. `pages/api/reviewer-finder/researchers.js` deleted 2026-05-12 in W6 step 1; `lib/services/database-service.js` keyword methods gutted in W5 step 2 (commit `0c58da4`). Remaining touches: `scripts/backfill-postgres-to-dataverse.js`, `scripts/clear-all-database.js` (admin scripts).

**Cross-system:** Migrates to `wmkf_appresearcher.wmkf_keywords` as a single Memo field (comma-joined per the schema-as-code). The 1:N → 1:1 collapse is intentional — the current Postgres design over-models keyword provenance.

## `proposal_searches` (0 rows)

**Source of truth:** dead. Writer is dead code (per S136 audit + plan).

Schema: 20 columns including `proposal_title`, `proposal_hash`, `claude_suggestions` (jsonb), `search_queries` (jsonb), `summary_blob_url`, `request_number`, `user_profile_id`. UNIQUE on `proposal_hash` (implicit via writer).

**Read/write paths:** No live application readers/writers. `pages/api/reviewer-finder/extract-summary.js` was retired entirely 2026-05-12 (W5 step 5); `lib/services/maintenance-service.js` dropped the `proposal_searches` blob scan in W5 step 6. Remaining touches: `scripts/{clear-all-database,assign-orphan-records,import-user-assignments}.js` (admin scripts).

**JOIN retired 2026-05-12 (W3 cutover):** Previously `pages/api/reviewer-finder/grant-cycles.js` did `LEFT JOIN proposal_searches`. That route is now Dataverse-only (verified 2026-05-14 — header says "W3 cutover (2026-05-12) — Dataverse-only"; no `proposal_searches` reference in source). The JOIN site is gone. `proposal_searches` Postgres table has no remaining application-code readers — drop is unblocked.

**Dataverse counterpart:** `wmkf_appproposalsearch` schema-as-code exists at `lib/dataverse/schema/wave2/wmkf_app_proposal_search.json`. Live state (S188 audit re-sweep 2026-05-25): **DEPLOYED, 0 rows**. Entity-set name is the unconventional `wmkf_appproposalsearchs` (no `e` before `s` — Dataverse auto-pluralized with `+s` rather than `-ches`). Earlier "NOT deployed" framing (2026-05-07) was a string-mismatch against the wrong entity-set name; same trap the audit script hit and S188 fixed.

**Migration disposition:** Skip — the Postgres table is empty and the Dataverse entity isn't deployed. Drop the Postgres table during cleanup; defer Dataverse deployment until a real use case appears.

## `search_cache` (0 rows)

**Source of truth:** Postgres-only; cache table.

Schema: `id`, `source`, `query_hash` (sha256), `query_text`, `results` (jsonb), `result_count`, `created_at`, `expires_at`. UNIQUE `(source, query_hash)`. Index on `expires_at` for `cleanup_expired_cache()` plpgsql function.

**Read/write paths:** `lib/services/database-service.js`, `scripts/clear-all-database.js`, `scripts/cleanup-database.js`.

**Live state:** 0 rows. Cache is either disabled or never enabled. The `cleanup_expired_cache()` function exists in `schema.sql` but no cron job calls it.

**Migration disposition:** Drop. Pure ephemeral cache; reconstitute via Dataverse cache-table or in-process LRU if needed.

## `playing_with_neon` — DROPPED 2026-05-25

Canonical Neon-console tutorial scratch table (10 rows of MD5-prefix names + random floats). Zero callers in source. Dropped via `lib/db/migrations/014_drop_playing_with_neon.sql` after S185 reconcile-script structural fixes surfaced it as the sole real entry in the `postgres_table_mismatch` bucket once the bucket's source-of-truth set was made complete (schema.sql + setup-database.js + migrations).
