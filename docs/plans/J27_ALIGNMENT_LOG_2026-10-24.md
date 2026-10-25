# J27 alignment log — decisions and open items

Started 2026-10-24 (Session 639) for a meeting with Sarah (Grants Manager),
Duncan (Program Coordinator) and Connor (Systems Specialist). Justin owns the
log; entries are added as decisions are made. Each item points at its source
document so the detail is not repeated here.

**Timing.** J27 proposals arrive in early December 2026 through GOApply. The
D26 board also meets in December 2026, so D26 board preparation and J27 intake
overlap from then on. J27 reviewer invitations follow in 2027; the provisional
J27 board date is June 10, 2027.

Sources: `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`
(overlapping cycles), `docs/J27_TRANSITION_REGISTER.md` (single-phase changes,
owner questions Q1–Q25), `docs/audits/cycle-foundations-2026-10-21.md`
(production read-only check of roles and cycle records).

## Decisions

| # | Date | Decision | Decided by | Source |
|---|---|---|---|---|
| D1 | 2026-10-24 | **Calendar authority is the Grants Manager role** (currently Sarah), with the **Program Coordinator role** (currently Duncan) as fallback. Authority attaches to the role, not the person: reassigning the role in Admin staffing moves the responsibility with no code or settings change. Authority means maintaining and confirming cycle dates used by the apps; the dates themselves stay in the operations Grant Cycle record. | Justin | Rollover plan §3.1, §7 |
| D2 | 2026-10-24 | **Reviewer reminders stay manual for J27.** PDs send reminders themselves, as in D26; the automatic reminder schedule stays off. | Justin | Register Q10 |
| D3 | 2026-10-24 | **Review filing switches from D26 to J27 once; it never has to handle both.** All D26 reviews are in, so no late D26 reviews will overlap with J27 reviews. Who makes the switch and when is task T3. | Justin | Register Q15 |
| D4 | 2026-10-24 | **Reviewer campaign settings are handled centrally, not per PD.** The review deadline, respond-by days and reviewer quota become cycle-wide values maintained centrally (under D1), replacing the per-request campaign settings PDs set today. Changing one reviewer's deadline stays a PD action. | Justin | Rollover plan Slice 1 |

## To confirm at the meeting

| # | Question | Who | Why it matters | Source |
|---|---|---|---|---|
| A1 | What does "fallback" mean in practice: Duncan may also edit at any time, or only when the Grants Manager role is unassigned? | Sarah, Duncan, Justin | Decides whether the app grants both roles edit rights or switches to Duncan only when Sarah's role is empty. | D1 |
| A2 | Who is notified when a cycle is missing a date or has conflicting records? Proposed: Grants Manager and Systems Specialist. | Sarah, Connor | Readiness notices need named roles; there is no fallback to individuals. | Rollover plan §3.5, §7 |
| A3 | May the calendar owner publish any date change directly, or do some changes (board date, review deadline) need a second person? | Sarah, Justin | Decides whether a confirmation step is built. | Rollover plan §7 |
| A4 | Under D4, is there ever a reason one proposal needs a different reviewer quota or review deadline than the rest of the cycle? If so, who may set that exception? | Sarah, Duncan | Decides whether any per-request override survives, and whether it belongs to the PD or the calendar owner. | D4 |
| A5 | What are the J27 central values: review deadline, days a reviewer has to respond, and reviewer quota? | Sarah | These replace the values PDs entered per request. | D4 |
| B1 | Where in SharePoint is the J27 submitted proposal filed, and under what filename? | Connor | Initial Assessment, reviewer materials and proposal lookup all depend on it. Needed well before December. | Register Q5 |
| C1 | Is GOApply opportunity 001024 the J27 Research form? What are its real open window and submission cutoff, and when does it get its J27 cycle link? | Connor | Confirms which records intake comes from. | Foundations audit §3 |
| C2 | When the board meeting date on a Grant Cycle record changes, do linked requests' dates update, and by what mechanism? | Connor | The apps currently derive the cycle from each request's meeting date. | Foundations audit §2 |
| C3 | When and how is the next operations cycle row (D27) created, and does operations maintain only the board date or other milestones too? | Connor, Sarah | D27 has no operations row yet; the apps should read dates from one place. | Foundations audit §2 |
| C4 | What request status do J27 proposals carry when they arrive from GOApply (expected `Phase I Pending`)? | Connor | The Workbench list and triage depend on that exact label. | Register Q8, J27-064 |
| R1 | Is the day-one list below right, and how quickly do staff need to triage in December? | Sarah, Duncan | Sets what must be built in the next six weeks versus early January. | December readiness below |

## December readiness (proposed for the meeting to confirm)

Justin agreed with this assessment on 2026-10-24; colleagues may correct it at
the meeting. Code status was checked against the repository on 2026-10-24;
nothing here is built yet unless it says so.

**Needed when proposals arrive (early December):**

| # | Need | Status today | Depends on |
|---|---|---|---|
| R-1 | Staff can see incoming J27 proposals in the Workbench. | Not built. The request list shows only requests that are `Phase II Pending` or marked Advancing, so new untriaged proposals would not appear. | C4 |
| R-2 | Staff can triage about 300 proposals, including the "Save for now" state approved 2026-09-06. | Partly built. Only Advancing and Set aside exist; triage is reachable one row at a time. The per-PD view (each PD focused on their own requests, able to see others', nothing lost) is not designed. | R1 |
| R-3 | Every proposal gets an Initial Assessment. | Partly ready. The D26 tooling exists and its view is not hidden for J27. Not yet done: running it at about 300 proposals and the deferred Production write check. | B1 |
| R-4 | PDs can advance a proposal to `Phase II Pending` from the Workbench. | Not verified whether this exists. | C4 |

**Proposed minimum for December:** proposals visible in a list, the
"Save for now" state, and Initial Assessments generated in batches. The fuller
per-PD triage view could follow in early January while staff are reading.

**Can wait until 2027 (before reviewer season):** Reviewer Finder using
bibliographies, the automatic materials email on reviewer acceptance (must be
live before J27 invitations) and task T3.

**Scheduled for November 2026 (Justin, 2026-10-24):** central reviewer
settings per D4 (rollover plan Slice 1), started after the current reviewer
deadline email work merges so the two do not edit the same files at once.
A5 (the J27 central values) is needed from Sarah before it can ship.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| T1 | Record D1 in the rollover plan and work queue. | Claude | Done 2026-10-24 |
| T2 | Record D2 in the J27 register (Q10) and reviewer engagement spec. | Claude | Done 2026-10-24 |
| T3 | Switch automatic review-document filing from D26 to J27 (one Production setting, `REVIEW_DOCX_SHAREPOINT_CYCLE`, plus redeploy) after confirming D26 filing is complete and before the first J27 review comes back in 2027. | To assign at meeting | Open; date to agree (see D3) |
| T4 | Record the December readiness list in this log. | Claude | Done 2026-10-24 |
