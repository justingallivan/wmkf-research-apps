---
name: project-executor-thinking-budget-truncation
description: Opus 5 / Sonnet 5 / Fable think by default and spend max_tokens on reasoning; a prompt row budget sized for answer text (IA 2,200) stops on max_tokens with ZERO text. Advisory floor 4,096 + content-free block census landed 2026-09-18; a tier-alias advance or model-only republish is the usual trigger.
status: active
metadata:
  type: project
---

## Recall Rule

Read this when an Executor run fails `claude_output_truncated` with empty retained
text, when publishing a prompt whose model alias resolves to Opus 5 / Sonnet 5 /
Fable, when advancing a tier fallback in `model-resolver.js`, or when reviewing any
prompt row with `wmkf_ai_maxtokens` below 4,096.

## The fact

- Thinking tokens are billed as output and count inside `max_tokens` (Anthropic Opus 5
  release notes). Under default `display: "omitted"`, thinking blocks arrive with empty
  text, so an exhausted budget looks like "2,200 output tokens, no answer".
- The Executor sends no `thinking`/`effort`; behaviour is whatever the resolved model
  defaults to. Opus 4.6–4.8 default OFF; Opus 5, Sonnet 5, Fable default ON.
- Model changes reach prompts without a budget review: admin publish clones
  `wmkf_ai_maxtokens`, tier aliases move with the live model list, and only listed
  prompts have standing budgets.

## Evidence (2026-09-18, read-only Dataverse)

IA v2 = v1 with only `sonnet`→`opus` changed (published 2026-08-19, never run until
the rehearsal). v1 runs on Sonnet 5 used 886–992 output tokens; the Opus 5 run hit
2,200 with `sha256("")`. Eight live prompts run below 4,096 on thinking-default
models and some succeed, so the guard is advisory, not a pre-call block (owner
decision 2026-09-18).

## How to apply

Triage from `wmkf_ai_notes` (`truncatedBeforeText`, `blocks=`, `thinkingTokens=`,
`thinkingBudget=below_floor`). Fix by raising the budget or lowering effort, never by
retrying the same budget. Pair any prompt republish with the producer's pinned
`promptVersion` (see `INITIAL_ASSESSMENT_CONTRACT`). Full runbook:
`docs/agent-wiki/topics/prompt-executor.md` § Hazard: thinking-default models.
Related: [[project-prompt-governance]], [[project-prompt-storage-strategy]].
