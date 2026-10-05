---
name: project-migration-numbers-claimed-off-main
description: "Before picking a Postgres migration number, check shared Production `schema_migrations` and numbers claimed on unmerged branches. 055 and 070 were applied to Production before merging; as of 2026-10-05 067 is on main (PR #432), 071 is claimed off main (PR #441), and the next free number is 072."
status: active
last_verified: 2026-10-05 via lib/db/migrations on main (68 files, ends at 069) and a scan of every remote branch for 065-079
metadata:
  type: project
---

## Recall Rule

Read before choosing a migration number, writing a new `lib/db/migrations/*.sql`,
or editing a migration that exists only on a branch.

[VERIFIED 2026-09-29, Session 552, via an owner-run read-only production
query] Shared Production `schema_migrations` holds
`055_post_presentation_materials.sql` (applied 2026-09-26 06:54Z,
`applied_by` `codex-feature-request-2026-09-26`, alongside 054). At that
read, the file existed only on the unmerged `codex/feature-request`, while
`main` ended at 054. It later merged in PR #365 [VERIFIED via `git log
origin/main`, 2026-09-30]. The episode shows why "the next number after
`main`" could have collided.

- Nothing applies migrations automatically: `npm run build` is `next build`
  and no workflow calls `scripts/apply-migrations.js`. Only a manual
  `npm run apply:migrations` against `POSTGRES_URL` does, and on the owner's
  Macs that variable is shared Production.
- `apply-migrations.js` tracks migrations by filename. It skips recorded names and
  applies every unrecorded file in sorted order, so a gap (an empty 055) is safe.
  Editing an already-applied file is not: the change never reaches that database.
- The app logs the mismatch too: `lib/utils/migration-drift.js` compares the
  manifest with `schema_migrations` when the app cold-starts, and raises `migration_drift_ahead`
  (a warning and a DB alert, with no email) when the database holds a migration the build
  doesn't know. Production may have raised it for 055 before the source merged
  [ASSUMED; the alert rows were not read].
- `applied_by` defaults to the literal `apply-migrations.js` unless
  `APPLY_MIGRATIONS_APPLIED_BY` is set, so it proves *when*, rarely *who*.
- Allocation as of S552 close: 055 post-presentation (applied 09-26, merged in
  PR #365), 056–057 Integrity tab (applied 2026-09-30 by the owner, merged in
  PR #366), 058 B4 (built on `codex/factory-reviewer-b4-runtime`, not applied
  to the operational ledgers), 059 scheduled-email Part A (not yet written).
  The fresh-install blocks are V56 post-presentation and V57 B4; V58 is
  reserved for Part A [VERIFIED via branch source and
  `docs/atlas/postgres-infra-tables.md`, 2026-09-30].
- Checking Production needs the owner to run the query
  ([[feedback-never-self-authorize-prod-dataverse-reads]] covers the same posture).
- Production's 054 was applied from `codex/feature-request` at `af65a24bd`
  (2026-09-24), before `main`'s 15 later edits added the Factory cast tables;
  its tracker row means `apply-migrations.js` will never update it. B4's 058
  must repair it [VERIFIED via git history, S552]. Shape read 2026-09-30: only
  `test_request_runs` + `test_request_run_resources` + `test_request_receipt_ok`.
- [VERIFIED 2026-10-01, owner-authorized read-only query] Production `schema_migrations`
  holds 054–059 (58 rows = manifest). 058 was first adopted on the two managed Neon
  ledgers by `npm run ledger:apply` (S553), then applied to the app DB by the owner's
  `npm run apply:migrations` at 2026-10-01 01:56Z (owner decision: option 1, to clear
  the active `migration_drift` error, which emails ops; rehearsed first on a scratch
  copy of the early-054 shape). Leaving a manifest migration unapplied raises that
  error on every cold start until resolved. 059 was applied
  alone through a one-off owner-run script (BEGIN; body; tracker INSERT; COMMIT,
  `applied_by` `claude-part-a-2026-09-30`) because `apply-migrations.js` has no
  per-file filter and would have applied 058 to the app database too.
- [VERIFIED 2026-10-05 via `ls` and remote-branch scan] `main` ends at 069 with
  067 absent: 067 is claimed by the unmerged `origin/codex/staff-deliberations-rework`
  (`067_staff_deliberations_preparations.sql`). 070 is on `feature/presentation-summary`
  (PR #440) and was applied to Production on 2026-10-05 before merge, the same pattern
  as 055. The owner's run reported 1 applied, 68 skipped from that branch's 69 files, so
  067 was not part of that run; whether Production holds 067 is [ASSUMED unknown].
  067 has since merged to `main` in PR #432 (2026-10-05); commit `81fcfae6c` records it as
  applied to Production. 070 merged in PR #440. **071 is claimed** by `071_summary_draft_slides_identity.sql`
  on `feature/staff-materials-replacement` (PR #441, not merged or applied as of
  2026-10-05). The next free number is 072.
- Auto-mode permissions block Claude from running `apply-migrations.js` against
  the shared database even with owner authorization; the owner runs it with `!`.
