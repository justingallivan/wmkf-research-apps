---
title: Zoom attendance and discussion speaker attribution
kind: plan
domain: transcription
status: branch-built-not-deployed
summary: "Branch-built attendance and discussion attribution in one boundary correction; migration 078 remains unapplied and requires owner application before merge. Offline acceptance and recovery verification are recorded below."
owner: product-engineering
related:
  - docs/plans/ZOOM_TRANSCRIPT_PROVENANCE_PLAN_2026-10-09.md
  - docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md
  - lib/services/meeting-tracker-transcription/presentation-boundary.js
  - lib/services/meeting-tracker-recordings/zoom-client.js
---

# Zoom attendance and discussion speaker attribution

**[BRANCH-BUILT, 2026-10-09; NOT DEPLOYED.]** Implementation is on `codex/zoom-attendance`; migration 078 is not applied. Claude orchestrates; Codex implements in `/Users/gallivan/Code/WMKF_Apps-codex-labels` on a branch cut from current `main`. This plan supersedes the field-level proposals in `/tmp/zoom-attribution-plan.md` and `/tmp/zoom-attribution-shared-contract.md` (historical, outside the repo). Codex's wind-down handoff is `/tmp/zoom-attendance-codex-handoff.md`.

## Outcome

1. Duncan confirms the presentation end in the transcript correction, as today.
2. In the **same step** (decision D1), he sees everyone who was admitted to the meeting, including people who never spoke. Each person has a checkbox, checked by default.
3. He unchecks people who left before the discussion, then publishes once.
4. In the published discussion output, turns by an unchecked person read **Unidentified speaker**. The words and timestamps are unchanged, and nobody is renamed globally.

The presentation half, the presentation end and the Stage 4 cut are unaffected.

## Owner decisions (Session 591)

- **Guiding principle:** staff finish in as few sessions and clicks as possible, with minimum regeneration.
- **D1:** the presentation end and attendance are confirmed in one correction and published once. Transcripts, summaries and the video are each generated once, after that publication.
- **D1a:** a later revision still makes the Stage 4 video go stale (Stage 4 decision 11). Later edits are rare.
- **No staff-only allowlist:** consultants and phone participants may legitimately stay.
- **"Unidentified" is acceptable** when identity is uncertain.
- **D4:** this slice owns migration **078**. Stage 4 owns 079.

## Zoom report facts [VERIFIED 2026-10-09]

Source: an owner-run, read-only, shape-only run of `node scripts/probe-zoom-recordings.mjs --attendance` against one 85-minute meeting of the approved host, using the Meeting Tracker's own Server-to-Server app. No names, IDs or times were printed.

- **Scopes.** The app's token is already granted `report:read:list_meeting_participants:admin` and `meeting:read:list_past_participants:admin`. No Zoom settings change is needed.
- **Endpoint.** `GET /v2/report/meetings/{uuid}/participants`, with the UUID double-encoded when it contains `/` (as `zoom-client.js:157` already does). It returns `next_page_token`, `page_count`, `page_size`, `participants` and `total_records`. Pagination works: a `page_size=2` call returned a token. Use `page_size=300` and bound the number of pages.
- **Row fields.** Each row has `name`, `join_time`, `leave_time`, `duration`, `status`, `user_id`, `id`, `participant_user_id`, `user_email`, `customer_key`, `groupId`, `failover` and `attentiveness_score`.
  - `past_meetings/{uuid}/participants` returns the same rows minus `participant_user_id`, `customer_key` and `attentiveness_score`, plus `internal_user` and `registrant_id`. Use the report endpoint, because it carries `status`.
- **No stable identity for guests.**
  - `id`, `participant_user_id` and `user_email` were present only on the signed-in host row (1 of 19); the other rows had them empty or null.
  - `user_id` is a different number on every row: 19 distinct values, and 9 names span more than one value. It identifies a join session, not a person.
  - **The only usable grouping is the display name.**
