---
title: Site Visit summaries, Staff Deliberations follow-up, and Board sharing
domain: transcription
kind: plan
status: draft
summary: "Split one Site Visit recording at the point the applicants leave, summarize the presentation and the staff discussion separately, surface both to PDs on the Staff Deliberations page with the full source material, and share only the presentation part with Board members through the existing outside links; also closes a current exposure where outside links serve the full transcript."
owner: product-engineering
related:
  - docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md
  - docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md
  - docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
  - docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
---

# Site Visit summaries, Staff Deliberations follow-up, and Board sharing

Status: Stage 1 Production-live (PR #434 merge `32664485b`, Production deployment 6863898521 success; migration 068 applied and picklist 100000012 inserted (owner-run, re-read verified) 2026-10-05; §11, §12);
accepted on test request 1003222 by the owner 2026-10-05 (§13). Stage 2
source-built on branch `feature/presentation-summary` 2026-10-05, not merged
or deployed (§17); Stages 3–4 not built. Stages 2–3 re-reviewed against live
code 2026-10-05 (§16). Owner
decisions complete (§3, §7, §16).

## 1. What the owner asked for (2026-10-04)

1. Generate a summary of the Site Visit presentation (what the PI presented
   and the discussion with them) and a summary of the post-visit discussion
   among staff.
2. Make both legible to PDs outside the Meeting Tracker, in the "Research
   presentation follow-up" segment of the request's Staff Deliberations page.
   Staff also need the source material: the full video and transcript.
3. Generate outside links to share with Board members: the presentation
   video and transcript, ideally with the staff discussion separated out.

## 2. Current state

**[VERIFIED via `shared/components/workbench/ResearchPresentationFollowUp.js`]**
The follow-up segment already exists with three fixed rows: Recording,
Transcript, and Transcript summary. Each row is a file link or "Not added
yet"; nothing renders inline. It sits on the Staff Deliberations tab
(`shared/components/workbench/StaffDeliberationsTab.js:1127-1131`) behind the
`reviewers` app key and the post-presentation flags
(`lib/utils/post-presentation-materials-readiness.js:16-39`).
[NOT-READ: shared/components/workbench/useSiteVisitContext.js — the subagent
traced the feed to the site-visit logistics API; not re-read here.]

**[VERIFIED via `shared/config/requestDocument.js:10-21`]** The artifact type
`TRANSCRIPT_SUMMARY = 100000007` already exists, with a reserved SharePoint
folder. Nothing produces it; the 2026-09-21 materials plan said "no new
summary producer in this plan". In Production the row reads "Not added yet".

**[VERIFIED via `lib/services/post-presentation-materials/presentation-page-service.js:25-30,145-152`
and `lib/services/deliberation-briefing/briefing-page-service.js:91-99`]**
Two outside links already exist. The Board presentation link (materials
only, 60-day token, minted from the Site Visit card, no email) serves the
current RECORDING, TRANSCRIPT, and TRANSCRIPT_SUMMARY rows. The deliberation
briefing link (minted from the Workbench, embedded in the pre-site
distribution email) serves those three plus the writeup, proposal, reviews,
consultant feedback, and applicant materials. The two use separate tokens,
tables, and verifiers. [NOT-READ: lib/services/post-presentation-materials/presentation-link-service.js,
pages/external/presentation/[token].js — minting and page mechanics taken
from the subagent trace, not re-read.]

**[VERIFIED via `lib/services/post-presentation-materials/material-model.js:119-125,202-209`]**
Materials are projected one winner per artifact type (READY, not SUPERSEDED,
newest slot version). A trimmed Board recording and the full staff recording
cannot coexist under the one RECORDING type.

**[VERIFIED via `lib/services/meeting-tracker-transcription/bundle.js:114-140`]**
A published generated transcript carries a strictly validated manifest:
exact keys, `schemaVersion` in {1, 2, 3}, exactly the file roles
`txt`/`vtt`/`source`, each with SharePoint ids, size, and sha256. Adding a
field or a file role means a new schema version and an updated validator.

**[VERIFIED via `lib/services/meeting-tracker-transcription/alignment-service.js:71,88,104,163-164`]**
Speaker-name candidates carry a source class (`pi`, `co_pi`, `staff`, saved
attendees). The applied alignment stores a name (and Zoom name) and
confidence per speaker ID, not a class; the class is recoverable by matching
the applied name to the candidate list. The saved-attendee classes are
`staff`, `roster`, and `manual` [VERIFIED `binding.js:104-107`]; there is no
explicit Board class. [ASSUMED] Board members appear as `roster` refs; the
boundary proposal must treat `staff` and `roster` as inside the foundation
and confirm this against a real visit before relying on it.

**[VERIFIED via `lib/services/initial-assessment/artifact-service.js:210-266`]**
The pattern for a generated document is: `getExecutorBudget` →
`executePrompt` → upload through Graph → request-document row bound to the AI
run and prompt. Prompts are Tier-1 rows in Dataverse, seeded create-only from
`shared/config/prompts/*.js` through `lib/services/prompt-seed.js`
(owner-run with the Dataverse write ack), registered in
`scripts/check-prompt-injection-tagging.js`, and the app needs an
`APP_MODELS` row in `shared/config/baseConfig.js` plus
`requireAcceptedLlmResponse` from `lib/utils/llm-response.js` (S573 lesson).

**[VERIFIED via `scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs`
and `docs/atlas/dataverse-wmkf-requestdocument.md:440-448`]** A new artifact
type value is a Dataverse picklist insert done by a single-purpose owner-run
script (dry-run by default), mirrored in `requestDocument.js` and the Wave 16
schema record.

### 2.1 Exposure to close first

Under the single-recording model (§3 decision 1), the published TRANSCRIPT
row and the RECORDING row contain the staff discussion. Both outside pages
serve them. Any Board presentation link or briefing link minted for a request
whose recording ran past the applicants leaving exposes staff deliberation to
its holders today. [ASSUMED] Whether any such link has been minted for a
live request; the owner can check `presentation_material_links` and
`deliberation_briefing_links`. Stage 1 below closes this regardless.

## 3. Owner decisions already made (2026-10-04)

1. **One recording.** The Zoom meeting continues after the applicants leave;
   the staff discussion is the tail of the same recording and transcript.
2. **Board sees the presentation only:** video and transcript, with the
   staff discussion separated out.
3. **Staff get the summaries and the full source material** (video and
   transcript).
4. **Boundary cues:** staff usually ask whether the presenter has questions
   for them and thank them, in either order; the last comment from a person
   outside foundation staff and Board is a good cue. A program coordinator
   can find the exact time.
5. **Video split by trimming in Zoom.** The PC trims the cloud recording to
   the boundary time and shares that link. No video processing in the app.

## 4. Design

### 4.1 Presentation end time (the boundary)

One number, in milliseconds from the start of the recording, drives
everything: the transcript split, the summaries' inputs, and the time the PC
trims to in Zoom.

- **Proposed automatically** when a transcript is published: the end of the
  last speaker turn whose applied name does not match a staff or Board
  candidate (§3 decision 4; the match uses the candidate source classes in
  §2). If no name is applied or every speaker is staff, no proposal.
- **Confirmed by a person.** The Recording and transcript card shows
  "Presentation ends at 1:02:14 (proposed)" with the surrounding turns, and
  the PC confirms or adjusts to any turn boundary. Until confirmed, nothing
  downstream treats the transcript as split.
- **Stored on the TRANSCRIPT row's bundle manifest** as
  `presentationEndMs` with `confirmedBy`/`confirmedAt`, manifest
  `schemaVersion` 4 with the validator extended. Because publication
  recovery rebuilds a bundle from the uploaded source envelope and the
  Postgres receipt before any Dataverse row exists [VERIFIED
  `service.js:545-561`], the same three fields are frozen in the source
  envelope (schema 4, validated by `parseVerifiedMeetingTranscriptSource`,
  whose version list at `bundle.js:149-150` must also admit 4) and in the
  publication receipt before uploads start, and they enter the frozen input
  hash so identity covers them. The boundary is a property
  of that transcript's timeline; a republish (names edit) carries it forward;
  a new run from new audio starts unconfirmed. Alternative considered: a
  field on the Site Visit activity. Rejected because a boundary belongs to a
  specific recording, and the activity outlives re-uploads. [§7 decision 1]

### 4.2 Split transcript: a presentation-only row, not extra bundle roles

Outside pages serve bytes by the request-document row's own SharePoint item
(`resolvePresentationMember` and the briefing `open` path redirect to the
row's `wmkf_sharepointdriveid`/`itemid` media [VERIFIED via
`presentation-page-service.js:160-180`, `briefing-page-service.js:760-800`]).
They never read the bundle manifest. So a presentation-only transcript must
be its own row:

