---
title: Meeting video split at the presentation end (Stage 4)
kind: plan
domain: transcription
status: draft
summary: "Design outline for cutting the copied Zoom meeting MP4 at the staff-confirmed presentation end into a Board-eligible presentation video only (no discussion video; owner 2026-10-09), approved by staff before Board release, with same-source proof, a frozen source identity, a durable split job and a processor contract. Venue research and local benchmarks by Codex are merged to main (228a97b5b). Session 591: coordinated with the Codex transcript-provenance contract; same-source check is metadata plus staff listen (hard gate 1 relaxed). Draft: nothing built."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/postgres-zoom-video-copies.md
---

# Meeting video split at the presentation end (Stage 4)

**[DRAFT OUTLINE, Session 590, 2026-10-09.]** Nothing here is built or approved. This outline turns Stage 4 of `MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md` (`:104-112`) into a design. The processing venue (where the cut runs) was researched by Codex (merged to `main` in `228a97b5b`; deliverable `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md`). This document defines what any venue must receive and return.

**[Session 591, 2026-10-09] Coordination with the Codex speaker-label plan is agreed (owner approved).** Response and contract: `/tmp/zoom-attribution-stage4-response.md` against Codex's `/tmp/zoom-attribution-shared-contract.md` (both outside the repo; the decisions are recorded below). Stage 4 is unpaused for the Sandbox pilot only (done, see `STAGE4_SANDBOX_PILOT_RESULTS_2026-10-09.md`); Codex's provenance slice has since merged (`f3cc08540`, migration 077), so the Stage 4 build plan can proceed (decisions 15-17).

## Owner decisions

**Decided (owner, Session 590, 2026-10-09):** 1 = **presentation video only** (revised; see below); 2 = cut exactly at `endMs`; 3 = Zoom copy plus Zoom transcript only; 5 = on request. Decision 4 was later decided (add the hash write); 6 and 7 remain open. Original recommendations follow for the record.

