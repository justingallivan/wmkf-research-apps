---
title: Zoom video copy to SharePoint (Stage 3b)
kind: plan
domain: transcription
status: proposed
summary: "Copy one Zoom meeting MP4 into governed SharePoint as the request's staff-only Recording, using a server-side chunk pump into the existing MP4 upload intent, Graph upload session and finalize path; one new Postgres table (migration 076), one marker column, one visit route and one every-minute cron worker."
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

**[PROPOSED 2026-10-08; nothing built.]** This plan does not authorize a migration, a Vercel setting, a live Zoom, Graph or Dataverse call, a merge or a deployment.

**Migration number.** 076 is reserved for this stage; Stage 2 holds 075.
- [VERIFIED via `git ls-tree` of the migrations directory on each local `refs/remotes/origin/*` ref, 2026-10-08.] No ref carries migrations `075_` to `079_`. `origin/main` ends at `074_zoom_recording_imports.sql`.
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
- Graph `uploadFileLarge` requires a whole Buffer [VERIFIED via `graph/upload-session.js:132-193`].

**Pilot sizes.**
- The one measured meeting (Oct 5, 62 min) totalled 289 MB across five files [VERIFIED via `MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md:69-70`].
- M4As run 30–55 MB [VERIFIED via `ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md:39`].
- The MP4's own size was not recorded. About 200–250 MB per hour is an inference [ASSUMED].
- The pilot's per-meeting file list names one MP4 type, `shared_screen_with_speaker_view`, suffixed `(CC)` when captions exist [VERIFIED via workflow plan `:69`]. Other layouts are not ruled out (probe 3 below).

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
- The cron route uses `maxDuration` 300 with a 240 s work budget per tick.
- It needs its own `vercel.json` `functions` entry, because the `pages/api/cron/*.js` glob sets 120 s [VERIFIED via `vercel.json:21-23`].

**Chunk size: 10 MiB.**
- 10 MiB is a multiple of Graph's 320 KiB unit and under its 60 MiB per-request maximum [VERIFIED in code via `upload-session.js:152`; https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession, from memory].
- At most one chunk is held in memory at a time.
- No bytes pass through the browser or Blob.

