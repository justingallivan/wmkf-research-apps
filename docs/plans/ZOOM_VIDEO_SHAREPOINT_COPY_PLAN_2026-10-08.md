---
title: Zoom video copy to SharePoint (Stage 3b)
kind: plan
domain: transcription
status: shipped
summary: "Copy one Zoom meeting MP4 into governed SharePoint as the request's staff-only Recording, using a server-side ranged-GET chunk pump into an origin-marked MP4 upload intent, Graph upload session and the existing finalize path; one new Postgres table plus an origin column (migration 076, shipped first with browser isolation), a ZOOM_VIDEO_COPY_ACCESS kill switch, one visit route and one every-minute cron worker."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Zoom video copy to SharePoint (Stage 3b)

## Status and authority

**[STEP 0 MERGED AND MIGRATION 076 APPLIED, 2026-10-09 (S590); 3b MERGED 2026-10-09 (`780fab218`); ONE MODE D COPY SUCCEEDED; ACCESS `on` 2026-10-09.]** Step 0 and slices S1-S8 were built on branches `claude/zoom-copy-step0` and `claude/zoom-copy`, Claude-reviewed and Codex-approved (`gpt-6-astra`). Step 0 was approved in one round. The 3b build was approved in round 5: rounds 1-4 raised six medium findings, all fixed with regression tests (rulings 27-29 and the S6 rulings). Session 590: the owner applied migration 076 to Production and merged step 0 (`c79f79807`, Production deployment 6963903401 success); probe 3 ran; one local idle tick against Production returned `outcome: idle`. The owner then merged the 3b build (`780fab218`, Production deployment 6965242102 success) with `ZOOM_VIDEO_COPY_ACCESS` unset. The owner then set `test:<1003222>`; one Mode D copy succeeded (149,405,180 bytes, 92 s; the staff MP4 superseded after confirmation; absent from the Board page). The owner then set `on` (non-sensitive) the same day; release step 6 is done. This plan does not authorize a migration, a Vercel setting, a live call, a merge or a deployment; those stay with the owner (release steps 2-6). The design sections below remain the specification; the "Build rulings (Session 589)" section records where the build differs or chose between options, and the durable docs (Atlas, API matrix, credentials runbook, service catalog, file model) describe the built contract. Line citations in the design sections are baselines from before step 0 and S2 (store cites were remapped to step 0 where a symbol is named); locate by symbol.

**Build status by slice.** [Merged 2026-10-09: step 0 `c79f79807`, 3b `780fab218`; migration 076 applied; access `on`.]
- Step 0 (`claude/zoom-copy-step0`): migration 076 (both the `origin` column and the table), the `origin = 'browser'` predicates, the non-destructive registered-item binding and their tests. The table's writers arrive in S3-S6.
- S1: Zoom range transport (`resolveRecordingDownloadUrl`, `fetchRecordingRange`), Graph `putUploadSessionChunk`, the `ZOOM_VIDEO_COPY_ACCESS` parser.
- S2: MP4 mint/finalize seams extracted from the browser path, characterization tests first, and the decision-8 winner-changed hook.
- S3: `video-copy-store.js` and the server-origin intent writers.
- S4: start/GET/cancel service and the `zoom-video-copies` route, plus the 3a picker's video fields.
- S5: tick worker transfer path. S6: finalize hand-off, receipt repair and inspection, Zoom configuration-fault deferral, the `drain-zoom-video-copies` cron and `vercel.json` entries.
- S7: the card (picker video lines, **Import, transcribe and copy video**, replace confirmation, progress and cancel).
- S8: this documentation slice and the gates.

**Migration number.** 076 is reserved for this stage; Stage 2 holds 075.
- [VERIFIED via `git ls-tree` of the migrations directory on each local `refs/remotes/origin/*` ref, 2026-10-08.] No ref carries migrations `075_` to `079_`. `origin/main` ends at `074_zoom_recording_imports.sql`.
- Re-checked after `git fetch` in the Session 588 rework: all 81 `origin/*` refs, still none (Schema section).
- Remote-tracking refs can be stale. Re-fetch and re-check Production `schema_migrations` immediately before writing the migration.

**Stage 3a (audio and Zoom transcript import) is merged as PR #464.** Its migration, 074, is applied to Production [VERIFIED via `ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md:192`; the merge is owner-reported].

**What 3b does.** It copies the meeting video. Stage 4 splitting needs that video, and Stage 5 retention must later delete exactly what 3b creates.

## What exists today

**Recording slot inputs.**
- The card offers two inputs: a Zoom link save and a browser MP4 upload capped at 2,000,000,000 bytes [VERIFIED via `RecordingAndTranscriptCard.js:18`, `:622-624`; `post-presentation-mp4-file.js:2-15`].
- Saving a Zoom link stores an external URL as a `RECORDING` Request Document [VERIFIED via `material-service.js:461-526`].

**Where MP4 bytes go now: straight from the browser to SharePoint, not Blob.**
- `mintMp4Upload` inserts a durable `presentation_material_uploads` intent [VERIFIED via `material-service.js:708-822`].
- It creates a Graph upload session at a server-owned path, `<bucket folder>/Post Site Visit Materials/<RequestNum>-Recording-<uploadId>.mp4` [VERIFIED via `material-service.js:749-750`, `:796`].
- It stores the upload URL only as ciphertext.
- The browser then PUTs 10 MiB chunks directly to Microsoft [VERIFIED via `shared/utils/graph-browser-upload.js:11`].
- The MP4 path makes no Blob write [VERIFIED: no `blob`, `writePrivate` or `put(` in `material-service.js:708-1560`].

**Finalize and registration.** `finalizeClaimedMp4Upload` runs these steps [VERIFIED via `material-service.js:1224-1490`; the create is at `:1291-1325`]:
1. Re-resolves the exact full-size item and checks it is stable.
2. Reads the 32-byte `ftyp` signature and requires the Graph mime type `video/mp4`.
3. Acquires the Recording slot fence.
4. Creates a Ready/Draft `wmkf_requestdocument`, or recovers one by generation key. The row carries the full SharePoint identity: site, drive, item, version, eTag and size.
5. Supersedes the captured predecessors.
6. Completes the intent.

That create seam is already registered as `REQUIRED` in `check:request-document-writers` [VERIFIED via `scripts/check-request-document-writers.js:43`].

**Latest-only slot.**
- Predecessors are Ready, non-superseded `RECORDING` rows that have a valid backing and a slot version below the new fence.
- External Zoom-URL rows count as a valid backing [VERIFIED via `material-service.js:1274-1281`; `material-model.js:101-130`].
- So a finalized MP4 supersedes an earlier Zoom-link row. This is what replaces the Zoom link once the copy is verified.

**Cleanup.**
- The daily maintenance cron reconciles expired intents [VERIFIED via `pages/api/cron/maintenance.js:247`].
- Destructive cleanup needs `POST_PRESENTATION_MATERIALS_CLEANUP=on` [VERIFIED via `upload-intent-cleanup.js:52`].
- That variable is recorded as not configured live [VERIFIED via `CREDENTIALS_RUNBOOK.md:288`].

**Outside readers exclude `RECORDING`.**
- The Board presentation page serves only `PRESENTATION_TRANSCRIPT` and `TRANSCRIPT_SUMMARY` among post-presentation types [VERIFIED via `presentation-page-service.js:29-37`, `:168`].
- The deliberation briefing applies the same allowlist for both listing and direct open [VERIFIED via `deliberation-briefing/briefing-page-service.js:92-106`, `:294`, `:782`].
- Both reader suites already inject a `RECORDING` row [VERIFIED via `tests/unit/presentation-page-service.test.js:106-157`; `tests/unit/deliberation-briefing-page-service.test.js:32-45`].

**No reusable streaming primitive.** Neither the Zoom download nor the Graph upload can stream a file today.
- `downloadRecordingFile` [VERIFIED via `zoom-client.js:154-222`]:
  - buffers the whole body (`readBounded`);
  - follows redirects only to `*.zoom.us`, sending the bearer token on the first hop only;
  - rejects `text/html` and requires an exact byte count;
  - sends no `Range` header.
- 3a's `pickFiles` ignores MP4s [VERIFIED via `import-service.js:63-76`].
- Graph `uploadFileLarge` requires a whole Buffer [VERIFIED via `graph/upload-session.js:132-193`], and DELETEs the session after any failed chunk PUT (`:186-189`).
- Zoom honors Range on the final `ssrweb.zoom.us` hop, including at an offset without the bearer [VERIFIED via probe 1, Session 588; see probes].

**Session loss today (browser path).** `404` and `410` are not the same [VERIFIED via `material-service.js:875-906`, `:1062-1160`]:
- Status and retry both re-check the exact path at 0, 2 and 8 s after a 404 or 410 from the session.
- `retryMp4Upload` starts a fresh zero-based session **only** when the status was **410** and every path check, including one before the status read, found nothing (`:1080`). It marks the intent `failed`/`session_expired`, creates the session, and records it with `recordPresentationMaterialUploadRecoverySession`, which returns the intent to `initiated` and clears its lease (`upload-intent-store.js:375-397`).
- A **404**, a partial item or any uncertain check marks the intent `failed`/`retry_status_unknown` and reports "reconciliation pending" (`:1080-1084`); it never restarts.
- A complete item at any check is recorded as the candidate for finalize.

**Pilot sizes.**
- The one measured meeting (Oct 5, 62 min) totalled 289 MB across five files [VERIFIED via `MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md:69-70`].
- M4As run 30–55 MB [VERIFIED via `ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md:39`].
- The MP4's own size was not recorded. About 200–250 MB per hour is an inference [ASSUMED].
- The pilot's per-meeting file list names one MP4 type, `shared_screen_with_speaker_view`, suffixed `(CC)` when captions exist [VERIFIED via workflow plan `:69`]. No other layout appeared in 15 meetings (probe 3 below, Session 590).

## Design decisions

1. **Reuse, don't rebuild.**
   - 3b adds a server-side chunk pump in front of three existing pieces: the intent, the Graph session and `finalizeClaimedMp4Upload`.
   - Everything after "bytes are in SharePoint" stays on one code path. There is no new Request Document writer seam, no new artifact type and no second supersede machine.

2. **Artifact type `RECORDING` (100000005).**
   - The full meeting contains the staff discussion, and `RECORDING` is already staff-only.
   - Do not use 100000011 ("Board Presentation Recording"). It is reserved for Stage 4 and has not been inserted [VERIFIED via `docs/atlas/dataverse-wmkf-requestdocument.md:701-703`].

3. **Runtime: an every-minute cron drain, not Vercel Workflow.**
   - The precedent is `drain-materials-uploads`: `verifyCronSecret`, `withDalContext`, at most one job per invocation, `maxDuration` 300 [VERIFIED via `cron/drain-materials-uploads.js:1-17`; `vercel.json:33-35` and its `* * * * *` cron row].
   - Workflow drawbacks:
     - A Workflow run stays pinned to the deployment it started on. A fix then needs a three-step manual recovery [VERIFIED via `ASSEMBLYAI_TRANSCRIPTION_PILOT_RUNBOOK_2026-09-30.md:574-583`].
     - The transcription workflow needed dispatch, ack, expiry, finish and handoff state, plus an hourly recovery cron [VERIFIED via `transcription-pilot/workflow.js:1-80`; `vercel.json` cron `drain-transcriptions?recovery=1`].
   - Cron advantages:
     - A tick always runs the current deployment.
     - The cron route establishes the DAL context that finalize's Dataverse create needs.
   - Cost: up to about a minute before the first byte moves. The card shows this as "Queued".

4. **Graph, not the database, holds the resume pointer.**
   - Each tick reads `nextExpectedRanges` through the existing `getBrowserUploadSessionStatus` [VERIFIED via `upload-session.js:86-104`].
   - A tick killed mid-PUT, a deploy or a lost database write therefore cannot desynchronize the offset.
   - The `bytes_confirmed` column is for display only.

5. **One new table plus one marker column, not an extension of 074.**
   - Audio import and video copy have independent lifecycles.
   - Since PRs #469/#470, a 074 row whose job is queued with cleanup requested counts as ended, so the audio can be re-imported [VERIFIED via `import-service.js` `jobEnded`, diff `c5030df33..ee773977b`].
   - A video identity stored on the 074 row would be re-copied on every audio retry.

## Transfer

