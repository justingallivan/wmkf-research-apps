---
title: J27 staff flow audit
domain: workbench
kind: audit
status: draft
summary: Desk audit of whether the J27 Workbench flows make sense to a Program Director, a Program Coordinator and the Grants Manager, with the changes it suggests for the cycle page plan and the questions only staff can answer. Findings for owner review; nothing built or changed.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md
---

# J27 staff flow audit

Author: Claude for Justin Gallivan, 2026-11-09. **Findings for owner review.**
The findings describe the branch as it stood when the audit was written and
quote its wording then, including the terms "First Cut" and "Semi-finalist".
After reading them the owner retired both terms and had the labels and
internal names changed on `claude/j27-read-model` the same day; findings 2
and 6 are affected, as noted on each.

## How this was done, and its limits

This is a desk audit. No staff member was asked anything and no screen was
exercised by hand. Sources:

- The alignment log's state model, decision calendar and "who sets which
  field" table, read on branch `claude/j27-read-model`.
- The walkthrough deck prepared on 2026-11-09 (slide text). The owner has
  since said the deck is out of date and does not reflect current thinking
  or the proposed design (2026-11-09). No finding below rests on it alone.
- The stage model, `lib/services/workbench/j27-read-model.js`, read in full.
- The request-page screens on that branch, read by a delegated pass that
  reported labels, permissions and handoffs with file and line. I rechecked
  the quoted strings behind findings 5, 6, 8 and 9 by search; the rest of
  that pass is `[REPORTED, not rechecked]`.

Sandbox requests 1000380 to 1000387 were not opened; the deck's screenshots
of them were used instead. What staff actually do each day is not something
this audit can establish; section 4 lists what to ask them.

## 1. Findings by role

### Program Director

1. **Initial Assessment is one phase but most of the cycle's sorting.** By
   the alignment log's calendar it runs from the December 8 AI pass to the
   February 24 Chairs meeting and takes about 300 proposals down to 20 to 25.
   First Cut, the Semi-finalist recommendation and the wait for the Chairs
   all happen inside it. A single list of that phase would hold nearly the
   whole cycle for two and a half months.
2. **The words for those decisions are not settled.** The alignment log's
   staff states are Submitted, Flagged for concerns, Triaged, Under
   consideration and Recommend to Program Chairs. The screens use First Cut
   (Scored, Not Scored) and "Recommend as a semi-finalist?" (Yes, No). The
   stage model's labels for the same facts are "Recommended to Chairs,
   awaiting outcome" and "Triaged". The cycle information plan records that
   this vocabulary was reopened on November 5 pending colleague input. Any
   cycle-page filter on standing inherits the open question. **Resolved
   2026-11-09:** the owner retired "First Cut" and "Semi-finalist"; labels
   now follow the Dataverse choice names, with "Recommended to Chairs" and
   "Not Recommended" on the strip. The wider status vocabulary stays open.
3. **Reviewer work starts before Peer Review.** The alignment log lets
   Program Directors shortlist reviewers once a proposal is recommended to
   the Chairs, and the stage model offers "Identify reviewers" in any phase
   while fewer than three reviews are complete
   `[VERIFIED via j27-read-model.js:263]`. A reviewer-progress cue shown only on the
   Peer Review list would miss those requests.
4. **Blockers name a field, not a person.** "Reviewer invitations open once
   the Phase II status is Pending Committee Review" tells a Program Director
   what value is missing but not who supplies it.
5. **Single-phase work still reads "Phase I" and "Phase II".** The First Cut
   card shows "Phase I status: …" and the proposal section lists "Phase I
   documents" and "Phase II documents".
6. **Read-only states give no reason.** A Program Director who is not the
   request's lead sees "First Cut is read-only." and no integrity or reviewer
   controls, without being told that the lead Program Director records them. (The
   message now reads "Scoring is read-only."; the missing reason remains.)
7. **The deck misplaces two steps; the stage model is right** (owner,
   2026-11-09). The deck puts group review under Deliberations and the staff
   visit assessment under Final Assessment. The stage model, which the
   request page uses, has the visit assessment under Deliberations and group
   review under Final Assessment. `[VERIFIED via the deck's cycle slide and j27-read-model.js:44-47]`
   The deck should not go to colleagues as it stands.
8. **One document, five names.** On Final Assessment the same Word document
   is called Final Assessment, Board recommendation, Board draft, draft
   writeup and final writeup.
9. **Text points to tabs that no longer exist.** "Resolve on the Reviewers
   tab" (now Panel) and "Check Staff Deliberations before starting group
   review" (now Deliberations).
10. **Smaller wording splits.** "Visit" and "presentation" for the same
    event; "Panel" for the reviewer roster beside "AI Review Panel"; Overview
    next steps that name a tab in plain text instead of linking to it.

