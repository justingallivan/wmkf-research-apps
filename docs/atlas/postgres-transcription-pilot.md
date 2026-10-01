---
title: "Atlas: AssemblyAI transcription pilot (Postgres)"
domain: postgres
kind: state-page
status: source-built-unapplied
summary: "Branch source for temporary owner-bound transcription jobs; local fresh-bootstrap reconciliation is verified, while migration 060 remains unapplied to any remote database."
canonical: true
cataloged: 2026-09-30
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md
  - lib/db/migrations/060_transcription_jobs.sql
  - lib/services/transcription-pilot/store.js
---

# Atlas: AssemblyAI transcription pilot (Postgres)

## Current status

**[SOURCE-BUILT IN THIS BRANCH; SCHEMA UNAPPLIED; NOT DEPLOYED]** The table
definition is `lib/db/migrations/060_transcription_jobs.sql` and is registered
in the repository migration manifest and fresh-install shape. Migration 060 is
provisional. Per owner-confirmed reservations, 058 and 059 remain assigned to
other work. This implementation has not applied migration 060 to Production,
Preview, or another shared database; no shared-database probe was performed
for this entry. The integration suite applies the migration only in a unique
local scratch schema.

**[VERIFIED 2026-09-30 via Vercel metadata]** Unconnected test resources now
exist: Neon `store_TSn9yHJW1xL0p4h0` and private Blob
`store_Qri02A1kj96tQYR9`. Neither is bound to the app. This is resource
provisioning, not schema or database-content verification. Existing shared
Production/Preview database configuration is unchanged. **[VERIFIED locally;
Sol reviewed and root verified]** The repaired fresh-install path recorded 57 tracked
entries (53 actual SQL migrations plus four retired/absent entries); its
canonical rerun skipped all 57, and atomic rollback and populated-database
refusal were checked. This local disposable-database proof does not establish
the unconnected Neon database's contents or schema. The selected test admin's
directory identity is verified, but isolated active profile/superuser-role
seeding remains pending. No remote SQL connection, environment binding,
migration 060 apply, or deployment has occurred; see the runbook for the
separate Preview connection boundary and evidence.

## Intended state ownership

`transcription_jobs` is an operational lifecycle ledger keyed by job UUID and
owned by `user_profiles.id`. Postgres stores bounded metadata, state, hashes,
exact persisted paths for cleanup, lease and attempt state, provider
correlation/receipt fields, and bounded evaluation fields. Private Blob stores
audio and transcript content. AssemblyAI owns the remote asynchronous job
until completion or deletion. This table is not a transcript-content store,
and it does not make a provider result authoritative until verified and saved.

The store implements owner-scoped idempotent creation, a global active-slot
partial unique index, lease/version-fenced worker writes, per-attempt callback
candidates, and explicit `submission_uncertain` handling after persisted
submission intent. A pre-intent expired lease is recoverable without a
provider POST; a post-intent expired lease retains the global slot and is not
automatically resubmitted. Explicit owner reconciliation verifies a provider
job against the encrypted upload reference; acknowledged abandonment records
the unresolved remote-work risk and releases only the local slot.

Cleanup is separate from readable content state. Exact path tombstones remain
until deletion is confirmed; no prefix deletion is performed. User DELETE
immediately blocks further content access but does not by itself cancel a
provider job or release an uncertain slot. The owner projection excludes
storage paths, provider IDs, encrypted references, and lease tokens, and
redacts filenames and notes upon cleanup request, expiry, or content purge.
Receipt expiry also redacts evaluation/model/size/duration metadata at read time.
`receipt_purged_at` prevents repeated metadata purge writes while retaining
identifiers required for unresolved cleanup. `upload_valid_until` is reserved
before token minting; issued-capability input targets remain tracked/reaped
until a verified remote completion protocol can close them. Token expiry alone
does not prove late writes impossible. The owner accepts this uncertainty for
non-sensitive testing; verified closure still gates tombstone removal and
confidential-use approval.

## Source paths and evidence

- Schema and bootstrap: `lib/db/migrations/060_transcription_jobs.sql`,
  `lib/db/migrations-manifest.json`, and `scripts/setup-database.js`.
- Persistence/model: `lib/services/transcription-pilot/store.js` and
  `lib/services/transcription-pilot/model.js`.
- Consumers: `lib/services/transcription-pilot/runtime.js` and `worker.js`,
  the Admin routes under `pages/api/admin/transcription-pilot/`, the AssemblyAI
  callback and scheduled drain routes, and `/admin/transcription-pilot`.
- Tests: `tests/unit/transcription-pilot-store.test.js` and
  `tests/integration/transcription-pilot.pg.test.js`.
- **[VERIFIED 2026-09-30 via local scratch Postgres]** The isolated integration
  suite applies this migration in a fresh unique schema and tests owner,
  idempotency, lease, global-slot, callback, recovery, and database CHECK
  behavior. This is not evidence of a shared schema, deployment, or live
  AssemblyAI account.

Before any deployment, the migration number and tracker must be reconciled
against the target database with owner authorization, then physical schema
readback must verify both tracker and actual table/index/constraint shape.
The existing-database path is `node scripts/apply-migrations.js`; the
fresh-install-only `scripts/setup-database.js` must not be used on a populated
database. See the [pilot pre-enable runbook](../plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md).
