# Final Writeup Group Review — Approved UX Direction

## Review purpose

This is the owner-approved product direction as of 2026-08-30. Runtime remains
unstarted. The implementation contract and prerequisites live in
`docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`.

The design should answer one question for every participant: **What deserves my attention, and how do I open it?**

## Context

A Program Director (PD) generates a pre-site-visit Word draft and shares it with colleagues as reference material before a site visit. The system preserves the exact human-readable version that was sent. That preserved version becomes the transparent starting point for the PD's post-visit work; the PD adds what was learned at the visit without needing to understand SharePoint filenames, snapshots, or successor documents.

When the responsible PD is satisfied with the post-visit writeup, they deliberately move it into Final Writeup group review. Colleagues collaboratively edit the same Word document. This is informal review, not a formal approval or audit workflow. In principle every PD reviews every Final Writeup, but in practice participation varies.

Program Coordinators (PCs) see all writeups. They edit and proofread, may move documents between review stages, and eventually help steward the underlying Word documents into a board package assembled in other software. The Chief Scientific Officer (CSO) focuses primarily on content; the President focuses primarily on readability. Their review order must not be enforced.

## Proposed lifecycle

1. **Site Visit Writeup — In progress**
   - The responsible PD edits the post-visit document in Word.
   - The deliberate transition is labeled **Ready for group review**.
   - The system preserves an exact checkpoint transparently while maintaining one clear, current working document for the user.
   - The transition creates Final lineage over the same stable SharePoint Word
     item. It must not leave an older editable sibling that can silently diverge.

2. **Final Writeup — Group review**
   - All PDs and all PCs can open and collaboratively edit the same Word document.
   - Each person can independently mark the document **Reviewed**.
   - The responsible PD normally selects **Ready for leadership review**.
   - A PC can perform the transition as a backup in an exceptional case, with the actual actor recorded.

3. **Final Writeup — Leadership review**
   - The CSO and President can find, open, edit, and mark the document reviewed.
   - No CSO-versus-President sequence is enforced.

4. **Board-package handoff — discovery pending**
   - The PCs' actual downstream process is not yet known and is deliberately excluded from the current interface design.
   - A likely future pattern is a PC action that creates a derivative copy with a standardized filename and destination for Power Automate.
   - That action must not rename or move the collaborative working document.
   - State names, replacement behavior, batching, and the exact automation contract remain open until PC interviews are complete.

## Responsible-PD Final Writeup panel

The request-level Final Writeup panel is primarily a management surface for the responsible PD, with PC backup access. It is not the normal destination for colleagues or leadership reviewing across requests.

### Shared document information

- Document title and current stage
- Brief sentence explaining what happens in this stage
- One prominent **Edit writeup** action for the responsible PD
- Last-updated information
- Positive-only review participation, shown as neutral circles with reviewer initials

Initial circles accrue for people who explicitly marked the document reviewed. Hover/focus reveals the full name and review date. The panel does not show a denominator, a missing-person list, or overdue/noncompliance language. PCs and leadership appear alongside PDs when they review. Acknowledgements remain visible after later edits.

The responsible PD is not included merely because they own or advance the writeup. The circles represent other participants who explicitly reviewed it.

### Permission-specific next step

The responsible PD sees the stage-advancing section and action as part of the normal workflow. PCs have the same underlying authority as a backup, but the action should be presented as a secondary, exceptional operation rather than as their routine next step. Other PD reviewers cannot advance the writeup. The UI should not display an explanatory note such as “Shown to PDs and PCs”; permissions quietly determine whether the section exists. Every transition records the actual actor.

## Dedicated reviewer page

The cross-request dashboard leads colleagues and leadership to a focused review page rather than requiring them to navigate the responsible PD's full request Workbench. The task appears first: review the writeup, return to record the review, and continue to the next writeup.

Throughout the Workbench, action labels describe the person's intent rather than the application that opens. The responsible PD receives **Edit writeup**. Anyone who is not the responsible PD defaults to **Review writeup**, both on dashboards and on the focused review page. Word may still be identified in file details when the format itself matters, but it is not included in routine action labels or explanatory card copy. PC backup or stewardship controls remain secondary and do not replace that default review framing.

The page includes a collapsed **Supporting materials** section with read-only links to the proposal, initial assessment, reviews, and any other agreed context. It does not reproduce the corresponding Workbench tabs or controls. A quiet **View full request** link may remain for unusual cases where broader context is needed and the person has access.

