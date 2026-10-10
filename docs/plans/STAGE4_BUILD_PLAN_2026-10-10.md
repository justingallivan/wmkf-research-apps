---
title: Stage 4 build plan — presentation video cut
kind: plan
domain: transcription
status: draft
summary: "Build plan for Stage 4 (presentation-only video cut from the copied Zoom MP4 at the confirmed presentation end), written Session 592 from source reads. Ordered slices with owner gates: Sandbox SDK probe, migration 079 plus copy-time recording times, split store and start route, Sandbox worker with reaper, approval and Board/briefing playback, card. Contract-reconcile Mode A: ready with named changes (applied; approval = registration, as for summaries). Owner decisions B1-B6 recorded; slice 0 (SDK probe) passed. Nothing built in the app."
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

**Decided (owner, Session 592, 2026-10-10):** B1 as recommended (slice 0 test approved; the credential is approved after its results), plus **charge tracking** (below); B2 settled (approval = registration); B3 agreed (redirect playback, `watch` for this type only); B4 as recommended (private Blob copy of the verified FFmpeg build); B5 label **"Presentation Video"** (value 100000011); B6 approved (order below).

**Charge tracking (owner request, B1).** Each split row records its sandbox usage: provisioned seconds, vCPUs, active CPU seconds when the SDK or API reports them (slice 0 checks this; otherwise wall time × vCPUs as an upper bound), and the cost computed at list prices. The per-hour prices live in config, not code. A staff-visible monthly total (per request and overall) lets the owner plan spend. Failed and reaped jobs are counted too.

**Billing context (Session 592, 2026-10-10).**
- **[VERIFIED via vercel.com/docs/sandbox/pricing, updated 2026-09-10]:**
  - Pro Sandbox usage draws on the $20 monthly credit and is then billed at list price; Pro is never paused for exhausting it.
  - Creations cost $0.60 per million. Outbound data is included in Pro's flat-rate CDN.
  - Memory is billed in 1-minute minimums.
  - The maximum session is 24 hours, so the 3-hour timeout is well within it.
- **The only outage path is Spend Management "Pause production deployments"** (vercel.com/docs/spend-management, updated 2026-09-18). Over budget, it pauses every project on the team.
- **The owner's team setting, from a dashboard screenshot:**
  - Budget $200, with pausing **off**, so alerts only.
  - Current, previous-cycle and 3-month spend are all $0.
- At under 50 cuts per cycle (owner estimate), Stage 4 is roughly $8-$40 per cycle. No credit or plan change is needed.

- **B1. Sandbox SDK and credential path.** The app has no `@vercel/sandbox` dependency, and nothing in the app authenticates to Vercel from a deployed function; the only Vercel API caller (`pages/api/cron/log-analysis.js:40-60`) uses a personal token. How the SDK authenticates from a deployed function (OIDC or a token) is `[ASSUMED]` until slice 0 measures it. Approve adding the dependency and the credential that slice 0 finds.
- **B2. Approval = registration (revised by contract-reconcile, Session 592).** Recommendation: follow the summary draft → publish model. The cut output sits in SharePoint, recorded only on the Postgres split row, while staff check it. **Check the ending and approve** registers the Dataverse document. A Board-visible video therefore always means "registered and bound", exactly as for summaries (`transcript-summary-service.js:555-560` creates the row only at publish). Every post-presentation row is registered as `DRAFT` today, and the outside pages exclude only `SUPERSEDED` (`material-service.js:1335`, `presentation-page-service.js:84`). A `REVIEW` → `BOARD_READY` gate would therefore be a new lifecycle meaning that no reader honours today. Rejected alternative: register at `REVIEW` and gate outside readers on `BOARD_READY`.
- **B3. Board playback.** The outside presentation open route already redirects to a fresh Microsoft URL after rechecking membership (`pages/api/external/presentation/[token]/open.js:1,35-37`) and already accepts `mode=watch` at the route (`:26`); the service currently rejects `watch` for post-presentation types. Recommendation: the presentation video uses the same redirect, with `watch` allowed for this type only; the browser plays the MP4 from the SharePoint download URL. Confirm Board members may be sent to that short-lived URL for video, as they already are for transcripts.
- **B4. FFmpeg source at run time.** The pilot fetched the pinned BtbN build from GitHub, and GitHub rate-limited a Vercel deployment's source fetch on 2026-10-10. Recommendation: store the verified tarball once in a private Blob store and fetch it from there in the sandbox, still checking its SHA-256. Alternative: GitHub at run time (no new storage, exposed to GitHub limits).
- **B5. Picklist value.** `BOARD_PRESENTATION_RECORDING = 100000011` is reserved for Stage 4 (`SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md`; header of `scripts/extend-requestdocument-artifacttype-staff-discussion-transcript.mjs`), and migration 068 already admits 100000011 in its Postgres CHECKs (`lib/db/migrations/068*.sql:18,24`). The owner runs a one-value extend script in Dataverse before slice 4 deploys. Until then the code fails closed.
- **B6. First real input.** Plan step 3 of the design: ask before the first real cut. Sequence: slice 1 lands, the owner re-imports 1003222's transcript from Zoom (one paid transcription) and re-copies its video, confirms the boundary and attendance, then runs the first cut into the normal staff-only review state. 1003222 is a test request (decision 13), so its Board link may be used for the ending check.

