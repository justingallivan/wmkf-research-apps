---
title: "Atlas: AssemblyAI transcription pilot (Postgres)"
domain: postgres
kind: state-page
status: isolated-schema-initialized-disabled-preview-deployed-auth-pending
summary: "Isolated Neon schema initialized; branch-only Preview environment is configured and a disabled candidate is READY; shared databases and provider use remain unchanged, staff auth pending."
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

**[SOURCE-BUILT; ISOLATED TEST SCHEMA INITIALIZED; DISABLED PREVIEW DEPLOYMENT READY]** The table
definition is `lib/db/migrations/060_transcription_jobs.sql` and is registered
in the repository migration manifest and fresh-install shape. Migration 060 is
provisional. Per owner-confirmed reservations, 058 and 059 remain assigned to
other work. This implementation has not applied migration 060 to Production,
the shared Preview database, or another shared database; no shared-database
probe was performed for this entry. Migration 060 is applied only to the
isolated Neon database. The integration suite also applies it in a unique
local scratch schema.

**[VERIFIED 2026-09-30 via Vercel metadata]** Test resources exist: Neon
`store_TSn9yHJW1xL0p4h0` and private Blob
`store_Qri02A1kj96tQYR9`. They are manually referenced by branch-scoped
Preview environment records (not Marketplace-connected). Existing
project-wide Production/Preview/Development database settings remain
unchanged; `POSTGRES_URL` and `DATABASE_URL` have branch-only overrides for
`codex/transcription-pilot`. **[VERIFIED 2026-10-01 via read-only SQL]** The owner-supplied
isolated Neon endpoint matched the user-confirmed hostname and differed from
local Production hosts. It connects to `neondb`, current schema `public`; the
pre-initialization catalog probe at `scripts/probe-transcription-preview.js` showed nine
non-system tables, all in `neon_auth` owned by role `neon_auth`.
`project_config` reports one visible row; the other eight tables report zero
visible rows for the connected role (RLS was not disabled or bypassed). No
public/application tables were observed and no row values were read. Neon
describes `neon_auth.*` as the Auth data schema and says enabling Auth
initializes its schema/configuration ([Neon Auth overview](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)).
This is not a literally empty database. **[VERIFIED locally; Sol reviewed and
root verified]** The repaired fresh-install path recorded 57 tracked
entries (53 actual SQL migrations plus four retired/absent entries); its
canonical rerun skipped all 57, and atomic rollback and populated-database
refusal were checked. **[VERIFIED 2026-10-01 via isolated operator and independent
read-only readback]** `scripts/bootstrap-transcription-preview.js` initialized
the isolated public schema, including migration 060, and seeded the authorized
active linked profile and superuser role for `jgallivan@wmkeck.org`. Its
`--verify-only` mode checked manifest provenance, key physical schema objects
and exact identity/role: 57 migration records, one profile, one role, zero jobs,
and nine provider-owned Auth tables still present. The operator never writes
`neon_auth`; a real local Postgres test proved preservation and seed rollback.
Sol approved and root verified; 14 targeted tests passed. Branch-only
environment binding and a READY disabled Preview deployment are now present;
staff authentication and provider calls remain undone. See the runbook for
release boundaries.

**[VERIFIED via Vercel readback 2026-10-01]** Candidate deployment
`dpl_AenjaVkv3DCgpmJRxBiMCfZNdZng` is READY at
`https://wmkfresearchapps-7umx9mat7-justin-gallivans-projects.vercel.app`,
from commit `b7c6ff12e`. Nine environment records are Preview-only for
`codex/transcription-pilot`: the two isolated database URLs, dedicated private
Blob token, two transcription switches, three Dataverse controls, and `NEXTAUTH_URL`. The
switches are explicitly false; the verified controls are interlock `on`,
production reads `no`, and DAL enforcement `on`. The six nonsecret values
were verified through `vercel env run` from an empty temporary directory.
Sensitive value equality for database URLs and Blob token was not established;
the local Blob token mapped to the dedicated store and read-only store metadata
confirmed that store, but its Vercel value was not read back. The new alias
`wmkf-transcription-pilot.vercel.app` points to this first deployment. A bounded unauthenticated request to the
pilot page and list API redirects to `/auth/signin`, demonstrating the auth
gate only. The stable Preview alias remains assigned to a different branch and
was not moved. The owner-approved callback at the new alias's
`/api/auth/callback/azure-ad` is registered, preserving all seven prior URIs.
`NEXTAUTH_URL` matches the new alias origin; a fresh deployment is required
to consume that addition. No staff sign-in, provider call, or upload was
performed.

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

Before any deployment to a different database, the migration number and
tracker must be reconciled against that target with owner authorization, then
physical schema readback must verify both tracker and actual
table/index/constraint shape. The disabled candidate uses the initialized
isolated Neon database through branch-only overrides; no shared schema was
changed or probed.
The existing-database path is `node scripts/apply-migrations.js`; the
fresh-install-only `scripts/setup-database.js` must not be used on a populated
database. See the [pilot pre-enable runbook](../plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md).
