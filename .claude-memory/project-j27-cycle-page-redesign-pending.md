---
name: project-j27-cycle-page-redesign-pending
description: "Owner wants the cycle-level Workbench page reorganized by the request page's J27 phases (Research-only) and a user-flow audit before that plan is final; decided 2026-11-09; plan, audit, design brief and build plan written; All requests, Initial Assessment and Peer Review built on the J27 line, not promoted; Deliberations and Final Assessment lists still need their own plan"
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: 90b09a89-3fb2-4b7a-9bce-c5fb5d8ee6b4
  modified: 2026-11-09T21:01:47.288Z
---

## Recall Rule
Read before touching the Workbench cycle-level tabs (`shared/components/workbench/WorkbenchViewsNav.js`) or starting a J27 session.

**Decision (owner, 2026-11-09):** the six cycle-page tabs (Request list, Reviewer follow-up, Staff deliberations, Initial assessments, Final writeups, Awardees) accumulated by project since September and do not match the J27 workflow. Next session writes a plan that reorganizes the cycle page by the same phases the request page already has (Initial Assessment, Peer Review, Deliberations, Final Assessment, then Awardees), Research-only like the stage strip. Reviewer follow-up is the old Review Manager lifted into the shell (2026-09-01) and belongs inside Peer Review, not as a tab. The owner also asked for an audit of whether the J27 flows make sense to the staff using them, before the plan is finalized.

**Why:** the 2026-11-06 development brief redesigned only the request page; no J27 decision addressed the cycle page, and the owner found that out from a screenshot. Moving Initial assessments to the front of the row (commit 680252fe5 on `claude/j27-read-model`) is a stopgap.

**What "Initial Assessment" means (owner, 2026-11-09):** the Initial Assessment Word document was a previous-cycle placeholder to ease the move to single-phase submission; that role is done. The phrase now covers the material AI generates automatically at submission (triggered by Power Automate). Do not plan J27 surfaces around the old document list.

**Plan status:** draft at `docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md`. Owner decided 2026-11-09: tabs are All requests (first, and the opening view; successor to the Request list, also where staff look back for declined or triaged requests), the four phases, then Awardees. Rows show the request title between the number/institution line and the PI/PD line. The old Initial Assessment document list leaves the J27 cycle page; "Show closed" defaults to off; earlier cycles and other programs keep today's tabs. The staff flow audit (`docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md`) is in and the owner answered its questions: phases make sense; a request past Peer Review with a review outstanding says so on its row in words ("1 review outstanding"); the Program Coordinator works mainly in Meeting Tracker, so coordinator support in the Workbench is deferred. The two feed checks the plan assumed are done and recorded in the plan.

**Design brief (revision 2, owner reviewed a mock-up 2026-11-09):** `docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md`. The mock-up review reversed two earlier choices: the reviewer progress bar appears only on the Peer Review tab (on All requests it was on some rows and not others, and its red segment read as a problem on a finished request), and a waiting request shows a quiet status line such as "Awaiting the Chairs' outcome" with no role named (the Grants Manager records outcomes about the day of the Chairs' meeting, so the wait is short). The row has two parts, identity and standing; the chip is the request's standing, not its phase. Mock-ups must show a real moment in the cycle (mid-January, April), because requests in every phase do not coexist. The owner said the two-moment mock-up "looks much better".

**Built 2026-11-09 (owner go-ahead the same day), not promoted:** build plan `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` (three Codex reviews; section 7 records what was built). On `claude/j27-cycle-page`, and fast-forwarded into `claude/j27-read-model` so the sandbox-backed Preview carries it: tab row, All requests, Initial Assessment and Peer Review lists, tab counts. Deliberations and Final Assessment tabs mount the existing Staff deliberations and Final writeups panels; their own lists need a separate plan (build plan section 3a), because the request list cannot reproduce the request page's later-phase rules. Owner decisions for the rows: a Phase I status the stage model does not map is treated as closed; before its presentation a Deliberations row shows no next-step line at all (staff know to read the reports; what is shared before a presentation is undecided).

**Owner, 2026-11-09, after the Preview check:** "Some details could not be read." appears often and should be addressed properly, not only collapsed to one line; the wide gap between the request details and the status column can wait.

**Terminology (owner, 2026-11-09):** "First Cut" and "Semi-finalist" are retired, in staff-facing text and in code. Use the Dataverse choice names (Scored, Not Scored, Recommended Invite, Recommended Do Not Invite, Invited, Not Invited); the stage strip shows "Recommended to Chairs" and "Not Recommended"; the steps are "Scoring" and "Recommendation to Chairs" for now. The owner wants internal names kept in line with staff-facing ones rather than left as loose ends. Renamed on `claude/j27-read-model` (route `/api/workbench/scoring`, settings `J27_CHAIRS_RECOMMENDATION_*`); `main` and Production still carry the old names until that branch is promoted.

**Later phases built 2026-11-10 to 2026-11-11 (Session 673), not promoted:** the Deliberations and Final Assessment tabs are request lists from server-side later-phase facts (the j27-later-facts module, which exists only on that branch until it merges), and the request page uses the same facts for every viewer. Plan and review record: `docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` (section 6); alignment log D62 to D65 on the J27 line. Nothing was exercised live; the Preview had not been moved.

**How to apply:** plan before building; owner reviews the plan; log the decision in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`. Related: [[project-workbench-is-research-only]], [[feedback-anchor-multisession-features-to-the-original-ask]].
