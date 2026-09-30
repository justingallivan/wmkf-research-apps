---
name: project-migration-numbers-claimed-off-main
description: "Before picking a Postgres migration number, check shared Production `schema_migrations` and unmerged branches, not just `main`'s lib/db/migrations/. Codex applied 055_post_presentation_materials.sql to Production from the unmerged codex/feature-request branch (S552)."
status: active
metadata:
  type: project
---

## Recall Rule

Read before choosing a migration number, writing a new `lib/db/migrations/*.sql`,
or editing a migration that exists only on a branch.

[VERIFIED 2026-09-29, Session 552, via an owner-run read-only production
query] Shared Production `schema_migrations` holds
`055_post_presentation_materials.sql` (applied 2026-09-26 06:54Z,
`applied_by` `codex-feature-request-2026-09-26`, alongside 054). At the time the
file existed only on the unmerged `codex/feature-request` (it merged later
in PR #365). `main`'s migrations
directory then ended at 054, so "the next number after `main`" would have
collided.

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
  doesn't know. So Production should have been raising it for 055 since
  2026-09-26 [ASSUMED; the alert rows were not read].
- `applied_by` defaults to the literal `apply-migrations.js` unless
  `APPLY_MIGRATIONS_APPLIED_BY` is set, so it proves *when*, rarely *who*.
- Allocation as of S552 close: 055 post-presentation (applied 09-26, merged to
  `main` in PR #365), 056–057 Integrity tab (applied 2026-09-30 by the owner,
  merged in PR #366), 058 B4, 059 scheduled-email Part A (both not yet written). The
  fresh-install blocks in `scripts/setup-database.js` collide the same way
  (V56 feature-request, V57 B4, V58 Part A).
- Checking Production needs the owner to run the query
  ([[feedback-never-self-authorize-prod-dataverse-reads]] covers the same posture).
- Production's 054 was applied from `codex/feature-request` at `af65a24bd`
  (2026-09-24), before `main`'s 15 later edits added the Factory cast tables;
  its tracker row means `apply-migrations.js` will never update it. B4's 058
  must repair it [VERIFIED via git history, S552; Production's table shape not read].
- Auto-mode permissions block Claude from running `apply-migrations.js` against
  the shared database even with owner authorization; the owner runs it with `!`.
