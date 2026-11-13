---
title: J27 cycle page design brief
domain: workbench
kind: plan
status: draft
summary: Design brief for the J27 Workbench cycle page — tab row, control row, the request row, states and wording. Revised 2026-11-09 after the owner reviewed a mock-up; no build authorized. Extends the existing Workbench look; no code.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md
  - DESIGN.md
---

# J27 cycle page design brief

Author: Claude for Justin Gallivan, 2026-11-09. **Revision 2, after the
owner reviewed the first mock-up the same day. No code and no build.** What
the page contains is settled in the redesign plan; this brief says how it is
laid out and worded. Section 7 lists the owner's decisions and what the
mock-up review changed.

## 1. Job and audience

A Program Director opens the Workbench to see their requests for the cycle,
find the ones that need something from them, and open one. Per the owner's
standing direction (2026-10-05), every Program Director is new to this
application and this workflow, so each row must say plainly what is next.
This is a working list, used at a desk on a desktop screen.

## 2. Direction

**Extend the existing Workbench look; introduce nothing new.** The suite's
design guide ("The Clear Workbench") already covers this page type: a list
on white with fine gray rules, ink for the active tab and primary action,
and color only where it carries meaning.

**One row everywhere.** Every tab shows the same request row: who the
request is, where it stands, and what is next. A tab changes which requests
are listed. Only the Peer Review tab adds anything to the row, the reviewer
progress bar, because that is where reviewer work happens.

**Design against a real moment in the cycle.** At any time most requests
share one or two phases: nearly all are in Initial Assessment in January,
and the invited ones are in Peer Review or Deliberations in April. A screen
that mixes every phase does not occur and should not be used to judge the
design.

## 3. Page layout

A Program Director's list in mid-January (titles and people invented):

