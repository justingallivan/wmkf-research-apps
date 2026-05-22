---
name: Dynamics as staff-prompt ground truth
description: Architectural direction — most staff-facing prompts should live in wmkf_ai_prompt as ground truth, even when invoked from user-driven apps
type: project
originSessionId: e2e4c03f-8046-4d90-a1fd-93c1bb8256d1
---
**Principle (Justin 2026-04-25):** the `wmkf_ai_prompt` Dynamics table should hold most — eventually all — *staff-facing* prompts as ground truth. A prompt is "staff-facing" when a non-technical staff member could meaningfully read or edit the content (tone, length, audience, topical instructions) without dealing with mechanics (variable wiring, JSON schemas, dataflow).

A user can run with their own customized variant — the Executor already supports `overrideVariables`, and Phase 2 will add `overridePromptBody` for full per-session text edits. But the row in Dynamics is the canonical version everyone sees in their inspector; overrides are session-local diffs, not parallel sources of truth.

**Why:** discoverability. If prompts are scattered across `.js` files in the repo, only Justin can find them. If they're in one Dataverse table, any staff member with read access can browse what we're asking Claude to do across all apps. That changes who can have an opinion about prompt content.

**How to apply:**
- New prompts default to `wmkf_ai_prompt`, not `.js`. The `.js` modules in `shared/config/prompts/` should be considered legacy / fallback only.
- When a user-driven app gets touched for any other reason, consider migrating its prompt(s) to Dynamics if the migration is small (single-output, no Executor extensions needed).
- Migrations that need Executor extensions (multi-PATCH coalescing, native PDF, Picklist target output) wait for those extensions to land — don't force-fit. Grant Reporting and Expertise Finder fall in this bucket.
- Truly internal/plumbing prompts (e.g., contact enrichment, email personalization) can stay in `.js` indefinitely — they're not staff-facing and Justin is the only person who'd ever read them.
- Naming: keep the `<domain>.<purpose>` convention (`phase-i.summary`, `phase-ii.summary`, `peer-review.summary`, `grant-report.extract`).