**Limits.**
- Vercel Pro with Fluid Compute caps `maxDuration` at 800 s [VERIFIED as recorded in `docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md:43`; https://vercel.com/docs/functions/limitations, from memory].
- Production functions run at 2048 MB [VERIFIED as recorded in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:859`, `:904`].
- The `pages/api/cron/*.js` glob sets 120 s [VERIFIED via `vercel.json:21-23`]. The new cron needs its own `maxDuration: 300` entry, like `drain-materials-uploads` [VERIFIED via `vercel.json:33-35`].

**Chunks.**
- 10 MiB, a multiple of Graph's 320 KiB unit and under its 60 MiB per-request maximum [VERIFIED in code via `upload-session.js:152`; Graph limit from memory].
- At most one chunk is in memory. No bytes pass through the browser or Blob.
- A new Graph helper, `putUploadSessionChunk(uploadUrl, { start, bytes, total })`, sends one PUT with `Content-Range` and returns Graph's next range or the committed item. It must **not** DELETE the session on a failed PUT, unlike `uploadFileLarge` [VERIFIED via `upload-session.js:186-189`]. A failed PUT is a retry, not session loss.

**Range (probe 1 settled it).**
- New `fetchRecordingRange(url, { start, end, total, bearer })` in `zoom-client.js`. Same host rules as `downloadRecordingFile`: https, port 443, no URL credentials, `zoom.us` or `*.zoom.us`, at most 5 manual redirects, bearer on the first hop only [VERIFIED via `zoom-client.js:154-159`, `:193-212`].
- The final response must be **206** with `Content-Range: bytes start-end/total`, `Content-Length = end-start+1`, and not `text/html`.
- **No fallback.** A 200 or any other 2xx to a ranged GET is terminal `zoom_range_unsupported`.
- **Resolved URL.** Each tick calls `getMeetingRecordings` once, follows `download_url` with the bearer to the final `ssrweb.zoom.us` URL, and keeps that URL **in memory for this tick only**. Later chunks in the tick GET it without the bearer (probe 1 showed this works at an offset). Nothing about the URL is persisted; the next tick re-resolves. Re-resolving costs one Zoom API call and one redirect per tick, which is cheaper than storing a bearer-free capability URL.
- **Expiry.** A 401, 403, 404 or 410 from the resolved URL re-resolves once (fresh `getMeetingRecordings` plus redirect) and retries that chunk. If the retried chunk fails the same way, the copy is terminal `zoom_download_denied`. The re-resolve allowance resets after each successful chunk. 429, 5xx and timeouts end the tick without a state change.
- **URL lifetime is [ASSUMED] to exceed one tick (≈5 min), pending probe 2.** If probe 2 shows a shorter life, nothing changes in the protocol; each expiry costs one re-resolve. If it shows the URL dies within one chunk (under 60 s), per-chunk re-resolution becomes the norm and the design should be re-reviewed for Zoom rate limits.
- Download URLs, the resolved URL, query strings and the Zoom token are never persisted, logged, returned or put in an error. Errors carry only `ZoomClientError` codes [VERIFIED pattern via `zoom-client.js:5-8`, `:30-37`].

**Tick budget.** One copy row per tick. `T0` is handler entry; the work deadline is `T0 + 270 s`, 30 s under `maxDuration` 300.
- Per chunk: first Zoom GET 45 s + URL re-resolution 30 s total (fresh listing and all redirect hops) + second GET 45 s + Graph PUT 45 s + lease/database overhead 25 s = **190 s**. Each bound covers the whole operation, including retries; no nested unbounded retry.
- Start a chunk only when at least 190 s remain before the work deadline. Initial URL resolution also has a 30 s total timeout and runs before admission. Recheck remaining time before every remote operation; yield if its allowance no longer fits. The dedicated `pages/api/cron/drain-zoom-video-copies.js` **300 s** function entry is required; the 120 s cron glob cannot run this budget.
- Start finalize only when at least 150 s remain; otherwise leave the row `registering` for the next tick.
- These numbers are [ASSUMED] sizing. They are a liveness aid only. If a tick is killed anyway, its leases expire and the next tick resumes (state table: takeover), and finalize is idempotent by generation key.

**Integrity.**
- Each chunk matches the requested range and length, and Graph's next range equals `start+len`.
- The committed item's size equals Zoom's `file_size`; finalize re-resolves the exact item and checks it is stable [VERIFIED via `material-service.js:647-692`].
- Finalize's `ftyp` signature and `video/mp4` mime checks must pass [VERIFIED via `material-service.js:1245-1254`].
- Zoom publishes no source checksum [ASSUMED, from memory of the Zoom API docs]. v1 records Graph's `file.hashes.quickXorHash` when present, as a fingerprint for Stage 4/5, without comparing it. Whether this tenant returns it is probe 4. If it does not, the column stays null and nothing else changes.
- No duration check in v1 (decision 6). Probe 5 later showed `mvhd` is in the first MiB, so a check could be added; it is not built.

**Variant and segments.**
- Allowlist in code, not in the CHECK: `recording_type` `shared_screen_with_speaker_view`, else `shared_screen_with_speaker_view(CC)`; `file_extension` `MP4`; `status` `completed`; integer `file_size` from 1 to 2,000,000,000.
- Segments: if the meeting has more than one completed file of the chosen type, start refuses with 422 `zoom_video_segmented` and the Zoom link stays. Zoom producing several same-type files for one occurrence is [ASSUMED] possible (pause and resume); probe 3 saw none in 15 meetings, so the refusal stays as a guard. v1 never concatenates.

## State machine and leases

**Two rows, linked at birth.** `zoom_video_copies` (new, migration 076) and one `presentation_material_uploads` intent with `origin = 'zoom_copy'` and the **same id**. Start inserts both in one transaction.

| Copy `state` | Meaning | Intent `state` while here |
|---|---|---|
| `queued` | Rows exist; no Graph session recorded yet | `initiated`, `upload_url_ciphertext IS NULL` |
| `copying` | Session recorded; bytes moving, or session loss being reconciled | `initiated` (or `failed` without candidate after a loss) |
| `registering` | Full item resolved; drive/item recorded on the copy row; finalize pending or retrying | `uploaded` with candidate, or `finalizing` |
| `copied` | Request Document registered | `finalized` |
| `failed` | No transfer retries; exact registration may repair the receipt | Any state, including `finalized` before N5 receipt repair |
| `cancelled` | Terminal; staff cancelled before finalize | `abandoned`, or `uploaded` when bytes were complete (drive/item recorded) |

**Leases.**
- **Copy lease**: `zoom_video_copies.lease_token`, 600 s, longer than `maxDuration` 300, so a live tick is never taken over. Same choice as 3a's import lease [VERIFIED via `import-store.js:13-14`].
- **Intent pump lease**: the intent's own `lease_token`, 300 s [VERIFIED via `upload-intent-store.js:6`], taken with the recovery-shaped predicate and renewed after every chunk.
- **Intent finalize lease**: the same column with `state = 'finalizing'`, renewed by `renewPresentationMaterialUploadLease` [VERIFIED via `upload-intent-store.js:216-229`].
- **Slot lease**: `presentation_material_slot_leases`, token = intent id, 300 s, taken inside finalize [VERIFIED via `material-service.js:1257-1262`; `slot-lease-store.js:17-45`].

**Reuse rule [PLANNED].** Browser lookup and claim entry points get origin-aware server twins I1–I3. Token-only renew/release/mark/complete writers are reused with the phase-specific predicates below. Two identity-keyed writers are explicitly allowed: `refreshPresentationMaterialUploadSession` and the token-bearing `recordPresentationMaterialUploadCandidate`. Always pass `{ uploadId: intent.id, requestId: intent.request_id, actorId: intent.actor_id, leaseToken }` from the persisted, linked `origin='zoom_copy'` intent, never request input. Refresh additionally passes its persisted ciphertext and validated expiry; candidate persistence passes the verified candidate. Both require request and actor even with a token [VERIFIED via upload-intent-store.js:77-91, :120-153; material-service.js:694-705]. Refresh permits only `initiated|uploaded` and allows a free/expired lease as well as the matching token; the caller therefore renews its live recovery lease first. Candidate's token arm requires a live matching lease, excludes `finalized|abandoned`, and changes `failed` without a prior candidate to `uploaded` [VERIFIED via upload-intent-store.js:138-159]. No new twins for these two writers.

**Copy fence.** "Fence" in the table means, in this order: (1) `renewZoomVideoCopyLease` (N3) returns the row, so the copy lease is live and the state is as expected; (2) its returned `cancel_requested_at` is null where cancel applies; (3) `zoomVideoCopyAccess()` still allows this request; (4) the intent lease renew named in the cell succeeds. Any failure stops the tick before the write.

### NEW store functions

Copy-row store, new file `lib/services/meeting-tracker-recordings/video-copy-store.js`:

| Id | Function | Exact predicate / statement |
|---|---|---|
| N1 | `startZoomVideoCopy` (one transaction, `review-panel-store.js:73-84` pattern) | `SELECT pg_advisory_xact_lock(hashtext('zoom_video_copy:' \|\| $request_id \|\| ':100000005'), 0)`; then `SELECT id FROM zoom_video_copies WHERE request_id=$1 AND state IN ('queued','copying','registering')` (any row → 409 `zoom_video_copy_active`); then `SELECT * FROM zoom_video_copies WHERE request_id=$1 AND zoom_file_id=$2 AND state='copied'` (row → replay, 200); then `INSERT INTO presentation_material_uploads (id=$copyId, origin='zoom_copy', state='initiated', …)`; then `INSERT INTO zoom_video_copies (id=$copyId, upload_id=$copyId, state='queued', …)`; `COMMIT`. |
| N2 | `claimZoomVideoCopyWork({ accessRequestId })` | `WITH next AS (SELECT id FROM zoom_video_copies WHERE state IN ('queued','copying','registering') AND (lease_token IS NULL OR lease_expires_at <= NOW()) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) AND ($accessRequestId::uuid IS NULL OR request_id = $accessRequestId) ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE zoom_video_copies c SET lease_token=$t, lease_expires_at=NOW()+600s, updated_at=NOW() FROM next WHERE c.id=next.id RETURNING c.*` |
| N3 | `renewZoomVideoCopyLease({ id, leaseToken, states })` | `UPDATE … SET lease_expires_at=NOW()+600s, updated_at=NOW() WHERE id=$id AND lease_token=$t AND lease_expires_at > NOW() AND state = ANY($states) RETURNING state, cancel_requested_at` |
| N4 | `transitionZoomVideoCopy({ id, leaseToken, from, to, patch })` | `UPDATE … SET state=$to, <patch columns>, updated_at=NOW() WHERE id=$id AND lease_token=$t AND lease_expires_at > NOW() AND state = ANY($from)`. Used for: `queued→copying`; `queued\|copying→registering` (sets `sharepoint_drive_id`, `sharepoint_item_id`, `bytes_confirmed=declared_size`); `queued→queued` or `copying→copying` (counters, `bytes_confirmed`, `next_attempt_at`); `registering→registering` (`registration_attempts+1`, `next_attempt_at`, clears lease); `→failed` (sets `failure_code`, clears lease); `queued\|copying\|registering→cancelled` (clears lease). |
| N5 | `markZoomVideoCopyCopied({ id, leaseToken = null })` | `UPDATE zoom_video_copies c SET state='copied', request_document_id=u.request_document_id, sharepoint_drive_id=u.candidate_drive_id, sharepoint_item_id=u.candidate_item_id, completed_at=NOW(), failure_code=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() FROM presentation_material_uploads u WHERE c.id=$id AND u.id=c.upload_id AND u.state='finalized' AND c.state IN ('queued','copying','registering','failed') AND (($t IS NOT NULL AND c.lease_token=$t AND c.lease_expires_at > NOW()) OR ($t IS NULL AND (c.lease_token IS NULL OR c.lease_expires_at <= NOW())))` |
| N5a | `listZoomVideoCopiesWithFinalizedIntent({ limit })` | `SELECT c.id FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id=c.upload_id WHERE c.state IN ('queued','copying','registering','failed') AND u.state='finalized' AND (c.lease_token IS NULL OR c.lease_expires_at <= NOW()) LIMIT $limit` |
| N6 | `requestZoomVideoCopyCancel({ id, requestId })` | `UPDATE … SET cancel_requested_at=COALESCE(cancel_requested_at, NOW()), updated_at=NOW() WHERE id=$id AND request_id=$requestId AND state IN ('queued','copying') RETURNING *` (no row → read it; `registering` → 409 `zoom_video_copy_saving`; terminal → return as is) |
| N7 | `releaseZoomVideoCopyLease({ id, leaseToken })` | `UPDATE … SET lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id=$id AND lease_token=$t RETURNING *` (state unchanged) |

Intent store, additions to `upload-intent-store.js`:

| Id | Function | Exact predicate |
|---|---|---|
| I1 | `claimZoomCopyIntentPump({ uploadId })` | `UPDATE presentation_material_uploads SET lease_token=$t, lease_expires_at=NOW()+300s, updated_at=NOW() WHERE id=$id AND origin='zoom_copy' AND state IN ('initiated','failed') AND candidate_item_id IS NULL AND request_document_id IS NULL AND intent_expires_at > NOW() AND (lease_token IS NULL OR lease_expires_at <= NOW()) RETURNING *`. This is `claimPresentationMaterialUploadRecovery` (`:273-291`) with `origin` and `intent_expires_at` in place of `request_id`/`actor_id`, so the existing recovery renew/mark/release functions (`:293-373`) fit it exactly. |
| I2 | `recordZoomCopyIntentSession({ uploadId, leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt })` | `UPDATE … SET upload_url_ciphertext=$c, upload_session_expires_at=$e, intent_expires_at=$ie, last_error=NULL, updated_at=NOW() WHERE id=$id AND origin='zoom_copy' AND state='initiated' AND upload_url_ciphertext IS NULL AND candidate_item_id IS NULL AND lease_token=$t AND lease_expires_at > NOW() RETURNING *` (keeps the lease; `recordPresentationMaterialUploadSession` `:58-75` has no lease or origin predicate, so it is not used) |
| I3 | `claimZoomCopyIntentForFinalize({ uploadId })` | `UPDATE … SET state='finalizing', lease_token=$t, lease_expires_at=NOW()+300s, updated_at=NOW() WHERE id=$id AND origin='zoom_copy' AND intent_expires_at > NOW() AND ((state='uploaded' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW())) OR (state='finalizing' AND candidate_item_id IS NOT NULL AND (lease_token IS NULL OR lease_expires_at <= NOW()))) RETURNING *`. This is `claimPresentationMaterialUpload` (`:188-214`) with `origin` in place of `request_id`/`actor_id`, narrowed to a recorded candidate; the NEW server twin also accepts a null finalizing lease left by cleanup release [VERIFIED release clears lease without changing state via upload-intent-store.js:424-438]. |

### State table

All line numbers are `upload-intent-store.js` unless prefixed. `ms` = `material-service.js`.

| Phase | Store functions, in order | Copy `state` predicate | Intent `state` predicate | Leases held | Transition | Fence before each post-await write |
|---|---|---|---|---|---|---|
| **Start** (POST) | N1 | none in `queued\|copying\|registering` for the request; `copied` for (request, file) → replay | none (inserted) | advisory xact lock on request + Recording slot; no row lease | → copy `queued`; intent `initiated`, `origin='zoom_copy'`, ciphertext NULL, `intent_expires_at` = now + 3 d (the `ms:753` provisional formula) | All remote reads (Zoom listing and detail, Request, Site Visit, bucket, Recording winner) happen before `BEGIN`. Access and decision-8 checks run immediately before `BEGIN`. Inside the transaction only Postgres statements run. |
| **Reconcile-finalized** (first step of every tick, before any claim) | N5a, then N5 with `leaseToken=null` per row | `queued\|copying\|registering\|failed`, copy lease free or expired | `finalized` (by `completePresentationMaterialUpload` `:251-270` or cleanup's `bindPresentationMaterialUploadForCleanup` `:467-487`) | none; N5's predicate refuses a row whose copy lease is live | copy → `copied` with `request_document_id`, drive and item from the intent | Single statement; nothing awaited between its read and write. Runs even when access is `off` (see kill switch). |
| **Session create** (tick, missing receipt) | N2; I1; `resolveStableMp4Path` (`ms:647`); `createBrowserUploadSession` (`conflictBehavior:'fail'`); I2; N4 `queued→copying` | `queued` | `initiated`, ciphertext NULL | copy + intent pump | copy `queued→copying`; intent keeps `initiated`, gains ciphertext | Copy fence (N3 states `[queued]`) + `renewPresentationMaterialUploadRecovery` (`:293-307`) before the create; I2's own token predicate for the write; copy fence before N4. Path `complete` → "Bytes complete" row (record the candidate under the pump lease); `partial` or mismatch → `failed` `zoom_video_path_conflict`. A confirmed create or I2 failure leaves `queued` and increments `session_create_attempts` under N3/N4; at 3 → failed/zoom_video_session_create_failed. An ambiguous I2 result first reads back the intent: matching ciphertext means repair, not failure; unknown means retain, never DELETE. Cancel a just-created session only when readback proves it was not recorded (the `ms:1137-1187` pattern). An earlier creation whose receipt was lost is harmless: an uncommitted session creates no item, the path check catches a committed one, and the orphan expires on Graph's clock [ASSUMED, probe 4]. |
| **Pump tick** | N2; I1; path check; `getBrowserUploadSessionStatus`; `refreshPresentationMaterialUploadSession` with `leaseToken` (`:77-96`); per chunk: Zoom ranged GET, `putUploadSessionChunk`; N4 `copying→copying` (`bytes_confirmed`) | `copying` | `initiated` with ciphertext | copy + intent pump | none until the last chunk | Before every PUT and every Postgres write: copy fence (N3 `[copying]`) + `renewPresentationMaterialUploadRecovery`. Refresh receives persisted request/actor and ciphertext plus the token; renew the recovery lease first because its SQL also accepts free/expired leases [VERIFIED via upload-intent-store.js:87-91]. |
| **Bytes complete** (end of pump) | `resolveStableMp4Path`; `recordPresentationMaterialUploadCandidate` with `leaseToken` (`:126-186`); N4 `queued\|copying→registering`; `releasePresentationMaterialUploadRecovery` (`:309-321`) | `queued\|copying` | `initiated` or `failed` without candidate → `uploaded` | copy + intent pump, then copy only | intent → `uploaded` with candidate; copy → `registering` with drive/item ids | Copy fence + recovery renew before the candidate write, **ignoring the cancel flag**: the write records a fact (a committed item), like reconcile-finalized, and cancel is handled after it. After the candidate write the recovery renew can no longer match (`:302` requires `candidate_item_id IS NULL`), so the copy fence alone guards N4. If the tick dies between the two writes, the next tick finds intent `uploaded` with copy `queued` or `copying` and replays N4 from the intent's candidate columns. A cancel flag seen here goes to "cancel after bytes complete". |
| **Session restart after loss** | inside the pump lease: one path check before the status read; on status 404/410, path checks at 0/2/8 s, each after `renewPresentationMaterialUploadRecovery` (the `ms:984-996` loop) | `queued\|copying` | `initiated` or `failed` without candidate | copy + intent pump | **Only** when the status was **410** and every path check was absent: `markPresentationMaterialUploadRecoveryTerminal` (`:323-336`, → `failed`/`session_expired`); N4 `session_restarts+1` (at 3 → `failed` `zoom_video_session_expired`); `createBrowserUploadSession`; `recordPresentationMaterialUploadRecoverySession` (`:375-397`, `failed→initiated`, **clears the intent lease**). The tick then re-claims I1 if budget allows, else ends. **404, a partial item, or any uncertain check**: `markPresentationMaterialUploadRecoveryUncertain` (`:338-353`, `failed`/`retry_status_unknown`); N4 `uncertain_checks+1`, `next_attempt_at` +10 min; at 3 → `failed` `zoom_video_session_uncertain`. A complete item at any check → "Bytes complete". | Copy fence before each mark, create and record. These loss checks follow `retryMp4Upload` [VERIFIED via material-service.js:1062-1088, :1123-1160]; the server adds counters and copy fencing. |
| **Finalize hand-off** | N2 (`registering`, due); budget ≥ 150 s; I3; extracted `finalizeClaimedMp4Upload` (`ms:1224-1489`) with the copy hooks; on success N5 with the tick's token | `registering` | `uploaded` with candidate, or `finalizing` with expired lease | copy + intent finalize + slot (inside finalize) | intent → `finalized` (`completePresentationMaterialUpload`, `ms:1443`); copy → `copied` | Finalize renews at `ms:1231`, `:1242` and the `renewIntentOrLose` closure (`:1265`), and renews nothing directly before `acquireMaterialSlot` (`:1257`). The extraction replaces all of these with one `renewOrStop` closure (browser default: `renewPresentationMaterialUploadLease` only) and adds a call before `:1257`. The copy path extends it with the copy fence (N3 `[registering]`). The cancel flag is honored up to I3; after I3 claims, the fence ignores it, and POST cancel on a `registering` row is refused. The decision-8 hook runs after generation-key lookup and validation (`:1284-1297`), before a new create; verified stale replay retains `ms:1330-1373` reconciliation (see Routes). The slot renew (`renewOrLose`, `ms:307-318`) stays as is. After successful recovery release, the window before I3 holds no intent lease; a crash before release leaves a residual lease, which dispatch waits out. Browser isolation still applies. Cleanup cannot claim an unexpired intent; after a long pause expiry reconciliation applies [VERIFIED via upload-intent-store.js:405-408]. |
| **Registration retry** | on a finalize error: `releasePresentationMaterialUpload` (`:231-249`, terminal flag = `TERMINAL_MP4_VALIDATION_CODES`, `ms:93-96`); then N4 | `registering` | `finalizing` → `uploaded` (or `failed` with candidate when terminal, `:235`) | copy + intent finalize, then copy only | Retryable: `registration_attempts+1`, `next_attempt_at` = now + 1, 5, 15, 60 min, lease cleared; at 5 → `failed` `zoom_video_registration_failed`. Terminal (see "Retry policy"): → `failed` with the code. | Copy fence before N4. Intent release is token-fenced (`:244-245`). |
| **Cancel, before bytes complete** | POST: N6. Tick: N2; I1; then the server cancellation sequence below: path check; `cancelBrowserUploadSession` if ciphertext present; path checks 0/2/8 s; `cancelPresentationMaterialUploadRecovery` (`:355-373`, → `abandoned`); N4 → `cancelled` | `queued\|copying`, `cancel_requested_at` set | `initiated` or `failed`, candidate NULL | copy + intent pump | intent → `abandoned`; copy → `cancelled` | Copy fence (N3 `[queued, copying]`; the cancel arm is expected) + recovery renew before DELETE and abandonment. Abandonment clears the intent lease; N4 afterward uses N3 and the copy token only, with no intent renewal. A 404 from DELETE is not proof (`upload-session.js:104-122`). Path not absent, or outcome not `cancelled\|expired` → `markPresentationMaterialUploadRecoveryUncertain`; the copy stays `queued` or `copying` with the flag, `uncertain_checks+1`; at 3 → `failed` `zoom_video_cancel_uncertain`. A complete item → next row. |
| **Cancel, after bytes complete** | flag seen by the copy fence before N4 `queued\|copying→registering` or before I3 | `queued\|copying` (flag set) or `registering` (flag set earlier, seen before I3) | `uploaded` with candidate | copy | copy → `cancelled` with `sharepoint_drive_id`/`sharepoint_item_id` set; intent left `uploaded`, unregistered | N4's token predicate. POST cancel on a `registering` row is refused (409 `zoom_video_copy_saving`), so once I3 claims, cancel cannot apply. The SharePoint item is deleted only by the existing cleanup when `POST_PRESENTATION_MATERIALS_CLEANUP=on` (`upload-intent-cleanup.js:53`; not configured, `CREDENTIALS_RUNBOOK.md:288`), else by Stage 5. |
| **Takeover after lease expiry** | N2 (expired copy lease); I1 or I3 (expired intent lease, or `finalizing` expired); `acquirePresentationSlotLease` (same token = intent id keeps the fence, `slot-lease-store.js:28-31`) | any of `queued\|copying\|registering` | whatever the dead tick left | new copy lease, then the phase's intent lease | new tokens; state unchanged | Every later write by the dead tick fails its `lease_token = $old` predicate (N3, N4, I2, `:222`, `:244`, `:263`, `:299`). A slot lease left by a dead finalize blocks for ≤ 300 s and surfaces as `post_presentation_slot_busy` (`ms:299-304`), which is a retryable registration retry. |
| **Kill switch off** | tick entry: `zoomVideoCopyAccess()`. `off` → reconcile-finalized only, no N2. `test:<GUID>` → N2 with `accessRequestId`. Mid-tick denial → `releasePresentationMaterialUploadRecovery` or `releasePresentationMaterialUpload` (non-terminal), then N7 | any non-terminal | unchanged | released | none (pause, not fail) | The access check in the copy fence. A Vercel env change takes effect on the next deployment [ASSUMED, from memory], so a running tick keeps its value. The per-write check catches a request no longer allowed by a newer deployment's `test:<GUID>`. Within one tick the cancel flag and the leases do the work. The Graph session keeps its own expiry; after re-enable the restart row applies. |
| **Rollback** (revert to the step-0 build) | step-0 browser functions (all with `origin='browser'`); `claimPresentationMaterialUploadsForCleanup` (`:399-422`, origin-agnostic) | frozen at any state; no tick exists | any; browser predicates match none | none, until cleanup leases an expired intent | none by the app. After expiry and six hours without updates, cleanup can inspect the intent. Today a registered item returns `bound_inspect_only` when destructive cleanup is off [VERIFIED via upload-intent-store.js:405-408; upload-intent-cleanup.js:143-148]. Step 0 must add the non-destructive binding path below; deletion and abandonment remain switch-gated. | Drain first: set `ZOOM_VIDEO_COPY_ACCESS=off`, redeploy, wait 10 min (one copy lease), then revert. Re-deploying 3b later resumes the rows or ends them by the dispatch rule below; reconcile-finalized fixes any that cleanup bound meanwhile. |

### Dispatch (explicit reachable pairs)

[PLANNED] Evaluate rows in order. `Q/C/R` = `queued/copying/registering`; `F/D/X` = `failed/copied/cancelled`. `0/1` means absent/present; `0 or 1` explicitly expands both values. Candidate means `candidate_item_id` with verified identity columns. `L` is the intent lease: `free` includes expired, `own` is the tick's live token, `other` is any other live token. State/shape invariants below are checked before these rows; slash-separated values expand the valid combinations only. Active rows require N2's copy token; terminal rows are never claimed by N2. Receipt repair for F uses N5's null-token fence. Every phase releases its remaining owned intent lease, then N7, on a normal yield; a crash leaves leases to expire. Apply this table again after every state-changing writer or lease release. No implicit route-by-state fallback.

| Copy | Intent | Ciphertext | Candidate | Lease / condition | Action |
|---|---|---|---|---|---|
| Q/C/R/F | finalized | 0 | 1 | free | N5 receipt repair; F uses null-token fence. Never call finalize again. |
| D | finalized | 0 | 1 | free | Return copied receipt; no work. |
| X | uploaded/failed/abandoned/finalized | 0 or 1 | 1 | any | Keep cancelled and preserve item identity; cleanup/reconciliation may change intent only. |
| X | abandoned | 0 | 0 | free | Return cancelled receipt. |
| F | initiated/failed/uploaded/finalizing/abandoned | 0 or 1 | 0 or 1 | free/own/other | No pump or finalize. Release an owned residual phase lease before I4; an owned I4 lease continues inspection. Staff_cancelled is retained without binding. Schedule exact-registration inspection; if bound, first row repairs receipt. Other live lease means defer. |
| Q/C/R | initiated/failed/uploaded/finalizing/abandoned | 0 or 1 | 0 or 1 | other | N7; defer to lease holder, then redispatch. |
| Q/C/R | failed | 0 or 1 | 1 | free/own; expired or unexpired (precedes the expiry row) | Rejected candidate (terminal finalize release, `upload-intent-store.js:231-247`): preserve identities and mapped error; copy-only N4 failed, which releases the request's active-copy lock. Exact registration, if present, is retained for review, never converted to a valid upload. Release owned lease. |
| Q/C/R | initiated/failed/uploaded/finalizing/abandoned | 0 or 1 | 0 or 1 | free/own; expired intent, excluding staff_cancelled and failed-with-candidate (handled by the row above) | Exact-registration reconciliation before expiry failure. Bound → N5; rejected candidate or uncertain/mismatch/ambiguous → retain and back off; proven absent → copy-only N4 failed/zoom_video_intent_expired, preserving candidate. |
| Q/C | abandoned | 0 | 0 | free; last_error=staff_cancelled | Copy-only N4 cancelled; replay crash after abandonment, even after expiry. |
| Q/C/R | abandoned | 0 | 0 or 1 | free; other last_error | Exact-registration check first; absent → N4 failed/zoom_video_intent_abandoned; uncertain → retain. |
| Q/C | initiated/failed | 0 or 1 | 0 | free/own; unexpired, cancel requested | Acquire I1 if free; server cancellation below. Complete path → record candidate then copy-only N4 cancelled with identity. |
| Q/C/R | uploaded | 0 or 1 | 1 | free/own; unexpired, cancel requested before I3 | Copy-only N4 cancelled with identity; release any owned residual pump lease. |
| Q | initiated | 0 | 0 | free/own; unexpired | I1 if free; Session create. Complete path → Bytes complete directly from Q. |
| Q | initiated | 1 | 0 | free/own; unexpired | N3 + N4 Q→C using recorded session; do not create again or count a creation failure. I1 if free, then Pump. |
| C | initiated | 1 | 0 | free/own; unexpired | I1 if free; Pump from Graph's offset. |
| Q/C | failed | 1 | 0 | free/own; unexpired | I1 if free; path/status recovery. Live session → recovery-session writer, reacquire I1, promote Q→C if needed. Complete → Bytes complete. 410/404 → loss rules. |
| Q/C | failed | 0 | 0 | free/own; unexpired | I1 if free; exact path checks. Complete → Bytes complete; absent → bounded session create using recovery-session writer, reacquire I1, promote Q→C if needed; uncertain → retain/back off. |
| Q/C | uploaded | 0 or 1 | 1 | free/own; unexpired | Copy-only N3 + N4 Q/C→R with candidate identity; release owned residual pump lease, then I3 when free. No recovery renewal after candidate write. |
| R | uploaded | 0 or 1 | 1 | free/own; unexpired | Release owned residual pump lease if any; budget check, I3, Finalize hand-off. |
| R | finalizing | 0 or 1 | 1 | free/own; unexpired | Free or expired lease → I3 takeover; own live finalize token → continue finalize with both fences. |
| Any other tuple | Missing/invalid state or shape | any | any | any | Fail closed: no Graph/Dataverse write; record zoom_video_state_invalid, retain identities, release only owned leases and alert. Never guess a phase. |

The final row is an invariant violation, not a reachable-state catch-all: finalized requires ciphertext NULL and candidate/document present; abandoned requires ciphertext NULL; uploaded/finalizing requires candidate; initiated requires no candidate; terminal copy leases are NULL. N1 cannot leave a missing intent; I2 precedes Q→C; candidate persistence precedes Q/C→R; I3 follows R; completion clears ciphertext and lease. Thus C+initiated+no ciphertext, R+no candidate, Q/C+finalizing and D+nonfinalized are invalid. Cleanup can add candidates, clear ciphertext on abandonment, refresh expiry or bind; its live lease takes precedence. A failed copy can retain any nonfinalized intent left by an error or crash; it is receipt-repair-only.

### Recovery and non-destructive receipt binding

**Recorded session and candidate repairs [PLANNED].** After I2 commits, Q+initiated+ciphertext is promoted under N3/N4 without another create. Q+uploaded+candidate is promoted directly to R under the copy lease only. Bytes complete accepts Q or C and `initiated|failed` without candidate; the token-bearing candidate writer changes either to uploaded. Recovery renewal then stops matching, so only the copy fence guards N4 and lease release [VERIFIED via upload-intent-store.js:138-159, :284-311]. Read back I2 after an ambiguous database response before cancelling a newly created session or increasing the failure counter; an existing matching receipt dispatches to repair.

**Failed intent, readable session [PLANNED].** Under I1, validate the status's sequential range and expiry. For `failed` without candidate, call `recordPresentationMaterialUploadRecoverySession` with the existing ciphertext and new expiry, then reacquire I1 before refreshing, pumping or any recovery renewal. That writer requires a live matching token, failed state, no candidate and no document; it sets initiated and clears the lease [VERIFIED via upload-intent-store.js:375-397]. This follows the existing healthy-status branch [VERIFIED via material-service.js:1089-1106]. A complete exact path discovered from failed instead records the candidate under I1 and goes directly to Bytes complete; it never calls session refresh on failed. Creation/restart after a failed intent uses the same writer and reacquisition rule.

**Expired registration [PLANNED].** Before marking an expired or abandoned copy failed, look up the exact generation key and verify the stable full-size candidate. A single document must match request, Recording type, producer, generation key, input fingerprint, drive/item and size, with a positive integer slot version (the identity checks in `validateRecoveredMp4Row`; normal finalize additionally checks its slot fence) [VERIFIED via material-service.js:1209-1221]. Zero documents is absence only after successful reads; errors, mismatches and multiple rows retain/back off and alert. Do not run expired intents through I1/I3 or pretend their renewals accept expiry.

Add **I4 `claimZoomCopyIntentReceiptInspection`**: id and origin=zoom_copy; state in initiated/uploaded/finalizing/failed/abandoned; lease free/expired; and either intent expired, linked copy failed, or state=abandoned with last_error<>'staff_cancelled'. Release any owned pump/finalize token before I4; if cleanup acquires first, defer. Set a 300 s token, without changing state or expiry. A previously held I4 token can continue only after its renewal succeeds. Its renewal requires the same live token and origin, with no unexpired-intent predicate. This is a read/receipt lease, never permission to pump, create or delete. Failed-copy inspections run in bounded due batches, advance `next_attempt_at` on deferral, and release I4. They run only when copy access allows; N5's local finalized repair still runs under off.

Add **I5 `bindZoomCopyRegisteredReceipt`**: in one Postgres transaction, lock the copy then intent, recheck linked ids and origin, live I4 token, unchanged intent state/candidate/generation identity, and either the caller's live copy token for Q/C/R or a free/expired copy lease for F. For abandoned, require a null document and verified matching candidate from the read; never resurrect staff_cancelled. Reject `failed` with a pre-existing candidate (validation rejection). Set verified candidate columns, request_document_id, finalized_at, state=finalized; clear ciphertext, intent lease and error. An uncertain read or failed predicate writes nothing. No Graph or Dataverse mutation. N5 then repairs the copy, including F, retaining its original completed receipt on replay. An intervening N2 claim defeats the null-token predicate in the UPDATE. If another copied row already owns the request/file uniqueness key, retain the finalized intent and alert `zoom_video_receipt_conflict`; do not overwrite or create another copy.

**Cleanup and rollback [BUILT in step 0; merged 2026-10-09, `c79f79807`].** Non-destructive registered-item binding shipped in step 0 along with isolation, and the `bound_inspect_only` retention code that cleanup returned before binding when destructive cleanup was disabled is no longer returned. The rest of this paragraph is the original specification. Before step 0, cleanup returned `bound_inspect_only` before bind when destructive cleanup was disabled, and the bind writer rejects failed-with-candidate [VERIFIED via upload-intent-cleanup.js:143-148; upload-intent-store.js:476-496]. For verified, non-rejected registered candidates, move binding outside the deletion switch and use the same exact identity validation; keep rejection retention and all deletion/abandonment gates. The cleanup token guards its existing bind; it does not write the copy. Thus the oldest rollback build can bind while paused, and N5/N5a repair active or failed copies when 3b returns. If predecessor/stale-row reconciliation is unfinished, retain an explicit reconciliation event; receipt binding does not assert the document is still the winner or silently supersede anything.

Before **Try again** inserts a new operation, inspect failed rows for this request/file through the same reconciliation path; finalized receipts replay, uncertainty returns reconciliation-pending. Under N1's advisory lock, recheck the inspected failed rows' state/updated_at and linked intent state/lease against the inspection snapshot; a new/changed row or live inspection/cleanup lease returns reconciliation-pending. A linked finalized intent must be repaired/replayed before insert even if N5 has not run. The failed-receipt inspection and N5 use the same request advisory lock when settling receipts, alongside their row/token predicates. This prevents an expiry failure from inviting another copy of an already registered file.

**Server cancellation [PLANNED].** Do not call browser `cancelMp4Upload` for initiated-without-ciphertext: it throws recoveryPending [VERIFIED via material-service.js:1026-1027]. Under copy + I1 leases, an intent without ciphertext gets exact path checks at 0/2/8 s; all absent permits abandonment without DELETE, since the server cannot pump without a recorded session. A lost unrecorded create may expire remotely; never invent its URL. Complete path records candidate and cancels with identity; partial/uncertain retains with bounded backoff. With ciphertext, keep DELETE and exact-path confirmation, never treating 404 alone as success. `cancelPresentationMaterialUploadRecovery` writes abandoned/staff_cancelled and clears the intent lease [VERIFIED via upload-intent-store.js:355-373]. After it returns, N3/N4 alone write cancelled; a crash replays abandoned+staff_cancelled as cancelled. The server cancellation helper returns an outcome; for terminal source errors, a separate origin-aware abandonment writer uses the same live-token/state/no-candidate/no-document predicates but stores the source code instead of staff_cancelled, then copy-only N4 writes failed. Never reuse staff cancellation's marker for a source failure.

**Intent rows never stranded by start.** N1 inserts both rows or neither, so review item 4's "intent-less `queued`" row cannot exist. A `queued` row whose session creation keeps failing ends at its attempt cap.

### Retry policy

| Condition | Treatment |
|---|---|
| `request_document_actor_unavailable` (`request-document-actor-service.js:54-62`, thrown under `REQUIRED` at `:110-112`) | Terminal. Intent released non-terminal to `uploaded`; bytes stay unregistered and the copy row keeps drive/item. **Try again** starts a new copy. |
| `post_presentation_mp4_signature_invalid`, `post_presentation_mp4_malware` | Terminal (already `TERMINAL_MP4_VALIDATION_CODES`). |
| `zoom_video_recording_replaced` (decision 8), `post_presentation_site_visit_changed`, `post_presentation_replay_mismatch`, `post_presentation_generation_ambiguous`, `post_presentation_candidate_mismatch` | Terminal. |
| `post_presentation_slot_busy`, `post_presentation_slot_lease_lost`, `post_presentation_upload_lease_lost`, `post_presentation_mp4_mime_unconfirmed`, `post_presentation_create_unconfirmed`, `post_presentation_upload_completion_failed`, Dataverse 5xx or timeout | Retryable, with backoff 1, 5, 15, 60 min; cap 5 attempts. |
| Zoom 429, 5xx or timeout; Graph PUT 5xx or timeout | End the tick, no state change; the next tick resumes from Graph's offset. |
| Zoom file gone, `file_size` or `host_id` changed, host no longer in `ZOOM_RECORDING_HOSTS` | Terminal `zoom_recording_changed` or `zoom_video_host_not_approved`; the session is cancelled through the cancel sequence. |
| Visit unbound, `POST_PRESENTATION_MATERIALS_ACCESS` denies the request, Zoom config removed | Pause (like the kill switch), not fail. Staff can cancel. |

## Schema — migration `076_zoom_video_copies.sql`

**Ref scan [VERIFIED via `git fetch -q origin` then `git ls-tree` of `lib/db/migrations` on all 81 `refs/remotes/origin/*` refs, Session 588 rework, 2026-10-08].** No ref carries `075_` to `079_`; `origin/main` ends at `074_zoom_recording_imports.sql`. 075 stays reserved for Stage 2. Re-fetch and re-check Production `schema_migrations` immediately before writing the file.

**One migration, applied before step 0 merges**, because step-0 code reads `origin`. It holds the `origin` column and the inert new table. Any table change after 076 is applied takes the next free number; an applied migration is never edited. **Owner decision (Session 588): ONE file, `076_zoom_video_copies.sql`, containing both the origin column and `zoom_video_copies`. The migration-split question is resolved; do not reserve 077 for this stage.

```sql
ALTER TABLE presentation_material_uploads
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'browser'
  CONSTRAINT presentation_material_uploads_origin_check CHECK (origin IN ('browser', 'zoom_copy'));

CREATE TABLE IF NOT EXISTS zoom_video_copies (
  id UUID PRIMARY KEY,
  upload_id UUID NOT NULL UNIQUE REFERENCES presentation_material_uploads(id),
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  zoom_meeting_uuid TEXT NOT NULL CHECK (char_length(zoom_meeting_uuid) BETWEEN 1 AND 200),
  zoom_host_id TEXT NOT NULL CHECK (char_length(zoom_host_id) BETWEEN 1 AND 100),
  zoom_host_email_sha256 CHAR(64) NOT NULL CHECK (zoom_host_email_sha256 ~ '^[0-9a-f]{64}$'),
  zoom_meeting_start TIMESTAMPTZ NOT NULL,
  zoom_file_id TEXT NOT NULL CHECK (char_length(zoom_file_id) BETWEEN 1 AND 200),
  zoom_recording_type TEXT NOT NULL CHECK (zoom_recording_type ~ '^[a-z_]{1,60}(\(CC\))?$'),
  declared_size BIGINT NOT NULL CHECK (declared_size > 0 AND declared_size <= 2000000000),
  confirmed_winner_document_id UUID,
  confirmed_winner_slot_version INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued','copying','registering','copied','failed','cancelled')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  bytes_confirmed BIGINT NOT NULL DEFAULT 0 CHECK (bytes_confirmed BETWEEN 0 AND declared_size),
  session_create_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (session_create_attempts BETWEEN 0 AND 3),
  session_restarts SMALLINT NOT NULL DEFAULT 0 CHECK (session_restarts BETWEEN 0 AND 3),
  uncertain_checks SMALLINT NOT NULL DEFAULT 0 CHECK (uncertain_checks BETWEEN 0 AND 3),
  registration_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (registration_attempts BETWEEN 0 AND 5),
  cancel_requested_at TIMESTAMPTZ,
  request_document_id UUID,
  sharepoint_drive_id TEXT,
  sharepoint_item_id TEXT,
  sharepoint_quickxor_hash TEXT CHECK (sharepoint_quickxor_hash IS NULL OR char_length(sharepoint_quickxor_hash) <= 100),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT zoom_video_copies_intent_id CHECK (upload_id = id),
  CONSTRAINT zoom_video_copies_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT zoom_video_copies_winner_shape CHECK ((confirmed_winner_document_id IS NULL) = (confirmed_winner_slot_version IS NULL)),
  CONSTRAINT zoom_video_copies_item_shape CHECK ((sharepoint_drive_id IS NULL) = (sharepoint_item_id IS NULL)),
  CONSTRAINT zoom_video_copies_failed_shape CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT zoom_video_copies_terminal_unleased CHECK (state NOT IN ('copied','failed','cancelled') OR lease_token IS NULL),
  CONSTRAINT zoom_video_copies_registering_shape CHECK (state <> 'registering' OR sharepoint_item_id IS NOT NULL),
  CONSTRAINT zoom_video_copies_copied_shape CHECK (state <> 'copied' OR (request_document_id IS NOT NULL
    AND sharepoint_item_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_active_request
  ON zoom_video_copies (request_id) WHERE state IN ('queued','copying','registering');
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_copied_file
  ON zoom_video_copies (request_id, zoom_file_id) WHERE state = 'copied';
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_work
  ON zoom_video_copies (state, next_attempt_at, lease_expires_at) WHERE state IN ('queued','copying','registering');
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_request_recent
  ON zoom_video_copies (request_id, created_at DESC);
```

**Why these shapes.**
- **One active copy per request**, not per file. The Recording slot is per request; two different files racing one slot is the case to prevent. N1's advisory lock serializes starts; the index backs it.
- `copied` stays unique per (request, file), so repeating Import on a copied file replays and never creates a second item. Stage 5 adds a deleted state.
- `upload_id = id` makes "intent id derived from copy id" a constraint. The physical filename is `mintMp4Upload`'s formula with this id, `<RequestNum>-Recording-<id>.mp4` [VERIFIED via `ms:750`], and the path is unique per intent [VERIFIED via `055_post_presentation_materials.sql:130-131`].
- The variant CHECK is a shape check; the allowlist lives in code (Transfer).
- `zoom_host_email_sha256` lets each tick check that the approved host is still in `ZOOM_RECORDING_HOSTS` without storing the email.

**Intent row written by N1.**
- `client_resume_fingerprint` = `sha256("zoom-copy:" + meetingUuid + ":" + fileId + ":" + size)`, lowercase hex as the CHECK requires [VERIFIED via `055_post_presentation_materials.sql:78-81`].
- `generation_key` = `mintMp4Upload`'s formula with operation id = copy id [VERIFIED via `ms:752`], so a registration replay recovers the same Request Document (`ms:1284-1297`).
- `original_display_filename` = generated `Zoom video <Mon D, YYYY h.mm AM> PT.mp4`, the 3a naming pattern [VERIFIED via `import-service.js:31-36`]. Never the Zoom topic.
- `actor_id` = the session's Dataverse system-user GUID; `origin = 'zoom_copy'` written explicitly.

**Stage 5 identities.**
- On `copied`: Request Document id, drive id and item id on the copy row, plus Zoom meeting UUID and file id for deleting the Zoom original.
- Drive and item are recorded at `registering`, as soon as the exact item resolves, so unregistered bytes (failed or cancelled after bytes complete) are findable: `zoom_video_copies WHERE sharepoint_item_id IS NOT NULL AND request_document_id IS NULL`. For a failed row whose intent cleanup later bound, join through `upload_id` to `presentation_material_uploads.request_document_id`.
- No URLs, tokens, topics or emails are stored.
- One Zoom file copied for two requests makes two SharePoint items. Stage 5 must check the other rows before deleting a Zoom original.

**Fresh-install parity.** Add 076 to `lib/db/migrations-manifest.json` in the step-0 PR; no `scripts/setup-database.js` edit. **Corrected Session 589:** the inline block at `setup-database.js:1607` belongs to `v56Statements`, which `getBootstrapGroups()` (`:2126-2142`) does not list. A fresh install runs the base groups, then replays every manifest file (`scripts/lib/fresh-database-bootstrap.js:62-67`, `bootstrapFreshDatabase`) [VERIFIED]. Migrations 074 and 075 shipped the same way.

## Routes and security

**Kill switch `ZOOM_VIDEO_COPY_ACCESS=off|test:<GUID>|on`** (owner decision 4).
- New `zoomVideoCopyAccess(env)` and `isZoomVideoCopyRequestAllowed(requestId, env)` in `lib/utils/zoom-video-copy-access.js`, copying `postPresentationMaterialsAccess` exactly: unset, empty or `off` → off; malformed → off and invalid; `test:` plus a GUID compared lowercase with a trusted server-derived request id [VERIFIED pattern via `lib/utils/post-presentation-materials-readiness.js:20-40`].
- Read at: GET (to report `available`), start, tick entry (`off` → reconcile-finalized only; `test` → N2 scoped to that request), and in the copy fence before every post-await write. Cancel does not read it: cancel only sets a flag that stops work.
- It is additive: start and the tick also require `isPostPresentationMaterialsRequestAllowed` (`assertFeature`, `ms:230-241`) and `readZoomImportConfig().available` [VERIFIED via `import-service.js:50-56`].
- **Reconcile-finalized runs under `off`.** It is a Postgres-only receipt of a Dataverse create that already committed, so it changes no external system. Forbidding it would leave the card at "Saving" for a Recording that is already current.
- **Runbook row** (build PR): non-sensitive; `off`, `test:<request GUID>` or `on`; unset or malformed is off; stops new copies and pauses in-flight ones within one deployment; the rollback drain control; set per environment; Production only while Zoom credentials are Production-only.
- **Parity gates.** `check:transcription-pilot-deployment` needs no change. Its dedicated config allows exactly one function entry and exactly the two transcription crons, so the new cron and function entry can never enter it [VERIFIED via `scripts/check-transcription-pilot-deployment.js:86-99`]. Its standard-config check counts only transcription crons (`:122`). The meeting-transcription test Preview policy pins `POST_PRESENTATION_MATERIALS_ACCESS` (`test-deployment-policy.js:107`) but not Zoom variables; with `ZOOM_VIDEO_COPY_ACCESS` unset the copy is off there. No sibling gate needed.

**New route `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js`.**
- It does not extend 3a's `POST zoom-imports`, which has an exact `{meetingUuid, nonSensitiveAcknowledged}` body, runs synchronously for up to 300 s and is fenced on transcription spend [VERIFIED via `zoom-imports.js:11-12`; `API_ROUTE_SECURITY_MATRIX.md:277`]. The copy spends nothing at a provider and returns as soon as N1 commits.
- Preamble copies `zoom-imports.js:24-33`: `isGuid(requestId)`, `requireAppAccess(req, res, 'meeting-tracker')`, an active profile, an exact body, `Cache-Control: private, no-store`, `withDalContext`. The actor comes from the session (`actorRefFromSession`). `maxDuration` 60.
- **`GET`** reads Postgres only, with no Zoom call: `{ available, copies: [{ id, meetingUuid, state, bytesConfirmed, declaredSize, failureCode, cancelRequested }] }`.
- **`POST`** exact discriminated body, 8 KB cap:
  - `{ action: 'start', meetingUuid, replaces }`, where `replaces` is `null` or `{ artifactId, slotVersion }`;
  - `{ action: 'cancel', copyId }`, with `copyId` GUID-checked at the edge.

**Start.**
1. Access: `isZoomVideoCopyRequestAllowed`, `assertFeature`, Zoom config available; `loadBoundContext` for the Request and the single active Site Visit [VERIFIED via `ms:243-265`].
2. Verify the meeting through the approved hosts' listing and the `host_id` match (3a's rule, `import-service.js:209-219`).
3. Pick the variant (Transfer). Over 2,000,000,000 bytes → 422 `zoom_video_too_large`; segmented → 422 `zoom_video_segmented`.
4. **Decision 8 check.** Read the request's documents and take the current `RECORDING` winner from `projectPostPresentationMaterials(...).winners` [VERIFIED via `material-model.js:151-184`]; its kind comes from `materialBacking` (`:101-130`).
   - Winner is SharePoint-backed (`file`), whether a staff upload or an earlier copy: `replaces` must equal `{ artifactId: winner id, slotVersion: winner wmkf_slotversion }`. `null` → 409 `zoom_video_replace_confirmation_required`, with the winner's filename and size so the card can ask. A mismatch → 409 `zoom_video_replace_stale`.
   - No winner, or winner is a Zoom link (`external`): `replaces` must be `null`, else 409 `zoom_video_replace_stale`.
   - The card already has both values: `materialDescriptor` returns `artifactId`, `backing` and `slotVersion` [VERIFIED via `material-model.js:186-205`]. It sends them; it never displays them.
5. Resolve the bucket and folder (`activeBucket`, `ensureFolderPath`, as `ms:747-751`).
6. N1, storing `replaces` as `confirmed_winner_document_id` and `confirmed_winner_slot_version`.
7. Return `{ copy: { id, state: 'queued' } }`. Graph session creation belongs to the tick.

**Decision 8 at finalize [PLANNED].** Inside the slot fence, load `before`, then resolve the generation key and validate the existing document **before** the replacement check. Preserve the ambiguity and replay-mismatch failures [VERIFIED via material-service.js:1284-1297]. Exempt only the exact document that passed `validateRecoveredMp4Row`, never an arbitrary row with a matching id or a client assertion. If that verified document is the winner, resume predecessor reconciliation and intent completion. If a newer winner exists above that verified document's slot version, keep the existing stale-replay branch: supersede only the recovered stale copy and complete its receipt; do not supersede the newer winner [VERIFIED via material-service.js:1330-1373]. Otherwise a SharePoint winner different from both the confirmed winner and the verified same-operation document is terminal `zoom_video_recording_replaced`. With no recovered document, enforce the replacement check before create. A Zoom-link or confirmed winner proceeds through existing predecessor logic [VERIFIED via material-service.js:1274-1281, :1394-1443]. A receipt means registration succeeded, not that this copy remains current.

**Cancel.** N6. `queued` or `copying` → flag set, 202. `registering` → 409 `zoom_video_copy_saving`. Terminal → 200 with the row.

**Actor for the cron-executed registration.**
- `finalizeClaimedMp4Upload` writes with actor policy `REQUIRED` and a Dataverse system-user GUID [VERIFIED via `ms:351-357`, `:615-619`]. The tick passes the intent's stored `actor_id`, the session system user who chose Import.
- First `REQUIRED` write on this seam executed by scheduled code with a stored actor; the Pre-Site generator uses `SCHEDULED_AUTOMATION` [VERIFIED via `scripts/check-request-document-writers.js:27-31`]. Owner decision 7 confirms `REQUIRED`. A disabled or stale actor is terminal (Retry policy).

**New cron `pages/api/cron/drain-zoom-video-copies.js`.** `verifyCronSecret`, `MaintenanceService.startRun`, `withDalContext('cron-drain-zoom-video-copies', …)`, at most one copy row per invocation [VERIFIED pattern via `pages/api/cron/drain-materials-uploads.js:1-20`]. `* * * * *` cron row and a `maxDuration: 300` functions entry. Tick order: reconcile-finalized; access check; bounded due failed-copy receipt inspection (or one N2 work row, within the same invocation budget); N2 if no inspection was selected; dispatch by copy and intent state per the state table; host recheck (`getMeetingRecordings` → same `host_id`, same file id, `completed`, same size; stored host-email hash still in `ZOOM_RECORDING_HOSTS`) before any Zoom download or Graph write.

**Extraction rules.**
- Split the session-creation and finalize code out of `mintMp4Upload` and `finalizeMp4Upload` so the browser path keeps its exact behavior; characterize it first.
- The server origin never returns, persists in plaintext or logs `uploadUrl`. It is sealed with `sealPresentationUploadUrl` like the browser path (`ms:804`). Errors carry codes only.
- `insertPresentationMaterialUpload` writes `origin` explicitly ('browser' from `mintMp4Upload`, 'zoom_copy' only from N1).

**Guards and gates.**
- Two matrix rows (route and cron). Raise `api-route-file-count` in `docs/CANONICAL_COUNTS.md` by 2.
- Run `check:api-routes` and `check:route-service-boundary`.
- `check:route-lifecycle-auth` does not apply: `/api/meeting-tracker` is not in `ROUTE_NAMESPACE_LIFECYCLE` [VERIFIED via `shared/config/appRegistry.js:361-410`].
- `check:trust-boundary-guid` flags request ids that reach Dataverse sinks [VERIFIED via `scripts/check-trust-boundary-guid.js:1-40`]. `copyId` reaches only Postgres, so the gate will not see it. The route validates it with `isGuid` anyway, and a route test proves a non-GUID `copyId` is a 400 before any query. Run the gate for `requestId`.

**Credentials and interlock.**
- One new non-sensitive variable (above). Graph uses its existing app credentials; Zoom uses `ZOOM_S2S_*` and `ZOOM_RECORDING_HOSTS`, Production-only by owner decision.
- Finalize's Dataverse create passes through the target/write interlock. SharePoint/Graph writes do not [VERIFIED via grep: no `graph` or `sharepoint` in `lib/dataverse/core/interlock.js`, no `interlock` in `lib/services/graph*`]. A local run writes to whatever SharePoint site `.env.local` targets.

**Outside readers (denominator of four).**

| Reader | `RECORDING` handling | Recipients | Effect of 3b |
|---|---|---|---|
| Board presentation page | Excluded by allowlist [VERIFIED via `presentation-page-service.js:29-37`, `:168`] | Board link holders | None |
| Deliberation briefing | Excluded for listing and direct open [VERIFIED via `briefing-page-service.js:92-106`, `:294`, `:782`] | Briefing link holders | None |
| Pre-Site distribution email | `RECORDING` is in `MATERIAL_TYPES` [VERIFIED via `pre-site-visit/distribution/model.js:23-30`]; a row is selectable only with an https `wmkf_sharepointweburl` [VERIFIED via `distribution/context.js:124-135`] | Any valid To/Cc addresses staff enter [VERIFIED via `distribution/composition.js:12-33`] | **No change; not reachable.** Material links in new distribution emails were retired on 2026-09-10. `prepare` rejects any non-empty `selectedMaterialIds` with `distribution_material_links_retired` [VERIFIED via `distribution/composition.js:186-193`, Session 588]. `MATERIAL_TYPES` only projects rows already on the ledger. A copied MP4 therefore cannot be newly linked by email. The briefing page carries materials and excludes `RECORDING` (`briefing-page-service.js:98`). Question closed (Session 588). |
| Site Visit logistics | `RECORDING` is in `MATERIAL_TYPES`, projected with `webUrl` [VERIFIED via `site-visit/logistics-service.js:59-68`, `:396-420`] | Staff only: `meeting-tracker/visits/[requestId]/index.js:58` and `workbench/site-visit/logistics.js:66` | Shows the SharePoint MP4 instead of nothing; staff-only |

## Card (Recording slot)

Naming as built: the card's Step 1 is "Get the recording"; the Recording slot is its `RecordingBlock` (heading "Video recording"), which holds the copy status (`VideoCopyStatus`). There is no separate "Step 3, Full meeting" location for the copy.

**Step 1 "Get the recording" picker.**
- Each meeting gets a video line: "Video: none yet", "Video: not copied", "Video: waiting to copy", "Video: copying 120 of 240 MB", "Video: saving", "Video: copied", "Video: copy failed", "Video: cancelled", or a manual-upload line for a too-large or segmented meeting.
- Import ("Import, transcribe and copy video") starts audio and video as two independent requests (ruling 10). A meeting imported before 3b offers **Copy video** on its own, and so does every copyable meeting once the request has a published transcript (ruling 30).
- When access is off (`available: false`), no copy actions show.
- Polls `GET zoom-video-copies` every 10 s only while a copy is non-terminal, under the existing request-generation guard.

**Replace confirmation (decision 8).** When the current Recording is a SharePoint MP4, Import, **Copy video** and **Try again** first ask: "This will replace the recording file already saved for this request. Continue?" The card sends the winner's `artifactId` and `slotVersion` as `replaces`. On 409 `zoom_video_replace_stale` it reloads and asks again. When the current Recording is a Zoom link or empty, the card sends `replaces: null` and does not ask.

**Recording slot (`RecordingBlock`, under Step 1 "Get the recording").**
- While copying, the Zoom link stays and the card adds "Copying the video from Zoom into SharePoint." with **Cancel copy** (only in `queued`/`copying`).
- On failure: "Video copy needs attention." **Try again** first reconciles the old generation-key receipt; only confirmed absence permits a new copy. Preserve the current Recording projection.
- On `zoom_video_recording_replaced`: "A newer recording was saved while the video was copying, so the copy was not used."
- After normal finalize, the projection shows the SharePoint MP4 and supersedes the Zoom link. A recovered receipt may already be superseded by a newer Recording; keep that winner visible. Receipt-only binding with unfinished predecessor work reports reconciliation pending.
- Staff-only, desktop-first, no internal ids shown.

## Partial success and concurrency

| Case | Behavior |
|---|---|
| Audio imported, video failed | The transcript proceeds; preserve the current Recording. **Try again** reconciles the old receipt before a new copy and never touches the transcription job. |
| Video copied, audio failed | The Recording slot shows the MP4. Step 1 still offers the audio import. |
| Bytes complete, registration fails | Copy stays `registering`; retries with backoff up to 5 attempts, each recovering by generation key. Terminal codes stop at once. Bytes stay unregistered with drive/item on the copy row. |
| Finalize committed, tick died before `copied` | If the intent completed, N5 writes copied. A missing intent receipt goes through generation-key replay or expiry binding first. |
| Transcription cancelled (#469/#470), or audio re-imported | No effect; the rows are independent. |
| Staff upload an MP4 while a copy runs | The upload wins the slot when it finalizes first. The copy's finalize then aborts `zoom_video_recording_replaced` (decision 8). If the copy finalizes first, the later staff upload supersedes it (existing behavior). |
| Staff save a new Zoom link while a copy runs | The copy proceeds and supersedes the link at finalize. |
| Second Import for another meeting on the same request | 409 `zoom_video_copy_active` until the first copy ends. |
| Visit unbound, post-presentation access denied, Zoom config removed, copy access off | Pause: no claim, no writes. Staff can cancel; the flag is processed when work resumes. |
| Zoom file deleted or changed, host removed from the allowlist | `failed` (`zoom_recording_changed` or `zoom_video_host_not_approved`), and the session is cancelled. |
| Two ticks overlap (every-minute cron, 300 s function) | `FOR UPDATE SKIP LOCKED` in N2 plus the 600 s copy lease give each row one worker. |

## Durable surfaces to update in the build

[DONE in S8; merged 2026-10-09 (`780fab218`); migration 076 applied. Access `on` since 2026-10-09.]

- **Atlas:** `docs/atlas/postgres-zoom-video-copies.md` (created in step 0, rewritten to the built contract in S8) and its index row; the `origin` column and the `zoom_copy` writers in `docs/atlas/postgres-infra-tables.md`; the second `RECORDING` producer path in `docs/atlas/dataverse-wmkf-requestdocument.md`.
- **API matrix:** three rows: the `zoom-video-copies` route, the `drain-zoom-video-copies` cron, and the updated `zoom-recordings` row (ruling 19).
- **`docs/CANONICAL_COUNTS.md`:** route count +2 (updated in S6).
- **`docs/CREDENTIALS_RUNBOOK.md`:** the `ZOOM_VIDEO_COPY_ACCESS` row, next to `POST_PRESENTATION_MATERIALS_ACCESS`.
- **`docs/CI_GATES_REFERENCE.md`:** no gate changed; not edited.
- **`docs/SERVICE_AND_UTILITY_CATALOG.md`:** the copy service, the copy store, the tick worker, the Zoom client additions, `putUploadSessionChunk`, the access helper.
- **`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`:** the server-origin `RECORDING` producer.
- **Plans:** this plan's status, and the Stage 3 note in `docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md`.

## Tests (discriminating, with mutation checks)

**Step 0: browser isolation and version skew.**
- Characterize the browser MP4 path first: mint, status, retry (410 restart, 404 uncertain), cancel, finalize, finalized replay, projection.
- Seed nonterminal `zoom_copy` intents in each shape: `initiated` without ciphertext, `initiated` with ciphertext, `failed` without candidate, `uploaded` with candidate, `finalizing` with an expired lease. Run every browser path against each with the same actor and request: list and `projectUploadIntents`, `getMp4UploadStatus`, `retryMp4Upload`, `cancelMp4Upload`, `finalizeMp4Upload`, and a `mintMp4Upload` replay of the same id. Expect not-listed or 404, and **no row change**. Mutation: drop `origin='browser'` from any one query; its case must fail.
- Cleanup still claims expired intents of both origins.

**Rejected candidate past expiry.** Crash between the terminal `releasePresentationMaterialUpload` and N4, advance past `intent_expires_at`, run a tick: the copy becomes `failed` with identities preserved, the intent is not bound, and a new N1 start for the request succeeds. Mutation: restore the `unexpired` condition and the test must fail.

**Store (N1–N7, I1–I5) against real Postgres.**
- Concurrent starts for two different files on one request → one row, one 409. Mutation: remove the advisory lock and the active-request index; the race test must fail.
- N1 leaves both rows or neither (kill between the inserts by throwing).
- A `copied` row replays. Mutation: drop the copied-file index.
- N5 refuses a row with a live copy lease and accepts it once expired.
- I1 rejects `uploaded`, a candidate, a live lease and `origin='browser'`. I3 rejects `initiated`. I2 rejects a wrong token.
- A stale tick's write after takeover fails on every token predicate.
- Expand every dispatch row into concrete copy/intent/ciphertext/candidate/lease cases, including cleanup and lease-release results. Staff abandonment replays cancelled; other abandonment and expiry inspect exact registration before failure; rejected candidates retain identity; cleanup leases defer. Invalid tuples fail closed.

**Pump (fake Zoom and Graph servers).**
- Resumes from Graph's offset, not `bytes_confirmed`. Mutation: resume from the column; the "Graph ahead" case fails.
- A 200 to a ranged GET is terminal `zoom_range_unsupported`, with zero bytes PUT.
- Wrong `Content-Range`, short body, `text/html` and a non-Zoom redirect are rejected.
- A 403 from the resolved URL re-resolves once and continues; a second 403 on the same chunk is terminal.
- No request after hop 0 carries the bearer; no log line, error or row contains a URL. Mutation: send the bearer on later hops.
- A failed Graph PUT does not DELETE the session.
- **410 with all checks absent** restarts at 0, at most 3 times. **404** marks uncertain and never restarts. Mutation: treat 404 like 410; the 404 case must fail.
- Restart re-claims I1 after `recordPresentationMaterialUploadRecoverySession` clears the lease.
- A cancel flag set during the last chunk still lets the candidate write land, then cancels with drive/item recorded.
- Budget: with a fake clock, exhaust first GET 45 s, re-resolution 30 s, second GET 45 s, PUT 45 s and overhead 25 s. No chunk starts under 190 s left; no remote operation exceeds the T0+270 s work deadline; finalize requires 150 s. Assert the dedicated 300 s entry overrides the 120 s glob. Peak buffered bytes ≤ one chunk.
- Changed size, file id or host fails the copy.
- Kill switch: `off` → only reconcile-finalized runs; `test:<other GUID>` → N2 claims nothing for this request.

**Registration.**
- Replaying finalize recovers the same Request Document; the Zoom-link predecessor is superseded.
- Crash after `completePresentationMaterialUpload` → next tick writes `copied`.
- Decision 8: a SharePoint winner newer than the confirmed one aborts `zoom_video_recording_replaced` with no create. Mutation: skip the hook; the test must see a superseded staff MP4.
- Actor unavailable, signature, malware → terminal on the first attempt. Slot busy → retry with backoff, capped at 5.
- The `renewOrStop` closure runs before `acquireMaterialSlot`. Mutation: remove that call; a cancel or lease loss injected there must still be caught.

**Cancel.** Initiated-without-ciphertext plus absent exact path cancels without DELETE; crash after abandonment replays cancelled without recovery renewal. Before bytes → intent `abandoned`, copy `cancelled`. Flag seen after bytes → copy `cancelled` with drive/item, intent `uploaded`. A 404 from DELETE alone never yields `cancelled`. POST cancel on `registering` → 409.

**Crash injection (required before implementation completion).** Inject process death after every statement and awaited side effect in start, session create, bytes complete, finalize and cancel, including COMMIT with a lost response, every lease renewal/release, I2 before N4, candidate write before N4, Dataverse create before intent completion, and abandonment before copy cancellation. Restart with persisted state, expire leases where needed, and assert the exact dispatch row, eventual receipt and no duplicate session/create or unintended supersede. No in-memory state may rescue a case.
- Healthy status after failed/retry_status_unknown restores initiated, clears the old lease and requires a new I1 token; completion from failed records uploaded instead. Mutate away reacquisition and require failure.
- Refresh/candidate argument tests assert persisted request_id and actor_id are passed; missing/wrong identities update zero rows, as do a stale candidate token or failed refresh state.
- Crash after create: same-operation winner completes and reconciles predecessors; a later different winner uses stale replay without displacement. Mutate hook order or broaden the exemption and require failure.
- Rollback past intent expiry with cleanup both off and on: exact registration binds without deletion; N5 repairs a previously failed copy. Test ambiguous/mismatched reads, rejected candidate, intervening N2, live cleanup lease and duplicate copied-file receipt; no unsafe repair or second start.

**Routes.** Exact bodies; `replaces` required with a SharePoint winner and stale-checked; actor from session; non-GUID `copyId` → 400 before any query; GET makes no Zoom call.

**Outside readers.** Inject a copied-recording row with the real producer and drive/item ids into the Board and briefing suites, for listing and direct open. Add a distribution case that pins whichever answer the owner gives.

**Card.** Progress while copying; replace confirmation shown only for a SharePoint winner; failure copy and **Try again**; polling stops at a terminal state.

**Gates**, each with its self-test, run sequentially: migrations-manifest, atlas, api-routes, route-service-boundary, trust-boundary-guid, request-document-writers (expect no new writer row), transcription-pilot-deployment, fact-consistency, secret-scan, doc-currency, types and scoped ESLint.

## Release (Tier 2)

Tier 2: background work, uploads and a migration [VERIFIED via `CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:119-131`]. Preview cannot exercise it: Zoom credentials are Production-only, and Vercel runs crons only on Production [ASSUMED, from memory of the Vercel cron docs].

0. **Browser isolation first, as its own PR** (mirrors Stage 2's step 0, `PAIRED_SUMMARIES_PLAN_2026-10-08.md:245`).
   - The owner applies 076 (`node scripts/apply-migrations.js`). The column defaults to `browser` and the table is inert, so current code is unaffected.
   - The PR adds `AND origin = 'browser'` to `getPresentationMaterialUpload` (`:10-20`), `listPresentationMaterialUploads` (`:22-37`), `claimPresentationMaterialUpload` (`:188-214`) and `claimPresentationMaterialUploadRecovery` (`:273-291`). The unleased writers a browser path reaches after a get also gain it: `recordPresentationMaterialUploadSession` (`:58-75`), `markPresentationMaterialUploadFailed` (`:98-106`), `markPresentationMaterialUploadSessionClosed` (`:108-124`), and the token-less arms of `refreshPresentationMaterialUploadSession` (`:77-96`) and `recordPresentationMaterialUploadCandidate` (`:126-186`), as `AND (${leaseToken}::uuid IS NOT NULL OR origin = 'browser')`. Token-keyed and cleanup functions stay origin-agnostic.
   - `insertPresentationMaterialUpload` writes `origin` explicitly. The manifest gets 076; `setup-database.js` needs no edit (fresh installs replay manifest migrations; see Fresh-install parity).
   - Move verified registered-item binding outside the destructive cleanup switch as specified under Recovery; preserve rejected candidates and deletion gates.
   - Ships with the characterization and version-skew tests above. **This release is the oldest permitted rollback target.**
1. Build on a branch off `main`. Mode A suites locally. Claude review and an ordinary Codex adversarial review; no metered products.
2. Probes 2–5 as the owner authorizes; update the [ASSUMED] items they settle.
3. With owner approval, invoke the cron route once locally with `CRON_SECRET` and `ZOOM_VIDEO_COPY_ACCESS=test:<marked TEST request>`. Beforehand, the owner confirms which Dataverse host and SharePoint site `.env.local` targets.
4. Merge with `ZOOM_VIDEO_COPY_ACCESS=on` since 2026-10-09 (owner, after one Mode D copy on 1003222) in Production. Verify the Production deployment is the merge build.
5. Set `test:<GUID>` for the owner-chosen request and redeploy. Mode D on one real recording. List expected writes and cleanup first, then confirm:
   - the SharePoint size equals the Zoom `file_size`, and the file plays;
   - the Request Document is visible to staff and absent from the Board page and the briefing;
   - the Zoom link is superseded;
   - repeating Import creates nothing new;
   - a second run against a request with a staff MP4 asks for confirmation.
6. Owner sets `on`.

**Rollback.** Set `off`, redeploy, wait 10 minutes, then revert the 3b merge, never past step 0. Rows stay; the state table's rollback row says what touches them.

## Pre-implementation read-only probes (owner to authorize)

1. **Zoom Range support: [VERIFIED via `node scripts/probe-zoom-recordings.mjs --range`, Session 588, 2026-10-08, owner-authorized].** Two meetings for `wmk-library@wmkeck.org` were probed: `shared_screen_with_speaker_view`, 248.5 MB, and `shared_screen_with_speaker_view(CC)`, 247.8 MB. On each:
   - `download_url` with the bearer and `Range: bytes=0-1023` answered 302 from `us02web.zoom.us`.
   - The redirect target on `ssrweb.zoom.us` answered **206**, with `accept-ranges: bytes`, `content-range: bytes 0-1023/<total>`, `content-length: 1024` and `application/octet-stream`.
   - The resolved `ssrweb` URL, re-requested **without the bearer** at a 1 MiB offset, also answered 206 with the matching `content-range`.
   - Bodies were cancelled unread; only status and headers were recorded.

   Consequence for review item 1: drop the no-Range fallback. Treat a 200 response to a ranged request as terminal `zoom_range_unsupported`. Resuming from the resolved URL without the bearer works while that URL is live; how long it stays live is still probe 2. Original probe text: In `scripts/probe-zoom-recordings.mjs`, follow `download_url` with the bearer token, then send `Range: bytes=0-1023` to the final `ssrweb.zoom.us` hop. Expect 206 with `Content-Range`. Record status and headers only.
2. **Zoom URL lifetime: [VERIFIED via `node scripts/probe-zoom-recordings.mjs --lifetime`, Session 588, 2026-10-09 UTC, owner-authorized].** One `shared_screen_with_speaker_view` MP4 (260,533,300 bytes). The `download_url` was resolved once at 01:20:18Z. The resolved `ssrweb.zoom.us` URL was then re-requested **without the bearer** (`Range: bytes=0-1023`). At +0, +5, +15 and +30 minutes it returned **206** with a matching `content-range`. At **+60 minutes it returned 403**. The URL therefore lives at least 30 and under 60 minutes. That is well beyond one ~5-minute tick, and the plan's "a 401/403/404/410 from the resolved URL triggers one re-resolution via `download_url` + bearer, then terminal" rule matches the observed expiry signal (403). Re-resolving each tick, rather than persisting the URL, remains the safer default. Original probe text: Repeat probe 1 at +15 and +60 minutes on the same resolved URL.
3. **MP4 variants and sizes: [VERIFIED via `node scripts/probe-zoom-recordings.mjs --host wmk-library@wmkeck.org --days 30`, Session 590, 2026-10-09, owner-run].** 15 meetings, all `status=completed`. Each has exactly one MP4: 14 are `shared_screen_with_speaker_view` and one (2026-10-05T21:15Z) is only `shared_screen_with_speaker_view(CC)`. No meeting has both variants and none has a gallery or other layout, so decision 1's non-CC preference with `(CC)` fallback covers every case seen. MP4 sizes range from 107.5 to 527.5 MB, far below decision 2's 2,000,000,000-byte cap. Original text: list `recording_type`, `file_extension` and `file_size` for every MP4 in the 30-day window.
4. **Graph session expiry and hashes: [VERIFIED via owner-run scratch probe, Session 588, 2026-10-09 UTC].**
   - **Session:** `createUploadSession` (`conflictBehavior: fail`, no bytes) under test request 1003222's `Post Site Visit Materials` returned `expirationDateTime` **0.25 h (15 min)** after creation, with `nextExpectedRanges ["0-"]`. A status read returned the same expiry. DELETE answered 204 (`cancelled`), after which the status read was 404, and no item existed at the path. The probe line reading "item exists: YES" was a probe bug: `getFileMetadataByPath` returns `null` on 404 (`lib/services/graph/files.js:300`).
   - **Consequence:** an idle session lasts only 15 minutes. Whether each uploaded chunk extends `expirationDateTime` is **[ASSUMED, from Microsoft's documentation, not probed]**. A copy paused longer than about 15 minutes (kill switch `off`, a cron outage, or a long lease takeover) should expect its session to be gone. It then takes the existing 410-and-absent restart from byte 0, up to the 3-restart cap. That is acceptable for 150–400 MB files, but the build should record each tick's post-chunk `expirationDateTime` to confirm the extension.
   - **Hashes:** three existing `RECORDING` items (197.8, 262.6 and 553.1 MB, `video/mp4`) carry only `quickXorHash` (28-character base64); there is no SHA-1 or SHA-256. Owner decision 6 (record quickXorHash, do not compare) stands.
   - Original probe text: Read `expirationDateTime` from one `createUploadSession` on a TEST path, then DELETE that session. Separately, GET `file.hashes` on an existing `RECORDING` item.
5. **MP4 duration check: [VERIFIED via `node scripts/probe-zoom-recordings.mjs --moov`, Session 588, owner-authorized].** Three MP4s were probed (248.5, 247.8 (CC) and 389.3 MB). Each has the same top-level layout: `ftyp@0`, `uuid@24`, `free@13238`, `moov@13374`. `moov` is 1.24–1.41 MB, so it starts in the first MiB but is not wholly inside it. `mvhd` is its first child, inside the first MiB, and its duration matched Zoom's within 1 s (3818.4/3819, 3749.0/3749, 4286.1/4286). A duration check can run on the first chunk. Original text: check whether the `mvhd` box is in the first MiB, so the duration can be compared with Zoom's start and end times.

## Owner decisions

1. **Which variants to copy.** Recommendation: one MP4 per meeting, `shared_screen_with_speaker_view`, preferring the non-CC file and falling back to `(CC)`. Gallery and other layouts are not copied.
2. **Size cap.** Recommendation: keep the existing 2,000,000,000-byte cap, which is about 8 hours at the assumed rate.
3. **Cost.** There is no provider spend. Costs are Vercel function time (about 1–3 ticks per meeting [ASSUMED]), plus empty every-minute polls and SharePoint storage until Stage 5. Recommendation: accept.
4. **Kill switch.** **Decided (owner, Session 588): add `ZOOM_VIDEO_COPY_ACCESS=off|test:<GUID>|on`** (non-sensitive). It also serves as the rollback control in review item 7. The original recommendation follows for the record. Recommendation: no new variable. Availability follows the Zoom variables and `POST_PRESENTATION_MATERIALS_ACCESS`, and rollback is a revert. The alternative is a non-sensitive `ZOOM_VIDEO_COPY_ACCESS=off|test:<GUID>|on`, which would allowlist the Mode D request.
5. **Copy automatically.** Recommendation: Import starts both audio and video. Earlier imports get **Copy video**.
6. **Integrity checks.** Recommendation: in v1, check size, range acks and the signature. Record the quickXorHash but do not compare it.
7. **Registration actor policy.** Recommendation: `REQUIRED`, with the stored actor of the staff member who chose Import. The alternative is `SCHEDULED_AUTOMATION`, which would add a new writer-gate row.
**Decided (owner, Session 589, 2026-10-09): decisions 1, 2, 3, 5, 6 and 7 are built as recommended.** The owner also confirmed the build's stopping point: step 0 and the 3b build each on a branch, Claude- and Codex-reviewed, pushed and not merged. Migration 076, Vercel settings, live Zoom/Graph/Dataverse calls and release steps 2–6 stay with the owner. Probe 3 (one read-only Zoom listing call) is owner-run when convenient; the build does not depend on it. (Run in Session 590; see probe 3.)

8. **Replacing a staff-uploaded MP4 (from review item 6).** **Decided (owner, Session 588): ask staff to confirm.** When the current Recording winner is a SharePoint MP4, starting a copy (Import, **Copy video** or **Try again**) requires explicit confirmation that it will replace that file. The copy records the winner's slot version at start. Before finalize it aborts with a named code if a newer non-Zoom-link winner has appeared since. The rework must specify this.

## Build rulings (Session 589, orchestrator)

A read-only build map (Sonnet reconnaissance, Session 589) found the gaps below. Claude ruled on each so that no builder guesses. Each ruling is binding on the build unless the owner overrides it. Gap numbers refer to that map. Plan store line citations elsewhere in this document are about 8 lines stale after step 0; locate by symbol.

**Build order (slices).**
- S1 transport primitives and `ZOOM_VIDEO_COPY_ACCESS`
- S2 MP4 mint/finalize extraction, characterization tests first
- S3 copy and intent stores
- S4 start/GET/cancel service and route
- S5 tick pump
- S6 registration, receipt recovery and the cron
- S7 card
- S8 gates and durable docs

**Rulings.**
1. **Stale text (gaps 1–5, 20, 21, 24, 27).** Correct it in the docs slice: fresh installs need no `setup-database.js` edit; step-0 binding is done and retention codes changed; store line numbers; the Atlas page already exists; card naming is Step 1 "Get the recording" / `RecordingBlock`. Duration stays out of v1 (decision 6). Use the repo's `hashtext()` idiom.
2. **Zoom transport (gaps 6–8).**
   - Split resolution from transfer. A resolver follows `download_url` with the bearer on hop 0 only, sending `Range: bytes=0-0` on each hop and manual redirects, and returns the final `ssrweb.zoom.us` URL. A ranged GET without the bearer then fetches bytes. The first chunk may fuse with resolution.
   - Add `zoom_range_unsupported` and `zoom_download_denied` to the client's status map.
   - The ranged GET returns the raw HTTP status for the resolved hop and does not use `mapFailure`. 401, 403, 404 or 410 there means re-resolve once; then the outcome is terminal.
   - Add a deadline-aware `timedFetch` variant (a per-call timeout derived from the tick deadline).
3. **Path conflict (gap 9).** Catch `post_presentation_candidate_mismatch` thrown by `resolveStableMp4Path`, and treat `partial`, as `failed` `zoom_video_path_conflict`.
4. **Counter caps (gap 10).** A counter reaching its cap and the transition to `failed` happen in one UPDATE: increment when below the cap, otherwise set `failed` with the named code. No statement may increment past the CHECK.
5. **Store shape (gaps 11–13).**
   - N4 becomes per-transition named store functions, one per state-table write. There is no generic column patch.
   - N1 runs in one `db.connect()` transaction (the `withReviewPanelTransaction` pattern). It inserts both rows with its own INSERT statements, with `origin = 'zoom_copy'` written explicitly; `insertPresentationMaterialUpload` cannot join the transaction.
   - Try again's failed-row inspection runs before the transaction and is rechecked under the advisory lock.
   - A unique-index violation inside N1 (active request, path or generation key) rolls back and maps to 409 `zoom_video_copy_in_progress`. The exception is the copied-file index, which replays.
   - Build these named functions:
     - I4 renew and release, which need no expired-intent predicate, so the existing cleanup renew cannot serve
     - an origin-aware source-failure abandonment writer
     - a joined copy-plus-intent snapshot read for dispatch and GET
     - a failed-copy due-batch selector
   - The selector advances `next_attempt_at` with a conditional UPDATE keyed on `state = 'failed'` and the previously read `next_attempt_at`. It takes no copy lease, because `terminal_unleased` forbids one. The I4 lease sits on the intent row.
6. **Replay before confirmation (gap 14).** The copied-file replay lookup for the same request and file runs before start step 4. Repeating Import on an already copied file replays and asks nothing.
7. **Unversioned winner (gap 15).** If the current Recording winner is a SharePoint MP4 without a positive slot version, start refuses with 409 `zoom_video_winner_unversioned` and copies nothing. Conservative and rare; staff can still upload manually. **Confirmed (owner, Session 590, 2026-10-09).** Production census (`scripts/probe-recording-slot-versions.mjs`, owner-run): 25 Recording rows, 14 requests with a SharePoint winner, 0 unversioned.
8. **Unlisted failure codes (gap 16).**
   - `post_presentation_site_visit_required`, `post_presentation_site_visit_ambiguous` and `post_presentation_cycle_required` pause, like the kill switch, and do not fail.
   - A Dataverse or Graph error that is not a `ServiceHttpError`, or has HTTP status 500 or above, or is a timeout, is retryable under `registration_attempts` (cap 5, then `failed` `zoom_video_registration_failed`).
   - Any other code is terminal `failed` with the sanitized code.
8a. **Post-final-chunk absence (gap 17).** If `resolveStableMp4Path` returns `absent` after the final PUT, retry next tick and count it under `uncertain_checks` (cap 3, then `failed` `zoom_video_upload_uncertain`). Log each tick's post-chunk `expirationDateTime` in the structured log line, with no new column; this answers probe 4's open question.
9. **3a reuse (gap 18).** Export or generalize `listApprovedOccurrences`, `pickFiles` and the filename helper from `import-service.js` rather than copying them. The `zoom-recordings` GET gains additive per-meeting video fields: eligible file, size, `tooLarge`, `segmented`, existing copy state. Update its API matrix row and tests.
10. **Import starts both (gap 19). Confirmed (owner, Session 590, 2026-10-09).**
    - The card shows the replace confirmation first, when the decision-8 condition holds, then sends the existing audio import and the video start as two independent POSTs. Each shows its own result; neither failure undoes the other.
    - The video start does not require `MEETING_TRACKER_TRANSCRIPTION_ACCESS`; it requires `POST_PRESENTATION_MATERIALS_ACCESS`, Zoom config and `ZOOM_VIDEO_COPY_ACCESS`.
    - When transcription is unavailable or the meeting has no audio, the card still offers **Copy video** on its own.
    - Amended by ruling 30 (Session 590): once the request has a published transcript, every copyable meeting also offers **Copy video** on its own.
11. **Ticks (gap 22).** Session creation and the first pump may share a tick when the budget allows (dispatch re-applies after each writer).
12. **Host hash (gap 23).** `sha256(trim(lowercase(email)))`, matching `readZoomImportConfig`.
13. **Noted, not changed (gaps 25, 26).** The token-arm candidate overwrite and the browser `finalizing`/NULL-lease claim gap are pre-existing browser behavior, out of 3b scope.
14. **Gates the plan missed.** `tests/unit/test-request-scheduled-job-census.test.js` gets a `RECORDED_CRONS` row of class `allowed`, with counts updated. `requireappaccess-endpoint-count` changes along with `api-route-file-count`. The Graph public-contract and boundary tests change for `putUploadSessionChunk`. The request-document writer stays the single `dependencies.createDocument(` in `material-service.js`, with no new writer row.
15. **Real-Postgres proof.** Use loopback-only `ZOOM_VIDEO_COPY_PG_TEST_URL`, skipped when unset, following `tests/integration/meeting-tracker-transcription.pg.test.js`. A local Docker Postgres may be used. It is never a shared or remote database.

**Rulings after S3 (stores, commit `65945e49d`).**
16. **Failed-copy inspection ends (S3 gap 5).** `claimFailedZoomVideoCopiesDue` returns only failed copies whose linked intent is unsettled (`state NOT IN ('finalized','abandoned')`). A finalized intent goes to N5a repair; an abandoned one is settled. A 30-day backstop on the copy's `updated_at` covers anything else. S6 owns this change.
17. **Accepted store shapes.**
    - Try again passes `listFailedZoomVideoCopiesForFile` output verbatim as N1's `failedSnapshot`; a missing snapshot fails closed to `reconciliation_pending`.
    - N5 is the request advisory lock followed by its UPDATE in one transaction.
    - The failed-due selector is one CTE (`FOR UPDATE SKIP LOCKED` plus update).
    - Snapshot reads expose no lease tokens; a holder knows its own.
    - A session restart resets `bytes_confirmed` to 0.
    - The S4 service supplies the display filename (ruling 9).
18. **File split for S4/S5.** The start/GET/cancel service is `lib/services/meeting-tracker-recordings/video-copy-service.js` (S4). The tick worker is `video-copy-worker.js` in the same folder (S5, extended by S6).

**Rulings after S4 (service and route, commit `34a993d25`).**
19. **Video-only listing.** `listZoomRecordingsForVisit` serves the picker when either the transcription flag or video copy (`isZoomVideoCopyRequestAllowed`) allows the request. Audio-import fields and actions are present only when transcription is enabled, and video fields only when copy is allowed. With both off it behaves as in 3a. This makes ruling 10's standalone **Copy video** reachable. S7 owns this change, with tests for the four flag combinations.
20. **Accepted S4 choices.**
    - The picker exposes no Zoom file id; the server re-derives it.
    - Cancel is POST `{action:'cancel'}` only.
    - Start returns 202, replay 200. Codes not named in the plan: `zoom_video_copy_not_available`, `zoom_video_missing`, `zoom_video_reconciliation_pending`, `zoom_video_copy_not_found`.
    - A segmented or too-large meeting returns 422 before the replay lookup.
    - `findCopiedZoomVideoCopyForFile` serves ruling 6.

**Rulings after S5 (worker transfer path) and S7 (card).**
21. **Zoom auth or scope errors in the worker.** These are configuration faults, not per-copy faults. Release the copy lease with `next_attempt_at = now + 15 min` and record one operational alert (`zoom_video_config_error`) per deferral. Do not fail the copy and do not count it. S6 adds the deferral writer.
22. **Accepted S5 choices.**
    - Host removed: terminal with no Graph write; the orphan session expires on Graph's clock.
    - Graph PUT 404 or 410 goes to the loss path.
    - A partial item right after our own final PUT is uncertain, not a path conflict.
    - The I2 readback uses the snapshot's `intent_has_ciphertext`; unknown means retain.
    - An invalid tuple fails with `zoom_video_state_invalid` plus an alert.
    - A host-removed partial item caps as `zoom_video_cancel_uncertain` (fails closed).
    - The visit-unbound pause belongs to S6, next to the finalize binding read.
23. **Accepted S7 choices.**
    - One read-only copies GET on mount.
    - The section holding the recording opens automatically during a copy.
    - Video-only mode keeps the listing's binding guard.
    - A cancelled copy is retried from the picker.
    - **Keep current file** on Import keeps the file, copies no video, and still imports the audio (commit `daee437c2`).

**Rulings after S6 (registration, recovery, cron).**
24. **Receipt conflict is permanent.** N5a never re-lists a `failed` copy with `zoom_video_receipt_conflict`; another copied row owns the file. The card says the video was already copied.
25. **Failed-copy recheck cost.** The due-batch interval grows with the failure's age: 10 min for the first hour, hourly to one day, then every 6 h until the 30-day backstop. That is about 150 Dataverse reads per row instead of about 4,300. Verified with the real-Postgres proof (16/16).
26. **Accepted S6 choices.**
    - The decision-8 code is `zoom_video_recording_replaced`, as the plan and card already use; `zoom_video_winner_changed` existed only in an S2 test stub.
    - Finalize runs on the tick after bytes complete (about one minute later), not chained into the pump tick.
    - Proven-absent registration after a non-staff abandonment keeps a `zoom_*` source code, otherwise `zoom_video_intent_abandoned`.
    - Staff-cancelled abandonment with a candidate is an invalid tuple and fails closed.
    - Reconcile and inspection errors are logged and never block the tick.
    - The card gives `request_document_actor_unavailable` an administrator message instead of "Try again".

**Rulings from the Codex adversarial review (Session 589).**
27. **Try-again admission is race-free.**
    - Start reads the failed-row snapshot once, before inspection; inspection covers exactly that snapshot; N1 receives the same array (round 3).
    - Inside N1, under the request advisory lock, the order is: replay lookup, active check, then the failed-row recheck (round 4). Writers that fail a copy do not take N1's lock, so the failed-row recheck must follow the active check. A copy still active at the check is refused there; one that failed before it is unseen in the snapshot and returns `reconciliation_pending`.
    - Real-Postgres probes commit a registering-to-failed transition on a second connection at both interleaving points; the old order admitted a second copy.
28. **Graph upload-session calls are bounded end to end (round 2).** `fetchWithBodyTimeout` covers fetch and body read under one abort signal for session creation, status and chunk PUT. Other Graph callers are unchanged.
29. **Receipt conflicts retire (round 1).** `recordZoomVideoCopyReceiptConflict` records the code on an unleased copy whose intent is finalized, from both reconcile paths.

**Rulings after Production acceptance (Session 590, owner-approved).**
30. **Copy video when a transcript exists.** In Mode D on 1003222 the transcript came from an uploaded audio file, so no meeting was imported through Zoom and the only way to copy a video was Import, which re-imports the audio and starts a paid transcription. Once the request has a published transcript (`TRANSCRIPT` material), every copyable meeting now offers **Copy video** on its own, alongside Import. Merged 2026-10-09 (`cb2640a88`), Codex-approved.
31. **Picker import label follows the job.** The listing's import summary adds `transcriptReady` (the joined `transcription_jobs.status` is `ready`; no new read). The picker shows "Imported, transcribing…" until then and "Imported, transcript ready" after, replacing the fixed "Imported, transcription started". Merged with ruling 30 (`cb2640a88`).

## Contract review (`/contract-reconcile` Mode A, planning pass)

**Historical record.** Retained as requested; current protocol is in the revised sections above.

**Flow [PLANNED].**
1. The card calls the new visit route.
2. The route runs the guard, verifies the Zoom meeting, claims the row, and creates the intent and session.
3. State lives in `zoom_video_copies` and `presentation_material_uploads`.
4. The cron pump moves the bytes: a ranged Zoom GET, then a Graph PUT.
5. `finalizeClaimedMp4Upload` registers a `RECORDING` `wmkf_requestdocument`.
6. The staff projection shows it, and the outside readers exclude it.

**Audit notes.**
- **Partial success:** covered in the table above.
- **Async state:** two leases fence the work, and Graph supplies the resume pointer.
- **Helper extraction:** the session-creation part of `mintMp4Upload` becomes shared, so characterize the browser behavior first.
- **Symbol fan-out:** the `origin` marker touches every browser intent query.

**Source contradicts other docs (none edited here; both items below were reconciled in Session 588).**
- `DATAVERSE_SHAREPOINT_FILE_MODEL.md:624` names `Site Visit/Recording` as the governed path. The code writes MP4s under `Post Site Visit Materials/` (`material-service.js:749`).
- Three places still call `zoom_recording_imports` unapplied or unmerged:
  - the Atlas index row (`APPLICATION_STATE_ATLAS.md:111`);
  - API matrix rows 276–277;
  - the 3a plan's own Build status line.

## Review — Session 588 (2026-10-08)

### Codex fix pass (Session 588)

**Final Codex pass (Session 588):** one HIGH finding. A rejected candidate (intent `failed` with a candidate after a terminal finalize release) whose intent expired before N4 fell into the expiry row, which retained and backed off, leaving the copy `registering` forever and blocking new copies. Fixed: the rejected-candidate row now applies regardless of expiry and sits directly after the live-lease defer row; the expiry row excludes that tuple. Test added below.

Plan-only revision against commit `99b923010` review; local source read, no network, runtime tests or implementation. Change surface and sole edited entry point: this plan. Persistence and consumers described here are proposed Postgres intents/copies, cron, card and cleanup; actual persistence changes in this pass: none. Bounded contract/sweep pass covers the six findings and this file's restatements only. `check:doc-currency` and its self-test passed (13/13); runtime crash tests remain build requirements. Current proposed protocol above supersedes the historical reviews below.
- Finding 1 → Routes, **Decision 8 at finalize**: validate generation-key recovery first; exact exemption and stale replay.
- Finding 2 → **Dispatch**, **Recorded session and candidate repairs**, N4 and Bytes complete: Q session/candidate repairs under copy fence.
- Finding 3 → **Failed intent, readable session**: recovery-session writer, I1 reacquisition, completion from failed.
- Finding 4 → **Expired registration**, I4/I5, N5/N5a, **Cleanup and rollback**, Release step 0: non-destructive binding and failed-copy receipt repair.
- Finding 5 → **Server cancellation**, cancel phase rows and Dispatch: no-ciphertext branch, copy-only N4, staff_cancelled replay.
- Finding 6 → **Reuse rule** and Tests: persisted request/actor arguments for both token-bearing writers.
- Additional review requirements → explicit Dispatch table, 190 s chunk admission with dedicated 300 s function, and statement-by-statement crash injection in Tests.
- Owner decision: one migration 076 holds both schema changes. The Pre-Site distribution email question is closed: material links in new emails were retired on 2026-09-10 (`distribution/composition.js:186-193`), so a copied MP4 cannot be newly linked.

**Historical Session 588 review record follows.** Its outstanding-work language describes the earlier revision, not this fix pass.

**Folded in (Session 588 rework):** item 1 (Range livelock) → Transfer, "Range": no fallback, a non-206 is terminal `zoom_range_unsupported`. Item 2 (lease choreography) → "State machine and leases": NEW origin-aware I1–I3 and N1–N7 with exact predicates, the reuse rule, and the copy fence. Item 3 (finalized replay) → state table "Reconcile-finalized", run first in every tick. Item 4 (killed start) → N1 inserts both rows in one transaction with `upload_id = id`; session creation is tick-owned ("Session create" row). Item 5 (404 vs 410) → "What exists today, Session loss" and the "Session restart" row, which keep `retryMp4Upload`'s semantics. Item 6 and decision 8 → Routes "Start" step 4, "Decision 8 at finalize", and the Card's replace confirmation. Item 7 (rollback exposure) → Release step 0 and the "Rollback" row. Item 8 (registration loop) → "Retry policy". Item 9 → Schema "Stage 5 identities" and the cancel rows (drive/item and cancel after bytes); Transfer "Variant and segments" and the shape CHECK; Routes "Extraction rules"; Transfer "Tick budget"; the cron's per-tick host recheck; Routes "Guards and gates" on `copyId`; Routes "Outside readers" (denominator of four, with an owner question on Pre-Site distribution). Decision 4 → Routes "Kill switch". The review text below is kept as the record.

Reviewers: a Claude source review (`/contract-reconcile` Mode A) and a Codex adversarial review (`gpt-6-astra`). No live probe ran. **Probe 1 result (Session 588):** Zoom honors Range (206) on the final `ssrweb.zoom.us` hop, including at an offset without the bearer. See "Pre-implementation read-only probes". Item 1 below therefore becomes "a 200 response to a ranged request is terminal", not a fallback.

**Owner answers (Session 588):** decision 4 adds `ZOOM_VIDEO_COPY_ACCESS`, and new decision 8 asks staff to confirm before replacing a staff-uploaded MP4. Both are recorded under "Owner decisions". The protocol rework below is still outstanding; probe 1 (Range) should run first, because its result decides item 1.

**Verdict: NEEDS REWORK.** Both reviewers independently found that the transfer, lease and finalize protocol does not fit the existing upload-intent state machine. Together with the Range livelock, the core protocol needs redefining, not patching.

Claims are marked [VERIFIED via file:line] (the Session 588 lead re-read the source) or [agent-reported].

**Protocol defects (rework)**
1. **No-Range fallback livelocks.** The plan says the cost is "bounded by the file size" (:140-143). Each tick re-streams the prefix before Graph's offset, so total reads are O(N²/C), and once the prefix takes the tick budget no tick progresses [VERIFIED via plan text; arithmetic from both reviewers]. Make a 200 response to a ranged GET terminal (`zoom_range_unsupported`), or make probe 1 a build prerequisite. Today `downloadRecordingFile` buffers the whole body and sends no Range header (`zoom-client.js:155-222`) [agent-reported].
2. **Lease choreography does not match store states.** Intent renew requires `finalizing`, recovery renew requires `initiated|failed`, session refresh requires `initiated|uploaded`, the finalize claim requires an unleased row, and release clears the lease (`upload-intent-store.js:88-164, 223-258`) [agent-reported, both reviewers]. Define origin-aware server store functions per phase: pump, restart, finalize hand-off. Require the copy lease and the cancellation flag before every post-await write, and pass a copy-fence check into finalize.
3. **Finalize is not replayable from a finalized intent.** `finalizeClaimedMp4Upload` renews the intent lease first (`material-service.js:1231-1232`) [VERIFIED]. A crash after the intent completes but before the copy row reads `copied` leaves `registering` work the helper cannot resume. The finalized-receipt recovery lives in the outer `finalizeMp4Upload` (:1509-1517) [agent-reported]. Reconcile finalized intents into copied receipts first, copy-lease-fenced. The helper is not exported.
4. **Killed start strands rows.** A kill after the copy claim leaves `queued` with `upload_id` NULL. The active unique index then blocks a fresh start. A kill between intent/session creation and linking orphans the session. Derive the intent id from the copy id, or insert and link in one transaction. The tick fails intent-less `queued` rows after N minutes.
5. **Session-expiry restart collapses existing semantics.** The plan restarts on 404 or 410 (:145-147). `retryMp4Upload` restarts only on 410 with the item still absent after the 0/2/8 s checks; a 404 or an uncertain read marks the intent uncertain (`material-service.js:1018-1059`) [agent-reported]. Keep those semantics.

**Behavior and release defects**
6. **A copy can displace a staff-uploaded MP4.** Predecessors are rows with `slotversion < fenceVersion`, and the fence is taken at finalize (`material-service.js:1257, 1271-1279`) [VERIFIED]. A copy that finishes after a staff upload, or a later **Copy video** / **Try again**, supersedes the staff MP4. Capture the winner's slot version at start, refuse (or confirm) when the winner is a SharePoint MP4, and abort before finalize if a newer non-Zoom winner appeared. **New owner decision 8.**
7. **A plain revert exposes server intents to the browser.** After rollback, `origin='zoom_copy'` rows become resumable, cancellable or finalizable browser uploads (`upload-intent-store.js:10-34`; `material-service.js:398-424`) [agent-reported, Codex]. Ship origin-aware browser isolation in a prerequisite deploy that stays in the rollback target. Document a drain procedure.
8. **Registration retry loop.** `request_document_actor_unavailable` is not terminal (`material-service.js:93-96`) [agent-reported]. Each attempt takes the Recording slot lease and blocks staff. Make actor-unavailable and signature/malware terminal, and add backoff and an attempt cap.
9. **Smaller items** [agent-reported]:
   - Record drive/item identity as soon as the exact item resolves, not only at `copied`, so Stage 5 can find unregistered bytes. Define what cancel does once the bytes are complete.
   - Relax the variant CHECK to a shape check, keep the allowlist in code, and define segment handling.
   - Extraction rules: the server origin never returns, persists or logs `uploadUrl`; it uses a generated display filename; `origin` is written on insert, including in `setup-database.js` (superseded by Build ruling 1: no `setup-database.js` edit).
   - Set per-chunk timeouts so 240 s plus a chunk stays under `maxDuration` 300.
   - Recheck `ZOOM_RECORDING_HOSTS` membership per tick.
   - Add `check:trust-boundary-guid` coverage for `copyId`.
   - The outside-reader denominator also includes `pre-site-visit/distribution/model.js:23-30` and `site-visit/logistics-service.js`, which project RECORDING links. Enumerate their recipients.

**Owner decisions after review:** 1 agree, but relax the CHECK and handle segments. 2, 3 and 6 agree; 3's cost holds only with Range support. **4: change the recommendation.** Both reviewers recommend `ZOOM_VIDEO_COPY_ACCESS=off|test:<GUID>|on`. That matches the repo's `*_ACCESS` pattern, is needed for Mode D on a real recording under an every-minute cron, and is the rollback control in item 7. 5 agree, given decision 4 and item 6. 7 agree, given item 8. **New decision 8:** the displacement policy in item 6.
