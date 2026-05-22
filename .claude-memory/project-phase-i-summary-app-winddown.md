---
name: Phase I summary app winddown
description: Strategic shift — user-facing Phase I summary app deprioritized; backend automation owns the future of this workflow
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
---
The user-facing `/phase-i-dynamics` summary app was originally a quick way to produce template-conforming summaries when the workflow was human-driven. Post-May-2026 cycle:

- **Cycle structure changes:** Phase I and Phase II are merging into a streamlined single-phase process for the cycle after May 2026
- **Templates change:** the Phase I summary template will change (length, format) and most applications will use AI-generated summaries instead of human writeups
- **Demand shifts:** user-facing summary apps see steeply reduced usage; backend automation owns the volume
- **High-touch user apps stay valuable:** review finder + Phase II apps (low-volume, late-cycle, expert-driven). These get robust ongoing investment.

**Why:** Justin's framing 2026-04-25 — backend-driven prompt automation will produce most summaries; UI app demand collapses for high-volume early-cycle work. Reviewer finder + Phase II tools remain because they're expert-driven late-cycle work.

**Important nuance (audit 2026-05-03):** the "winddown" is about strategic priority and UI investment, NOT a development freeze. The `/phase-i-dynamics` page and `/api/phase-i-dynamics/summarize{,-v2}` endpoints are still actively iterated — v2 uses the new PromptResolver, A/B comparison scripts (`scripts/compare-phase-i-v1-v2.js`, `scripts/ab-phase-i-prompts.js`) and prompt-size audit tooling (`scripts/audit-system-prompt-sizes.js`) reference it. Hidden from main nav by design (direct URL only); it's a prompt-development surface, not a deprecated app.

**How to apply:**
- Don't over-invest in `/phase-i-dynamics` UI features (forms, polish, dashboards). It works for May 2026; details of its prompt may change but driven by backend needs not user request.
- Backend automation owns volume; `/phase-i-dynamics` is the human-in-the-loop prompt-tuning surface.
- Future intake prompts (compliance, fit-assessment, keywords) are **backend-first** — author them as PA-triggered Executor calls, not as new user-facing routes.
- When weighing where to spend effort, prefer reviewer finder + Phase II apps + Executor/prompt-row infrastructure over new Phase I user routes.
- "Production ready by next cycle" includes the backend automation, not user-app polish.
- **User-driven apps that tie into Dynamics still get forward investment** (Justin's emphasis 2026-04-25). Reviewer finder, Phase II writeup/Q&A, Expertise Finder, Grant Reporting, Review Manager — these stay in active development. The winddown is specific to Phase-I-summary-as-a-user-task; not a general retreat from user-facing apps.
