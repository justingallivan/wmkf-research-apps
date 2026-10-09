---
title: "Atlas: Zoom video copies (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "zoom_video_copies holds one row per Stage 3b attempt to copy a Zoom meeting MP4 into the request's SharePoint folder (migration 076, which also adds presentation_material_uploads.origin). Built on branch claude/zoom-copy, not merged; migration 076 NOT applied. Nothing is live and no live call has been made."
canonical: true
cataloged: 2026-10-08
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/postgres-zoom-recording-imports.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - lib/db/migrations/076_zoom_video_copies.sql
  - lib/services/meeting-tracker-recordings/video-copy-store.js
  - lib/services/meeting-tracker-recordings/video-copy-service.js
  - lib/services/meeting-tracker-recordings/video-copy-worker.js
  - lib/services/post-presentation-materials/upload-intent-store.js
  - lib/utils/zoom-video-copy-access.js
  - pages/api/cron/drain-zoom-video-copies.js
---

# Atlas: Zoom video copies (Postgres)

## Status

**[SOURCE-BUILT on branches `claude/zoom-copy-step0` and `claude/zoom-copy`, not merged; migration 076 NOT applied. Nothing is live; no live Zoom, Graph or Dataverse call has been made.]** This page describes the Stage 3b contract as built in source (`docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md`, slices S1-S8). Step 0 (migration 076, browser isolation by `origin`) is on `claude/zoom-copy-step0`; the copy store, service, route, tick worker, cron and card are on `claude/zoom-copy`. Until 076 is applied to a database, none of the paths below can run there. Claude review is done; Codex review is pending.

## Ownership and contract

`zoom_video_copies` holds one row per attempt to copy one Zoom meeting MP4 into the request's `Post Site Visit Materials` SharePoint folder as the request's staff-only `RECORDING`. Each row is linked one-to-one to a `presentation_material_uploads` intent with `origin = 'zoom_copy'` (`upload_id = id`, CHECK `zoom_video_copies_intent_id`), written in the same transaction. The row stores identifiers, counters and lifecycle state only: no URLs, tokens, topics or email addresses (the approved host is kept as `zoom_host_email_sha256`, `sha256(trim(lowercase(email)))`, matching `readZoomImportConfig`). `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` references `user_profiles`. The resolved Zoom download URL lives in memory for one tick and is never persisted; the Graph upload URL exists only as the intent's ciphertext.

| Column group | Meaning |
|---|---|
| `state`, `lease_token`, `lease_expires_at`, `next_attempt_at` | `queued`, `copying`, `registering`, `copied`, `failed`, `cancelled`; terminal states hold no lease (CHECK `zoom_video_copies_terminal_unleased`) |
| `zoom_*`, `declared_size` | The chosen Zoom file, re-derived server side at start; size is positive and at most 2,000,000,000 bytes |
| `confirmed_winner_document_id`, `confirmed_winner_slot_version` | The SharePoint Recording winner staff confirmed replacing (decision 8); both set or both null |
| `bytes_confirmed` | Advisory progress for the card; Graph's `nextExpectedRanges` is the resume pointer. A session restart resets it to 0. |
| `session_create_attempts` (cap 3), `session_restarts` (cap 3), `uncertain_checks` (cap 3, shared), `registration_attempts` (cap 5) | Bounded counters; a cap and the move to `failed` happen in one UPDATE, so no statement increments past the CHECK |
| `sharepoint_drive_id`, `sharepoint_item_id`, `request_document_id` | Receipt identities. Drive and item are set when the exact item resolves (`registering`) or at repair; the Request Document id and `completed_at` are set only at `copied` (CHECK `zoom_video_copies_copied_shape`). `sharepoint_quickxor_hash` is reserved: v1 neither writes nor compares it. |
| `failure_code`, `cancel_requested_at` | Sanitized failure code, present exactly when `state = 'failed'` (CHECK); staff cancel flag |

