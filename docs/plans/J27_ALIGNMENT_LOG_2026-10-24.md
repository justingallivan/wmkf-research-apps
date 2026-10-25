# J27 alignment log — decisions and open items

Started 2026-10-24 (Session 639) for a meeting with Sarah (Grants Manager),
Duncan (Program Coordinator) and Connor (Systems Specialist). Justin owns the
log; entries are added as decisions are made. Each item points at its source
document so the detail is not repeated here.

**Timing.** J27 proposals arrive through GOApply. The D26 board also meets in
December 2026, so D26 board preparation and J27 intake overlap. Key J27 dates
from the provisional J27/D27 timeline (owned outside this repo; see T5):

| Date | Step | What the apps must supply |
|---|---|---|
| Mon Dec 7, 2026 | Full proposals submitted (three per institution; not pre-designated as S&E or MR) | Proposals visible to staff (R-1) |
| Tue Dec 8 | AI analysis, summary, PD assignment, expertise match (Board, PD, consultants), triage flags | R-3 |
| Wed Dec 9 – Jan 6 | Release to staff; staff read and review flags (holiday closure Dec 25 – Jan 1) | R-2 |
| Wed Jan 6, 2027 | First (AI) triage meeting: rescue or finalize decline notes | J-1 |
| Jan 13–14 | PD triage meetings to First Cut | R-2 |
| Thu Jan 14 | "First Cut" spreadsheet to Program Committee: ~50 summaries, personalized by expertise | J-2 |
| Feb 10–12 | One-page writeups; Program Chairs book in Diligent (20–25 semi-finalists) | Existing writeup tools (not checked) |
| Wed Feb 24 | Program Chairs meeting; reviewer invitations | D4 settings; materials email on acceptance |
| Mar 17 | Reviews due | T3 filing switch before this |
| Apr 19 – May 7 | Oral presentations / staff evaluations over Zoom (no site visits) | Not yet checked against Meeting Tracker / Staff Deliberations |
| May 12–13 | Ranking meetings | Proposal Ranking |
| Thu May 27 | Board books mailed | |
| Jun 9–10 | J27 Board meeting; D27 proposals arrive Jun 7–9 in the same week | Rollover plan overlap scenario |

Sources: `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`
(overlapping cycles), `docs/J27_TRANSITION_REGISTER.md` (single-phase changes,
owner questions Q1–Q25), `docs/audits/cycle-foundations-2026-10-21.md`
(production read-only check of roles and cycle records), and the owner's
J27/D27 timeline PDF and workbook (OneDrive, New Cycle Development/timelines).

## Decisions

| # | Date | Decision | Decided by | Source |
|---|---|---|---|---|
| D1 | 2026-10-24 | **Calendar authority is the Grants Manager role** (currently Sarah), with the **Program Coordinator role** (currently Duncan) as fallback. Authority attaches to the role, not the person: reassigning the role in Admin staffing moves the responsibility with no code or settings change. Authority means maintaining and confirming cycle dates used by the apps; the dates themselves stay in the operations Grant Cycle record. | Justin | Rollover plan §3.1, §7 |
| D2 | 2026-10-24 | **Reviewer reminders stay manual for J27.** PDs send reminders themselves, as in D26; the automatic reminder schedule stays off. | Justin | Register Q10 |
| D3 | 2026-10-24 | **Review filing switches from D26 to J27 once; it never has to handle both.** All D26 reviews are in, so no late D26 reviews will overlap with J27 reviews. Who makes the switch and when is task T3. | Justin | Register Q15 |
| D4 | 2026-10-24 | **Reviewer campaign settings are handled centrally, not per PD.** The review deadline, respond-by days and reviewer quota become cycle-wide values maintained centrally (under D1), replacing the per-request campaign settings PDs set today. Changing one reviewer's deadline stays a PD action. Email wording is not affected: PDs keep personal wording built on centrally seeded defaults (slice 2). | Justin | Rollover plan Slice 1 |
| D5 | 2026-10-24 | **Volume of the Dec 8 AI pass is not a concern.** A less sophisticated model will likely be used, and applications arrive over several days (heaviest near the deadline); at about 2 minutes each, 300 can be processed overnight. | Justin | Timeline Dec 8 |
| D6 | 2026-10-24 | **Expertise matching is rebuilt to run inline.** Each proposal is matched automatically as part of the intake AI pass, instead of a person running the Expertise app on demand. The current app is an early version based on the CSO's draft Claude project and needs improvement. | Justin | R-3 |

## To confirm at the meeting

