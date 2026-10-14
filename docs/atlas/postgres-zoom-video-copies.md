---
title: "Atlas: Zoom video copies (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "zoom_video_copies holds one row per Zoom MP4 copy attempt (migration 076). Copy-time recording_start/recording_end (079) are on main and the columns exist in Production. Missing legacy metadata can be verified and filled without replacing the video or transcript: recovery UI/service built on codex/zoom-video-copy-recovery, not deployed; one authorized CLI repair for 1002852 succeeded 2026-10-14."
canonical: true
cataloged: 2026-10-08
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/postgres-zoom-recording-imports.md
  - docs/atlas/postgres-presentation-video-splits.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - lib/db/migrations/076_zoom_video_copies.sql
  - lib/db/migrations/079_zoom_video_copy_recording_times.sql
  - docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md
  - lib/services/meeting-tracker-recordings/video-copy-store.js
  - lib/services/meeting-tracker-recordings/video-copy-service.js
  - lib/services/meeting-tracker-recordings/video-copy-worker.js
  - lib/services/post-presentation-materials/upload-intent-store.js
  - lib/utils/zoom-video-copy-access.js
  - pages/api/cron/drain-zoom-video-copies.js
---

# Atlas: Zoom video copies (Postgres)

## Status

**[VERIFIED via `origin/main` source, 2026-10-14]** The copy runtime and migration 079's recording-time capture are on main (`video-copy-service.js`, `video-copy-store.js`, `video-copy-worker.js`). **[VERIFIED via targeted Production query/repair, 2026-10-14]** The recording-time columns exist in Production; the migration ledger was not queried in this session. The original 1003222 Mode D copy and October 9 release are historical rollout evidence, not a current table row count.

**[SOURCE-BUILT, not deployed, 2026-10-14]** Branch `codex/zoom-video-copy-recovery` adds **Verify video** for a copied video missing recording times or a quickXorHash. It verifies the finalized receipt against Zoom and SharePoint, then fills missing metadata only. The authorized CLI repair for 1002852 has already run against Production; this does not mean the branch UI/service is deployed. See “Missing metadata recovery” below.

## Ownership and contract

`zoom_video_copies` holds one row per attempt to copy one Zoom meeting MP4 into the request's `Post Site Visit Materials` SharePoint folder as the request's staff-only `RECORDING`. Each row is linked one-to-one to a `presentation_material_uploads` intent with `origin = 'zoom_copy'` (`upload_id = id`, CHECK `zoom_video_copies_intent_id`), written in the same transaction. The row stores identifiers, counters and lifecycle state only: no URLs, tokens, topics or email addresses (the approved host is kept as `zoom_host_email_sha256`, `sha256(trim(lowercase(email)))`, matching `readZoomImportConfig`). `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` references `user_profiles`. The resolved Zoom download URL lives in memory for one tick and is never persisted; the Graph upload URL exists only as the intent's ciphertext.

