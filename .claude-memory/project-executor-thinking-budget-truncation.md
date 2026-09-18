---
name: project-executor-thinking-budget-truncation
description: Opus 5 / Sonnet 5 / Fable think by default and spend max_tokens on reasoning; a prompt row budget sized for answer text (IA 2,200) stops on max_tokens with ZERO text. Advisory floor 4,096 + content-free block census deployed to production 2026-09-18 via PR #314 (IA generation re-rehearsed PASS the same day: 1,065 output tokens, thinkingTokens=0); a tier-alias advance or model-only republish is the usual trigger.
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

## Ship state

**[DEPLOYED TO PRODUCTION 2026-09-18 via PR #314, merge `0b240f0a`, GitHub deployment 6534604317 success; IA generation re-rehearsed PASS 2026-09-18 23:38Z on request 1003222: run `7770d508` end_turn, out=1065, blocks=text:2971, thinkingTokens=0, maxTokens=12000; Ready row `7d00fffd` (prompt v2, 18,243-byte DOCX, SharePoint v1.0) is the current pointer, prior Ready `a6876ad6` superseded; exact retry reused the row with no new run]**
Production now records the new notes fields, the IA contract pins prompt version 2
(the live row), and `initial-assessment.generate` is a registered standing budget
(default 12,000 / 120 s; admin-tunable 4,096–32,000) that the IA facade passes as
`maxTokensOverride`, so the row's 2,200 no longer governs the call. The signed-in
production rehearsal on 1003222 passed the same evening (run `7770d508`: end_turn,
1,065 output tokens, `blocks=text:2971`, `thinkingTokens=0`), so Opus 5 did not
think on this input at all; the earlier 2,200-token burn was input-dependent, which
is exactly why the guard stays advisory. The stale Failed row `ea6e4768` remains as
historical evidence under a different generation key.

## How to apply

Triage from `wmkf_ai_notes` (`truncatedBeforeText`, `blocks=`, `thinkingTokens=`,
`thinkingBudget=below_floor`). Fix by raising the budget or lowering effort, never by
retrying the same budget. Pair any prompt republish with the producer's pinned
`promptVersion` (see `INITIAL_ASSESSMENT_CONTRACT`). Full runbook:
`docs/agent-wiki/topics/prompt-executor.md` § Hazard: thinking-default models.
Related: [[project-prompt-governance]], [[project-prompt-storage-strategy]].