### Personal review information

Only this section is user-specific, and it is shown to collaborators reviewing someone else's writeup:

- **Needs review**
- **Reviewed**
- **Updated since your review**
- **Mark reviewed** or **Mark latest version reviewed**

A review acknowledgement refers to a specific document version. Later edits do not erase it or trigger routine notifications. This supports the common case where someone reads the document and has no edits; Word change tracking alone cannot establish that review occurred.

The responsible PD does not receive a personal **Mark reviewed** action for their own writeup. Selecting **Ready for leadership review** is already their acknowledgement that the current document is ready to advance.

## Cross-request dashboard

The dashboard should remain much simpler than the underlying workflow. It is primarily for occasional users who need to find what requires attention and open it immediately.

Baseline presentation:

- Page title: **Final writeups**
- One search field covering request, organization, and person
- Primary list: **Needs your review**
- Secondary list or link: **Reviewed**
- Each reviewer/leadership row shows request/title, organization, responsible PD's name as secondary context, current stage, last update, personal review state, and a prominent **Review writeup** action leading to the dedicated page
- PC rows also default to **Review writeup**; request-level backup or stewardship access is secondary

The application quietly changes the starting view:

- PD: writeups needing that person's review
- PC: all active writeups
- CSO/President: writeups ready for leadership review

PCs and superusers also receive the full coordinator matrix: every in-scope
writeup against the intended reviewer set, with neutral blank, Reviewed, and
Updated since review states. The matrix is not an approval record, completion
score, or compliance report; no blank is treated as a failure and no reviewer
count or review order is required.

The President's starting view is a fixed **Open for review** list with search and one prominent **Review writeup** action per row. Already-reviewed documents live behind a secondary **View reviewed writeups** link. A later edit may show **Updated since your review** within that reviewed history, but it does not return the document to the primary list or generate an alert.

The unsettled board-package workflow does not appear in this dashboard yet. Older writeups may eventually live behind a modest secondary link, but their terminal state is not defined. Program taxonomy is not used for permissions or primary organization: PCs see everything, and the existing Science and Engineering / Medical Research nomenclature is being phased out without a settled Dataverse replacement.

## Notifications

Routine Word edits do not generate alerts. If notifications are later desired, they should correspond only to intentional workflow events such as becoming ready for leadership review. Board-package notifications remain part of the pending PC discovery.

## Explicit non-goals

- Formal approvals, sign-offs, or required reviewer counts
- Enforced PD participation
- Enforced CSO/President order
- Rebuilding Word collaboration inside the application
- Embedding Word or providing an in-Workbench document editor; Edit/Review
  actions open the canonical document in a separate browser window/tab, with
  desktop Word available only through Microsoft's supported option
- Exposing SharePoint filenames or copy/snapshot mechanics
- Organizing the new experience around the changing program taxonomy
- Integrating the separate board-package assembly software

## Later leadership refinement

Leadership input may refine prioritization and notification preferences, but it
does not reopen the approved audience, same-document contract, acknowledgement
semantics, or no-sequence rule.

## Visual reference

Interactive panel-state mockup:

`/Users/gallivan/.codex/visualizations/2026/08/28/01a04a67-7c10-79f2-8992-8a8c13fc4141/final-writeup-panel-states.html`

Interactive cross-request dashboard mockup:

`/Users/gallivan/.codex/visualizations/2026/08/28/01a04a67-7c10-79f2-8992-8a8c13fc4141/final-writeup-dashboard-views.html`

Interactive dedicated reviewer-page mockup:

`/Users/gallivan/.codex/visualizations/2026/08/28/01a04a67-7c10-79f2-8992-8a8c13fc4141/final-writeup-review-page.html`

Interactive President dashboard mockup:

`/Users/gallivan/.codex/visualizations/2026/08/28/01a04a67-7c10-79f2-8992-8a8c13fc4141/president-final-writeups-dashboard.html`

## Requested review

Walk through the experience as:

1. The responsible PD preparing and advancing a writeup
2. Another PD who reviews only occasionally
3. A PC proofreading and stewarding all active writeups
4. The CSO or President arriving from the dashboard

Identify confusing language, missing states, accidental compliance pressure, permission ambiguities, and places where internal document mechanics leak into the UI. Distinguish blocking design problems from refinements. Do not propose implementation or schema changes unless they reveal a product-level requirement the design has missed.
