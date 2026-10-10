---
title: "Atlas: Presentation video splits (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "presentation_video_splits holds one row per Stage 4 cut of the copied Zoom MP4 at the confirmed presentation end (migration 080). Slices 2 (store, start route, same-source check) and 3 (worker, Sandbox supervisor, cleanup ledger, cron) are built on branch claude/stage4-build; migration 080 is not applied and nothing is merged. Slice 4 (binding, approval claim and register, staff open, Board/briefing playback) is built on branch claude/stage4-slice4; slice 5 (card) is PLANNED."
canonical: true
cataloged: 2026-10-10
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-zoom-video-copies.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md
  - lib/db/migrations/080_presentation_video_splits.sql
  - lib/services/meeting-tracker-recordings/presentation-video-split-store.js
  - lib/services/meeting-tracker-recordings/presentation-video-split-service.js
  - lib/services/meeting-tracker-recordings/presentation-video-split-worker.js
  - lib/services/meeting-tracker-recordings/presentation-video-sandbox.js
  - pages/api/cron/drain-presentation-video-splits.js
  - lib/utils/presentation-video-split-access.js
  - pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits.js
---

# Atlas: Presentation video splits (Postgres)

## Status

**[Slices 2 and 3 of `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md`, built on branch `claude/stage4-build`. Migration 080 is not applied to any database and nothing is merged. `PRESENTATION_VIDEO_SPLIT_ACCESS` is off by default. Slices 4-5 are PLANNED.]**

## Ownership and contract

`presentation_video_splits` holds one row per cut of the request's copied Zoom MP4 at the staff-confirmed presentation end. The table is created once with every column slices 3-5 need. `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` and the approval profile ids reference `user_profiles`; `source_copy_id` references `zoom_video_copies`. The row stores identifiers, counters, lifecycle state and content-free receipts only. The Graph upload session URL is stored only as `upload_url_ciphertext`.

| Column group | Meaning |
|---|---|
| frozen input | `transcript_revision_id`, `presentation_end_ms`, `source_document_id`, `source_drive_id`, `source_item_id`, `source_version_id`, `source_etag`, `source_size`, `source_quickxor_hash`, `mapping_version`; written once at start from the resolver, the current RECORDING winner and the `copied` copy row |
| `lineage` | Content-free JSONB (object, at most 16384 bytes): provenance projection, transcript revision, boundary and its `confirmedBy`/`confirmedAt`, source identity. Never names, attendance, emails or URLs. Not exposed by the GET snapshot. |
| `state`, `lease_token`, `lease_expires_at`, `next_attempt_at`, `cut_attempts`, `cancel_requested_at` | `queued`, `cutting`, `uploading`, `review`, `registering`, `approved`, `failed`, `cancelled`, `superseded`. Terminal and awaiting states hold no lease (CHECK `presentation_video_splits_terminal_unleased`). |
| sandbox ledger | `sandbox_name`, `sandbox_command_id`, `sandbox_created_at`, `sandbox_cleaned_at`, `cleanup_attempts`, `next_cleanup_at`, usage columns, `cleanup_receipt`. Cleanup is tracked independently of `state`. Written by the slice 3 worker and cleanup sweep (see below). |
| output | `upload_url_ciphertext`, `upload_session_expires_at`, `output_*`, `verification_receipt`, `request_document_id`, `superseded_document_id`. `upload_*`, `output_*` and `verification_receipt` are written by the slice 3 worker; the document columns are PLANNED (slices 4-5). |
| approval | `approval_claim_token`, `approval_claimed_at`, `approval_actor_profile_id`, `approval_registration_attempted`, `approved_by_profile_id`, `approved_at`. Writers built on branch `claude/stage4-slice4` (slice 4): `claimPresentationVideoApproval`, `markPresentationVideoApprovalAttempted`, `releasePresentationVideoApproval`, `yieldPresentationVideoApproval`, `markPresentationVideoApproved`, `settleStalePresentationVideoApproval`, `supersedeApprovedPresentationVideos`; readers `getPresentationVideoSplitForApproval`, `findAbandonedRegisteringPresentationVideoSplit`. |
| `failure_code` | Sanitized code. Required when `state = 'failed'`; allowed only on `failed` or `superseded` (`presentation_video_approval_stale`). |

Partial unique indexes: one processing row (`queued`, `cutting`, `uploading`) per request (`idx_presentation_video_splits_processing`) and one awaiting-approval row (`review`, `registering`) per request (`idx_presentation_video_splits_awaiting`).

## States and transitions