Partial unique indexes: one `queued`/`copying`/`registering` copy per request (`idx_zoom_video_copies_active_request`) and one `copied` row per request and Zoom file (`idx_zoom_video_copies_copied_file`). The intent row carries the path and generation-key uniqueness.

## States and transitions

Each transition is one named store function with its own predicate; there is no generic column patch. Active-state writers match the copy lease holder (`lease_token` equal and `lease_expires_at > NOW()`), so a dead tick cannot write after a takeover.

| From | To | Function (`video-copy-store.js`) | Trigger |
|---|---|---|---|
| none | `queued` | `startZoomVideoCopy` (N1) | Staff start; one transaction under the request advisory lock inserts the intent (`origin = 'zoom_copy'`, intent expiry 3 days) and the copy |
| `queued` | `copying` | `markZoomVideoCopyCopying` | Graph session receipt recorded on the intent |
| `queued` | `queued` | `recordZoomVideoCopySessionCreateFailure` | Confirmed session-create failure; third failure becomes `failed` `zoom_video_session_create_failed` |
| `queued`/`copying` | same | `recordZoomVideoCopySessionRestart` | Proven-lost session restarts at byte 0; third becomes `failed` `zoom_video_session_expired` |
| `queued`/`copying` | same | `recordZoomVideoCopyUncertainCheck` | Uncertain path, status, cancel or absent-after-final-chunk check; third becomes `failed` with `zoom_video_session_uncertain`, `zoom_video_cancel_uncertain` or `zoom_video_upload_uncertain` |
| `copying` | `copying` | `recordZoomVideoCopyProgress` | Chunk confirmed |
| `queued`/`copying` | `registering` | `markZoomVideoCopyRegistering` | Full item resolved; drive and item recorded |
| `registering` | `registering` | `deferZoomVideoCopyRegistration` | Retryable finalize error; backoff 1, 5, 15, 60 minutes, fifth becomes `failed` `zoom_video_registration_failed` |
| active | `failed` | `failZoomVideoCopy` | Terminal source, path, finalize or validation code |
| active | `cancelled` | `cancelZoomVideoCopy` | Staff cancel observed by the worker (item identity kept if bytes were complete) |
| active or `failed` | `copied` | `markZoomVideoCopyCopied` (N5, under the request advisory lock) | Linked intent is `finalized`; copies the Request Document id and item identity from the intent. A copied-file uniqueness conflict raises `zoom_video_receipt_conflict`; the finalized intent is kept. |
| active (unleased) or `failed` | `failed` (`zoom_video_receipt_conflict`) | `recordZoomVideoCopyReceiptConflict` | After N5 raises a receipt conflict, from either reconcile-finalized or failed-copy inspection. The conflict is permanent (another copied row owns the request and file), so recording it removes the row from N5a for good; the finalized intent is kept and an alert is raised. |
| `queued`/`copying` | flag set | `requestZoomVideoCopyCancel` (N6) | Staff cancel; `registering` is refused (409 `zoom_video_copy_saving`) |

