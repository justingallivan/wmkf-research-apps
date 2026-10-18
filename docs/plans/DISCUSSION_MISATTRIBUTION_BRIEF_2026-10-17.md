---
title: Discussion misattribution brief (departed applicants named on staff turns)
domain: transcription
kind: plan
status: active
summary: "Diagnosis and proposed fix for staff discussion turns attributed to departed applicants (1003020, 1003038): the attendance leaver hint compares to the presentation end, which applicants leave seconds after, and voice-to-attendee linking is exact/case-sensitive. Brief for Codex, 2026-10-17 (Claude S615); Codex owns the fix."
owner: product-engineering
related:
  - docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md
  - docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md
  - lib/services/meeting-tracker-transcription/attendance-service.js
  - lib/services/meeting-tracker-transcription/presentation-boundary.js
  - lib/services/post-presentation-materials/discussion-sentiment-service.js
---

# Brief for Codex: staff discussion turns attributed to departed applicants

Author: Claude (Session 615 worktree, `claude/session-615`, read-only probes on 2026-10-17 PT).
Status: handed to Codex 2026-10-17; Codex is correcting the transcripts and sentiment runs. The probe scripts named below lived only in the Session 615 scratchpad and are not portable; the findings are summarized here.
Owner: Justin. Audience: Codex, who is building the fix.
Evidence: two owner-run read-only probes against Production. Scripts and JSON output are in
`/private/tmp/claude-501/-Users-gallivan-Code-WMKF-Apps/e32874b5-8194-4ba0-9a31-8817a251a0c7/scratchpad/`
(`probe-d26-discussion-speakers.mjs`, `d26-discussion-speakers.json`, `probe-attribution-decisions.mjs`).
No transcript wording was read or stored; only names, ids, counts and times.

## 1. What the owner saw

The Discussion Sentiment records for Requests **1003020** and **1003038** quote staff remarks under
applicant names. The applicants had left the Zoom meeting; the words were staff words.

## 2. Mechanism [VERIFIED via source + probe]

- The applied speaker-name map is recording-wide: diarization speaker id → name. The staff discussion
  slice is every utterance ending after the confirmed presentation end
  (`presentation-boundary.js` `staffDiscussionContent`).
- `discussion-sentiment-service.js` never lets the model name a speaker. `rebuildTurns` /
  `attachSpeakers` derive `speaker` from the matched turn's id via the name map. So a staff turn that
  the diarizer put into an applicant's id cluster carries the applicant's name into the evidence.
- The designed safety net is the frozen discussion attribution decision
  (`attendance-service.js` `buildAttendanceReview`, confirmed by staff, applied by
  `resolveDiscussionAttribution`, which marks excluded ids `unidentifiedSpeaker` after the boundary;
  sentiment then stores `speaker: null`). It is correct when an id is excluded. The failure is that the
  applicant ids were not excluded.

## 3. Why the ids were not excluded [VERIFIED via decision records]