- New artifact type `PRESENTATION_TRANSCRIPT = 100000012`, one file-backed
  `.txt` row (a `.vtt` variant only if the Board page ever needs captions),
  written by the boundary confirmation step from the full bundle's turns
  ending at or before the boundary, superseded on every re-confirmation or
  transcript republish.
  Staff-side it is informational; outside it is the only transcript served.
- ~~The staff discussion part is not a durable material.~~ **Superseded by
  §7 decision 7 (2026-10-05):** the staff discussion is a durable, staff-only
  `STAFF_DISCUSSION_TRANSCRIPT` (100000013) row, the exact complement of the
  presentation cut (utterances ending after the boundary), written by the
  same action and bound by the same generation-key recipe. Stage 3's summary
  may read that row instead of re-deriving the cut.
- The full `txt`/`vtt` stay as today for staff.

**Boundary generation.** Every derivative (the presentation-transcript row,
the Board recording link, both summaries and their drafts) records the
source bundle `revisionId` and `presentationEndMs` it was made from, on the
request-document row (as the SHA-256 `wmkf_generationkey`; resolved in §11
item 2 [VERIFIED via `presentation-transcript-binding.js:28-34`]) and in
the draft. Outside pages compare that pair with the current TRANSCRIPT row's
confirmed boundary at context time and again at open time, and omit any
derivative that does not match. Moving the boundary, re-confirming it, or
publishing a transcript from new audio therefore hides every derivative
immediately until it is regenerated, and the card says so. Supersession
alone is not relied on, because the outside services pick winners per type
independently [VERIFIED `material-model.js:119-125`] and a partial failure
while replacing one row would otherwise leave the older, longer one
eligible.

Outside pages: project `PRESENTATION_TRANSCRIPT` and never `TRANSCRIPT`.
With no confirmed boundary there is no presentation row, so no transcript
appears outside. A manually uploaded transcript (no bundle) therefore never
appears outside after this change. The Staff Deliberations segment and the
card keep the full files.

### 4.3 Two summaries, two prompts, two artifact rows

| | Presentation summary | Staff discussion summary |
|---|---|---|
| Input | the bound Presentation Transcript row's text plus the applicant presentation PDF text if present (newest Ready `APPLICANT_SLIDES` row with a PDF content type; applicant-supplied, so tagged as untrusted input) | the bound Staff Discussion Transcript row's text (`bindStaffDiscussionTranscript`; §7 decision 7), not a re-derived cut |
| Prompt row | `meeting-transcript.presentation-summary` | `meeting-transcript.discussion-summary` |
| Output | plain text (`.txt`), sections: what was presented, questions and answers, open points | plain text, sections: assessments voiced, concerns, follow-ups, who said what only where it matters |
| Artifact type | `TRANSCRIPT_SUMMARY = 100000007` (exists) | new `STAFF_DISCUSSION_SUMMARY = 100000010` |
| SharePoint folder | `Site Visit - Transcript Summary` (reserved) | `Site Visit - Staff Discussion Summary` (new) |
| Visible outside | yes (Board page and briefing page already project it) | never; both outside services must exclude it explicitly and a test pins that |
| Visible to staff | segment, inline, with file link | segment, inline, with file link |

