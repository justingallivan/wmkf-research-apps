---
name: project-migration-numbers-claimed-off-main
description: "Before allocating a Postgres migration, reconcile the checked-in migration files with the shared database tracker; a branch may already have applied a file before merge."
status: active
last_verified: 2026-10-17 via scripts/apply-migrations.js, current migration tree, manifest, and Postgres Atlas
metadata:
  type: project
---

## Recall Rule
Read before choosing a migration number, adding `lib/db/migrations/*.sql`,
or editing a branch-only migration.

Do: inspect all local and relevant remote branch filenames, the migration
manifest, and the `schema_migrations` tracker through the authorized owner-run
read when production state matters. Reconcile before allocation. Existing
databases use `node scripts/apply-migrations.js`; it applies every unrecorded
file in sorted order, so never assume a branch-only migration is unapplied or
safe to edit.

Do not: store a mutable "next number" here or infer live application from a
merge. Production tracker reads are owner-run; if unavailable, mark the number
UNKNOWN and ask for the read rather than guessing.

Ground truth: `lib/db/migrations/`,
`lib/db/migrations-manifest.json`, `lib/db/migrations/*.sql`,
`docs/atlas/postgres-infra-tables.md`, and `scripts/apply-migrations.js`.
The detailed dated allocation chronology formerly kept here is preserved in
`docs/audits/memory-migration-allocation-history-2026-10-17.md` under an explicit
historical boundary. It explains the pre-merge application pattern but does not
identify current allocation state.
