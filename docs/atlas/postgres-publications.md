# Atlas: `publications` (Postgres — DROPPED 2026-06-04)

<!-- drain-table:file-purpose=atlas-state-page -->

> **DROPPED 2026-06-04 (S219)** via `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`. The table no longer exists in Postgres. It was empty (0 rows, dead writer) — no backup needed. Page retained as historical record.

**Last verified:** 2026-05-07 via `scripts/audit-postgres-state.js`. **Drain-status re-verified 2026-05-19 (S167).** Zero live application readers/writers.
**Final row count before drop:** **0**

## Source of truth

**None.** Table exists; nothing reads or writes it in production traffic. Writer is dead code.

## Schema (live)

| Column | Type |
|---|---|
| id | integer (SERIAL PK) |
| researcher_id | integer (FK researchers.id, ON DELETE CASCADE) |
| title | text |
| authors | text[] |
| author_position | integer |
| publication_date | date |
| year | integer |
| journal | varchar(500) |
| doi | varchar(100) UNIQUE |
| pmid | varchar(50) |
| pmcid | varchar(50) |
| arxiv_id | varchar(50) |
| citations | integer (default 0) |
| abstract | text |
| source | varchar(50) |
| created_at | timestamp |
| url | varchar (added by ad-hoc migration) |

Indexes: `researcher_id`, `publication_date DESC`, `doi`.

## Live state notes

- 0 rows. Writer was either never wired or was disabled.
- **W5 update (commit `0c58da4`):** the `DatabaseService.addPublication` / `getRecentPublications` / `getResearchersByKeywords` methods that referenced this table were gutted from `database-service.js`. No live readers or writers remain in the service layer.

## Read paths

- `scripts/clear-all-database.js`, `scripts/db-row-counts.js` — admin scripts only

Pre-W5 (now removed):
- `lib/services/database-service.js` — `addPublication`, `getRecentPublications`, `getResearchersByKeywords` (all gutted in `0c58da4` after zero-caller grep)

## Write paths

- `scripts/clear-all-database.js` — admin script only

Pre-W5 (now removed):
- `lib/services/database-service.js` — `addPublication` INSERT (gutted in `0c58da4`)

## Cross-system

The Dataverse entity `wmkf_apppublication` (and its `wmkf_apppublicationauthor` junction) was **DROPPED S213** — it was deployed with 0 rows and no callers, so it went down with the `wmkf_appresearcher` collapse (`docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`); its schema-as-code manifest was removed too. The Postgres `publications` table remains a drain-only empty snapshot.

## Migration disposition

Per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`: skip-safe — drop the Postgres table during cleanup; no rows to migrate. (The Dataverse `wmkf_apppublication` target was dropped S213; if publication tracking is ever needed it would be redesigned around `wmkf_potentialreviewer` directly.)
