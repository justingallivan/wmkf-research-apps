---
name: project-irs-exempt-verification
description: "IRS tax-exempt BMF verification — code shipped 2026-05-12. The 1,264,156-row count and zero-run observation were verified by live probe on 2026-06-04 and are historical snapshots; current rowcount, refresh history, verify-EIN consumers, and PA deployment status are unknown without fresh probes. PA owns the account writeback boundary."
metadata:
  node_type: memory
  type: project
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
  status: active
  scope: dynamics
  last_verified: 2026-06-04 via live Postgres probe; rowcount and maintenance-run result are historical snapshots, not current state
---

## Recall Rule

Read this when: working on IRS tax-exempt (BMF) verification — the verify-EIN endpoint, the BMF refresh cron, or PA's account writeback contract.

Do:
- Treat the code as shipped. The 1,264,156-row count and zero IRS maintenance-run count were verified on 2026-06-04 only; current rowcount and refresh history require live probes. Current built consumers of `verifyEin` and PA deployment status also require source/deployment verification.
- Keep `verify-ein` SELECT-only: PA owns the Dynamics `account` writeback, while the separate cron/CLI refresh paths write the Postgres reference table.
- Preserve the recorded cadence decision: quarterly for the research pilot, monthly when SoCal comes online. Whether that condition now holds is unverified; this documentation audit does not change the schedule.

Do not:
- Move the BMF extract into Dataverse — reference data stays in Postgres by design.
- Assume Pub 78 / Auto-Revocation lists are loaded (they are not; BMF alone answers "currently exempt?").

Ground truth: `lib/db/migrations/008_irs_exempt_orgs.sql`, `lib/services/irs-bmf-service.js`, `pages/api/cron/refresh-irs-bmf.js`, `pages/api/irs/verify-ein.js`, `scripts/import-irs-bmf.js`, `vercel.json` cron entry, `proxy.js` allowlist.

**Status:** code shipped 2026-05-12 (Session 147). The first-load probe found 1,264,156 rows and zero IRS/BMF maintenance runs on 2026-06-04; those are dated observations, not current-state claims. Current rowcount, refresh history, consumer existence, production traffic, and PA deployment are **unknown** without current probes/source review. The verify-EIN service performs a SELECT-only lookup; PA owns the Dynamics account writeback boundary.

## What got built

- **Migration 008:** `irs_exempt_orgs` Postgres table (`lib/db/migrations/008_irs_exempt_orgs.sql`, also inlined as v29 in `scripts/setup-database.js`). PK on EIN, partial index on state, composite on (subsection, status).
- **Service:** `lib/services/irs-bmf-service.js` exports `refresh()` (atomic-swap import) and `verifyEin()` (single-EIN lookup). Stream-parses CSV via `csv-parse` and streams into a staging table via `pg-copy-streams`. Both Vercel cron and the CLI call the same `refresh()`.
- **Cron handler:** `pages/api/cron/refresh-irs-bmf.js`, scheduled `0 6 15 1,4,7,10 *` in `vercel.json` (15th of Jan/Apr/Jul/Oct, 06:00 UTC). `maxDuration: 300` override (download + COPY of ~1.95M rows). `CRON_SECRET` auth. Audited via `maintenance_runs`; failure raises `system_alerts` row.
- **Dry-run behavior:** `GET` and `POST` cron requests with `dryRun=1` still attempt to log a `maintenance_runs` record and run the table/index bootstrap plus staging-table create/populate/drop. Dry-run skips the atomic swap into the live table; a failed run can still create a failure alert. Audit logging can itself fail, in which case no maintenance row is guaranteed.
- **Verify endpoint:** `pages/api/irs/verify-ein.js`. In non-development environments it requires the `x-irs-verify-secret` shared-secret header (`IRS_VERIFY_SECRET` env var); development bypasses this auth check. Allowlisted in `proxy.js` (Next 16 proxy convention; was `middleware.js`) so it does not require an NextAuth session.
- **CLI:** `scripts/import-irs-bmf.js` — `--commit` flag for manual runs (local dev, ad-hoc refresh outside the cron cadence).

## Refresh cadence rationale

**Recorded owner decision: quarterly cadence.** IRS publishes monthly (~14th of each month), while the research-program pilot was judged to have little benefit from monthly refresh. The 15th-of-quarter schedule was intended to pick up the freshest available data before natural usage windows (April refresh covers June cycle, October covers December cycle, etc.). This is the recorded rationale, not a claim about current execution.

**Recorded conditional direction:** move to monthly refresh when the SoCal program comes online, because smaller, less-established orgs may have more status changes. Preserve that decision and verify the condition and operational task scope before changing `vercel.json` from `0 6 15 1,4,7,10 *` to `0 6 15 * *`; no schedule change is part of this audit.

## Boundaries

**This app never writes to Dynamics for IRS verification.** PA owns the writeback to the `account` row. The verify-EIN endpoint is SELECT-only against the Postgres reference data. PA ownership records the account-writeback decision; whether a PA consumer is currently deployed is unknown without deployment verification.

**Bulk extract stays in Postgres, not Dataverse.** Wave 2 reframing: Postgres's durable role is reference data (retractions, IRS); the staging/system-of-record role is what Wave 1/2 drained. The IRS extract is a textbook reference-data fit.

## Open items + gotchas (carry these into future sessions)

- **Historical first-load observation:** the 2026-06-04 probe found 1,264,156 rows. The load mechanism and current rowcount have not been re-probed here.
- **Historical refresh observation:** the 2026-06-04 probe found zero IRS/BMF `maintenance_runs` rows. This records zero logged runs at that time, not proof that the refresh had never executed; current refresh history and freshness are unknown. Verify live before relying on them. The configured quarterly cadence and proposed SoCal monthly change remain subject to the existing owner decision.
- **CSV encoding.** Not formally declared by the IRS. We use `csv-parse` with `bom: true`; if Latin-1 (e.g. accented org names) surfaces, the importer may need an encoding pass. Watch refresh-cron logs.
- **Pub 78 + Auto-Revocation List are NOT loaded.** BMF alone answers "currently exempt?" (removal from BMF = effectively revoked per the data dictionary). Add if a real edge case surfaces.
- **PA timing decision:** retain the prior owner hold recorded in intake portal Track 1B (`docs/archive/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md`); current timing and deployment status are unverified.
- **Historical intake planning (2026-05-13):** the meeting agenda proposed an EIN form field so the account row could receive the EIN at submission. This is not a current implementation action; any intake work requires a new owner decision.

Related: [[project-w6-table-drop-closed]] (other Postgres reference-data work), [[project-reviewer-postgres-to-dataverse-migration]] (the strategic reframing this verification path benefits from).
