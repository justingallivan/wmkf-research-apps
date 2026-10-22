# Atlas: `irs_exempt_orgs` (Postgres)

**Last live-state probe:** 2026-06-04. It observed 1,264,156 rows and zero IRS/BMF maintenance-run records. These are historical observations only; current rowcount, refresh history, endpoint consumers, and PA deployment status are **unknown** without fresh probes. The code/schema descriptions below are source-based.
**Historical row-count context:** the first-load count was 1,264,156 unique EINs. The broader IRS BMF is filtered for required fields and deduplicated across regional files. Do not use the dated count as current state.

## Source of truth

**External (IRS Business Master File extract).** Bulk extract held in Postgres as durable reference data. WMKF does not own this data — the IRS does. The source config schedules quarterly refreshes; current execution and freshness require a live probe. **Not Wave-2 migrate-eligible** — Dataverse storage tiers don't fit ~2M reference rows, and there's no relational value to other Dynamics entities.

## Schema (from `lib/db/migrations/008_irs_exempt_orgs.sql`)

| Column | Type | Notes |
|---|---|---|
| ein | varchar(9) | PK, 9 digits no dash, IRS EIN format |
| name | text | Primary organization name |
| ico | text | "In Care Of" person |
| street, city, state, zip | text/varchar | state nullable for international (region 4) |
| group_exemption | varchar(4) | Group exemption number |
| subsection | varchar(2) | IRS Subsection Code. `'03'` = 501(c)(3) |
| affiliation | varchar(1) | 1/2/3/6/7/8/9 (central/intermediate/independent/subordinate) |
| classification | varchar(4) | 1-4 classification codes |
| ruling_date | varchar(6) | YYYYMM, string per IRS format |
| deductibility | varchar(1) | `'1'`=deductible, `'2'`=not, `'4'`=by treaty (foreign) |
| foundation | varchar(2) | Foundation type code (`'00'` = not 501(c)(3); `'02'-'25'` = various 501(c)(3) categories) |
| organization | varchar(1) | 1=Corp, 2=Trust, 3=Co-op, 4=Partnership, 5=Association |
| status | varchar(2) | `'01'`=Unconditional Exempt, `'02'`=Conditional, `'12'`=4947(a)(2) trust, `'25'`=terminating PF |
| ntee_cd | varchar(4) | National Taxonomy of Exempt Entities code |
| sort_name | text | DBA / secondary name |
| region | varchar(1) | `'1'`-`'4'`, source region file (diagnostics) |
| refresh_date | date | Date of the most recent successful import run |

Indexes: PK on `ein`, partial on `state WHERE state IS NOT NULL`, composite on `(subsection, status)`.

**Skipped on purpose** (not loaded from the IRS CSV): ACTIVITY (legacy pre-1995), TAX_PERIOD, ASSET_CD, INCOME_CD, FILING_REQ_CD, PF_FILING_REQ_CD, ACCT_PD, ASSET_AMT, INCOME_AMT, REVENUE_AMT. None of these affect "is this org currently exempt?" — they're financial / filing-requirement diagnostics that double the row size for no verification benefit. Add later if a real need surfaces.

## Live state notes

- Refresh strategy is **atomic swap**. The cron creates and populates a staging table; the live swap occurs only after the import passes its checks. GET/POST with `dryRun=1` still perform schema/staging work and attempt to record a maintenance run; dry-run skips the live swap. Audit logging can itself fail, and a failed run can also create a failure alert.
- The source config schedules quarterly refreshes (15th of Jan/Apr/Jul/Oct). Whether a run has occurred or the data is current requires a live probe. The recorded owner decision is quarterly for the research pilot, moving to monthly when SoCal comes online. Whether that condition now holds is unverified; no cadence change is part of this audit.
- **Removed-org semantic.** When the IRS revokes an exemption, the org is removed from the published file. Our atomic-swap refresh naturally surfaces this — a previously-verified EIN that drops from the BMF returns `found: false` after the next refresh. Callers (PA) should re-verify on cycle open rather than trusting historical results.

## Read paths

- `pages/api/irs/verify-ein.js` — single-EIN lookup, PowerAutomate-callable via `IRS_VERIFY_SECRET` shared-secret header outside development; development bypasses this auth check. Returns subsection/status/deductibility + descriptive labels + derived `is501c3PublicCharity` boolean.
- `lib/services/irs-bmf-service.js` `verifyEin()` — the implementation called by the endpoint.

## Write paths

- `lib/services/irs-bmf-service.js` `refresh()` — atomic-swap repopulation. Called by:
  - `/api/cron/refresh-irs-bmf` (canonical, scheduled quarterly)
  - `scripts/import-irs-bmf.js` (manual / local dev)

No live application paths write individual rows. This is a wholesale-refresh table.

## Cross-system

The verified result (boolean exempt yes/no, verification date) is owned on the Dynamics `account` row by the PA writeback contract. **This app never writes to Dynamics for IRS verification** — PA owns that boundary. The endpoint performs a SELECT-only lookup; current PA consumer deployment is unknown without deployment verification.

There is no Dataverse counterpart entity for the bulk IRS extract; the bulk data is intentionally Postgres-resident.

## Migration disposition

**Drain not applicable — this is durable reference data**, not on the Wave 2 migration list. Treat as "system-of-record outside WMKF; we cache." If the IRS ever exposes a real-time API, the read path could move; the storage decision (Postgres vs. external API) would be reconsidered at that point.

## Open questions / gotchas

- IRS CSV encoding is not formally declared by the agency. We use `csv-parse` with `bom: true` to handle any UTF-8 BOMs; if Latin-1 content surfaces (older orgs with non-ASCII names from accented characters), the import may need a `latin1` encoding pass. Watch for first-run anomalies in the `maintenance_runs` log.
- The Pub 78 (charity search) and Auto-Revocation lists are NOT loaded — BMF alone answers "currently exempt?". If a real edge case surfaces where an org appears in BMF but is actually revoked (race condition between IRS file publishes), pull Auto-Revocation as a secondary check.
- `wmkf_originatingsystem` field on `akoya_request` (portal vs. GOapply) is a related but separate question — see `docs/archive/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md` Track 1B.
