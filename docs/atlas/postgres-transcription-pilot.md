---
title: "Atlas: AssemblyAI transcription pilot (Postgres)"
domain: postgres
kind: state-page
status: disabled-preview-preflight-passed-source-ahead
summary: "The isolated Neon database has migration 060 and the test admin; later source adds durable workflow dispatch in migration 061 but is not deployed or applied remotely. An earlier disabled Preview passed provider-free preflight and an empty drain; current-alias sign-in and AssemblyAI use remain unverified."
canonical: true
cataloged: 2026-09-30
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md
  - lib/db/migrations/060_transcription_jobs.sql
  - lib/db/migrations/061_transcription_workflow_dispatches.sql
  - lib/services/transcription-pilot/store.js
---

# Atlas: AssemblyAI transcription pilot (Postgres)

## Current status

**[VERIFIED 2026-10-01 via migration/readback and deployment/runtime probes]** The job table definition is `lib/db/migrations/060_transcription_jobs.sql`; migration 060 remains provisional because 058/059 are reserved for other work. It is applied only to the isolated Neon database, not Production or the shared Preview database; no shared-database probe was performed for this entry. The isolated `neondb` public schema has 57 migration records, one active linked profile, one superuser role, and zero transcription jobs. The nine pre-existing `neon_auth` relations remain provider-owned; the bootstrap did not alter that schema. The fresh-install repair's executed-SQL provenance, canonical rerun, atomic rollback, and populated-database refusal were separately tested. The public schema includes migration 060's table/index/constraint shape. Later source adds migration 061 and `transcription_workflow_dispatches`, a content-free per-job dispatch outbox; 061 has not been applied to any remote database, including this isolated database, and is not in the earlier deployment.

**[VERIFIED 2026-10-01 via Vercel deployment metadata and authenticated runtime preflight]** Source commit `78a3d5595` is READY as Preview deployment `dpl_DHaVt8QHTzLWo7gr7M6FhVJR344S` at `https://wmkfresearchapps-62z9wnj9y-justin-gallivans-projects.vercel.app`; `wmkf-transcription-pilot.vercel.app` points to it. The other Preview alias remains on deployment `dpl_cgM9vNTVdC1DAUMR55ZQSBdt9Nt2`. Thirteen environment records are branch-scoped, including both isolated database aliases, the dedicated Blob token, disabled feature/submission switches, three Dataverse controls, auth origin, and four secrets. The 13 Preview values were explicitly supplied as deployment runtime/build environment; the authenticated receipt verifies their effective safety-relevant state without exposing values. An authenticated `GET /api/cron/drain-transcriptions?preflight=1` returned HTTP 200 with all ten safety checks true and zero jobs. That runtime receipt confirms the exact pinned Neon endpoint/database, read-only connection, empty jobs table, matching dedicated-store token prefix, required auth origin/Dataverse values, and presence/length of the application secrets; it does not validate AssemblyAI credentials by calling AssemblyAI or prove private Blob access from the deployment. A separate authenticated empty drain returned HTTP 200 with all summary counts zero.

The authenticated empty-drain receipt is for the earlier deployed source only. The current branch source instead uses durable job-scoped workflows with bounded due checks while a job is active, no minute-by-minute idle polling, and daily physical cleanup/retry; logical expiry blocks reads immediately, while healthy daily cleanup may lag by up to 24 hours. This newer source has not been deployed or runtime-verified, and Preview has no automatic daily-cleanup guarantee. No AssemblyAI call was made, no deployed media/max-size proof was run, and no staff sign-in has been attempted on the current alias. An earlier sign-in screenshot used a deployment whose runtime database target was not established; no shared-database mutation was confirmed. The bounded local synthetic AAC test used 16,863 bytes, verified a 3.065-second audio duration, round-tripped through the dedicated private Blob store, and verified exact-path deletion. This is not a deployed max-size or AssemblyAI proof. Existing project-wide environment records and the stable Preview alias were not changed. See the runbook for release boundaries.

## Intended state ownership

`transcription_jobs` is an operational lifecycle ledger keyed by job UUID and
owned by `user_profiles.id`. Postgres stores bounded metadata, state, hashes,
exact persisted paths for cleanup, lease and attempt state, provider
correlation/receipt fields, and bounded evaluation fields. Private Blob stores
audio and transcript content. AssemblyAI owns the remote asynchronous job
until completion or deletion. This table is not a transcript-content store,
and it does not make a provider result authoritative until verified and saved.

Migration 061 adds `transcription_workflow_dispatches`, a transactional
outbox keyed by job UUID. It records only dispatch state, bounded retry timing,
attempt number, a lease/claim token and opaque Workflow run ID; it contains no
audio, transcript, or provider identifier. Queueing a job and creating its
dispatch record are atomic. A retryable start-delivery failure returns the
already-queued owner DTO with `transcription_dispatch_pending`; UI retry
redelivers the same job without another browser upload. Existing job leases and
persisted submission-intent fences prevent blind provider resubmission.
Migration 061 is source-built only and not yet applied remotely. Stale running
dispatch recovery currently waits one day plus the daily run (up to 24–48 hours),
which may exceed the one-day provider TTL. Timely recovery is an open enablement
gate, distinct from the approved daily physical-deletion cadence.

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
  `lib/db/migrations/061_transcription_workflow_dispatches.sql`,
  `lib/db/migrations-manifest.json`, and `scripts/setup-database.js`.
- Persistence/model: `lib/services/transcription-pilot/store.js` and
  `lib/services/transcription-pilot/model.js`; the cron readiness-only mode is
  implemented in `lib/services/transcription-pilot/preflight.js`.
- Consumers: `lib/services/transcription-pilot/runtime.js` and `worker.js`,
  `lib/services/transcription-pilot/workflow-dispatch.js` and `workflow.js`,
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
isolated Neon database through explicitly supplied Preview runtime/build environment values; no shared schema was
changed or probed.
The existing-database path is `node scripts/apply-migrations.js`; the
fresh-install-only `scripts/setup-database.js` must not be used on a populated
database. See the [pilot pre-enable runbook](../plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md).
