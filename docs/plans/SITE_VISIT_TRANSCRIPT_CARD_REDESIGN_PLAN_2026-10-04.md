---
title: Site Visit recording and transcript card redesign
domain: transcription
kind: plan
status: draft
summary: "Replace the Post-presentation materials card and the Meeting transcription panel on the Site Visit page with one task-oriented Recording and transcript card over the existing one-slot services; UI-only on the write side, with a state-to-copy table and the defects the redesign eliminates."
owner: product-engineering
related:
  - docs/plans/MEETING_TRACKER_TRANSCRIPTION_PLAN_2026-10-01.md
  - docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md
  - docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md
  - docs/atlas/postgres-transcription-pilot.md
---

# Site Visit recording and transcript card redesign

Status: draft for owner discussion after Codex review. Nothing here is built.
Shaped with the Impeccable skill (Operate mode, incumbent "Clear Workbench"
design system in `DESIGN.md`); this is a brief, not component code.

## 1. Problem

The Site Visit page (`pages/meeting-tracker/visits/[requestId].js` via
`shared/components/meeting-tracker/SiteVisitEditor.js`) stacks three cards:
Applicant materials, Post-presentation materials, and Meeting transcription.
The last two overlap and conflict.

**[VERIFIED via `lib/services/post-presentation-materials/material-service.js:2141-2185`
(`publishMeetingTranscriptBundle`) and `lib/services/meeting-tracker-transcription/service.js:276`]**
Both cards write the same Dataverse `wmkf_requestdocuments` TRANSCRIPT row in
the same SharePoint `Site Visit - Transcript` folder, each superseding the
other. The "Transcript · 1003222-Transcript-<uuid>.txt" row in the first card
and "Current published transcript" in the second card are the same file shown
twice. The 2026-10-01 transcription plan chose this on purpose ("do not create a
second competing TRANSCRIPT row"), reused the storage contract, and never
reconciled the UI. Nothing on the page tells the user the two cards are one
slot.

The transcription panel also exposes its internal state machine instead of
the few facts a program director needs (owner words 2026-10-04: GUIDs without
timestamps are "meaningless to a user"; "pretty much everything about that
panel sucks").

Owner-observed symptoms on request 1003222 (screenshot 2026-10-04):

| Symptom | Nature | Evidence |
|---|---|---|
| Transcript appears in both cards with no cue they are one slot | design gap | VERIFIED, §1 above |
| "Current version · ea8e3af6-…" with no date, source, or version number | design gap; the data exists on the TRANSCRIPT row: `materialDescriptor` carries `createdAt` and `slotVersion` (`wmkf_slotversion`); jobs carry filename and ready time. The publication row's `version` is an optimistic-concurrency counter bumped on lease renewals and checkpoints, and a correction row's `createdAt` is its draft-creation time, so neither is revision metadata | VERIFIED `material-model.js:127-130,181-200`, `transcription-pilot/store.js:1368-1431`, `service.js:150` |
| Three stacked amber boxes: "Publication status", "Published", "Published" | bug: `collection.publications` includes correction-draft rows and the label map has no `draft` case, so the draft falls through to the literal heading | VERIFIED `MeetingTranscriptionPanel.js:899-910`, `service.js:149-150` |
| Correction badge says "Draft" while its operation id is the published filename | design gap: the draft is labeled with the corrected transcript's id, not its own (§8) | VERIFIED via probe, §8 |
| Green block lists seven aligned names with confidences; editor fields are blank; footer says "Unsaved speaker-name changes" | component defect: the job holds the names, the component cleared its local draft (§8) | VERIFIED via probe, §8; persistence call `alignment-service.js:184` |
| "Use Jean for Speaker B" sits in the summary, apart from the editor where the pick happens | design gap | SESSION_PROMPT Verified Open §4 |
| Both cards accept a Zoom VTT with different rules: card one scans with Cloudmersive and rejected a plain 81 KB VTT as malware; card two has no scan and a 4 MB cap | design gap plus open policy | SESSION_PROMPT Verified Open §3 |
| Four same-named draft jobs in the left rail, one expired, no indication which is current | design gap | screenshot |
| Copy leaks implementation: AssemblyAI, provider region, reconcile, quarantine, bundle, "Reload draft", "Reload latest job" | design gap | `MeetingTranscriptionPanel.js` labels |

## 2. Job and audience

A WMKF program director, after a virtual Site Visit, on the request's Site
Visit page. They have a Zoom recording link, often an MP4, and either a
transcript file or an audio file. They need to make the recording and a
readable, correctly attributed transcript available to staff and the Board,
then move on. Visitor mode: Operate. Familiarity and scanability outrank
expression.

Secondary: the same person two days later checking "is the transcript up, is
it the right one, are the names right." Rare: a superuser untangling a stuck
publication.

## 3. Outcome and proof

The primary task is: get one current transcript and the recording onto the
request. Success is a card that answers three questions at a glance:

1. What is published now, and since when? One line, human terms.
2. Is anything in progress or needing me? One status line with a next action.
3. Can I fix speaker names? One editor, names prefilled, one button.

Product truth that must survive: Dataverse and SharePoint stay the system of
record; a publish is a consequential, attributable action; AI output (the
transcript, the automatic speaker names) is assistance that the director
reviews before it becomes a material.

## 4. Selected direction

**One card, "Recording and transcript", replaces both.** The Applicant
materials card above it is untouched. The Board presentation link stays as
its own small block at the bottom of the new card, unchanged in behavior.

Structural thesis: organize by what the request holds (a recording, a
transcript), not by how it was produced (uploaded versus generated). Each
holding has one current state line and one set of actions. Production
machinery (jobs, drafts, publications, leases) is folded under the transcript
holding and only surfaces as a status line or, when something is wrong, a
"Needs attention" disclosure.

Sequence top to bottom:

1. **Recording.** Current Zoom link and/or MP4 with date added, open/replace
   actions. Empty state: "No recording yet" with the two inputs inline. This
   is the existing Zoom link and MP4 behavior with dates added and the
   paragraph of helper copy cut to one line.
2. **Transcript.** The focal block.
   - *Current line:* "Published Oct 4, 3:24 PM · from Oregon State recording
     · version 3 · speakers named" or "Uploaded Sep 25 · Transcript.vtt" or
     "No transcript yet." Date and version come from the current TRANSCRIPT
     row (`createdAt`, `slotVersion`); the source name comes from the
     publication's `inputJobId` resolved to its job. Never from the
     publication row's `version` or `createdAt`. Download TXT and VTT for
     generated bundles; Open for uploaded files.
   - *Primary actions:* "Upload a transcript" and "Generate from audio". Two
     plain buttons or a two-tab control, both leading to inline forms, no
     modal. The forms are the existing ones with the copy in §6.
   - *Progress line* (only while a job is active): "Transcribing Oregon
     State recording · started 1:09 PM" with a quiet refresh affordance.
   - *Review block* (only when the newest job is ready and unpublished):
     source filename, ready time, the speaker editor (§5), then one dark
     primary "Publish transcript" button. "Discard this draft" as a text
     link. A quiet "Refresh" stays in this block whenever speaker matching
     is still running on a ready job or a save returned a version conflict;
     it reloads job state while preserving unsaved names (today's
     `loadDetail` with `preserveDraft`). The same applies to the edit-names
     path on a published transcript.
   - *Older runs* (only when more than one job exists): a collapsed
     disclosure "Earlier runs (3)" listing filename, ready time, and state
     chips. Expired runs show "Expired" and no actions. No bulk delete.
   - *Needs attention* (only when a publication is unresolved): the existing
     reconcile/retry affordances behind a disclosure, with plain copy.
3. **Board presentation link.** As today.

Focal moment: the current transcript line and its primary button. Everything
else is quieter, smaller, or collapsed.

Implementation consequence: a new presentation component composed from the
two existing cards' data hooks and the existing API routes. No new route, no
new table, no migration, no change to the TRANSCRIPT row, the bundle
manifest, the slot lease, the supervised-test folder policy, or anything
downstream (board link page, Share email, briefing page, Staff Deliberations
rail). UI-only on the write side, except the transcript-upload scan change in §9 decision 2.

## 5. Speaker names: one editor

Today there are two speaker surfaces: a green summary of alignment results
and a collapsed "Adjust names manually" editor whose rows repeat the same
speakers. The redesign keeps one editor, always open when a draft is under
review:

- One row per detected speaker: short excerpt, a name field prefilled with
  the alignment name when there is one, and a confidence chip ("Matched from
  Zoom captions · 97%") or "Unnamed".
- Suggestions sit in the row they apply to. "Speaker B is unnamed" shows the
  Jean button next to Speaker B's field, not in a separate list. (Closes
  SESSION_PROMPT Verified Open §4 as a UI matter; the alignment logic is
  unchanged.)
- The "18 short utterances were reattributed" note stays, one line, under the
  editor.
- One footer: "Names saved" / "Unsaved name changes" plus Save names, then
  Publish. The publish button explains itself when blocked ("Save names
  first", "Matching still running").
- A published generated transcript shows "Edit speaker names" in place of
  "Correct transcript". It opens the same editor against the published
  version; saving republishes. The word "correction" and the "Correction
  drafts" list disappear from the UI; the correction-draft lease stays in the
  service.
- A manually uploaded transcript has no bundle and shows no name editor. The
  current line says "Uploaded file · speaker names cannot be edited here."

## 6. State-to-copy table

Every current label and its replacement. Dates render in the viewer's locale
with time; filenames are shortened to the recording's display name where the
job has one.

| Today | Replacement |
|---|---|
| "Post-presentation materials" + "Meeting transcription" | "Recording and transcript" |
| "Save a Zoom recording link, upload an MP4, or add a transcript for this Site Visit." | one line under Recording: "Zoom link or MP4. Saving a new one replaces the current one." |
| "Zoom recording link or copied Zoom message" | "Zoom link (paste the share message if it has a passcode)" |
| "Current version · <guid>" | "Published <date, time> · from <source> · version <n>" (TRANSCRIPT row `createdAt` and `slotVersion`; job filename) |
| "Transcript · 1003222-Transcript-<guid>.txt · Open" | removed; the current line above replaces it |
| "Temporary drafts" rail | "Earlier runs (<n>)" disclosure; the newest ready run is the review block |
| job "Ready 10/4/2026, 3:23:56 PM" | "Ready <date, time>" chip inside the run row |
| "Publication status" list | removed from the default view; unresolved rows only, under "Needs attention" |
| "Publication status" (fallback label) | never rendered; draft rows are excluded from the publication list |
| "Published · superseded by a newer transcript" | not shown (resolved state) |
| "Published · reconciliation needed" | "Publishing did not finish. Check now." |
| "Publication outcome unknown" | "We could not confirm this publish. Check now." |
| "Publication can be retried" | "Publishing failed. Try again." |
| "Publication may still be running" | "Publishing… started <time>" |
| "Correction drafts" / "Correction · <guid> · Draft" | removed; "Edit speaker names" on the current line |
| "Correct transcript" | "Edit speaker names" |
| "Reload draft" / "Reload latest job" / "Check matching status" | one quiet "Refresh": on the progress line while a job is active, and in the review block while matching runs or after a version conflict; always preserves unsaved names |
| "Temporary draft. It is not visible as a published Meeting Tracker material. Draft content expires <date>." | "Not published yet. Draft kept until <date>." |
| "Speaker names from Zoom transcript" block | folded into the editor rows (§5) |
| "Adjust names manually" | removed; editor is always open during review |
| "Upload a recording" / "Audio file" | "Generate from audio" / "Audio file (M4A or MP3, up to 200 MiB)" |
| "Zoom transcript (.vtt, optional) · Speakers will be named automatically from it. Maximum 4 MB." | "Zoom captions (.vtt, optional) · names speakers automatically" |
| "Provider region · United States / European Union" | removed; United States always (§9 decision 3) |
| consent checkbox copy naming AssemblyAI | kept in substance (owner-set privacy boundary), shortened: "This recording is non-sensitive and may be sent to our transcription provider. Transcription uses paid credits." |
| "Upload and start transcription" | "Start transcription" |
| "Add Zoom transcript / Continue without it" interstitial | kept; copy: "Add Zoom captions to name speakers automatically?" |
| "Delete temporary draft" | "Discard this draft" text link |
| "Transcription is not available for this request…" | Generate from audio button disabled with "Not enabled for this request"; upload still works |
| "This draft changed elsewhere. Reload it before trying again; your current edits are preserved." | kept |
| "Deletion of this draft's readable content was observed." | "This draft's text is no longer available." |
| "Board presentation link · This materials-only link does not send email or change recipients." | kept |

## 7. States the card must render honestly

- No recording, no transcript (first visit after the meeting).
- Recording only; transcript only; both.
- Transcript uploaded as a file (no bundle): no name editor, no version line
  beyond "Uploaded <date>".
- Transcript generated and published; a newer run ready but unpublished
  (both shown: current line plus review block).
- Transcription feature not enabled for this request
  (`MEETING_TRACKER_TRANSCRIPTION_ACCESS` allow-list, [VERIFIED via
  `service.js:126-131`]): upload path works, generate path disabled with
  reason.
- Job active (uploading, queued, transcribing, saving): progress line only.
- Job failed, expired, or submission uncertain: one notice in the review
  block with the existing next action.
- Alignment running on a ready job: editor fields read-only with "Matching
  names from Zoom captions…" and Refresh available; abstained, no_speakers,
  failed, superseded each render their existing reason sentence in the
  editor header.
- Version conflict (another session saved names): the existing conflict
  notice with Refresh; unsaved edits preserved.
- Publication unresolved (publishing, retryable, unknown,
  published_reconcile): "Needs attention" disclosure open by default.
- Supervised-test policy on: current line adds a gray chip "Test folder".
- Materials API unavailable: the card shows its heading and one line, as
  today's Post-presentation card does.
- Narrow screens: single column; the editor rows stack excerpt over field.

Ranges [ASSUMED from the 1003222 rehearsal and the 12-speaker cap in the
formatter; not measured across requests]: a few runs per request, up to
a dozen detected speakers, one current transcript, a handful of publication
rows that are almost always resolved.

## 8. Defects and how the redesign treats them

Eliminated by the target state (no pre-work; see
`feedback-skip-legacy-fixes-that-the-target-state-removes`):

- The fallback "Publication status" box (draft rows excluded, list hidden
  when resolved).
- GUID-only version and correction lines.
- Duplicate transcript row across two cards.
- Jean suggestion separated from the editor.

Probed 2026-10-04 (owner-run read-only Postgres probe on request 1003222;
ids, states, names and timestamps only):

- **Correction badge "Draft" next to the published file's id: design gap,
  not a bug.** [VERIFIED via probe] Three publication rows exist: op
  `75170f4a` published (job `42d73d85`), op `4e7be123` published from job
  `9fc376d9` producing document `ea8e3af6`, and op `703b5986` in state
  `draft` whose source artifact is `ea8e3af6`. The service bookkeeping is
  correct. The UI labels the correction draft with the id of the transcript
  it corrects rather than its own, and shows the resulting document id as
  "Current version", so the same transcript appears under two different ids
  on one screen. The redesign removes both ids from the UI (§6).
- **Editor blank while alignment names exist: component defect.**
  [VERIFIED via probe] Job `7c1c5643` carries `speaker_names` for A, C, D,
  E, F, G, H identical to `speaker_alignment.speakers`, status `partial`,
  suggestion B: Jean. The screenshot shows empty name fields and "Unsaved
  speaker-name changes" for that job, so the component's local name draft
  was cleared after load (one of its `setSpeakerNames({})` paths) while the
  job held the names. The new editor must seed from the job on every load
  and never clear names without a user action; add a test for it.
- **The three amber boxes are exactly the three rows above:** the draft row
  renders the fallback "Publication status" label, the two published rows
  render "Published". Confirms the §1 diagnosis.
- Note for acceptance: the current published transcript (`ea8e3af6`) came
  from job `9fc376d9`, not from the newest run `7c1c5643` that holds the
  aligned names. The newest run is unpublished.

## 9. Open decisions (owner)

1. **Card merge.** DECIDED 2026-10-04 (owner): one card, "Recording and
   transcript", replaces both.
2. **Zoom VTT dual intake and scan.** DECIDED 2026-10-04 (owner): no
   Cloudmersive scan for .txt and .vtt transcript uploads. The files are
   generated by Zoom and uploaded by authenticated staff, and plain text has
   no execution surface, so the scanner's signature and content-class checks
   do not apply. Keep a local sanity check only (valid UTF-8, no NUL bytes,
   size cap, and the WEBVTT header for .vtt) to catch a wrong file such as
   Zoom's chat.txt. PDF and DOCX transcripts keep the Cloudmersive scan, and
   a rejected PDF or DOCX must name the tripped content flag instead of
   "failed the malware scan" (SESSION_PROMPT Verified Open §3 minimum fix).
   This is a service change in `material-service.js` transcript finalize,
   and so an exception to the "UI-only on the write side" boundary in §4 and
   §10. The copy in §6 still distinguishes "transcript file" from "Zoom
   captions".
3. **Processing region select.** DECIDED 2026-10-04 (owner): always United
   States. Remove the select; the generate form sends the US region.
4. **Older runs retention.** DECIDED 2026-10-04 (owner): no bulk delete and
   no new retention behavior. Newest run open, earlier runs collapsed under
   "Earlier runs (<n>)", per-run "Discard this draft", seven-day expiry and
   the daily cleanup remove the rest. Nothing published depends on a job:
   name edits on a published transcript read the bundle on the Dataverse
   row [VERIFIED via `service.js:320-335`]. AssemblyAI spend to date across
   all tests is about $1.40 (owner, 2026-10-04); cost is not a design
   constraint here, and the consent checkbox copy stays.
5. **Rehearsal page.** Proceeding on the recommendation unless the owner
   objects: `pages/meeting-tracker/transcription-rehearsal.js` keeps the old
   panel with `reviewOnly` against its synthetic fixture; the old panel and
   the rehearsal page retire together later.

## 10. Scope and boundaries

In scope: one new card component on the Site Visit page; removal of the two
old cards from `SiteVisitEditor`; copy; tests for the state-to-copy mapping
and the single editor; the bug fix for draft rows in the publication list if
it is needed inside the new component.

Untouched: Applicant materials card; all services under
`lib/services/post-presentation-materials/` (except the transcript-upload scan path, §9 decision 2),
`lib/services/meeting-tracker-transcription/`, and
`lib/services/transcription-pilot/`; API routes; Dataverse rows and SharePoint
folders; board presentation link behavior; Share email; briefing page; the
alignment and reassignment logic; the rehearsal page (decision 5).

Anti-goals: no new storage, no second transcript slot, no modal, no
animation beyond state feedback, no new color beyond the semantic set, no
suite-wide component extraction in this pass.

## 11. Delivery

Tier 1 runtime UI work: feature branch, PR, owner merges. Codex adversarial
review of this plan first; then Sonnet builds against this brief, Opus
reviews, Fable final review, Codex code review (the S572 orchestration
pattern). Acceptance on request 1003222 in Production with the owner
present: current line correct, publish from a fresh run, edit names and
republish, upload a file transcript and confirm it supersedes. Focused
tests: a ready job whose alignment completes after load (Refresh applies
names without losing edits); two sessions saving names (409 path keeps the
local draft); a correction created days before it is published shows the
publish date, not the draft date.

Gates for the build: `check:api-routes` (no change expected),
`check:doc-currency`, `check:docs-catalog`, `check:doc-symbol-refs`,
`check:build-claim-freshness`, `check:types`, unit tests under
`tests/unit/meeting-tracker-transcription` and the new component tests.

## 12. Codex adversarial review, 2026-10-04

Model gpt-6-astra, one round, verdict needs-attention. Both findings were
checked against source and hold; the plan above is amended accordingly.

1. **Refresh removed for ready drafts** (high). The first draft moved every
   refresh onto a progress line shown only for active jobs, leaving a ready
   job with alignment still running, or a 409 after another session saved
   names, with no way to reload without losing edits. Disposition: §4 review
   block, §6 refresh row, §7 states, and §11 tests amended.
2. **Publication receipt fields are not revision metadata** (medium). The
   first draft pointed the current line at `publicationDto.version` and
   `createdAt`. The version is a concurrency counter bumped on lease renewal
   and checkpoints [VERIFIED `transcription-pilot/store.js:1368-1431`], and a
   correction's publication row is created at draft time
   [VERIFIED `service.js:150`]. Disposition: current line now reads the
   TRANSCRIPT row's `createdAt` and `slotVersion`; §1, §4, §6, §11 amended.