**Decided (owner, Session 590, 2026-10-09), after Codex's first research pass:**
- **8. Staff review before Board release.** A staff member listens to the presentation video's ending and approves it before the video becomes Board-eligible. Until then outside readers withhold it.
- **9. Staff access needs no verification.** The full Recording stays available to staff at all times, as today; the review in decision 8 gates only Board release. Staff do not need split versions: they were on the call.
- **1, revised.** Presentation video only. No discussion video is made: staff keep the full Recording until the Stage 5 deadline, when it is deleted and only the presentation video is retained. A discussion file would add a second discussion copy to protect and delete.
- **10. Benchmark (owner, Session 590).** Codex may install FFmpeg locally for synthetic media. Cloud benchmark on Vercel Sandbox with a $10 incremental compute cap, persistence off and verified cleanup, in the app's US region. When the transcript-to-video mapping is uncertain, trim the presentation's end by the measured uncertainty up to 2 s; above 2 s, block for staff review. First real input after synthetic checks pass: 1003222's copied video, with outputs in an isolated staff-only test folder. Defaults not yet confirmed by the owner [ASSUMED]: source resolution, H.264 + AAC at standard quality, same-day turnaround.
**Decided (owner, Session 591, 2026-10-09), coordinating with Codex's transcript-provenance contract:**
- **11. Binding stays on the transcript revision.** The presentation video goes out of date whenever the transcript revision changes, like the derivative transcripts and summaries. Edits after publication are expected to be rare; a re-cut and re-listen is acceptable.
- **12. Same-source check is metadata plus staff listen; hard gate 1 relaxed.** No audio-packet comparison, no import-time packet digest, no Zoom re-download at split time. See "Same-source proof". Zoom keeps cloud recordings about 180 days (owner), but Stage 4 does not depend on it.
- **13. 1003222 is a test request** (its Board link is never shared outside the foundation), so it may be used end to end, including Board approval. Its current transcript has no provenance; when testing reaches a real cut, the owner re-imports it after Codex's provenance slice is live (one paid transcription).
- **14. Ownership and order.** Codex first ships transcript provenance (Zoom file identity captured at import, `audioSha256`, frozen per publication and carried through corrections) with the import file-ID binding fix, then the discussion-exclusion policy and attendance checklist. Claude owns Stage 4 (mapping, processing, verification, split jobs, approval, Board eligibility) and runs the Sandbox pilot meanwhile. Shared files have one editor at a time: `bundle.js`, `import-service.js` and `zoom_recording_imports` are Codex's until the provenance slice merges; `presentation-transcript-binding.js` and `RecordingAndTranscriptCard.js` until the policy slice merges. Codex's migration precedes the split-job migration; numbers are claimed at build time.
**Decided (owner, Session 591), coordinating with Codex's attendance slice (`/tmp/zoom-stage4-attendance-coordination.md`):**
- **15. Fewest sessions and clicks; minimum regeneration** is the guiding principle. Duncan confirms the presentation end and the attendance list in one correction, published once, so derived outputs (transcripts, summaries, video) are generated once. Decision 11 stands: later edits are rare.
- **16. Record the MP4's recording times.** Stage 4 adds `recording_start`/`recording_end` to `zoom_video_copies`, written at copy time; the same-source check requires them to equal the audio file's. Copy rows from before the change (1003222's included) block until re-copied.
- **17. Migrations:** 078 is Codex's attendance/policy slice; **079 is Stage 4** (split-job table plus the decision 16 columns). Codex's provenance slice merged as 077 (`f3cc08540`).
- **6 (venue), status.** Azure availability is pending an IT ticket (Dragonfly) with no quick answer expected. The first benchmark therefore targets Vercel Sandbox, per the research doc's fallback.

1. **Outputs.** Accepted UX items 5 and 7 (`MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md:30-33`) call for a presentation video **and** a staff-discussion video, plus "Not recorded" when nothing follows the boundary. Stage 5 later deletes the discussion video. Recommendation: build the presentation video first; add the discussion video only if staff need a separate discussion file beyond the full Recording, which they already have until the Stage 5 deadline.
2. **Cut point and tolerance.** `presentationEnd.endMs` is the end of the last presentation utterance on the transcript timeline (`bundle.js:37-53`). The next utterance starts later. Options: cut exactly at `endMs`; cut at `endMs` minus a safety margin (loses a moment of presentation, never leaks); or cut in the silent gap before the next utterance. Recommendation: cut at `endMs`, and reject the output unless verification shows no audio or video after `endMs` plus 0 ms (see "Processor contract").
3. **Eligible sources.** The cut needs proof that the transcript and the video come from the same recording (see "Same-source proof"). Recommendation: v1 splits only a Zoom-copied Recording whose transcript came from a Zoom import of the same meeting. A staff-uploaded MP4, or a transcript from uploaded audio, shows a named reason ("The transcript was not made from this video") and no split.
4. **Source fingerprint.** The copied Recording row has no content hash (`material-service.js:1336-1352` sets version ID, eTag and size only), and `zoom_video_copies.sharepoint_quickxor_hash` was never written. **Decided (owner, Session 590): add the write.** Merged 2026-10-09 (`306ba183f`): the worker records Graph's quickXorHash at registering, best effort. The split freezes it as its source fingerprint.
5. **Automatic or on request.** Options: split automatically once a boundary is confirmed and the video is copied, or only when staff click **Create presentation video**. Recommendation: on request in v1, because each run costs processing time or money.
6. **Venue.** Pending Codex research. Owner approval is needed if the recommended venue sends applicant or staff-discussion bytes to an outside processor.
7. **Dataverse vocabulary.** No artifact-type value exists for a presentation video (`shared/config/requestDocument.js` ends at 100000013). The owner adds the picklist value in Dataverse first, as with 100000010 in Stage 2; the code never guesses a value.

## What exists [VERIFIED 2026-10-09 via source reads]

- **Boundary.** `presentationEnd = { endMs, confirmedBy, confirmedAt }` lives in the TRANSCRIPT row's manifest (`wmkf_transcriptbundlejson`); `endMs` must equal an utterance end (`bundle.js:44-53`). `confirmedPresentationEnd` reads it, failing closed on a malformed manifest (`presentation-transcript-binding.js:77-87`).
- **Transcript split.** `presentationContent` / `staffDiscussionContent` partition utterances by `end <= endMs` (`presentation-boundary.js:87-105`). The derivatives bind by `derivativeGenerationKey(type, requestId, sourceRevisionId, presentationEndMs)` (`presentation-transcript-binding.js:30-36`); a key mismatch is `stale`, and outside readers withhold stale rows.
- **Source video.** Stage 3b registers the copied MP4 as the request's `RECORDING` (100000005) winner, staff-only. The Board page and briefing never select `RECORDING` (`presentation-page-service.js:30`, `briefing-page-service.js:98`; verified live on 1003222's Board page).
- **Transcript-to-meeting link (Postgres only).** A fresh publication's `revisionId` equals its `operationId` (`meeting-tracker-transcription/service.js:306-308`). `meeting_transcript_publications.operation_id` → `input_job_id` (`063_meeting_tracker_transcription.sql`) → `zoom_recording_imports.transcription_job_id` → `zoom_meeting_uuid`, which `zoom_video_copies.zoom_meeting_uuid` also carries. The transcript manifest itself records no meeting or audio-file identity (`bundle.js:18-19`).

