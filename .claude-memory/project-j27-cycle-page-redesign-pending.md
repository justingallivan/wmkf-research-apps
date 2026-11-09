---
name: project-j27-cycle-page-redesign-pending
description: "Owner wants the cycle-level Workbench page reorganized by the request page's J27 phases (Research-only) and a user-flow audit before that plan is final; decided 2026-11-09, plan not yet written"
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

**How to apply:** plan before building; owner reviews the plan; log the decision in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`. Related: [[project-workbench-is-research-only]], [[feedback-anchor-multisession-features-to-the-original-ask]].
