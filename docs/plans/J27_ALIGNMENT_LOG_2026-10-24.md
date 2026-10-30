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
| Wed Mar 10 | Reviews due (**2026-10-29:** was Mar 17 in the provisional timeline; the cycle calendar's Reviews Due Date, entered by the Grants Manager, is authoritative) | Calendar-driven review filing (D11, D44) live before Feb 24 invitations |
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
| D1 | 2026-10-24 | **Calendar authority is the Grants Manager role** (currently Sarah), with the **Program Coordinator role** (currently Duncan) as fallback. Authority attaches to the role, not the person: reassigning the role in Admin staffing moves the responsibility with no code or settings change. Authority means maintaining and confirming cycle dates used by the apps; the dates themselves stay in the operations Grant Cycle record. **Narrowed 2026-10-27 by D10:** only the Board date stays there; app anchor dates live in the apps cycle record. **Restored 2026-10-28 by D43:** the operations record holds the milestone dates again, now edited from the apps. | Justin | Rollover plan §3.1, §7 |
| D2 | 2026-10-24 | **Reviewer reminders stay manual for J27.** PDs send reminders themselves, as in D26; the automatic reminder schedule stays off. | Justin | Register Q10 |
| D3 | 2026-10-24 | **Review filing switches from D26 to J27 once; it never has to handle both.** All D26 reviews are in, so no late D26 reviews will overlap with J27 reviews. Who makes the switch and when is task T3. **Relaxed 2026-10-27 by D11:** filing follows each cycle's calendar window, so overlap is harmless and no switch is needed. | Justin | Register Q15 |
| D4 | 2026-10-24 | **Reviewer campaign settings are handled centrally, not per PD.** The review deadline, respond-by days and reviewer quota become cycle-wide values maintained centrally (under D1), replacing the per-request campaign settings PDs set today. Changing one reviewer's deadline stays a PD action. Email wording is not affected: PDs keep personal wording built on centrally seeded defaults (slice 2). **Refined 2026-10-27 by D9.** | Justin | Rollover plan Slice 1 |
| D5 | 2026-10-24 | **Volume of the Dec 8 AI pass is not a concern.** A less sophisticated model will likely be used, and applications arrive over several days (heaviest near the deadline); at about 2 minutes each, 300 can be processed overnight. | Justin | Timeline Dec 8 |
| D7 | 2026-10-27 | **Either calendar role can edit at any time** (answers A1). The Grants Manager and Program Coordinator roles both hold edit rights all the time; the fallback is not limited to an unassigned Grants Manager role. The calendar shows who last edited each value and when. | Justin | D1; A1 |
| D8 | 2026-10-27 | **One person can change any calendar date; no second approver** (answers A3). Responsibility defaults to the Grants Manager role (Sarah); the Program Coordinator edits when necessary, using the access D7 grants. | Justin | D1; D7; A3 |
| D9 | 2026-10-27 | **Refines D4: anchor dates are central; PDs adjust response periods and quota** (answers A4). Cycle anchor dates, including the review deadline, are set centrally by the calendar owner (D7, D8); there is no per-proposal deadline override. The response period and reviewer quota have central defaults: a PD may change the response period for a proposal and for an individual invitation, and the quota for a proposal. A PD may extend one reviewer's due date when that reviewer asks (existing per-reviewer extension, `lib/services/reviewer-due-extension.js`). Today's per-request Campaign settings (`CampaignConfigModal`) are the clunky precedent; the PD controls built for D9 must be much simpler, and their design goes through Impeccable before it is built. | Justin | D4; A4 |
| D10 | 2026-10-27 | **Superseded 2026-10-28 by D43** (the operations Grant Cycle table now carries the milestone dates, edited from the apps). Original: **Cycle dates are split by owner, one editable copy each** (answers C3; narrows D1). The Board date stays in the operations Grant Cycle record (`wmkf_grantcycle`), owned by Connor's process; the apps read it and never copy it. The apps' anchor dates (review deadline, invitation start and similar) live in the existing apps cycle record (`wmkf_appgrantcycle`), edited in the app under D7/D8; no operations schema change. Creating future operations rows (D27) stays with Connor's process and is not needed for J27. Not built: no runtime code reads `wmkf_grantcycle` today, and Board writeups keeps its own `boardEnds` copy (`docs/audits/cycle-settings-audit-2026-10-27.md` rows A4, B2). | Justin | D1; C3; foundations audit §2 |
| D11 | 2026-10-27 | **Review filing follows each cycle's calendar window, not a Vercel setting** (**amended 2026-10-29 by D44:** no start bound; a review files until its cycle's Board date) (replaces T3; relaxes D3). A completed review files automatically when its own cycle's window is open: from that cycle's invitation start date (apps cycle record, D10; **2026-10-28:** no operations column holds it yet, see D43 open questions) to its Board date (operations record, D10). Overlapping cycles each file to their own cycle; Sarah and Duncan change the dates in the app and no redeploy is needed. Today a single Production setting, `REVIEW_DOCX_SHAREPOINT_CYCLE`, limits the sweep to one cycle (`lib/services/review-documents/individual-file-service.js:1006`; `lib/dataverse/adapters/reviewer-suggestion.js:1536-1551`), so this is a build, folded into the November central-settings work and due before the first J27 invitation (Feb 24). **Built as amended by D44 (PR #551, merge `caf318983`, Production-deployed 2026-10-29):** the cron files every cycle whose calendar Board date is today or later. A review arriving after the Board date is not filed automatically; operator backfill remains. | Justin | D3; T3 |
| D12 | 2026-10-27 | **Readiness notices route by who can fix the problem** (answers A2; no further confirmation needed). App calendar problems (missing anchor date, missing apps cycle row, Board writeups date disagreeing) go to the Grants Manager and Program Coordinator roles. Operations-data problems (missing operations cycle row, a Board date change not reaching request meeting dates) go to the Systems Specialist role, copying the Grants Manager. Delivery: one daily email digest per role plus an in-app readiness panel. The readiness check itself is planned, not built (rollover plan §3.5). | Justin | A2 |
| D13 | 2026-10-27 | **December readiness is delivered by Nov 15, 2026** (answers R1). In scope: J27 proposals visible in the Workbench list (R-1); per-proposal AI summary / Initial Assessment, suggested PD and expertise matches from the AI pass (R-3); the staff states (state model, revised in D17), settable in bulk from the list; a "my proposals / all proposals" PD filter; triage flags and decline-note drafts if F1 calls for flags (J-1); sorting/columns (F2), MR/S&E counts and the First Cut spreadsheet (J-2). R-4 is dropped: under the state model staff stop at Recommend to Program Chairs and the Grants Manager records the Chairs' outcome in AkoyaGO. Decisions that shape this build are due in early November. | Justin | R1; December readiness |
| D14 | 2026-10-27 | **Intake AI prompts are shared, whoever runs them.** Every prompt used by the J27 intake AI work, whether run by Connor's Power Automate flows or by the apps, lives once in the shared prompt store (`wmkf_ai_prompt`, the Executor contract in `docs/EXECUTOR_CONTRACT.md`, which already reserves a Power Automate caller) and is editable from the app's Admin prompt editor. The Admin editor shows who last changed each prompt and when, including changes made directly in Dataverse or from Power Automate. Justin prefers Connor to edit through the Admin panel but accepts edits outside the app as long as the prompts stay shared. Today the editor shows "last touched … by …" from Dataverse `modifiedon`/`modifiedby` (`shared/components/admin/PromptTemplatesSection.js:145-146`); it does not yet label where a change came from. | Justin | R2; Executor contract |
| D15 | 2026-10-27 | **One expertise roster, editable in the app** (partly answers X1). Justin's position: the roster of staff, consultants and Board members is maintained in the app so non-power users can update it and more staff can see it. Two versions exist today: the app's Postgres `expertise_roster` (editable by anyone with Expertise app access, `pages/api/expertise-finder/roster.js`) and, per Justin, Connor's own matcher whose roster lives in Dataverse and runs from Power Automate. Which becomes the single shared roster is to verify with Connor; a Dataverse home would let his flows and the apps read the same list. Written to the request (D16). Starting prompt: no preference (Justin, 2026-10-27); staff debate the prompts on their merits (T7). | Justin | X1; D6; D14 |
| D16 | 2026-10-27 | **The AI's lead-PD pick is written to the request; staff fix the exceptions in AkoyaGO** (answers the X1 write-or-show question; makes F3 moot). The tentative lead PD goes straight into the request's Program Director field. Staff meet as a group to find mis-assigned requests and correct them in AkoyaGO; the apps read the field, so corrections flow through. Most picks are expected to be right, so the process corrects edge cases rather than confirming every proposal. Which side writes the field (Connor's flow or an app job) follows R2. | Justin | X1; F3; R2 |
| D17 | 2026-10-27 | **Human-in-the-loop triage; revised staff states** (revises the 2026-10-26 state model; reshapes F1). States: Submitted, Flagged for triage, Triaged, Under consideration, Recommend to Program Chairs, Invited for Peer Review, and a terminal Not invited (working name). Only Flagged for triage is set by the AI pass, with a rationale a person must read before deciding; every other change is a human decision, as leadership requires. Program Chairs have no database access and set nothing (corrects the 2026-09-06 note that PCs could set triage states). The flags and the prompts that produce them are for a staff meeting with the CSO. | Justin | State model; F1; register Q2 |
| D18 | 2026-10-27 | **Assign MR or S&E early, and keep the at-submission value** (partly answers C5). Justin's position: a program is assigned at intake so staff can collect demographic information (for example, which institutions submit two MR versus two S&E proposals). Because changing the program mid-cycle carries risk, consider a separate field that records the program assigned at submission and never changes, alongside `akoya_programid`, which may later be corrected. How and when assignments are revisited is the CSO's decision. A new field would be a Dataverse schema change (Connor). | Justin | C5; MR vs S&E |
| D19 | 2026-10-27 | **Triage list: short list, detail on the proposal page** (answers F2). Columns: request number, title, institution, lead PD, program (MR/S&E), state (Flagged for triage visibly marked) and a one-line AI summary. Filters: my/all proposals; state, with Triaged and Not invited hidden by default but counted; program; flagged only. The full Initial Assessment, flag rationale, expertise matches and compliance results stay on the proposal page. Bulk action: select several and set a state. The design goes through Impeccable before it is built. **Added 2026-10-28 (D40):** from Feb 3, a count and marker for proposals still Under consideration. | Justin | F2; D13; D16–D18 |
| D20 | 2026-10-27 | **J27 Proposal tab: staff version on top, the rest under a caret** (answers B1 Q5). The combined staff version is the first item PDs see. The individual `AI Materials` files (Project Narrative, Bibliography, Biosketches, Other Support, Collaboration Letters, Graphical Abstract) sit in a collapsed section, for PDs who want to analyze one part on its own outside the app (for example, only Other Support or only the narrative). The second group (PhaseI Cover Page, Abstract, Graphical Abstract Page) stays off until Connor explains its purpose. A missing expected file shows as not received yet. Today J27 falls back to the D26 slot list (`shared/config/workbenchProposalDocuments.js:28-37`), so this needs a J27 entry. | Justin | B1 Q5 |
| D21 | 2026-10-27 | **Chairs writeup reuses existing machinery; export path exists** (partly answers the writeup/Diligent scope). Content: Justin expects it to resemble the Executive Summary staff generate for Phase II proposals (once a standalone document, now a section of the Pre-Site/Phase II writeup draft, `lib/services/pre-site-visit/artifact-model.js:55,324`); to confirm with the CSO. Build it with similar machinery. Export: the existing release to a SharePoint folder, where the President reviews and the Grants Manager (Sarah) assembles the Diligent Book, and the reverse trip that archives with a readable filename, already exist (Board writeups workflow; `docs/atlas/postgres-board-writeup-runs.md`), so no book-assembly build is planned. Schedule risk: Final writeups use shared staff review and approvals, and the Feb 10 writeups → Feb 12 book window leaves no time for that; this may be an oversight by leadership and should be raised with them. | Justin | Writeup export; state model |
| D22 | 2026-10-28 | **Staff version contents and order** (meeting; answers the staff-version item). Cover page, abstract, graphical abstract page, summary of the applicant's text answers, project narrative, bibliography, biosketches, other support, collaboration letters. This settles the second file group's purpose (cover page, abstract and graphical abstract page are front matter). Connor's flow builds it. | Meeting 2026-10-28 | Staff version; D20 |
| D23 | 2026-10-28 | **Reviewer Finder uses bibliographies for J27** (answers the bibliographies item; register J27-065). A combined document holding the narrative and the bibliography will be created for it. Who builds the combined document and its name are not recorded. | Meeting 2026-10-28 | Bibliographies |
| D24 | 2026-10-28 | **Budget: a total at submission, details later in Dataverse fields.** The request carries one total budget figure. If a proposal proceeds, applicants submit fuller budget information, saved in Dataverse fields (not a spreadsheet). | Meeting 2026-10-28 | Budget |
| D25 | 2026-10-28 | **A new files-ready flag will be created** (answers B1 Q3). The AI-pass trigger will use a new flag rather than `wmkf_phistaffversioncompleteflag`. Its name, type and when it is set are not yet known (Connor, a Dataverse schema change). | Meeting 2026-10-28 | B1 Q3 |
| D26 | 2026-10-28 | **Replaced files are reprocessed by Connor's Power Automate flows** (answers B1 Q4). Open: whether app-run AI steps also rerun, and what tells them to. | Meeting 2026-10-28 | B1 Q4 |
| D27 | 2026-10-28 | **J27 proposals arrive as `Phase I Pending`** (answers C4). An existing live value [VERIFIED via `docs/atlas/dataverse-akoya-request.md:311`, probe 2026-10-26: 16 requests carry it]. R-1's list filter keys on it. | Meeting 2026-10-28 | C4 |
| D28 | 2026-10-28 | **Central reviewer values are entered in the calendar once it is built** (answers A5 for now). No values were set at the meeting. The Grants Manager enters the review deadline, default response period and default quota; the Program Coordinator is backup. D7/D8 stand: either role can edit at any time. | Meeting 2026-10-28; Justin | A5; D7; D8 |
| D29 | 2026-10-28 | **The default cycle follows a setting the Grants Manager controls in the app** (answers the default-cycle item). Each app's landing cycle is cued from a value Sarah sets in the calendar, not from env pins, `'D26'` literals or month flips. The rule and the three Board-date stores are still to plan (`docs/audits/cycle-settings-audit-2026-10-27.md`). **2026-10-29 (Justin):** (made automatic by D45) the landing cycle is one app setting edited on the cycle calendar page; every app that picks a default cycle follows it when the cycle is in that app's list, otherwise its current rule; Board pages follow it once the cycle has a Board setup. Plan: `docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md` (merged to `main` 2026-10-29, PR #547; the setting is unset). The Board-date stores remain to plan. | Meeting 2026-10-28 | Default cycle |
| D30 | 2026-10-28 | **Create a "program at submission" field** (confirms D18; part of C5). It records MR or S&E as assigned at intake and never changes; `akoya_programid` may later be corrected. A Dataverse schema change (Connor). Who assigns the program and revisiting rules stay with the CSO. | Meeting 2026-10-28 | D18; C5 |
| D31 | 2026-10-28 | **Only Triaged is written to AkoyaGO; other staff recommendations stay in the app** (answers X2 and the pre-Chairs value; revises D17). Marking a proposal Triaged in the app sets `wmkf_phaseistatus` to `Recommended Do Not Invite` (707510006; a dropdown) [VERIFIED via `docs/atlas/dataverse-akoya-request.md:193-196`, owner-run probe 2026-10-26]. Under consideration and Recommend to Program Chairs are not logged to the AkoyaGO phase status fields, so `Recommended Invite` is never set before the Chairs meeting. After the Chairs meeting the Grants Manager records the outcome in Dataverse (D35) and the app's Invited for Peer Review state is read from `Phase II Pending`; the app does not write request status. Build impact: a new app write path to `wmkf_phaseistatus` (DAL context and target interlock apply; check Phase I Status consumers and flows listed in X2 before release). | Meeting 2026-10-28; Justin | X2; state model; D17 |
| D32 | 2026-10-28 | **Declines are set on the Dataverse back end** (answers the declines item). The apps do not write `Phase I Declined`. | Meeting 2026-10-28 | Declines |
| D33 | 2026-10-28 | **Reviewers see the staff version** (answers B1 Q6). It is renamed appropriately and stored in the request's `Reviewer Materials` folder. The file name, and what triggers building it at the ~50 stage, are not recorded. | Meeting 2026-10-28 | B1 Q6; materials trigger |
| D34 | 2026-10-28 | **Program Chairs and Board members get proposals through magic links** (answers the sharing item). No Board/Chairs sharing surface was found in the app (grep 2026-10-26; not rechecked), so the mechanism is still to design. | Meeting 2026-10-28 | Sharing |
| D35 | 2026-10-28 | **The Grants Manager records the Chairs' outcome** (confirms the post-Chairs mapping owner). Values as proposed under "After the Chairs meeting" below; the not-approved request status follows D32. | Meeting 2026-10-28 | Post-Chairs mapping |
| D36 | 2026-10-28 | **Offramp: shown in the app, formal status set in Dataverse.** The app logs the offramp outcome for display; staff set the formal status on the back end. Which AkoyaGO field holds it is not recorded. | Meeting 2026-10-28 | Offramp |
| D37 | 2026-10-28 | **Connor's flows run the intake AI steps on submit** (answers R2 in part). On submission, Power Automate creates the WMKF short title (**2026-10-28, Justin:** written to `wmkf_wmkfprojectdescription` using the existing `grantee-title.generate` prompt or an edited version; see T13), keywords, lay abstract, initial PD assignment (D16), clerical check, fitness flag and expertise. Expertise mechanics need more discussion (T8). Open: which Dec 8 outputs, if any, remain app jobs (for example the Initial Assessment), and how the fitness flag relates to Flagged for concerns (D38). | Meeting 2026-10-28 | R2; R-3; D14 |
| D38 | 2026-10-28 | **"Flagged for triage" is renamed "Flagged for concerns."** A prompt will be written to set it. What triggers the flag is still open (F1). | Meeting 2026-10-28 | D17; F1 |
| D39 | 2026-10-28 | **Every J27 proposal's Phase I Status ends somewhere other than Pending** (Connor, meeting; confirms the post-Chairs mapping values). Phase I is going away in practice, but for history each proposal reaches a terminal Phase I value. Approved by the Chairs: the Grants Manager sets `wmkf_phaseistatus` `Invited` (100000003) together with `akoya_requeststatus` `Phase II Pending`, both in Dataverse; the app writes neither (D31, D35). Not approved by the Chairs: `Not Invited` (100000002), also set in Dataverse. Triaged: keeps `Recommended Do Not Invite` (D31) as its final value. Option values [VERIFIED via `docs/atlas/dataverse-akoya-request.md:193-196`]. Under consideration is a working state: staff move every such proposal to Recommend to Program Chairs or Triaged by Feb 3, so each reaches a terminal value; the triage list flags any left over (D40). | Meeting 2026-10-28 (Connor); Justin | D31; D35; post-Chairs mapping |
| D40 | 2026-10-28 | **The triage list flags proposals still Under consideration from Feb 3** (safeguard for D39). From the Feb 3 staff-recommendation deadline, the list shows a visible count of proposals still in Under consideration and marks each one, so staff resolve them (to Recommend to Program Chairs or Triaged) before the Feb 24 Chairs meeting. Display only: it blocks nothing and writes nothing. Part of the triage list build (D19); the Feb 3 date should come from the cycle calendar (D10, D29), not a literal. Not built. | Justin | D19; D39; state model |
| D41 | 2026-10-28 | **Staff states live in a new field on the request** (answers where the state model is stored). A new Dataverse field on `akoya_request` holds the J27 staff state, so Connor's flows and AkoyaGO users can see it (for example, the reviewer-materials trigger at the ~50 stage). It is new, not an extension of the D26 `wmkf_triagestatus` field (Advancing / Set aside). Precedent for adding it: the `wmkf_triagestatus` schema wave (`lib/dataverse/schema/wave2-triagestatus/akoya_request-triagestatus.json`). Name, options and who provisions it are to settle at build time. Not built. | Justin | State model; D31 |
| D42 | 2026-10-28 | **Nothing important reacts to Phase I Status changes** (Connor, via Justin; clears the D31 write risk). The app's write of `Recommended Do Not Invite` when staff mark Triaged does not set off flows or reports that matter, so bulk Triaged changes are safe from that side. App-side readers act only on `Invited` (grantee-title cron) or display the value [VERIFIED via grep of `wmkf_phaseistatus` in `lib/`, `pages/`, `shared/`, 2026-10-28]. | Connor; Justin | D31; X2 |
| D43 | 2026-10-28 | **The operations Grant Cycle table is the home for cycle milestone dates, edited from the apps** (supersedes D10's date split; narrows the role of `wmkf_appgrantcycle`). Connor added eleven optional date columns to `wmkf_grantcycle` (proposal due, leadership/Chairs semi-finalist email and meeting dates, reviews due, offramp meeting, leadership/Chairs finalist email dates, Board mailing, budget due) beside the Board date; all are null on D26, J26 and J27 [VERIFIED via `scripts/probe-grant-cycle-dates.cjs`, owner-run 2026-10-28; `docs/audits/grant-cycle-dates-2026-10-28-evidence.json`]. The apps treat this table as authoritative for every date it carries and **edit those dates from an Admin calendar** (owner's choice over editing in Dynamics, so the apps manage the cycle's milestone dates in one place); either calendar role edits (D7, D8), and each date shows who last changed it and when. `wmkf_appgrantcycle` keeps its non-date role (template, attachments, custom fields). Rows are created when the GOApply portal opens, so no D27 row is expected for some time. Which timeline step each column represents is TBD (staff are still deciding the dates); values are entered through the Admin calendar once decided. Plan, prototype scope, edit tracking and open questions: `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md`. Source-built on branch `claude/cycle-calendar` (page `/cycle-calendar`, Admin → Workflows → Cycle calendar); controlled Production test passed 2026-10-28; not deployed. | Justin | D10; C3; T14 |
| D44 | 2026-10-29 | **Review filing has no start date: a completed review files until its cycle's Board date** (amends D11). The invitation-start bound is dropped: reviews exist only after invitations, and under the blank-date rule a blank start date would have stopped filing altogether. After the Board date, operator backfill as before. Also decided 2026-10-29 for centralizing cycle dates: invitation start = Chairs Semi-Finalist Meeting Date; Board materials due = Board Mailing Date; dates with no Grant Cycle column (Feb 3 staff deadline, proposal release to reviewers; the January triage meetings need no field because no app reads them) stay in the apps, edited on the calendar page. Plan: `docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md`. Review filing by Board date built (PR #551, merge `caf318983`, Production-deployed 2026-10-29); the rest of the plan is not built. | Justin | D11; D43 |
| D45 | 2026-10-29 | **The landing cycle is automatic: the cycle with the next Board meeting, switching at the start of the Pacific day after that meeting** (amends D29). For D26/J27 the apps move to J27 at 12:00 am Pacific on Friday Dec 11, 2026. Reason: PDs stay focused on the D26 Board and its screens through the meeting, and new proposals need their AI pass and back-end prep first. Read from the Board dates in the operations Grant Cycle table; cycles without a Board date are skipped. The Grants Manager can still choose a specific cycle as an override and switch back to Automatic. A cron job was rejected: computing the rule on each read has nothing scheduled to fail. Merged to `main` 2026-10-29 (PR #550, `aefaebdf7`). | Justin | D29; D43 |
| D46 | 2026-10-29 | **J27 has no separate proposal release: a reviewer gets the materials as soon as they accept.** PDs invite reviewers after the Program Chairs meeting; there is no commit-then-later-send. So there is no proposal-release date to keep (dropped from the app-only calendar dates; only the Feb 3 deadline remains). **Not built:** today an accepted reviewer waits on an "accepted, materials not yet sent" screen until staff release materials by hand (`lib/external/review-engagement-state.js`), the acceptance email refers to a later release (`lib/services/reviewer-acceptance-email.js:85`), and the default invitation promises "we send the full proposal around {{proposalDelivery}}" (`lib/seed/email-defaults/reviewer-templates.js:56`). Needed before the Feb 24 invitations. | Justin | D4; D44 |
| D47 | 2026-10-29 | **The Board setup reads its dates from the calendar; nobody types them.** The Dynamics Board Meeting Date (read-only on the calendar, set by Connor's process) is the ground truth for the Board date. Board meetings last two days; that date is the decision date, the second day, so it is the meeting's end date: the Board archive starts the morning after it. The materials deadline is the calendar's Board Mailing Date. The Board setup page's typed `materialsDue` and `boardEnds` go away; a blank calendar date means the archive does nothing and the setup names the missing date. **Not built:** today both dates are typed per cycle on the Board setup page (`lib/services/board-writeups/model.js:38-48`). Built with the Feb 24 date work (shared calendar reader). **Amends D45's Board-page rule:** a Board page candidate is a cycle with a Board setup row whose calendar Board Meeting Date is set (today: a setup with a typed `boardEnds`, `lib/services/landing-cycle-service.js:245-256`). | Justin | D43; D45 |
| D48 | 2026-10-29 | **Reviewer invitations: the promised due date is fixed, withdrawal goes through the PD, and invitations need the date and the PDF.** (1) At a proposal's first invitation the apps save the calendar's Reviews Due Date on the request; a later calendar change does not move dates already promised (a change for one reviewer is an extension). (2) Once materials go out on acceptance (D46), a reviewer withdraws by emailing the PD; the review page's decline stays locked after materials, as today. (3) Invitations are refused when the cycle's Reviews Due Date is blank or the proposal PDF is not in SharePoint. **Not built:** `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md` §3.1, §3.3, §6. | Justin | D9; D46 |
| D6 | 2026-10-24 | **Expertise matching is rebuilt to run inline.** Each proposal is matched automatically as part of the intake AI pass, instead of a person running the Expertise app on demand. The current app is an early version based on the CSO's draft Claude project and needs improvement. | Justin | R-3 |

## To confirm at the meeting

| # | Question | Who | Why it matters | Source |
|---|---|---|---|---|
| A1 | **Answered 2026-10-27 (Justin): either role can edit at any time; show who last edited and when (D7).** What does "fallback" mean in practice: Duncan may also edit at any time, or only when the Grants Manager role is unassigned? | Sarah, Duncan, Justin | Decides whether the app grants both roles edit rights or switches to Duncan only when Sarah's role is empty. | D1 |
| A2 | **Answered 2026-10-27 (Justin), D12:** route by who can fix it; daily digest per role plus in-app panel. Who is notified when a cycle is missing a date or has conflicting records? Proposed: Grants Manager and Systems Specialist. | Sarah, Connor | Readiness notices need named roles; there is no fallback to individuals. | Rollover plan §3.5, §7 |
| A3 | **Answered 2026-10-27 (Justin): one person can change any date; Grants Manager by default, Program Coordinator when necessary (D8).** May the calendar owner publish any date change directly, or do some changes (board date, review deadline) need a second person? | Sarah, Justin | Decides whether a confirmation step is built. | Rollover plan §7 |
| A4 | **Answered 2026-10-27 (Justin), D9:** no per-proposal deadline override; PDs may change the response period (per proposal and per invitation) and the quota (per proposal), and extend one reviewer's due date on request. Under D4, is there ever a reason one proposal needs a different reviewer quota or review deadline than the rest of the cycle? If so, who may set that exception? | Sarah, Duncan | Decides whether any per-request override survives, and whether it belongs to the PD or the calendar owner. | D4 |
| A5 | **2026-10-28 (D28): not set at the meeting; the Grants Manager enters them in the calendar once built.** What are the J27 central values: review deadline, days a reviewer has to respond, and reviewer quota? (Under D9 the last two are defaults PDs may change.) | Sarah | These replace the values PDs entered per request. | D4 |
| B1 | **Partly answered 2026-10-26; Q3, Q4, Q6 and the staff version answered 2026-10-28 (D22, D25, D26, D33); see B1 detail.** **Priority — confirm first.** The AI input files are already decided (owner, 2026-08-17): `AI Materials/ProposalNarrative_{n}.pdf` and `AI Materials/ProposalBibliography_{n}.pdf`, produced by Power Automate. Confirm the flows produce both for J27's single submission, when, and what else lands in the request folder. The Dec 8 pass, including expertise matching, reads the narrative file. | Connor | Initial Assessment, expertise matching, reviewer materials and proposal lookup all depend on it. | Register Q5 |
| C1 | **Answered 2026-10-26 (Justin): yes, 001024 is the Research form; no app concern** (no app code keys on the opportunity; grep 2026-10-26). Is GOApply opportunity 001024 the J27 Research form? What are its real open window and submission cutoff, and when does it get its J27 cycle link? | Connor | Confirms which records intake comes from. | Foundations audit §3 |
| C2 | **2026-10-28: revisit with Connor (T10).** **Partly answered 2026-10-26 (Justin):** a placeholder meeting date is believed to be set on submission (open: confirm its value); date moves are handled by a Power Automate flow. The apps derive the cycle only from the month and year (`lib/utils/cycle-code.js` `meetingDateToCycleCode`: June → J, December → D, any other month → no cycle), so the placeholder must fall in June 2027. When the board meeting date on a Grant Cycle record changes, do linked requests' dates update, and by what mechanism? | Connor | The apps currently derive the cycle from each request's meeting date. | Foundations audit §2 |
| C3 | **Revised 2026-10-28 by D43:** operations now carries the milestone dates and the apps edit them. **Answered 2026-10-27 (Justin), D10:** Board date in operations, app anchor dates in the apps cycle record; D27 row creation stays with Connor (ask when; not needed for J27). Originally: **to the team meeting Wed 2026-10-28** on calendar ownership (Grants Manager or Program Coordinator to own and update it, consistent with D1). When and how is the next operations cycle row (D27) created, and does operations maintain only the board date or other milestones too? | Connor, Sarah | D27 has no operations row yet; the apps should read dates from one place. | Foundations audit §2 |
| C4 | **Answered 2026-10-28 (D27): `Phase I Pending`.** What request status do J27 proposals carry when they arrive from GOApply (expected `Phase I Pending`)? | Connor | The Workbench list and triage depend on that exact label. | Register Q8, J27-064 |
| C5 | **Owner assigned 2026-10-26:** when and how the program is set is the CSO's decision, in consultation with Connor and Sarah (see "MR vs S&E" below). Applicants no longer choose S&E or MR. How is the program recorded on the request, who assigns it, and when? | Connor, Sarah, Duncan | Apps that filter or assign by program will find it empty at intake. | Timeline Dec 7 |
| R1 | **Answered 2026-10-27 (Justin), D13:** full December scope delivered by Nov 15; R-4 dropped. Is the day-one list below right, and how quickly do staff need to triage in December? | Sarah, Duncan | Sets what must be built in the next six weeks versus early January. | December readiness below |
| X1 | **2026-10-28: compare the two rosters (T8); D16 settles the suggested-PD question.** **Partly answered 2026-10-27 (Justin), D15:** one roster, editable in the app; which existing roster (app Postgres or Connor's Dataverse) becomes it is for Connor. For inline expertise matching (D6): who maintains the roster of staff, consultants and Board members and their expertise; should the suggested PD be written to the request or only shown for staff to accept; and can the CSO's current Claude project prompt be shared as the starting point? | CSO, Sarah, Duncan | Defines what the rebuilt matcher reads, produces and who trusts it. | D6 |
| R2 | **Answered in part 2026-10-28 (D37): Connor's flows run the intake AI steps on submit; which outputs remain app jobs is open.** **Update 2026-10-27 (Justin's understanding; to confirm with Connor):** Connor intends to run AI analyses in Power Automate for compliance, keyword extraction and a tentative lead PD, and possibly Board and consultant expertise. Who runs which step (Connor's flows or an app job) is open; prompts are shared either way (D14). This overlaps R-3, D6, X1 and F1. Who starts and watches the Dec 8 AI pass, and what happens to proposals that arrive after it runs? Which steps are triggered by Power Automate (e.g. when a proposal file lands) and which by the apps' scheduled background jobs? | Justin, Connor | Volume is not a concern (D5), but the run needs an owner and an agreed trigger for each step. | Timeline Dec 8 |
| F1 | **2026-10-28 (D38): renamed Flagged for concerns; a prompt will set it; criteria still open.** **2026-10-27 (Justin): needs a discussion with the CSO.** Shape decided in D17: the AI sets "Flagged for triage" with a rationale for potentially weak applications; a person decides. What triggers a flag and its prompts are for the meeting. What are "triage flags"? Candidates: eligibility (e.g. more than three proposals from one institution), fit with Keck guidelines, or "likely decline" feeding the Jan 6 decline notes. Who may see them? Note: the current Initial Assessment deliberately makes no recommendations, so flags are a new kind of output. | Sarah, Duncan, CSO | Defines the flag step of the Dec 8 pass and the January decline notes. | Timeline Dec 8, Jan 6 |
| F2 | **Answered 2026-10-27 (Justin), D19:** short list plus proposal-page detail, bulk state changes, Impeccable design first. On Dec 9, should the suggested PD, expertise matches and flags appear as sortable columns in the triage list (so each PD can filter to their own), or only on each request's page? | Sarah, Duncan | Decides the shape of the R-1/R-2 list. | R-1, R-2 |
| F3 | **Moot 2026-10-27 (D16):** the lead-PD pick is written to the request, so every proposal has a PD; mis-assignments are corrected in AkoyaGO. If the suggested PD is not written to the request (X1), where do proposals without a confirmed PD appear so nothing is lost? | Sarah, Duncan | The "nothing gets lost" rule for triage. | X1, register J27-062 |
| X2 | **Answered 2026-10-28 (D31): only Triaged writes Phase I Status (`Recommended Do Not Invite`); other staff states stay app-only.** **Raised 2026-10-26; not expected to be answered right away.** Triage record vs Phase I Status. Background (Justin): `wmkf_triagestatus` was a D26 patch for the last two-submission cycle (Phase I proposal, then Phase II if invited); staff use it in discussions, it has no AkoyaGO counterpart, and it also kept Workbench lists uncluttered. Open issues: (1) Phase I Status already carries staff recommendations (`Recommended Invite` / `Recommended Do Not Invite`), so J27 could have two records of one decision with nothing keeping them in step; (2) the values do not map one to one (no Phase I value for Save for now; no triage value for Scored / Not Scored); (3) Phase I Status is set in Dynamics by an unconfirmed owner, and an app write would be a new write path; (4) Phase I Status has consumers: the grantee-title cron keys on `Invited` (`lib/services/cron/generate-grantee-titles-service.js:34,72`), plus Expertise Finder, the Dataverse export and Dynamics Explorer; flows and reports outside the repo are unknown; (5) who sets Phase I `Invited` in J27 (Program Committee at Jan 13–14, Board, or staff) is register Q9. | Justin, Sarah, Duncan | Decides whether J27 triage is a working/display aid only, or writes the staff recommendation to Phase I Status. | Probe 2026-10-26; Atlas status semantics |

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
than an automatic rerun. **Update 2026-10-27 (Justin):** replacements usually come from a formatting
issue (Connor, possibly through Duncan) or an applicant request (Duncan, as
applicant liaison). Whatever is built must reprocess whether the trigger comes
from Connor on the back end or Duncan in the app; to settle with Connor and
Duncan.

**Question 6 (2026-10-26):** Justin will ask Connor to generate
`Reviewer Materials/Proposal_{n}.pdf` for J27 and expects he will. Contents,
order, whether it differs from the staff version, and anything off limits to
reviewers or the AI (register Q21) remain open.

**2026-10-28 (meeting):** question 3 is replaced by a new flag (D25),
question 4 by Connor's flows (D26), question 6 and the staff version by D22 and
D33. The paragraphs below are kept as history.

This answers questions 1 and 2: both files are produced, and the bibliography
is its own upload. Still open: 5 decided 2026-10-27 (D20; the J27 entry is still to build), 6
(the reviewer copy and anything off limits). Also open: the contents and
order of the combined staff/distribution copy, and what the second group of
files is for. **2026-10-27 (Justin):** both are meeting discussion points; the D26 staff
version is not the model, since J27 submissions carry more. Budget: J27 asks
for no full budget at submission; some budget information arrives (believed
stored in Dataverse, not a spreadsheet), and fuller budget information comes
if a proposal goes out for review.

## J27 proposal state model (proposed by Justin 2026-10-26; pending Connor and Sarah)

About 300 proposals arrive Dec 7; staff pare them to the 20–25 the Program
Chairs approve for peer review on Feb 24 (timeline workbook). Each proposal
gets a lead PD after the Dec 8 AI pass.

**Staff states, owned by the apps** (replace the D26 triage patch, see X2):

**Revised 2026-10-27 (Justin, D17).** Human-in-the-loop: the AI may only flag;
every other state change is a person's decision. Program Chairs have no
database access and set nothing; staff record outcomes.

| State | Set by | Meaning |
|---|---|---|
| Submitted | Arrival | Every proposal on arrival. |
| Flagged for concerns (renamed from Flagged for triage, D38) | AI pass | The AI identified a potentially weak application and gave a rationale. A person must read the rationale and make the triage decision; the flag decides nothing. |
| Triaged | Staff | Out: not looked at again unless something extraordinary happens. Logged, hidden from the default view but always counted and one click away. Also sets Phase I Status `Recommended Do Not Invite` (D31). |
| Under consideration | Staff | Still in contention during the Jan 13–Feb 3 PD sessions (replaces "Save for now"). Working state only: resolved by Feb 3 to Recommend to Program Chairs or Triaged; the list flags any left over (D40). |
| Recommend to Program Chairs | Staff | Last staff recommendation, decided by Feb 3. |
| Invited for Peer Review | Staff, after the Chairs meeting | The Chairs approved the roster on Feb 24. |
| Not invited (working name) | Staff, after the Chairs meeting | Terminal: not invited for peer review and no longer under consideration. |

Default list (carried from 2026-09-06): every state except Triaged and the
terminal state, with visible counts for those. **Settled 2026-10-28 (D31):**
Triaged writes Phase I `Recommended Do Not Invite`; the other staff states stay
in the app; Invited for Peer Review is read from the Grants Manager's
`Phase II Pending` in Dataverse. Earlier text, kept as history: Open: how Invited for Peer
Review and the terminal state relate to the AkoyaGO values the Grants Manager
records after the Chairs meeting (below): separate app states, or the same
fact read from AkoyaGO. **To consult Connor and Sarah (Justin, 2026-10-27):**
reconcile these states with existing AkoyaGO fields and workflows. The app may
show its own labels while AkoyaGO logs a different value with the same
meaning; the aim is one recorded fact per decision, not two.

The ~50 left after Jan 13–14 PD triage go to the Program Chairs and
interested Board members (First Cut spreadsheet, Jan 14). The lead PD writes a
1-page writeup for each recommended proposal by Feb 10. The writeups are exported to a
SharePoint folder for leadership to assemble the Diligent Book (Feb 12),
reusing the existing President-approval model. **This writeup and export
infrastructure is the critical build** (Justin). **2026-10-27 (D21):** the export and
archive path already exists; the writeup reuses the Executive Summary
machinery; review time is a schedule question for leadership.

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
also answer register Q9. **2026-10-28:** the Grants Manager records the outcome (D35); no
`Recommended Invite` is set before the Chairs meeting (D31); declines are set on
the Dataverse back end (D32). The Phase I values above are decided (D39); the
not-approved request status follows D32.

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
- Sharing with Program Chairs and Board members: **magic links (D34,
  2026-10-28); mechanism to design.** Earlier note: Justin recalls magic links
  were used before. No Board/Chairs sharing surface was found in the app
  (grep 2026-10-26); possibly SharePoint link sharing. To confirm with Connor.

**Offramp and oral presentations (Justin 2026-10-26):**

- **Revised 2026-10-28 (D36):** the app logs the Mar 25 offramp outcome for
  display; staff set the formal status in Dataverse (field not recorded).
  Earlier: the Grants Manager records the outcome in AkoyaGO and the apps read
  it rather than holding an offramp state.
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
- **Justin's position (2026-10-27, D18):** assign at intake for demographic
  information; keep a separate, unchanging at-submission program field so a
  later correction does not erase the original assignment; revisiting rules
  are the CSO's.
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
| T7 | Staff meet to debate the intake AI prompts (compliance, keywords, lead PD, expertise) on their merits, and revisit existing app prompts, many written by Justin before other staff had access. No prompt is preferred, including the CSO's. Prompts stay editable in the Admin panel (D14), so this can run up to the first intake run on Dec 8. | Staff (Justin to convene) | Open |
| T8 | Compare the two expertise rosters (app Postgres `expertise_roster` and Connor's Dataverse roster) before choosing the single one (D15), and settle the expertise mechanics for Connor's on-submit step (D37). | Justin, Connor | Open (meeting 2026-10-28) |
| T9 | Intake AI prompts: in progress. | Staff | Open (meeting 2026-10-28) |
| T10 | **Resolved 2026-10-28 (probe; Justin): use the request's grant-cycle lookup, and Connor owns making sure it is set at submission.** `akoya_request.wmkf_grantcycle` agreed with the meeting-date cycle on all but one of ~3,400 requests since 2024 that carry both (1003373: J27 lookup, J26 date; Connor is handling it, 2026-10-28), covers 12 J27 requests that have no meeting date, and opportunity 001024 links to J27; the activated `WMKF_Set Grant Cycle from Opportunity` process sets it on GOApply phase-status change. The post-August drop in coverage is the discretionary programs (Directors'/Staff/Senior Staff Directed, Matching), which have no Board cycle, not SoCal or a broken process. Confirmed 2026-10-28 (Justin): the lookup is set at submission for J27 (five older Research `Phase I Pending` requests without it are not a J27 concern: 1002797 and 1002822 (D26) are believed to be deactivated test requests, since they do not appear in AkoyaGO; Connor is reviewing 1000211 (D24), 1001975 and 1002162 (J26), which never reached a terminal Phase I status. The probe does not filter on `statecode`). App work: read the lookup first, meeting date as fallback (part of the default-cycle plan, D29). **Owner, 2026-10-29:** nothing in the apps should read the request meeting date; derive the cycle from the lookup (no fallback, to confirm). Not built: no app code reads the lookup yet; work queue item 6a. Evidence: `scripts/probe-request-grant-cycle-lookup.cjs`, owner-run 2026-10-28. Earlier text: Placeholder meeting date: revisit with Connor. Dataverse has fields holding the grant cycle code (e.g. D26), but they do not carry the meeting date; the apps derive the cycle from `wmkf_meetingdate` [VERIFIED via `lib/utils/cycle-code.js:24,70`]. | Justin, Connor | Open (meeting 2026-10-28) |
| T11 | Chairs writeup: adjust the writeup prompt and cut the review burden (no staff review of other IDs' work). Sending to the CSO and President works as it does now for Phase II. | Justin | Open (meeting 2026-10-28) |
| T12 | Update the timeline to give Chairs writeups review time in the Feb 10 → 12 window. | Timeline owner | Open (meeting 2026-10-28) |
| T13 | Retire the grantee-title cron (`/api/cron/generate-grantee-titles`, `lib/services/cron/generate-grantee-titles-service.js`) once Connor's on-submit flow fills `wmkf_wmkfprojectdescription` (D37). It writes only when that field is empty and selects Phase I `Invited` research requests [VERIFIED via `generate-grantee-titles-service.js:34,70-73`], so for J27 it would find nothing to do. Not before the D26 Board meeting: it runs daily Oct–Dec (`vercel.json:68-69`) as the D26 backstop. Before removal, follow the destructive-carryover check (live callers, `vercel.json` entry, route security matrix, Atlas). | Justin | Open; after the D26 Board meeting |
| T14 | Turn on auditing for the `wmkf_grantcycle` table so Dataverse records who changed each date and when (D43). Organization auditing and every column's audit flag are already on; only the table setting is off [VERIFIED via `scripts/probe-grant-cycle-dates.cjs`, owner-run 2026-10-28]. History starts when it is turned on. **Done 2026-10-28 (Pacific; owner-run `scripts/enable-grant-cycle-audit.cjs --apply`, write ack dated 2026-10-29 UTC):** Before `IsAuditEnabled=false`, metadata update HTTP 204, publish HTTP 204, After `IsAuditEnabled=true`. Justin to tell Connor. | Justin (was Connor) | Done |
| T6 | **Future idea (Justin, 2026-10-27; not scheduled):** make the AI prompts readable, read-only, to all app users, so staff can see what an AI run does. | Justin | Idea; not planned |

## Decision calendar (drafted 2026-10-27; dates proposed)

**Oct 28 meeting outcome:** answers are recorded as D22–D38 and tasks
T8–T12. Rows below are kept as drafted; for any row the meeting covered, the
decision or task supersedes it. Still open after the meeting: triage-flag
criteria (F1, D38), the expertise roster and mechanics (T8), the intake AI
prompts (T9), the placeholder meeting date (C2, T10), Chairs writeup content
and review time (T11, T12), and which outputs remain app jobs (D37).

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
| Wed Oct 28 meeting (discussion) | Staff version | Contents and order of the combined staff version; whether Connor's second file group (PhaseI Cover Page, Abstract, Graphical Abstract Page) is its front matter. J27 submissions carry more than D26 Phase I did, so the D26 staff version is not the model | Justin, Sarah, Duncan; Connor builds | Connor's staff-version flow; the Proposal tab (D20) |
| Wed Oct 28 meeting (discussion; no resolution needed yet) | Budget | J27 does not ask for a full budget at submission (budgets are hard to prepare and most proposals will not be invited). Some budget information arrives at submission and, Justin believes, is stored in Dataverse rather than as a spreadsheet; fuller budget information is requested if a proposal goes out for review. Where each lands and which apps show it | Justin, Connor, Sarah | Proposal tab budget slot; anything that reads budgets |
| Wed Oct 28 meeting (Connor) | B1 Q3 | Type and exact meaning of `wmkf_phistaffversioncompleteflag` (set after the `AI Materials` copies?) | Connor | Using the flag as the AI-pass trigger |
| Wed Oct 28 meeting (Connor, Duncan) | B1 Q4 | Reprocessing workflow when a submitted file is replaced: triggered either by Connor on the back end (usually a formatting fix) or by Duncan in the app (an applicant request; Duncan is the applicant liaison), possibly with Connor working through Duncan | Justin with Connor and Duncan | AI-pass rerun behavior |
| Before the Nov 15 delivery (decide in early November) | X1 | Who maintains the expertise roster; is the suggested PD written to the request or only shown; can the CSO's Claude project prompt be shared? | CSO, Sarah, Duncan | Inline expertise matcher (D6) |
| Before the Nov 15 delivery (decide in early November) | F1 | What triage flags are and who may see them; Justin to discuss with the CSO first | CSO with Justin, then Sarah, Duncan | Flag step of the AI pass; Jan 6 decline notes |
| Before the Nov 15 delivery (decide in early November) | C5 (part) | Whether the AI guesses MR or S&E at intake, and whether the guess is stored as a suggestion that a person confirms | CSO with Connor and Sarah | Shape of the AI-pass output |
| Before the Nov 15 delivery (decide in early November) | Default cycle | **2026-10-28:** cycle dates now come from the operations Grant Cycle table, edited from the apps (D43; `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md`). Planning item (2026-10-27): one calendar-driven rule for which cycle each app opens on, replacing env cycle pins, `'D26'` literals and today-based month flips; task rules only where an app needs one (e.g. Board writeups, Awardees). Includes the three Board-date stores (operations record, request meeting dates, Board writeups `boardEnds`). Evidence: `docs/audits/cycle-settings-audit-2026-10-27.md`. **2026-10-29:** planned as one landing-cycle setting (D29 note; `docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md`); the Board-date stores remain to plan | Justin | Every app's landing cycle Dec 7 – Feb 24; R-1 list |
| Wed Oct 28 meeting (Connor) | C4 | Request status J27 proposals carry on arrival (expected `Phase I Pending`) | Connor | R-1: the Workbench list filter |
| Wed Oct 28 meeting (Connor) | C2 | The placeholder `wmkf_meetingdate` value (must fall in June 2027); whether requests follow a moved Grant Cycle date, and how | Connor | The apps' cycle code for every J27 request |
| Wed Oct 28 meeting (Connor, Sarah) | State model | Staff states (Submitted, Triaged, Under consideration, Recommend to Program Chairs) and whether they live on the request in Dataverse | Justin with Connor and Sarah | List states; the reviewer-materials trigger (a flow can only see Dataverse) |
| Wed Oct 28 meeting (Connor, Sarah; part of the state reconciliation) | X2 | Is J27 triage a display aid only, or does it write the staff recommendation to Phase I Status? | Justin, Sarah, Duncan | Whether the apps get a new Phase I Status write path |
| Before the writeup build starts | Writeup content | Confirm with the CSO what the Chairs writeup contains (expected to resemble the Phase II Executive Summary, D21) | CSO with Justin | The writeup prompt and template |
| As soon as possible | Writeup review time | Raise with leadership: Final writeups get shared staff review and approval, but the Feb 10 → Feb 12 window leaves no time for it (D21) | Justin with leadership | Whether Chairs writeups get staff review before release |
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
| Files ready | Power Automate | New flag (D25; name not yet known) | Set when the files are ready | Decided 2026-10-28; name and type open (Connor) |
| Dec 7 submission | GOApply or flow | `akoya_requeststatus` | `Phase I Pending` | Decided 2026-10-28 (D27) |
| Dec 7 submission | GOApply or flow | `wmkf_meetingdate` | Placeholder in June 2027 | Open (C2; T10) |
| Intake to Feb 24 | Not decided | `akoya_programid` | Medical Research or Science and Engineering | Open (C5) |
| Intake | Not decided (Connor builds the field) | New "program at submission" field | MR or S&E as assigned at intake; never changes | Decided 2026-10-28 (D30); field not created |
| Dec 9 – Feb 3 | PDs, in the apps | Staff state (in the app) | Submitted, Flagged for concerns, Triaged, Under consideration, Recommend to Program Chairs | Decided 2026-10-28 (D31, D38); stored in a new request field (D41) |
| Dec 9 – Feb 3 | Apps, when staff mark Triaged | `wmkf_phaseistatus` | `Recommended Do Not Invite` (707510006); no other pre-Chairs value | Decided 2026-10-28 (D31); not built |
| By Jan 6 | Staff, on the Dataverse back end | `akoya_requeststatus` | Decline status | Decided 2026-10-28 (D32); value and timing not recorded |
| ~Jan 14 | Power Automate | `Reviewer Materials` folder | The staff version, renamed (D33) | Contents decided 2026-10-28; file name and trigger open |
| Feb 24, approved | Grants Manager | `wmkf_phaseistatus` + `akoya_requeststatus` | `Invited` (100000003) + `Phase II Pending` | Decided 2026-10-28 (D35, D39) |
| Feb 24, not approved | Grants Manager | `wmkf_phaseistatus` + `akoya_requeststatus` | `Not Invited` (100000002) + decline status (D32) | Phase I value decided 2026-10-28 (D39); request status value not recorded (D32) |
| Mar 25 offramp | Staff (formal); apps (display log) | Not recorded | Not recorded | Decided 2026-10-28 (D36); field open |
| Oral-presentation invite | Not decided | `wmkf_phaseiistatus` | Tentative: `Phase II Pending Committee Review` (100000002); there is no `Invited` option | Open |
| May 12–13 ranking | Apps read | `akoya_requeststatus` + `akoya_programid` | `Phase II Pending` + an MR or S&E program | Carries over only if the Feb 24 mapping and C5 hold |
| Jun 9–10 Board | Not recorded here | `akoya_requeststatus` | Board decision | Decided semantics; who sets it not recorded |
