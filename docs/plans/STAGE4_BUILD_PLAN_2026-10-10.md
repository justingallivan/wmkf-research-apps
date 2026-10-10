---
title: Stage 4 build plan — presentation video cut
kind: plan
domain: transcription
status: draft
summary: "Build plan for Stage 4 (presentation-only video cut from the copied Zoom MP4 at the confirmed presentation end), written Session 592 from source reads. Ordered slices with owner gates: Sandbox SDK probe, migration 079 plus copy-time recording times, split store and start route, Sandbox worker with reaper, approval and Board/briefing playback, card. Draft: nothing built; owner decisions B1-B6 open."
owner: product-engineering
related:
  - docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md
  - docs/plans/STAGE4_SANDBOX_PILOT_RESULTS_2026-10-09.md
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
  - docs/atlas/postgres-zoom-video-copies.md
---

# Stage 4 build plan — presentation video cut

**[DRAFT, Session 592, 2026-10-10.]** Nothing here is built. The design and owner decisions 1-17 live in `STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md`; this plan does not reopen them. It turns that design into ordered slices. Source facts below come from Session 592 source reads, either direct or by read-only research agents with file:line citations. The one unmeasured fact (how the Sandbox SDK authenticates) is labelled where it appears. Next step: `/contract-reconcile` Mode A on this plan, then owner approval.

**v1 scope (fixed):** presentation video only; started on request; identity mapping (cut at `endMs` on the MP4 timeline); Vercel Sandbox venue; no discussion video, no anchor mapper, no automatic trigger. Anything outside this goes to a follow-up, not into these slices.

## Owner decisions needed

- **B1. Sandbox SDK and credential path.** The app has no `@vercel/sandbox` dependency, and nothing in the app authenticates to Vercel from a deployed function; the only Vercel API caller (`pages/api/cron/log-analysis.js:40-60`) uses a personal token. How the SDK authenticates from a deployed function (OIDC or a token) is `[ASSUMED]` until slice 0 measures it. Approve adding the dependency and the credential that slice 0 finds.
- **B2. Approval home.** Recommendation: the staff approval sets the Dataverse document's `wmkf_lifecyclestate` from `REVIEW` (100000001) to `BOARD_READY` (100000002) (`shared/config/requestDocument.js:54-60`), and the Postgres split row records who approved and when. Outside readers then need no new Postgres read, and the approval survives Stage 5 deletion. Alternative: approval only on the Postgres row, which adds a Postgres read to the Board and briefing pages.
- **B3. Board playback.** The outside presentation open route already redirects to a fresh Microsoft URL after rechecking membership (`pages/api/external/presentation/[token]/open.js:1,35-37`) and already accepts `mode=watch` at the route (`:26`); the service currently rejects `watch` for post-presentation types. Recommendation: the presentation video uses the same redirect, with `watch` allowed for this type only; the browser plays the MP4 from the SharePoint download URL. Confirm Board members may be sent to that short-lived URL for video, as they already are for transcripts.
- **B4. FFmpeg source at run time.** The pilot fetched the pinned BtbN build from GitHub, and GitHub rate-limited a Vercel deployment's source fetch on 2026-10-10. Recommendation: store the verified tarball once in a private Blob store and fetch it from there in the sandbox, still checking its SHA-256. Alternative: GitHub at run time (no new storage, exposed to GitHub limits).
- **B5. Picklist value.** `BOARD_PRESENTATION_RECORDING = 100000011` is reserved for Stage 4 (`SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md`; header of `scripts/extend-requestdocument-artifacttype-staff-discussion-transcript.mjs`), and migration 068 already admits 100000011 in its Postgres CHECKs (`lib/db/migrations/068*.sql:18,24`). The owner runs a one-value extend script in Dataverse before slice 4 deploys. Until then the code fails closed.
- **B6. First real input.** Plan step 3 of the design: ask before the first real cut. Sequence: slice 1 lands, the owner re-imports 1003222's transcript from Zoom (one paid transcription) and re-copies its video, confirms the boundary and attendance, then runs the first cut into the normal staff-only review state. 1003222 is a test request (decision 13), so its Board link may be used for the ending check.