**Each tick:**
1. Claim the copy row lease. This fences overlapping invocations [ASSUMED possible, from memory of https://vercel.com/docs/cron-jobs].
2. Claim the intent lease, so `upload-intent-cleanup` cannot act mid-copy.
3. Recheck the request→visit binding, Zoom availability, post-presentation access and `cancel_requested_at`.
4. Re-call `getMeetingRecordings`. The stored `zoom_file_id` must still be `completed`, with the same `file_size` and host. Otherwise stop with `zoom_recording_changed`.
5. Read Graph's next offset `o`.
6. Loop until 240 s or completion:
   - GET the resolved Zoom URL with `Range: bytes=o-(o+10MiB-1)`.
   - Check the 206 response's `Content-Range` and length.
   - PUT the chunk to Graph with `Content-Range`. Require Graph's ack to advance to `o+len`.
   - Renew both leases and call `refreshPresentationMaterialUploadSession`.

Download URLs are never persisted. They are re-resolved every tick, and once more after a 401, 403 or HTML response.

**If Zoom ignores Range [UNVERIFIED].**
- If Zoom answers a ranged GET with 200, stream from 0 and discard the bytes before Graph's offset.
- This stays correct, and its cost is bounded by the file size.
- Record `zoom_range_unsupported` once per copy.

**Upload session expiry.** A 404 or 410 from the session triggers the existing exact-path check:
- If the item is absent, start one lease-fenced fresh session under the same intent and generation key, restarting at 0, as `retryMp4Upload` does.
- After 3 such restarts, the copy is `failed` with `zoom_video_session_expired`.
- If a full-size item is present, go straight to finalize.

**Integrity.**
- Each chunk must match the requested range and length, and Graph's ack.
- The final item size must equal Zoom's `file_size`.
- Finalize's MP4 signature and mime checks must pass.
- Zoom publishes no source checksum [ASSUMED, from memory of https://developers.zoom.us/docs/api/meetings/]. A hash we computed ourselves would only prove the app-to-Graph leg, which TLS and the range acks already cover.
- v1 records Graph's `file.hashes.quickXorHash`, if Graph returns it, as a fingerprint so Stage 4/5 can detect replaced bytes (https://learn.microsoft.com/en-us/graph/api/resources/hashes, from memory).
- The repo has no quickXorHash code [VERIFIED via grep of `lib`, `shared` and `scripts`].

## Schema — migration `076_zoom_video_copies.sql`

```sql
ALTER TABLE presentation_material_uploads
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'browser'
  CHECK (origin IN ('browser', 'zoom_copy'));

CREATE TABLE IF NOT EXISTS zoom_video_copies (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  zoom_meeting_uuid TEXT NOT NULL CHECK (char_length(zoom_meeting_uuid) BETWEEN 1 AND 200),
  zoom_host_id TEXT NOT NULL CHECK (char_length(zoom_host_id) BETWEEN 1 AND 100),
  zoom_meeting_start TIMESTAMPTZ NOT NULL,
  zoom_file_id TEXT NOT NULL CHECK (char_length(zoom_file_id) BETWEEN 1 AND 200),
  zoom_recording_type TEXT NOT NULL CHECK (zoom_recording_type IN (
    'shared_screen_with_speaker_view', 'shared_screen_with_speaker_view(CC)')),
  declared_size BIGINT NOT NULL CHECK (declared_size > 0 AND declared_size <= 2000000000),
  upload_id UUID UNIQUE REFERENCES presentation_material_uploads(id),
  state TEXT NOT NULL CHECK (state IN ('queued','copying','registering','copied','failed','cancelled')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  bytes_confirmed BIGINT NOT NULL DEFAULT 0 CHECK (bytes_confirmed BETWEEN 0 AND declared_size),
  session_restarts SMALLINT NOT NULL DEFAULT 0 CHECK (session_restarts BETWEEN 0 AND 3),
  cancel_requested_at TIMESTAMPTZ,
  request_document_id UUID,
  sharepoint_drive_id TEXT,
  sharepoint_item_id TEXT,
  sharepoint_quickxor_hash TEXT,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT zoom_video_copies_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT zoom_video_copies_failed_shape CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT zoom_video_copies_copied_shape CHECK (state <> 'copied' OR (request_document_id IS NOT NULL
    AND sharepoint_drive_id IS NOT NULL AND sharepoint_item_id IS NOT NULL AND completed_at IS NOT NULL
    AND upload_id IS NOT NULL AND lease_token IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_active
  ON zoom_video_copies (request_id, zoom_file_id) WHERE state IN ('queued','copying','registering','copied');
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_work
  ON zoom_video_copies (state, lease_expires_at) WHERE state IN ('queued','copying','registering');
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_request_recent
  ON zoom_video_copies (request_id, created_at DESC);
```

**State machine.**
- `queued` → `copying` → `registering` → `copied`.
- Any non-terminal state can move to `failed`.
- `queued` and `copying` can move to `cancelled` once cancellation is confirmed.
- `upload_id` is null only between the claim and the intent creation in the same POST. If that POST fails, the row is marked `failed`.

**Idempotency.**
- The partial unique index means a repeated selection returns the existing row.
- A `copied` row blocks a second copy of the same Zoom file for the same request, until Stage 5 adds a deleted state.
- The intent's `client_resume_fingerprint` is derived on the server as `sha256("zoom-copy:" + uuid + ":" + fileId + ":" + size)`. This is lowercase hex, which its CHECK requires [VERIFIED via `055_post_presentation_materials.sql`].
- The generation key uses `mintMp4Upload`'s formula. A registration retry after a lost response therefore recovers the same Request Document.

**Browser exclusion.**
- `listPresentationMaterialUploads` filters only on actor and non-terminal state [VERIFIED via `upload-intent-store.js:20-33`].
- Without a marker, `projectUploadIntents` would offer staff the browser Resume, Cancel and Retry actions on a session the server owns [VERIFIED via `material-service.js:398-427`].
- After 076, every browser-facing read and claim requires `origin = 'browser'`. That covers `getPresentationMaterialUpload`, `listPresentationMaterialUploads`, `claimPresentationMaterialUpload` and the recovery claim.
- The cleanup claim covers both origins.

**Stage 5 identities.**
- On `copied`, the row holds the exact Request Document id, drive id and item id, independent of what later happens to the intent. It also holds the Zoom meeting UUID and file id, for deleting the Zoom original.
- It stores no URLs, tokens, topics or names.
- One Zoom file copied for two requests produces two owned SharePoint items. Stage 5 must check the other rows before deleting a Zoom original.

**Fresh-install parity.**
- Add 076 to the `files` list in `lib/db/migrations-manifest.json`.
- Add the same DDL to `scripts/setup-database.js`, as was done for 055 [VERIFIED: `presentation_material_uploads` appears in `scripts/setup-database.js`].

## Routes and security

**New route `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js`.**
- It does not extend 3a's `POST zoom-imports`. That route has an exact `{meetingUuid, nonSensitiveAcknowledged}` allowlist, is synchronous for up to 300 s, and is fenced on transcription spend [VERIFIED via `API_ROUTE_SECURITY_MATRIX.md:277`]. The copy spends nothing at any provider and must return as soon as the claim and session exist.
- The card calls both routes behind one Import action. This follows the workflow plan's "two independent existing-route calls behind one UI action" [VERIFIED via workflow plan `:86`].
- The preamble matches `transcriptions.js:8-37` (per the 3a plan; not re-read here).
- **`GET`** reads Postgres only, with no Zoom call. It returns `{ copies: [{ id, meetingUuid, state, bytesConfirmed, declaredSize, failureCode }] }`.
- **`POST`** accepts an exact discriminated body of at most 8 KB: `{action:'start', meetingUuid}` or `{action:'cancel', copyId}`. The actor comes from the session.

**Start** (`maxDuration` 60):
1. Recheck Zoom availability, the transcription interlock and post-presentation access.
2. Verify the meeting through the approved hosts' listing and the `host_id` match (3a's rule).
3. Pick the variant. Reject files over 2,000,000,000 bytes with `zoom_video_too_large` (422).
4. Claim the row.
5. Create the `zoom_copy` intent and Graph session through a helper extracted from `mintMp4Upload`. The path, generation key and session code stay unchanged.
6. Return `queued`.

**Cancel.**
- Sets `cancel_requested_at`.
- The next tick cancels the Graph session with `cancelBrowserUploadSession` semantics, where a 404 is not proof of cancellation.
- It abandons the intent only when the exact path is absent.

**Actor for the cron-executed registration.**
- `finalizeClaimedMp4Upload` requires a Dataverse system-user GUID and writes with actor policy `REQUIRED` [VERIFIED via `material-service.js:351-357`, `:615-619`].
- The tick passes the intent's stored `actor_id` as that GUID. That is the session system user who chose Import (`presentation_material_uploads.actor_id UUID NOT NULL`, 055).
- This is the first `REQUIRED` write on this seam that scheduled code executes with a stored actor. The cron-driven Pre-Site generator uses `SCHEDULED_AUTOMATION` instead [VERIFIED via `scripts/check-request-document-writers.js:27-31`].
- `REQUIRED` with the stored actor is recommended because a named staff member chose this exact file. Owner decision 7 confirms it.

**New cron `pages/api/cron/drain-zoom-video-copies.js`.**
- Uses `verifyCronSecret` and `withDalContext('cron-drain-zoom-video-copies', …)`.
- Needs a `* * * * *` cron row and a `maxDuration: 300` functions entry.

**Guards and gates.**
- Add two matrix rows.
- Raise `api-route-file-count` in `docs/CANONICAL_COUNTS.md` by 2.
- Run `check:api-routes` and `check:route-service-boundary`.
- Run `check:route-lifecycle-auth` if the visit namespace is listed in `ROUTE_NAMESPACE_LIFECYCLE`; check at build time.

**Credentials and interlock.**
- No new credentials. Graph uses its existing app credentials.
- Zoom uses `ZOOM_S2S_*` and `ZOOM_RECORDING_HOSTS`, which are set in Production only, by owner decision.
- Finalize's Dataverse create passes through the target/write interlock. SharePoint/Graph writes do not [VERIFIED via grep: no `graph` or `sharepoint` in `lib/dataverse/core/interlock.js`, no `interlock` in `lib/services/graph*`].
- So a local run writes to whatever SharePoint site `.env.local` targets.

## Card (Recording slot)

**Step 1 picker.**
- Each meeting gets a video line: "Video: not copied", "Copying 120 of 240 MB", "Saving", "Copied" or "Copy failed".
- Import starts both audio and video. A meeting imported before 3b offers **Copy video** on its own.
- The card polls `GET zoom-video-copies` every 10 s only while a copy is non-terminal, under the existing request-generation guard.

**Step 3, Full meeting → Recording.**
- While copying, the card keeps the Zoom link and adds "Copying the video from Zoom into SharePoint".
- On failure it shows "The video was not copied. The Zoom link still works." with **Try again**, which claims a new row.
- Once the copy succeeds, the existing projection shows the SharePoint MP4 as the current Recording, and the Zoom-link row is superseded.
- The card stays staff-only and desktop-first, and shows no internal ids.

## Partial success and concurrency

| Case | Behavior |
|---|---|
| Audio imported, video failed | The transcript proceeds and the Zoom link stays current. A video retry claims a new row and never touches the transcription job. |
| Video copied, audio failed | The Recording slot shows the MP4. Step 1 still offers the audio import. |
| Bytes complete, registration fails | The row stays `registering`. Each tick re-runs the idempotent finalize, which recovers by generation key. After the intent's review window the row becomes `failed` (`zoom_video_registration_failed`), and the candidate is left to the existing cleanup reconciler. |
| Transcription cancelled (#469/#470), or audio re-imported | No effect on the copy, because the two rows are independent. |
| Staff upload an MP4 manually during a copy | The higher slot fence at finalize wins. Existing code supersedes the loser or records it for reconciliation. |
| Visit unbound, access `off`, or Zoom config removed mid-copy | The tick stops before any write. The row becomes `failed` (`zoom_video_binding_changed` or `zoom_video_unavailable`), and the session is cancelled. |
| Zoom file deleted or changed | The row becomes `failed` (`zoom_recording_changed`), and the partial session is cancelled. |

## Durable surfaces to update in the build

- **Atlas:**
  - a new `docs/atlas/postgres-zoom-video-copies.md` page and its index row;
  - the `origin` column, in the `presentation_material_uploads` entry of `docs/atlas/postgres-infra-tables.md`;
  - the second `RECORDING` producer path, in `docs/atlas/dataverse-wmkf-requestdocument.md`.
- **API matrix:** two rows.
- **`docs/CANONICAL_COUNTS.md`:** the route count.
- **`docs/CI_GATES_REFERENCE.md`:** only if a gate changes.
- **`docs/SERVICE_AND_UTILITY_CATALOG.md`:** the copy service and the streaming Graph chunk helper.
- **Plans:** the workflow plan's Stage 3 note, and this plan's status.
- **Credentials runbook:** no change, unless the owner chooses a kill switch (decision 4).

## Tests (discriminating, with mutation checks)

**Pump (fake Zoom and Graph servers).**
- It resumes from Graph's offset, not from `bytes_confirmed`. Mutation check: resuming from the database column fails the case where Graph is ahead.
- A 200 response (no Range support) discards exactly the prefix before Graph's offset.
- Short or misaligned chunks are rejected.
- An HTML 200 and a redirect to a non-Zoom host are rejected.
- A URL that expires mid-tick is refetched once.
- A changed size or file id fails the copy.
- A 410 restarts the copy at 0, at most 3 times.
- The 240 s budget stops cleanly.
- Peak buffered bytes stay at or below one chunk.

**Store.**
- A start race returns one row.
- A `copied` row blocks re-copying. Mutation check: dropping `copied` from the index predicate fails the test.
- A stale lease can be taken over.
- Cancel fences a running tick.
- Browser list, claim and resume exclude `origin='zoom_copy'`. Mutation check: removing the filter fails the card-projection test.

**Registration.**
- Replaying finalize recovers the same Request Document.
- The Zoom-link predecessor is superseded.

**Outside readers.** Inject a copied-recording row, with the real producer and drive/item ids, into both reader suites. Cover both listing and direct open.

**Routes.**
- The body must match exactly.
- The actor comes from the session.
- GET makes no Zoom call.

**Card.**
- Progress shows while copying.
- Failure shows the plain-language copy and **Try again**.
- Polling stops at a terminal state.

**Gates**, each with its self-test, run sequentially:
- migrations-manifest, atlas, api-routes, route-service-boundary, route-lifecycle-auth;
- request-document-writers (expect no new writer row);
- fact-consistency, secret-scan, doc-currency;
- types and scoped ESLint.

## Release (Tier 2)

This is Tier 2: it adds background work, uploads and a migration [VERIFIED via `CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:119-131`].

Preview cannot exercise this stage. It has no Zoom credentials, and Vercel runs crons only on Production [ASSUMED, from memory of https://vercel.com/docs/cron-jobs].

1. Build on a feature branch. Add characterization tests of the browser MP4 path before the marker column lands.
2. Run the Mode A suites locally.
3. With owner approval, invoke the cron route once locally with `CRON_SECRET`, against a marked TEST request. Before that run, the owner confirms which Dataverse host and SharePoint site `.env.local` targets.
4. The owner applies 076 to Production Postgres.
5. Merge, with the last-known-good deployment and rollback recorded.
6. Run Mode D acceptance on one real recording the owner chooses. List the expected writes and cleanup beforehand, then confirm:
   - the SharePoint size equals the Zoom `file_size`;
   - the file plays;
   - the Request Document is visible to staff and absent from the Board page and the briefing;
   - the Zoom link is superseded;
   - repeating Import creates nothing new.

## Pre-implementation read-only probes (owner to authorize)

1. **Zoom Range support [UNVERIFIED].** In `scripts/probe-zoom-recordings.mjs`, follow `download_url` with the bearer token, then send `Range: bytes=0-1023` to the final `ssrweb.zoom.us` hop. Expect 206 with `Content-Range`. Record status and headers only.
2. **Zoom URL lifetime [UNVERIFIED].** Repeat probe 1 at +15 and +60 minutes on the same resolved URL.
3. **MP4 variants and sizes [UNVERIFIED].** List `recording_type`, `file_extension` and `file_size` for every MP4 in the 30-day window.
4. **Graph session expiry and hashes [UNVERIFIED for this tenant].** Read `expirationDateTime` from one `createUploadSession` on a TEST path, then DELETE that session. Separately, GET `file.hashes` on an existing `RECORDING` item.
5. **MP4 duration check [UNVERIFIED].** Check whether the `mvhd` box is in the first MiB, so the duration can be compared with Zoom's start and end times.

## Owner decisions

1. **Which variants to copy.** Recommendation: one MP4 per meeting, `shared_screen_with_speaker_view`, preferring the non-CC file and falling back to `(CC)`. Gallery and other layouts are not copied.
2. **Size cap.** Recommendation: keep the existing 2,000,000,000-byte cap, which is about 8 hours at the assumed rate.
3. **Cost.** There is no provider spend. Costs are Vercel function time (about 1–3 ticks per meeting [ASSUMED]), plus empty every-minute polls and SharePoint storage until Stage 5. Recommendation: accept.
4. **Kill switch.** Recommendation: no new variable. Availability follows the Zoom variables and `POST_PRESENTATION_MATERIALS_ACCESS`, and rollback is a revert. The alternative is a non-sensitive `ZOOM_VIDEO_COPY_ACCESS=off|test:<GUID>|on`, which would allowlist the Mode D request.
5. **Copy automatically.** Recommendation: Import starts both audio and video. Earlier imports get **Copy video**.
6. **Integrity checks.** Recommendation: in v1, check size, range acks and the signature. Record the quickXorHash but do not compare it.
7. **Registration actor policy.** Recommendation: `REQUIRED`, with the stored actor of the staff member who chose Import. The alternative is `SCHEDULED_AUTOMATION`, which would add a new writer-gate row.

## Contract review (`/contract-reconcile` Mode A, planning pass)

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

**Source contradicts other docs (none edited here; the `zoom_recording_imports` items were reconciled in Session 588).**
- `DATAVERSE_SHAREPOINT_FILE_MODEL.md:624` names `Site Visit/Recording` as the governed path. The code writes MP4s under `Post Site Visit Materials/` (`material-service.js:749`).
- Three places still call `zoom_recording_imports` unapplied or unmerged:
  - the Atlas index row (`APPLICATION_STATE_ATLAS.md:111`);
  - API matrix rows 276–277;
  - the 3a plan's own Build status line.
