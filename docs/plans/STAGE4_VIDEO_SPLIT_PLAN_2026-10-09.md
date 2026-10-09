---
title: Meeting video split at the presentation end (Stage 4)
kind: plan
domain: transcription
status: draft
summary: "Design outline for cutting the copied Zoom meeting MP4 at the staff-confirmed presentation end into a Board-eligible presentation video only (no discussion video; owner 2026-10-09), approved by staff before Board release, with same-source proof, a frozen source identity, a durable split job and a processor contract. Venue research runs separately on codex/stage4-video-processing-research. Draft: owner decisions open; nothing built."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/postgres-zoom-video-copies.md
---

# Meeting video split at the presentation end (Stage 4)

**[DRAFT OUTLINE, Session 590, 2026-10-09.]** Nothing here is built or approved. This outline turns Stage 4 of `MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md` (`:104-112`) into a design. The processing venue (where the cut runs) is researched separately by Codex on `codex/stage4-video-processing-research` (deliverable `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md`). This document defines what any venue must receive and return.

## Owner decisions

**Decided (owner, Session 590, 2026-10-09):** 1 = **presentation video only** (revised; see below); 2 = cut exactly at `endMs`; 3 = Zoom copy plus Zoom transcript only; 5 = on request. Decision 4 was later decided (add the hash write); 6 and 7 remain open. Original recommendations follow for the record.

**Decided (owner, Session 590, 2026-10-09), after Codex's first research pass:**
- **8. Staff review before Board release.** A staff member listens to the presentation video's ending and approves it before the video becomes Board-eligible. Until then outside readers withhold it.
- **9. Staff access needs no verification.** The full Recording stays available to staff at all times, as today; the review in decision 8 gates only Board release. Staff do not need split versions: they were on the call.
- **1, revised.** Presentation video only. No discussion video is made: staff keep the full Recording until the Stage 5 deadline, when it is deleted and only the presentation video is retained. A discussion file would add a second discussion copy to protect and delete.
- **10. Benchmark (owner, Session 590).** Codex may install FFmpeg locally for synthetic media. Cloud benchmark on Vercel Sandbox with a $10 incremental compute cap, persistence off and verified cleanup, in the app's US region. When the transcript-to-video mapping is uncertain, trim the presentation's end by the measured uncertainty up to 2 s; above 2 s, block for staff review. First real input after synthetic checks pass: 1003222's copied video, with outputs in an isolated staff-only test folder. Defaults not yet confirmed by the owner [ASSUMED]: source resolution, H.264 + AAC at standard quality, same-day turnaround.
- **6 (venue), status.** Azure availability is pending an IT ticket (Dragonfly) with no quick answer expected. The first benchmark therefore targets Vercel Sandbox, per the research doc's fallback.

1. **Outputs.** Accepted UX items 5 and 7 (`MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md:30-33`) call for a presentation video **and** a staff-discussion video, plus "Not recorded" when nothing follows the boundary. Stage 5 later deletes the discussion video. Recommendation: build the presentation video first; add the discussion video only if staff need a separate discussion file beyond the full Recording, which they already have until the Stage 5 deadline.
2. **Cut point and tolerance.** `presentationEnd.endMs` is the end of the last presentation utterance on the transcript timeline (`bundle.js:37-53`). The next utterance starts later. Options: cut exactly at `endMs`; cut at `endMs` minus a safety margin (loses a moment of presentation, never leaks); or cut in the silent gap before the next utterance. Recommendation: cut at `endMs`, and reject the output unless verification shows no audio or video after `endMs` plus 0 ms (see "Processor contract").
3. **Eligible sources.** The cut needs proof that the transcript and the video come from the same recording (see "Same-source proof"). Recommendation: v1 splits only a Zoom-copied Recording whose transcript came from a Zoom import of the same meeting. A staff-uploaded MP4, or a transcript from uploaded audio, shows a named reason ("The transcript was not made from this video") and no split.
4. **Source fingerprint.** The copied Recording row has no content hash (`material-service.js:1336-1352` sets version ID, eTag and size only), and `zoom_video_copies.sharepoint_quickxor_hash` was never written. **Decided (owner, Session 590): add the write.** Built on branch `claude/zoom-copy-hash`: the worker records Graph's quickXorHash at registering, best effort. The split freezes it as its source fingerprint.
5. **Automatic or on request.** Options: split automatically once a boundary is confirmed and the video is copied, or only when staff click **Create presentation video**. Recommendation: on request in v1, because each run costs processing time or money.
6. **Venue.** Pending Codex research. Owner approval is needed if the recommended venue sends applicant or staff-discussion bytes to an outside processor.
7. **Dataverse vocabulary.** No artifact-type value exists for a presentation video (`shared/config/requestDocument.js` ends at 100000013). The owner adds the picklist value in Dataverse first, as with 100000010 in Stage 2; the code never guesses a value.

## What exists [VERIFIED 2026-10-09 via source reads]

