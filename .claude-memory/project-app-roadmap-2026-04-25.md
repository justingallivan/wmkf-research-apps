---
name: App roadmap (post-Phase-0, 2026-04-25)
description: Historical per-app strategy snapshot from Justin's 2026-04-25 framing; not current roadmap or implementation guidance
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
status: stale
scope: strategy
last_verified: S166 via memory-content (not re-probed 2026-06-04)
---

## Historical scope

This is a dated record of Justin's 2026-04-25 framing, not a current roadmap, status source,
or implementation sequence. Its proposals below preserve historical context only. For
current direction, consult [[project-reviewer-apps-redesign-direction]],
[[project-phase-i-summary-app-winddown]], and `docs/SYSTEM_MODEL.md`; source and live-state
evidence govern implementation claims.

Strategic notes per app (Justin's 2026-04-25 proposals):

- **Concept Evaluator** — the 2026-04-25 record described it as deprecated, with its page and API archived and documentation references labeled historical by S166. This is retained as a dated status claim.

- **Grant Reporting** — the proposal was a **PowerAutomate trigger** when a report arrives in Dynamics, with extraction written back to Dynamics and the user-driven UI retained for review/edit. The note described this as a future **dual-caller** app (Pattern A in PROMPT_STORAGE_DESIGN), with prompt-row migration to `wmkf_ai_prompt` and Executor extensions (multi-PATCH coalescing + native PDF input) as dependencies. This proposal does not establish current status or sequencing.

- **Integrity Screener** — the proposal used the same dual-caller pattern, with an automatic secondary compliance check before an application advanced and the user-driven UI retained. It listed the same Executor-extension dependencies as Grant Reporting plus integrity-DB lookup logic. This proposal does not establish current status or sequencing.

- **Reviewer Finder** — the 2026-04-25 note called it the most complicated app and proposed a separate architectural review after the May 1 deadline. It anticipated tool-use / agent-loop support outside the then-current Executor contract and considered a separate `executeAgent()` companion path. These are historical architectural hypotheses, not current design instructions.

- **Phase II Writeup / Q&A** — the 2026-04-25 framing treated it as high-touch, expert-driven, and late-cycle; it proposed leaving it unchanged for May 1 and described a single-output `phase-ii.summary` migration as a possible Phase 0 move.

- **Peer Review Summarizer** — the note described it as single-output and an easy candidate for a later migration.

- **Phase I summary app** — the note anticipated a post-May-2026 wind-down (see `project-phase-i-summary-app-winddown.md`).

## Historical rationale (2026-04-25)

At the time, the author viewed Grant Reporting and Integrity Screener as potential dual-caller
apps, believed planned Executor extensions could support their PowerAutomate triggers, and
expected Reviewer Finder to need an agent-loop review. Those expectations are preserved as
provenance for later planning; they do not describe present dependencies or authorize work.