- **Repeated names are the waiting room.** The 19 rows split into `in_meeting` ×10 and `in_waiting_room` ×9 across 10 names: each guest has a waiting-room row and then an admitted row. No reconnect occurred in this meeting, so how reconnects appear is still [ASSUMED unknown].
- **Times.** `join_time` and `leave_time` are whole-second UTC. `duration` equals `leave − join` in **seconds** on all 19 rows.
- **Recording offset.** The first join was **884 s before** the `audio_only` file's `recording_start`. Attendance time must be measured from the provenance `audioFile.recordingStart`, never from the meeting start.
- **Not observed:** phone or dial-in participants (no phone-like names in this meeting), how long after the meeting ends the report becomes available, and the meaning of `groupId` (5 of 19 rows carried one).

## Design [Q1-Q4 decided by Justin, Session 591]

### People list

- Fetch the report server-side, by the frozen `sourceProvenance.zoom.meetingUuid` only. Never fetch by a browser-supplied UUID or by the request's newest import. Legacy, upload and invalid provenance gets no attendance (see fallback).
- Group rows by **exact display name**. A person is listed only if they have at least one `in_meeting` row. Their presence interval is from the first admitted join to the last admitted leave.
- **Q3 (decided):** people who were only ever in the waiting room are not listed. One line shows how many there were.
- The host row is listed like anyone else. Nobody is excluded by role.
- Name collisions (two people with one display name) merge into one row. Renaming mid-meeting splits a person into two rows. Both are accepted limitations; Duncan sees what Zoom recorded.

### Linking people to transcript speakers

- Published speaker names come from Zoom VTT reconciliation, so they are Zoom display names wherever Zoom named the speaker. They are *display-transformed*, though: `zoomDisplayNames` reorders "Surname, Given" to "Given Surname", and keeps the original when two distinct Zoom names would collide [VERIFIED `lib/services/transcription-pilot/zoom-vtt.js:395-430`]. Staff may also have renamed a speaker in an earlier correction.
- **Rule:** compute the attendees' display forms with the same `zoomDisplayNames` over the attendance name set. An attendee is linked to every discussion speaker ID whose current name equals either that display form or the raw Zoom name, exactly. The link is computed when the checklist is shown and frozen in the confirmation. A speaker renamed by staff to something else falls into "Other voices".
- Discussion speaker IDs that match no attendee are listed in a short second group, "Other voices in the discussion", also checked by default. That covers diarization labels such as "Speaker C" and shared microphones.
- **Q1, shared microphone (owner reaffirmed after review):** no manual shared-microphone split. A speaker ID automatically linked to more than one attendee is controlled only by its own "Other voices" row; unchecking either attendee has no effect on that ID. Unchecking the voice excludes everyone on it. Attendance cannot infer who used a microphone.
- Silent attendees need no speaker ID: unchecking them changes nothing in the output. Their row still records Duncan's confirmation.

### Effect on the output

- `excludedSpeakerIds` is the sorted, unique set of speaker IDs linked to unchecked rows, plus unchecked "other voices" IDs.
- One pure function runs after speaker reconciliation and before formatting. For discussion turns only (the existing `staffDiscussionContent` rule, `presentation-boundary.js:99-104`), it renders an excluded ID as **Unidentified speaker**. Separate underlying IDs stay separate turns.
- Presentation turns, `speakerNames`, `proposePresentationEnd` (`presentation-boundary.js:63`), timestamps and segmentation never change.
- Every consumer uses the same resolved output: preview, TXT/VTT, the discussion derivative and the summary inputs.

### Time hints (D2, Codex tunes it conservatively)

- Show each person's last leave time in the meeting's local time.
- Mark "left before the presentation ended" only when all three hold:
  - `audioOnlyFileCount === 1`;
  - `|(recordingEnd − recordingStart) − audioDurationMs| ≤ 2 s`;
  - the leave time is more than 10 s before `recordingStart + endMs`.

  Otherwise show no hint. Hints never uncheck anyone automatically: everyone starts checked, per Justin.

### Fallback

- **Q2 (decided):** when attendance is unavailable (legacy or upload source, report error, incomplete pages), the same step shows only the "voices in the discussion" list with an explanatory line, so Duncan can still exclude speaker IDs in the same click flow. Missing attendance is never treated as "nobody attended".

### Persistence and versioning (migration 078)

