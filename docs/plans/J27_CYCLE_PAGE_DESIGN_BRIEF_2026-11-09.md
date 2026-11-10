---
title: J27 cycle page design brief
domain: workbench
kind: plan
status: draft
summary: Design brief for the J27 Workbench cycle page — tab row, control row, the request row and its variants per tab, states and wording — confirmed by the owner 2026-11-09; no build authorized. Extends the existing Workbench look; no code.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md
  - DESIGN.md
---

# J27 cycle page design brief

Author: Claude for Justin Gallivan, 2026-11-09. **Confirmed by the owner on
2026-11-09, including the four decisions in section 7. No code and no
build.** What the page contains is settled in the redesign plan; this brief
says how it is laid out and worded.

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

**One row, six lenses.** Every tab shows the same request row. A tab changes
which requests are listed and what the right-hand side of the row reports.
The left side of the row and the position of "Next:" never move, so a
Program Director learns the row once.

## 3. Page layout

```
Workbench                          [Grant program ▾] [Grant cycle ▾] [Find and open a request]

All requests   Initial Assessment (12)   Peer Review (3)   Deliberations   Final Assessment (1)   Awardees
──────────────
Every request in this program and cycle, with where it stands and what is next.

[Assigned to me (41) | All in program]  [Search PI, institution, title or number ]  [Showing: Open requests ▾]
41 requests · 212 closed requests hidden

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ #1002852  Johns Hopkins University            [Initial Assessment]                           │
│ Mapping the lipid code of synaptic vesicles   Next: Record Scored or Not Scored              │
│ PI Anthony Leung · PD Justin Gallivan                                                        │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ #1002874  University of Florida               [Peer Review]                3/3 accepted · 13 │
│ Phage defence systems as genome editors       Next: Read the reviewer reports  ▇▇▇▇▇▇▇       │
│ PI Artem Nemudryi · PD Justin Gallivan                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ #1002903  University of Southern California   [Initial Assessment]                           │
│ Programmable matter from DNA origami lattices Waiting on: Grants Manager — the Chairs'       │
│ PI Peter Yingxiao Wang · PD Justin Gallivan   outcome has not been recorded                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Titles above are invented for the sketch.

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
   - All requests: a search field, and one "Showing" menu (section 7).
   - Initial Assessment: filter chips "All · Not yet scored (n) · Scored (n)
     · Recommended to Chairs (n)". A chip with nothing in it is disabled.
   - Phase tabs: a "Show closed" checkbox, in the place "Include set-aside
     requests" occupies today.

**Count line.** "41 requests", and when closed requests are hidden, "· 212
closed requests hidden" as a link that shows them.

The first row starts within the design guide's limit for list pages (240px
below the top of the main area).

## 4. The request row

Three columns on a desktop screen.

**Left: identity,** three lines, the same on every tab (owner, 2026-11-09):

1. Request number (the link; the whole row is clickable and opens in a new
   tab like any link) and institution. TEST badge here when it applies.
2. Request title, one line, cut with an ellipsis; the full title shows on
   hover.
3. "PI name · PD name", small and muted.

**Middle: standing and next step.**

- A chip, then one line beneath it.
- On All requests the chip is the phase. On a phase tab the phase is already
  known, so the chip is the standing within it: "Scored" or "Recommended to
  Chairs"; the presentation timing on Deliberations ("Before presentation",
  "Not scheduled"); "Group review" or "Leadership review" on Final
  Assessment.
- The line beneath is exactly one of:
  - **Next: …** the next task, in the stage strip's words.
  - **Waiting on: Grants Manager — …** when someone else must act first.
  - **Nothing is waiting on staff right now.** muted.
  - nothing, for a closed request; its chip says how it ended.
- When part of a request's record could not be read, a small muted note
  follows: "Some details could not be read."

**Right: reviewers and dates.**

- Reviewer progress, as on today's Request list, on any row with reviewer
  activity. The labelled legend under the bar appears only on the Peer
  Review tab; elsewhere the summary and bar are enough.
- "1 review outstanding" in amber when the request has moved past Peer
  Review with a review still due.
- On Deliberations, the presentation date and time.
- Empty when none of these apply.

**Color.** Phase and standing chips are neutral gray: they describe, they do
not judge. Closed endings are gray. "Awarded" is green. Group and leadership
review are violet, as they are today. Amber is kept for something to check:
a review outstanding, reports changed since the summary, attendance out of
date, "Not scheduled". "Waiting on" is plain text, not amber, because it is
not the reader's problem to fix.

**Order.** By request number, as today (section 7).

**Height.** Three identity lines make the row about 80px, above the design
guide's "about 64px" for list rows. This follows from adding the title (section 7).

## 5. States

| State | What shows |
|---|---|
| Loading | Placeholder rows in the list's place; tabs and controls stay usable. |
| Refreshing | The small "Updating…" note, as today. |
| Empty tab | Why it is empty and what fills it. Example for Peer Review: "No requests are in Peer Review yet. A request arrives here once the Chairs' outcome is recorded as Invited." If closed requests are hidden, a link to show them. |
| Empty search | "No requests match '…'." with a Clear search link. |
| Error | A message in the list's place with Retry; tabs, controls and the header stay. |
| Read-only Preview | Unchanged; the lists have no actions to disable. |
| Until the later phases are derived | Requests that may be in Deliberations or Final Assessment show their last known phase with "Some details could not be read." rather than a guess. |

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
- Narrow screens need only stay usable: the three columns stack, tabs scroll
  sideways as they do today.
- Not designed here: the request page, and the wording of each "Waiting on"
  line, which is written with the owner.

## 7. Decided (owner, 2026-11-09)

1. **Row height.** Rows are about 80px so the title has its own line, above
   the design guide's "about 64px" for list rows.
2. **One "Showing" menu on All requests,** in place of a "Show closed"
   switch plus a separate how-it-ended filter. Options: Open requests
   (default), Everything, then each ending (Not Scored, Not Recommended, Not
   Invited, Offramped, Not awarded, Withdrawn, Awarded). Phase tabs keep the
   "Show closed" checkbox.
3. **Row order.** By request number, as today, so a request is always in
   the same place.
4. **Identity lines on the Deliberations list.** The three-line identity
   replaces the "#number + title" then "Institution · PI · PD" layout agreed
   on 2026-10-06 for the Staff deliberations list, so every list matches.
