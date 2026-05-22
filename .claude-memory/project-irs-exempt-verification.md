---
name: project-irs-exempt-verification
description: "IRS tax-exempt status verification — SHIPPED 2026-05-12. Postgres-resident BMF reference data, quarterly refresh cron, PowerAutomate-callable /api/irs/verify-ein endpoint. Verified results written back to Dynamics account rows by PA, not by this app."
metadata:
  node_type: memory
  type: project
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
---

**Status: SHIPPED 2026-05-12 (Session 147) + FIRST LOAD COMPLETE.** Initial implementation shipped 2026-05-12. **First BMF load complete — 1,264,156 rows live in `irs_exempt_orgs` as of 2026-05-14 audit.** Verify-EIN endpoint is now answering real lookups, not `found: false` for everything.

## What got built

- **Migration 008:** `irs_exempt_orgs` Postgres table (`lib/db/migrations/008_irs_exempt_orgs.sql`, also inlined as v29 in `scripts/setup-database.js`). PK on EIN, partial index on state, composite on (subsection, status).
- **Service:** `lib/services/irs-bmf-service.js` exports `refresh()` (atomic-swap import) and `verifyEin()` (single-EIN lookup). Stream-parses CSV via `csv-parse` and streams into a staging table via `pg-copy-streams`. Both Vercel cron and the CLI call the same `refresh()`.
- **Cron handler:** `pages/api/cron/refresh-irs-bmf.js`, scheduled `0 6 15 1,4,7,10 *` in `vercel.json` (15th of Jan/Apr/Jul/Oct, 06:00 UTC). `maxDuration: 300` override (download + COPY of ~1.95M rows). `CRON_SECRET` auth. Audited via `maintenance_runs`; failure raises `system_alerts` row.
- **Verify endpoint:** `pages/api/irs/verify-ein.js`. `x-irs-verify-secret` shared-secret header (`IRS_VERIFY_SECRET` env var). Allowlisted in `middleware.js` so it does not require an NextAuth session.
- **CLI:** `scripts/import-irs-bmf.js` — `--commit` flag for manual runs (local dev, ad-hoc refresh outside the cron cadence).

## Refresh cadence rationale

**Quarterly, not monthly.** IRS publishes monthly (~14th of each month) but for the research-program pilot (mostly universities with decades-stable status) the marginal benefit of monthly refresh is negligible. The 15th-of-quarter schedule picks up the freshest available data right before each natural usage window (April refresh covers June cycle, October covers December cycle, etc.).

**Bump to monthly when the SoCal program comes online.** SoCal deals with smaller, less-established orgs whose tax status changes more often; the staleness window matters more there. Edit `vercel.json` cron entry from `0 6 15 1,4,7,10 *` → `0 6 15 * *` at that point.

## Boundaries

**This app never writes to Dynamics for IRS verification.** PA owns the writeback to the `account` row. The endpoint is purely read-only against the Postgres reference data; what PA does with the response is its own contract.

**Bulk extract stays in Postgres, not Dataverse.** Wave 2 reframing: Postgres's durable role is reference data (retractions, IRS); the staging/system-of-record role is what Wave 1/2 drained. The IRS extract is a textbook reference-data fit.

## Open items + gotchas (carry these into future sessions)

- ~~**First load not yet run.**~~ **DONE 2026-05-14** — 1.26M rows live in `irs_exempt_orgs`. Quarterly refresh cron runs as scheduled.
- **CSV encoding.** Not formally declared by the IRS. We use `csv-parse` with `bom: true`; if Latin-1 (e.g. accented org names) surfaces, the importer may need an encoding pass. Watch refresh-cron logs.
- **Pub 78 + Auto-Revocation List are NOT loaded.** BMF alone answers "currently exempt?" (removal from BMF = effectively revoked per the data dictionary). Add if a real edge case surfaces.
- **PA timing decision still owed.** When does PA fire the verification — on `account` create, on submit, or on `'Phase II Pending'` flip? Connor's call; sub-question under intake portal Track 1B (`docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md`).
- **EIN form field on the intake form.** Required so the `account` row gets the EIN at submission time. Add to Sarah's field inventory at the 2026-05-13 meeting.

Related: [[w6-table-drop-pending]] (other Postgres reference-data work), [[reviewer-postgres-to-dataverse-migration]] (the strategic reframing this verification path benefits from).
