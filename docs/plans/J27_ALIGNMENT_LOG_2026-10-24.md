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
| Mar 17 | Reviews due | Calendar-driven review filing (D11) live before Feb 24 invitations |
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
| D1 | 2026-10-24 | **Calendar authority is the Grants Manager role** (currently Sarah), with the **Program Coordinator role** (currently Duncan) as fallback. Authority attaches to the role, not the person: reassigning the role in Admin staffing moves the responsibility with no code or settings change. Authority means maintaining and confirming cycle dates used by the apps; the dates themselves stay in the operations Grant Cycle record. **Narrowed 2026-10-27 by D10:** only the Board date stays there; app anchor dates live in the apps cycle record. | Justin | Rollover plan §3.1, §7 |
| D2 | 2026-10-24 | **Reviewer reminders stay manual for J27.** PDs send reminders themselves, as in D26; the automatic reminder schedule stays off. | Justin | Register Q10 |
| D3 | 2026-10-24 | **Review filing switches from D26 to J27 once; it never has to handle both.** All D26 reviews are in, so no late D26 reviews will overlap with J27 reviews. Who makes the switch and when is task T3. **Relaxed 2026-10-27 by D11:** filing follows each cycle's calendar window, so overlap is harmless and no switch is needed. | Justin | Register Q15 |
| D4 | 2026-10-24 | **Reviewer campaign settings are handled centrally, not per PD.** The review deadline, respond-by days and reviewer quota become cycle-wide values maintained centrally (under D1), replacing the per-request campaign settings PDs set today. Changing one reviewer's deadline stays a PD action. Email wording is not affected: PDs keep personal wording built on centrally seeded defaults (slice 2). **Refined 2026-10-27 by D9.** | Justin | Rollover plan Slice 1 |
| D5 | 2026-10-24 | **Volume of the Dec 8 AI pass is not a concern.** A less sophisticated model will likely be used, and applications arrive over several days (heaviest near the deadline); at about 2 minutes each, 300 can be processed overnight. | Justin | Timeline Dec 8 |
| D7 | 2026-10-27 | **Either calendar role can edit at any time** (answers A1). The Grants Manager and Program Coordinator roles both hold edit rights all the time; the fallback is not limited to an unassigned Grants Manager role. The calendar shows who last edited each value and when. | Justin | D1; A1 |
| D8 | 2026-10-27 | **One person can change any calendar date; no second approver** (answers A3). Responsibility defaults to the Grants Manager role (Sarah); the Program Coordinator edits when necessary, using the access D7 grants. | Justin | D1; D7; A3 |
| D9 | 2026-10-27 | **Refines D4: anchor dates are central; PDs adjust response periods and quota** (answers A4). Cycle anchor dates, including the review deadline, are set centrally by the calendar owner (D7, D8); there is no per-proposal deadline override. The response period and reviewer quota have central defaults: a PD may change the response period for a proposal and for an individual invitation, and the quota for a proposal. A PD may extend one reviewer's due date when that reviewer asks (existing per-reviewer extension, `lib/services/reviewer-due-extension.js`). Today's per-request Campaign settings (`CampaignConfigModal`) are the clunky precedent; the PD controls built for D9 must be much simpler, and their design goes through Impeccable before it is built. | Justin | D4; A4 |
| D10 | 2026-10-27 | **Cycle dates are split by owner, one editable copy each** (answers C3; narrows D1). The Board date stays in the operations Grant Cycle record (`wmkf_grantcycle`), owned by Connor's process; the apps read it and never copy it. The apps' anchor dates (review deadline, invitation start and similar) live in the existing apps cycle record (`wmkf_appgrantcycle`), edited in the app under D7/D8; no operations schema change. Creating future operations rows (D27) stays with Connor's process and is not needed for J27. Not built: no runtime code reads `wmkf_grantcycle` today, and Board writeups keeps its own `boardEnds` copy (`docs/audits/cycle-settings-audit-2026-10-27.md` rows A4, B2). | Justin | D1; C3; foundations audit §2 |
| D11 | 2026-10-27 | **Review filing follows each cycle's calendar window, not a Vercel setting** (replaces T3; relaxes D3). A completed review files automatically when its own cycle's window is open: from that cycle's invitation start date (apps cycle record, D10) to its Board date (operations record, D10). Overlapping cycles each file to their own cycle; Sarah and Duncan change the dates in the app and no redeploy is needed. Today a single Production setting, `REVIEW_DOCX_SHAREPOINT_CYCLE`, limits the sweep to one cycle (`lib/services/review-documents/individual-file-service.js:1006`; `lib/dataverse/adapters/reviewer-suggestion.js:1536-1551`), so this is a build, folded into the November central-settings work and due before the first J27 invitation (Feb 24). A review arriving after the Board date is not filed automatically; operator backfill remains. | Justin | D3; T3 |
| D12 | 2026-10-27 | **Readiness notices route by who can fix the problem** (answers A2; no further confirmation needed). App calendar problems (missing anchor date, missing apps cycle row, Board writeups date disagreeing) go to the Grants Manager and Program Coordinator roles. Operations-data problems (missing operations cycle row, a Board date change not reaching request meeting dates) go to the Systems Specialist role, copying the Grants Manager. Delivery: one daily email digest per role plus an in-app readiness panel. The readiness check itself is planned, not built (rollover plan §3.5). | Justin | A2 |
| D13 | 2026-10-27 | **December readiness is delivered by Nov 15, 2026** (answers R1). In scope: J27 proposals visible in the Workbench list (R-1); per-proposal AI summary / Initial Assessment, suggested PD and expertise matches from the AI pass (R-3); the four staff states (state model), settable in bulk from the list; a "my proposals / all proposals" PD filter; triage flags and decline-note drafts if F1 calls for flags (J-1); sorting/columns (F2), MR/S&E counts and the First Cut spreadsheet (J-2). R-4 is dropped: under the state model staff stop at Recommend to Program Chairs and the Grants Manager records the Chairs' outcome in AkoyaGO. Decisions that shape this build are due in early November. | Justin | R1; December readiness |
| D14 | 2026-10-27 | **Intake AI prompts are shared, whoever runs them.** Every prompt used by the J27 intake AI work, whether run by Connor's Power Automate flows or by the apps, lives once in the shared prompt store (`wmkf_ai_prompt`, the Executor contract in `docs/EXECUTOR_CONTRACT.md`, which already reserves a Power Automate caller) and is editable from the app's Admin prompt editor. The Admin editor shows who last changed each prompt and when, including changes made directly in Dataverse or from Power Automate. Justin prefers Connor to edit through the Admin panel but accepts edits outside the app as long as the prompts stay shared. Today the editor shows "last touched … by …" from Dataverse `modifiedon`/`modifiedby` (`shared/components/admin/PromptTemplatesSection.js:145-146`); it does not yet label where a change came from. | Justin | R2; Executor contract |
| D6 | 2026-10-24 | **Expertise matching is rebuilt to run inline.** Each proposal is matched automatically as part of the intake AI pass, instead of a person running the Expertise app on demand. The current app is an early version based on the CSO's draft Claude project and needs improvement. | Justin | R-3 |

