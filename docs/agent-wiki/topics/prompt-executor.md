---
agent_wiki: topic
status: active
last_verified: 2026-06-13
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

## Durable Memory

- Prompt storage and Dataverse ground truth: `project-prompt-storage-strategy`, `project-dynamics-as-prompt-ground-truth`.
- PDF/document processing: `project-pdf-processing-tiers`.
- Reviewer prompt migration: `project-reviewer-prompt-dataverse-migration`.
- Prompt injection/security: `project-a7-prompt-injection-hardening`.

## Standard Probe

```bash
rg -n "executePrompt|llm-client|prompt-store|PromptResolver|PromptComposer|fallback" lib shared pages tests docs
```