Leases: the copy lease (`ZOOM_VIDEO_COPY_LEASE_SECONDS = 600`, longer than the cron's 300 s `maxDuration`) is taken by `claimZoomVideoCopyWork` (N2, `FOR UPDATE SKIP LOCKED`, one due active row, oldest `updated_at` first) and renewed by `renewZoomVideoCopyLease` before each fenced step. The intent has its own pump, finalize and inspection leases (I1, I3, I4/I5 in `upload-intent-store.js`); a live intent lease defers the tick. `deferZoomVideoCopyAttempt` releases the lease with a delay and no counter (Zoom auth or scope fault, 15 minutes; one `zoom_video_config_error` operational alert per deferral).

Failed copies are not dead ends. `claimFailedZoomVideoCopiesDue` (one CTE, no copy lease) returns up to 2 per tick failed rows whose intent is unsettled (neither `finalized` nor `abandoned`), younger than a 30-day backstop on `updated_at`, and moves `next_attempt_at` out: 10 minutes for the first hour, hourly to one day, then every 6 hours. The worker then inspects for an exactly registered Request Document (receipt inspection never writes to Graph or Dataverse). A `failed` copy with `zoom_video_receipt_conflict` is never re-listed.

## Retention and Stage 5 identities

Stage 5 retention must delete exactly what 3b created. The durable identities are the copy row's `sharepoint_drive_id`, `sharepoint_item_id` and `request_document_id`, plus the linked intent's `candidate_*` columns and `request_document_id`. Neither Zoom nor the 3b worker deletes SharePoint bytes; abandoned-session cleanup stays with the existing intent cleanup under its own gates. The 3 day intent expiry bounds an unfinished copy.

## Kill switch and cron

`ZOOM_VIDEO_COPY_ACCESS` (`off`, `test:<request GUID>`, `on`; unset or invalid is off; `lib/utils/zoom-video-copy-access.js`) gates start, the picker's video fields, GET and the tick. The tick also requires `POST_PRESENTATION_MATERIALS_ACCESS` for the request and the Zoom configuration. Off claims nothing; `test:` claims only that request. Reconcile-finalized (local receipt repair, Postgres only) runs first in every tick even when access is off. Rollback is to set the variable off, redeploy and wait about 10 minutes (the Postgres lease TTL); the plan's release section owns the full procedure.

`/api/cron/drain-zoom-video-copies` (`pages/api/cron/drain-zoom-video-copies.js`, `vercel.json` `* * * * *`, `maxDuration` 300, work deadline 270 s) runs `runZoomVideoCopyTick`: at most one active copy per tick, 10 MiB chunks, a chunk starts only with at least 190 s remaining and the finalize hand-off with at least 150 s. Finalize runs on the tick after bytes complete, not chained.

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Store (all `zoom_video_copies` SQL) | `lib/services/meeting-tracker-recordings/video-copy-store.js` | Writes every transition above; reads snapshots (`getZoomVideoCopySnapshot`, `listZoomVideoCopySnapshotsForRequest`, `findCopiedZoomVideoCopyForFile`, `listFailedZoomVideoCopiesForFile`) |
| Start/GET/cancel service | `lib/services/meeting-tracker-recordings/video-copy-service.js` | Calls N1, N6 and the snapshot reads; builds the staff DTO without lease tokens |
| Tick worker | `lib/services/meeting-tracker-recordings/video-copy-worker.js` | Every worker-side transition; reconcile-finalized and failed-copy inspection |
| Server-origin intent writers | `lib/services/post-presentation-materials/upload-intent-store.js` (`claimZoomCopyIntentPump`, `recordZoomCopyIntentSession`, `claimZoomCopyIntentForFinalize`, receipt-inspection claim/renew/release, `abandonZoomCopyIntentForSourceFailure`, `bindZoomCopyRegisteredReceipt`) | Writes the linked intent only, always keyed on `origin = 'zoom_copy'`; the browser predicates never match these rows |
| Picker listing | `lib/services/meeting-tracker-recordings/import-service.js` (`listZoomRecordingsForVisit`) | Reads the newest 20 copies for the per-meeting `video.copy` summary, only when the copy flag allows |
| Route | `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js` | GET, POST start/cancel (matrix row) |
| Cron | `pages/api/cron/drain-zoom-video-copies.js` | Tick entry |
| Card | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | One read-only GET on mount, start, cancel and Try again through the route |

The Request Document is created only through the existing shared `finalizeClaimedMp4Upload` (a single `createDocument(` writer in `material-service.js`); 3b adds no writer row. See `docs/atlas/dataverse-wmkf-requestdocument.md`.

## Not covered

Duration capture is out of v1. Gallery or non-selected recording variants are never copied. Segmented and over-2,000,000,000-byte meetings are refused with a message to upload manually. Stage 4 splitting and Stage 5 retention are separate plans.
