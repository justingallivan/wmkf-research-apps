---
name: feedback-centralize-over-pd-specific-settings
description: Owner direction (2026-10-24) — handle reviewer/cycle settings centrally; PD-specific per-request campaign settings were "a clunky distraction" and should not be extended.
metadata:
  type: feedback
  status: active
  scope: reviewer-campaign-settings
  last_verified: 2026-10-24 (S639)
---

## Recall Rule
Read before adding or extending any per-request or per-PD setting for reviewer campaigns (deadlines, respond-by days, reviewer quota, invitation defaults) or similar workflow parameters.

Do: resolve the value from one central, cycle-level source maintained by the calendar authority (Grants Manager role, Program Coordinator fallback; see `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` D1/D4). Keep individual-reviewer exceptions (e.g. one reviewer's deadline extension) as explicit PD actions.
Do not: add new PD-facing per-request configuration screens, or treat the existing `CampaignConfigModal` per-request values as the target design.
Not in scope: email wording. Per-user email customization layered over centrally seeded Admin defaults is the intended design (owner, 2026-10-24; personal email defaults slices 2–3). Do not centralize or remove personal wording under this rule.

**Why:** owner, 2026-10-24: "I want to move as much of this to be centrally handled as possible. The PD-specific campaign settings were a clunky distraction."

**How to apply:** when planning rollover plan Slice 1 or any reviewer-default work, design for central cycle values first; ask before keeping a per-request override. Related: [[feedback-minimize-per-cycle-configuration]], [[feedback-owner-review-burden-must-shrink]].
