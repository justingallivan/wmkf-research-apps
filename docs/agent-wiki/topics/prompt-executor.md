---
agent_wiki: topic
status: active
last_verified: 2026-08-29
stale_after_days: 90
owner: ai-platform
source_files:
  - lib/services/llm-client.js
  - lib/services/execute-prompt.js
  - lib/services/executor-budget-service.js
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
  - lib/services/executor-budget-service.js
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
  `required:true`/no-default so an omission fails closed. That alone is NOT enough — the row
  system prompt (`{{a7_preamble}}`) is staff-editable, so a bad /admin edit could drop the
  placeholder and send content with no preamble while a route-local check still passes. Pass
  `executePrompt({ assertSystemIncludes: [<nonces>] })`: the Executor throws AFTER composing and
  BEFORE the Claude call if the composed system prompt is missing any required substring, tying
  the guarantee to the real prompt, not caller inputs (S344, Codex-flagged). See
  `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`.
- **Model-aware request building (S286):** `llm-client._buildBody` OMITS the `temperature`
  param for models that reject it (Opus 4.8 — the API 400s with "`temperature` is
  deprecated for this model"); `modelSupportsTemperature()` gates it. When adding an
  app on a reasoning-tier model, confirm whether `temperature` is accepted.
- **Response completeness + structured output (2026-07-27):** the Executor
  preserves `LLMClient`'s joined text and stop metadata, then requires
  `stopReason=end_turn` before raw/JSON parsing or persistence. A syntactically
  valid `max_tokens` prefix is still rejected. Native Anthropic JSON schema is
  explicit per prompt (`generationMode:native-json-schema`), requires a declared
  `jsonSchema`, and fails closed unless the resolved concrete model has
  `supportsStructuredOutput:true`. Local `validationSchema` remains the
  post-parse write boundary. The Executor does not semantically retry; review
  synthesis is the current caller-owned exception, re-invoking once only for
  typed `claude_output_truncated`, with a separate AI-run audit attempt.
- **Server-owned output budgets (source-built S469, 2026-08-29; production
  publication open):** `lib/services/executor-budget-service.js` resolves the
  latest append-only Dataverse `wmkf_appsystemsettings` revision named
  `executor.budgets.vNNNNNN`. The Pre-Site caller reads its standing token /
  timeout pair; review synthesis reads its retry floor/ceiling only after a
  typed truncation. `/api/admin/executor-budgets` is superuser-only and
  publishes one complete immutable revision with expected-version,
  payload-bound UUID idempotency, resolved-model ceiling checks, and post-create
  verification of the exact created row. Settings reads page to completion;
  create races reread current state, and replay responses return current state
  plus the matching publication receipt. Governed prompt-model publication also
  checks the current durable budget before writing, including seed/recovery
  writers; the final Executor seam caps server-owned overrides to the resolved
  model ceiling to close cross-publication races. Review synthesis also supplies
  the first attempt's budget as a strict lower bound, so a capped retry aborts
  before the provider call unless its effective budget is larger.
  `shared/config/executorBudgets.js` now owns only the closed
  schema, code safety bounds, descriptions, and S466/S467 outage fallback
  (32 768 / 240 s and 16 000–32 000). Runtime request bodies never carry
  budget authority. Admin reads fail closed; runtime reads use the bounded
  fallback when settings are absent, unavailable, or malformed.

## Durable Memory

- Prompt storage and Dataverse ground truth: `project-prompt-storage-strategy`, `project-dynamics-as-prompt-ground-truth`.
- PDF/document processing: `project-pdf-processing-tiers`.
- Reviewer prompt migration: `project-reviewer-prompt-dataverse-migration`.
- Prompt injection/security: `project-a7-prompt-injection-hardening`.

## Standard Probe

```bash
rg -n "executePrompt|llm-client|prompt-store|PromptResolver|PromptComposer|fallback" lib shared pages tests docs
```