| # | Question | Who | Why it matters | Source |
|---|---|---|---|---|
| A1 | What does "fallback" mean in practice: Duncan may also edit at any time, or only when the Grants Manager role is unassigned? | Sarah, Duncan, Justin | Decides whether the app grants both roles edit rights or switches to Duncan only when Sarah's role is empty. | D1 |
| A2 | Who is notified when a cycle is missing a date or has conflicting records? Proposed: Grants Manager and Systems Specialist. | Sarah, Connor | Readiness notices need named roles; there is no fallback to individuals. | Rollover plan §3.5, §7 |
| A3 | May the calendar owner publish any date change directly, or do some changes (board date, review deadline) need a second person? | Sarah, Justin | Decides whether a confirmation step is built. | Rollover plan §7 |
| A4 | Under D4, is there ever a reason one proposal needs a different reviewer quota or review deadline than the rest of the cycle? If so, who may set that exception? | Sarah, Duncan | Decides whether any per-request override survives, and whether it belongs to the PD or the calendar owner. | D4 |
| A5 | What are the J27 central values: review deadline, days a reviewer has to respond, and reviewer quota? | Sarah | These replace the values PDs entered per request. | D4 |
| B1 | **Priority — settle first.** Where in SharePoint is the J27 submitted proposal filed, and under what filename? Today the Initial Assessment reads `AI Materials/ProposalNarrative_{n}.pdf` and the Expertise batch reads a `Phase_I_Staff_Version` file; the automatic pass should read one agreed file. | Connor | Initial Assessment, expertise matching, reviewer materials and proposal lookup all depend on it. | Register Q5 |
| C1 | Is GOApply opportunity 001024 the J27 Research form? What are its real open window and submission cutoff, and when does it get its J27 cycle link? | Connor | Confirms which records intake comes from. | Foundations audit §3 |
| C2 | When the board meeting date on a Grant Cycle record changes, do linked requests' dates update, and by what mechanism? | Connor | The apps currently derive the cycle from each request's meeting date. | Foundations audit §2 |
| C3 | When and how is the next operations cycle row (D27) created, and does operations maintain only the board date or other milestones too? | Connor, Sarah | D27 has no operations row yet; the apps should read dates from one place. | Foundations audit §2 |
| C4 | What request status do J27 proposals carry when they arrive from GOApply (expected `Phase I Pending`)? | Connor | The Workbench list and triage depend on that exact label. | Register Q8, J27-064 |
| C5 | Applicants no longer choose S&E or MR. How is the program recorded on the request, who assigns it, and when? | Connor, Sarah, Duncan | Apps that filter or assign by program will find it empty at intake. | Timeline Dec 7 |
| R1 | Is the day-one list below right, and how quickly do staff need to triage in December? | Sarah, Duncan | Sets what must be built in the next six weeks versus early January. | December readiness below |
| X1 | For inline expertise matching (D6): who maintains the roster of staff, consultants and Board members and their expertise; should the suggested PD be written to the request or only shown for staff to accept; and can the CSO's current Claude project prompt be shared as the starting point? | CSO, Sarah, Duncan | Defines what the rebuilt matcher reads, produces and who trusts it. | D6 |
| R2 | Who starts and watches the Dec 8 AI pass, and what happens to proposals that arrive after it runs? Which steps are triggered by Power Automate (e.g. when a proposal file lands) and which by the apps' scheduled background jobs? | Justin, Connor | Volume is not a concern (D5), but the run needs an owner and an agreed trigger for each step. | Timeline Dec 8 |
| F1 | What are "triage flags"? Candidates: eligibility (e.g. more than three proposals from one institution), fit with Keck guidelines, or "likely decline" feeding the Jan 6 decline notes. Who may see them? Note: the current Initial Assessment deliberately makes no recommendations, so flags are a new kind of output. | Sarah, Duncan, CSO | Defines the flag step of the Dec 8 pass and the January decline notes. | Timeline Dec 8, Jan 6 |
| F2 | On Dec 9, should the suggested PD, expertise matches and flags appear as sortable columns in the triage list (so each PD can filter to their own), or only on each request's page? | Sarah, Duncan | Decides the shape of the R-1/R-2 list. | R-1, R-2 |
| F3 | If the suggested PD is not written to the request (X1), where do proposals without a confirmed PD appear so nothing is lost? | Sarah, Duncan | The "nothing gets lost" rule for triage. | X1, register J27-062 |

### B1 detail: questions for Connor

Every automatic Dec 8 step starts by reading the proposal from the request's
SharePoint folder, so the apps need the exact folder and file name. For D26
the apps use four different conventions (checked in the code 2026-10-24):

| Tool | Reads |
|---|---|
| Workbench Proposal tab | `Phase I/` subfolder: `ProjectDescription.pdf`, `Biosketches.pdf`, `ProjectBudget.pdf`, budget spreadsheet |
| Reviewer Finder and other proposal analysis | `Reviewer Materials/Proposal_{request#}.pdf` |
| Initial Assessment | `AI Materials/ProposalNarrative_{request#}.pdf` |
| Expertise app (batch) | a `Phase_I_Staff_Version` PDF |