## Slices

Each slice is a branch merge under Tier 1-3 release rules (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`). Migrations 079 and 080 are applied to Production by the owner before the merge that needs each, as with 077 and 078.

### Slice 0 — Sandbox SDK probe (no app runtime change)

- On a branch, add `@vercel/sandbox`; from a Preview deployment (or locally against the linked project), create a 10-second non-persistent sandbox in `iad1`, stop it, delete it, and confirm `list` and `snapshots list` are empty.
- Record: which credential the SDK used, the maximum `timeout` the Pro tier allows, whether a detached command can be rediscovered from a later invocation by sandbox name and command id, and how the network allowlist is set per sandbox.
- Output: a short results note. If detached commands cannot be rediscovered across invocations, stop and revise slice 3 before building.

**Slice 0 result (Session 592, 2026-10-10): passed.** Run locally from the scratchpad, outside the repo, with `@vercel/sandbox@3.4.0` (published 2026-09-23) and a freshly pulled Development OIDC token. The local `.env.local` token had expired on 2026-08-20.
- **Credential [VERIFIED via SDK source `dist/utils/get-credentials.js`]:** the SDK calls `getVercelOidcToken` from `@vercel/oidc` and reads team and project from the token. Inside a Vercel function it uses the runtime OIDC token, so no stored secret or personal token is needed. That this works in a *deployed* function is `[ASSUMED]` until the first Preview run of slice 3.
- **Create [VERIFIED via probe]:** `persistent: false`, `iad1`, `failoverRegions: []`, 2 vCPU, `networkPolicy: 'deny-all'`, and a requested `timeout` of 5 hours (18,000,000 ms) were all accepted and read back. The tier's ceiling above 5 hours was not probed; 5 hours is enough for v1.
- **Rediscovery [VERIFIED via probe]:** a detached `runCommand` returned a `cmdId`; a fresh `Sandbox.get({ name })` plus `getCommand(cmdId).wait()` returned exit 0 and the output. A later cron tick can therefore poll a job started by an earlier tick.
- **Charge tracking [VERIFIED via probe]:** `activeCpuUsageMs` is reported after stop (2,414 ms for this probe). The SDK documents it as available only once the VM is stopped.
- **Cleanup [VERIFIED via probe and CLI]:** stop, then `listSnapshots` (0), then `delete`; `Sandbox.get` then returned 404, and `vercel sandbox list --all` and `vercel sandbox snapshots list` were both empty.
- Cost: under $0.01.

### Slice 1 — Migration 079 and copy-time recording times

**[Session 592] Migration numbering revised.** 079 holds only the two `zoom_video_copies` columns, so the owner can apply it early. The split table moves to **080** with slice 2, so its schema is reviewed before it is fixed. This revises decision 17 ("079 is the split-job table plus the decision 16 columns"). **Built on branch `claude/stage4-slice1`** (worktree `/Users/gallivan/Code/WMKF_Apps-stage4`):
- **Migration:** `079_zoom_video_copy_recording_times.sql`.
- **Helpers:** `zoomRecordingTimes` and `sameZoomRecordingTimes` in `video-copy-store.js`.
- **Wiring:** the times are passed at N1 in `video-copy-service.js`, and the comparison is in `listAndValidate`.
- **Tests:** store, service and worker tests, including a mutation check of the worker guard. The 13 related suites pass (453 tests).
- **Atlas** page updated.

- Migration 079: `zoom_video_copies.recording_start` and `recording_end` (`TIMESTAMPTZ NULL`, both null or both set). Manifest entry and Atlas updates.
- Write the times at copy start: `video-copy-service.js:127-133` already holds the Zoom file from `pickVideoFile`, whose `recording_start` / `recording_end` are available there; pass them into `store.startZoomVideoCopy` (insert at `video-copy-store.js:183-191`). The worker's `listAndValidate` (`video-copy-worker.js:464-481`) gains the same comparison, only for rows that have times, so a changed Zoom file fails the copy. A copy already in flight when slice 1 deploys has null times and must not fail on the new check.
- Rows copied before this slice keep null times and are ineligible for a cut (decision 16). Landable alone.

### Slice 2 — Split store, start route and same-source check

- **Table `presentation_video_splits`** (migration 080), modeled on `zoom_video_copies` (`076_zoom_video_copies.sql`):
  - identity: `id`, `request_id`, `site_visit_activity_id`, `actor_profile_id`, `source_copy_id` (FK `zoom_video_copies`);
  - frozen input: `transcript_revision_id`, `presentation_end_ms`, the content-free provenance projection (JSONB, no names or attendance), source document id, SharePoint drive/item/version/eTag, size, quickXorHash, `mapping_version`;
  - state: `queued`, `cutting`, `uploading`, `review`, `registering`, `approved`, `failed`, `cancelled`, `superseded`. The worker owns `queued` through `review`. The staff approve route owns `review` → `registering` → `approved`;
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
- **Then `review`.** The worker does not register anything. The output is in SharePoint, recorded only on the split row, and it is not visible to outside readers because no Dataverse row exists for it.
- **Cleanup and reaper:**
  - After every terminal step, and on any failure: stop the sandbox; list snapshots across all pages and delete any found (each one logged as a retention incident); delete the sandbox; confirm it is absent with an independent list; write the cleanup receipt.
  - A row whose lease expired in `cutting` or `uploading` gets the same cleanup, then fails with `processor_lost`. A partly uploaded session is cancelled.
- **Ceilings in config, not code:** sandbox timeout, vCPUs and attempt caps (memory rule `feedback-mutable-parameters-not-in-code`). The first real cut measures runtime. The timeout starts at 3 hours on 2 vCPU, at most about $1 per job at the pilot's list prices, and is lowered from that measurement.

### Slice 4 — Binding, approval and Board/briefing playback

- **`bindPresentationVideo`** (new, next to `presentation-transcript-binding.js`) returns `bound`, `missing` or `stale`. A row is bound only when both hold:
  - the type is 100000011;
  - `wmkf_inputfingerprint` matches the current revision, `endMs` and source Recording identity, all computable from the Dataverse rows the readers already load.

  Unapproved output has no Dataverse row, so it is `missing` (B2). The fingerprint and lineage are content-free and do not need the full Recording to exist (Stage 5).
- **Staff review open:** a staff route (`requireAppAccess('meeting-tracker')`) resolves a fresh download URL for the split row's output item. It checks the recorded item id and eTag, like `resolvePresentationMember`. This is the card's Open link before approval.
- **Approve route** (staff, actor from session):
  - It claims the split row first (`review` → `registering`, leased), so a second click or a concurrent re-cut cannot double-register. The summary publish's claim-first pattern is the precedent (`transcript-summary-service.js` `publishSummaryDraft`).
  - It rechecks the frozen identity, the current transcript revision and boundary, and that the output item's eTag and quickXorHash still match the receipt.
  - It registers through the post-presentation create path with the slot fence:
    - type 100000011, `DRAFT`, `wmkf_producer` as for the other post-presentation rows;
    - `wmkf_generationkey` unique per split row, mirroring the MP4 finalize's per-upload key (`material-service.js:1336-1338`);
    - the binding fingerprint on `wmkf_inputfingerprint`;
    - the pinned SharePoint version and eTag.
  - Before any create on retry, it looks up an existing row by that generation key.
  - The new create seam is a `REQUIRED` actor-policy row in `scripts/check-request-document-writers.js` `WRITERS`.
  - It then sets `approved` with the approver. A later approved re-cut supersedes the earlier video through the slot's latest-only winner rule.
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
    - quickXorHash is not an FFmpeg feature. The sandbox needs a small stdlib implementation, with a unit test against a Graph-reported hash of a known file.

## Acceptance before Board use

- Unit tests for each store transition and fence, the start route's refusals, the worker's revalidation, the reaper, and the outside-reader exclusions.
- First real cut (B6): the owner watches its ending in a browser and in the SharePoint viewer before approving. This replaces the synthetic ending check (Session 592).
- The first real cut records runtime and cost, which then set the timeout ceiling.

## Gates

`check:migrations-manifest`, `check:atlas` (new table page; `zoom_video_copies` and `wmkf_requestdocument` pages), `check:api-routes` (start, approve and cron rows), `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:request-document-writers`, `check:status-enum-parity` (state and label maps), `check:dataverse-access-layer`, `check:route-service-boundary`, the scheduled-job census test, and `check:types`.

## Contract-reconcile Mode A (Session 592)

Verdict: **READY WITH NAMED CHANGES**. The changes below are applied above.
1. **Approval model.** The plan's `REVIEW` → `BOARD_READY` gate would have added a lifecycle meaning no outside reader checks. The only lifecycle check is `!= SUPERSEDED` (`presentation-page-service.js:84`). A grep of `lib/services/{post-presentation-materials,meeting-tracker-transcription,meeting-tracker-recordings}` finds no write of `REVIEW`, `BOARD_READY` or `FINAL`. Replaced by register-on-approval (B2), the summary publish precedent.
2. **Generation identity.** It was "fingerprint only, to avoid alternate-key collisions". It is now a per-split `wmkf_generationkey` plus the binding fingerprint on `wmkf_inputfingerprint`, as the MP4 finalize already does (`material-service.js:1336-1338`).
3. **Actor policy.** Registration moved from the cron to the staff approve route, so the new create seam uses `REQUIRED` with the approving staff member as actor, and needs a `WRITERS` row in `scripts/check-request-document-writers.js`.
4. **In-flight copies.** The copy worker's new recording-time comparison applies only to rows that have times.
5. **Staff review access.** Added a staff open route for the unregistered output.
6. **quickXorHash** needs an in-sandbox implementation.

Owner decisions B1-B6 were recorded later the same session (see the top). A fresh-agent adversarial review (`/codex:adversarial-review`) is recommended before slice 2 code, per the skill's step 6.
