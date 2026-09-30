---
name: feedback-question-the-rehearsal-venue
description: "When a rehearsal venue's gaps (sandbox parity, missing users/prompts/automation) start dominating a slice's effort, stop and put the venue itself to the owner before patching another gap"
status: active
metadata:
  type: feedback
---

## Recall Rule

Read before building a workaround whose only purpose is to make a sandbox or
other rehearsal venue behave like production (Test Request Factory recipes,
sandbox-bound dependency builders, parity patches).

Do: when a second or third venue-only gap appears in one workstream, total up
how much of the recent effort was venue-specific versus production-relevant,
and put "is this venue still worth it?" to the owner before adding the next
workaround. Check the venue's fidelity directly (automation registrations,
background-processing mode, identity/role parity) instead of assuming parity.
Do not: keep hardening a venue by default because it was the plan's starting
point.

**Why:** Session 545 (2026-09-27). Recipe 5 hit a missing program director in
the sandbox, the latest of several sandbox-only gaps (stub AI run, seeded
prompt, GoVerify bypass). The owner asked: "what are we even accomplishing by
building in a sandbox… 90% of your effort is going to patch/harden an
environment where this won't even work most of the time?" The answer was to
stop sandbox live proofs after recipe 4. The follow-up probes then showed the
sandbox was even less faithful than assumed: background processing disabled,
different create workflows, no AkoyaGo plug-ins, an app user with System
Administrator where production's has none.

**How to apply:** see `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md`
and the agent-wiki Dataverse note on sandbox background processing. Related:
[[feedback-factory-safe-not-full-fidelity]], [[project-preview-rehearsal-venue-limits]].
