---
name: Dynamics as staff-prompt ground truth
description: Architectural direction — most staff-facing prompts should live in wmkf_ai_prompt as ground truth, even when invoked from user-driven apps
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
status: active
scope: prompt
last_verified: 2026-07-27 via owner decision, docs/EXECUTOR_CONTRACT.md, and current prompt-resolution source
---

## Recall Rule

Read this when: creating a new staff-facing prompt, or deciding where a prompt should live (Dataverse `wmkf_ai_prompt` vs `.js`).

Do:
- Default new staff-facing prompts to `wmkf_ai_prompt`, not `.js`; treat `shared/config/prompts/*.js` as legacy/fallback.
- Keep the `<domain>.<purpose>` naming convention (e.g. `phase-i.summary`).
- Decide prompt storage separately from execution. A Dataverse-backed prompt may be consumed through the shared Executor or through an app-specific resolver/composer and LLM client; Expertise Finder's tool path uses the latter.
- When touching a user-driven app for any reason, consider moving staff-editable prompt content to Dataverse when the migration is small. That does not by itself require Executor adoption.

Do not:
- Force-fit every Dataverse-backed prompt into the Executor or imply that it already supports native PDF or Picklist output.
- Move truly internal/plumbing prompts (contact enrichment, email personalization) — they can stay in `.js` indefinitely.

Ground truth: architectural direction (Justin, 2026-04-25); `docs/EXECUTOR_CONTRACT.md`, entity `wmkf_ai_prompt`. Durable principle, not a live-state claim. See [[project-prompt-storage-strategy]].

**Principle (Justin 2026-04-25):** the `wmkf_ai_prompt` Dynamics table should hold most — eventually all — *staff-facing* prompts as ground truth. A prompt is "staff-facing" when a non-technical staff member could meaningfully read or edit the content (tone, length, audience, topical instructions) without dealing with mechanics (variable wiring, JSON schemas, dataflow).

A user can run with their own customized variant — the Executor supports `overrideVariables`. Full per-session prompt-body edits through `overridePromptBody` remain a Phase 2 proposal and are not built. The row in Dynamics is the canonical version everyone sees in their inspector; supported overrides are session-local diffs, not parallel sources of truth.

**Why:** discoverability. If prompts are scattered across `.js` files in the repo, only Justin can find them. If they're in one Dataverse table, any staff member with read access can browse what we're asking Claude to do across all apps. That changes who can have an opinion about prompt content.

**How to apply:**
- New prompts default to `wmkf_ai_prompt`, not `.js`. The `.js` modules in `shared/config/prompts/` should be considered legacy / fallback only.
- When a user-driven app gets touched for any other reason, consider moving staff-editable prompt content to Dynamics if the storage change is small. Choose the execution path separately from the storage location.
- Expertise Finder's tool-app prompt rows are already read from Dataverse through `tool-prompt-resolver.js`; the apps retain their own `LLMClient` calls and do not thereby become Executor consumers. See `docs/agent-wiki/topics/prompt-executor.md` for that current seam. Grant Reporting remains subject to its own owner and contract decisions; this principle does not require retrofitting it.
- Truly internal/plumbing prompts (e.g., contact enrichment, email personalization) can stay in `.js` indefinitely — they're not staff-facing and Justin is the only person who'd ever read them.
- Naming: keep the `<domain>.<purpose>` convention (`phase-i.summary`, `phase-ii.summary`, `peer-review.summary`, `grant-report.extract`).