Why `.txt`: the Board page serves `.txt`, `.vtt`, `.pdf`, and `.docx` for
transcript-type rows [VERIFIED `presentation-page-service.js:30-36`; the
earlier draft's claim that only text types were admitted was wrong], so DOCX
would work too. Plain text is chosen because the Staff Deliberations segment
renders the same bytes inline with no conversion. A DOCX export can be added
later from the stored text.

Generation flow mirrors the transcript's draft-to-publish contract:

1. PC clicks "Summarize" in the card (requires a bound derivative for the
   summary's input) and ticks the summarization acknowledgment (§6).
2. The route runs the prompt synchronously (`maxDuration: 300`, as the
   Pre-Site generation route does [VERIFIED via
   `pages/api/workbench/pre-site-visit.js:23-29`]; §16 decision C). Only a
   successful, accepted response writes a draft. Drafts live in a new
   Postgres table (§16 finding 3), never as request-document rows: the
   outside winner rule excludes only SUPERSEDED [VERIFIED via
   `material-model.js:124-129`], so a Dataverse DRAFT row would be served.
3. The PC reads and may edit each draft, then publishes it; publish writes
   the `.txt` to SharePoint and the request-document row bound to the AI
   run, superseding any previous summary of that type. The row carries a
   `wmkf_generationkey` from the same recipe as the transcript derivatives
   (producer, request, type, source `revisionId`, `presentationEndMs`) and a
   pinned eTag.
4. ~~Republishing the transcript (names edit) does not invalidate a
   published summary.~~ **Superseded (§16 decision A, 2026-10-05):** any
   republish, including a names edit, mints a new `revisionId` [VERIFIED via
   `meeting-tracker-transcription/service.js:480`], so outside pages hide the
   summary until a PC summarizes and publishes again. Staff surfaces keep
   showing it with "Summary from an earlier transcript version" and offer
   Summarize again.

LLM admission: both prompt rows seeded with `wmkf_ai_model = sonnet`. The
Executor takes the model from the prompt row and passes no fallback model to
`LLMClient` [VERIFIED via `execute-prompt.js:553-560,666-678`; `grep
fallbackModel` finds no hit], so §16 decision B supersedes the haiku fallback
in §7 decision 4, and no `APP_MODELS` row is needed. Also:
`requireAcceptedLlmResponse` on both calls, executor budget rows sized for a
long answer with thinking (the IA 2,200-token lesson), `requireNoPersistence`
with content-free audit as the alignment prompt does [VERIFIED via
`alignment-service.js:144-155`], A7 registry entries (the applicant PDF is an
untrusted input), seeds owner-run with the write ack, and a line each in the
Sonnet 5.5 consumer inventory.

### 4.4 Staff Deliberations segment

`ResearchPresentationFollowUp` grows from three link rows to:

- **Presentation summary** and **Staff discussion summary**: the text
  inline, collapsed to the first section with "Read more", a "Generated
  <date> from the transcript published <date>" line, and the file link.
  "Not added yet" with a pointer to the Site Visit page when absent.
- **Source material**: Recording (full), Transcript (full), and, when a
  boundary is confirmed, "Presentation ends at 1:02:14". Links as today.

The segment stays read-only under `reviewers`; generation and publication
stay in the Meeting Tracker card under `meeting-tracker`. The logistics API
that feeds the segment adds the two summary texts (bounded size) to its
response by downloading each bound summary `.txt` from SharePoint at feed
time, size-capped (§16 decision D). The feed makes no Graph reads today
[VERIFIED via `logistics-service.js:401-403`, descriptors only]; a failed or
oversized read degrades to the file link and never fails the feed.

### 4.5 Board sharing

The existing Board presentation link is the sharing mechanism; the change is
what it serves.

- **Recording:** a new artifact type `BOARD_PRESENTATION_RECORDING =
  100000011` holding the trimmed Zoom link (§3 decision 5). The card's
  recording block gains "Board recording link" with the boundary time shown
  as the trim target. Outside pages project this type and never RECORDING.
  The one-winner-per-type projection [VERIFIED §2] makes a second type the
  simplest way to keep the full recording for staff. [§7 decision 2]
  A Zoom-backed row is accepted only for RECORDING today: the backing check
  [VERIFIED `material-model.js:103-105`], both outside `open` resolvers
  [VERIFIED `presentation-page-service.js:172-175`,
  `briefing-page-service.js:765-773`], and the `canWatch` descriptor
  [VERIFIED `presentation-page-service.js:93`] all name RECORDING alone.
  Each must admit `BOARD_PRESENTATION_RECORDING` for external backing and
  watch mode, and a test drives a Zoom-backed 100000011 row through both
  context and open endpoints while a full RECORDING row stays excluded.
- **Transcript:** the `PRESENTATION_TRANSCRIPT` row only (§4.2).
- **Summary:** `TRANSCRIPT_SUMMARY` only; the staff discussion summary is
  excluded by type.
- **Briefing page:** same three substitutions, since it already projects the
  same materials.
- Token lifetime, reissue, and no-email behavior unchanged.

### 4.6 What stays untouched

The transcription pipeline, speaker alignment, the materials upload paths,
the Pre-Site distribution email, the token tables and verifiers, the Final
Writeup and other narrative artifacts, and the applicant materials
collection.

### 4.7 Artifact-type fan-out (contract-reconcile audit 7)

The new types fail closed everywhere until they are added to an allowlist,
and each allowlist decides a different audience. Every one of these must be
edited deliberately, and the staff-only type must be added to none of the
outside ones:

| Allowlist | File | Add `PRESENTATION_TRANSCRIPT` 100000012 | Add `BOARD_PRESENTATION_RECORDING` 100000011 | Add `STAFF_DISCUSSION_SUMMARY` 100000010 |
|---|---|---|---|---|
| Shared post-presentation projection `POST_PRESENTATION_ARTIFACT_TYPES` [VERIFIED `material-model.js:15-21`]; feeds the card, the Board page, and the briefing page | `lib/services/post-presentation-materials/material-model.js` | yes | yes | **no** at plan time; it would have reached the Board page through `eligiblePresentationRows` [VERIFIED `presentation-page-service.js:81-84` as of 2026-10-04]. Stage 1 replaced that pass-through with explicit outside allowlists, so a staff-only type may now sit in this shared set; `STAFF_DISCUSSION_TRANSCRIPT` 100000013 does (§13), pinned by mutation-checked exclusion tests on both outside pages |
| Board page file-mode check, denylist-shaped: any non-RECORDING type falls through to the transcript mime check [VERIFIED `presentation-page-service.js:142-152`] | same file | convert to an explicit allowlist of outside-servable types | same | excluded by the allowlist |
| Briefing page allowlist [VERIFIED `briefing-page-service.js:91-99`] | `lib/services/deliberation-briefing/briefing-page-service.js` | yes, replacing TRANSCRIPT | yes, replacing RECORDING | **no** |
| Staff Deliberations feed `MATERIAL_TYPES` [VERIFIED `logistics-service.js:52-58`] | `lib/services/site-visit/logistics-service.js` | yes | yes | yes, plus the summary text |
| Labels `REQUEST_DOCUMENT_ARTIFACT_LABEL` and the type enum | `shared/config/requestDocument.js` | yes | yes | yes |
| Writer registry gate `check:request-document-writers` | `scripts/check-request-document-writers.js` | new writer row | new writer row | new writer row |
| Atlas page | `docs/atlas/dataverse-wmkf-requestdocument.md` | yes | yes | yes |
| Postgres CHECK constraints `presentation_material_slot_leases_artifact_type_check` and `presentation_material_uploads_artifact_type_check`, both limited to 100000005-100000007 [VERIFIED `lib/db/migrations/055_post_presentation_materials.sql:71-72,146-147`, `scripts/setup-database.js:1638-1639,1711-1712`]; the shared publication lease inserts the requested type directly | done: migration 068 admits 100000010, 100000011, 100000012 and 069 adds 100000013 [VERIFIED via `lib/db/migrations/069_staff_discussion_transcript_type.sql:11,17`]; Stages 2–4 need no constraint migration | done | done | done |
| External-backing and watch guards (RECORDING-only today; §4.5) | `material-model.js`, both outside `open` resolvers, `canWatch` | n/a | yes | n/a |

The staff-only type needs its own small projection for the logistics feed
rather than reuse of the shared set. A test constructs a READY
`STAFF_DISCUSSION_SUMMARY` row and asserts that the Board page context omits
it and that `open` for its member returns 404, so deleting the guard turns
the test red.

### 4.8 Manifest version coupling (contract-reconcile audit 7)

`validateMeetingTranscriptManifest` requires `String(schemaVersion) ===
formatterVersion`, both from the supported list `['1','2','3']`, and the
formatter picks the turn layout for versions 3 and up [VERIFIED
`bundle.js:31,83,114-120`, `transcript-format.js:9-10`]. Recovery compares
`formatter_version` for equality [VERIFIED `service.js:555-561`]. So storing
the boundary on the manifest means:

- schema and formatter version `'4'`, same turn layout as 3, added to both
  supported lists; v1 to v3 bundles still rebuild byte-identical.
- confirming a boundary publishes a new v4 revision through the normal
  supersede path; it never mutates a v3 manifest in place.
- file roles stay `txt`/`vtt`/`source` (no new roles, per §4.2).

## 5. Delivery stages

Each stage is a branch and PR, owner merges; Tier 1 runtime work.

**Stage 1. Boundary and presentation transcript; close the exposure.**
Picklist extension for `100000012` (owner-run, dry-run first); the Postgres
constraint migration (§4.7, owner-applied); manifest, source-envelope, and
formatter version 4 with the boundary frozen in the receipt (§4.1);
boundary-generation binding and the outside-page match checks (§4.2); boundary proposal and confirmation in the card; the
presentation-transcript row written on confirmation; outside pages project
`PRESENTATION_TRANSCRIPT` instead of `TRANSCRIPT` and stop projecting
`RECORDING` (until stage 4, outside pages show no recording); Board page
file-mode check converted to an allowlist; §4.7 allowlists edited. No LLM.
Owner-run: the extension script. Acceptance on 1003222: confirm the boundary
at the real time, open the Board link, see the transcript end there and no
recording; move the boundary earlier and confirm the Board link shows no
transcript until the row regenerates; simulate recovery with files uploaded
and no registry row.

**Stage 2. Presentation summary.** Prompt file, seed script (model
`sonnet` on the prompt row), A7 entry, budget row, the summary-draft table
migration and Atlas page, the summarization acknowledgment, draft and publish
flow in the card, `TRANSCRIPT_SUMMARY` writer with generation key and pinned
eTag, the summary binding on both outside pages (listing and open), inline
rendering in the segment (§16). Owner-run: the migration; seed with write
ack; budget row through admin. Acceptance: a summary a
PD would accept without rewriting; the Board page shows it.

**Stage 3. Staff discussion summary.** Picklist extension for `100000010`
(owner-run, dry-run first; the Postgres constraints already admit it), folder, second prompt and seed, second writer,
its own staff-only projection in the logistics feed, segment rendering, the
§4.7 outside-exclusion test. Owner-run: the
extension script and the seed. Acceptance: the summary appears on Staff
Deliberations and nowhere outside.

**Stage 4. Board recording.** Picklist extension for `100000011`, card
input with the trim target, outside pages project it in place of RECORDING. Owner-run: the
extension script; the PC trims in Zoom. Acceptance: the Board link plays the
trimmed recording and nothing else.

Gates per stage: `check:api-routes`, `check:atlas` (Atlas page for
`wmkf_requestdocument` updated for new types and the manifest change),
`check:prompt-injection-tagging`, `check:model-registry`,
`check:request-document-writers` (new writers recorded), `check:types`, and
the docs gates. Stage 2 and 3 add `check:model-override-warming` for any new
route that resolves a model.

## 6. Data handling

- The staff discussion already reaches AssemblyAI and SharePoint under the
  upload-time acknowledgment, which is checked only when transcription is
  queued and persists only a timestamp [VERIFIED `runtime.js:145-148,181`].
  That acknowledgment does not cover summarization, and bundles published
  before stage 3 never saw any summarization wording. So "Summarize" takes
  its own server-validated, versioned acknowledgment: the PC confirms, on
  every Summarize request, a disclosure that names the LLM provider and the
  staff discussion; the server rejects a request without it before any
  provider call and persists actor, time, disclosure version, and the source
  bundle `revisionId` on the draft row it creates (§16 finding 4). Per run is
  stricter than per recording and needs no stable recording identity. The upload-time copy also gains the sentence, for
  awareness, but it is not what authorizes the call. The handoff's "no
  blanket confidential-recording clearance" still stands. [§7 decision 3]
- Summaries are AI drafts a PD reviews before they become materials
  (product principle 1). The draft never leaves Postgres until published.
  Unlike transcript correction drafts, which are label-only with bytes kept
  in SharePoint [VERIFIED via `063_meeting_tracker_transcription.sql:91`], a
  summary draft holds generated text about the staff discussion in
  Postgres: the new table expires drafts, deletes the text on publish or
  expiry, and gets its own Atlas page.
- Audit: `wmkf_ai_run` rows with content-free retention; the request-document
  row binds to the run and prompt version like the Initial Assessment.
- The Staff Discussion Transcript (§7 decision 7) adds no new disclosure:
  its words are already in the full TRANSCRIPT files staff hold in the same
  request SharePoint folder. It is a second, staff-only file of pure staff
  deliberation, so its exclusion from both outside pages is enforced by
  allowlist and pinned by tests (§13).

## 7. Owner decisions (all DECIDED 2026-10-05)

1. **Boundary storage:** on the transcript bundle manifest as version 4
   (§4.8). A names-edit republish carries it forward; a new audio upload
   starts unconfirmed.
2. **Three new artifact types**, one per stage: `PRESENTATION_TRANSCRIPT`
   100000012 (stage 1), `STAFF_DISCUSSION_SUMMARY` 100000010 (stage 3),
   `BOARD_PRESENTATION_RECORDING` 100000011 (stage 4). One owner-run
   picklist script per stage, dry-run first.
3. **Staff discussion may be sent to Anthropic for summarization**, per
   recording. The consent checkbox copy gains a sentence saying the staff
   discussion is also summarized by the LLM provider; the PC still decides
   per recording. No blanket clearance.
4. **Model tier:** `sonnet` with `haiku` fallback for both summary prompts.
   **Amended 2026-10-05 (§16 decision B):** `sonnet` only; the Executor has
   no fallback swap.
5. **Interim gap accepted:** between stage 1 and stage 4 the outside links
   show no recording. Closing the exposure comes first.
6. **Applicant presentation PDF is an input** to the presentation summary
   when one is on file; transcript only otherwise.
7. **Staff discussion transcript is kept, staff-only (DECIDED 2026-10-05,
   after Stage 1 acceptance).** Everything after the confirmed boundary is a
   durable file for staff: artifact type `STAFF_DISCUSSION_TRANSCRIPT`
   100000013, written alongside the presentation transcript by one action,
   listed on Staff Deliberations, never served by either outside page.
   Supersedes §4.2's "not a durable material". Owner chose a durable file
   over a card-only download.

## 8. Open items for the sweep, not this plan

- ~~`docs/PC_MEETING_TRACKER_PLAN.md:105` says the presentation materials are
  "PRODUCTION NOT DEPLOYED"~~ **Done 2026-10-05 (`8b99e1bb4`):** that plan, the
  credentials runbook, and both Atlas pages now say Production-live since
  2026-09-29, citing the Production receipt.

## 9. Contract-reconcile review, 2026-10-04 (Mode A, on this draft)

Surface: three new request-document artifact types, a manifest/formatter
version, two prompts, two outside-page projection changes, one staff feed
change. Persistence: Dataverse `wmkf_requestdocuments` rows and SharePoint
files; Postgres drafts; `wmkf_ai_runs`. Consumers: the card, the Staff
Deliberations segment, the Board page, the briefing page, writers gate,
Atlas.

Findings folded into the draft above:

1. **Outside pages resolve media by the row's SharePoint item, not the
   manifest** [VERIFIED `presentation-page-service.js:160-180`,
   `briefing-page-service.js:760-800`]. The first draft's extra bundle roles
   could not be served outside. Replaced by the `PRESENTATION_TRANSCRIPT`
   row (§4.2).
2. **Type fan-out is allowlist-per-audience, and one check is
   denylist-shaped** [VERIFIED §4.7]. Adding the staff-only summary to the
   shared projection would have served it on the Board page. §4.7 names
   every list and pins the exclusion with a test.
3. **Manifest version is coupled to the formatter version and to recovery
   equality checks** [VERIFIED §4.8]. The boundary lands as version 4 via a
   new revision, never in place.
4. Partial-success and async audits: N/A at plan level; the build inherits
   the transcript publication's lease, quarantine, and generation guards and
   must not add a second publication path. Draft-to-publish for summaries
   reuses the correction-draft discipline (expiry, one draft per source).

Verdict: READY WITH NAMED CHANGES, all applied above; the §7 decisions
remain the owner's.

## 10. Codex adversarial review, 2026-10-05 (gpt-6-astra)

Verdict needs-attention; five findings and two citation corrections, all
verified against source and folded in above:

1. Boundary moves and partial replacement could leave derivatives outside
   with excluded staff talk: §4.2 "Boundary generation" binds every
   derivative to the source revision and boundary and checks the match at
   context and open time.
2. The Postgres lease and upload constraints admit only the three original
   types: §4.7 adds the migration row; stage 1 carries it.
3. Manifest-only boundary metadata is unavailable to publication recovery,
   and the source validator also pins the version list: §4.1 freezes the
   fields in the source envelope and receipt and names both validators.
4. Upload-time consent does not authorize summarization of existing
   bundles: §6 adds a versioned summarization acknowledgment bound to the
   source revision, server-enforced.
5. A Zoom-backed Board recording is rejected by the backing check, both
   outside resolvers, and the watch descriptor: §4.5 and §4.7 add them to
   the fan-out with a test.
6. Corrections: the Board page already serves PDF and DOCX transcript rows
   (§4.3 reasoning reworded); speaker candidates carry `staff`, `roster`,
   `manual`, with no Board class (§2, boundary rule now treats `staff` and
   `roster` as inside, flagged for confirmation).

## 11. Stage 1 build record, 2026-10-05 (branch `feature/site-visit-presentation-boundary`)

Orchestrated by Claude Fable; three Sonnet builders in parallel worktrees
(service/store/routes/writer; outside pages and staff feed; card), merged,
Opus review (nine findings, all addressed below), then Codex code review.
Migration number: `067` was already claimed on
`codex/staff-deliberations-rework`, so Stage 1 is `068`.

Named changes from the design above:

1. **The derivative row is written by an explicit action, not inside the
   confirmation step** (§4.2 said "written by the boundary confirmation
   step"). Confirmation publishes the v4 bundle through the normal correction
   publish; the Presentation Transcript is then written by
   `POST .../transcriptions/presentation-transcript` (the card's "Generate
   presentation transcript"), idempotent on the generation key. One writer,
   one path; a failed derivative write never leaves a published bundle
   half-done, and the card shows "the Board link shows no transcript until
   the presentation transcript is generated" until it succeeds.
2. **Binding lives in `wmkf_generationkey`, not a snapshot field.** The Wave
   16/30/31 schema has no generic input-snapshot attribute. The key is a
   SHA-256 over producer, request, type, source `revisionId`, and `endMs`
   (`presentation-transcript-binding.js`); both outside readers recompute it
   from the current TRANSCRIPT winner's v4 manifest at context and open time.
3. **No `scripts/setup-database.js` mirror for 068.** Since the 2026-09-30
   bootstrap rewrite the fresh install runs every manifest migration for
   real; the inline 055 text in the setup script is a parity fixture only.
4. **A same-key derivative row that was superseded (boundary moved away and
   back) is restored under the new fence**, not re-created: the generation
   key is a Dataverse alternate key, so a second row cannot exist.
5. **The derivative filename carries the boundary time
   (`…-Presentation-Transcript-ends-1h02m14s.txt`), never a revision id**,
   because the Board page shows filenames.
6. **PATCHing the boundary the draft already holds does not re-stamp
   `confirmedBy`/`confirmedAt`**; the card also omits the key when the
   boundary is unchanged, so a names-only republish carries the original
   confirmation forward (§4.1).
7. **Manifest/source agreement is asserted in the publisher**
   (`publishMeetingTranscriptBundle` refuses an identity boundary that differs
   from the frozen source envelope).

Open items recorded for the owner and later stages:

- **Rollback caution.** Once any v4 bundle exists, rolling back to `main`
  makes its validator (`[1,2,3]`) reject it: the card shows the transcript as
  not editable and no correction draft can be created. Roll forward instead.
- **Transcript Summary is served outside unbound** (no writer exists yet).
  Stage 2 must bind it to the source revision and boundary (§4.2) before its
  writer ships; a code note marks the spot in both outside services.
- **Pre-Site distribution email material links**
  (`lib/services/pre-site-visit/distribution/model.js` `MATERIAL_TYPES`)
  still let staff select the full RECORDING and TRANSCRIPT rows as SharePoint
  links. SharePoint requires tenant sign-in, so an outside recipient cannot
  open them, but §4.7 did not list this allowlist. Owner decision: leave, or
  trim to the Presentation Transcript.
- **External briefing page empty-state copy** ("Slides, recordings, and
  transcripts appear here…") no longer matches what the Board can see.
- **Boundary rule confirmation** (handoff S575 §9): the proposal treats saved
  staff and roster attendees as inside the foundation; confirm on 1003222
  during acceptance.
- **Owner-run before acceptance:** apply migration 068; dry-run then
  `--execute` `scripts/extend-requestdocument-artifacttype-presentation-transcript.mjs`;
  read `scripts/probe-outside-link-exposure.js`.

## 12. Codex adversarial review of the Stage 1 build, 2026-10-05

Verdict needs-attention, one high finding, verified and fixed on the branch:

1. **The generation key bound the row, not the bytes.** Both outside `open`
   resolvers redirected to the latest SharePoint item after checking only
   drive/item identity and MIME/extension, so a derivative file replaced in
   SharePoint (any later version, including the full transcript) would still
   be served while its row's key matched. Fix: `resolveMediaDownloadUrl` now
   returns the live item `eTag`, and both outside resolvers refuse any
   post-presentation row (Presentation Transcript and Transcript Summary)
   whose live eTag differs from the one the registry row pinned, or whose row
   pinned none. Tests drive a replaced version and an unpinned row to 404 on
   both pages. Applicant-uploaded rows (`site-visit-materials-portal`) keep
   their previous behavior; whether to pin them too is a follow-up decision.
   Consequence: a derivative whose file was replaced is hidden outside until
   it is regenerated; the writer's idempotent branch does not yet re-upload a
   replaced file (open item).

## 13. Staff discussion transcript build record, 2026-10-05 (branch `feature/staff-discussion-transcript`)

**Status: Production-live** (PR #435, merge `700702ee9`, Production deployment
6864926345 success, 2026-10-05). Acceptance on test request 1003222 pending.

**Stage 1 acceptance (test request 1003222, owner, 2026-10-05):** the owner
published the 7c1c5643 run with Speaker B named, opened the speaker-name and
presentation-end editor, confirmed a boundary, generated the presentation
transcript, and reported that the flow worked. The owner did not report
which turn the proposal picked, so handoff S575 §9 (roster attendees count as
inside the foundation) is still unconfirmed. The card's Save button sits only
at the bottom of the review block; with eight speakers it was not found at
first (layout follow-up offered, not decided).

Built by Claude Opus 5.5 directly (one cohesive change); independent review
by Codex adversarial review.

- `STAFF_DISCUSSION_TRANSCRIPT = 100000013` (label, Wave 16 record). Migration
  `069_staff_discussion_transcript_type.sql` adds it to both post-presentation
  `artifact_type` CHECKs. Owner-run insert:
  `scripts/extend-requestdocument-artifacttype-staff-discussion-transcript.mjs`.
- `staffDiscussionContent` is the exact complement of `presentationContent`;
  a test proves the halves are disjoint and reassemble every utterance.
- The writer runs one spec per derivative under its own slot lease,
  presentation first, sharing one verified source read; still one
  `createDocument` call site. Folder `Site Visit - Staff Discussion
  Transcript`, filename `…-Staff-Discussion-Transcript-from-<time>.txt`.
- **Named deviation:** when nothing follows the boundary, the discussion row
  is still written, containing one line ("No discussion was recorded after
  the presentation ended at …"), instead of skipping the row and adding an
  "empty" state across service, card, and tests.
- Staff surfaces: overview DTO `staffDiscussionTranscript {state, artifactId}`;
  the card shows both ready lines and one "Generate presentation and
  discussion transcripts" action; Staff Deliberations lists the new slot.
- Outside: unchanged allowlists; new tests drive a Ready, file-backed,
  real-producer 100000013 row to omission at context and 404 on open,
  download, and watch, on both pages and the legacy briefing path; a mutation
  admitting the type turned both tests red.
- Not changed: the Pre-Site distribution email allowlist (owner decision
  still open).
- Owner-run ahead of the merge, 2026-10-05: migration 069 applied; picklist
  100000013 "Staff Discussion Transcript" inserted and re-read verified.

**Codex adversarial review (2026-10-05), one medium finding, fixed:** the
Staff Deliberations feed picked derivative winners by type without checking
their generation keys. After a boundary move where the presentation half
regenerated but the discussion write failed, staff would see a new
presentation cut beside the old discussion cut, overlapping. Fix: the feed
opts into bundle metadata and keeps only the presentation and discussion rows
bound to the current revision and boundary (`withoutUnboundDerivatives`);
without bundle metadata both are hidden and the full transcript stays. The
regression test for that exact sequence, plus the readiness-off case, turned
red with the filter removed. Outside-page exclusion was judged sound.

## 14. Boundary proposal stray-line guard, 2026-10-05 (branch `feature/boundary-proposal-stray-lines`)

**Status: Production-live** (PR #437, merge `9dfec5479`, deployment 6865805766 success).

**Acceptance finding on 1003222 (owner):** the proposal landed late, at a
one-word line ("[1:00:48] Sujoy Mukhopadhyay: Same.") that diarization
attributed to the PI more than ten minutes into the staff discussion. The
speaker classification was right; the attribution was wrong. Had the
proposal been confirmed unchecked, the Board link would have carried that
stretch of staff discussion, so the stakes are higher than "advisory"
suggested.

**Owner constraint:** a closing "Thank you" is often the applicants' last
line, so short lines cannot be dropped by length alone.

**Rule:** a short applicant line (≤ 3 words) is skipped only when it starts
more than 2 minutes after the previous longer (> 3 words) applicant line;
the gap is measured to the last longer line so a cluster of strays is
skipped together. Errors stay visible: a real closing thanks after more than
two minutes of staff talk is skipped (proposal lands slightly early) and is
shown with "Use this line instead"; every skipped line is listed in the
editor. The roster-as-inside rule (handoff S575 §9) remains unconfirmed: this
run was consistent with it but did not show whether any roster attendee
spoke.

## 15. TXT encoding fix, 2026-10-05 (branch `feature/transcript-txt-utf8-bom`)

**Status: Production-live** (PR #438, merge `1e2a798fd`, deployment 6865646088 success). Existing 1003222 files need a republish and Generate to pick it up.

**Owner report on 1003222:** the staff discussion TXT opened from SharePoint
showed "youâ€” I think". The file bytes were correct UTF-8 (`e2 80 94`); the
viewer read them as Windows-1252 because a `.txt` carries no charset. The
card's own "Download TXT" was unaffected (its route sends
`charset=utf-8`); the Board link redirects to SharePoint and was presumed
affected (not verified in Production).

**Fix:** a UTF-8 byte-order mark on every published TXT. The full transcript
gets it through formatter/bundle version 5, so v1–v4 publications still
rebuild byte-identical during recovery; the presentation and discussion
derivatives get it in their writer. VTT and source JSON are unchanged.
Already-written files keep their bytes; regenerating replaces them.

## 16. Contract-reconcile review of Stages 2–3, 2026-10-05 (Mode A, after Stage 1)

Surface: two summary writers (types 100000007 and 100000010), a summary-draft
table, a summarization acknowledgment, the outside summary binding, and
inline summary text on Staff Deliberations. Verdict before amendment: READY
WITH NAMED CHANGES for §4.4/§4.7, NEEDS REWORK for §4.3/§6. All findings
below are folded into those sections.

1. **Model and fallback.** The Executor resolves the model from the prompt
   row's `wmkf_ai_model` [VERIFIED via `execute-prompt.js:553-560`] and
   builds `LLMClient` with no fallback model [VERIFIED via
   `execute-prompt.js:666-678`; `grep fallbackModel` in that file returns
   nothing]. `APP_MODELS` rows would be unused; the haiku fallback had no
   mechanism.
2. **§4.3 step 4 contradicted the §4.2 binding.** Every republish mints a
   new `revisionId` [VERIFIED via `meeting-tracker-transcription/service.js:480`]
   and the binding recipe hashes it [VERIFIED via
   `presentation-transcript-binding.js:28-34`].
3. **Summary drafts are a new content-bearing surface.** The transcript
   publication table holds label-only drafts [VERIFIED via
   `063_meeting_tracker_transcription.sql:91`]. Drafts as Dataverse DRAFT
   rows would be served outside, because the winner rule excludes only
   SUPERSEDED [VERIFIED via `material-model.js:124-129`].
4. **The summarization acknowledgment had no named store.** The upload-time
   acknowledgment persists only a timestamp [VERIFIED via
   `transcription-pilot/runtime.js:14,47`]. Resolved: per Summarize request,
   stored on the draft row.
5. **The §4.7 constraint migration was already done** (068/069).
6. **Async audit applies.** The existing transcript route runs at
   `maxDuration: 120` [VERIFIED via
   `pages/api/meeting-tracker/visits/[requestId]/transcriptions/presentation-transcript.js:8`];
   a long summary call needs the 300 s ceiling and a card-side guard against
   a response landing after the PC switched requests.
7. **Inline text needs a byte read.** The feed projects descriptors only and
   has no Graph reads (grep of `logistics-service.js` for Graph or fetch: 0
   hits).
8. **Both outside pages pass the summary through unbound** [VERIFIED via
   `presentation-page-service.js:94-99`, `briefing-page-service.js:291-295`];
   Stage 2 binds it on both, at listing and open time.
9. Stage 3 input reads the bound Staff Discussion Transcript row; the
   applicant PDF is chosen from `APPLICANT_SLIDES` by content type, since
   portal PDFs and sources share that type [VERIFIED via
   `site-visit-materials/contributor-service.js:44-45`].

Owner decisions, 2026-10-05:

- **A.** A names-edit republish hides the published summary outside until it
  is re-summarized and published; staff keep it with an "earlier transcript
  version" note.
- **B.** `sonnet` only, no fallback (amends §7 decision 4).
- **C.** Synchronous generation in a 300 s route; a draft is written only on
  success.
- **D.** Staff Deliberations reads the bound summary file from SharePoint at
  feed time, size-capped, falling back to the link.

## 17. Stage 2 build record, 2026-10-05 (branch `feature/presentation-summary`)

**Status: source-built, not merged or deployed.** Built by Claude Opus 5.5
directly in three commits (binding and outside pages; server; UI).

What was built:

1. **Outside binding** (`bindTranscriptSummary`): both outside pages serve the
   Transcript Summary only when its `wmkf_inputfingerprint` equals the
   SHA-256 of (producer, request, 100000007, current `revisionId`, confirmed
   `endMs`); a missing fingerprint fails closed. Mutation-checked: restoring
   the unbound pass-through turned all ten new outside-page cases red. The
   Meeting Tracker overview reports `transcriptSummary {state, artifactId,
   publishedAt}`.
2. **Prompt** `meeting-transcript.presentation-summary`
   (`shared/config/prompts/meeting-presentation-summary.js`): untrusted
   `presentation_transcript` (400,000 chars; the service refuses a longer
   transcript rather than letting the wrapper truncate it) and
   `presentation_slides` (60,000 chars, clipped by the service); raw output,
   no raw retention; seed script with `sonnet` on the row; standing Executor
   budget 16,000 tokens and 240 s; A7 registry entry `inv: 33`.
3. **Drafts** (migration 070, `summary-draft-store.js`): one row per
   Summarize run; the acknowledgment is written before the provider call, so a
   failed call keeps its record (resolves the §6 gap between "ack on the
   draft" and "draft only on success"); text only while `ready`; daily
   maintenance clears expired text. SQL exercised against a throwaway local
   Postgres 16 with untyped parameters.
4. **Service and routes**: `transcript-summary-service.js`;
   `.../transcriptions/summary-draft` (GET, POST at 300 s, PATCH, DELETE) and
   `.../summary-draft/publish`. Publish claims the draft before any external
   write (see the review below), refuses a draft whose revision or
   boundary is no longer current (`summary_draft_stale`), writes a
   BOM-prefixed TXT to `Site Visit - Transcript Summary/`, pins the eTag,
   supersedes older summaries, and clears the draft text.
5. **Card** (`SummaryBlock`): acknowledgment checkbox (cleared after each
   run), Summarize, an editable draft with Save, Publish, and Discard; publish
   is disabled for a draft from an earlier transcript version.
6. **Staff Deliberations**: the workbench logistics read (opt-in
   `includePresentationSummaryText`) returns the summary text, read from
   SharePoint only when the bytes match the pinned hash; the segment shows the
   first section with "Read more" and marks a stale summary.

Named deviations from the plan text:

- **Binding field.** The summary binds through `wmkf_inputfingerprint`, not
  `wmkf_generationkey`: a summary can be republished at the same revision and
  boundary, and the generation key is a unique alternate key. The generation
  key is per publish (draft id + content SHA-256), stable across retries.
- **No `requireAcceptedLlmResponse` call.** The Executor already throws on a
  refusal, a `max_tokens` stop, and any other non-terminal stop
  (`execute-prompt.js`); the service maps those to 422/502 copy.
- **No `APP_MODELS` row** (§16 finding 1).
- **Shared writer helpers.** `uploadAndVerify`, `settleWinner`, and
  `recordReconciliation` are exported from the derivative writer with
  label/code parameters whose defaults keep its behavior; its 21 tests pass
  unedited.
- **Staff feed cost.** One SharePoint read per Staff Deliberations load when
  a summary exists; the Meeting Tracker visit page does not opt in.

**Codex adversarial review (2026-10-05), two high findings, fixed on the branch:**

1. **A discarded or replaced draft could still be published.** Publish read the
   draft once and then wrote externally while discard and a new run were
   unfenced. Fix: publish first claims the draft (`ready` → `publishing` at the
   expected version) before any external write; edit, discard, and a new run
   act only on `ready` rows; the claim is released to `ready` only when no
   registry write was attempted, otherwise only a retry (same key, same file)
   can finish it. Exercised against a throwaway Postgres 16; service tests
   cover claim-before-write, release on stale or upload failure, no release
   after a registry attempt, and a retry after a failed final mark.
2. **A republish could overwrite a published file.** The filename used the
   draft's creation minute with `replace`. Fix: the claim closes the
   edit-after-registration path, and the filename uses the creation second, so
   it is unique per draft. A retry that finds the existing row does not
   re-verify its file; outside pages already refuse a file whose eTag differs
   from the pinned one, so the failure mode is hidden, not wrong content.

**Codex re-review (2026-10-05), three findings on the first fix, fixed:**

1. **The claim was not exclusive.** A second publish could re-claim a
   `publishing` row and its error path release the first publisher's claim,
   letting a discard run while the first publish registered the text. Fix: an
   owner token on every claim; claim, release, yield, the registry-phase flag,
   and the final mark all require it; a claim held by a running publish is
   refused (takeover only after 180 s).
2. **"Registration attempted" lived in one request's memory**, so a later
   retry that failed early could release an already registered draft to
   `ready`, and an edited republish could overwrite the published file. Fix:
   the durable `publish_registration_attempted` flag, set just before the
   first registry write, blocks release forever; the filename adds the draft
   version (`…-143210-v2.txt`), which every edit bumps, so different text never
   reuses a path.
3. **A stuck `publishing` draft had no UI recovery** once the transcript
   changed. Fix: a new Summarize retires a `publishing` row that no request
   holds, and the card offers it beside Publish again.

All three exercised against a throwaway Postgres 16 (A holds, B refused and
unable to release; registration then two failed retries never return to
`ready`; takeover only after 180 s; recovery by a new run) and in service
tests with a stateful store stand-in; each service guard mutation-checked.

Open items:

- **Pre-Site distribution email allowlist** still offers Transcript Summary
  rows (bound or stale) as staff-selected SharePoint links; same open owner
  decision as §11.
- **Owner-run order before merge:** (1) `node scripts/apply-migrations.js`
  for 070; (2) `node scripts/seed-meeting-presentation-summary-prompt.js
  --dry-run`, then `--execute` with `DATAVERSE_PROD_WRITE_ACK`. The seed must
  precede the merge: an Admin budget publication reads every standing
  prompt's row, so publishing budgets would fail until this prompt exists.
- **Acceptance on 1003222:** summarize with and without the slide PDF, edit,
  publish, open the Board link and see the summary; edit speaker names,
  republish, and confirm the Board link hides the summary while Staff
  Deliberations shows it as stale.

