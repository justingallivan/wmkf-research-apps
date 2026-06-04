---
name: App roadmap (post-Phase-0, 2026-04-25)
description: Per-app status, deprecation, and trigger-pattern notes from Justin's 2026-04-25 framing
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
status: stale
scope: strategy
last_verified: S166 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: planning per-app roadmap direction, deprecation, or backend-trigger (dual-caller) evolution from the 2026-04-25 framing.

Do:
- Treat several "user-driven" apps (Grant Reporting, Integrity Screener) as dual-caller-in-waiting that gain PA triggers once Executor extensions land.
- Give Reviewer Finder its own architectural look (agent-loop / `executeAgent()`), not a force-fit into `executePrompt()`.

Do not:
- Resurrect Concept Evaluator — it's DEPRECATED and archived to `_archived/`.
- Treat this as live status — it's a 2026-04-25 snapshot; cross-check current state (Reviewer work has since become the Request Workbench).

Ground truth: historical snapshot (Justin 2026-04-25, doc tail reconciled S166); for current direction see [[project-reviewer-apps-redesign-direction]], [[project-phase-i-summary-app-winddown]], `docs/SYSTEM_MODEL.md`.

Strategic notes per app (Justin 2026-04-25), affecting Session 111+ planning:

- **Concept Evaluator** — **DEPRECATED.** Removed from `appRegistry.js` (residual deprecation comment at line 12 only). Page + API archived to `_archived/pages/concept-evaluator.js` and `_archived/pages/api/evaluate-concepts.js`. **Doc tail reconciled S166** — `docs/SYSTEM_OVERVIEW.md`, `docs/AI_PROMPTS_DETAILED.md`, `docs/AI_PROMPTS_OVERVIEW.md`, and `docs/PDF_EXPORT.md` now carry retirement labels/banners; retained references are historical/reference only.

- **Grant Reporting** — should grow a **PowerAutomate trigger**: PA fires when a grant report arrives in Dynamics → auto-runs the extraction → writes to Dynamics. The user-driven UI persists for review/edit. This makes Grant Reporting a **dual-caller** app (Pattern A in PROMPT_STORAGE_DESIGN). Prompt-row migration to `wmkf_ai_prompt` becomes part of this pattern, not standalone. Needs Executor extensions (multi-PATCH coalescing + native PDF input) before migration.

- **Integrity Screener** — same dual-caller pattern. Becomes a **secondary compliance checker** triggered automatically before an application is advanced ("before we advance an application we are interested in, trigger it on the backend and get a report"). The user-driven UI persists. Same Executor-extension dependencies as Grant Reporting plus the integrity-DB lookup logic.

- **Reviewer Finder** — most complicated app. **Needed soon after May 1 deadline.** Top post-cycle priority. Will likely require tool-use / agent-loop support that's currently out of contract scope (Executor `Out of scope` list explicitly excludes tool-use loops). May get a different invocation path — like a separate `executeAgent()` companion service — rather than fitting into `executePrompt()`. Don't try to force-fit.

- **Phase II Writeup / Q&A** — high-touch, expert-driven, late-cycle. Stays as-is for May 1. Single-output summary migration (`phase-ii.summary`) is a clean Phase 0 move that doesn't disrupt Q&A; mirrors what we did for Phase I.

- **Peer Review Summarizer** — single-output. Easy migration when it comes up.

- **Phase I summary app** — winding down post-May-2026 (see `project-phase-i-summary-app-winddown.md`).

**Why this matters now:**
- Several apps that look "user-driven" today are actually **dual-caller in waiting** — they want a backend-triggered version once the Executor extensions land. The Executor design (Pattern A: same prompt row, two callers) supports this directly.
- The post-cycle Executor work (multi-PATCH coalescing, native PDF, Picklist target) unblocks both Grant Reporting and Integrity Screener PA triggers in one extension cycle.
- Reviewer Finder needs its own architectural look — agent-loop support — not just contract extensions.