## Same-source proof [PLANNED; revised Session 591, decision 12]

Before any cut, the split service reads the current transcript's provenance through Codex's server-only resolver (outcomes `verified_zoom`, `upload`, `legacy_unknown`, `invalid`; merged in `f3cc08540`) and requires:
1. `verified_zoom` with a verified `audio_only` file. Uploaded audio, unknown or invalid provenance blocks with a named reason. (Corrections carry the frozen provenance, so no walk of the `source_revision_id` chain is needed; corrections publish with `input_job_id` null [VERIFIED `063_meeting_tracker_transcription.sql:27,30,74`, `service.js:446,504`].)
2. The current RECORDING winner is the registered result of a `copied` `zoom_video_copies` row for the same request and meeting occurrence (`zoom_meeting_uuid`).
3. Exactly one audio file (`zoom.audioOnlyFileCount === 1`) and one copied MP4 that is not segmented, with the MP4's recorded start and end (decision 16) equal to the audio file's. Segmented meetings block. The provenance seam is `resolveCurrentMeetingTranscriptSource` (`meeting-tracker-transcription/service.js`, merged `f3cc08540`).

The cut is `endMs` taken directly on the MP4 timeline (identity mapping, measured on 1003222's real pair below). The staff listen to the ending (decision 8) is the safeguard against a misplaced cut. Any failure shows a named reason and no split.

## Frozen identity and binding [PLANNED]

- **Input identity:** request, the content-free provenance projection (Codex's `sourceProvenance`), transcript `revisionId`, `presentationEnd.endMs`, source Recording document id, its SharePoint drive/item/version, its size, and (after decision 4) its quickXorHash.
- **Generation key:** extend `derivativeGenerationKey` with the source-video identity, one key per output type.
- **Binding:** a `bindPresentationVideo` mirroring `bindPresentationTranscript`'s reasons (`bound`, `missing`, `stale`). A changed boundary, transcript revision or source video makes the output stale, and outside readers withhold it at once, on both listing and `open` routes.

## Durable job [PLANNED]

- A new table (migration 079, reserved; decision 17) modeled on `zoom_video_copies`: one active split per request, lease and fence, attempt caps, cancel, terminal states without leases, and the frozen input identity.
- Output upload: reuse the origin-marked MP4 upload intent (`presentation_material_uploads`), which needs a new `origin` value. Its CHECK admits only `browser` and `zoom_copy` (migration 076), and the origin-isolation predicates must be extended. Alternative: a separate output ledger. Decide in the build plan.
- Registration goes through the single `createDocument` in `material-service.js` (the `request-document-writers` gate), with the slot fence.

## Processor contract (venue-independent) [PLANNED]

- **Input:** a read handle on the exact source bytes (frozen identity), the cut time on the MP4 timeline, and the output spec (container, codec).
- **Output:** the file(s) plus a verification report: output duration, last video frame timestamp, last audio sample timestamp, and the source offset used.
- **Acceptance:** the service rejects any output whose last audio or video timestamp exceeds the cut time, or whose duration differs from the expected length by more than a tolerance. Rejection blocks Board publication with a named reason.

## Outside readers [PLANNED]

- Add the presentation-video type to the explicit allowlists in `presentation-page-service.js` and `briefing-page-service.js`, behind `bindPresentationVideo` and the staff approval (decision 8). This is a deliberate reviewed edit.
- Tests inject the full Recording and an unapproved or stale presentation video and prove both are excluded at listing and open.

## Output and cut [PLANNED, decisions 1-2]

- **Presentation video only:** source time 0 to the cut (`endMs` mapped onto the MP4 timeline, see "Technique and verification"). Board-eligible once bound, verified and approved by staff (decision 8).
- No discussion video. This supersedes accepted UX items 5 and 7 of the October 7 workflow plan for video; the transcript side still produces both halves.

## Technique and verification [PLANNED, from Codex research]

See `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md` and the benchmark scripts under `scripts/benchmarks/stage4-*`.
- Full re-encode of each kept span from decoded frames and samples; naive stream copy is a negative control only.
- The cut on the MP4 is `endMs` taken directly (decision 12). The anchor mapper researched by Codex is not used in v1.
- Two acceptance checks: no source content from after the cut is used, and no output stream plays past it. Duration alone proves neither; AAC padding, edit lists and extra tracks are checked explicitly.
- The lineage record gains a mapping version and a verification receipt.
- **Audio recipe (Codex synthetic follow-up, `STAGE4_SYNTHETIC_RESULTS_2026-10-09.md`, branch commit `97b8feb66`):** decode audio onto a common zero-based clock (inserting leading silence for a late start), trim there, write only the kept samples to an isolated PCM file, and encode AAC from that file alone, so no post-cut sample is ever encoder input. Video keeps source-clock timestamps. The AAC tail is accepted only if the output's audio packets exactly match an independent encode of the same isolated PCM; there is no millisecond tolerance.
- **Sync checks:** each decoded video frame's timestamp agrees with its source frame, and each audio frame follows a continuous sample clock from zero; both decode paths (with and without MP4 edit lists) must agree.
- **Local research closed (owner, Session 590, 2026-10-09): promising with documented limitations.** Evidence: `STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md`, `STAGE4_MAPPING_CAPACITY_RESULTS_2026-10-09.md` and `STAGE4_SYNTHETIC_RESULTS_2026-10-09.md` (merged to `main` in `228a97b5b`, research tip `418e85594`). Four separate-M4A mapping cases (offset, pause, drift, negative offset) mapped within one 16 kHz sample and passed the export checks; 80 ppm drift over 85 minutes was recovered within about 4 microseconds; ambiguous mappings (heavy noise, two gaps, an anchor on a gap) were rejected rather than guessed; extra streams, private metadata and hidden container bytes were stripped or rejected; 1080p text stayed readable. Local timing: 60 minutes of 1080p encoded at 4.34x real time on two laptop threads, not a cloud estimate. The historical strict matrix stays recorded as not passed.
- **Accepted limitation (owner):** Apple's decoders sometimes omit about 4-21 ms of retained presentation audio at the very end. This is lost presentation, not leaked discussion; it is a quality limitation, not a blocker. Reopen only if real playback shows an objectionable ending, material truncation, a sync failure or a privacy concern.

## Acceptance and release gates [PLANNED]

Hard gates (privacy and correct-file publication); gates 2-4 cannot be waived by staff approval:
1. **Relaxed (owner, Session 591, decision 12).** The same-source metadata check passes ("Same-source proof"); the cut is `endMs` on the MP4 timeline. Mapping is not measured, and the staff listen (decision 8) is the safeguard against a misplaced cut. Previously: the mapping was measured from several anchors, the cut moved earlier by the uncertainty up to 2 s, and staff approval could not waive this gate.
2. Only pre-cut samples and whole pre-cut video frames reach the encoder (isolated PCM recipe above); only the selected H.264 and AAC streams are written, with extra tracks and metadata removed; unsupported output structures are rejected.
3. The automated checks (payload equality, frame and sample clocks, container scan) pass before the video is offered for staff review.
4. Board eligibility binds the exact file staff approved: source identity and quickXorHash, transcript revision and boundary, mapping version, output hash and SharePoint version, the verification receipt and the approval. Any change to those inputs, or to the output, during or after processing makes the video ineligible, at listing and at `open`.

Quality (documented, not blocking): the Apple tail limitation above; staff listening to the ending (decision 8) is the check.

## Focused validation results [Session 590, local generated media]

Part 1 (`scripts/benchmarks/stage4-focused-check.py`, evidence `docs/plans/STAGE4_FOCUSED_EVIDENCE_2026-10-09.json`): the Codex mapper (`stage4-mapping-check.py`, fixed anchors every 10 s, 0.25 s windows, both channels within 2 samples, any silent or weak anchor blocks the whole mapping) **blocks speech-like audio**. Speech-like (3-5 Hz syllables, 0.2-2 s pauses): blocked at the first anchor (silent window). Quiet second channel: blocked (channels disagree). 20 s silence over two anchors: blocked. The same audio with 10 dB noise mapped exactly, only because noise filled the pauses. Fail-closed, so nothing leaks, but as written the mapper would block almost every real recording.

**Design change considered: adaptive anchor selection** (superseded for v1 by the real-pair result below). Search a few seconds around each target time for the most energetic, distinctive window; use 1-2 s windows; correlate a mono mix or the louder channel; skip anchors in long silences and block only when too few good anchors remain or none lie near the cut. Held-out validation, the residual ceiling and the 2 s uncertainty rule are unchanged. Also [ASSUMED]: Zoom's M4A and the MP4's own audio come from one recording, so the measured offset may be zero; a real pair settles it. VFR video and browser ending playback are not yet run.

**Real pair, owner-approved (Session 590; evidence `docs/plans/STAGE4_REAL_AV_PAIR_EVIDENCE_2026-10-09.json`, media deleted after measurement).** For 1003222's Oct 8 10:46 meeting, the Stage 3b MP4's audio track is **byte-identical** to Zoom's `audio_only` M4A: all 157,533 AAC packets match (frame MD5, 0 differences), the decoded PCM MD5 matches, both start at 0 with equal edit lists and duration 3,360.704 s. Video is constant 25 fps (all 84,017 intervals 40 ms); the MP4 also carries one `bin_data` data stream (3 frames), which the recipe strips. [VERIFIED for one meeting; other meetings ASSUMED until checked per recording.]

**Resolved (owner, Session 591, decision 12):** v1 uses the identity mapping with the metadata check above and no packet proof; options (1) and (2) below are not built. Original analysis follows.

**Consequence [superseded]:** for the eligible path (decision 3), the transcript-to-video mapping is the identity, proven exactly by audio packet equality, not estimated by correlation. The cut is then `endMs` directly (rounded down to a whole frame and AAC sample, as before), with no mapping uncertainty. The adaptive correlation mapper becomes a fallback that v1 does not need; a mismatch blocks the split. The proof needs the transcribed audio's identity at split time, but `transcription_jobs.audio_sha256` is cleared when job content is purged (`lib/services/transcription-pilot/store.js:1992`, `:2025`). Options: (1) at Stage 3a import, store a content-free digest of the M4A's audio packets on `zoom_recording_imports` (durable; small migration), and at split time compute the same digest from the MP4's audio and require equality; or (2) at split time re-download the M4A from Zoom by its recorded file id and compare packets, relying on Zoom file immutability and availability. Recommendation: (1).

## Next steps before the build plan [PLANNED]

1. **Focused validation on generated media:** variable frame rate, and the ending on the intended playback paths (browser and the SharePoint viewer). The anchor-mapping cases (speech-like audio, pauses, delayed audio) are dropped with decision 12. Not an open-ended codec study.
2. **Done (Session 591): synthetic Vercel Sandbox pilot passed, about $0.22 of the cap; results `STAGE4_SANDBOX_PILOT_RESULTS_2026-10-09.md`. Ending playback in browser and SharePoint viewer still pending (step 1).** Original scope: synthetic Vercel Sandbox pilot within the $10 incremental-compute cap: confirm the app's region, current pricing and how the cap is enforced before dispatch; persistence off, no media snapshots, independently verified cleanup. Measure a full-length presentation (runtime, scratch, readability, ending), and test interruption, insufficient disk, failed or partial upload and failed cleanup; anything incomplete stays unpublished.
3. **Ask Justin before the first real input** (1003222's copied video, any paired audio scoped explicitly), with the pilot results and the applicable Vercel data-processing terms. Isolated staff-only test folder; no new Zoom read; no Board registration. A longer recording follows only after that passes.
4. **Correct-file safeguards are built and tested in the application** (gate 4): retries, concurrent changes, upload reconciliation, approval, and Board listing and `open` paths. Required before Board use, not before the pilot.

## Card [PLANNED]

The card's "Results" step gains a Video line under **Presentation** only: status (not started, working, ready for review, approved for the Board, stale, failed with reason) and Open for staff. The presentation video adds **Check the ending and approve** (decision 8). One **Create presentation video** action (decision 5) starts it after the boundary is confirmed and the source is eligible (decision 3).

## Stage 5 hooks [PLANNED]

Stage 5 deletes the full Recording, the full transcript and discussion content at the Board deadline. The presentation video's binding must stay valid after that, so the lineage record (input identity including a copy of the provenance projection, boundary `endMs` with `confirmedBy`/`confirmedAt`, output identity, verification report, approval) must be content-free and must not require the full-source bytes to exist. This needs the `presentation-transcript-binding.js` / `bundle.js` change named in the workflow plan (`:112`); Stage 4 must not foreclose it.

## Gates this work will hit

`check:api-routes` (new routes and matrix rows), `check:atlas` (new table page, `wmkf_requestdocument` page), `check:request-document-writers`, the scheduled-job census if a cron is added, `check:status-enum-parity` for new state/label maps, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, and `check:migrations-manifest`.

## Process notes

- Before the build plan: run `/contract-reconcile` Mode A on this design.
- This file and Codex's research doc are separate files under `docs/plans/`. `docs/DOCS_CATALOG.md` covers top-level `docs/*.md` only (`check:docs-catalog`, 2026-10-09), so the two branches do not collide there.
