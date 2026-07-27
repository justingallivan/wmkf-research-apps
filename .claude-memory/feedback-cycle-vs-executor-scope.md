---
name: Cycle gating vs. Executor scope — don't conflate
description: Session 113 owner framing: a grant-cycle constraint applied to work needing unavailable collaborators, while Executor scope depended on the actual automation contract rather than every AI-using app.
type: feedback
originSessionId: 223c47bb-55ef-4adb-bab2-c2616bfa5311
status: active
scope: strategy
last_verified: 2026-07-27 as historical Session 113 owner framing; current app scope must come from source and plans
---

## Recall Rule

Read this when: scoping/categorizing post-cycle work, or deciding whether an app belongs on the Executor track.

Do:
- Re-establish the current collaborator dependency from the live plan before
  calling work cycle-gated.
- Read the current Executor contract and the app's actual producers/consumers
  before assigning it to that track.

Do not:
- Treat a nearby cycle as a general code freeze.
- Infer Executor scope merely because an app calls an LLM.

Don't treat "cycle is N days out" as a general code freeze, and don't assume every Claude-using app belongs on the Executor track.

**Historical basis:** [VERIFIED via the Session 113 owner correction.] In that
session, the cycle mattered because Connor was unavailable for Power Automate,
permissions, and shared prompt-storage decisions. Reviewer Finder was then
user-facing with no automation plan, while Phase I summary and intake-check were
the named Executor-track examples. Those examples are not a current inventory.

**How to apply:**
- Identify the currently unavailable dependency, if any.
- Trace the current app's trigger, execution path, persistence, and consumer
  against `docs/EXECUTOR_CONTRACT.md`.
- If either fact is unknown, label the scope `[UNKNOWN]` and inspect current
  source/plans rather than inheriting the S113 examples.