| Column group | Meaning |
|---|---|
| `state`, `lease_token`, `lease_expires_at`, `next_attempt_at` | `queued`, `copying`, `registering`, `copied`, `failed`, `cancelled`; terminal states hold no lease (CHECK `zoom_video_copies_terminal_unleased`) |
| `zoom_*`, `declared_size` | The chosen Zoom file, re-derived server side at start; size is positive and at most 2,000,000,000 bytes |
| `confirmed_winner_document_id`, `confirmed_winner_slot_version` | The SharePoint Recording winner staff confirmed replacing (decision 8); both set or both null |
| `bytes_confirmed` | Advisory progress for the card; Graph's `nextExpectedRanges` is the resume pointer. A session restart resets it to 0. |
| `session_create_attempts` (cap 3), `session_restarts` (cap 3), `uncertain_checks` (cap 3, shared), `registration_attempts` (cap 5) | Bounded counters; a cap and the move to `failed` happen in one UPDATE, so no statement increments past the CHECK |
| `sharepoint_drive_id`, `sharepoint_item_id`, `request_document_id` | Receipt identities. Drive and item are set when the exact item resolves (`registering`) or at repair; the Request Document id and `completed_at` are set only at `copied` (CHECK `zoom_video_copies_copied_shape`). `sharepoint_quickxor_hash`: see the next row. |
| `sharepoint_quickxor_hash` | Graph's `file.hashes.quickXorHash` for the exact completed item, written on the `queued|copying -> registering` transition (`markZoomVideoCopyRegistering`). The worker reads it best effort (`readQuickXorHash` in `video-copy-worker.js`): a short budget, a failed read, a different item or a read longer than 10 s (a race bounds token, headers and body) leaves it NULL and never blocks registration. The copy worker does not compare the fingerprint; Stage 4 requires it and compares size plus hash before processing. The original hash-write release was 2026-10-09 (`306ba183f`). Legacy NULL values can be filled only after the verification described below; this page does not assert the current hash of the historical 1003222 row. |
| `recording_start`, `recording_end` | Migration 079's nullable columns are present in Production; their capture is on main. `startZoomVideoCopy` writes the picked MP4's times at N1 through `zoomRecordingTimes`. Missing, unparseable or reversed times become NULL and do not block the copy. CHECK `zoom_video_copies_recording_times_shape`: both or neither, end >= start. The worker's `listAndValidate` rejects changed times with `zoom_recording_changed`; rows without times skip that comparison. Stage 4 requires times equal to the transcript audio file's. Missing times block cutting until verified recovery fills them; they do not require a transcript reset. On the recovery branch, internal snapshots include the times; the public DTO exposes only `needsVerification`, not the evidence. |
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
| `copied` | `copied` | `repairCopiedZoomVideoMetadata` (recovery branch) | Fill missing times/hash after remote identity verification; fence both copy and finalized intent update keys, preserve existing evidence and all receipt identities |
| `queued`/`copying` | flag set | `requestZoomVideoCopyCancel` (N6) | Staff cancel; `registering` is refused (409 `zoom_video_copy_saving`) |

