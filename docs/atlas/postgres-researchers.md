# Atlas: `researchers` (Postgres — DROPPED 2026-06-04)

<!-- drain-table:file-purpose=atlas-state-page -->

> **DROPPED 2026-06-04 (S219)** via
> `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`. The table
> no longer exists in Postgres. Reviewer person identity and bibliometrics live
> in Dataverse `wmkf_potentialreviewer`. The 331-row pre-drop snapshot was
> archived to local JSONL and Vercel Blob at
> `cleanup-backup/2026-06-04/researchers.jsonl`; that backup and the
> then-current restore tooling are historical recovery evidence, not current
> operating guidance.

**Last verified:** 2026-05-07 via `scripts/audit-postgres-state.js`. **Drain-status re-verified 2026-05-19 (S167)** via code grep + Codex independent verification.
**Final row count before drop:** 331 (drain-only; no live application readers or writers post-W6 cutover 2026-05-12)

## Source of truth

The canonical reviewer identity is Dataverse `wmkf_potentialreviewer`, which
also carries the bibliometric fields after the S213
`wmkf_appresearcher`-sidecar collapse. The historical Postgres `researchers`
table was dropped by migration 018; no current application or script path
should treat it as an available store. The former Database-tab UI and
`pages/api/reviewer-finder/researchers.js` reader were retired before the drop.

## Historical schema at drop

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

> **Historical M002 callers:** the retired
> `pages/api/reviewer-finder/researchers.js` route and the pre-cutover
> contact-enrichment path. Current enrichment persists through the Dataverse
> adapter chain.

## Final pre-drop snapshot

- The table had 331 rows; 99% had an email; bibliometric fields (h-index, i10,
  citations) were 0% populated.
- Parity probe (`scripts/backfill-reviewer-suggestions-parity.js`) historically treated this pool as the source for `wmkf_appresearcher` row creation. **S213: the `wmkf_appresearcher` sidecar (339 rows at drop) was collapsed onto `wmkf_potentialreviewers` and dropped** — the bibliometric fields now live on the person. The pre-drop counts below (334 → 339) are historical.

## Historical read paths

**W6 closeout (2026-05-12):** the last application reader was retired before
the table was dropped. The admin scripts listed below are historical pre-drop
tools, not current table readers.

- `scripts/audit-postgres-state.js`, `scripts/clear-all-database.js`, `scripts/cleanup-database.js` — admin scripts

Pre-W5/W6 callers (now removed, kept for archaeology):
- `lib/services/discovery-service.js` — replaced with unconditional PubMed verification
- `lib/services/deduplication-service.js` — replaced with transient merged candidates (no PG id thread)
- `lib/services/contact-enrichment-service.js` — replaced with Dataverse adapter chain
- `pages/api/reviewer-finder/researchers.js` — deleted W6 step 1

## Historical write paths

No application writer remained at the W6 closeout. The cleanup scripts listed
below predate migration 018 and must not be read as current DELETE guidance.

- `scripts/clear-all-database.js`, `scripts/cleanup-database.js` — DELETE only

Pre-W5/W6 writers (now removed):
- `lib/services/contact-enrichment-service.js` — enrichment writeback now targets `wmkf_potentialreviewers` (the person) via the adapter chain (W5; S213: bibliometrics fold onto the person, not the dropped `wmkf_appresearcher` sidecar)
- `DatabaseService.createOrUpdateResearcher` — gutted in commit `0c58da4` (W5 step 2)
- `pages/api/reviewer-finder/researchers.js` — deleted W6 step 1

## Historical cross-system mapping

| Direction | Mapping | Status |
|---|---|---|
| Historical Postgres `researchers.id` → Dataverse `wmkf_potentialreviewer` | pre-cutover email match | migration-era mapping; the Postgres source is dropped |
| Historical Postgres bibliometrics → Dataverse `wmkf_potentialreviewer.wmkf_hindex/...` | migration-era adapter mapping | the final Postgres snapshot had no populated metric values; current writes target the Dataverse person |

**Historical (pre-S213):** `wmkf_appresearchers` had 334 → 339 rows (a few more than Postgres `researchers`). Likely cause: per-proposal promotion via `save-candidates` created Dataverse rows for people who never made it into the Postgres pool (e.g., candidates added directly from the picker without enrichment). That sidecar entity is now dropped; bibliometrics live on `wmkf_potentialreviewers`.

## Completed migration disposition

Identity and bibliometric authority moved to the Dataverse person record; the
intermediate `wmkf_appresearcher` sidecar and the historical Postgres
`researchers` table were both dropped. There is no pending Postgres retirement
or cleanup action.

## Historical gotchas

- ~~Three callers of `DatabaseService.findResearcher` (not just discovery's cache lookup). Migration plan must cover all three.~~ **RESOLVED (verified 2026-05-18, S164):** grep of `lib/`/`pages/`/`scripts/` finds zero live callers of `findResearcher`/`createOrUpdateResearcher` — all 4 matches are archaeology comments describing removed pre-W5 behavior. The migration covered them; nothing outstanding.
- The 0%-populated bibliometric fields mean the migration did not carry metric
  values from this table. Any current bibliometric refresh must use the
  Dataverse person contract and current source pipeline, not this snapshot.
