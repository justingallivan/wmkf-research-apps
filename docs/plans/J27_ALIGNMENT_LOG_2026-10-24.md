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
| B1 | **Partly answered 2026-10-26; see B1 detail.** **Priority — confirm first.** The AI input files are already decided (owner, 2026-08-17): `AI Materials/ProposalNarrative_{n}.pdf` and `AI Materials/ProposalBibliography_{n}.pdf`, produced by Power Automate. Confirm the flows produce both for J27's single submission, when, and what else lands in the request folder. The Dec 8 pass, including expertise matching, reads the narrative file. | Connor | Initial Assessment, expertise matching, reviewer materials and proposal lookup all depend on it. | Register Q5 |
| C1 | **Answered 2026-10-26 (Justin): yes, 001024 is the Research form; no app concern** (no app code keys on the opportunity; grep 2026-10-26). Is GOApply opportunity 001024 the J27 Research form? What are its real open window and submission cutoff, and when does it get its J27 cycle link? | Connor | Confirms which records intake comes from. | Foundations audit §3 |
| C2 | **Partly answered 2026-10-26 (Justin):** a placeholder meeting date is believed to be set on submission (open: confirm its value); date moves are handled by a Power Automate flow. The apps derive the cycle only from the month and year (`lib/utils/cycle-code.js` `meetingDateToCycleCode`: June → J, December → D, any other month → no cycle), so the placeholder must fall in June 2027. When the board meeting date on a Grant Cycle record changes, do linked requests' dates update, and by what mechanism? | Connor | The apps currently derive the cycle from each request's meeting date. | Foundations audit §2 |
| C3 | **Open; to the team meeting Wed 2026-10-28** on calendar ownership (Grants Manager or Program Coordinator to own and update it, consistent with D1). When and how is the next operations cycle row (D27) created, and does operations maintain only the board date or other milestones too? | Connor, Sarah | D27 has no operations row yet; the apps should read dates from one place. | Foundations audit §2 |
| C4 | What request status do J27 proposals carry when they arrive from GOApply (expected `Phase I Pending`)? | Connor | The Workbench list and triage depend on that exact label. | Register Q8, J27-064 |
| C5 | Applicants no longer choose S&E or MR. How is the program recorded on the request, who assigns it, and when? | Connor, Sarah, Duncan | Apps that filter or assign by program will find it empty at intake. | Timeline Dec 7 |
| R1 | Is the day-one list below right, and how quickly do staff need to triage in December? | Sarah, Duncan | Sets what must be built in the next six weeks versus early January. | December readiness below |
| X1 | For inline expertise matching (D6): who maintains the roster of staff, consultants and Board members and their expertise; should the suggested PD be written to the request or only shown for staff to accept; and can the CSO's current Claude project prompt be shared as the starting point? | CSO, Sarah, Duncan | Defines what the rebuilt matcher reads, produces and who trusts it. | D6 |
| R2 | Who starts and watches the Dec 8 AI pass, and what happens to proposals that arrive after it runs? Which steps are triggered by Power Automate (e.g. when a proposal file lands) and which by the apps' scheduled background jobs? | Justin, Connor | Volume is not a concern (D5), but the run needs an owner and an agreed trigger for each step. | Timeline Dec 8 |
| F1 | What are "triage flags"? Candidates: eligibility (e.g. more than three proposals from one institution), fit with Keck guidelines, or "likely decline" feeding the Jan 6 decline notes. Who may see them? Note: the current Initial Assessment deliberately makes no recommendations, so flags are a new kind of output. | Sarah, Duncan, CSO | Defines the flag step of the Dec 8 pass and the January decline notes. | Timeline Dec 8, Jan 6 |
| F2 | On Dec 9, should the suggested PD, expertise matches and flags appear as sortable columns in the triage list (so each PD can filter to their own), or only on each request's page? | Sarah, Duncan | Decides the shape of the R-1/R-2 list. | R-1, R-2 |
| F3 | If the suggested PD is not written to the request (X1), where do proposals without a confirmed PD appear so nothing is lost? | Sarah, Duncan | The "nothing gets lost" rule for triage. | X1, register J27-062 |
| X2 | **Raised 2026-10-26; not expected to be answered right away.** Triage record vs Phase I Status. Background (Justin): `wmkf_triagestatus` was a D26 patch for the last two-submission cycle (Phase I proposal, then Phase II if invited); staff use it in discussions, it has no AkoyaGO counterpart, and it also kept Workbench lists uncluttered. Open issues: (1) Phase I Status already carries staff recommendations (`Recommended Invite` / `Recommended Do Not Invite`), so J27 could have two records of one decision with nothing keeping them in step; (2) the values do not map one to one (no Phase I value for Save for now; no triage value for Scored / Not Scored); (3) Phase I Status is set in Dynamics by an unconfirmed owner, and an app write would be a new write path; (4) Phase I Status has consumers: the grantee-title cron keys on `Invited` (`lib/services/cron/generate-grantee-titles-service.js:34,72`), plus Expertise Finder, the Dataverse export and Dynamics Explorer; flows and reports outside the repo are unknown; (5) who sets Phase I `Invited` in J27 (Program Committee at Jan 13–14, Board, or staff) is register Q9. | Justin, Sarah, Duncan | Decides whether J27 triage is a working/display aid only, or writes the staff recommendation to Phase I Status. | Probe 2026-10-26; Atlas status semantics |

