---
title: Site Visit page redesign
domain: transcription
kind: plan
status: built-in-branch
summary: "Proposal to rework the Meeting Tracker Site Visit page under DESIGN.md's Page Structure rules: each finished artifact becomes one row (name is the link, audience and status chips, a … menu), steps collapse once done, the Board link sits with what the Board sees, and the queue's card notes are sorted into layout, client-behavior and server slices."
owner: product-engineering
related:
  - docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md
  - docs/plans/ZOOM_ATTENDANCE_ATTRIBUTION_PLAN_2026-10-09.md
  - docs/CURRENT_WORK_QUEUE.md
---

# Site Visit page redesign

Status: **built on `claude/site-visit-redesign`** (Session 593, 2026-10-11): commits 1-7 are
built and each was approved by Codex adversarial review; not merged. See §9.6 for the
build log and §10 for what remains. Scope was decided before the build. The owner answered §8: the whole page is in scope, the Board link sits on the
Results "Board page" heading, and TXT/VTT downloads live in the row menu. The build brief
(§9: reusable pieces, header identity source, action inventory, commit order,
verification) is written; the build has not started.

## 1. Problem

The Site Visit page (`pages/meeting-tracker/visits/[requestId].js` →
`shared/components/meeting-tracker/SiteVisitEditor.js`) grew one stage at a time
(transcription, paired summaries, Zoom import and copy, attendance, presentation
video). Each stage added its own line of status text and its own buttons, and nothing
was removed. The owner's screenshot of step 3, "Results", on 1003222
(2026-10-10) shows the result:

- **The word "Open" appears six times:** Open (presentation transcript), Open
  published summary, Open video, Open (staff discussion transcript), Open published
  summary, Open recording. Each artifact is a sentence plus a separate button, so
  the button label repeats and the artifact's name is never the thing you click.
- **Prose where state belongs.** "Eligible for the Board page." / "Presentation
  transcript ready for the Board link." / "Published Oct 10 at 5:35 PM. Available
  to staff and eligible for the Board link." / "Staff only. Never included on the
  Board page." say the same two facts, audience and status, in four phrasings.
- **Re-run actions sit beside finished work.** "Summarize again" (×2, both disabled)
  and "Create presentation video" sit next to published or approved items.
- **The AI-consent checkbox stays at the top of Results** after both summaries are
  published. It means something only at the moment someone asks for a summary.
- **Inconsistent download controls.** The full meeting offers Download TXT and
  Download VTT, while the split transcripts offer only Open.

The rest of the page shares the same root cause. `docs/CURRENT_WORK_QUEUE.md`
"Redesign the Recording and transcript card" logs eleven more owner observations
from the first live Zoom import: three refresh controls, stacked banners, an
off-screen replace confirmation, a "Copy video" link whose row is unclear, and
others.

**[VERIFIED via source]** The card is one 3,502-line component,
`RecordingAndTranscriptCard.js`. Step 3 is `TranscriptWorkflow` at `:3316-3348`.
The rows come from `DerivativeLine` (`:3011`), `SummaryBlock` (`:2719`),
`PresentationVideoLine` (`:3043`) and `PresentationLinkBlock` (`:3430`).

## 2. Approach: apply the Page Structure rules, not new taste

DESIGN.md's Page Structure rules (adopted 2026-10-05) say "existing pages conform
when they are next reworked". This is that rework. The visual language is
unchanged (Clear Workbench: neutral surfaces, ink primary, semantic chips), and so
is every function. What changes is how the page is put together. Each complaint
maps to a named rule:

| Complaint | Rule | Change |
|---|---|---|
| Six "Open" buttons; prose status | 8 Finished-Work, 10 Status-Once, 11 One Button Vocabulary | One row per artifact: **the name is the link**, then an audience chip, a status chip, a timestamp and a "…" menu |
| "Summarize again" / "Create presentation video" beside finished work | 8 Finished-Work | Re-run, replace and regenerate move into the row's "…" menu |
| Consent checkbox always visible | 6 Section Order | Ask for consent in the confirmation that opens when someone chooses **Summarize** |
| All three steps open at once; manual uploads always visible | 9 Stepper | Only the next incomplete step is expanded; finished steps collapse to one line |
| Three refresh controls, stacked banners | 15 State | One status region per card and one Refresh; the card reloads itself after its own writes |
| Raw Board URL in monospace | 16 No Internal Identifiers | "Board page" label with Open and Copy link |
| Header `Site visit · #1003222` only | 2 Left Header, 4 Identity-Always | Header shows number, institution or title, program and cycle, plus one status chip |

Page type: **Record Detail** (one visit for one request).

## 3. Page layout (proposed)

> **Revised by owner decisions 7-10 (§8.2):** the Recording and transcript card is now four
> cards (Recording setup, Presentation, Staff discussion, Board materials). The mockup below
> shows the first build.

Mockup values (institution, dates, durations, counts) are illustrative.

```
← Meeting Tracker
Site visit · #1003222  Caltech — <short title>                 [Board page ready ●]
Research Program · June 2026 cycle · Visit Oct 9, 10:00 AM PT (Zoom)

┌ Visit details ───────────────────────────────────────── [Edit] ┐
│ When · Format · Meeting link · Organizer · Attendees (counts)  │   read-only strip
└────────────────────────────────────────────────────────────────┘
┌ Applicant materials   Ready · files open on the briefing page … ┐
│ Due Oct 3 · sent to Jane Doe (jdoe@…) · invited Sep 20          │   one metadata line
│ Presentation slides     Received Oct 2 · staff upload        …  │
│ Presentation source     Received Oct 2                       …  │
│ Participant bios        Missing                  [Upload file]  │
└────────────────────────────────────────────────────────────────┘
┌ Recording and transcript ──────────────────────────────────────┐
│ ✓ 1 Recording        Zoom, Oct 9 · 62 min · transcribed Oct 9 … │   collapsed
│ ✓ 2 Speakers and end 7 speakers · presentation ends 0:58:12  … │   collapsed
│ ● 3 Results          (expanded; see §4)                        │
└────────────────────────────────────────────────────────────────┘
```