All three decisions below were fetched after `94540f706` (2026-10-11, "attendance rows hinted as leaving
early start unchecked"), so the leaver hint was live. Zoom attendance status was `complete` with one
aligned audio file in every case. The hint fired exactly once across the three (the "WM Keck Foundation"
host entry on 1003038, which left 44 minutes before the boundary).

| Request | Boundary (wall clock) | Applicant attendee | Zoom leave | Linked voice id | Hint result |
|---|---|---|---|---|---|
| 1003020 | 17:30:24 | Ted Abel, Director, Iowa Neuroscience Institute | 17:30:27 | none (voice "Ted Abel and Team", id A, is a separate unlinked `voice` row, `lastLeaveAt: null`) | could not fire |
| 1003038 | 18:02:17 | jingli | 18:02:19 | C | did not fire: left 2 s *after* boundary |
| 1003038 | 18:02:17 | evaan | 18:13:32 | none (voice "Evaan", id A, unlinked: case differs) | could not fire |
| 1002874 | 17:20:36 | Kim Kruse, UF CFR | 17:21:36 | F | correctly kept; see §6 |

**Cause A: the hint tests the wrong instant.** `leftBeforeEnd` requires
`lastLeaveAt < recordingStart + endMs - 10000`. The boundary is by definition the end of the last
applicant utterance, and applicants leave *after* their last words (2 s, 3 s, 5 s, 60 s in the cases
above). The rule is structurally unable to catch the normal case.

**Cause B: voice-to-attendee linking is exact and case-sensitive.**
`speakerNames[id] === display.get(person.name) || speakerNames[id] === person.name`. "Evaan" vs "evaan"
and "Ted Abel and Team" vs the registered attendee name both failed, so those voices became `voice`
rows with no leave time and nothing to hint on.

**Staff share:** the review listed every row checked; a careful reader could have unchecked jingli
(leave time shown). With the hint silent on every applicant, that is a reasonable miss, not the primary
fault.

## 4. Scope across D26 [VERIFIED via probe, 23 real requests; 1003222 is the ZZTEST-03 fixture and excluded]

- 22 of 23 decisions exclude nobody; 1002860 excludes one voice.
- Applicant-side voices after the boundary with substantive turns: 1003038 (Evaan 4 turns / 66 words,
  jingli 4 / 59), 1003020 (Ted Abel and Team 1 / 44). 1002835 has a voice named "Unknown, not relevant"
  (3 / 42) worth a look.
- PI / co-PI stray lines after the boundary (1–15 words): 1002916, 1002926, 1002959, 1003000.
  Same mechanism in miniature.
- Foundation-side names the system cannot match (Zoom handles / variants, not applicants): allisonkeller
  (6 visits), jeconomou / James Economou, Edward Stolper, Jack Harris, Amy Rowat, "beth pruitt",
  "John E Sader". Not a bug in attribution; relevant because candidates come only from the saved
  invitation + PI/co-PI, never the staff directory, and matching is whole-name exact. Do not build a
  "never attribute to outside voices" guard on that classification.

## 5. Proposed solution

1. **Per-turn departure rule (replaces Cause A).** In `buildAttendanceReview`, compute for each
   discussion speaker id whether any of its after-boundary utterances *starts* after the linked
   attendee's `lastLeaveAt` (wall clock = `recordingStart + utterance.start`, same alignment guard as
   today). Hint-uncheck that row. Keep the existing "left before boundary" case as a subset. Consider
   a small tolerance (Zoom leave timestamps are whole seconds).
2. **Normalize linking (fixes Cause B).** Match voice names to attendee names with the same folding
   the boundary uses (`trim`, collapse whitespace, case-fold), and also try `zoomDisplayNames` output
   both ways. Keep the shared-microphone rule (an id linked to more than one attendee stays a `voice`
   row).
3. **Surface unlinked voices.** A `voice` row with no leave time deserves a visible "no attendance
   match" marker in the review so staff know the hint cannot help there.
4. **Resolution at analysis time, not only at review time (optional hardening).** Since the frozen
   decision already carries `lastLeaveAt` per row, `resolveDiscussionAttribution` could also flag
   after-boundary utterances whose linked attendee had left before the utterance start, independent of
   the `kept` flag. This protects summaries and sentiment even when a stale decision is kept. If adopted,
   `rebuildTurns` must still reproduce the TXT exactly (the sentiment quote check depends on it), so
   either regenerate the discussion TXT under the new resolution or apply the flag only where the TXT
   was built with it.
5. **Do not drop turns.** Misattributed turns are staff speech; mark them unidentified (`speaker: null`,
   label "Unidentified speaker") as today's exclusion path does.
6. **Remediation for the two affected records.** After the fix, re-run the attendance review for
   1003020 and 1003038 (it will now hint the applicant voices), reconfirm, regenerate the discussion TXT,
   and re-run sentiment. The owner may be able to name the real staff voice; do not infer it.

## 6. Test cases

- **Positive:** 1003038 shape: linked attendee leaves 2 s after boundary; after-boundary turns at
  +43 s onward → hinted unchecked.
- **Positive:** 1003020 shape: voice name "X and Team" vs attendee "X, Director, ..." → after
  normalization still unlinked (names differ substantively) → shown as "no attendance match";
  Cause-B case "Evaan"/"evaan" → linked and hinted.
- **Negative control (must stay kept):** 1002874 Kim Kruse: linked attendee, 4 turns 17:20:50–17:21:33,
  leaves 17:21:36. Every turn starts before departure → not hinted.
- **Existing:** host/organizer entry that left long before the boundary still hinted (1003038 "WM Keck
  Foundation").
- Mutation check: a rule comparing to the boundary instead of per-turn start must fail the 1003038 case.

## 7. Discrepancy to be aware of

Zoom reports "evaan" in the meeting until 18:13:32 on 1003038, which is exactly the end of the last turn
attributed to Evaan. The participant's connection was open during the staff discussion. Whether Zoom's
per-participant audio or the diarizer produced the attribution is not determined by these probes; the
fix above handles the jingli shape (departed before the turns). For the Evaan shape (connection still
open), only the "Unknown voice" marker and manual exclusion apply unless the owner confirms the
participant had actually left on a different device; confirm with the owner before relying on the
per-turn rule for that record.
