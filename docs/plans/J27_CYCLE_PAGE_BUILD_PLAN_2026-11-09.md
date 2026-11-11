---
title: J27 cycle page build plan
domain: workbench
kind: plan
status: draft
summary: Build plan for the J27 Workbench cycle page — what the code reading changed, the files and data each slice touches, tests, and the owner's decisions of 2026-11-09. Built on branch claude/j27-cycle-page the same day; not promoted.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md
  - docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md
---

# J27 cycle page build plan

Author: Claude for Justin Gallivan, 2026-11-09. **Reviewed with the owner
the same day; his decisions are in section 5. He gave the go-ahead and the three slices
were built that day on branch `claude/j27-cycle-page` (section 7); nothing
is promoted.** The redesign plan says what the page contains; the design
brief says how it looks and reads. This plan says how it would be built, in
what order, and what has to be decided first.

All code was read on branch `claude/j27-read-model` at `7034cf2d7` (worktree
`WMKF_Apps-claude-j27-read-model`), which is not on `main`. State claims
carry `[VERIFIED via …]` or `[ASSUMED]`.

## 1. What reading the code changed

Six findings. The first two change what a row can show; the owner's
decisions on them are in section 5.

**1. The stage model's "next task" cannot be printed as it stands.** On the
request list, reviewer counts are always loaded, so the model adds "Identify
reviewers" to every open request with fewer than three completed reviews,
including one that has not been scored yet. It ranks low, so a row with a
real task still shows that task. A request recommended to the Chairs has no
other task, so its next task comes out as "Identify reviewers", where the
brief shows "Awaiting the Chairs' outcome".
`[VERIFIED via lib/services/workbench/j27-read-model.js:263,267-272,284-286, and by running the model on four sample January inputs: not scored → record-scoring; scored → record-chairs-recommendation; recommended → identify-reviewers with the chairs-outcome-pending blocker; invited → identify-reviewers]`
The list therefore needs its own rule for the line under the chip (section
2). The request page's strip prints the model's task directly
`[VERIFIED via shared/components/workbench/J27StageStrip.js:86-87]`, so it
would show the same odd line on such a request once its reviewer counts
load; that belongs with the request-page wording fixes.
**Fixed 2026-11-10** on the J27 line (`claude/j27-cycle-page`, commit
`eaf8758f1` and the one after it; not promoted): the strip no longer prints
the model's task directly. It uses the list's rule from section 2, and says
"Nothing is waiting on staff right now." only once every fact behind it has
loaded. The line reference above describes the strip before that change.

**2. Statuses the stage model does not know.** The model maps seven Phase I
status values. Any other value (Incomplete, Ineligible, Proposal Late,
Rescinded Grant, Request Withdrawn, Deferred) is passed through as
"unmapped" with its Dataverse label, counts as open, and gets the task
"Record Scored or Not Scored".
`[VERIFIED via j27-read-model.js:105-127,259]` Whether a request with one of
those statuses can also be marked ready for review, and so reach the list,
was not checked `[ASSUMED possible]`.

**3. "Some details could not be read" needs a narrower trigger.** The
request list never loads the presentation, roster, Board draft or review
state, and the model counts those as missing on every open row, so an
open row on the list is never better than "partial".
`[VERIFIED via lib/services/workbench/j27-read-model-inputs.js:133-136 and j27-read-model.js:223-227; a search of lib, pages and shared found those four keys set for list rows in that one place, with dashboard-service.js:346 the only list caller; the four-sample run returned "partial" each time]`
The note must show only when a read failed ("degraded"), never for
"partial".

**4. "Show closed" needs no server change.** For a J27 Research request the
"include set-aside" switch has no effect: the request is admitted when it is
ready for review, whatever its triage status.
`[VERIFIED via shared/config/workbenchVisibility.js:104-107]` The feed
already returns closed requests (redesign plan, section 5). "Show closed",
the hidden count, the "Showing" menu, the standing filter and search are all
filters applied in the browser to rows already loaded.

**5. The page cannot tell on its own that the selected program is
Research.** The server works out which program qualifies
`[VERIFIED via lib/services/workbench/program-scope-service.js:36-42,106]`
but returns only each program's id and name to the page
`[VERIFIED via program-scope-service.js:154-160 and dashboard-service.js:230-240, 293-305]`.
The tab row has to be chosen before any rows load, so the feed's
response names the qualifying programs in a short list. The cycle test
is the stage model's own (`isJ27ScopeCycle`, 2027 or later), so no cycle
name is written into new code.

