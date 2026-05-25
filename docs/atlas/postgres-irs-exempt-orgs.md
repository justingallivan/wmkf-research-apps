# Atlas: `irs_exempt_orgs` (Postgres)

**Last verified:** 2026-05-12 (initial creation, migration 008; first real-data load completed 2026-05-13)
**Live row count:** **~1.26M** post-import unique-EIN baseline. The IRS publishes ~1.95M total records in the broader BMF, but the four regional CSVs (eo1–eo4) we load aggregate to ~1.26M after dropping rows missing required fields (EIN/NAME/SUBSECTION/STATUS) and deduping cross-region overlap. A future operator seeing 1.26M should NOT treat that as suspicious — the gap to 1.95M reflects how the IRS scopes the regional files plus our schema-required-field filter, not a partial download.

## Source of truth

**External (IRS Business Master File extract).** Bulk extract held in Postgres as durable reference data. WMKF does not own this data — the IRS does, and we refresh from their publish quarterly. **Not Wave-2 migrate-eligible** — Dataverse storage tiers don't fit ~2M reference rows, and there's no relational value to other Dynamics entities.

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

- Refresh strategy is **atomic swap**. The cron creates `irs_exempt_orgs_new` as a staging table, populates it from the 4 IRS CSVs via COPY, then renames staging → live in a single transaction. A partial download or IRS format change fails before the live table is touched.
- The IRS publishes the BMF **monthly**; we refresh **quarterly** (15th of Jan/Apr/Jul/Oct) per `vercel.json` cron config. Reasoning: research-program applicants (pilot scope) are mostly universities with decades-stable status. Bump to monthly when SoCal program (smaller, less-stable orgs) comes online.
- **Removed-org semantic.** When the IRS revokes an exemption, the org is removed from the published file. Our atomic-swap refresh naturally surfaces this — a previously-verified EIN that drops from the BMF returns `found: false` after the next refresh. Callers (PA) should re-verify on cycle open rather than trusting historical results.

## Read paths

- `pages/api/irs/verify-ein.js` — single-EIN lookup, PowerAutomate-callable via `IRS_VERIFY_SECRET` shared-secret header. Returns subsection/status/deductibility + descriptive labels + derived `is501c3PublicCharity` boolean.
- `lib/services/irs-bmf-service.js` `verifyEin()` — the implementation called by the endpoint.

## Write paths

- `lib/services/irs-bmf-service.js` `refresh()` — atomic-swap repopulation. Called by:
  - `/api/cron/refresh-irs-bmf` (canonical, scheduled quarterly)
  - `scripts/import-irs-bmf.js` (manual / local dev)

No live application paths write individual rows. This is a wholesale-refresh table.

## Cross-system

The verified result (boolean exempt yes/no, verification date) lives on the Dynamics `account` row, written by PowerAutomate flows that consume the `/api/irs/verify-ein` response. **This app never writes to Dynamics for IRS verification** — PA owns that boundary.

There is no Dataverse counterpart entity for the bulk IRS extract; the bulk data is intentionally Postgres-resident.

## Migration disposition

**Drain not applicable — this is durable reference data**, not on the Wave 2 migration list. Treat as "system-of-record outside WMKF; we cache." If the IRS ever exposes a real-time API, the read path could move; the storage decision (Postgres vs. external API) would be reconsidered at that point.

## Open questions / gotchas

- IRS CSV encoding is not formally declared by the agency. We use `csv-parse` with `bom: true` to handle any UTF-8 BOMs; if Latin-1 content surfaces (older orgs with non-ASCII names from accented characters), the import may need a `latin1` encoding pass. Watch for first-run anomalies in the `maintenance_runs` log.
- The Pub 78 (charity search) and Auto-Revocation lists are NOT loaded — BMF alone answers "currently exempt?". If a real edge case surfaces where an org appears in BMF but is actually revoked (race condition between IRS file publishes), pull Auto-Revocation as a secondary check.
- `wmkf_originatingsystem` field on `akoya_request` (portal vs. GOapply) is a related but separate question — see `docs/archive/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md` Track 1B.
