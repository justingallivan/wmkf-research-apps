---
name: project-socal-writeup-workflow-parked
description: Southern California (SoCal) Final Writeup group-review workflow is parked by the owner (2026-10-07); do not design SoCal-specific handoff, email, or digest behavior until the owner raises it again.
metadata:
  node_type: memory
  type: project
  status: active
  scope: repo
  last_verified: 2026-10-07 via owner statements in Session 581 (parked; Stage 4 Research only)
---

## Recall Rule

Read this when: building group-review handoff Stage 4 (handoff email) or
Stage 5 (leadership digest), touching `final_writeup.matrix_audiences`
program entries, or proposing anything SoCal-specific for Final Writeups.

Owner, 2026-10-07: "I don't know the Southern California program workflow well
enough to design this now. Let's put SoCal on the back burner until I bring it
up again."

**Why:** the group-review handoff was designed around the Research program.
The owner hasn't worked out how SoCal writeups move, so any SoCal design now
would be guesswork.

**How to apply:**
- Do not propose or build SoCal-specific behavior. Do not raise it as a next
  step; wait for the owner.
- Stage 4 resolved (owner, 2026-10-07: "Research"): the handoff email is gated
  by the fail-closed `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` list, so the
  SoCal staffing entry alone sends nothing. Do not add SoCal to that list
  without the owner.
- Stage 5 (leadership digest) is still exposed: it would list SoCal writeups
  that reach leadership review. Ask the owner before Stage 5 ships.
- Stage 3 (sign-off view) already shows a SoCal request's PD list from that
  entry. It is display-only and was left as is.

Ground truth: `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`
(§3 decision B, Stage 4), `lib/services/final-writeup/matrix-audience-service.js`.
