---
name: project-j27-cycle-page-rules
description: "J27 Workbench cycle and request page rules that still bind (Research, 2027-or-later cycles): tab set, retired First Cut/Semi-finalist wording, what Initial Assessment means, row standing rules. Redesign chronology is in project-j27-cycle-page-redesign-history."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-11-20 via WorkbenchViewsNav.js, shared/config/j27Labels.js, pages/api/workbench/scoring.js
---

## Recall Rule
Read before touching the Workbench cycle-level tabs (`shared/components/workbench/WorkbenchViewsNav.js`) or starting a J27 session.

**Current shape [VERIFIED 2026-11-20 via `shared/components/workbench/WorkbenchViewsNav.js`]:** 2027-or-later Research cycles use `J27_VIEWS` (All requests, the four request-page phases, then Awardees); earlier cycles and other programs keep the legacy `VIEWS` tabs. Release state and rollback (`WORKBENCH_PHASE_RELEASE`, `workbench.phase_rollout` via `scripts/set-workbench-phase-rollout.mjs`) live in `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md`; plans in `docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md` and `..._BUILD_PLAN_2026-11-09.md`. Not restated here.

**What "Initial Assessment" means (owner, 2026-11-09):** the Word document was a previous-cycle placeholder for the move to single-phase submission; that role is done. The phrase now covers the material AI generates automatically at submission (triggered by Power Automate). Do not plan J27 surfaces around the old document list.

**Terminology (owner, 2026-11-09):** "First Cut" and "Semi-finalist" are retired in staff-facing text and code. Use the Dataverse choice names (Scored, Not Scored, Recommended Invite, Recommended Do Not Invite, Invited, Not Invited); the stage strip shows "Recommended to Chairs" and "Not Recommended"; steps are "Scoring" and "Recommendation to Chairs" (`shared/config/j27Labels.js`). Internal names follow staff-facing ones (route `/api/workbench/scoring`, `CHAIRS_RECOMMENDATION_*` constants). Exception: Dataverse column names and their labels in `shared/config/cycleCalendar.js` (`wmkf_research...semifinalist...`) keep the old word; do not treat them as regressions.

**Row rules (owner, 2026-11-09):** a row has identity and standing; the chip is the request's standing, not its phase. The reviewer progress bar appears only on the Peer Review tab. A waiting request shows a quiet status line with no role named ("Awaiting the Chairs' outcome"); a request past Peer Review with a review outstanding says so in words ("1 review outstanding"). A Phase I status the stage model does not map is treated as closed; "Show closed" defaults to off. Mock-ups must show a real moment in the cycle (mid-January, April), since requests in every phase never coexist.

**Open items:** "Some details could not be read." appears often and should be fixed properly, not only collapsed to one line. Coordinator support in the Workbench is deferred (the Program Coordinator works mainly in Meeting Tracker). What is shared before a presentation is undecided. Attendance is untested until a real request has a presentation.

Do: change cycle-page tabs through a plan the owner reviews, and log the decision in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`.
Do not: reintroduce "First Cut" or "Semi-finalist", or plan J27 surfaces around the old Initial Assessment document.

Related: [[project-j27-cycle-page-redesign-history]], [[project-workbench-is-research-only]], [[feedback-anchor-multisession-features-to-the-original-ask]].