### Program Coordinator

11. **The request page has no coordinator role.** Controls are gated to the
    lead Program Director or a superuser, or open to any staff. The one
    coordinator effect that reaches it is seeing the lead's draft before
    group review. `[REPORTED from the delegated search of the
    request-page components and routes, not rechecked]`
12. **Coordinator work is deliberately outside the stage model.** Scheduling
    a presentation, presentation materials, the invitation email and
    transcription are listed as operations the model does not treat as
    tasks. `[VERIFIED via j27-read-model.js:56-59]` So "next task" on a
    cycle list is a Program Director's next task. Between the Chairs' invite
    and the end of the presentation a coordinator would see nothing to do,
    while today's Staff deliberations tab shows "Schedule needed".
13. **"Needs coordinator attention" has no link.** The presentation
    materials card says uploads need coordinator attention and offers no
    action there; the work is in Meeting Tracker.
14. **"Assigned to me" means lead Program Director.** A coordinator has no
    requests of their own under that switch.

### Grants Manager

15. **The Grants Manager's decisions are recorded in Dynamics and only read
    here.** The Chairs' outcome, the status that opens invitations, and
    declines are all set outside the Workbench (alignment log, "who sets which
    field" table). The
    Workbench shows them as blockers on a Program Director's row. None of
    the six cycle-page tabs is a list of requests waiting on the Grants
    Manager. `[VERIFIED via the tab registry in WorkbenchViewsNav.js:17-42]`
16. **Who records the offramp is still open** (Program Director or Grants
    Manager), as is where its justification lives. Both are already on the
    owner's decision list.
17. **Awardees is the one place the Grants Manager acts in the Workbench**,
    and it is unchanged by the redesign. `[REPORTED, not rechecked]`

## 2. What this suggests for the cycle page plan

Proposed, not yet applied to the plan:

- **A. Initial Assessment needs a filter on standing**: Not yet scored,
  Scored, Recommended to Chairs.
  Without it finding 1 makes the list unusable in January. The labels wait
  on finding 2.
- **B. Show reviewer progress on any row that has reviewer activity**, on
  All requests and Initial Assessment as well as Peer Review (finding 3).
- **C. Keep the scheduling cue on the Deliberations list** ("Not scheduled",
  time not confirmed), since the stage model will not supply it (finding 12).
- **D. Say who a blocked request is waiting on**, and let All requests
  filter on it. That gives the Grants Manager and the coordinator a worklist
  without a new role (findings 4, 15).
- **E. For someone who leads no requests, open the lists on "All in
  program"** (finding 14).
- **F. Take every label from one shared list**, so the cycle page cannot
  add a sixth name for anything (findings 2, 8).

## 3. Request-page fixes outside the cycle page plan

Findings 5, 6, 8, 9, 10 and 13 are wording and link fixes on the request
page. They are small, they do not depend on the cycle page, and they could
be done before colleagues see the branch. Finding 7 is settled: the stage model
stands. The deck is out of date and would be rebuilt after the cycle page
plan is final, if a deck is still wanted.

**Status, 2026-11-10** (J27 line, commit `eaf8758f1` and the one after it
on `claude/j27-cycle-page`; not promoted):

- **Fixed: 6** in part. A read-only Scoring card now says "Only the lead
  Program Director or a superuser can record it." when authority is what is
  missing. The absent integrity and reviewer controls still give no reason.
- **Fixed: 9.** The two messages name the tab the current layout has
  ("Panel", "Deliberations"); the earlier layout keeps its own names.
- **Fixed: 13.** The "needs coordinator attention" line on the presentation
  materials card links to the meeting record.
- **Fixed: the stage strip** (build plan, finding 1). It uses the cycle
  list's next-step rule, so a request waiting on the Chairs reads "Awaiting
  the Chairs' outcome". The optional offramp task no longer leads on the
  request page, and "Nothing is waiting on staff right now." appears only
  once every fact behind it has loaded.
- **Open, needs the owner's wording: 5, 8, 10.** What replaces "Phase I
  status" and the "Phase I / Phase II documents" headings; one name for the
  Final Assessment document; "visit" or "presentation"; "Panel" beside "AI
  Review Panel". The plain-text tab names in Overview next steps (10) are
  also still unlinked.

## 4. Questions only staff can answer

Answered by the owner on 2026-11-09; the answers and their effect are
recorded in section 8 of the cycle page plan. In brief: the phases make
sense; staff can adapt to the Scored / Not Scored wording; the Program
Coordinator works mainly in Meeting Tracker and uses the Workbench little;
the Grants Manager's use of the Workbench is undetermined; looking back at
earlier cycles has not yet been a habit, and Principal Investigator and
institution are the likely search terms. One phase per request is
acceptable when work overlaps, provided a row shows any review still
outstanding.