### B1 detail: questions for Connor

Every automatic Dec 8 step starts by reading the proposal from the request's
SharePoint folder. The forward contract is already decided
(`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, owner decision 2026-08-17): Power
Automate keeps two separate files, `AI Materials/ProposalNarrative_{n}.pdf`
and `AI Materials/ProposalBibliography_{n}.pdf`. Initial Assessment, Pre-Site
and Field Primer read only the narrative; the planned J27 Reviewer Finder reads
both, so cited authors become reviewer leads (register J27-065). The Dec 8
pass, including expertise matching, will read the narrative. What remains is
confirming J27 production of these files. For reference, D26 tools use at
least these conventions (found in the code 2026-10-24; not an exhaustive
search):

| Tool | Reads |
|---|---|
| Workbench Proposal tab | `Phase I/` subfolder: `ProjectDescription.pdf`, `Biosketches.pdf`, `ProjectBudget.pdf`, budget spreadsheet |
| Reviewer Finder and other proposal analysis | `Reviewer Materials/Proposal_{request#}.pdf` |
| Initial Assessment | `AI Materials/ProposalNarrative_{request#}.pdf` |
| Expertise app (batch) | a `Phase_I_Staff_Version` PDF |

For a cycle it does not recognize, the Proposal tab silently falls back to the
D26 names, so differently named J27 files would show as empty slots without an
error.

1. Will the same flows produce both `ProposalNarrative_{n}.pdf` and
   `ProposalBibliography_{n}.pdf` for J27 proposals, from the single
   submission?
2. Does the J27 submission have a separate references section or upload that
   the bibliography file can be cut from? (Register Q23.)
3. How long after submission do those files appear, and what signals that
   they are ready (a status, a field, a flow finishing)? This decides whether
   Power Automate or a scheduled job starts the AI pass (R2).
4. Can they change after submission (resubmission, staff replacement)?
5. What else lands in the request folder (biosketches, budget)? The Workbench
   Proposal tab shows those to staff and needs a J27 entry.
6. Will there still be a separate reviewer copy
   (`Reviewer Materials/Proposal_{n}.pdf`), and is anything in the full
   proposal off limits to reviewers or the AI (register Q21)?

Questions 1–3 unblock building; question 3 decides how the run is triggered.

**Connor's answer (email to Justin, 2026-10-26), partial:**

- GOApply puts the applicant's documents in a `Submission-Documents`
  subfolder of the request folder.
- The J27 flows put these files in `AI Materials`, named `{Type}_{Request#}`:
  `Graphical-Abstract_`, `Project-Narrative_`, `Bibliography_`,
  `Biosketches_`, `Other-Support_`, `Collaboration-Letters_`, and a second
  group `PhaseI-Cover-Page_`, `Abstract_`, `Graphical-Abstract-Page_`.
- He asked us to say which files the AI analysis needs and what the combined
  copies for distribution (the staff version) should contain.

**Owner decision 2026-10-26:** change the apps rather than ask Connor to rename. They
accept `Project-Narrative_{n}.pdf` and `Bibliography_{n}.pdf` as alternatives
to the D26 names, and fail closed if both are present. Built on branch
`claude/j27-ai-materials-names`; not yet released. Connor confirmed
(2026-10-26, follow-up) that all files are PDFs except the graphical abstract,
which is an image.

**Question 3 answered (Justin, 2026-10-26):** the flow sets
`wmkf_phistaffversioncompleteflag` on the request when the files are ready.
The field exists on `akoya_request` (Atlas `dataverse-akoya-request.md`), but
no app code reads it yet; its type and exact semantics (set after the
`AI Materials` copies, cleared on resubmission?) are unconfirmed. This makes a
per-proposal trigger possible for the Dec 8 pass (R2).

**Question 4 answered (Justin, 2026-10-26):** file names never change after
submission. Content changes are rare and surgical; there is no procedure for
clearing and resetting `wmkf_phistaffversioncompleteflag`, so the flag cannot
signal a replacement. Proposed (not yet decided): generate once when the flag
is set, and handle a replaced file with a staff-initiated regenerate rather
than an automatic rerun.

**Question 6 (2026-10-26):** Justin will ask Connor to generate
`Reviewer Materials/Proposal_{n}.pdf` for J27 and expects he will. Contents,
order, whether it differs from the staff version, and anything off limits to
reviewers or the AI (register Q21) remain open.

This answers questions 1 and 2: both files are produced, and the bibliography
is its own upload. Still open: 5 in part (the Workbench Proposal tab has no J27 entry yet), 6
(the reviewer copy and anything off limits). Also open: the contents and
order of the combined staff/distribution copy, and what the second group of
files is for.

## J27 proposal state model (proposed by Justin 2026-10-26; pending Connor and Sarah)

About 300 proposals arrive Dec 7; staff pare them to the 20–25 the Program
Chairs approve for peer review on Feb 24 (timeline workbook). Each proposal
gets a lead PD after the Dec 8 AI pass.

**Staff states, owned by the apps** (replace the D26 triage patch, see X2):

| State | Meaning |
|---|---|
| Submitted | Every proposal on arrival. |
| Triaged | Out: not looked at again unless something extraordinary happens. Logged, and removed from the default view. |
| Under consideration | Still in contention during the Jan 13–Feb 3 PD sessions (replaces "Save for now"). |
| Recommend to Program Chairs | Last staff state, decided by Feb 3. |

The ~50 left after Jan 13–14 PD triage go to the Program Chairs and
interested Board members (First Cut spreadsheet, Jan 14). The lead PD writes a
1-page writeup for each recommended proposal by Feb 10. The writeups are exported to a
SharePoint folder for leadership to assemble the Diligent Book (Feb 12),
reusing the existing President-approval model. **This writeup and export
infrastructure is the critical build** (Justin).

**After the Chairs meeting, AkoyaGO is the source of truth.** Staff do not
move proposals past Recommend to Program Chairs. The Grants Manager records
the Chairs' decision in AkoyaGO as the Phase I → Phase II transition, keeping
the Phase II values so historical Power Automate flows run, and the apps read it.
Proposed mapping (directionally agreed; who sets what is to be confirmed with
Connor and Sarah):

| Chairs outcome | `wmkf_phaseistatus` | `akoya_requeststatus` | Apps show |
|---|---|---|---|
| Approved for peer review | `Invited` (100000003) | `Phase II Pending` | Selected for external review |
| Not approved | `Not Invited` (100000002) | `Phase I Declined`? | Not selected |

If confirmed, existing readers keep working: Reviewer Finder keys on
`Phase II Pending` with empty Phase II status
(`lib/services/reviewer-finder/my-proposals-service.js:124`) and the
grantee-title cron on Phase I `Invited`
(`lib/services/cron/generate-grantee-titles-service.js:34,72`), which would
also answer register Q9. Open: whether any value is set before the Chairs
meeting (e.g. `Recommended Invite`, which would recreate X2's double record),
and whether Triaged proposals ever get `Phase I Declined` (decline notes, J-1).

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