- **Boundary.** `presentationEnd = { endMs, confirmedBy, confirmedAt }` lives in the TRANSCRIPT row's manifest (`wmkf_transcriptbundlejson`); `endMs` must equal an utterance end (`bundle.js:44-53`). `confirmedPresentationEnd` reads it, failing closed on a malformed manifest (`presentation-transcript-binding.js:77-87`).
- **Transcript split.** `presentationContent` / `staffDiscussionContent` partition utterances by `end <= endMs` (`presentation-boundary.js:87-105`). The derivatives bind by `derivativeGenerationKey(type, requestId, sourceRevisionId, presentationEndMs)` (`presentation-transcript-binding.js:30-36`); a key mismatch is `stale`, and outside readers withhold stale rows.
- **Source video.** Stage 3b registers the copied MP4 as the request's `RECORDING` (100000005) winner, staff-only. The Board page and briefing never select `RECORDING` (`presentation-page-service.js:30`, `briefing-page-service.js:98`; verified live on 1003222's Board page).
- **Transcript-to-meeting link (Postgres only).** A fresh publication's `revisionId` equals its `operationId` (`meeting-tracker-transcription/service.js:306-308`). `meeting_transcript_publications.operation_id` → `input_job_id` (`063_meeting_tracker_transcription.sql`) → `zoom_recording_imports.transcription_job_id` → `zoom_meeting_uuid`, which `zoom_video_copies.zoom_meeting_uuid` also carries. The transcript manifest itself records no meeting or audio-file identity (`bundle.js:18-19`).

## Same-source proof [PLANNED]

Before any cut, the split service proves:
1. The current TRANSCRIPT winner's revision chain (following `source_revision_id` for speaker-name revisions) [ASSUMED: name edits create a revision with `source_revision_id`; verify] resolves to a publication whose input job came from a Zoom import of meeting *M*.
2. The current RECORDING winner is the registered result of a `copied` `zoom_video_copies` row for the same request and meeting *M*.
3. Offset: the MP4's audio and video start times, and the M4A's, align within a stated tolerance. Same meeting is not proof of equal timelines (`MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md:110`). How to measure this is a research question for Codex.

Any failure shows a named reason and no split.

## Frozen identity and binding [PLANNED]

- **Input identity:** request, transcript `revisionId`, `presentationEnd.endMs`, source Recording document id, its SharePoint drive/item/version, its size, and (after decision 4) its quickXorHash.
- **Generation key:** extend `derivativeGenerationKey` with the source-video identity, one key per output type.
- **Binding:** a `bindPresentationVideo` mirroring `bindPresentationTranscript`'s reasons (`bound`, `missing`, `stale`). A changed boundary, transcript revision or source video makes the output stale, and outside readers withhold it at once, on both listing and `open` routes.

## Durable job [PLANNED]

- A new table (migration 077 or later; number claimed off `main` at build time) modeled on `zoom_video_copies`: one active split per request, lease and fence, attempt caps, cancel, terminal states without leases, and the frozen input identity.
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

See `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md` (branch `codex/stage4-video-processing-research`).
- Full re-encode of each kept span from decoded frames and samples; naive stream copy is a negative control only.
- The cut on the MP4 is `endMs` mapped from the transcript (M4A) timeline using at least three audio anchors, minus the measured mapping uncertainty. Unbounded uncertainty, drift or a pause blocks the split.
- Two acceptance checks: no source content from after the cut is used, and no output stream plays past it. Duration alone proves neither; AAC padding, edit lists and extra tracks are checked explicitly.
- The lineage record gains a mapping version and a verification receipt.

## Card [PLANNED]

The card's "Results" step gains a Video line under **Presentation** only: status (not started, working, ready for review, approved for the Board, stale, failed with reason) and Open for staff. The presentation video adds **Check the ending and approve** (decision 8). One **Create presentation video** action (decision 5) starts it after the boundary is confirmed and the source is eligible (decision 3).

## Stage 5 hooks [PLANNED]

Stage 5 deletes the full Recording, the full transcript and discussion content at the Board deadline. The presentation video's binding must stay valid after that, so the lineage record (input identity, boundary, output identity, verification report) must be content-free and must not require the full-source bytes to exist. This needs the `presentation-transcript-binding.js` / `bundle.js` change named in the workflow plan (`:112`); Stage 4 must not foreclose it.

## Gates this work will hit

`check:api-routes` (new routes and matrix rows), `check:atlas` (new table page, `wmkf_requestdocument` page), `check:request-document-writers`, the scheduled-job census if a cron is added, `check:status-enum-parity` for new state/label maps, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, and `check:migrations-manifest`.

## Process notes

- Before the build plan: run `/contract-reconcile` Mode A on this design.
- This file and Codex's research doc are separate files under `docs/plans/`. `docs/DOCS_CATALOG.md` covers top-level `docs/*.md` only (`check:docs-catalog`, 2026-10-09), so the two branches do not collide there.
