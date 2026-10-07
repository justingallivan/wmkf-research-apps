---
name: project-socal-writeup-workflow-parked
description: Southern California (SoCal) Final Writeup group-review workflow is parked by the owner (2026-10-07); do not design SoCal-specific handoff, email, or digest behavior until the owner raises it again.
metadata:
  node_type: memory
  type: project
  status: active
  scope: repo
  last_verified: 2026-10-07 via owner statement in Session 581
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
- Hazard for Stage 4 and 5: decision B derives recipients from the staffing
  setting's program entries with no allowlist. The service catalog records a
  six-person SoCal audience published 2026-09-01 (not live-read). If that entry
  is still published, SoCal requests would get the handoff email. Surface this
  to the owner before Stage 4 ships; do not silently include or exclude SoCal.
- Stage 3 (sign-off view) already shows a SoCal request's PD list from that
  entry. It is display-only and was left as is.

Ground truth: `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`
(§3 decision B, Stage 4), `lib/services/final-writeup/matrix-audience-service.js`.
