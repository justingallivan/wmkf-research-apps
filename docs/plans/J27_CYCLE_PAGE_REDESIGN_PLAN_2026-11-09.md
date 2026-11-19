---
title: J27 cycle page redesign plan
domain: workbench
kind: plan
status: draft
summary: Proposal to reorganize the cycle-level Workbench page for J27 Research as All requests plus the request page's phases (Initial Assessment, Peer Review, Deliberations, Final Assessment) and Awardees, stating what happens to each of today's six tabs. Design decisions settled with the owner 2026-11-09; no build authorized.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md
  - docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
---

# J27 cycle page redesign plan

Author: Claude for Justin Gallivan, 2026-11-09. Status: **Design decisions
settled with the owner on 2026-11-09. No build is authorized.** The staff
flow audit (`docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md`) and the owner's
answers to its questions are applied below. The two feed checks are done (section 5).
The layout and wording are in
`docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md`, confirmed by the
owner the same day. Next is a build plan, when the owner asks for one.

All code described here was read on branch `claude/j27-read-model` at
`680252fe5` (worktree `WMKF_Apps-claude-j27-read-model`), which is not on
`main`. "Today" means that branch. State claims carry `[VERIFIED via …]` or
`[ASSUMED]`.

## 1. The problem

The request page was rebuilt for J27 as Overview plus four phases. The cycle
page was not. It still has six tabs that were added one project at a time
since September: Request list, Reviewer follow-up, Staff deliberations,
Initial assessments, Final writeups, Awardees. A Program Director opening a
J27 request sees phases; stepping back to the cycle sees a different
vocabulary, and no tab answers "which of my requests are in this phase and
what is next on each".

## 2. Proposal in brief

For Research requests in J27 and later cycles, the cycle page shows six tabs:

**All requests · Initial Assessment · Peer Review · Deliberations · Final Assessment · Awardees**

The page opens on **All requests**: every request in the cycle, one row
each, showing where it stands, its next task and, if it has stopped, how
it ended. This mirrors the request page, which is Overview plus the same four
phases, and it sits where the Request list sits today.

Each of the four phase tabs opens on the cycle's requests that are in that
phase, with the detail that phase needs. Phase-specific tools that exist
today sit inside their phase as a second section, using the same section
buttons the request page uses under Peer Review.

Earlier cycles (D26 and before) and other grant programs keep today's tabs
unchanged, the same way the request page keeps its older tabs for them.

## 3. What happens to each of today's tabs

| Today's tab | In the new layout | Notes |
|---|---|---|
| Request list | **Becomes All requests, the first tab and the opening view.** | Same place, same My/All switch. Rows gain the request's standing, the next task and the request title. The reviewer progress chip and bar move to the Peer Review list and appear nowhere else. The Advancing / Set aside dropdown is already hidden for J27 `[VERIFIED via RequestListPanel.js:224]`; the scoring decision and the recommendation to Chairs on the request page replace it. "Include set-aside requests" becomes "Show closed". |
| Reviewer follow-up | **Becomes a section inside Peer Review** ("Reviewers"). | Same panel, same controls, no change to what it reads or writes. It is the cycle view of Peer Review, as the owner described. |
| Staff deliberations | **Becomes the Deliberations list.** | Its rows already carry the presentation schedule and next step. Rows it shows as "Group review" or "Leadership review" move to Final Assessment, where the stage model puts them. |
| Initial assessments | **The name stays as the first phase; the content changes.** | Today the tab lists the Initial Assessment Word documents from the earlier placeholder workflow. In J27 the phase is the material generated automatically at submission plus the staff rationale, the scoring decision, the recommendation to Chairs and integrity review on each request, so the phase opens on requests. The document list leaves the J27 cycle page (owner, 2026-11-09). |
| Final writeups | **Becomes a section inside Final Assessment** ("Writeup review"). | Same panel: Needs my review, Reviewed by me, All writeups. |
| Awardees | **Stays, last.** | Unchanged. |

