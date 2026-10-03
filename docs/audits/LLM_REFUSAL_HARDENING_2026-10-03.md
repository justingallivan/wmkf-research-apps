---
title: LLM refusal handling and Explorer history hardening
domain: ai-runtime
kind: report
status: active
summary: "Consumer refusal guards and signed-history preservation prepared on a branch; Sonnet 5.5 remains excluded pending separate admission."
canonical: false
owner: product-engineering
related:
  - docs/audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md
  - lib/utils/llm-response.js
  - lib/services/dynamics-explorer/conversation.js
---

# Refusal and history hardening — October 3, 2026

[VERIFIED via branch source and tests] Follow-up implementation for the two
Sonnet review blockers. No model registration, automatic-selection change,
provider inference, production mutation or promotion is included.

## Invariants and behavior

| Invariant | Implementation | Verification |
|---|---|---|
| A provider refusal cannot become formatted text, parsed JSON or a saved match | `requireAcceptedLlmResponse` checks either normalized refusal signal before legacy consumers drop metadata | Empty and nonempty refusal tests at utility, refinement, QA, summary/writeup, grant and expertise boundaries |
| Refusal does not trigger another model | Expertise/grant fallback catches rethrow; multi-perspective rejects rather than retrying | One-call assertions with fallback available; perspective fan-out cannot reach integration |
| Refusal on secondary extraction cannot silently become ordinary success | Structured fallback catches preserve typed refusal; per-file error results remain explicit | Each summary/writeup route refuses on call 1 and call 2 |
| Shared wrapper stays lossless | LLMClient response contract unchanged; Executor/Explorer own their existing terminal policy | No shared-wrapper implementation edit |
| Signed thinking history stays append-only within Explorer's tool loop | Compaction returns original history for thinking or redacted_thinking; ordinary history still compacts | Three actual mocked model rounds preserve earlier system/tools/messages; both block types covered |

The guard is applied to refine, QA, Phase I/II summarization, Phase I writeup,
funding analysis, literature analysis, multi-perspective evaluation, individual
and batch expertise matching, and grant extraction. It returns ordinary responses
unchanged; it does not treat truncation or pause as refusal, enforce complete JSON,
or replace each consumer's existing validation.

Refine responds with 422 and a stable refusal code. QA emits an error event and
never ordinary completion; its existing UI error handler replaces any streamed
partial text. Batch routes retain explicit failed items; literature retains
explicit failed stages. Multi-perspective waits for the already-dispatched
perspectives but stops integration if any refused. No automatic refusal retry was
added. No provider response content is included in the typed error.

## Contract reconciliation

Entry: staff API/service → existing LLMClient → normalized result → consumer guard
→ parser/formatter/persistence. Persistence is unchanged: successful expertise
matches and grant audit writes retain existing paths; refusal is rejected before
usable output/persistence. Grant failure audits may still record the failed
attempt. Partial-batch and stream terminal behavior remain explicit. No new async
state, schema, status enum, route, prompt or environment setting was introduced.

The Explorer guard concerns server-owned rounds within a single request, where
system and tools are fixed. It does not establish safe replay of arbitrary
externally supplied signed history, or eliminate context-window limits. Preserving
history can use more input tokens than compaction; the existing 15-round and
per-tool result bounds remain. Automatic Sonnet admission is still a separate
review/replay/release decision.

## Verification and review

- Initial affected consumer run: 10 suites / 82 tests passed, one snapshot.
- Added full multi-perspective and Explorer model-boundary checks: 2 suites / 23
  tests passed, including an overlapping Explorer suite. Do not add these counts.
- Thirteen scoped gates/self-tests passed sequentially: types, API routes,
  prompt injection tagging, model registry, override warming, route service
  boundary and secret scan. Changed runtime-file ESLint passed with no output.
- Fresh read-only independent review found no material remaining issue in the
  hardening diff. Reviewer traced inner fallback catches, fan-out, partial batch
  results and QA rendering. No paid provider call was used.
- Disconfirming cases include valid-looking refusal text, second-call refusal,
  fallback availability, and three tool rounds containing actual thinking blocks.
  Ordinary history compaction and successful existing route fixtures still pass.

Release tier: runtime branch/PR with deliberate owner promotion. No deployment or
live Sonnet behavior is claimed. Rollback is a code revert; no data migration.