**6. The Staff deliberations list says more than the new row would.** Its
rows carry a next-step sentence about the proposal discussion brief and the
draft writeup ("Generate the proposal discussion brief", "Preparation will
run automatically. No action is needed now.") and a plain-language reason
when something is wrong.
`[VERIFIED via shared/components/workbench/StaffDeliberationsPanel.js:57-76,140-168]`
None of those are tasks in the stage model, so a Deliberations row built
only from the model would lose them. What the row says before a
presentation is left to be decided (decision 3 in section 5).

Two smaller points:

- **Load cannot be measured at 300 requests yet.** The redesign plan
  promised a measurement at that volume. The only J27 requests available are
  the 20 sandbox fixtures named in the session handoff, and creating more
  is not authorized. Slice 1
  records timings at 20 and the query counts that scale with volume; the
  real measurement happens with December's requests.
- **"1 review outstanding" needs an exact formula.** The reviewer counts
  offer several candidates (accepted, received, completed, and a separate
  exclusive "progress" breakdown)
  `[VERIFIED via lib/services/reviewer-rollup.js:78-122]`. Codex's third
  review showed that no difference of those totals works: the accepted
  count keeps a reviewer who was later released, and the received count
  includes that reviewer's report, so the same totals can mean "one review
  still owed" or "none owed" `[VERIFIED via reviewer-rollup.js:82-90,103-105,121]`.
  Slice 2 therefore adds one count, worked out reviewer by reviewer:
  accepted, not declined, not released, and no review received.

## 1a. Codex reviews, 2026-11-09

Codex reviewed this plan twice against the branch code and returned "needs
attention" both times. Nearly every finding concerned working out
Deliberations and Final Assessment on the list. **The owner therefore split
the plan (decision 5): this plan builds the tab row, All requests, Initial
Assessment, Peer Review and their counts. The Deliberations and Final
Assessment lists get their own plan** (section 3a).

First review, four confirmed findings, each checked against the source:

| Codex finding | Checked | Outcome |
|---|---|---|
| The Staff deliberations feed cannot reproduce the request page's rule for "a Board draft exists" or for the review phase. The feed accepts a draft in Draft, Review or Final state; the request page requires Review state and a stable SharePoint identity, and its group-review check also requires the source version and content hash. | `[VERIFIED via lib/services/pre-site-visit/cycle-list-service.js:521-557,639-649; lib/services/final-writeup/transition-model.js:119-135,194-213; lib/services/final-writeup/transition-state.js:62-70]` | Moved to the separate plan. |
| The rule for the line under the chip let "Record an offramp decision if one is needed" lead a row. | `[VERIFIED via lib/services/workbench/j27-read-model.js:267-272,281-286]` | Fixed: the optional offramp task never leads a row (section 2). |
| A request can hold a presentation or a draft without being Invited, so the later-phase facts cannot be gated on standing. | `[VERIFIED via j27-read-model.js:194-209, which checks draft, review and presentation facts before the Chairs' outcome]` | Moved to the separate plan. |
| Confirmed attendance is stored per presentation and tied to that presentation's start and end, so the list's "a roster memo exists" fact cannot stand in for it. | `[VERIFIED via lib/services/workbench/meeting-roster-service.js:90-93,115-126 and j27-read-model-inputs.js:75-80]` | Moved to the separate plan. |

Second review, on a version that worked the later phases out on the server.
One finding applies to this plan and is fixed in section 2: "Identify
reviewers" could still lead a row that is waiting on the Chairs, because a
recommended request with any reviewer suggestion is already in Peer Review
`[VERIFIED via j27-read-model.js:208-209]`. The other four are requirements
for the separate plan and are listed in section 3a as Codex reported them;
they have not yet been checked against the source.

Third review, on the split plan: one finding, that "1 review outstanding"
cannot be worked out from the existing reviewer totals; fixed by adding a
count (section 1 and slice 2). Codex found the row-line ordering, the
Deliberations fallback and the tab mapping sound, and named three existing
tests whose expectations change with this work: the address test (old
state shape, and "Assigned to me" omitted from the address), the shell
test (J27 Initial assessments panel), and the stage-strip label test.
Those are its reading of the tests, not observed failures. The Final
writeups panel keeps its "Not filtered by program" hint under the new tab.

Codex confirmed the six findings in section 1, the closed-first ordering,
the offramp fix and the tab-count definition, and listed shell points that
are now in slice 1.

## 2. How it is built

**One set of rows, loaded once.** In the new layout the shell loads the
request list feed once for the current program, cycle and scope and hands
the rows to whichever tab is open. All requests, the Initial Assessment and
Peer Review lists and the tab counts are different filters over the same
rows, so switching among them does not reload.

**Deliberations and Final Assessment keep today's panels for now.** Until
their own plan is built, the Deliberations tab shows the existing Staff
deliberations list and the Final Assessment tab shows the existing Final
writeups list, both unchanged. Nothing staff use today is lost. On All
requests, a request in one of those phases shows its Peer Review standing,
because the request list cannot yet tell that it has moved on (redesign
plan, section 5).

**New pieces** (names are working names):

| Piece | What it is |
|---|---|
| Label list | One file holding every phase, task, blocker, outcome and standing label. The stage strip's label maps move here and the strip imports them (redesign rule 14). |
| Row rules | A file of pure functions: the standing chip, the line under it, the small third line, whether a row is closed, the filters, the search match and the tab counts. No fetching, fully unit-tested. |
| Rows hook | Loads the feed for the shell, with the same guards against stale or mismatched responses the Request list has today `[VERIFIED via RequestListPanel.js:129-185]`. |
| Request list and row | One list component and one row component, used by All requests, Initial Assessment and Peer Review. |
| Control row | Section switch, scope, and the tab-specific control. |

**Existing files that change:**

| File | Change |
|---|---|
| `WorkbenchShell.js` | Chooses the new layout when the program is Research and the cycle is 2027 or later; otherwise renders exactly what it renders today. |
| `WorkbenchViewsNav.js` | A second tab set for the new layout; receives counts. |
| `workbench-location.js` | New tab keys and filter keys; old links mapped (table below). |
| `dashboard-service.js` | Adds the request title to the read and the row, and the list of qualifying programs to the response. |
| `reviewer-rollup.js` | Slice 2: adds the outstanding-review count. The existing counts keep their meaning. |
| `J27StageStrip.js` | Imports its labels from the label list and keeps exporting them under today's names, so its existing test holds. No visible change. |

`RequestListPanel.js`, `StaffDeliberationsPanel.js`, the Staff deliberations
feed, the stage model and its inputs, the Reviewer follow-up panel, the
Final writeups panel and Awardees are not edited. Earlier cycles and other
programs keep using them as they are.

**The line under the chip.** In this order:

1. Closed request: nothing; the chip says how it ended.
2. A main task, if the request has one: "Next: …". The model marks two
   tasks as optional ("Identify reviewers" and "Record an offramp decision
   if one is needed") `[VERIFIED via j27-read-model.js:40,43]`; every other
   task is a main task, including reviewing integrity findings.
3. Otherwise, when the request is waiting on the Chairs: "Awaiting the
   Chairs' outcome".
4. Otherwise, on a Peer Review row with "Identify reviewers" outstanding:
   "Next: Identify reviewers". It is the real work of that phase.
5. Otherwise, when the request is invited and waiting for its Phase II
   status: "Reviewer invitations are not open yet" (decision 2).
6. Otherwise: "Nothing is waiting on staff right now."

The optional offramp task never leads a row. The Chairs wait is checked
before "Identify reviewers", so a recommended request shows the wait even
when it already has reviewer suggestions. The Phase II wait is checked
after it: once a request is Invited, identifying reviewers is work the
Program Director can do, and decision 2 puts the message there only "when
nothing else is next". Codex recommended checking both waits first; this
plan follows it for the Chairs and keeps decision 2 for the Phase II wait.

A tab count is the number of rows in that phase whose line starts with
"Next:".

**The chip.**

| Phase | Chip comes from |
|---|---|
| Initial Assessment | The recorded standing: Not yet scored, Scored, Recommended to Chairs. |
| Peer Review | Today's reviewer stage, already on each row `[VERIFIED via dashboard-service.js:389]`. |
| Closed | The outcome label; for a status the model does not know, its Dataverse label (decision 1). |

The request list can already place a request in Deliberations when a staff
visit assessment or attendance memo is saved (redesign plan, section 5).
Until the separate plan, such a row appears on All requests with the plain
chip "Deliberations" and the line from the rules above; it is not on the
Initial Assessment or Peer Review lists. The fuller Deliberations and Final
Assessment chips belong to the separate plan.

**Addresses.** All requests keeps today's default address, so existing
bookmarks to the Workbench open on it. New tab keys: `initial-assessment`,
`peer-review`, `deliberations`, `final-assessment`; `awardees` is unchanged.
New keys for the section, the "Showing" choice, the standing filter and
"Show closed". Search reuses today's key.

| Old link, opened on a J27 Research cycle | Lands on |
|---|---|
| Request list | All requests |
| Reviewer follow-up | Peer Review, Reviewers section |
| Staff deliberations | Deliberations |
| Initial assessments | Initial Assessment |
| Final writeups | Final Assessment |
| Awardees | Awardees |

The reverse also holds: a new address opened on an earlier cycle or another
program lands on the nearest of today's tabs, so changing the cycle menu
never leaves a blank page.

**Scope default.** Someone who leads no requests in the cycle opens on "All
in program" (redesign rule 13). Today an address cannot tell "no choice
made" from "Assigned to me" `[VERIFIED via workbench-location.js:62,80]`, so
the new layout records an explicit choice of "Assigned to me" in the
address.

## 3. Slices

Each slice ends with its tests green and the documentation updated. Nothing
is promoted until the owner decides (section 6).

**Slice 1: tab row and All requests.**

- Label list, row rules, rows hook, list, row, control row.
- Shell and nav choose the layout; address keys and old-link mapping.
- Title and the list of qualifying programs added on the server.
- All requests: search, "Showing" menu, count line, all states in the brief.
- Initial Assessment and Peer Review show the same list filtered to their
  phase, without their extras yet. Deliberations and Final Assessment mount
  today's Staff deliberations and Final writeups panels. No tab is empty or
  broken between slices.
- Shell points from the Codex review: keep the address round trip exact
  for every key the shell compares; do not map an old link until the page
  knows whether the program qualifies; keep an explicit "Assigned to me"
  distinct from no choice; keep the path that starts loading rows when the
  address names both program and cycle
  `[VERIFIED via WorkbenchShell.js:134-139]`.
- Tests: row rules against every case in section 2, including the four
  sample inputs from finding 1, both optional tasks in every phase, a
  recommended request that already has reviewer suggestions, and an Invited
  request without its Phase II status; address mapping in both directions; the
  shell renders today's layout unchanged for D26 and for another program;
  label parity between the label list and the stage model's keys.
- Timings recorded on the 20 sandbox fixtures.

**Slice 2: Initial Assessment and Peer Review.**

- Standing filter chips with counts on Initial Assessment.
- Reviewer progress on the Peer Review row; Reviewers section mounts the
  existing panel.
- "1 review outstanding", from the new count. Tests: an active and a
  released reviewer, with the one received report belonging to each in
  turn. Every other reader of the reviewer counts is checked for the added
  field.
- "Show closed" on the phase tabs.

**Slice 3: tab counts.** Counts on Initial Assessment and Peer Review come
from the row rules and the rows already loaded, so this is small.
Deliberations and Final Assessment carry no count until their own plan is
built.

**Checks for every slice.** The unit tests for the files touched; the type
check; and the gates for the surfaces changed: route matrix, Atlas,
status-and-label parity, documentation currency. The branch has three gates
red today from before this work (model settings on the scoring route, two
stale J27 register rows, a worktree link); the first two are cleaned up
before slice 1 starts.

## 3a. Separate plan: Deliberations and Final Assessment lists

**Status, 2026-11-11:** the separate plan is
`docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md`. It was reviewed by
Codex three times, approved by the owner and built on `claude/j27-cycle-page`
(its section 6); not promoted. The text below is this plan's original
requirement list, kept as written.

Not part of this build. Its own plan is written, given a whole-flow review
and sent to Codex before anything is built. Starting requirements:

- A request appears in Deliberations or Final Assessment on the list
  exactly when its request page says so.
- The later-phase facts are read for every in-scope request, whatever its
  standing (first Codex review, verified).
- Confirmed attendance uses the attendance service's rule, tied to the
  presentation (first Codex review, verified).
- **Before its presentation, a Deliberations row shows no next-step line at
  all**, including work left from Peer Review such as reading the reviewer
  reports (owner, 2026-11-09: staff know to read the reports and do not
  need reminding). What is shared before a presentation is still to be
  decided (decision 3).

From the second Codex review, as reported. **2026-11-10:** the draft plan
`docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` checks these against
the source; the first and third are confirmed, the second and fourth in
part (its section 5).

- The request page learns that a presentation has ended only for someone
  allowed to start group review, on a request with an eligible draft. The
  list needs a timing rule that does not depend on either, and the two must
  be reconciled.
- Reusing the Final writeup status needs its whole flow, including its
  error handling and readiness check, and a document read that returns
  every field it checks without returning document text.
- The attendance service and the schedule check can disagree about one
  request's presentation; the list must keep "a presentation exists"
  separate from "its timing is confirmed". The attendance service also
  accepts the literal J27 cycle only
  `[VERIFIED via lib/services/workbench/meeting-roster-service.js:46]`,
  while the new layout covers later cycles.
- Batched reads fail as a whole today, and the schedule check makes a
  further read per ended presentation; cost and partial failure need an
  explicit design, measured at 300 requests.

## 4. What is not built

*(As planned on 2026-11-09. The Deliberations and Final Assessment lists
named below were later built under their own plan; see section 3a.)*

No new route, table, permission, status or Dataverse field. No writes from
any list. The request list feed gains three response fields (the title,
the list of qualifying programs and the outstanding-review count). No change to the request page beyond the label import.
No change to the stage model, the Staff deliberations list or its feed, or
to what the Reviewer follow-up, Final writeups or Awardees panels read or
write. No Deliberations or Final Assessment list (section 3a). No Program
Coordinator work. Nothing for Southern California.

## 5. Decisions (owner, 2026-11-09)

1. **Statuses the model does not know** (finding 2): a request whose Phase
   I status is Incomplete, Ineligible, Proposal Late, Rescinded Grant,
   Request Withdrawn or Deferred is **treated as closed**. The chip shows
   the Dataverse label, the row shows no next task, and it is hidden by
   default and found through "Showing: Everything". The owner says these
   are very rare and not something Program Directors deal with; he has not
   seen a deferred request in four years.
2. **An Invited request whose Phase II status is not yet set** shows
   "Reviewer invitations are not open yet" when nothing else is next. The
   owner does not expect a significant lag between the two steps, so the
   line is a fallback that will rarely be seen.
3. **Deliberations rows before the presentation: no next-step line.** What
   is shared with colleagues and the Chairs before a research presentation
   is still to be decided, so no wording about the proposal discussion
   brief goes on the row; and work left from Peer Review is not repeated
   there, because staff know to read the reports. This applies when the
   Deliberations list is built (section 3a).
4. **Release:** no constraint on the order. The owner expects all of this
   to be settled before the first proposal arrives, and staff do not work
   on deliberations before reviews have gone out.
5. **The plan is split** after two Codex reviews: this plan builds the tab
   row, All requests, Initial Assessment, Peer Review and counts; the
   Deliberations and Final Assessment lists get their own plan.

6. **Go-ahead to build**, given the same day, starting with the branch
   clean-up.

## 6. Release and records

The work branches from `claude/j27-read-model` and follows that line's
promotion decision, which has not been taken. The sandbox fixtures stay as
they are. On approval, the decision is logged in the alignment log on the
J27 line (redesign plan, section 10), and the route matrix and Atlas pages
are updated with the added response fields in the slice that adds them.

## 7. What was built (2026-11-09)

On branch `claude/j27-cycle-page`, cut from `claude/j27-read-model` and
pushed; not promoted. Verified by unit tests and the gates for the changed
surfaces. `[VERIFIED via the branch's commits aa02f0068, 34e467db8, 056833739 and 4038e8ace]`

- **Branch clean-up** on `claude/j27-read-model`: the scoring route marked
  as not resolving a model, and two stale J27 register rows rebound.
- **Slice 1:** as planned, plus "Show closed" on the phase tabs and the tab
  counts, which were small once the rows were shared.
- **Slice 2:** the standing filter, reviewer progress on Peer Review rows,
  and "1 review outstanding" from the new count.

Differences from the plan as written above:

- The qualifying programs are a list on the feed's response
  (`stageProgramIds`), not a field on each program, so
  `program-scope-service.js` was not changed.
- A request with a final decision (awarded, not awarded, withdrawn) is
  listed on All requests only: the stage model files it under "decided",
  not under the phase where it stopped. Not Scored, Not Recommended and Not
  Invited stay in Initial Assessment under "Show closed".
- The All requests search covers number, title, institution and Principal
  Investigator, as the design brief says; it does not search Program
  Director.