- **Draft:** the attendance decision is saved with the existing version-checked correction draft, alongside `presentationEnd`. Changing the boundary, renaming speakers or changing the source invalidates the confirmation server-side, and publishing requires a current confirmation.
- **Publication:** the frozen decision goes into the new source envelope, so a correction's `inputSha256` and revision change, and derivative staleness works as today. It also goes into a receipt column for recovery comparison.
  - Envelope fields: `version`, the per-row `displayName`, `kept`, `speakerIds`, `excludedSpeakerIds`, `attendance.status` (`complete`, `partial` or `unavailable`) and `fetchedAt`.
  - **Q4 (decided):** store no raw rows, emails, `user_id` values or intervals beyond the one last-leave time shown. The decision is deleted with the full transcript at Stage 5.
- **Versioning:** a new formatter and schema version (7). Versions 1–6 reject the new field and stay byte-identical. The transcription pilot shares the formatter constant, so its output must be proven unchanged.
- **Provenance and video lineage:** the content-free provenance and the Stage 4 video lineage never carry attendance.

## Ownership and order

| Surface | Owner |
|---|---|
| `zoom-client.js` (report call), a new attendance service, the authenticated attendance route under the Meeting Tracker namespace plus its API matrix row | Codex |
| `bundle.js`, `transcript-format.js`, `presentation-boundary.js` (the resolver), `meeting-tracker-transcription/service.js`, migration 078, the Atlas pages | Codex |
| `RecordingAndTranscriptCard.js`, the attendance section of the presentation-end step | Codex first; Stage 4's Video line after this merges |
| Stage 4 (migration 079, video-copy times, split jobs, processor, binding, allowlists) | Claude, in parallel on separate files |

Claude reviews each Codex task, runs the gates and hands Justin the merge. Migration 078 is applied to Production by Justin before the merge, as with 077.

## Acceptance tests (minimum)

- An excluded ID with turns both before and after the boundary: only the discussion turns change.
- Exclusion never moves the proposed or confirmed boundary.
- No `speakerNames` mutation.
- A silent attendee who is unchecked: the output is unchanged and the decision is recorded.
- An "other voices" ID unchecked.
- Waiting-room-only rows hidden.
- Duplicate display names merged.
- Pagination across pages, and an incomplete pagination shown as `partial`.
- Legacy, upload and invalid provenance falling back to the voices list.
- A stale or replayed confirmation rejected.
- A rename after confirmation invalidating it.
- Recovery rejecting a policy mismatch.
- v6 transcripts unchanged byte for byte, and the pilot's output unchanged.
- Each core regression fails with its fix reverted.


## Branch implementation and review

[VERIFIED via source and offline Jest, 2026-10-09] The boundary editor loads the
checklist after saving names/end. Publish confirms the checked rows and publishes
once. Checkboxes can also be saved as a version-checked draft. A server-created
review ID and source/name/boundary context prevent replay; any later name/end edit
invalidates the review in SQL. Missing/partial reports show checked discussion
voices. There is no manual shared-microphone control. The automatic multi-attendee
link rule keeps that ID in its own "Other voices" row. Confirmation accepts exactly
`{ reviewId, kept }`; an extra `sharedSpeakerIds` key is rejected. Names and timing
are never rewritten.

Migration 078 adds nullable checklist, draft decision and frozen decision JSONB
columns on the existing publication receipt. The manifest-driven fresh bootstrap
runs that same SQL. No migration, live Zoom call, Production operation, environment
change or paid tool was used. Stage 4 surfaces were not edited. Stage 5 deletion
remains separately owned; frozen attendance must be deleted with the full transcript.

The report is bounded to 20 pages of 300 rows and a 90-second total deadline; repeated tokens, count mismatch,
malformed rows and over-size decision rosters use partial/manual fallback. Last
leave hints require the single-audio/duration/margin checks above. Display uses the
Site Visit IANA zone when present and explicit UTC otherwise; it never silently
uses the browser's zone as the meeting zone.

Pre-change fixtures were generated from base commit `4e970b70f` for all v1–v6
bundle bytes and pilot TXT/VTT. Tests compare those exact fixtures, not two runs of
the new implementation. Fresh read-only review identified a recovery comparison
gap and blocked attendance retry; both were corrected. The full verification
receipt is recorded in [the implementation report](ZOOM_ATTENDANCE_IMPLEMENTATION_REPORT_2026-10-09.md).