## 4. The views

| Tab | Opens on | Second section |
|---|---|---|
| All requests | Every request in the cycle: standing, next task, how it ended if it has stopped | none |
| Initial Assessment | Requests in the phase: recorded standing, next task, blockers; a filter on standing | none |
| Peer Review | Requests in the phase: reviewer progress, next task, blockers | Reviewers |
| Deliberations | Requests in the phase: presentation timing and scheduling cue, next task, blockers | none |
| Final Assessment | Requests in the phase: Board draft and review standing, next task | Writeup review |
| Awardees | Today's panel | none |

**Row layout** (owner, 2026-11-09), the same on every request list:

1. Request number and institution
2. Request title
3. Principal Investigator and Program Director

The phase, next task and tab-specific detail sit to the right, where the
coverage chip and reviewer bar sit today.

Rules common to the request lists:

1. **One vocabulary.** Phase names, task wording and blocker wording are the
   stage strip's, so the cycle page and the request page never disagree.
2. **A request appears in exactly one phase tab**, the one the stage model
   derives for it, and always in All requests.
3. **Requests that stopped stay findable.** Not Scored, Not Recommended, Not Invited,
   Offramped, declined and withdrawn requests have no next task. In a phase
   tab they sit in the phase where they stopped. A "Show closed" switch
   controls whether they are listed; when it is off the list says how many
   are hidden.
4. **All requests is where staff look back.** It has a search box and one
   "Showing" menu that covers both open-or-closed and how the request ended
   (design brief, section 7), so a declined or triaged request from a
   past cycle is found in one place wherever it stopped.
5. **Awards** appear in Awardees, as today, and in All requests.
6. **Each row links to the request page**, on the request's current phase.
7. **Each phase tab can show a count** of requests needing action, as the
   tab row already supports. On the opening view these counts show where the
   work is.
8. **Read-only.** The lists show tasks; every action still happens on the
   request page or in the existing panels. No new writes.

Added from the staff flow audit (owner agreed, 2026-11-09):

9. **Initial Assessment has a filter on standing**: Not yet scored, Scored,
   Recommended to Chairs. The phase runs from the December AI pass to the
   February Chairs meeting and carries most of the cycle, so one undivided
   list would not be usable. The three groups follow what is recorded today;
   if further standings are built later they become extra filter values.
