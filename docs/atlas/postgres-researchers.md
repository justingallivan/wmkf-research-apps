# Atlas: `researchers` (Postgres — DRAIN-ONLY)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-05-07 via `scripts/audit-postgres-state.js`. **Drain-status re-verified 2026-05-19 (S167)** via code grep + Codex independent verification.
**Live row count:** 331 (drain-only; no live application readers or writers post-W6 cutover 2026-05-12)

## Source of truth

**Drain-only post-W6 cutover (2026-05-12).** The canonical identity for reviewer candidates is Dataverse `wmkf_potentialreviewers` + bibliometrics on `wmkf_appresearcher`. The Postgres `researchers` table is retained as a historical snapshot pending the post-pilot drop (≥2026-07-01; requires `scripts/restore-postgres-drain-table-backup.js` to be built first — not yet built). Zero application code under `pages/api/`, `lib/services/`, `lib/dataverse/`, or `shared/` reads or writes this table; only `scripts/*` admin/migration tools touch it. The Database tab admin UI and `pages/api/reviewer-finder/researchers.js` endpoint that previously read this pool were retired W6 step 1.

## Schema (live, from `information_schema`)

| Column | Type | Notes |
|---|---|---|
| id | integer | PK, SERIAL |
| name | varchar(255) | required |
| normalized_name | varchar(255) | lowercase + diacritic-stripped, dedupe key |
| primary_affiliation | varchar(500) | |
| department | varchar(255) | |
| email | varchar(255) | 327 / 331 populated (99%) |
| website | varchar(500) | |
| orcid | varchar(50) | 1 / 331 populated (0.3%) |
| google_scholar_id | varchar(100) | 1 / 331 populated |
| h_index | integer | 0 / 331 populated |
| i10_index | integer | 0 / 331 populated |
| total_citations | integer | 0 / 331 populated |
| notes | text | V12 |
| created_at | timestamp | default `now()` |
| last_updated | timestamp | default `now()` |
| last_checked | timestamp | "last verified" stamp |
| metrics_updated_at | timestamp | added by `setup-database.js`; was written on h-index/citations updates by `pages/api/reviewer-finder/researchers.js` (retired W6 step 1 2026-05-12) |
| email_source | varchar(100) | M002 — `pubmed \| orcid \| claude_search \| manual` |
| email_year | integer | M002 — pub year where email was found (recency signal) |
| email_verified_at | timestamp | M002 |
| orcid_url | varchar(255) | M002 |
| google_scholar_url | varchar(500) | M002 |
| faculty_page_url | varchar(500) | M002 |
| contact_enriched_at | timestamp | M002 — last enrichment-pass timestamp |
| contact_enrichment_source | varchar(50) | M002 — which tier filled contact info |

Indexes: `normalized_name`, `email`, `last_updated`, `(email IS NOT NULL)`, `contact_enriched_at`, `orcid` (M002). (See `lib/db/schema.sql` + `lib/db/migrations/002_contact_enrichment.sql`.)

> **Verified active readers/writers of the M002 columns:** `pages/api/reviewer-finder/researchers.js` (retired W6 step 1 2026-05-12) and `lib/services/contact-enrichment-service.js` (enrichment pipeline migrated to Dataverse adapter chain in W5).

## Live state notes

- 331 rows; 99% have an email; **bibliometric fields (h-index, i10, citations) are 0% populated** — the writer that fills them never landed or got removed.
- Parity probe (`scripts/backfill-reviewer-suggestions-parity.js`) treats this pool as the source for `wmkf_appresearcher` row creation; **Dataverse `wmkf_appresearcher` count is 334** (slightly higher — see "Cross-system" below).

## Read paths

**W6 update (2026-05-12):** the last live reader (`pages/api/reviewer-finder/researchers.js` admin UI) has been retired. No live application code reads this table. Remaining readers are admin scripts only.

- `scripts/audit-postgres-state.js`, `scripts/clear-all-database.js`, `scripts/cleanup-database.js` — admin scripts

Pre-W5/W6 callers (now removed, kept for archaeology):
- `lib/services/discovery-service.js` — replaced with unconditional PubMed verification
- `lib/services/deduplication-service.js` — replaced with transient merged candidates (no PG id thread)
- `lib/services/contact-enrichment-service.js` — replaced with Dataverse adapter chain
- `pages/api/reviewer-finder/researchers.js` — deleted W6 step 1

## Write paths

**W6 update:** no live application writers remain. Table is now drain-only (no inserts/updates from production code). Admin scripts retain DELETE for cleanup.

- `scripts/clear-all-database.js`, `scripts/cleanup-database.js` — DELETE only

Pre-W5/W6 writers (now removed):
- `lib/services/contact-enrichment-service.js` — enrichment writeback now targets `wmkf_potentialreviewer` + `wmkf_appresearcher` via the adapter chain (W5)
- `DatabaseService.createOrUpdateResearcher` — gutted in commit `0c58da4` (W5 step 2)
- `pages/api/reviewer-finder/researchers.js` — deleted W6 step 1

## Cross-system linkages

| Direction | Mapping | Status |
|---|---|---|
| Postgres `researchers.id` → Dataverse `wmkf_potentialreviewers` | by email match | live (per-proposal saves promote on demand) |
| Postgres `researchers.h_index/i10/total_citations` → `wmkf_appresearcher.wmkf_hindex/...` | via adapter `lib/dataverse/adapters/researcher.js` | adapter exists; bibliometric fields are 0% populated in Postgres so the migration carries no metric values |

`wmkf_appresearchers` has 334 rows (3 more than Postgres `researchers`). Likely cause: per-proposal promotion via `save-candidates` created Dataverse rows for people who never made it into the Postgres pool (e.g., candidates added directly from the picker without enrichment). Not a data-loss risk.

## Migration disposition

Per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`: identity → `wmkf_potentialreviewers`; bibliometric snapshot → `wmkf_appresearcher`. Browse/edit UI rewrites endpoints to query Dataverse directly. Postgres `researchers` retired post-cutover.

## Open questions / gotchas

- ~~Three callers of `DatabaseService.findResearcher` (not just discovery's cache lookup). Migration plan must cover all three.~~ **RESOLVED (verified 2026-05-18, S164):** grep of `lib/`/`pages/`/`scripts/` finds zero live callers of `findResearcher`/`createOrUpdateResearcher` — all 4 matches are archaeology comments describing removed pre-W5 behavior. The migration covered them; nothing outstanding.
- The 0%-populated bibliometric fields raise the question of whether they were ever live; treat the migration as **not** carrying metric data forward unless we re-scrape.