| From | To | Function (`presentation-video-split-store.js`) | Trigger |
|---|---|---|---|
| none | `queued` | `startPresentationVideoSplit` | Staff start; one transaction under the advisory lock `presentation_video_split:<request id>`. Refuses (`active`) a processing row, refuses (`approval_in_progress`) any `registering` row (the service then reconciles an abandoned, stale one and retries once; see below), supersedes a `review` row, inserts the row. A unique violation maps to `active`. |
| `review` | `superseded` | `startPresentationVideoSplit` | A newer start |
| `queued` | `cutting` | `recordPresentationVideoCutStarted` | Worker: Sandbox created, FFmpeg installed, detached cut command started. `recordPresentationVideoSandboxName` writes the name first (queued, name still null) and `recordPresentationVideoSandboxCreated` stamps `sandbox_created_at`. |
| `cutting` | `uploading` | `recordPresentationVideoCutReceiptAndUploadStarted` | Worker: cut receipt validated; Graph upload session created, stored sealed with `uploadDriveId` in `verification_receipt`; detached upload command started |
| `uploading` | `review` | `markPresentationVideoSplitReview` | Worker: the uploaded item's size and quickXorHash equal the cut receipt exactly; clears lease and `upload_url_ciphertext` |
| `queued`, `cutting`, `uploading` | `failed` | `failPresentationVideoSplit` | Worker: coded failure (`processor_lost`, `presentation_video_receipt_invalid`, `presentation_video_output_mismatch`, `presentation_video_cut_crashed`, a script receipt code, ...). A crash is terminal in v1; `cut_attempts` stays 0. |
| `queued`, `cutting`, `uploading` | `superseded` | `supersedePresentationVideoSplit` | Worker revalidation: copy row, source eTag/quickXorHash, or transcript revision/end changed (`presentation_video_source_changed`, `presentation_video_transcript_changed`) |
| any processing row | same | `claimPresentationVideoSplitWork`, `renewPresentationVideoSplitLease`, `releasePresentationVideoSplitLease`, `deferPresentationVideoSplitAttempt` | Lease claim (also of an expired lease), fence renewals, release after a still-running poll, uncounted configuration deferral. Every transition above is fenced by `lease_token = $x AND lease_expires_at > NOW()` and its own from-state. |
| `review` | `registering` | `claimPresentationVideoApproval` | Staff approve (slice 4): one UPDATE under the per-request advisory lock; sets `approval_claim_token`, `approval_claimed_at`, `approval_actor_profile_id`. Also reclaims a `registering` row whose token is null or whose claim is older than 180 s. |
| `registering` | same | `markPresentationVideoApprovalAttempted` | Under the claim, before any registry lookup-for-write or create: `approval_registration_attempted = TRUE`, claim time refreshed. |
| `registering` | `review` | `releasePresentationVideoApproval` | Error before any registry write (guarded by `NOT approval_registration_attempted`) |
| `registering` | same | `yieldPresentationVideoApproval` | Error after the attempted flag: token nulled, state kept, so the next approve or start reclaims it at once |
| `registering` | `approved` | `markPresentationVideoApproved` | Guarded by the token: `request_document_id`, `approved_by_profile_id`, `approved_at` (the session actor) |
| `registering` | `superseded` | `settleStalePresentationVideoApproval` | Stale-approval reconciliation: `failure_code = presentation_video_approval_stale`, `superseded_document_id` = the orphan Request Document found by generation key, if any. Frees both partial unique indexes. |
| `approved` | `superseded` | `supersedeApprovedPresentationVideos` | A later approval for the same request |

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Store | `lib/services/meeting-tracker-recordings/presentation-video-split-store.js` | Writes the start transaction; reads snapshots (`listPresentationVideoSplitSnapshotsForRequest`, no tokens, ciphertext, lineage or receipts) and `zoom_video_copies` (`findCopiedZoomVideoCopyForDocument`) |
| Service | `lib/services/meeting-tracker-recordings/presentation-video-split-service.js` | Start (same-source checks, lineage; reconciles an abandoned stale `registering` row and retries once) and GET; staff DTO built field by field |
| Approval service | `lib/services/meeting-tracker-recordings/presentation-video-approval-service.js` | Slice 4. `approvePresentationVideoSplit` (claim, revalidate, slot fence, generation-key lookup, the one `PRESENTATION_VIDEO` create seam with a `REQUIRED` actor, `settleWinner`, mark approved), `reconcileStaleApproval`, `resolvePresentationVideoSplitOpen`. Reads the Dataverse TRANSCRIPT and RECORDING winners and Graph; writes the Request Document registry |
| Binding | `lib/services/post-presentation-materials/presentation-video-binding.js` | `bindPresentationVideo`, `presentationVideoFingerprint`, `presentationVideoGenerationKey`; pure |
| Flag | `lib/utils/presentation-video-split-access.js` | `PRESENTATION_VIDEO_SPLIT_ACCESS` (`off`, `on`, `test:<request GUID>`; unset or invalid is off) |
| Route | `pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits.js` | GET, POST start, POST approve (matrix row) |
| Worker | `lib/services/meeting-tracker-recordings/presentation-video-split-worker.js` | `runPresentationVideoSplitTick`: claim, revalidate, dispatch by state, cleanup and orphan sweeps. Reads the Dataverse TRANSCRIPT row and Graph; writes the split row only |
| Card (reader) | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` (`PresentationVideoLine`) | Slice 5, built on branch `claude/stage4-slice5`. Staff only. GETs the route (hidden unless `available: true`), polls every 15 s while any split is `queued`/`cutting`/`uploading`/`registering`, POSTs start and approve, links the staff open route in a new tab. Shows no ids or raw failure codes |
| Sandbox adapter | `lib/services/meeting-tracker-recordings/presentation-video-sandbox.js` | The only `@vercel/sandbox` user (OIDC auth); create, get, run, poll, stop, snapshots, delete, tagged list |
| Cron | `pages/api/cron/drain-presentation-video-splits.js` | Every minute, `maxDuration` 300, 270 s work deadline (matrix row) |
| Open route | `pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits/[splitId]/open.js` | GET; 302 to a fresh Graph download URL for the unregistered output after an id and eTag match (matrix row). Built on branch `claude/stage4-slice4` |

## Sandbox cleanup ledger and orphan sweep (slice 3)

Cleanup is claimable independent of the processing lease. `claimPresentationVideoSplitCleanup` selects up to 2 rows with `sandbox_name` set and `sandbox_cleaned_at` null whose state is outside `queued`/`cutting`/`uploading` and whose `next_cleanup_at` is due, `FOR UPDATE SKIP LOCKED`, and bumps `cleanup_attempts` and `next_cleanup_at` (1 minute, 10 minutes, then 1 hour) in the same statement. A processing row is never cleanable: a polled row legitimately has a null lease between ticks, so the plan's draft predicate (`lease_token IS NULL OR lease_expires_at <= NOW()`) would have cleaned a live cut. Failure and supersede move a row out of processing, which makes it cleanable on the next tick.

Per row, each step idempotent: `Sandbox.get` (404 means gone), stop, `recordPresentationVideoSandboxUsage` (`sandbox_active_cpu_ms`, `sandbox_provisioned_ms`, `sandbox_vcpus`) **before** delete, delete every snapshot (each raises `presentation_video_snapshot_deleted`), delete the Sandbox, confirm absence with a second `get`, then `markPresentationVideoSandboxCleaned` with a content-free `cleanup_receipt`. A failure leaves the row uncleaned for the backoff retry; from the 10th attempt every failure raises `presentation_video_cleanup_failing`.

Orphan sweep: Sandboxes are created with tags `app=wmkf-stage4`, `split=<row id>`, `env=<VERCEL_ENV>`. On the first tick of an instance, and at minute 0 at least 55 minutes after the previous run, the tick lists the `app` tag, keeps only this environment's Sandboxes, asks `listUncleanedPresentationVideoSandboxNames` which still have an uncleaned row, and deletes the rest (at most 3 per tick, alert `presentation_video_orphan_sandbox_cleaned`). The name is written to the row before the create call, so a Sandbox with a live row is never an orphan.

Recovery pass (`claimPresentationVideoSplitRecovery`, runs first every tick, independent of access): unleased or lease-expired processing rows whose request the access flag no longer allows (off, invalid, or `test:` for another request) or whose Sandbox (or, with none, the row) was created longer ago than the Sandbox timeout plus 15 minutes (`COALESCE(sandbox_created_at, created_at)`; never `updated_at`, which lease activity refreshes) are claimed with a fresh lease, their sealed upload session is cancelled, and they move to `failed` with `presentation_video_access_withdrawn` or `presentation_video_processor_expired`; cleanup then removes their Sandbox. Healthy polled rows within the deadline stay excluded. Snapshot cleanup resolves each listed metadata item with `Snapshot.get({ snapshotId })` before `delete()`, and the Sandbox delete passes `deleteOrphanSnapshots: true`.

## Not covered

The worker (slice 3) writes no Dataverse row and registers nothing; the output stays in SharePoint, recorded only on the split row until the staff approve route (slice 4) registers it. `cut_attempts` is unused (a crashed cut is terminal in v1).