```
Workbench                          [Grant program ▾] [Grant cycle ▾] [Find and open a request]

All requests   Initial Assessment (38)   Peer Review   Deliberations   Final Assessment   Awardees
──────────────
Every request in this program and cycle, with where it stands and what is next.

[Assigned to me (52) | All in program]  [Search PI, institution, title or number ]  [Showing: Open requests ▾]
52 requests · 9 closed requests hidden

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ #1009001  Northfield University                    [Not yet scored]                      │
│ Sample title: mapping signalling lipids in …       Next: Record the staff rationale      │
│ PI Alex Sample · PD Jordan Example                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ #1009058  Coastal Research University              [Scored]                              │
│ Sample title: deep-ocean microbial carbon cycling  Next: Record the recommendation to    │
│ PI Taylor Placeholder · PD Jordan Example          Chairs                                │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ #1009014  Lakeshore Institute of Technology        [Recommended to Chairs]               │
│ Sample title: programmable lattices assembled …    Awaiting the Chairs' outcome          │
│ PI Morgan Placeholder · PD Jordan Example                                                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Header.** Unchanged: page title, program, cycle, Find and open a request.

**Tab row.** Six underline tabs in cycle order, All requests first and
selected on arrival. A phase tab carries a count pill when it holds requests
with a next task for the current scope; a zero count shows no pill. All
requests and Awardees carry no count.

**One line of description** under the tabs, as today:

| Tab | Line |
|---|---|
| All requests | Every request in this program and cycle, with where it stands and what is next. |
| Initial Assessment | Requests being read, scored and recommended to the Chairs. |
| Peer Review | Requests invited by the Chairs: reviewers, invitations and reports. |
| Deliberations | Requests with a research presentation: schedule, attendance and the staff assessment. |
| Final Assessment | Requests with a Board draft, or in group or leadership review. |
| Awardees | Unchanged. |

**Control row,** one line, left to right:

1. Section switch, only on tabs that have a second section: "Requests |
   Reviewers" on Peer Review, "Requests | Writeup review" on Final
   Assessment. Choosing the second section shows the existing panel
   unchanged, with its own controls.
2. Scope: "Assigned to me (n) | All in program", as today. Someone who leads
   no requests arrives on All in program.
3. Tab-specific control:
   - All requests: a search field, and one "Showing" menu with Open requests
     (default), Everything, then each ending (Not Scored, Not Recommended,
     Not Invited, Offramped, Not awarded, Withdrawn, Awarded).
   - Initial Assessment: filter chips "All · Not yet scored (n) · Scored (n)
     · Recommended to Chairs (n)". A chip with nothing in it is disabled.
   - Phase tabs: a "Show closed" checkbox, in the place "Include set-aside
     requests" occupies today.

**Count line.** "52 requests", and when closed requests are hidden, "· 9
closed requests hidden" as a link that shows them.

The first row starts within the design guide's limit for list pages (240px
below the top of the main area).

## 4. The request row

Two parts on a desktop screen, three on the Peer Review tab.

**Left: identity,** three lines, the same on every tab (owner, 2026-11-09):

1. Request number (the link; the whole row is clickable and opens in a new
   tab like any link) and institution. TEST badge here when it applies.
2. Request title, one line, cut with an ellipsis; the full title shows on
   hover.
3. "PI name · PD name", small and muted.

**Right: standing and next step.**

- A chip saying where the request stands, then one line beneath it. The
  chip is the standing, not the phase; the tabs already give the phase.

  | Phase | Standing chips |
  |---|---|
  | Initial Assessment | Not yet scored · Scored · Recommended to Chairs |
  | Peer Review | Today's reviewer stages: Find reviewers · Invite · Awaiting replies · In review · Sufficient coverage |
  | Deliberations | Today's presentation timing: Not scheduled · Before presentation · After presentation |
  | Final Assessment | Board draft · Group review · Leadership review |
  | Closed | Not Scored · Not Recommended · Not Invited · Offramped · Not awarded · Withdrawn · Awarded |

- The line beneath is exactly one of:
  - **Next: …** the next task, in the stage strip's words.
  - A quiet status line when the request is waiting and nothing is due from
    the reader, for example "Awaiting the Chairs' outcome". No role is
    named: these waits are short.
  - **Nothing is waiting on staff right now.** muted.
  - nothing, for a closed request; its chip says how it ended.
- A third, small line appears only when it applies:
  - "1 review outstanding" in amber, when a request has moved past Peer
    Review with a review still due.
  - "Some details could not be read." muted, when part of the record could
    not be loaded.

**Peer Review tab only: reviewer progress,** at the right of the row, as on
today's Request list (summary, bar and legend). It appears on no other tab
and not on All requests.

**Color.** Standing chips are neutral gray, with these exceptions already
in use today: the reviewer stage chips keep their existing colors, "Not
scheduled" is amber, group and leadership review are violet, and "Awarded"
is green. Amber is otherwise kept for something to check.

**Order.** By request number, as today.

**Height.** Three identity lines make the row about 80px, above the design
guide's "about 64px" for list rows.

## 5. States

| State | What shows |
|---|---|
| Loading | Placeholder rows in the list's place; tabs and controls stay usable. |
| Refreshing | The small "Updating…" note, as today. |
| Empty tab | Why it is empty and what fills it. Example for Peer Review: "No requests are in Peer Review yet. A request arrives here once the Chairs' outcome is recorded as Invited." If closed requests are hidden, a link to show them. |
| Empty search | "No requests match '…'." with a Clear search link. |
| Error | A message in the list's place with Retry; tabs, controls and the header stay. |
| Read-only Preview | Unchanged; the lists have no actions to disable. |
| Until the later phases are derived | Requests that may be in Deliberations or Final Assessment show their last known standing with "Some details could not be read." rather than a guess. *(Interim only. Since 2026-11-10 the later phases are derived on the J27 line; see `docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md`.)* |

Ranges to design against: 0 to about 300 rows on All requests in December
(the cycle information plan's figure). The rest are working estimates, not
measured, `[ASSUMED]`: a few dozen rows under "Assigned to me", and titles
and institution names long enough that both must be cut to one line.

## 6. Boundaries

- Earlier cycles and other programs keep today's tabs and rows untouched.
- The Reviewers and Writeup review sections, and Awardees, are the existing
  panels with no visual change.
- No new actions on any row. Rows open the request page on its current phase.
- No internal ids anywhere.
- Narrow screens need only stay usable: the row's parts stack, tabs scroll
  sideways as they do today.
- Not designed here: the request page.

## 7. Decisions (owner, 2026-11-09)

Confirmed before the mock-up:

1. **Row height.** Rows are about 80px so the title has its own line.
2. **One "Showing" menu on All requests,** in place of a "Show closed"
   switch plus a separate how-it-ended filter. Phase tabs keep the "Show
   closed" checkbox.
3. **Row order.** By request number, as today.
4. **Identity lines on the Deliberations list.** The three-line identity
   replaces the layout agreed on 2026-10-06 for the Staff deliberations
   list, so every list matches.

Changed after the owner reviewed the first mock-up, which mixed one request
from every phase on a single screen:

5. **The reviewer bar appears only on the Peer Review tab.** On All
   requests it was present on some rows and absent on others, and its red
   segment (reviewers who declined) read as a problem even on a finished
   request. This reverses the earlier choice to show reviewer progress on
   every row with reviewer activity.
6. **The row has two parts,** identity and standing, except on Peer Review.
7. **The chip is the standing, not the phase.** A phase chip would repeat
   one word down the page, since most requests share a phase at any moment.
8. **No "Waiting on: role" line.** A quiet status line replaces it. The
   Grants Manager records the Chairs' outcomes on or about the day of the
   meeting, so naming her on every row adds length for a wait that rarely
   lasts.
9. **Mock-ups show a real moment in the cycle,** not every phase at once.