## To confirm at the meeting

| # | Question | Who | Why it matters | Source |
|---|---|---|---|---|
| A1 | **Answered 2026-10-27 (Justin): either role can edit at any time; show who last edited and when (D7).** What does "fallback" mean in practice: Duncan may also edit at any time, or only when the Grants Manager role is unassigned? | Sarah, Duncan, Justin | Decides whether the app grants both roles edit rights or switches to Duncan only when Sarah's role is empty. | D1 |
| A2 | **Answered 2026-10-27 (Justin), D12:** route by who can fix it; daily digest per role plus in-app panel. Who is notified when a cycle is missing a date or has conflicting records? Proposed: Grants Manager and Systems Specialist. | Sarah, Connor | Readiness notices need named roles; there is no fallback to individuals. | Rollover plan §3.5, §7 |
| A3 | **Answered 2026-10-27 (Justin): one person can change any date; Grants Manager by default, Program Coordinator when necessary (D8).** May the calendar owner publish any date change directly, or do some changes (board date, review deadline) need a second person? | Sarah, Justin | Decides whether a confirmation step is built. | Rollover plan §7 |
| A4 | **Answered 2026-10-27 (Justin), D9:** no per-proposal deadline override; PDs may change the response period (per proposal and per invitation) and the quota (per proposal), and extend one reviewer's due date on request. Under D4, is there ever a reason one proposal needs a different reviewer quota or review deadline than the rest of the cycle? If so, who may set that exception? | Sarah, Duncan | Decides whether any per-request override survives, and whether it belongs to the PD or the calendar owner. | D4 |
| A5 | What are the J27 central values: review deadline, days a reviewer has to respond, and reviewer quota? (Under D9 the last two are defaults PDs may change.) | Sarah | These replace the values PDs entered per request. | D4 |
| B1 | **Partly answered 2026-10-26; see B1 detail.** **Priority — confirm first.** The AI input files are already decided (owner, 2026-08-17): `AI Materials/ProposalNarrative_{n}.pdf` and `AI Materials/ProposalBibliography_{n}.pdf`, produced by Power Automate. Confirm the flows produce both for J27's single submission, when, and what else lands in the request folder. The Dec 8 pass, including expertise matching, reads the narrative file. | Connor | Initial Assessment, expertise matching, reviewer materials and proposal lookup all depend on it. | Register Q5 |
| C1 | **Answered 2026-10-26 (Justin): yes, 001024 is the Research form; no app concern** (no app code keys on the opportunity; grep 2026-10-26). Is GOApply opportunity 001024 the J27 Research form? What are its real open window and submission cutoff, and when does it get its J27 cycle link? | Connor | Confirms which records intake comes from. | Foundations audit §3 |
| C2 | **Partly answered 2026-10-26 (Justin):** a placeholder meeting date is believed to be set on submission (open: confirm its value); date moves are handled by a Power Automate flow. The apps derive the cycle only from the month and year (`lib/utils/cycle-code.js` `meetingDateToCycleCode`: June → J, December → D, any other month → no cycle), so the placeholder must fall in June 2027. When the board meeting date on a Grant Cycle record changes, do linked requests' dates update, and by what mechanism? | Connor | The apps currently derive the cycle from each request's meeting date. | Foundations audit §2 |
| C3 | **Answered 2026-10-27 (Justin), D10:** Board date in operations, app anchor dates in the apps cycle record; D27 row creation stays with Connor (ask when; not needed for J27). Originally: **to the team meeting Wed 2026-10-28** on calendar ownership (Grants Manager or Program Coordinator to own and update it, consistent with D1). When and how is the next operations cycle row (D27) created, and does operations maintain only the board date or other milestones too? | Connor, Sarah | D27 has no operations row yet; the apps should read dates from one place. | Foundations audit §2 |
| C4 | What request status do J27 proposals carry when they arrive from GOApply (expected `Phase I Pending`)? | Connor | The Workbench list and triage depend on that exact label. | Register Q8, J27-064 |
| C5 | **Owner assigned 2026-10-26:** when and how the program is set is the CSO's decision, in consultation with Connor and Sarah (see "MR vs S&E" below). Applicants no longer choose S&E or MR. How is the program recorded on the request, who assigns it, and when? | Connor, Sarah, Duncan | Apps that filter or assign by program will find it empty at intake. | Timeline Dec 7 |
| R1 | **Answered 2026-10-27 (Justin), D13:** full December scope delivered by Nov 15; R-4 dropped. Is the day-one list below right, and how quickly do staff need to triage in December? | Sarah, Duncan | Sets what must be built in the next six weeks versus early January. | December readiness below |
| X1 | For inline expertise matching (D6): who maintains the roster of staff, consultants and Board members and their expertise; should the suggested PD be written to the request or only shown for staff to accept; and can the CSO's current Claude project prompt be shared as the starting point? | CSO, Sarah, Duncan | Defines what the rebuilt matcher reads, produces and who trusts it. | D6 |
| R2 | **Update 2026-10-27 (Justin's understanding; to confirm with Connor):** Connor intends to run AI analyses in Power Automate for compliance, keyword extraction and a tentative lead PD, and possibly Board and consultant expertise. Who runs which step (Connor's flows or an app job) is open; prompts are shared either way (D14). This overlaps R-3, D6, X1 and F1. Who starts and watches the Dec 8 AI pass, and what happens to proposals that arrive after it runs? Which steps are triggered by Power Automate (e.g. when a proposal file lands) and which by the apps' scheduled background jobs? | Justin, Connor | Volume is not a concern (D5), but the run needs an owner and an agreed trigger for each step. | Timeline Dec 8 |
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