Leases: the copy lease (`ZOOM_VIDEO_COPY_LEASE_SECONDS = 600`, longer than the cron's 300 s `maxDuration`) is taken by `claimZoomVideoCopyWork` (N2, `FOR UPDATE SKIP LOCKED`, one due active row, oldest `updated_at` first) and renewed by `renewZoomVideoCopyLease` before each fenced step. The intent has its own pump, finalize and inspection leases (I1, I3, I4/I5 in `upload-intent-store.js`); a live intent lease defers the tick. `deferZoomVideoCopyAttempt` releases the lease with a delay and no counter (Zoom auth or scope fault, 15 minutes; one `zoom_video_config_error` operational alert per deferral).

Failed copies are not dead ends. `claimFailedZoomVideoCopiesDue` (one CTE, no copy lease) returns up to 2 per tick failed rows whose intent is unsettled (neither `finalized` nor `abandoned`), younger than a 30-day backstop on `updated_at`, and moves `next_attempt_at` out: 10 minutes for the first hour, hourly to one day, then every 6 hours. The worker then inspects for an exactly registered Request Document (receipt inspection never writes to Graph or Dataverse). A `failed` copy with `zoom_video_receipt_conflict` is never re-listed.

## Missing metadata recovery

**[SOURCE-BUILT on `codex/zoom-video-copy-recovery`; not deployed, 2026-10-14]** `video-copy-verification.js` requires a `copied` row linked to a finalized `zoom_copy` intent with matching Request Document, drive, item and size. The Zoom meeting, host, unique completed MP4 file, recording type, size and times must agree with the stored copy. The current SharePoint item must match its recorded drive/item/size and either its original receipt version or original eTag; a metadata-only eTag change is acceptable when the recorded version still matches. Existing times/hash must agree; conflicting or missing remote proof fails closed.

`startZoomVideoCopy` repairs an existing copied row before considering a new upload, after confirming it remains the current Recording winner. `repairCopiedZoomVideoMetadata` updates only missing `recording_start`, `recording_end` and `sharepoint_quickxor_hash` plus `updated_at`, fenced by the exact copy and intent `updated_at::text` keys and finalized receipt identity. It leaves state `copied`. The picker listing and snapshot DTO both expose `needsVerification`; the card preserves that flag and offers **Verify video** independently of audio import. A refusal leaves the transcript untouched and asks staff to contact an administrator if verification keeps failing.

`scripts/repair-zoom-video-copy-metadata.mjs` uses the same verifier/store for an explicitly selected request and copy. It defaults to dry-run; `--apply` permits the fenced metadata update and readback. It does not reset transcripts, change speakers, replace SharePoint bytes, or start a cut.

**[VERIFIED via authorized CLI repair and readback, 2026-10-14]** Request 1002852 (`e5df0b46-3c43-f111-88b5-000d3a3065b8`), copy `555e3fff-a7b2-4e7f-a031-f021a882a48c`: the original SharePoint version and Zoom identity verified; missing metadata was filled. Readback remained `copied`, with `recording_start = 2026-10-09T16:31:01Z`, `recording_end = 2026-10-09T17:25:41Z`, and a present hash. Transcript, speaker assignments and file bytes were unchanged. This was a one-row operational repair, not deployment of the recovery UI.

## Retention and Stage 5 identities

Stage 5 retention must delete exactly what 3b created. The durable identities are the copy row's `sharepoint_drive_id`, `sharepoint_item_id` and `request_document_id`, plus the linked intent's `candidate_*` columns and `request_document_id`. Neither Zoom nor the 3b worker deletes SharePoint bytes; abandoned-session cleanup stays with the existing intent cleanup under its own gates. The 3 day intent expiry bounds an unfinished copy.

## Kill switch and cron

`ZOOM_VIDEO_COPY_ACCESS` (`off`, `test:<request GUID>`, `on`; unset or invalid is off; `lib/utils/zoom-video-copy-access.js`) gates start, the picker's video fields, GET and the tick. The tick also requires `POST_PRESENTATION_MATERIALS_ACCESS` for the request and the Zoom configuration. Off claims nothing; `test:` claims only that request. Reconcile-finalized (local receipt repair, Postgres only) runs first in every tick even when access is off. Rollback is to set the variable off, redeploy and wait about 10 minutes (the Postgres lease TTL); the plan's release section owns the full procedure.

`/api/cron/drain-zoom-video-copies` (`pages/api/cron/drain-zoom-video-copies.js`, `vercel.json` `* * * * *`, `maxDuration` 300, work deadline 270 s) runs `runZoomVideoCopyTick`: at most one active copy per tick, 10 MiB chunks, a chunk starts only with at least 190 s remaining and the finalize hand-off with at least 150 s. Finalize runs on the tick after bytes complete, not chained.

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Store (all `zoom_video_copies` SQL) | `lib/services/meeting-tracker-recordings/video-copy-store.js` | Writes every transition above; reads snapshots (`getZoomVideoCopySnapshot`, `listZoomVideoCopySnapshotsForRequest`, `findCopiedZoomVideoCopyForFile`, `listFailedZoomVideoCopiesForFile`) |
| Start/GET/cancel service | `lib/services/meeting-tracker-recordings/video-copy-service.js` | Calls N1, N6 and snapshot reads; on the recovery branch verifies missing copied metadata and calls the fenced repair; builds the staff DTO without lease tokens |
| Tick worker | `lib/services/meeting-tracker-recordings/video-copy-worker.js` | Every worker-side transition; reconcile-finalized and failed-copy inspection |
| Server-origin intent writers | `lib/services/post-presentation-materials/upload-intent-store.js` (`claimZoomCopyIntentPump`, `recordZoomCopyIntentSession`, `claimZoomCopyIntentForFinalize`, receipt-inspection claim/renew/release, `abandonZoomCopyIntentForSourceFailure`, `bindZoomCopyRegisteredReceipt`) | Writes the linked intent only, always keyed on `origin = 'zoom_copy'`; the browser predicates never match these rows |
| Picker listing | `lib/services/meeting-tracker-recordings/import-service.js` (`listZoomRecordingsForVisit`) | Reads the newest 20 copies for the per-meeting `video.copy` summary, only when the copy flag allows |
| Route | `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js` | GET, POST start/cancel (matrix row) |
| Cron | `pages/api/cron/drain-zoom-video-copies.js` | Tick entry |
| Card | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | One read-only GET on mount, start, cancel and Try again through the route; recovery branch adds Verify video |

The Request Document is created only through the existing shared `finalizeClaimedMp4Upload` (a single `createDocument(` writer in `material-service.js`); 3b adds no writer row. See `docs/atlas/dataverse-wmkf-requestdocument.md`.

## Not covered

Duration capture is out of v1 (recording start and end times are captured from migration 079). Gallery or non-selected recording variants are never copied. Segmented and over-2,000,000,000-byte meetings are refused with a message to upload manually. Stage 4 splitting and Stage 5 retention are separate plans.