10. **Reviewer progress appears on the Peer Review list only.** An earlier
    version of this rule put it on every row with reviewer activity; the
    owner reversed that after seeing a mock-up (2026-11-09), because the bar
    was present on some rows and not others and its "declined" segment read
    as a problem. On the other lists **a request that has moved past Peer
    Review with a review still outstanding says so in words** ("1 review
    outstanding"), so the reviewer is not forgotten. The count is accepted
    reviewers who have not yet returned a review, from the reviewer counts
    the dashboard rows already carry
    `[VERIFIED via dashboard-service.js:383-386 and j27PageStage.js:25]`.
11. **The Deliberations list keeps today's scheduling cue** ("Not
    scheduled", time not confirmed). Scheduling is not a task in the stage
    model, so without the cue the row would show nothing to do before the
    presentation.
12. **A request that is waiting shows a quiet status line**, for example
    "Awaiting the Chairs' outcome", in place of a next task. It names no
    role and there is no filter on it (owner, 2026-11-09): the Grants
    Manager records the Chairs' outcomes on or about the day of the
    meeting, so the wait is short. An earlier version of this rule had the
    row say who it was waiting on.
13. **Someone who leads no requests opens on "All in program"** rather than
    an empty "Assigned to me".
14. **Every label comes from one shared list** used by the stage strip and
    the cycle page, so the cycle page cannot introduce another name for a
    phase, task, standing or document.

## 5. What is already built and what is not

*(Snapshot as of 2026-11-09. Since then the cycle page has been built on
`claude/j27-cycle-page`, including the Deliberations and Final Assessment
lists, whose rows now carry the later-phase facts described as "not loaded"
below: see `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` section 7 and
`docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` section 6. Not
promoted.)*

- The dashboard feed attaches a stage to each in-scope Research row: phase,
  next task, all task keys, blocker keys, recorded standing and outcome.
  `[VERIFIED via lib/services/workbench/j27-read-model-inputs.js:147-158 and dashboard-service.js:344-392]`
- Nothing on the cycle page shows it yet. Among non-test files under
  `shared/` and `pages/`, the next-task and blocker fields are read in one
  component, the stage strip, and the strip is imported by one page, the
  request page. `[VERIFIED via grep for primaryTask, blockerKeys and taskKeys (hits only in J27StageStrip.js) and grep for J27StageStrip importers (only pages/workbench/[requestId].js)]`
- **The dashboard's stage is complete for the first two phases only.** The
  dashboard marks the presentation, the confirmed roster record, the Board
  draft and the review transition "not loaded" on each row.
  `[VERIFIED via j27-read-model-inputs.js:133-136; deriveJ27ForRow passes that input straight to the model at :150-151]`
  The consequences, from the phase rules in `j27-read-model.js:194-212`:
  - A dashboard row does not read as Final Assessment, because both facts
    that rule consults are not loaded.
  - A dashboard row reads as Deliberations once a visit assessment or roster
    memo is saved, not when its presentation is scheduled.
  - Such rows fall back to Peer Review and are flagged as partly known.
- The request page solves the same gap by merging facts from reads it already
  makes and deriving the stage again.
  `[VERIFIED via shared/utils/j27PageStage.js:76-93 and pages/workbench/[requestId].js:118-120]`
- **The Staff deliberations feed can supply what the two later phases
  need** (checked 2026-11-09). Per request it returns presentation timing,
  the review phase, and the draft writeup's availability and state.
  `[VERIFIED via lib/services/pre-site-visit/cycle-list-service.js:521-557,576,633-663 and StaffDeliberationsPanel.js:79-95,123-130]`
  It selects requests with the same program, cycle and discovery rule as
  the request list `[VERIFIED via cycle-list-service.js:325-342 and dashboard-service.js:327-341]`,
  so the two feeds can be joined by request. One caveat: the request page
  decides "a Board draft exists" from the Final writeup status's source
  document (`lib/services/final-writeup/transition-state.js:38,54,108`),
  while this feed decides it from the request's current draft pointer. The
  two rules were not proven identical for the unavailable, pending and
  ambiguous cases; the build pins the mapping with a test.
- Dashboard rows carry the request number, institution, applicant, project
  leader and Program Director, and no title.
  `[VERIFIED via dashboard-service.js:359-392, the row the feed returns]`
  Showing the title means adding it to that read. Which request field holds
  the title was not looked up and is `[ASSUMED]` to be available, since the
  Initial assessments list already shows one (`InitialAssessmentsPanel.js:86-87`).
- **The request list's feed returns stopped and decided requests** for a
  J27-or-later Research cycle (checked 2026-11-09). Such a request is
  admitted on "ready for review" alone; its request status, Phase I status
  and triage status are not consulted.
  `[VERIFIED via shared/config/workbenchVisibility.js:89-108 and dashboard-service.js:327-341]`
  So Not Scored, Not Recommended, Not Invited, Offramped, declined and
  awarded requests all remain in the feed and All requests can show them.
  This holds while the request stays marked ready for review and linked to
  the cycle and the Research program. The owner is confident the mark is
  not cleared casually (2026-11-09), so the plan relies on it.
- The tab row accepts counts but the shell passes none.
  `[VERIFIED via WorkbenchShell.js:262 and WorkbenchViewsNav.js:72,91]`
- The shell passes Final writeups, Initial assessments and Awardees a cycle
  and no program. `[VERIFIED via WorkbenchShell.js:304-336]` Its own hint text
  calls Final writeups "Not filtered by program" and Awardees "Research
  programs only" (`:172-180`); the server-side scoping behind those labels
  was not read and is `[ASSUMED]`.

The handoff's statement that next task and blockers are "already computed per
dashboard row" is therefore true for Initial Assessment and Peer Review and
incomplete for the two later phases. That gap is the main build item.

## 6. How it would be built

No build starts until the owner approves this plan. Proposed order, each
slice usable on its own:

1. **All requests and the tab row.** The shell shows the six tabs when the
   selected program is Research and the cycle is J27 or later; otherwise
   today's tabs. All requests is the Request list with the new row layout,
   the title, the phase and next task, search, the how-it-ended filter and
   "Show closed". Old links (`?view=requests` and the rest) land on the
   matching tab and section, as the request page already does for its old
   tab links.
2. **Initial Assessment and Peer Review lists.** Both come straight from the
   dashboard rows. Reviewer follow-up moves into its section.
3. **Deliberations and Final Assessment lists.** Merge the Staff
   deliberations feed into the stage, the way the request page merges its
   reads, so both phases are derived correctly. Final writeups moves into its
   section. Until this slice lands, All requests shows these requests'
   phase as partly known rather than guessing.
4. **Tab counts.**

Constraints the build keeps:

- **Scope comes from the stage model, not a cycle name.** A row has a stage
  only if it is Research and in a 2027-or-later cycle; the cycle page uses
  that same test. Existing code compares against the literal `J27` in at
  least nine non-test files
  `[VERIFIED via grep for the quoted literal under shared/, pages/ and lib/: RequestListPanel.js, pages/workbench/[requestId].js, and seven files in lib/services/workbench/]`;
  this work adds no more of them.
- **No new routes, tables or permissions.** Slice 1 adds one field, the
  title, to the existing dashboard read. Slice 3
  either reuses the Staff deliberations read on the client or widens the
  dashboard read; that choice is made in the build plan after checking
  request volume.
- **Volume.** Initial Assessment may hold about 300 requests at the start of
  a cycle (cycle information plan, owner follow-up 2026-11-05). The request
  query itself is not the limit: its ceiling is 5,000 records
  `[VERIFIED via lib/services/dynamics/constants.js:49]`. The cost is in the
  reads that follow. Reviewer counts are fetched 25 requests at a time, one
  query after another `[VERIFIED via lib/services/reviewer-rollup.js:71-74]`,
  and the reviewer-presence check is also batched by 25
  `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:464-473]`, so
  300 requests means about a dozen queries for each. The Staff deliberations
  feed reads documents, visits, schedules and materials for every request
  the discovery rule admits, which for J27 Research is every ready request,
  not only those near a presentation. This load exists on the branch's
  Request list today; the redesign does not add to it in slices 1 and 2, but
  slice 3 would run the Staff deliberations feed for All requests. Load time
  at 300 requests is measured in slice 1 before anything ships, and slice 3
  decides then whether to narrow that feed to requests past Peer Review.
- **Release.** The J27 line is not yet promoted. This work would branch from
  it and follow the same promotion decision.

## 7. Decisions

**Decided by the owner, 2026-11-09**

- **All requests is the first tab and the page opens on it.** It replaces
  two earlier answers given the same day: no cycle-level Overview tab, and
  opening on the earliest phase where the signed-in person has work.
- **Declined and withdrawn requests** stay in the phase where they stopped,
  under "Show closed", and are found through All requests. Awards appear in
  Awardees.
- **Rows show the request title** between the number and institution line
  and the Principal Investigator and Program Director line.
- **What "Initial Assessment" means.** The Initial Assessment document was
  used in the previous cycle only as a placeholder to ease the move to
  single-phase submission, and that role is done. The phrase now covers the
  material generated automatically by AI at submission, triggered by Power
  Automate.

- **The Initial Assessment document list leaves the J27 cycle page.**
  Nothing is deleted: the list stays on the earlier-cycle layout and
  existing documents stay reachable from their requests. This is consistent
  with the cycle information plan's intake decision, which makes app fields
  the intake working surface and defers any Word document assembled from
  them.
- **"Show closed" defaults to off on every list**, with the hidden count
  shown. With about 300 requests entering Initial Assessment and most
  stopping there, closed rows would bury live ones.
- **Other programs and earlier cycles keep today's tabs**, untouched.

- **"First Cut" and "Semi-finalist" are retired as terms.** Labels follow the
  Dataverse choice names: Scored, Not Scored, Recommended Invite, Recommended
  Do Not Invite, Invited, Not Invited. The stage strip and the lists show
  the two recommendations as "Recommended to Chairs" and "Not Recommended".
  The steps are called "Scoring" and "Recommendation to Chairs" for now;
  internal names were renamed to match on `claude/j27-read-model`
  (alignment log D52 on that branch).
- **The six audit suggestions are accepted** (rules 9 to 14 in section 4).
  Two were then revised after the owner reviewed a mock-up: reviewer
  progress is on the Peer Review list only (rule 10), and a waiting request
  shows a quiet status line with no role named (rule 12).
- **Program Coordinator support is to be built later; not urgent** (section 9).

No decision is waiting on the owner. The owner's answers to the audit's
questions are in section 8.

## 8. Staff flow audit

The desk audit is at `docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md`. Its six
suggestions for this plan are rules 9 to 14 in section 4. The owner answered
its questions for staff on 2026-11-09:

| Question | Owner's answer | Effect on this plan |
|---|---|---|
| Phases or meetings? | The phases make sense. | Phase tabs stand. |
| Words for standing before the Chairs meeting | Language varies; staff can adapt to the Scored / Not Scored split. | Filter labels in rule 9 stand. |
| What the Program Coordinator opens first | He probably does not use the Workbench much; he works in Meeting Tracker, which feeds the Workbench. | The scheduling cue (rule 11) is information for Program Directors, not a coordinator worklist. Coordinator support stays deferred and may belong mostly in Meeting Tracker. |
| Does the Grants Manager use the Workbench before Awardees? | To be determined; she has worked in AkoyaGO and may not need to do much in the Workbench. | Superseded after the mock-up review: rows show a quiet status line with no role named, and no filter (rule 12). |
| Looking back at earlier cycles | Has not really happened yet, since D26 is the first cycle with the dashboard; AkoyaGO has been used. Searching by Principal Investigator or institution is the likely need. | The All requests search covers Principal Investigator and institution, as well as request number and title. |
| One phase per request when work overlaps | Fine to move a request along with a reviewer outstanding, provided the row shows it so the Program Director does not forget. Tabs can be opened freely at any time. | Rule 2 stands; rule 10 carries the outstanding-review cue. |

Nothing is open after these answers. The audit
also lists request-page wording fixes that are outside this plan.

## 9. Not in this plan

Bulk edits, queues and packet exports; Southern California; any new status
or field; changes to the request page; changes to what any existing panel
reads or writes.

**Deferred, not urgent (owner, 2026-11-09): Program Coordinator support.**
The stage model's tasks are a Program Director's; scheduling, presentation
materials and the invitation email are outside it, and "Assigned to me"
means lead Program Director. Rules 11 and 13 above are the interim cover.
Coordinator tasks, a coordinator's own "mine", and coordinator next steps on
the lists are a later piece of work, tracked in `docs/CURRENT_WORK_QUEUE.md`.
The owner notes the coordinator works mainly in Meeting Tracker, so the
scope of that work is to be set when it is taken up.

## 10. Recording the decision

The handoff asks for the decision to be logged in the alignment log. That is
held until the owner approves the plan. The log on `main` ends at the
November 4 offramp decision; the November 9 offramp-status decision exists
only on `claude/j27-read-model`. `[VERIFIED via grep of both copies]` The new
entry should be added where it cannot collide with that one: on the J27 line,
or on `main` after the line merges.
