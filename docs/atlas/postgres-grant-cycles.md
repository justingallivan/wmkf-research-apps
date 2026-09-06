# Atlas: `grant_cycles` (Postgres — DRAIN-ONLY post-W3 2026-05-12)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-05-14 via `scripts/audit-postgres-state.js` + `scripts/audit-dataverse-state.js`
**Live row count:** 13 (Postgres, drain-only)
**Read/write paths re-derived:** 2026-05-19 via codebase grep (cited inline in Read/Write sections). No live DB re-probe this session — row counts retain their 2026-05-14 audit provenance.

## Source of truth

**Dataverse-primary — W3 cutover complete 2026-05-12.** `pages/api/reviewer-finder/grant-cycles.js` is Dataverse-only — reads + writes go through `lib/services/grant-cycles-dataverse.js` to `wmkf_appgrantcycles`. Live audit 2026-05-14 shows **10 rows** in `wmkf_appgrantcycles` (not 0 as previously documented). The Postgres `grant_cycles` table is **drain-only**: 13 rows retained as a historical snapshot, **no application-code readers or writers** (verified 2026-05-19 grep — see Read/Write paths below). Its post-pilot drop is destructive-carryover-gated (≥2026-07-01; requires `scripts/restore-postgres-drain-table-backup.js` to be built first — not yet built). The 3 columns formerly flagged as missing from Dataverse (`short_code` → `wmkf_shortcode`, `program_name` → `wmkf_programname`, `custom_fields` → `wmkf_customfields`) were patched in 2026-05-12 (W3 preflight); they are in both schema-as-code and the deployed entity and are selected by `grant-cycles-dataverse.js` on every read (live evidence at `lib/services/grant-cycles-dataverse.js:75-99` + `:129`).

## Schema (live, 13 columns)

| Column | Type | Populated |
|---|---|---|
| id | integer (SERIAL PK) | 13/13 |
| name | varchar | 13/13 |
| short_code | varchar | 13/13 (`Jxx`/`Dxx`) |
| program_name | varchar | 13/13 |
| review_deadline | date | **0/13** |
| summary_pages | varchar | 13/13 |
| review_template_blob_url | varchar(500) | 0/13 |
| review_template_filename | varchar(255) | 0/13 |
| additional_attachments | jsonb | 0/13 |
| custom_fields | jsonb | 0/13 |
| is_active | boolean | 13/13 |
| created_at, updated_at | timestamp | 13/13 |

Live data: J23–J27, D23–D27 cycles; some duplicates (id 11–13 are inactive duplicates of D26/J27/D27). All have `review_deadline = NULL` despite being a populated column on the Postgres schema.

## Read paths

**Application code: NONE reads the Postgres table.** All live app reads of cycle data go through Dataverse via `lib/services/grant-cycles-dataverse.js` → `wmkf_appgrantcycles`:

- `pages/api/reviewer-finder/grant-cycles.js` — Dataverse-only (imports `grant-cycles-dataverse`; zero `@vercel/postgres`)
- `pages/api/review-manager/render-emails.js`, `pages/api/review-manager/send-emails.js` — Dataverse-only (`findByShortCode` from `grant-cycles-dataverse`)

> **Supersedes the prior "Review Manager reads from Postgres (NOT Dataverse) — Codex round-1 finding confirmed" claim.** That is stale: the W3 cutover (2026-05-12) is complete. 2026-05-19 grep shows zero `@vercel/postgres` / `grant_cycles` references in `render-emails.js` or `send-emails.js` — both import only `findByShortCode` from `grant-cycles-dataverse` (`render-emails.js:27`, `send-emails.js:43`). The prior `lib/services/maintenance-service.js` read-path entry was also stale (2026-05-19 grep: no `grant_cycles` reference there).

**Postgres `grant_cycles` readers are migration/audit/cleanup scripts only** (drain-only): `scripts/audit-postgres-state.js`, `scripts/backfill-*`, `scripts/reconcile-reviewer-migration.js`, `scripts/cleanup-duplicate-cycles.js`, `scripts/collapse-grant-cycle-duplicates.js`, `scripts/audit-grant-cycle-*.js`, `scripts/db-row-counts.js`, `scripts/setup-database.js` (DDL).

## Write paths

**Application code: NONE writes the Postgres table.** The admin "add cycle" UI (`pages/api/reviewer-finder/grant-cycles.js` POST) writes **Dataverse** `wmkf_appgrantcycles` via `grant-cycles-dataverse`. Postgres writers are migration/cleanup scripts only: `scripts/cleanup-duplicate-cycles.js`, `scripts/collapse-grant-cycle-duplicates.js`, `scripts/backfill-postgres-to-dataverse.js`, `scripts/setup-database.js` (DDL). Drain-only.

## Cross-system

| Postgres | Live Dataverse `wmkf_appgrantcycle` (probed 2026-05-07) |
|---|---|
| `name` | `wmkf_displayname` (primary name attr) |
| `short_code` | Patched 2026-05-12 → `wmkf_shortcode` (alt-key) |
| `program_name` | Patched 2026-05-12 → `wmkf_programname` |
| `review_deadline` | `wmkf_reviewreturndeadline` (note rename) |
| `summary_pages` | `wmkf_summarypages` (unused since 2026-09-06; no longer selected/written) |
| `review_template_blob_url` | `wmkf_reviewtemplateurl` |
| `review_template_filename` | `wmkf_reviewtemplatefilename` |
| `additional_attachments` | `wmkf_additionalattachments` |
| `custom_fields` | Patched 2026-05-12 → `wmkf_customfields` |
| `is_active` | `wmkf_isactive` |

**Schema-as-code (`lib/dataverse/schema/wave2/wmkf_app_grant_cycle.json`) has 11 attributes** post-W3-preflight: `wmkf_FiscalYearCode`, `wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`, `wmkf_MeetingDate`, `wmkf_SummaryPages`, `wmkf_ReviewReturnDeadline`, `wmkf_ReviewTemplateUrl`, `wmkf_ReviewTemplateFilename`, `wmkf_AdditionalAttachments`, `wmkf_IsActive`. Both alt-keys (`wmkf_fiscalyearcode` and `wmkf_shortcode`) are declared. All 11 are deployed in prod — live evidence: `grant-cycles-dataverse.js` selects all three formerly-missing fields on every read and addresses rows by `wmkf_shortcode` alt-key (working in prod since 2026-05-12).

## Migration disposition

Per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`: cycle data migrated to `wmkf_appgrantcycle` at W3 (2026-05-12). The 3 formerly-missing fields were patched and are now live; PG columns are drain-only. `review_deadline` was 0% populated in PG and is not used in the Dataverse equivalent (`wmkf_reviewreturndeadline`).

`short_code` is **load-bearing** — used by `lib/utils/cycle-code.js` `meetingDateToCycleCode()` and the picker UI. Cannot drop.

## Open questions / gotchas

- 13 rows include 3 inactive duplicates (ids 11/12/13) — investigate before migration whether to merge or drop.
- `review_deadline` is 0% populated — does any caller require it? Grep `review_deadline` to verify.
- ~~Review Manager (`render-emails.js`, `send-emails.js`) reads from Postgres `grant_cycles`; cutover requires endpoint rewrite or dual-read.~~ **RESOLVED — stale.** W3 cutover complete 2026-05-12; both files are Dataverse-only via `grant-cycles-dataverse` (verified 2026-05-19 grep). No endpoint rewrite or dual-read outstanding.
