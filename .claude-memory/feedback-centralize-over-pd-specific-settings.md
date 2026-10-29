---
name: feedback-centralize-over-pd-specific-settings
description: Owner direction (2026-10-24, refined 2026-10-27 D9) — reviewer anchor dates are central; PDs may adjust only response period and quota over central defaults.
metadata:
  type: feedback
  status: active
  scope: reviewer-campaign-settings
  last_verified: 2026-10-28 (S647)
---

## Recall Rule
Read before adding or extending any per-request or per-PD setting for reviewer campaigns (deadlines, respond-by days, reviewer quota, invitation defaults) or similar workflow parameters.

Do: resolve the value from one central, cycle-level source maintained by the calendar authority (Grants Manager role by default, Program Coordinator may also edit; see `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` D1/D4/D7/D8/D9). Since 2026-10-28 (D43) the central home for cycle dates is the operations `wmkf_grantcycle` table, edited from the apps' Admin calendar (`docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md`), not `wmkf_appgrantcycle`. Under D9 (owner, 2026-10-27), anchor dates such as the review deadline are central only; the response period and reviewer quota are central defaults a PD may change (response period per proposal and per invitation, quota per proposal). Keep one reviewer's due-date extension as an explicit PD action.
Do not: add per-proposal overrides of anchor dates, or add PD-facing settings beyond the D9 set without asking. Do not rebuild the `CampaignConfigModal` pattern: the D9 PD controls must be much simpler, and their design goes through Impeccable before it is built (owner, 2026-10-27).
Not in scope: email wording. Per-user email customization layered over centrally seeded Admin defaults is the intended design (owner, 2026-10-24; personal email defaults slices 2–3). Do not centralize or remove personal wording under this rule.

**Why:** owner, 2026-10-24: "I want to move as much of this to be centrally handled as possible. The PD-specific campaign settings were a clunky distraction."

**How to apply:** when planning rollover plan Slice 1 or any reviewer-default work, design for central cycle values first; ask before keeping a per-request override. Related: [[feedback-minimize-per-cycle-configuration]], [[feedback-owner-review-burden-must-shrink]].
