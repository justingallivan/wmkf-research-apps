---
title: "Atlas: AssemblyAI transcription pilot (Postgres)"
domain: postgres
kind: state-page
status: dedicated-project-review-enabled-one-ready-job-speaker-label-live
summary: "Dedicated Production is in review-only mode (pilot on, new submissions off). One authorized hosted job is ready with transcript retained, input Blob absent, and provider API deletion verified. Migration 062 is applied in isolated Neon and the speaker-label UI is live; hosted save/reload and TXT/VTT were verified. Timer delivery and maximum-size processing remain unverified."
canonical: true
cataloged: 2026-10-01
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md
  - docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md
  - lib/db/migrations/060_transcription_jobs.sql
  - lib/db/migrations/061_transcription_workflow_dispatches.sql
  - lib/db/migrations/063_meeting_tracker_transcription.sql
  - lib/services/transcription-pilot/store.js
---

# Atlas: AssemblyAI transcription pilot (Postgres)

## Current status

**[VERIFIED via Vercel configuration, owner-scoped browser review, and read-only
database check, 2026-10-01]** Dedicated project
`wmkf-transcription-pilot-isolated` (`prj_v2aETCFqGBeqMshR7xoMpTcP9K2e`) has
READY Production deployment `dpl_EtKyWuWqTHXuXGQNUGUhTQGFrBhY` from source
`dffe18ba9` at the dedicated default origin. Current
switches are pilot enabled and new submissions disabled. Signed-in SSO and
owner-scoped transcript review passed. The isolated database contains one ready
job (version 26); its transcript remains available, its input Blob is absent,
and the provider API deletion was verified; this does not claim independent
physical erasure of remote bytes. The accepted 40,809,588-byte upload is below
the 50 MiB cap, so maximum-size behavior remains unverified. The earlier
deployment `dpl_FybqjEfKVRfbqNggHTJNx6Km1PLh` passed all 16 preflight checks,
zero-work recovery/cleanup, and route isolation; its synthetic Workflow probe
completed retry, sleep/resume, and AAC inspection. Exactly hourly recovery and
daily cleanup are registered; manual native invocations were logged, but
scheduled-time delivery remains unobserved. The existing pilot alias remains on
the prior shared project. See the runbook for remaining gates.

**[VERIFIED 2026-10-01 via read-only migration verification and deployment/runtime probes]** The job table definition is `lib/db/migrations/060_transcription_jobs.sql`; migrations 060–062 were applied only to isolated Neon, not a shared database. Root's independent read-only readback after applying 062 confirmed 59 tracker entries (58 skipped, one applied) and the `speaker_names` JSONB NOT NULL/default `{}` plus object/65,536-byte CHECK. After hosted label save/reset, the existing job remained ready at version 26 with `{}` and unchanged expiry. The isolated public schema has one active linked profile and one superuser role; the nine pre-existing `neon_auth` relations remain provider-owned. The fresh-install repair's executed-SQL provenance, canonical rerun, atomic rollback, and populated-database refusal were separately tested. No shared database was read or changed.

**[VERIFIED 2026-10-01 via Vercel metadata and authenticated hosted probes]** Disabled Preview `dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`, source `d8bb7332654569343e5e1e8985f51a45aae6b25c`, is READY at `https://wmkfresearchapps-ph2tdnosx-justin-gallivans-projects.vercel.app`; the pilot alias `wmkf-transcription-pilot.vercel.app` now points to it. All 13 read-only preflight checks passed before and after the canary and through the alias, with zero jobs and zero dispatch rows. Empty recovery returned HTTP 200 with all counts zero. Synthetic run `wrun_41M3WH0N290GNF967JQG1V18WB` completed: retry resumed on attempt 2, a ten-second sleep resumed, and the 16,863-byte AAC fixture parsed to 3.065034 seconds. The deployed flow uses Node 22, an 800-second timeout and 2,048 MiB memory; an ordinary flow GET returned 404. This proves the bounded SDK retry/sleep and synthetic parser path, not automatic scheduled recovery, maximum-size processing, provider behavior or exhaustive queue-auth enforcement.

The deployed source uses job-scoped workflows with bounded active-job checks, 60-second retries (up to 1,440), a 200-cycle handoff, terminal-status-only hourly recovery, and daily physical cleanup; logical expiry blocks reads immediately. The schedules run only in dedicated Production; manual native invocations were verified, but scheduled-clock delivery was not. One owner-authorized hosted job completed using a 40,809,588-byte non-sensitive recording; the ready transcript is retained, input Blob is absent, and provider API deletion was verified (without an independent remote byte-erasure claim). Staff SSO is confirmed. This job does not prove the 50 MiB maximum, callback delivery, automatic timer delivery, or confidential-use approval. Migration 062 and the speaker-name feature are live in deployment `dpl_EtKyWuWqTHXuXGQNUGUhTQGFrBhY` from `dffe18ba9`. The six-speaker hosted review verified save/reload and labeled TXT/VTT downloads; TXT uses minute headings without ranges, and VTT preserves precise timing. The temporary name was cleared without another provider request; the job remains ready at version 26 with `speaker_names={}`. Names remain human-authored, validated against detected IDs, excluded from aggregate evaluation CSV, and applied to TXT/VTT only after save. Canonical transcript content is unchanged; the overlay appears only in the owner projection and is redacted when access is blocked/receipt expires. A manually cancelled prior Workflow run was recovered into a new run; automatic terminal-run clock delivery remains unverified. Hosting protection is `all_except_custom_domains`; do not claim every origin/path is Vercel-protected. The existing old alias remains on the prior shared project.