**Reviewers and reviewer materials (Justin 2026-10-26):**

- PDs may search for and shortlist reviewers once a proposal reaches
  Recommend to Program Chairs (the Chairs usually follow staff), but no
  invitation goes out before the Feb 24 Chairs meeting. PDs wait until the
  Grants Manager's AkoyaGO change shows the Chairs' approval. Gap: invitation
  sending has no request-status check today (grep 2026-10-26 of
  `lib/services/reviewer-engagement/` and `lib/services/reviewer-finder/`
  found status reads only in the contact-history display and honorarium
  closeout), so J27 needs a server-side send guard keyed on the AkoyaGO
  approval, mirrored in the UI.
- Reviewer materials need not be built for all 300 (Connor). Justin will ask
  Connor to generate `Reviewer Materials/Proposal_{n}.pdf` earlier, around the
  ~50 First Cut stage. The trigger signal is to be agreed. If it is an app staff
  state, that state must live on the request in Dataverse, where a flow can
  see it.
- Sharing with Program Chairs and Board members: Justin recalls magic links
  were used before. No Board/Chairs sharing surface was found in the app
  (grep 2026-10-26); possibly SharePoint link sharing. To confirm with Connor.

**Offramp and oral presentations (Justin 2026-10-26):**

- The Grants Manager records the Mar 25 PD offramp outcome in AkoyaGO; the
  apps read it rather than holding an offramp state.