- **Header status chip** (Status-Once): one chip naming where the visit stands, in
  lifecycle order, taken from the first stage not yet finished:
  `Materials not requested` (gray) → `Waiting on materials` (gray; amber when
  overdue) → `Materials need attention` (amber) → `No recording yet` (gray) →
  `Board page incomplete` (amber: a Board item is missing or out of date) →
  `Board page ready` (green: materials ready and all three presentation items
  current). Each card shows its own one-line state in its heading (as text, not a
  second chip). This replaces the scattered "eligible for the Board link" sentences.
- **Identity:** the header needs the request title, institution, program and cycle.
  [ASSUMED] the editor loads only `requestNumber` today (`SiteVisitEditor.js:308`
  renders `Site visit · #<number>`). The builder must find the cheapest existing
  source for the rest before adding a fetch.

### 3.1 Visit details

- **Read view:** a compact definition strip (When, Format, Meeting link, Organizer,
  attendee counts that expand to names). Edit stays behind **Edit visit details**
  (Read-First Rule).
- **Edit form, People Picker Rule (14):** today the form renders every staff and
  Board member as a chip **twice**, once under Required attendees and once under
  Optional attendees (`SiteVisitEditor.js`, the `[['requiredAttendees', …],
  ['optionalAttendees', …]]` map). The rule forbids rendering the same list twice
  and asks for a typeahead above eight people. Proposed: one **Attendees** picker
  (a typeahead when the directory holds more than eight people, chips otherwise)
  with a selected list where each person has a Required / Optional toggle.
  Organizer uses the same picker in single-select mode. Applicant-side attendees
  (AkoyaGo suggestions plus manual name and email) keep their own section, since
  they come from a different source.
- The explanatory line "The date here feeds the Staff Deliberations rail…" stays,
  shown only while scheduling or editing (as today).

### 3.2 Applicant materials

The same row pattern as Results (§4):

