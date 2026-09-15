---
title: Reviewer Institution Migration 051 Production Reconciliation
domain: reviewer-identity
kind: audit
status: complete
summary: "Migration 051 was applied with measurement disabled; the obsolete 038 tracker alias was removed and final drift state is exact."
canonical: false
cataloged: 2026-09-15
last_verified: 2026-09-15
owner: product-engineering
related:
  - lib/db/migrations/051_reviewer_institution_measurement_events.sql
  - scripts/reconcile-migration-051.js
  - docs/atlas/postgres-reviewer-institution-measurement-events.md
---

# Reviewer Institution Migration 051 Production Reconciliation

## Outcome

**[VERIFIED LIVE 2026-09-15]** The canonical existing-database runner applied
only `051_reviewer_institution_measurement_events.sql` to the database shared
by Vercel Production and Preview. Exact post-apply schema verification passed,
the new table held zero rows, and `REVIEWER_INSTITUTION_MEASUREMENT` remained
absent in both environments and therefore disabled. No reviewer-institution
measurement, Phase 2 behavior, application data, or Dataverse data was enabled
or changed.

After that verification, a guarded transaction removed exactly the obsolete
`038_cycle_dossiers.sql` row from `schema_migrations`. The canonical
`045_cycle_dossiers.sql` row remained. Final tracker state is 50 tracked / 50
manifest entries, with no missing or extra migrations.

## Preconditions and evidence

- Production and Preview resolved to the same non-secret database-identity
  digest, `81b9630a1a706031`.
- Neither `REVIEWER_INSTITUTION_MEASUREMENT` nor
  `REVIEWER_INSTITUTION_PHASE2` existed in Production or Preview; both
  evaluated disabled.
- Before apply, 051 was the sole missing manifest migration and obsolete 038
  was the sole extra tracker row. Canonical 045 was already tracked.
- The historical 038 Cycle Dossier SQL and current 045 SQL were byte-identical:
  SHA-256 `73c3d6643b523de36edf72f7cc3f30cee13a807ebb6aa5e72709b1053c888fca`.
  The cleanup script pins this digest and refuses deletion if 045 changes.
- Migration 051 source SHA-256 was
  `23067341be10ec98de66a017bf6f97ec4dd2ad464af5f7309a7916627684f78f`.

## Execution record

1. `scripts/reconcile-migration-051.js --preflight` proved the exact expected
   missing/extra state and captured the 038/045 tracker metadata.
2. `scripts/apply-migrations.js` skipped 49 migrations and applied only 051.
3. `--post-apply` verified the exact columns, check constraints, indexes, empty
   row count, disabled measurement flag, and the still-present obsolete 038
   tracker alias.
4. `--cleanup-038` locked `schema_migrations`, rechecked every precondition,
   deleted exactly one obsolete 038 row, proved exact final parity, and then
   committed. The removed row had been recorded at
   `2026-09-08T02:11:49.850Z` by `apply-migrations.js`; canonical 045 had been
   recorded at `2026-09-12T02:02:31.759Z` by the same runner.
5. Existing alert infrastructure auto-resolved one active `migration-drift`
   alert. The other migration alert keys had no open rows.
6. A final live verification proved no missing/extra tracker rows, 50/50
   parity, exact empty measurement storage, measurement disabled, and no active
   or acknowledged migration alert under `migration-tracker-missing`,
   `migration-drift`, or `migration-drift-ahead`.

The direct standalone import of `lib/utils/migration-drift.js` could not resolve
its extensionless ESM import under plain Node. That read-only diagnostic made no
changes; the existing `AlertService.autoResolve` contract was used for the
bounded alert cleanup, and the committed final verifier independently checked
the resulting alert state.

## Guardrails retained

- Migration 051 is now applied and immutable. Any later schema change must use
  a forward migration and update the fresh-install mirror.
- Applying the migration does not turn on collection. Keep
  `REVIEWER_INSTITUTION_MEASUREMENT` unset/`off` until a separate owner-approved
  prospective measurement decision.
- Keep `REVIEWER_INSTITUTION_PHASE2` unset/`off`; its high-authority rollout
  prerequisites remain open.
- The database reconciliation itself made no deployment, feature-flag
  enablement, application-data mutation, or Dataverse write.

## Code and gates

The guarded verifier and discriminating tests landed in commit `1e577efa`
(`Add guarded migration 051 reconciliation`). The final alert assertion and
durable-record reconciliation are in the commit containing this audit.

Sequential verification passed:

- focused Jest: 4 suites / 18 tests;
- targeted ESLint for the reconciliation script and tests;
- `check:migrations-manifest`: 50 files;
- `check:atlas` then `check:atlas:self-test`: 58 Postgres tables, 36 Dataverse
  entity sets, 12/12 negative patterns;
- `check:doc-currency` then `check:doc-currency:self-test`: no drift markers,
  13/13 fixtures;
- `check:fact-consistency` then `check:fact-consistency:self-test`: 768 live
  files clean and the independent derive fixture passed;
- `check:doc-symbol-refs` then `check:doc-symbol-refs:self-test`: 1,706 path
  references resolved and positive/negative fixtures passed;
- `check:docs-catalog`: 300 top-level Markdown documents; and
- `check:agent-invariants`: three symlinks exact.