## Intended state ownership

`transcription_jobs` is an operational lifecycle ledger keyed by job UUID and
owned by `user_profiles.id`. Postgres stores bounded metadata, state, hashes,
exact persisted paths for cleanup, lease and attempt state, provider
correlation/receipt fields, and bounded evaluation fields. Private Blob stores
audio and transcript content. AssemblyAI owns the remote asynchronous job
until completion or deletion. This table is not a transcript-content store,
and it does not make a provider result authoritative until verified and saved.

### Meeting Tracker extension — source-built, not applied or released

**[SOURCE-REVIEWED FOR DISABLED SOURCE; MIGRATIONS NOT APPLIED; NOT RELEASED OR LIVE.]** Migration 063 adds
nullable `request_id` and `site_visit_activity_id` UUID bindings to
`transcription_jobs`; a CHECK requires both to be null or both non-null. These
are Dataverse identities stored without Postgres foreign keys. It also adds
nullable `publication_operation_id` and `updated_by_profile_id` (the latter
references `user_profiles.id`) and a partial request/recent index. The existing
dedicated pilot database and its deployed behavior remain as described above;
no shared-database application or live schema readback is claimed here.
The Meeting Tracker routes, services, and `SiteVisitEditor` consumer are now
present in source, including the publication-receipt recovery flow. This does
not change or extend the isolated pilot's deployed behavior, and the global
active provider-slot limit remains shared and unchanged. See the separate
[Meeting Tracker publication Atlas](postgres-meeting-transcript-publications.md)
for source limits, the reviewed recovery contract, and the explicit
quarantine/zero-row close path (closure waits until at least ten minutes after
the receipt lease expires). Migration 064 adds close attribution to that
source-only receipt schema.

The shared application uses the same jobs table for request-bound work while
the pilot remains owner-scoped and unbound. `store.js` treats a missing
`request_id` column as unbound in pilot queries, preserving compatibility with
the older pilot schema. Migration 063 does not change the global active
provider-slot index from migration 060: submitting, processing, saving and
submission-uncertain jobs still share the same single active slot across both
scopes.

Migration 061 adds `transcription_workflow_dispatches`, a transactional
outbox keyed by job UUID. It records only dispatch state, bounded retry timing,
attempt number, a lease/claim token and opaque Workflow run ID; it contains no
audio, transcript, or provider identifier. Queueing a job and creating its
dispatch record are atomic. A retryable start-delivery failure returns the
already-queued owner DTO with `transcription_dispatch_pending`; UI retry
redelivers the same job without another browser upload. Existing job leases and
persisted submission-intent fences prevent blind provider resubmission.
Migrations 061 and 062 are applied/read back only in the isolated Neon database.
Branch source retries active Workflow steps after 60 seconds (up to 1,440
retries), hands off after 200 processing cycles, and has an hourly recovery path
that queries SDK status and CAS-recovers only terminal `completed`, `failed`, or
`cancelled` runs. Manual recovery from a cancelled prior Workflow run to a new
run was verified; automatic terminal-run scheduled delivery remains unverified.
This is an enablement gate, distinct from the unchanged daily physical-deletion
cadence.

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

Migration 062 source adds a sparse Postgres `speaker_names` JSONB overlay for
human-authored display labels keyed by detected provider speaker IDs. It does
not rewrite transcript JSON/Blob content. The owner-scoped DTO exposes the
overlay only while content access is allowed and the evaluation receipt is
live; aggregate evaluation CSV omits names. Server-side TXT/VTT formatters use
saved names, with TXT/minute-grouped readable text headed `0:00`, `1:00`, etc.
and VTT retaining original utterance timing. Migration 062 is applied in
isolated Neon; the PATCH/UI consumer is live in deployment
`dpl_EtKyWuWqTHXuXGQNUGUhTQGFrBhY` and its save/download flow was smoke-tested
on the live one-job transcript.

## Source paths and evidence

- Schema and bootstrap: `lib/db/migrations/060_transcription_jobs.sql`,
  `lib/db/migrations/061_transcription_workflow_dispatches.sql`,
  `lib/db/migrations/062_transcription_speaker_names.sql` (applied/read back in isolated Neon),
  `lib/db/migrations/063_meeting_tracker_transcription.sql` and
  `lib/db/migrations/064_meeting_transcript_close_attribution.sql` (source-only; neither applied),
  `lib/db/migrations-manifest.json`, and `scripts/setup-database.js`.
- Persistence/model/formatters: `lib/services/transcription-pilot/store.js`,
  `model.js`, and `transcript-format.js`; the cron readiness-only mode is
  implemented in `lib/services/transcription-pilot/preflight.js`.
- Consumers: `lib/services/transcription-pilot/runtime.js` and `worker.js`,
  `lib/services/transcription-pilot/workflow-dispatch.js`, `workflow.js`,
  and the provider-free `workflow-probe.js`,
  the Admin routes under `pages/api/admin/transcription-pilot/` (including
  live versioned speaker-name PATCH), the AssemblyAI
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
