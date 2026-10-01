---
title: "Atlas: AssemblyAI transcription pilot (Postgres)"
domain: postgres
kind: state-page
status: isolated-project-ready-disabled-synthetic-verification-passed
summary: "Dedicated Production deployment passed 16 readiness checks and synthetic Workflow verification with both flags false. Hourly recovery and daily cleanup are registered and manual native invocations passed; timed delivery, hosted provider jobs, large files and new-origin staff sign-in remain unverified."
canonical: true
cataloged: 2026-10-01
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

**[VERIFIED via Vercel configuration and hosted probes, 2026-10-01]** Dedicated
project `wmkf-transcription-pilot-isolated` (`prj_v2aETCFqGBeqMshR7xoMpTcP9K2e`)
has READY Production deployment `dpl_FybqjEfKVRfbqNggHTJNx6Km1PLh` from source
`7edc71975`, with both flags false. The source registry pins its project ID and
`https://wmkf-transcription-pilot-isolated.vercel.app` auth origin. All 16 readiness
checks passed before and after synthetic verification; transcription jobs and
dispatch rows remain zero. Empty recovery/cleanup returned HTTP 200, zero counts
and `incomplete:false`. Synthetic Workflow `wrun_41M3WN29450GQ4ZRP95Q43C50F`
completed retry attempt 2, ten-second sleep/resume and 16,863-byte AAC inspection.
Exactly hourly recovery and daily cleanup are registered; manual native cron
invocations returned HTTP 200, but scheduled-time delivery remains unobserved.
No schema migrations were rerun for this deployment. The old pilot alias remains
on its previous Preview deployment. See the runbook for remaining enablement gates.

**[VERIFIED 2026-10-01 via read-only migration verification and deployment/runtime probes]** The job table definition is `lib/db/migrations/060_transcription_jobs.sql`; migrations 060–061 remain provisional because 058/059 are reserved for other work. Both migrations are applied only to the isolated Neon database, not Production or the shared Preview database; no shared-database probe was performed for this entry. Root's independent read-only `--verify-only` receipt confirmed target `neondb`, transaction read-only, zero transcription jobs, on-disk migration tracker match, no pending migration files, migration 061 recorded, and the `transcription_workflow_dispatches` table/schema verified. It was applied exactly once through the canonical existing-database runner; after the initial checker encountered PostgreSQL NOT NULL catalog entries (`contype='n'`), root corrected the read-only verifier to exclude those entries (`contype<>'n'`) and reran verify-only, not the migration. The isolated `neondb` public schema now has 58 migration records, one active linked profile, one superuser role, and zero transcription jobs. The nine pre-existing `neon_auth` relations remain provider-owned; initialization did not alter that schema. The fresh-install repair's executed-SQL provenance, canonical rerun, atomic rollback, and populated-database refusal were separately tested. Current deployed source includes migration 061.

**[VERIFIED 2026-10-01 via Vercel metadata and authenticated hosted probes]** Disabled Preview `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`, source `d8bb7332654569343e5e1e8985f51a45aae6b25c`, is READY at `https://wmkfresearchapps-ph2tdnosx-justin-gallivans-projects.vercel.app`; the pilot alias `wmkf-transcription-pilot.vercel.app` now points to it. All 13 read-only preflight checks passed before and after the canary and through the alias, with zero jobs and zero dispatch rows. Empty recovery returned HTTP 200 with all counts zero. Synthetic run `wrun_41M3WH0N290GNF967JQG1V18WB` completed: retry resumed on attempt 2, a ten-second sleep resumed, and the 16,863-byte AAC fixture parsed to 3.065034 seconds. The deployed flow uses Node 22, an 800-second timeout and 2,048 MiB memory; an ordinary flow GET returned 404. This proves the bounded SDK retry/sleep and synthetic parser path, not application-job terminal recovery, maximum-size processing, provider behavior or exhaustive queue-auth enforcement.

The deployed source uses job-scoped workflows with bounded active-job checks, 60-second retries (up to 1,440), a 200-cycle handoff, terminal-status-only hourly recovery, and daily physical cleanup; logical expiry blocks reads immediately. The schedules run only in the dedicated Production project, not the old Preview. One separately authorized local real-audio AssemblyAI quality test completed and the owner accepted its quality. No hosted provider job/callback, new-origin staff sign-in, hosted Blob roundtrip or 50 MiB runtime test was performed. The local private-Blob synthetic roundtrip remains local evidence only. New-origin Microsoft callback addition awaits authorization; monitoring remains an enablement gate. Hosting protection is `all_except_custom_domains`: anonymous immutable deployment access redirects to Vercel, while the default origin relies on app authentication (pilot page 307, unauthenticated cleanup 401, unrelated route 404). Existing shared-project configuration and the old alias were unchanged.

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
Migration 061 is applied/read back only in the isolated Neon database. Branch source retries active Workflow steps
after 60 seconds (up to 1,440 retries), hands off after 200 processing cycles,
and has an hourly recovery path that queries SDK status and CAS-recovers only
terminal `completed`, `failed`, or `cancelled` runs. Hosted application-job terminal recovery and
actual timed delivery on the dedicated project remain unverified. This is an enablement gate, distinct
from the unchanged daily physical-deletion cadence.

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
  `lib/services/transcription-pilot/workflow-dispatch.js`, `workflow.js`,
  and the provider-free `workflow-probe.js`,
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
isolated Neon database through dedicated-project Production environment values; no shared schema was
changed or probed.
The existing-database path is `node scripts/apply-migrations.js`; the
fresh-install-only `scripts/setup-database.js` must not be used on a populated
database. See the [pilot pre-enable runbook](../plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md).