For a cycle it does not recognize, the Proposal tab silently falls back to the
D26 names, so differently named J27 files would show as empty slots without an
error.

1. What does a J27 request's SharePoint folder contain after submission? A
   real example (e.g. a test submission) with exact subfolders and file names
   is ideal.
2. Which of those files does GOApply place, and which do Power Automate flows
   create? Do the flows that produce the `Reviewer Materials` and
   `AI Materials` copies still run for J27?
3. Can one agreed file be the input for all AI analysis (Initial Assessment,
   expertise matching, flags)? Is `ProposalNarrative` the full proposal or only
   the narrative? Matching may also need the biosketches.
4. When does that file appear after submission, and what signals that it is
   ready (a status, a field, a flow finishing)? This decides whether Power
   Automate or a scheduled job starts the AI pass (R2).
5. Can file names change after submission (resubmission, staff replacement)?
6. Will there still be a separate reviewer version of the proposal, and is
   anything in the full proposal off limits to reviewers or the AI
   (register Q21)?

Questions 1–3 unblock building; question 4 decides how the run is triggered.

## December readiness (proposed for the meeting to confirm)

Justin agreed with this assessment on 2026-10-24; colleagues may correct it at
the meeting. Code status was checked against the repository on 2026-10-24;
nothing here is built yet unless it says so.

**Needed when proposals arrive (Dec 7–9):**

| # | Need | Status today | Depends on |
|---|---|---|---|
| R-1 | Staff can see incoming J27 proposals in the Workbench. | Not built. The request list shows only requests that are `Phase II Pending` or marked Advancing, so new untriaged proposals would not appear. | C4 |
| R-2 | Staff can triage about 300 proposals, including the "Save for now" state approved 2026-09-06. | Partly built. Only Advancing and Set aside exist; triage is reachable one row at a time. The per-PD view (each PD focused on their own requests, able to see others', nothing lost) is not designed. | R1 |
| R-3 | By Dec 9, every proposal has an AI summary/Initial Assessment, a suggested PD, an expertise match (Board, PD, consultants) and triage flags. | Partly ready. The D26 Initial Assessment tooling exists and its view is not hidden for J27. Expertise matching must be rebuilt to run inline (D6): today a person runs it per proposal (PDF upload or a chosen batch), the batch looks for D26's `Phase_I_Staff_Version` PDF, and results stay in the app's own Postgres tables rather than on the request. Not yet done: one automatic run per proposal covering all four outputs, and the deferred Production write check. Volume is not a concern (D5). | B1, C5, R2, X1 |
| R-4 | PDs can advance a proposal to `Phase II Pending` from the Workbench. | Not verified whether this exists. | C4 |

**Proposed minimum for December:** proposals visible in a list, the
"Save for now" state, and the R-3 AI pass run as proposals arrive. The fuller
per-PD triage view could follow in early January, before the Jan 13–14 PD
triage meetings.

**Needed in January (not yet checked against the code):**

| # | Need | By |
|---|---|---|
| J-1 | Decline notes for proposals that are not advancing, ready to rescue or finalize | Jan 6 |
| J-2 | "First Cut" spreadsheet: ~50 summaries, personalized to each Program Committee member's expertise | Jan 14 |

**Needed by Feb 24 (reviewer invitations):** central reviewer settings (D4),
the automatic materials email on reviewer acceptance, and Reviewer Finder
using bibliographies if it is in scope. Task T3 must be done before reviews
come back on Mar 17.

**Scheduled for November 2026 (Justin, 2026-10-24):** central reviewer
settings per D4 (rollover plan Slice 1), unblocked: the reviewer deadline email
work (slice 2) shipped as PR #521 on 2026-10-24.
A5 (the J27 central values) is needed from Sarah before it can ship.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| T1 | Record D1 in the rollover plan and work queue. | Claude | Done 2026-10-24 |
| T2 | Record D2 in the J27 register (Q10) and reviewer engagement spec. | Claude | Done 2026-10-24 |
| T3 | Switch automatic review-document filing from D26 to J27 (one Production setting, `REVIEW_DOCX_SHAREPOINT_CYCLE`, plus redeploy) after confirming D26 filing is complete and before the first J27 review comes back in 2027. | To assign at meeting | Open; date to agree (see D3) |
| T4 | Record the December readiness list in this log. | Claude | Done 2026-10-24 |
| T5 | Correct weekday-label errors in the J27/D27 timeline workbook (mostly the D27 page, including the D27 Board meeting days). Not blocking for J27: the J27 dates are correct apart from two labels. | Timeline owner | Emailed with a suggested fix prompt 2026-10-24; awaiting reply |
