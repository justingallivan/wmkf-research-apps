---
name: feedback-factory-safe-not-full-fidelity
description: Owner principle (2026-09-26, S544) for the Test Request Factory — rarely used, testing only; be safe, but do not chase full fidelity with production request creation (e.g. keep the stub wmkf_ai_run, app user as actor)
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read before weighing a Factory review finding whose fix is "make the clone's records indistinguishable from a real request's history" (provenance, authorship, audit rows, lineage fidelity).

Do: keep safety findings (writes outside the sandbox, email, tokens, production data, fail-closed recovery) at full weight. Treat fidelity findings (a stub AI run, the app user recorded as actor, a clone that doesn't mimic every production step) as acceptable by default; record them as accepted limits.
Do not: change app contracts or add reader exclusions just so a test clone's audit trail looks genuine.

Owner, 2026-09-26 (Session 544), on Codex's "synthetic fixtures falsify audit provenance" finding (the recipe-4 stub `wmkf_ai_run`, surfaced by `scripts/query-ai-runs.js`): "keep the stub. It's important to keep in mind that this is not going to be used very often and only for testing. While I want to be safe, it's less critical to mimic absolutely every aspect of the production creation of requests."

**Why:** the Factory is an occasional, admin-only test tool; fidelity work costs app-contract changes for little benefit.

**How to apply:** in Factory plan and slice reviews, split findings into safety versus fidelity before deciding. See `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` *Recipes 3–5 plan* and [[feedback-weigh-the-risks-you-name]].