- **Heading line:** "Applicant materials" plus the collection's state as one short
  phrase (from `STATE_COPY`, shortened: "Waiting on the applicant", "Needs
  attention", "All received, confirm the files open", "Ready", "Closed").
- **One metadata line** replaces the three-column Due / Link open until / Sent to
  grid: due date (amber when overdue), recipients, invited and reminded dates.
- **Rows:** the item name is the link to the file (today a separate open link sits
  at the row's right, `OpenFileLink`). Then the received date, "staff upload" when
  it applies, and a "…" menu with **Upload updated file** and **Waive** /
  **Require again**. A missing item shows **Upload file** inline instead of the
  menu. A waived item stays struck through.
- **Card actions:** the one inline primary is the next step: **Request materials**
  (no collection), **Send reminder** (missing), or **Confirm the files open**
  (received). Copy contributor link, Send invitation again and Add other file move
  to the card's "…" menu. The hand-colored buttons in this card become shared
  `Button`s (One Button Vocabulary).
- Upload progress and attention notices stay in their row, as today.
### 3.3 Recording and transcript

- **Earlier runs** (`EarlierRuns`) moves into step 1's "…" menu as "Earlier
  transcriptions", collapsed (Section Order: history comes last).

## 4. Results step (the screenshot), proposed

> **Superseded in layout by §8.2 (owner, 2026-10-11):** the rows below now sit in the
> Presentation and Staff discussion cards, and the Board link heads a Board materials card
> at the bottom with a status-only readiness list. Row anatomy and the state table (§4.1)
> are unchanged.

```
3  Results
   BOARD PAGE            Link expires Dec 31          [Copy link]  [Open Board page]  …
   ──────────────────────────────────────────────────────────────────────────────────
   Presentation transcript     Ready       Oct 10, 5:35 PM                         …
   Presentation summary        Published   Oct 10, 5:35 PM                         …
   Presentation video          Approved    Oct 10, 4:12 PM  · 60 min               …

   STAFF ONLY
   ──────────────────────────────────────────────────────────────────────────────────
   Staff discussion transcript Ready       Oct 10, 5:35 PM                         …
   Staff discussion summary    Published   Oct 10, 5:35 PM                         …
   Full meeting recording      Copied      Oct 9                                   …
   Full meeting transcript     Published   Oct 9                                   …
```

- **The artifact name is the link** (opens in a new tab; summaries and transcripts
  open in SharePoint; the video plays rather than downloads, see §6 C3). The screen
  has no "Open" button.
- **Audience is the group heading, not a sentence per row.** The "Board page" and
  "Staff only" headings replace four sentences. The Board page group heading also
  holds the link controls, so the link sits next to what it shows.
  `PresentationLinkBlock`'s two explanatory sentences shrink to a tooltip or
  one muted line ("Shows applicant materials and the three items below. No email
  is sent.").
- **"…" menu per row** holds the actions that apply to that row's current state:
  - Full meeting transcript: Download TXT, Download VTT. (The split transcripts have no
    download route; see §9.3.)
  - Summaries: Summarize again, Open draft (when one exists).
  - Video: Create again, Show cut details.
  - Recording: Replace recording, Upload manually.
- **A row that needs action shows that action inline instead of a quiet status**,
  and only one ink primary appears in the region: the next one in order. For
  example, "Presentation summary · Draft ready · **Review and publish**", or
  "Presentation video · Ready to check · **Check the ending and approve**".
- **Gating stays visible** (feedback: UI gates must mirror server guards). A menu
  item the server would refuse is disabled with its reason shown, for example
  "Summarize again: presentation end not confirmed". It is never silently removed.
- **AI consent** moves into the Summarize confirmation, with the same text
  (`PAIRED_SUMMARY_ACKNOWLEDGMENT`, unchanged), shown each time a summary run is
  requested. The paired "Summarize both" action remains the inline primary when
  neither summary exists.

### 4.1 State → row table (from states already in the code; none invented)

| Row | Code state | Status chip | Inline action / menu |
|---|---|---|---|
| Presentation / discussion transcript | `bound` | Ready (green) | menu: Download TXT, VTT |
| | `stale` | Out of date (amber) | inline **Regenerate** (today: "Generate it again in step 2"); with C1 the chip reads "Updating…" |
| | `missing` | Not made yet (gray) | inline **Generate** if a presentation end is confirmed, else "Needs presentation end" |
| | other / unknown | Not available (gray) | none |
| Summary (either kind) | published, `bound` | Published (green) | menu: Summarize again |
| | published, `stale` | Out of date (amber); staff can open, the Board does not see it | inline **Summarize again** |
| | draft | Draft ready (blue) | inline **Review and publish** |
| | running | Summarizing… (gray) | none |
| | none | Not made yet (gray) | inline **Summarize** (paired when both are missing) |
| | slides changed after summary | Published + amber note "Slides updated since" | menu: Summarize again |
| Presentation video | `queued`/`cutting`/`uploading` | Working… (gray) | none |
| | `review` | Ready to check (blue) | inline **Check the ending and approve**; menu: Create again |
| | `registering` | Approving… (gray) | inline **Finish approving** |
| | `approved`, Board ready | Approved (green) | menu: Create again |
| | `approved`, `boardReady === false` | Out of date (amber) | inline **Create again** |
| | `approved`, `boardReady == null` | Approved + muted "Board status not checked" | menu |
| | `superseded` | Out of date (amber) + reason (see C2) | inline **Create again** only when a retry can succeed |
| | `failed` | Failed (red) + `PV_FAILURE_TEXT` reason | inline **Try again** when retryable |
| Full recording | RECORDING material present | Copied / Linked (gray) | menu: Replace, Upload manually |
| Full transcript | generated | Published (green) | menu: Download TXT, VTT |
| | uploaded file | Uploaded (gray) | menu: Replace |

## 5. Steps 1 and 2

- **Step 1, Recording:** while not done, Zoom import is the only expanded path.
  "Upload manually" (MP4 and finished transcript) sits behind one disclosure, or
  shows directly when Zoom is unavailable for the request. Each Zoom recording row
  carries its own "Copy video" action and names the recording. The replace
  confirmation renders inside the clicked row and takes focus. When done, the
  step is one line with a "…" menu: Replace recording, Import another from Zoom,
  Upload manually, Earlier transcriptions.
- **Step 2, Speakers and presentation end:** when done, one line
  ("7 speakers named · presentation ends 0:58:12 · confirmed Oct 10") with a "…"
  menu for Edit speaker names and Edit presentation end. While a newer Zoom
  transcription is pending, those edit items are disabled with "A newer
  transcript is being made" (queue: old-transcript edit buttons look current).
- **Order** follows the queue item: import from Zoom → transcript → confirm the
  presentation end → presentation video. Video creation stays in Results, since
  it depends on the confirmed end.

## 6. Queue observations, sorted by what they cost

Not every item in the queue entry is layout. Proposed slices:

**A. Layout and copy (this redesign; client only)**
- Results rows, group headings, "…" menus, consent at invocation (§4).
- Stepper collapse; manual uploads behind a disclosure; step order (§5).
- One status region and one Refresh per card.
- "Copy video" inside its recording row, naming the recording.
- Board link: label plus Open and Copy link; the raw URL is no longer shown.
- Header identity and status chip.
- Visit details: compact read strip; one Attendees picker with a per-person
  Required / Optional toggle (the saved `requiredAttendees` / `optionalAttendees`
  shape is unchanged) (§3.1).
- Applicant materials: the same row pattern and card "…" menu (§3.2). One shared
  row component serves both cards.

**B. Client behavior (same build, separate commits)**
- Reload after the card's own writes; keep amber and red banners for real
  conflicts from another session.
- Replace confirmation in the clicked row, with focus moved to it.
- Disable the published transcript's edit actions while a newer transcription is
  pending.
- Hinted leavers start unchecked in Discussion attendance. **Already decided by
  the owner**; it reverses decision D2 of the attendance plan, so the plan text is
  updated in the same change. This touches
  `lib/services/meeting-tracker-transcription/attendance-service.js` (rows are built
  `kept: true` at `:35`) and is a one-line behavioral change with its test.

**C. Server-side (separate slices, each with its own review)**
- C1. Generate the presentation and discussion transcripts automatically after a
  publish that has a confirmed presentation end. Step 3 then reads "Updating…"
  instead of "out of date".
- C2. Record and show the actual reason a presentation video was superseded.
  Today every supersede maps to the same `PV_STALE_TEXT`. Suggest "Create
  again" only when a retry can succeed.
- C3. Stream the review video instead of a 450 MB download
  (`resolvePresentationVideoSplitOpen` redirects to Graph's download URL).

Recommendation: build A + B as one branch with UX and behavior in separate
commits, then C1-C3 as independent slices. Until C1 ships, the redesign shows the
stale state with an inline **Regenerate** rather than pretending the regeneration
is automatic.

## 7. Boundaries

- No change to what the Board page or briefing page shows, to any storage
  contract, or to any route. Slice A is UI only. The one possible exception is
  the header identity (§3): if no loaded source already carries the title,
  program and cycle, adding it is a read-only change, called out as its own
  commit.
- Every current action survives. Each one moves to a row's inline slot or its
  "…" menu, and none is dropped. A builder must produce an action inventory
  (old location → new location) and confirm none is missing.
- The visual language stays as DESIGN.md defines it: chips use their semantic
  meanings, there is one ink primary per region, and buttons come from the shared
  `Button` (the card's hand-rolled `BTN` string converges on it).
- Desktop first. Narrow widths need only avoid overflow.
- The 3,502-line component is split along the new structure (Results rows,
  steps, Zoom import) only as far as the rework needs. This is not a separate
  refactor.

## 8. Owner decisions (2026-10-11)

1. **Scope: the whole page.** Header, Visit details (read view and edit form),
   Applicant materials, and Recording and transcript (§3-§5).
2. **Board link: on the Results "Board page" heading**, next to what the Board
   sees (§4), not as the page header's primary action.
3. **TXT and VTT downloads live in the row's "…" menu**, for the split transcripts
   and the full meeting transcript alike.

### 8.1 Owner decisions before the remaining build (2026-10-11)

4. **Header identity:** add the opt-in read-only request lookup on the Meeting Tracker visit
   endpoint (§9.2).
5. **Branch:** after the build and its final review, push `claude/site-visit-redesign` only;
   no merge or Production deploy. The owner merges.
6. **Attendees picker:** a search box plus a selected list with Required/Optional per
   person (§3.1).

### 8.2 Owner decisions after the first desktop look (2026-10-11)

The Board section is used rarely (an interested member); every staff member uses this page.
So the results are organized for staff:

7. **Four cards in work order:** Recording setup (steps 1 and 2; the one Refresh for all four
   cards sits on its heading), then **Presentation** (video, transcript, summary), then
   **Staff discussion** (transcript, summary), then **Board materials** at the bottom. Setup
   comes first because every result depends on it; once done its steps are one line each.
8. **The full meeting recording and full meeting transcript sit in Staff discussion.** There
   is no discussion video, so the full recording is how staff watch the discussion.
9. **Board materials:** the link actions (Generate, Copy, Open, Issue new link) plus a
   status-only readiness list: Presentation transcript, Presentation summary and (when the
   feature is on for the request) Presentation video, each "On the Board page", "Not yet" or
   "Status unknown". Actions stay in the Presentation card. Applicant materials are not
   repeated: the card's data does not include them, and the Applicant materials card lists
   them; the Board card's note says the Board page shows them.
10. The per-row "Not on the Board page until it is generated" note is removed; the readiness
    list carries that.

## 9. Build brief (Session 593, 2026-10-11)

Branch `claude/site-visit-redesign` off `main`, Tier 1 runtime UI (campaign release
strategy). Keep UX and behavior changes in separate commits. Each slice gets a
Codex adversarial review before the next one starts; the whole branch gets one at
the end.

### 9.1 Reusable pieces (found, not to be rebuilt)

- **"…" menu:** `shared/components/workbench/OverflowMenu.js` already takes
  `items: [{ key, label, onSelect?, href?, download?, disabled?, title? }]`,
  portals, flips upward, and closes on outside click. It is used by
  `StaffDeliberationsTab.js` and `SessionEditor.js`. Import it from its current path;
  do not move it in this branch. A disabled item's reason goes **in the label**
  ("Summarize again · needs presentation end"), because `title` is only a tooltip.
- **Buttons:** `Button` in `shared/components/Layout.js` (primary, secondary,
  outline, danger). The card's `BTN`, `BTN_PRIMARY` and `BTN_LINK` strings and the
  materials card's hand-colored buttons converge on it.
- **Steps:** the card's own `Step` component (`RecordingAndTranscriptCard.js:2992`)
  stays and gains a collapsed one-line form. No suite stepper component was found
  to reuse.
- **Header:** `PageHeader` in `Layout.js` is the centered hero form (the Left
  Header Rule reserves that for the suite home). Keep the editor's own left-aligned
  header markup and extend it.
- **New shared piece:** one `ArtifactRow` (name as link, status chip, timestamp or
  detail, then an inline action **or** an `OverflowMenu`) under
  `shared/components/meeting-tracker/`. Results and Applicant materials both use it.

### 9.2 Header identity source

[VERIFIED via `SiteVisitEditor.js:179`] The request number comes from the `?n=`
URL parameter. [VERIFIED via `lib/services/site-visit/logistics-service.js:430-480`]
The visit GET (`getSiteVisitLogistics`) returns the visit, materials, presentation
descriptors and applicant suggestions, but not the request's title, institution,
program or cycle. `/api/workbench/resolve-request` has those fields but is guarded
by `requireAppAccess('reviewers')` (`pages/api/workbench/resolve-request.js:28`), a
different grant from `meeting-tracker`, and also returns the Proposal tab's
payload.

**Recommendation:** add an opt-in `includeRequestIdentity` to
`getSiteVisitLogistics`, following the existing `includeApplicantAttendees`
pattern so the Workbench read keeps its shape and cost. Only the Meeting Tracker
visit GET (`pages/api/meeting-tracker/visits/[requestId]/index.js`) passes it.
It returns `request: { requestNumber, title, institution, grantProgram,
cycleLabel }`, computed the way `resolve-request-service.js` computes them
(`akoya_title`, `requestInstitution`, the formatted `_wmkf_grantprogram_value`,
`meetingDateToCycleCode`/`cycleCodeToLabel`). [ASSUMED] This costs one more
read-only request row read. Check first whether the request row is already read
inside this call (for example by `resolveApplicantContacts`) and reuse it.

The header falls back to `?n=` while the visit is loading or after an error
(Identity-Always). This is the only server change in slices A/B. It needs
`/contract-reconcile` (route → service → UI), an `API_ROUTE_SECURITY_MATRIX.md`
row update, and a check of the Atlas page that covers this read.

### 9.3 Action inventory (old → new)

Every current control, by component. "Inline" means the row's single visible
action; "menu" means the row's or card's `OverflowMenu`. **Unchanged** means the
control stays where it is, inside an editor or form that is open only while that
work is in progress. Builders tick each line off in the slice that moves it, and
`ArtifactRow` tests assert the menu contents per state from §4.1.

**Page (`SiteVisitEditor.js`)**

| Control | Now | New |
|---|---|---|
| Back to the cycle schedule (`:299`) | header and page bottom | unchanged |
| Edit visit details (`:144`) | Visit details card | Visit details strip, right |
| Open meeting link (`:150`) | Visit details row | strip, labeled with its host |
| Organizer / attendee chips (`:163`), applicant suggestion Add (`:375`), manual Add (`:397`) | edit form | one Attendees picker with Required/Optional per person; applicant section kept (§3.1) |
| Cancel / Save site visit (`:404-405`) | edit form | unchanged |

**Applicant materials (`SiteVisitMaterialsCard.js`, `StaffMaterialUpload.js`)**

| Control | Now | New |
|---|---|---|
| Request materials (`:240`) | card header | card inline primary when there is no collection |
| Open file (`OpenFileLink`, `:53`) | row right | the item name is the link |
| Waive / Require again (`:279`) | row right | row menu |
| Upload file (`StaffMaterialUpload`) | row right | inline on a missing row |
| Upload updated file (`StaffMaterialUpload`) | row right | row menu (it opens the file picker; progress and errors stay in the row) |
| Add other file (`:308`) | below list | card menu |
| Copy contributor link (`:315`) | card footer | card menu |
| Send invitation / again (`:317`) | card footer | card menu |
| Send reminder (`:321`) | card footer | card inline primary when state is `missing` |
| Confirm the files open (`:324`) | card footer | card inline primary when state is `received` |

**Recording and transcript, step 1 (`RecordingAndTranscriptCard.js`)**

| Control | Now | New |
|---|---|---|
| Replace audio or transcript / Close (`:3244`) | step 1 header link | collapsed step 1 menu: Replace recording or transcript |
| Cancel this transcription (`:3262`, `:2614`) | progress line, earlier runs | unchanged (in-progress work) |
| Refresh (`:3263`, `:3238`, `:2522`, `:2780`, `:2791`, `:2795`) | progress line, conflict banner, review, summary blocks | **one** card-level Refresh in the status region; the card reloads after its own writes (§6 B) |
| Import from Zoom / Try again (`:2917`, `:2924`) | Zoom section | unchanged while step 1 is open |
| Refresh list (`:2935`) | Zoom section | folded into the card Refresh |
| Zoom recording radio, acknowledgment, Import… (`:2961`, `:2979`, `:2982`) | Zoom section | unchanged |
| Copy video / Try again (`:2967`) | below its row | inside its recording row, naming the recording |
| Cancel copy / Try again (`:2905`, `:2907`) | copy status | in the recording row |
| Replace and continue / Keep current file (`:2878-2879`) | after the list | inside the clicked row, focus moved |
| Other ways to add a recording (`:3277`) | step 1 | "Upload manually" disclosure |
| Upload a finished transcript instead (`:3224`), Upload transcript (`:2673`) | step 1 | inside "Upload manually" |
| Audio/VTT pickers, acknowledgment, Transcribe, Add Zoom captions, Continue without it (`:2631-2649`) | step 1 | inside "Upload manually" |
| Replace recording, Save Zoom link, Upload MP4, Pause (`:3366-3384`) | Video recording block | inside "Upload manually"; Replace recording also in the step 1 menu |
| Resume / Retry upload / Finish saving / Cancel / Cancel upload / Keep upload (`:3407-3417`) | unfinished uploads | unchanged (in-progress work; shown whenever present) |
| Review / Discard this draft (`:2611-2612`) | Earlier runs | step 1 menu: Earlier transcriptions (opens the list) |
| Check now / Close this attempt (`:2580-2581`) | attention block | unchanged (real attention; stays visible) |

**Step 2**

| Control | Now | New |
|---|---|---|
| Edit speaker names / Continue editing names (`:3291`) | step 2 | collapsed step 2 menu; disabled with its reason while a newer transcription is pending |
| Set presentation end (`:3296`) | step 2 | step 2 inline primary while no end is confirmed |
| Edit / Continue editing presentation end (`:3299`, `:2797`) | step 2, summary block | step 2 menu (same disabling) |
| Generate presentation and discussion transcripts (`:3304`) | step 2 | inline **Regenerate** on the stale or missing transcript row in Results (§4.1); removed from step 2 |
| Review editor: Use {name}, Use proposed, Use this line instead, Download draft TXT/VTT, Save, Publish transcript, Cancel, Discard this draft (`:2346-2552`) | review block | unchanged (open editor) |
| Discussion attendance checkboxes (`:2455`) | review block | unchanged; default `kept` changes (§6 B) |

**Step 3, Results**

| Control | Now | New |
|---|---|---|
| Consent checkbox + Summarize presentation and discussion (`:2705-2711`) | top of Results | inline **Summarize** on the summary rows (paired when both are missing); consent moves into the confirmation it opens |
| Summarize again / Replace draft with a new summary / Try again (`:2766`) | summary block | row menu when published and current; inline when stale or failed (§4.1); same confirmation |
| Open published summary (`:2778`) | summary block | the summary name is the link |
| Check again (`:2777`, `:2779`) | summary block | card Refresh |
| Load latest (`:2805`), Publish summary, Save draft, Discard draft (`:2827-2835`) | draft editor | unchanged (open editor); the row's inline action **Review and publish** opens it |
| Open (split transcripts, `:3020`) | transcript lines | the transcript name is the link |
| Download TXT / VTT (split transcripts) | not offered | still not offered: the download route serves only the full TRANSCRIPT artifact (`downloadMeetingTranscript`, `lib/services/meeting-tracker-transcription/service.js:615-622`), so adding it is a server change outside this build |
| Open video (`:3148`) | video line | the video name is the link (streams once C3 ships) |
| Check the ending and approve / Approve video / Not yet (`:3149`, `:3157-3158`) | video line | inline action on the video row; confirmation unchanged |
| Finish approving (`:3150`) | video line | inline action |
| Create presentation video / Create it again / Create again / Keep current video (`:3151`, `:3166-3167`) | video line | inline when there is no video or it is out of date; otherwise row menu; confirmation unchanged |
| Retry (video load, `:3121`) | video line | card Refresh |
| Open recording (`:3338`) | Full meeting | "Full meeting recording" name is the link |
| Download TXT / VTT (`:3340-3341`) | Full meeting | "Full meeting transcript" row menu |
| Open transcript (uploaded, `:3343`) | Full meeting | "Full meeting transcript" name is the link |
| Generate link (`:3437`) | Board link block | inline on the "Board page" heading when no link exists |
| Open Board page (`:3443`), Copy link (`:3449`) | Board link block | "Board page" heading |
| Issue new link + confirm / Keep current link (`:3450-3457`) | Board link block | "Board page" heading menu; confirmation stays inline |

### 9.4 Commit order

1. **`ArtifactRow` + Results (UX).** Board page and Staff only groups, Board link
   on the heading, row menus including the TXT/VTT downloads, and consent in the
   Summarize confirmation. This is the screenshot and the biggest gain. Card tests
   that select "Open" or "Open published summary" by text are updated to the
   name-link queries in the same commit.
2. **Steps 1-2 collapse (UX).** One-line done states with menus, the "Upload
   manually" disclosure, "Copy video" in its row, and Earlier transcriptions in
   the menu.
3. **Card behavior (B).** One status region and one Refresh, reload after the
   card's own writes, the in-row replace confirmation with focus, and disabled
   stale edit actions.
4. **Hinted leavers start unchecked (B).** In `attendance-service.js`, plus its
   test, plus the D2 text in `ZOOM_ATTENDANCE_ATTRIBUTION_PLAN_2026-10-09.md`.
5. **Applicant materials rows (UX).**
6. **Visit details strip and Attendees picker (UX).** The saved attendee shape is
   unchanged.
7. **Header identity.** 7a: server opt-in read (§9.2), with `/contract-reconcile`
   and the matrix row. 7b: header and status chip.
8. **Docs.** This plan's status, the surface brief
   `.impeccable/surfaces/onents-meeting-tracker-sitevisiteditor-js-e5657c91.md`
   (its "not a redesign" scope is superseded), the queue item, and the Atlas or
   matrix rows touched in 7a.

### 9.5 Verification

- Existing UI suites, updated rather than deleted:
  `recording-and-transcript-card{,-zoom-import,-zoom-video,-presentation-video}.test.js`,
  `site-visit-materials-card{,-t5-matrix}.test.js`,
  `meeting-tracker-visit-editor.test.js`, `site-visit-editor-t5-matrix.test.js`.
- New tests: `ArtifactRow` menu contents per §4.1 state; disabled menu items carry
  their reason in the label; no element with the accessible name "Open" remains
  in Results; the consent confirmation blocks a summary run until checked.
- Gates: `check:types`, `check:api-routes` (7a), `check:route-service-boundary`,
  `check:dataverse-access-layer` (7a), plus the doc gates for slice 8.
- Impeccable detector once over the changed UI files at the end
  (`impeccable detect --json`), then the finish review.
- Desktop check in a browser on a test request. Rendering this page reads
  Production Dataverse, so the owner either authorizes it or drives it.

### 9.6 Build log

**Commit 1, Results rows** (branch `claude/site-visit-redesign`: `b48649a14`, `a644baa6f`,
and the round-1 fix). Codex adversarial review: round 1 found that an open Summarize
confirmation could act on a changed target (high), which is now fixed. The confirmation is bound to a
signature of the transcript and each target's draft and load state, with two
regression tests. Round 2 approved with no material findings. As built, with these deviations from §4 and §9.3:

- **Unmet prerequisites keep the old card's behavior:** the action is absent and the
  reason shows as a note under the row (for example "Generate the discussion
  transcript first."). It is not yet a disabled menu item labeled with its reason
  (§4). Commit 2 revisits this when steps 1 and 2 collapse.
- **Draft summaries keep the editor open under the row.** There is no separate
  inline "Review and publish" action; the open editor is the action.
- **Approved video:** `boardReady === true` and `== null` both read "Approved". The
  unknown case adds the note "Couldn't check the Board status." The Board page group
  heading carries what "for the Board" used to say.
- **Split transcripts have no downloads** (no download route; §9.3).
- **Board link:** "Issue new link" is in the heading's menu while the link reads, and
  inline when the link cannot be read.
- **Not yet converged on `Button`:** the card's `BTN`/`BTN_PRIMARY` strings remain.
  Row actions use the outline `BTN`, so the only ink buttons in Results are confirm
  buttons. Convergence is scheduled with commit 3 (card behavior).
- **Pre-existing, unchanged:** `SummaryBlock`'s `published` falls back to the
  collection's presentation `transcriptSummary` for both kinds while the summary read
  is not current. The row's chip and detail are guarded by `summaryStatusCurrent`, so
  this does not misrender. It is left for a separate fix.

**Commit 2, steps 1 and 2 collapse.** As built:

- `Step` takes a one-line `summary` and `menuItems`. Step 1, once done, reads "Published … ·
  version … · MP4 recording · added …" with a menu holding **Replace recording or
  transcript**; opening it shows a **Close** button. Step 2, once done, reads
  "Presentation ends at … · confirmed …" with **Edit speaker names** and **Edit
  presentation end** in its menu.
- **Generate moved to Results.** It is an inline **Generate transcripts** on the first split
  transcript row that is stale or missing (one button; the endpoint makes both). Step 2 no
  longer turns current because of it, and Results turns current instead. Row details:
  "Not on the Board page until it is generated" (presentation), "Made from an earlier
  transcript", "Confirm the presentation end in step 2".
- "Other ways to add a recording" is renamed **Upload manually**.
- Each Zoom recording is one box: radio, details, its own **Copy video** (accessible name
  "Copy video from <time>") and, when asked, its replace confirmation. Moving focus to the
  confirmation is commit 3.
- **Deviations:** Earlier runs stay where they were (a collapsed `<details>` after the
  steps), not a step 1 menu item, because a ready but unreviewed run must stay
  discoverable. Step 2's summary shows no speaker count, since the count is not loaded
  without the transcript content. The open step 2 now uses a `BTN` for "Edit presentation
  end" where it had a blue text link (One Button Vocabulary).

**Commit 2 review:** Codex approved in round 1 with no material findings.

**Commit 3, card behavior.** As built:

- **One card Refresh** in the card heading (`data-testid="card-refresh"`). It reloads the
  transcription status, the materials and Board link, the Zoom list (when open) and the
  presentation video. It replaces the conflict banner's Refresh, the progress line's
  Refresh and the Zoom "Refresh list".
- **Kept in place, by DESIGN.md's State Rule** (a failed load gets its Retry where it
  failed): summary **Check again**, **Refresh transcription status** and the video's
  **Retry**. The speaker editor's **Refresh** also stays, because it preserves unsaved
  edits. The card Refresh also re-reads each summary once (Codex round 3, below).
- **Own-write staleness:** cancelling a run that had already moved on now reloads and
  shows a single warning. It no longer adds a red error plus an "Another session changed
  this" banner. That banner is kept for real 409 conflicts and now points to the card
  Refresh.
- **Old-transcript edits gated:** while a newer transcription is running or waiting to be
  checked, Edit speaker names, Edit presentation end and Set presentation end are
  disabled. In the step 2 menu each label carries "· wait for the newer transcript"; in
  the open step a note explains why.
- **Replace confirmation takes focus** (and scrolls into view) when it opens in its row.
- **Deferred to commit 3b:** converging the card's `BTN`/`BTN_PRIMARY`/`BTN_LINK` strings on
  the shared `Button` (a mechanical change across the file, kept separate so this
  behavior commit stays reviewable).
- Mutation checks: removing the gate, the focus call, or the conflict reset each fails its
  new test.
- **Codex round 1 (needs-attention, two medium findings):** (a) a discarded or unreadable ready
  run kept blocking edits; (b) the summary row's "Set end to enable summary" skipped the
  gate. Fixed by computing `newerTranscriptPending` in `useTranscription`. It is true for a
  running run not being cancelled, or a ready run whose content is still reviewable (not
  cleaned up, purged or unreadable). `beginEditNames` refuses while it holds, so every
  entry point is gated, and the summary action shows the reason. Regression tests cover
  discarded and expired runs and the summary action; reverting the gate fails all three.
- **Codex round 2 (needs-attention, one medium):** the ready-run check followed the focused
  run, so reviewing an older run from Earlier runs lifted the gate. It is now independent
  of focus. Pending means a running run not being cancelled, or an unpublished, reviewable
  ready run created after the latest published run, so an old unpublished run does not
  block forever. Two regression tests: focus switch stays blocked (fails with the
  focus-based check), and an older unpublished run does not block. The server's
  `createMeetingCorrection` checks only the current artifact; Codex noted it, and it stays
  a UI gate in this build.
- **Codex round 3 (needs-attention, one medium):** the card Refresh did not re-read summary
  drafts, so a draft created, edited or discarded in another session stayed unseen. Now,
  after the collection reload settles, the card bumps a token that `useSummaryKind` turns
  into one `loadSummary()` per kind. It skips when a key-change read is pending or in
  flight (`summaryLoadedKey !== summaryLoadKey` or loading), and `wantsSummary` is read at
  render time. Result: one read per kind per Refresh, and the read-scripted race tests are
  unchanged. Two regression tests (a draft created elsewhere appears; a draft edited
  elsewhere becomes a conflict that keeps local text) fail when the read is removed.
- **Codex round 4 (needs-attention, one medium):** a key-change read that finished before
  the rest of Refresh settled was followed by a second read. The fix runs in two phases:
  the card bumps `summaryRefresh.begin` at the start, and each kind records its read
  sequence. On `settle`, a kind reads only if no read started since `begin`. Regression:
  materials are held until the key-change read completes, and Refresh still produces
  exactly one read; the test fails without the sequence check. The owner approved this
  round (2026-10-11).
- **Codex round 5 (needs-attention, one medium):** `z.refresh` discarded the Zoom list
  promise, so Refresh re-enabled before the list settled. It now returns the read, and the
  button stays disabled while the list is refreshing. Regression: a held Zoom response
  keeps Refresh disabled and a second click starts no request (fails with both reverted).
- **Codex round 6: approve**, no material findings. Commit 3 is closed.

**Commit 3b, shared Button.** Converted all 46 card `<button>`s that used the `BTN` or
`BTN_PRIMARY` styles to the shared `Button` (`size="sm"`, `variant` outline or primary), and
removed `BTN_PRIMARY`. Kept: `BTN` on the one `<a>` styled as a button (Open Board page) and
the underlined `BTN_LINK` text actions (disclosures such as Upload manually, and quiet
actions such as Cancel this transcription or Discard draft), because `Button` has no
text-link variant. Converting those would mean adding a variant to the shared component,
which is outside this build.
- Codex review of 3b: approve (all 46 conversions checked by AST comparison).

**Commit 4, hinted leavers start unchecked.** `buildAttendanceReview` computes the
`leftBeforeEnd` hints first, sets each row's `kept` to the opposite, and derives
`excludedSpeakerIds` from the unchecked rows before `normalizeDiscussionAttribution` (which
requires them to match). Plan D2 in `ZOOM_ATTENDANCE_ATTRIBUTION_PLAN_2026-10-09.md` is
revised in the same commit. The card seeds its checkboxes from the decision rows, so no
UI change was needed; a saved attribution is unaffected.
- Codex review of commit 4: approve.

**Commit 5, Applicant materials rows.** As built (§3.2):

- Each checklist item is an `ArtifactRow`. The name is the link to the received file
  (`OpenFileLink` is removed). Status is Received, Replacing…, Waived, or Missing (amber
  when overdue). The detail keeps the date, filename, "staff upload", "waived" and
  "Previously received" wording.
- **Missing or waived item:** an inline **Upload file** (`StaffMaterialUpload`, now a
  shared `Button`). **Received item:** **Upload updated file** in the row menu, which opens
  the row's hidden uploader through a ref `open()`. Progress, errors and Retry still render
  in the row. The uploader reports `onBlockedChange`, so the menu item disables while an
  earlier file awaits Retry. Its file input stays a single stable element.
- **Waive / Require again** are in the row menu (not offered on received or closed rows,
  as before).
- **Heading:** one next-step action (**Request materials**, **Send reminder** when missing,
  **Confirm the files open** when received with no blocking jobs) and a card menu with
  Copy contributor link, Send invitation (again) and Add other file. The Due / Link open
  until / Sent to grid is one metadata line.
- Separate commit: the "Use proposed then Save" test raced its own "Saved" label (it
  failed 3 of 4 batched runs); it now waits for the PATCH and its re-render. Test-only.
- **Codex round 1 for commit 5 (needs-attention, one medium):** the uploader moved between
  the row's action slot and its children when an item became received, so a refresh
  remounted it and dropped an unfinished upload's Retry. It now stays in the action slot
  in every state, and only its trigger visibility and wrapper class change. Regression: a
  missing row with a retryable finalize, then another row's Waive refreshes in this row's
  receipt; the same Retry button remains and re-finalizes the same staging id (fails with
  the old placement).

**Commit 6, one attendee picker** (owner decision 6: a search box plus a list). As built:

- New `AttendeePicker`. A search box over the directory (up to 8 matches; a person with no
  email is listed, disabled, with `noEmailHint` on hover) and a list of the people chosen,
  each with a Required / Optional toggle and Remove. **Staff and Board attendees** replace
  the two chip fieldsets that rendered every person twice. The saved
  `requiredAttendees` / `optionalAttendees` / `organizer` shapes are unchanged; adding
  goes to Required, and switching role reuses the existing one-role-per-person `toggleIn`.
- **Organizer** uses the same picker in single mode (staff only), with **Change**.
- Applicant-side attendees (AkoyaGo suggestions plus manual entry) are unchanged.
- **Deviation:** the read-only Visit details summary is left as built. It is already
  read-first and compact (a two-column definition list) and already shows names, not ids.
- **Codex round 1 for commit 6 (needs-attention, one medium):** the per-list limit (100,
  manual rows included) blocked adds once Required was full and let role changes overfill
  a list, which makes the server reject the whole save. Adds now go to Required, or to
  Optional when Required is full; role changes never overfill their destination (guarded
  inside the state update), and a toggle into a full list is disabled with the reason. The
  search disables only when both lists are full. Three boundary tests; the Optional-add
  test fails when adds always go to Required.
- Codex round 2 for commit 6: approve.

**Commit 7, header identity** (owner decision 4). As built:

- `getSiteVisitLogistics` takes an opt-in `includeRequestIdentity`. The new dependency
  `getRequestIdentity` reads `akoya_request` (number, title, applicant, grant program,
  meeting date) through `grantRequestAdapter.getById`, in parallel with the existing
  reads. It projects `request: { requestNumber, title, institution, grantProgram,
  cycleLabel }`, the same derivations as `resolve-request-service.js`; a failed read
  returns `null`. Only the Meeting Tracker visit GET passes the flag, so the Workbench read
  is unchanged (tested).
- The header keeps "Site visit · #number" (from the URL until loaded) and adds one
  metadata line: "Institution — Title · Program · Cycle".
- Docs: API route security matrix row; Atlas `dataverse-akoya-request.md` read paths and
  `dataverse-wmkf-sitevisit.md` consumers (marked branch-built, not merged).
- **Deferred, open for the owner:** the header status chip (§3). An accurate chip needs
  state the page does not hold: the materials collection state from its card and Board
  readiness from the Results rows, including the video line's own fetch. Building it means
  lifting that state or adding reads. A partial chip would contradict the cards it
  summarizes, so this build leaves it out.
- **Codex round 1 for commit 7 (needs-attention, one medium):** the identity survived
  client-side navigation between visits, and loads were unguarded. The identity is now
  stored with its request id, and stale loads drop their state, error and loading updates.
  Two same-mount A→B tests fail with the guards removed. Round 2: approve.

**Commit 8, docs.** Plan status, the remaining-work list below, the work queue item, the
Impeccable surface brief (its "not a redesign" scope is superseded), and a pointer from the
2026-10-04 card plan. The detector over the changed UI files found nothing.

**Final whole-branch Codex review (needs-attention, one high):** an open video approval
confirmation submitted the newest split id at click time, so a Refresh that brought in a
different video could approve one nobody had checked. Confirmations now carry the split
id they were opened for, render only while that split is still newest and confirmable,
and approve exactly that id. Regression: open the approval for A, refresh into B, and the
confirmation closes with no request; approving B needs its own confirmation and posts B
(fails with the old behavior).

**Four-card layout (owner decisions 7-10, §8.2):** `TranscriptWorkflow` renders four sibling
cards from the same state, so the paired Summarize confirmation, the Generate anchor and the
Refresh are unchanged. The presentation video's load moved into `usePresentationVideo`, which
the video row and the Board readiness list share (one GET; it loads only once the cards show
products, as the row did). `publishedSummaryOf` is shared by the summary block and the
readiness list, so the "On the Board page" status for the summary matches the "Published" chip.
Tests: card order and placement; readiness for the transcript, the summary (bound or stale)
and the video (served, out of date, unknown, in review, feature off, and turning on after
approval, with one load). Mutation checks: each readiness rule, broken, fails its test.
Codex round 1 (needs-attention, two medium): (a) after the presentation end changed, a failed
video re-read kept the old "On the Board page"; the hook now records the revision each successful
read was made for, and the readiness list says "Status unknown" unless the read is current and
succeeded. (b) With the transcript collection failed to load, the summary read reports
`not_needed`, which the list showed as "Not yet"; it is now "Status unknown". Each has a
regression test that fails without its fix.

## 10. Remaining after the build (2026-10-11)

- **Owner:** merge decision. The branch is pushed and not merged (owner decision 5). It is
  Tier 1 runtime UI plus one read-only server read, so promote it deliberately.
- **Owner:** a desktop check on a real request. The page reads Production, so the owner
  runs it or authorizes it. The build was checked in jsdom and through static
  renders of the card.
- **Open design item:** the header status chip (§9.6 commit 7).
- **Server slices C1-C3 (§6), not started:** automatic split-transcript generation after a
  publish with a confirmed end; the real reason a presentation video was superseded; and
  streaming the review video instead of downloading it.
- **Not converged:** the underlined `BTN_LINK` text actions (no text-link variant in
  `Button`).
- **Server-side gap noted by Codex (commit 3):** `createMeetingCorrection` does not refuse
  while a newer transcription is pending; the gate is UI-only.

### 10.1 Owner desktop check findings (2026-10-11, held until the check is done)

1. **Leftover "Refresh transcription status" button** in the Results summary block
   (`RecordingAndTranscriptCard.js`, three sites: the status-unknown button and the two
   "Transcript status is unavailable" branches). It predates the redesign (`132eac566`)
   and duplicates the card Refresh. Fix: remove the buttons; the note reads "Transcript
   status is unavailable. Use Refresh above to check whether this transcript can be
   summarized."; move the two tests that click it to the card Refresh.
2. **Local setup:** `.env.local` lacks `MEETING_TRACKER_SCHEMA_READY=on`, so localhost shows
   "Meeting Tracker is not yet enabled". Not a code defect.
