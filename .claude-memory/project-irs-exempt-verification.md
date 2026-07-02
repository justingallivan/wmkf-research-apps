---
name: project-irs-exempt-verification
description: "IRS tax-exempt BMF verification — code SHIPPED 2026-05-12 + data loaded once (1.26M rows, verified live 2026-06-04). BUT DORMANT: the quarterly refresh cron is configured in vercel.json yet has NEVER fired, and the PA-callable /api/irs/verify-ein endpoint has no built consumer (intended for the unbuilt intake portal). PA, not this app, would write back to Dynamics account rows."
metadata:
  node_type: memory
  type: project
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
  status: active
  scope: dynamics
  last_verified: 2026-06-04 via live Postgres probe (1,264,156 rows in irs_exempt_orgs; 0 IRS runs in maintenance_runs)
---

## Recall Rule

Read this when: working on IRS tax-exempt (BMF) verification — the verify-EIN endpoint, the BMF refresh cron, or PA's account writeback contract.

Do:
- Treat the CODE + DATA as built (1,264,156 rows live, verified 2026-06-04; service `lib/services/irs-bmf-service.js`), but treat the FEATURE as DORMANT: no built surface calls `verifyEin`, and the refresh cron has never fired (verify before claiming it's "live in use").
- Keep the endpoint read-only: PA owns the Dynamics `account` writeback, not this app.
- Bump the cron from quarterly (`0 6 15 1,4,7,10 *`) to monthly (`0 6 15 * *`) only when the SoCal program comes online.

Do not:
- Move the BMF extract into Dataverse — reference data stays in Postgres by design.
- Assume Pub 78 / Auto-Revocation lists are loaded (they are not; BMF alone answers "currently exempt?").

Ground truth: `lib/db/migrations/008_irs_exempt_orgs.sql`, `lib/services/irs-bmf-service.js`, `pages/api/cron/refresh-irs-bmf.js`, `pages/api/irs/verify-ein.js`, `scripts/import-irs-bmf.js`, `vercel.json` cron entry, `proxy.js` allowlist.

**Status: code SHIPPED 2026-05-12 (Session 147); data loaded once; FEATURE DORMANT.** Initial implementation shipped 2026-05-12. **First BMF load complete — 1,264,156 rows live in `irs_exempt_orgs` (verified by live Postgres probe 2026-06-04).** The verify-EIN endpoint *can* answer real lookups against that data, but **nothing built calls it** — the only BILL reference is a code comment, and the intended consumer (intake portal / PA flow) isn't built. So there is effectively no production traffic yet.

## What got built

- **Migration 008:** `irs_exempt_orgs` Postgres table (`lib/db/migrations/008_irs_exempt_orgs.sql`, also inlined as v29 in `scripts/setup-database.js`). PK on EIN, partial index on state, composite on (subsection, status).
- **Service:** `lib/services/irs-bmf-service.js` exports `refresh()` (atomic-swap import) and `verifyEin()` (single-EIN lookup). Stream-parses CSV via `csv-parse` and streams into a staging table via `pg-copy-streams`. Both Vercel cron and the CLI call the same `refresh()`.
- **Cron handler:** `pages/api/cron/refresh-irs-bmf.js`, scheduled `0 6 15 1,4,7,10 *` in `vercel.json` (15th of Jan/Apr/Jul/Oct, 06:00 UTC). `maxDuration: 300` override (download + COPY of ~1.95M rows). `CRON_SECRET` auth. Audited via `maintenance_runs`; failure raises `system_alerts` row.
- **Verify endpoint:** `pages/api/irs/verify-ein.js`. `x-irs-verify-secret` shared-secret header (`IRS_VERIFY_SECRET` env var). Allowlisted in `proxy.js` (Next 16 proxy convention; was `middleware.js`) so it does not require an NextAuth session.
- **CLI:** `scripts/import-irs-bmf.js` — `--commit` flag for manual runs (local dev, ad-hoc refresh outside the cron cadence).

## Refresh cadence rationale

**Quarterly, not monthly.** IRS publishes monthly (~14th of each month) but for the research-program pilot (mostly universities with decades-stable status) the marginal benefit of monthly refresh is negligible. The 15th-of-quarter schedule picks up the freshest available data right before each natural usage window (April refresh covers June cycle, October covers December cycle, etc.).

**Bump to monthly when the SoCal program comes online.** SoCal deals with smaller, less-established orgs whose tax status changes more often; the staleness window matters more there. Edit `vercel.json` cron entry from `0 6 15 1,4,7,10 *` → `0 6 15 * *` at that point.

## Boundaries

**This app never writes to Dynamics for IRS verification.** PA owns the writeback to the `account` row. The endpoint is purely read-only against the Postgres reference data; what PA does with the response is its own contract.

**Bulk extract stays in Postgres, not Dataverse.** Wave 2 reframing: Postgres's durable role is reference data (retractions, IRS); the staging/system-of-record role is what Wave 1/2 drained. The IRS extract is a textbook reference-data fit.

## Open items + gotchas (carry these into future sessions)

- ~~**First load not yet run.**~~ **DONE** — 1,264,156 rows live in `irs_exempt_orgs` (verified 2026-06-04). This was a one-off load (likely the `scripts/import-irs-bmf.js --commit` CLI), NOT the cron.
- **Quarterly cron is CONFIGURED but has NEVER fired.** `maintenance_runs` has 0 IRS/BMF rows (other crons log there fine, so it's not a logging gap); the Apr-15 fire predated the feature, so the first post-deploy scheduled fire is **2026-07-15**. Do NOT assume the data auto-refreshes until a `maintenance_runs` row proves a successful run. If freshness matters before then, run the CLI manually.
- **CSV encoding.** Not formally declared by the IRS. We use `csv-parse` with `bom: true`; if Latin-1 (e.g. accented org names) surfaces, the importer may need an encoding pass. Watch refresh-cron logs.
- **Pub 78 + Auto-Revocation List are NOT loaded.** BMF alone answers "currently exempt?" (removal from BMF = effectively revoked per the data dictionary). Add if a real edge case surfaces.
- **PA timing decision still owed.** When does PA fire the verification — on `account` create, on submit, or on `'Phase II Pending'` flip? Connor's call; sub-question under intake portal Track 1B (`docs/archive/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md`).
- **EIN form field on the intake form.** Required so the `account` row gets the EIN at submission time. Add to Sarah's field inventory at the 2026-05-13 meeting.

Related: [[project-w6-table-drop-closed]] (other Postgres reference-data work), [[project-reviewer-postgres-to-dataverse-migration]] (the strategic reframing this verification path benefits from).
