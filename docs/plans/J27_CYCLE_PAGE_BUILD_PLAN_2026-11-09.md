---
title: J27 cycle page build plan
domain: workbench
kind: plan
status: draft
summary: Build plan for the J27 Workbench cycle page — what the code reading changed, the files and data each slice touches, tests, and the owner's decisions of 2026-11-09. No build authorized.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md
  - docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md
---

# J27 cycle page build plan

Author: Claude for Justin Gallivan, 2026-11-09. **Reviewed with the owner
the same day; his decisions are in section 5. No build is authorized.** The redesign plan says what the page contains; the design
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
The tab row has to be chosen before any rows load, so the program list the
page already receives gains one true/false field per program. The cycle test
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
  `[VERIFIED via lib/services/reviewer-rollup.js:78-122]`. Which difference
  equals "accepted and not yet returned" is `[ASSUMED]` until slice 2 pins
  it with a test built from that file's rules.

## 2. How it is built

**One set of rows, loaded once.** In the new layout the shell loads the
request list feed once for the current program, cycle and scope and hands
the rows to whichever tab is open. All requests, the four phase lists and
the tab counts are different filters over the same rows, so switching tabs
does not reload.

**New pieces** (names are working names):

| Piece | What it is |
|---|---|
| Label list | One file holding every phase, task, blocker, outcome and standing label. The stage strip's label maps move here and the strip imports them (redesign rule 14). |
| Row rules | A file of pure functions: the standing chip, the line under it, the small third line, whether a row is closed, the filters, the search match and the tab counts. No fetching, fully unit-tested. |
| Rows hook | Loads the feed for the shell, with the same guards against stale or mismatched responses the Request list has today `[VERIFIED via RequestListPanel.js:129-185]`. |
| Request list and row | One list component and one row component, used by all five request tabs. |
| Control row | Section switch, scope, and the tab-specific control. |

**Existing files that change:**

| File | Change |
|---|---|
| `WorkbenchShell.js` | Chooses the new layout when the program is Research and the cycle is 2027 or later; otherwise renders exactly what it renders today. |
| `WorkbenchViewsNav.js` | A second tab set for the new layout; receives counts. |
| `workbench-location.js` | New tab keys and filter keys; old links mapped (table below). |
| `dashboard-service.js` | Adds the request title to the read and the row; in slice 3, adds the model's input to in-scope rows. |
| `program-scope-service.js` | Adds the true/false field to each program. |
| `J27StageStrip.js` | Imports its labels from the label list. No visible change. |
| `StaffDeliberationsPanel.js` | Slice 3 only: its timing chip rule moves to a shared file that both it and the new row import. No visible change. Its next-step and problem wording stays where it is (decision 3). |

`RequestListPanel.js`, the Reviewer follow-up panel, the Final writeups
panel and Awardees are not edited. Earlier cycles and other programs keep
using them as they are.

**The line under the chip.** In this order:

1. Closed request: nothing; the chip says how it ended.
2. The model's next task, when it is a main task or belongs to the row's own
   phase: "Next: …".
3. Otherwise, when the request is waiting on the Chairs: "Awaiting the
   Chairs' outcome". When it is invited and waiting for its Phase II status:
   "Reviewer invitations are not open yet" (decision 2).
4. Otherwise, in Deliberations before the presentation: nothing (decision
   3).
5. Otherwise: "Nothing is waiting on staff right now."

Rule 2 keeps "Next: Identify reviewers" on a Peer Review row, where it is
the real work, and drops it from a row that is waiting on the Chairs.

**The chip.**

| Phase | Chip comes from |
|---|---|
| Initial Assessment | The recorded standing: Not yet scored, Scored, Recommended to Chairs. |
| Peer Review | Today's reviewer stage, already on each row `[VERIFIED via dashboard-service.js:389]`. |
| Deliberations, Final Assessment | The Staff deliberations feed (slice 3). |
| Closed | The outcome label; for a status the model does not know, its Dataverse label (decision 1). |

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
| Final writeups | Final Assessment, Writeup review section |
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
- Title and program field added on the server.
- All requests: search, "Showing" menu, count line, all states in the brief.
- The other four request tabs show the same list filtered to their phase,
  without their extras yet, so no tab is empty or broken between slices.
- Tests: row rules against every case in section 2, including the four
  sample inputs from finding 1; address mapping in both directions; the
  shell renders today's layout unchanged for D26 and for another program;
  label parity between the label list and the stage model's keys.
- Timings recorded on the 20 sandbox fixtures.

**Slice 2: Initial Assessment and Peer Review.**

- Standing filter chips with counts on Initial Assessment.
- Reviewer progress on the Peer Review row; Reviewers section mounts the
  existing panel.
- "1 review outstanding", with its formula pinned by a test.
- "Show closed" on the phase tabs.

**Slice 3: Deliberations and Final Assessment.**

- The page calls the existing Staff deliberations feed, only when at least
  one loaded request is Invited, and merges presentation timing, review
  phase and draft state into each row's stage the way the request page
  merges its own reads `[VERIFIED via shared/utils/j27PageStage.js:76-93]`.
  From December to the February Chairs meeting no request is Invited, so
  the feed is not called at all.
- No route is added and the feed is not changed. The request list feed
  gains the model's input on in-scope rows so the page can derive the stage
  again.
- A test pins how the feed's draft state maps to "a Board draft exists"
  for the available, unavailable, pending and ambiguous cases (the caveat
  in the redesign plan, section 5).
- Writeup review section mounts the existing panel.
- Open technical point: the list has no read of the confirmed attendance
  record, so "Confirm presentation attendance" would not appear on a row.
  Whether the saved roster memo the list already reads is the same fact is
  `[ASSUMED]`; slice 3 starts by reading that path.
- This slice crosses the server and the page, so it gets a whole-flow
  review before it is built.

**Slice 4: tab counts.** Counts come from the row rules and the rows already
loaded, so this is small. A count is the number of rows in that phase whose
line starts with "Next:".

**Checks for every slice.** The unit tests for the files touched; the type
check; and the gates for the surfaces changed: route matrix, Atlas,
status-and-label parity, documentation currency. The branch has three gates
red today from before this work (model settings on the scoring route, two
stale J27 register rows, a worktree link); the first two are cleaned up
before slice 1 starts.

## 4. What is not built

No new route, table, permission, status or field. No writes from any list.
No change to the request page beyond the label import. No change to what the
Reviewer follow-up, Final writeups or Awardees panels read or write. No
Program Coordinator work. Nothing for Southern California.

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
3. **Deliberations rows before the presentation: to be decided** (finding
   6). The owner has not settled what is shared with colleagues and the
   Chairs before a research presentation. Until he has, a Deliberations row
   shows the timing chip, the stage model's two tasks after the
   presentation, and no next-step line before it. No wording about the
   proposal discussion brief goes on the row.
4. **Release:** no constraint on the order. The owner expects all of this
   to be settled before the first proposal arrives, and staff do not work
   on deliberations before reviews have gone out. The slices can be
   promoted together with the J27 line or as they are finished.

Still open: **the go-ahead to build**, and whether to start with the branch
clean-up.

## 6. Release and records

The work branches from `claude/j27-read-model` and follows that line's
promotion decision, which has not been taken. The sandbox fixtures stay as
they are. On approval, the decision is logged in the alignment log on the
J27 line (redesign plan, section 10), and the route matrix and Atlas pages
are updated with the two added response fields in the slice that adds them.
