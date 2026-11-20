---
name: Phase I summary app retirement
description: Phase I Dynamics and the four legacy upload apps are retired at their entry points; prompts, services, and stored outputs remain preserved.
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
status: active
scope: strategy
last_verified: 2026-11-19 via owner retirement decision and source inventory
---

# Phase I summary app — retirement boundary

[VERIFIED — owner direction, 2026-11-19] Retire `/phase-i-dynamics` alongside the
four former sunset-candidate PDF-upload apps. Source implementation and validation
are tracked in `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md`; this memory is not a
production deployment receipt.

The pages become retirement notices and the old processing APIs return
authenticated HTTP 410 responses. Original page/API implementations are retained
under `_archived/`. Preserve `phase-i.summary`, Phase I prompt modules, the
`lib/services/phase-i-dynamics/` services, Executor behavior, model configuration,
existing grants, and prior `wmkf_ai_summary`/AI-run records. A future backend
caller is a separately designed integration, not an existing replacement proved
by this retirement.

## Recall Rule

Read before working on Phase I summary UI, removing its prompts/services, or
planning backend adoption. Do not revive the retired pages for prompt development
without a new decision. Keep the `batch-phase-i-summaries` identity in historical
records; app retirement does not authorize purging access or usage history.

Historical rationale: on April 25 the owner prioritized backend-driven summaries
over investment in the human-driven Phase I summary UI. The streamlined single-phase
J27 process starts with the June 2027 cycle; D26 remains the last dual-phase cycle.
That strategy was not itself proof of deletion. The November 19 retirement is the
explicit later decision. Grant Reporting's future destination remains undecided;
see `project-grant-reporting-rework.md`.
