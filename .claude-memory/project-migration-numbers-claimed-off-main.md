---
name: project-migration-numbers-claimed-off-main
description: "Before picking a Postgres migration number, check shared Production `schema_migrations` and numbers claimed on unmerged branches. Migration 055 was applied before merging and is now on main; B4 claims 058."
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
`applied_by` `codex-feature-request-2026-09-26`, alongside 054). At that read,
the file existed only on the unmerged `codex/feature-request`, while `main`
ended at 054. It is now on `origin/main` [VERIFIED via `git ls-tree origin/main
lib/db/migrations/055_post_presentation_materials.sql`, 2026-09-29]. The
episode shows why "the next number after `main`" could have collided.

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
- Allocation as of S552: 055 feature-request (applied, frozen; now on main),
  056–057 Integrity tab (then unapplied; recheck before release), 058 B4,
  059 scheduled-email Part A. The fresh-install blocks are V56
  post-presentation, V57 B4, V58 scheduled-email Part A.
- Checking Production needs the owner to run the query
  ([[feedback-never-self-authorize-prod-dataverse-reads]] covers the same posture).
