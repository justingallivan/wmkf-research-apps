---
title: Site Visit page redesign
domain: transcription
kind: plan
status: proposed
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

Status: **proposed; scope decided** (Session 593, 2026-10-10/11). Planning only; no
code. The owner answered §8: the whole page is in scope, the Board link sits on the
Results "Board page" heading, and TXT/VTT downloads live in the row menu.

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
  - Transcripts: Download TXT, Download VTT, Regenerate (only when stale).
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

## 9. Next step

Turn this proposal into a build brief: the action inventory (§7), the
`SiteVisitEditor` identity data source (§3, [ASSUMED]), and a commit order for
slices A and B. Slice C items go to the queue as separate entries. Build on a branch
(Tier 1 runtime UI per the campaign release strategy).