## Slices

Each slice is a branch merge under Tier 1-3 release rules (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`). Migration 079 is applied to Production by the owner before the merge that needs it, as with 077 and 078.

### Slice 0 — Sandbox SDK probe (no app runtime change)

- On a branch, add `@vercel/sandbox`; from a Preview deployment (or locally against the linked project), create a 10-second non-persistent sandbox in `iad1`, stop it, delete it, and confirm `list` and `snapshots list` are empty.
- Record: which credential the SDK used, the maximum `timeout` the Pro tier allows, whether a detached command can be rediscovered from a later invocation by sandbox name and command id, and how the network allowlist is set per sandbox.
- Output: a short results note. If detached commands cannot be rediscovered across invocations, stop and revise slice 3 before building.

### Slice 1 — Migration 079 and copy-time recording times

- Migration 079: `zoom_video_copies.recording_start` and `recording_end` (`TIMESTAMPTZ NULL`, both null or both set), plus the split table below. Manifest entry and Atlas updates.
- Write the times at copy start: `video-copy-service.js:127-133` already holds the Zoom file from `pickVideoFile`, whose `recording_start` / `recording_end` are available there; pass them into `store.startZoomVideoCopy` (insert at `video-copy-store.js:183-191`). The worker's `listAndValidate` (`video-copy-worker.js:464-481`) gains the same comparison, so a changed Zoom file fails the copy.
- Rows copied before this slice keep null times and are ineligible for a cut (decision 16). Landable alone.

### Slice 2 — Split store, start route and same-source check

- **Table `presentation_video_splits`** (in 079), modeled on `zoom_video_copies` (`076_zoom_video_copies.sql`):
  - identity: `id`, `request_id`, `site_visit_activity_id`, `actor_profile_id`, `source_copy_id` (FK `zoom_video_copies`);
  - frozen input: `transcript_revision_id`, `presentation_end_ms`, the content-free provenance projection (JSONB, no names or attendance), source document id, SharePoint drive/item/version/eTag, size, quickXorHash, `mapping_version`;
  - state: `queued`, `cutting`, `uploading`, `registering`, `review`, `approved`, `failed`, `cancelled`, `superseded`;
  - lease and fence (`lease_token`, `lease_expires_at`, `next_attempt_at`), attempt caps, `cancel_requested_at`;
  - sandbox ledger: `sandbox_name`, `sandbox_command_id`, `sandbox_created_at`, `sandbox_cleaned_at`, cleanup receipt (JSONB, content-free);
  - output: SharePoint drive/item/version/eTag, size, quickXorHash, `request_document_id`, verification receipt (JSONB);
  - approval: `approved_by_profile_id`, `approved_at`;
  - `failure_code`, timestamps;
  - CHECKs mirroring the copy table's shape checks, and a partial unique index allowing one active split per request.
- **Output upload ledger.** The split row holds its own upload session. It does not reuse `presentation_material_uploads`. Reusing it needs a third `origin` value and an audit of the 18 `origin = '…'` predicates in `upload-intent-store.js` [DERIVED-FROM: `grep -c "origin = '"` on that file, Session 592; independent of other counts]. The split never takes browser bytes, so a separate ledger is smaller.
- **Start (staff route, `requireAppAccess('meeting-tracker')`, actor from session).** The route calls `resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId })` (`meeting-tracker-transcription/service.js:941-967`; only tests call it today). It requires all of:
  - `status === 'verified_zoom'`;
  - `zoom.audioOnlyFileCount === 1`;
  - a confirmed `presentationEnd`;
  - the current RECORDING winner is the registered result of a `copied` copy row for the same request and `zoom.meetingUuid`;
  - the copy row's recording times are present and equal the audio file's `recordingStart` / `recordingEnd`, compared as parsed instants, not strings.

  A failure returns a named reason. A 409 `meeting_transcript_current_changed` from the resolver is surfaced as a retry refusal. On success, the route freezes the input identity into the split row (state `queued`).
- **Rollout flag:** a new `PRESENTATION_VIDEO_SPLIT_ACCESS` (`off` / `on` / `test:<GUID>`), with the same parser shape as `lib/utils/zoom-video-copy-access.js`. Unset means off.

### Slice 3 — Worker, Sandbox supervisor and reaper

- **New cron** `pages/api/cron/drain-presentation-video-splits.js`, every minute, `maxDuration` 300, `verifyCronSecret`, a `MaintenanceService` run and `withDalContext`, like `drain-zoom-video-copies.js`. It is separate from the copy cron, so each has its own time budget and failure surface. Census edits are included: the hard-coded counts and `RECORDED_CRONS` in `tests/unit/test-request-scheduled-job-census.test.js`, `vercel.json`, and the API matrix row.
- **Tick order:** reap expired leases, then claim one due row (`FOR UPDATE SKIP LOCKED`), then dispatch by state. The worker never re-runs the resolver, which needs a staff actor. It revalidates against the frozen identity before each phase:
  - the copy row is unchanged;
  - the SharePoint item's version, eTag and quickXorHash are unchanged;
  - the request's current transcript revision and `endMs` are unchanged, read from the Dataverse TRANSCRIPT row via `confirmedPresentationEnd`.

  Any change moves the row to `superseded`.
- **`queued` → `cutting`:**
  1. Write the sandbox name to the row before creating the sandbox.
  2. Create a non-persistent sandbox in `iad1`, with no failover, 2 vCPU and a timeout from config. Check that persistence is off and there are no mounts.
  3. Allow network only to the FFmpeg source (B4) and the tenant's Microsoft download and upload hosts.
  4. Start the detached cut command with a fresh pre-authenticated download URL from `resolveMediaDownloadUrl` (`lib/services/graph/media.js:25`). Never log or persist the URL.
- **`cutting`:** each tick rediscovers the sandbox by its recorded name and polls the command. It never runs a probe command, because a command can resume a stopped sandbox. On success it stores the receipt: content-free durations, frame and sample counts, the packet-equality result, output size, and the quickXorHash computed in the sandbox.
- **`uploading`:**
  1. Only now does the worker create the Graph upload session (`createBrowserUploadSession`, `conflictBehavior: 'fail'`) in the request's `Post Site Visit Materials` folder.
  2. A second detached command uploads chunks in multiples of 320 KiB to that session URL.
  3. The worker confirms that the completed item's size and Graph quickXorHash equal the receipt (same item-id check as `readQuickXorHash`, `video-copy-worker.js:538-559`). There is no re-download.
- **`registering`:** register through the single `createDocument` path in `material-service.js`:
  - type 100000011, lifecycle `REVIEW`;
  - the slot fence;
  - generation identity on `wmkf_inputfingerprint`, as summaries do. `wmkf_generationkey` is the Dataverse alternate key, and a re-cut at the same revision and boundary must not collide with it. Contract-reconcile confirms this choice.

  Then `review`.
- **Cleanup and reaper:**
  - After every terminal step, and on any failure: stop the sandbox; list snapshots across all pages and delete any found (each one logged as a retention incident); delete the sandbox; confirm it is absent with an independent list; write the cleanup receipt.
  - A row whose lease expired in `cutting` or `uploading` gets the same cleanup, then fails with `processor_lost`. A partly uploaded session is cancelled.
- **Ceilings in config, not code:** sandbox timeout, vCPUs and attempt caps (memory rule `feedback-mutable-parameters-not-in-code`). The first real cut measures runtime. The timeout starts at 3 hours on 2 vCPU, at most about $1 per job at the pilot's list prices, and is lowered from that measurement.

### Slice 4 — Binding, approval and Board/briefing playback

- **`bindPresentationVideo`** (new, next to `presentation-transcript-binding.js`) returns `bound`, `missing`, `stale` or `not_approved`. A row is bound only when all of these hold:
  - the type is 100000011;
  - the fingerprint matches the current revision, `endMs` and source identity;
  - the lifecycle is `BOARD_READY` (B2).

  The fingerprint and lineage are content-free and do not need the full Recording to exist (Stage 5).
- **Approve route** (staff): moves the document from `REVIEW` to `BOARD_READY` and records the approver on the split row, fenced on the output's version and eTag. A later re-cut supersedes the earlier video.
- **Outside readers:**
  - Add the type to the allowlists in `presentation-page-service.js:34-37` and `briefing-page-service.js:91-103`, plus an MP4 mime entry.
  - Allow `watch` only for this type, and keep the pinned-eTag check at open.
  - `POST_PRESENTATION_ARTIFACT_TYPES` (`material-model.js:15-27`) and `MATERIAL_TYPES` (`logistics-service.js:59`) gain the type.
  - Tests inject the full Recording, an unapproved video and a stale video, and prove all three are excluded at listing and at open.

### Slice 5 — Card

In `RecordingAndTranscriptCard.js`, step 3's **Presentation** subsection (`:3160-3165`) gains a Video line:
- **States shown:** not started, working, ready to check, approved for the Board, out of date, or failed with a reason.
- **Create presentation video:** enabled only when slice 2's checks pass.
- **Check the ending and approve:** staff open the video from the card.

UI gates mirror the server guards (memory rule `feedback-ui-gates-must-mirror-server-guards`).

## Sandbox recipe (port of `scripts/benchmarks/stage4-sandbox-pilot.py`)

1. Fetch the pinned FFmpeg 9.0.2 build (B4) and verify its SHA-256 (`14020417…0902`) before use. The font is not needed.
2. Download the source from the pre-authenticated URL to scratch; require its size to equal the frozen size.
3. Run `ffprobe` on the source for frame rate, sample rate and stream layout.
   - Reject variable frame rate.
   - Reject more than one video or audio stream. Zoom's `bin_data` stream is the exception and is dropped.
4. Compute `frames = floor(T × fps)` and `samples = floor(T × rate)`, where T = `endMs` / 1000.
5. Decode the audio onto a zero-based clock, trim it to `samples`, and write isolated PCM. Reject unless the size is exactly `samples × channels × 2`.
6. Encode AAC from that PCM twice: once as the output, once as an independent check copy.
7. Re-encode the first `frames` video frames with libx264 (veryfast, CRF 20, yuv420p).
8. Mux one H.264 stream and one AAC stream into a partial file, with metadata and chapters removed and `+faststart`.
9. Accept only if all of these hold:
   - exactly two streams, and only MP4 brand tags;
   - the frame count matches, and the last frame ends at or before T;
   - the audio duration is at most `samples`;
   - the audio packets equal the independent encode.
10. Rename the partial file only after acceptance, then compute its quickXorHash. Out-of-space errors map to `insufficient_scratch`.

## Acceptance before Board use

- Unit tests for each store transition and fence, the start route's refusals, the worker's revalidation, the reaper, and the outside-reader exclusions.
- First real cut (B6): the owner watches its ending in a browser and in the SharePoint viewer before approving. This replaces the synthetic ending check (Session 592).
- The first real cut records runtime and cost, which then set the timeout ceiling.

## Gates

`check:migrations-manifest`, `check:atlas` (new table page; `zoom_video_copies` and `wmkf_requestdocument` pages), `check:api-routes` (start, approve and cron rows), `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:request-document-writers`, `check:status-enum-parity` (state and label maps), `check:dataverse-access-layer`, `check:route-service-boundary`, the scheduled-job census test, and `check:types`.
