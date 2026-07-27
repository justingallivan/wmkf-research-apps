---
name: Phase I summary app winddown
description: Strategic shift — user-facing Phase I summary app deprioritized; backend automation owns the future of this workflow
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
status: active
scope: strategy
last_verified: 2026-07-27 via current page/routes/scripts and owner strategic direction
---

## Recall Rule

Read this when: deciding where to invest on `/phase-i-dynamics`, or weighing user-app polish vs backend automation for the Phase I summary workflow.

Do:
- Treat the winddown as strategic priority/UI-investment, not proof that the
  retained `/phase-i-dynamics` source is deleted.
- Put forward investment into current Dynamics-tied surfaces such as the
  Workbench, Expertise Finder, and Grant Reporting; verify `appRegistry` before
  naming an app current.
- Author future intake prompts (compliance, fit-assessment, keywords) backend-first as PA-triggered Executor calls.

Do not:
- Over-invest in `/phase-i-dynamics` UI features (forms, polish, dashboards) — it's a direct-URL prompt-dev surface, hidden from nav by design.
- Read "winddown" as a general retreat from user-facing apps — it's specific to Phase-I-summary-as-a-user-task.

Ground truth: `/phase-i-dynamics` page + `/api/phase-i-dynamics/summarize{,-v2}`, `scripts/compare-phase-i-v1-v2.js`, `scripts/ab-phase-i-prompts.js`, `scripts/audit-system-prompt-sizes.js`; Justin framing 2026-04-25, audit 2026-05-03.

The user-facing `/phase-i-dynamics` summary app was originally a quick way to produce template-conforming summaries when the workflow was human-driven. Post-May-2026 cycle:

- **Cycle structure changes:** Phase I and Phase II are merging into a streamlined single-phase process for the cycle after May 2026
- **Templates change:** the Phase I summary template will change (length, format) and most applications will use AI-generated summaries instead of human writeups
- **Demand shifts:** user-facing summary apps see steeply reduced usage; backend automation owns the volume
- **High-touch user apps stay valuable:** review finder + Phase II apps (low-volume, late-cycle, expert-driven). These get robust ongoing investment.

**Why:** Justin's framing 2026-04-25 — backend-driven prompt automation will produce most summaries; UI app demand collapses for high-volume early-cycle work. Reviewer finder + Phase II tools remain because they're expert-driven late-cycle work.

**Source boundary verified 2026-07-27:** `/phase-i-dynamics`,
`summarize{,-v2}`, Executor wiring, and A/B scripts remain in the repository,
while `appRegistry` does not present the page as an active app. That proves a
retained prompt-development/reference surface, not current usage or active
iteration.

**How to apply:**
- Don't over-invest in `/phase-i-dynamics` UI features (forms, polish, dashboards). It works for May 2026; details of its prompt may change but driven by backend needs not user request.
- Backend automation owns volume; `/phase-i-dynamics` is the human-in-the-loop prompt-tuning surface.
- Future intake prompts (compliance, fit-assessment, keywords) are **backend-first** — author them as PA-triggered Executor calls, not as new user-facing routes.
- When weighing where to spend effort, prefer reviewer finder + Phase II apps + Executor/prompt-row infrastructure over new Phase I user routes.
- "Production ready by next cycle" includes the backend automation, not user-app polish.
- **User-driven Dynamics apps remain strategically valuable** (Justin,
  2026-04-25), but the current names/statuses come from
  `shared/config/appRegistry.js` and its lifecycle registry. Do not resurrect
  retired standalone reviewer or Phase-II pages from this historical list.
