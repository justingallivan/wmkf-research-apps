---
agent_wiki: topic
status: active
last_verified: 2026-06-24
stale_after_days: 90
owner: ai-platform
source_files:
  - lib/services/llm-client.js
  - lib/services/execute-prompt.js
  - lib/services/reviewer-prompt-resolver.js
  - lib/services/reviewer-prompt-composer.js
  - lib/services/prompt-store.js
canonical_docs:
  - docs/EXECUTOR_CONTRACT.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - lib/services/llm-client.js
  - lib/services/execute-prompt.js
  - lib/services/*prompt*.js
  - shared/config/prompts/**
  - docs/EXECUTOR_CONTRACT.md
update_triggers:
  - prompt storage or composition changes
  - shared Executor contract changes
  - provider/model routing changes
---

# Prompt & Executor

Use this page for prompt storage, runtime prompt resolution/composition, shared
Executor behavior, LLM provider calls, PDF/document processing tiers, and the
reviewer-finder prompt migration.

## Ground Rules

- Use `lib/services/llm-client.js` for provider calls.
- Use `lib/services/execute-prompt.js` for shared Executor behavior.
- Prompt claims must trace resolver, composer, runtime caller, fallback behavior, and tests.
- **requestId trust-boundary chokepoint:** `executePrompt` interpolates `requestId` into a raw
  Dataverse key predicate via `grantRequestAdapter.getById/updateById` → `akoya_requests(${id})`.
  It rejects a non-GUID `requestId` up front (`isGuid`), so a route forwarding a client id without
  its own guard (the `summarize-v2` class) cannot reach the selector. `check:trust-boundary-guid`
  treats `executePrompt({ requestId })` as an object-arg sink, so route-edge validation is still
  required and enforced in CI; this is defense-in-depth, not a replacement.
- **Route-owned A7 when passing pre-wrapped text (S344):** `applyVariableBoundaries` only
  wraps + emits a nonce for a variable declared `untrusted:true` + `dataClass`/`maxChars`, and
  `composeMessages` only injects the `buildUntrustedContentPreamble` when `untrustedNonces>0`.
  So if a route pre-wraps untrusted content itself (e.g. `process-peer-reviews.js` keeps N
  per-review nonces) and passes it as a plain override, the Executor adds NO preamble — the
  route MUST supply the preamble as its own variable interpolated into the row (peer-review
  puts it in the system prompt via `{{a7_preamble}}`), and that variable must be seeded
  `required:true`/no-default so an omission fails closed instead of silently dropping A7. See
  `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`.
- **Model-aware request building (S286):** `llm-client._buildBody` OMITS the `temperature`
  param for models that reject it (Opus 4.8 — the API 400s with "`temperature` is
  deprecated for this model"); `modelSupportsTemperature()` gates it. When adding an
  app on a reasoning-tier model, confirm whether `temperature` is accepted.

## Durable Memory

- Prompt storage and Dataverse ground truth: `project-prompt-storage-strategy`, `project-dynamics-as-prompt-ground-truth`.
- PDF/document processing: `project-pdf-processing-tiers`.
- Reviewer prompt migration: `project-reviewer-prompt-dataverse-migration`.
- Prompt injection/security: `project-a7-prompt-injection-hardening`.

## Standard Probe

```bash
rg -n "executePrompt|llm-client|prompt-store|PromptResolver|PromptComposer|fallback" lib shared pages tests docs
```
