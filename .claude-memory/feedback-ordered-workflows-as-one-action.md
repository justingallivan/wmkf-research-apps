---
name: feedback-ordered-workflows-as-one-action
description: When a staff/admin workflow only works in one order (e.g. Factory J27 Phase I Invited → Phase II → readiness), ship it as one guided, resumable action with per-step progress — not a general-purpose editor plus a greyed-out button the user must decode; the owner called the multi-control version "very confusing" and nearly stranded a test request.
metadata:
  type: feedback
  status: active
  scope: admin-and-staff-ui
  last_verified: 2026-11-15 — owner production use of the Test Request Factory status panel
---

## Recall Rule
Read before adding an action whose server preconditions depend on earlier
actions happening in a specific order, or before exposing generic edit
controls as the way to reach one standard end state.

## What happened (2026-11-15)
The Factory's first web readiness step was a "Mark ready for review" button
beside the general Phase I / Phase II status menus. Readiness needed Phase I
Invited and Phase II Pending Committee Review, and Invited is allowed only
while Phase II is empty. The owner set Phase I to the wrong value first and
saw only a greyed button with a generic reason; the request nearly became
unrecoverable from the form. The owner: "This is very confusing."
Replaced the same day by one **Prepare for review** action (ordered steps,
single confirm, stop on any non-complete answer, Continue resumes the same
open change) with the generic menus under "More options"
(`shared/components/admin/TestRequestPrepareForReview.js`).

**Why:** the owner and colleagues (Connor) use these tools occasionally; they
should not need to know the server's ordering rules.

**How to apply:** when the end state is standard, build the guided action
first and keep generic controls as a collapsed escape hatch. A state the guided
action cannot recover from gets one plain sentence saying what to do, not a
disabled button. Related: [[feedback-ui-gates-must-mirror-server-guards]],
[[feedback-owner-review-burden-must-shrink]].