- "Invited to oral presentation" may be derived from AkoyaGO Phase II Status
  (to confirm with Connor and Sarah). Note: `wmkf_phaseiistatus` has no
  `Invited` option (probe 2026-10-26). Justin's tentative view: `Phase II
  Pending Committee Review` (100000002) is likely the right state; to be
  clarified. Other candidates: reusing `Recommended` / `Not Recommended`, or
  adding an option.
- Duncan schedules the oral presentations from that output, so it must
  connect to the parked Duncan scheduling walkthrough.
- Needed artifact: a flowchart and calendar that name, for each step, who sets
  which AkoyaGO field and value, possibly appended to the J27/D27 timeline
  workbook. Drafted 2026-10-27: see "Decision calendar" and "Who sets which
  AkoyaGO field" below.

**Apr–Jun (Justin 2026-10-26):** questions to PIs happen outside the apps.
Oral presentations and staff evaluations are this cycle's site visits and
staff deliberations, and ranking is unchanged from D26. Dependency: ranking
and briefing select by `akoya_requeststatus = 'Phase II Pending'`
(`lib/dataverse/adapters/proposal-ranking-source.js`,
`lib/services/meeting-tracker/program-briefing-service.js`), and ranking also
by the two Research program IDs (`proposal-ranking-source.js:95`). They carry
over only if the post-Chairs mapping keeps `Phase II Pending` and J27
proposals carry an MR/S&E program (C5).

### MR vs S&E (raised 2026-10-26; decision owner: CSO with Connor and Sarah)

Every J27 proposal must end up in Medical Research or Science and
Engineering Research (committee structure), but applicants no longer choose.
Justin expects an initial guess during the intake AI read and suspects the
split should be tracked for portfolio balance. PD assignment is
program-agnostic this cycle (PDs handled both programs).

- **Where it lives:** `akoya_programid` (the 23 D26 proposals carry MR or
  S&E there; probe 2026-10-26). The Workbench Grant Program selector uses the
  coarser `wmkf_grantprogram`
  (`lib/services/workbench/program-scope-service.js`).
- **What depends on it** (filter on the two IDs in
  `shared/config/researchPrograms.js`; grep 2026-10-26): ranking
  (`lib/dataverse/adapters/proposal-ranking-source.js`,
  `lib/services/proposal-ranking/research-funding.js`), Meeting Tracker
  program briefing (`lib/services/meeting-tracker/program-briefing-service.js`),
  site-visit applicant contacts and request liaison
  (`lib/services/site-visit/applicant-contacts.js`,
  `lib/services/contacts/request-liaison.js`), grantee deliverables awardees
  and cycle export, and the grantee-title cron. A proposal with no program, or
  a third program, drops out of all of them. None is needed before the
  semi-finalist stage, so the latest safe point is the Feb 24 Chairs meeting.
- **Questions for the decision owner:** (1) who sets it and when (intake AI
  guess, PD triage, or Recommend to Program Chairs); (2) whether the AI guess
  is stored as a separate suggestion and confirmed by a person into
  `akoya_programid`, rather than written there directly (same pattern as the
  suggested PD, X1/F3); (3) whether staff want running MR/S&E counts per stage
  for portfolio balance.

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
| R-4 | PDs can advance a proposal to `Phase II Pending` from the Workbench. | **Dropped 2026-10-27 (D13):** the state model stops staff at Recommend to Program Chairs; the Grants Manager records the Chairs' outcome in AkoyaGO. | — |

**Superseded 2026-10-27 by D13 (full scope by Nov 15).** **Proposed minimum for December:** proposals visible in a list, the
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
using bibliographies if it is in scope, and calendar-driven review filing
(D11, replacing task T3).

**Scheduled for November 2026 (Justin, 2026-10-24):** central reviewer
settings per D4 (rollover plan Slice 1), unblocked: the reviewer deadline email
work (slice 2) shipped as PR #521 on 2026-10-24.
A5 (the J27 central values) is needed from Sarah before it can ship.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| T1 | Record D1 in the rollover plan and work queue. | Claude | Done 2026-10-24 |
| T2 | Record D2 in the J27 register (Q10) and reviewer engagement spec. | Claude | Done 2026-10-24 |
| T3 | Switch automatic review-document filing from D26 to J27 (one Production setting, `REVIEW_DOCX_SHAREPOINT_CYCLE`, plus redeploy) after confirming D26 filing is complete and before the first J27 review comes back in 2027. | — | Replaced 2026-10-27 by D11 (calendar-driven filing window; no manual switch) |
| T4 | Record the December readiness list in this log. | Claude | Done 2026-10-24 |
| T5 | Correct weekday-label errors in the J27/D27 timeline workbook (mostly the D27 page, including the D27 Board meeting days). Not blocking for J27: the J27 dates are correct apart from two labels. | Timeline owner | Emailed with a suggested fix prompt 2026-10-24; awaiting reply |

## Decision calendar (drafted 2026-10-27; dates proposed)

Every open decision in this log as of 2026-10-27, ordered by when it must be
decided. Owners are the people this log or Justin has already named; "Not
assigned" means nobody has been named yet. Code checks still owed are not
decisions and are not listed: J-1 and
J-2, the existing writeup tools, and Meeting Tracker / Staff Deliberations for
oral presentations.

**How decide-by dates are set.** A decision is due when the app behavior it
shapes must be live, minus the time to build that behavior. Where nothing is
built, the date is the timeline step itself. Build lead times are not
estimated here, so build-dependent rows say "before the … build starts"
rather than giving a day. Every date is a proposal for Justin to adjust.

| Decide by | Item | Decision needed | Who decides | Blocked until decided |
|---|---|---|---|---|
| Wed Oct 28 meeting | A5 | J27 central values: review deadline, plus default days to respond and default reviewer quota (D9) | Sarah | Central reviewer settings cannot ship (D4, November) |
| Before the Nov 15 delivery (decide in early November) | R2 | Which intake AI steps Connor's flows run (he intends compliance, keywords, tentative lead PD, possibly Board/consultant expertise) and which an app job runs; trigger and who watches failures. Prompts are shared either way (D14) | Justin, Connor | R-3 build scope for Nov 15; D6/X1/F1 |
| Wed Oct 28 meeting (Connor) | B1 Q3 | Type and exact meaning of `wmkf_phistaffversioncompleteflag` (set after the `AI Materials` copies?) | Connor | Using the flag as the AI-pass trigger |
| Before the Nov 15 delivery (decide in early November) | B1 Q4 | Confirm "generate once; staff regenerate by hand" for replaced files | Justin | AI-pass rerun behavior |
| Before the Nov 15 delivery (decide in early November) | X1 | Who maintains the expertise roster; is the suggested PD written to the request or only shown; can the CSO's Claude project prompt be shared? | CSO, Sarah, Duncan | Inline expertise matcher (D6) |
| Before the Nov 15 delivery (decide in early November) | F1 | What triage flags are and who may see them | Sarah, Duncan, CSO | Flag step of the AI pass; Jan 6 decline notes |
| Before the Nov 15 delivery (decide in early November) | C5 (part) | Whether the AI guesses MR or S&E at intake, and whether the guess is stored as a suggestion that a person confirms | CSO with Connor and Sarah | Shape of the AI-pass output |
| Before the Nov 15 delivery (decide in early November) | Default cycle | Planning item (2026-10-27): one calendar-driven rule for which cycle each app opens on, replacing env cycle pins, `'D26'` literals and today-based month flips; task rules only where an app needs one (e.g. Board writeups, Awardees). Includes the three Board-date stores (operations record, request meeting dates, Board writeups `boardEnds`). Evidence: `docs/audits/cycle-settings-audit-2026-10-27.md` | Justin | Every app's landing cycle Dec 7 – Feb 24; R-1 list |
| Before the Nov 15 delivery (decide in early November) | C4 | Request status J27 proposals carry on arrival (expected `Phase I Pending`) | Connor | R-1: the Workbench list filter |
| Before the Nov 15 delivery (decide in early November) | C2 | The placeholder `wmkf_meetingdate` value (must fall in June 2027); whether requests follow a moved Grant Cycle date, and how | Connor | The apps' cycle code for every J27 request |
| Before the Nov 15 delivery (decide in early November) | State model | Staff states (Submitted, Triaged, Under consideration, Recommend to Program Chairs) and whether they live on the request in Dataverse | Justin with Connor and Sarah | List states; the reviewer-materials trigger (a flow can only see Dataverse) |
| Before the Nov 15 delivery (decide in early November) | X2 | Is J27 triage a display aid only, or does it write the staff recommendation to Phase I Status? | Justin, Sarah, Duncan | Whether the apps get a new Phase I Status write path |
| Before the Nov 15 delivery (decide in early November) | F2 | Suggested PD, matches and flags as sortable list columns, or on each request's page only? | Sarah, Duncan | R-1/R-2 list shape |
| Before the Nov 15 delivery (decide in early November) | F3 | Where proposals without a confirmed PD appear | Sarah, Duncan | The "nothing gets lost" rule |
| Before the Nov 15 delivery (decide in early November) | B1 Q5 | Which `AI Materials` files the Workbench Proposal tab shows for J27 | Not assigned | The Proposal tab's J27 entry |
| Before the Nov 15 delivery (decide in early November) | B1 staff copy | Contents and order of the combined staff/distribution copy; what the second file group (`PhaseI-Cover-Page_`, `Abstract_`, `Graphical-Abstract-Page_`) is for | Not assigned (Connor asked us) | Connor's staff-version flow |
| Before the writeup build starts | Writeup export | Scope of the 1-page writeup and Diligent Book export (writeups due Feb 10, Book Feb 12) | Justin | The build Justin called critical |
| Wed Jan 6 | Declines | Do Triaged proposals get `Phase I Declined`, when, and who sets it? | Connor, Sarah | J-1 decline notes |
| Thu Jan 14 | B1 Q6 | Reviewer copy contents and order; anything off limits to reviewers or the AI (register Q21) | Connor | Reviewer materials |
| Thu Jan 14 | Materials trigger | What tells Connor's flow to build `Reviewer Materials/Proposal_{n}.pdf` at the ~50 stage | Connor, Justin | Reviewer materials for the First Cut |
| Thu Jan 14 | Sharing | How Program Chairs and Board members get proposals (magic links or SharePoint sharing) | Connor | First Cut and Diligent sharing |
| Wed Feb 3 | Pre-Chairs value | Is any Phase I value (e.g. `Recommended Invite`) set before the Chairs meeting? This would recreate X2's double record | Connor, Sarah | Phase I Status consumers |
| Before the reviewer-invitation build starts | Bibliographies | Is Reviewer Finder reading bibliographies for reviewer leads (register J27-065) in scope for Feb 24? | Justin | That Reviewer Finder change |
| Wed Feb 24 | Post-Chairs mapping | Confirm the Chairs-outcome values and who sets them (proposed: Grants Manager) | Connor, Sarah | Invitation send guard; Reviewer Finder opening; ranking and briefing carryover; grantee-title cron (register Q9) |
| Wed Feb 24 | C5 | Who sets `akoya_programid` (MR or S&E) on each recommended proposal, and when; whether staff want running MR/S&E counts per stage | CSO with Connor and Sarah | Ranking, Meeting Tracker briefing, applicant contacts, grantee deliverables, grantee-title cron |
| Thu Mar 25 | Offramp | Which AkoyaGO field and value record the PD offramp outcome | Connor, Sarah | Apps reading the offramp |
| Before oral presentations Apr 19 | Oral invites | AkoyaGO value for "invited to oral presentation" (tentative: Phase II `Pending Committee Review`) | Connor, Sarah | Duncan's scheduling |
| Before oral presentations Apr 19 | Scheduling | How Duncan schedules oral presentations from that output | Duncan | Scheduling walkthrough (parked) |
| Before D27 setup (D27 proposals arrive Jun 7–9, 2027) | C3 remainder | When and how Connor's process creates the D27 operations cycle row | Connor | D27 Board date for the apps (not a J27 blocker) |
| No deadline | T5 | Weekday-label fixes in the timeline workbook | Timeline owner | Nothing (J27 dates are correct) |

## Who sets which AkoyaGO field (drafted 2026-10-27)

Status: **Decided** means an owner answer is recorded in this log or the
Atlas. **Proposed** means it is directionally agreed but not confirmed.
**Open** means no answer yet. D26 practice is not treated as a J27 decision.
Owner semantics (Atlas, 2026-10-26): the phase picklists hold staff
recommendations; `akoya_requeststatus` changes only at the Board's final
decision. To confirm: the Feb 24 rows below set `Phase II Pending` before the
Board, as D26 practice does (all 23 D26 Advancing proposals are `Phase II
Pending`, probe 2026-10-26), so "only at the Board" may mean only the final
values (`Approved`, `Phase II Declined`).

| Step | Who | Field or place | Value | Status |
|---|---|---|---|---|
| Dec 7 submission | GOApply | `Submission-Documents` folder | Applicant's documents | Decided (Connor) |
| Dec 7 submission | Power Automate | `AI Materials` folder | J27 file set; apps read `Project-Narrative_{n}.pdf`, `Bibliography_{n}.pdf` | Decided (Connor); app change on this branch, unreleased |
| Files ready | Power Automate | `wmkf_phistaffversioncompleteflag` | Set when the files are ready | Decided that the flow sets it; type and meaning open (B1 Q3) |
| Dec 7 submission | GOApply or flow | `akoya_requeststatus` | Expected `Phase I Pending` | Open (C4) |
| Dec 7 submission | GOApply or flow | `wmkf_meetingdate` | Placeholder in June 2027 | Open (C2) |
| Intake to Feb 24 | Not decided | `akoya_programid` | Medical Research or Science and Engineering | Open (C5) |
| Dec 9 – Feb 3 | PDs, in the apps | Staff state (location not decided) | Submitted, Triaged, Under consideration, Recommend to Program Chairs | Proposed (state model) |
| Dec 9 – Feb 3 | Not decided | `wmkf_triagestatus` / `wmkf_phaseistatus` | Whether triage writes either | Open (X2; pre-Chairs value) |
| By Jan 6 | Not decided | `akoya_requeststatus` | `Phase I Declined` for Triaged? | Open |
| ~Jan 14 | Power Automate | `Reviewer Materials/Proposal_{n}.pdf` | Built for the ~50 | Proposed (Justin to ask Connor); trigger open |
| Feb 24, approved | Grants Manager | `wmkf_phaseistatus` + `akoya_requeststatus` | `Invited` (100000003) + `Phase II Pending` | Proposed |
| Feb 24, not approved | Grants Manager | `wmkf_phaseistatus` + `akoya_requeststatus` | `Not Invited` (100000002) + `Phase I Declined`? | Proposed; request status open |
| Mar 25 offramp | Grants Manager | Not decided | Not decided | Open |
| Oral-presentation invite | Not decided | `wmkf_phaseiistatus` | Tentative: `Phase II Pending Committee Review` (100000002); there is no `Invited` option | Open |
| May 12–13 ranking | Apps read | `akoya_requeststatus` + `akoya_programid` | `Phase II Pending` + an MR or S&E program | Carries over only if the Feb 24 mapping and C5 hold |
| Jun 9–10 Board | Not recorded here | `akoya_requeststatus` | Board decision | Decided semantics; who sets it not recorded |
