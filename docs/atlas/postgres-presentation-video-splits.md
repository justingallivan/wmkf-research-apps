---
title: "Atlas: Presentation video splits (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "presentation_video_splits holds one row per Stage 4 cut of the copied Zoom MP4 at the confirmed presentation end (migration 080). Slice 2 (store, start route, same-source check) is built on branch claude/stage4-build; migration 080 is not applied and nothing is merged. Slices 3-5 (worker, Sandbox cleanup, approval) are PLANNED."
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
  - lib/utils/presentation-video-split-access.js
  - pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits.js
---

# Atlas: Presentation video splits (Postgres)

## Status

**[Slice 2 of `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md`, built on branch `claude/stage4-build`. Migration 080 is not applied to any database and nothing is merged. `PRESENTATION_VIDEO_SPLIT_ACCESS` is off by default. Slices 3-5 are PLANNED.]**

## Ownership and contract

`presentation_video_splits` holds one row per cut of the request's copied Zoom MP4 at the staff-confirmed presentation end. The table is created once with every column slices 3-5 need. `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` and the approval profile ids reference `user_profiles`; `source_copy_id` references `zoom_video_copies`. The row stores identifiers, counters, lifecycle state and content-free receipts only. The Graph upload session URL is stored only as `upload_url_ciphertext`.

| Column group | Meaning |
|---|---|
| frozen input | `transcript_revision_id`, `presentation_end_ms`, `source_document_id`, `source_drive_id`, `source_item_id`, `source_version_id`, `source_etag`, `source_size`, `source_quickxor_hash`, `mapping_version`; written once at start from the resolver, the current RECORDING winner and the `copied` copy row |
| `lineage` | Content-free JSONB (object, at most 16384 bytes): provenance projection, transcript revision, boundary and its `confirmedBy`/`confirmedAt`, source identity. Never names, attendance, emails or URLs. Not exposed by the GET snapshot. |
| `state`, `lease_token`, `lease_expires_at`, `next_attempt_at`, `cut_attempts`, `cancel_requested_at` | `queued`, `cutting`, `uploading`, `review`, `registering`, `approved`, `failed`, `cancelled`, `superseded`. Terminal and awaiting states hold no lease (CHECK `presentation_video_splits_terminal_unleased`). |
| sandbox ledger | `sandbox_name`, `sandbox_command_id`, `sandbox_created_at`, `sandbox_cleaned_at`, `cleanup_attempts`, `next_cleanup_at`, usage columns, `cleanup_receipt`. Cleanup is tracked independently of `state`. [PLANNED writers, slice 3] |
| output | `upload_url_ciphertext`, `upload_session_expires_at`, `output_*`, `verification_receipt`, `request_document_id`, `superseded_document_id`. [PLANNED writers, slices 3-5] |
| approval | `approval_claim_token`, `approval_claimed_at`, `approval_actor_profile_id`, `approval_registration_attempted`, `approved_by_profile_id`, `approved_at`. [PLANNED writers, slice 4] |
| `failure_code` | Sanitized code. Required when `state = 'failed'`; allowed only on `failed` or `superseded` (`presentation_video_approval_stale`). |

Partial unique indexes: one processing row (`queued`, `cutting`, `uploading`) per request (`idx_presentation_video_splits_processing`) and one awaiting-approval row (`review`, `registering`) per request (`idx_presentation_video_splits_awaiting`).

## States and transitions

| From | To | Function (`presentation-video-split-store.js`) | Trigger |
|---|---|---|---|
| none | `queued` | `startPresentationVideoSplit` | Staff start; one transaction under the advisory lock `presentation_video_split:<request id>`. Refuses (`active`) a processing row, refuses (`approval_in_progress`) any `registering` row (slice 2 has no stale-approval reconciliation), supersedes a `review` row, inserts the row. A unique violation maps to `active`. |
| `review` | `superseded` | `startPresentationVideoSplit` | A newer start |
| `queued` onward | PLANNED | slices 3-5 | Worker, Sandbox supervisor and cleanup, staff approve |

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Store | `lib/services/meeting-tracker-recordings/presentation-video-split-store.js` | Writes the start transaction; reads snapshots (`listPresentationVideoSplitSnapshotsForRequest`, no tokens, ciphertext, lineage or receipts) and `zoom_video_copies` (`findCopiedZoomVideoCopyForDocument`) |
| Service | `lib/services/meeting-tracker-recordings/presentation-video-split-service.js` | Start (same-source checks, lineage) and GET; staff DTO built field by field |
| Flag | `lib/utils/presentation-video-split-access.js` | `PRESENTATION_VIDEO_SPLIT_ACCESS` (`off`, `on`, `test:<request GUID>`; unset or invalid is off) |
| Route | `pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits.js` | GET, POST start (matrix row) |
| Worker, cleanup, approve route | PLANNED | slices 3-5 |

## Not covered

No bytes are cut, uploaded or registered in slice 2, and no Dataverse row is written.
