---
name: feedback-minimize-per-cycle-configuration
description: Owner rule (2026-10-06) — features must not need human "care and feeding" each grant cycle; derive cycle scope from the record or the J/D calendar, and make anything left loud when stale.
metadata:
  type: feedback
  status: active
  scope: cycle-scoped-config
  last_verified: 2026-10-06 (S579)
---

## Recall Rule
Read before adding any setting, allowlist, literal, or schedule that names a grant cycle (`J27`, `D26`), a cycle-specific date, or a per-cycle request/program list.

Do: derive cycle scope from data of record (meeting date → cycle, request status, triage field, presentation events) or from the J/D calendar (`lib/utils/cycle-code.js` helpers). If a human decision is unavoidable, put it where a twice-yearly confirmation and a drift check will surface it, and default to rolling the previous cycle's value forward.
Do not: add a per-cycle env allowlist or a hard-coded cycle code as the steady-state design; if one is needed for a pilot, record its rollover reminder in `docs/CURRENT_WORK_QUEUE.md` the same session.

**Why:** cycle-scoped settings fail silently. Staff Deliberations preparation shipped with `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26"]`; forgetting `J27` would not error — J27 requests would just quietly fall back to manual work. The owner's analogy: like daylight saving, the change should happen automatically or via a reminder email, never by memory.

**How to apply:** treat a new cycle allowlist as a pilot gate with an expiry, not a design. The investigation and seed inventory live in `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`. Related: [[feedback-mutable-parameters-not-in-code]], [[feedback-corrections-decay-unless-mechanized]].
