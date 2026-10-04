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
| In the enumerated guarded callers, a provider refusal cannot become formatted text, parsed JSON or a saved match | `requireAcceptedLlmResponse` checks either normalized refusal signal before legacy consumers drop metadata | Empty and nonempty refusal tests at utility, refinement, QA, summary/writeup, grant and expertise boundaries |
| Refusal does not trigger another model | Expertise/grant fallback catches rethrow; multi-perspective rejects rather than retrying | One-call assertions with fallback available; perspective fan-out cannot reach integration |
| Refusal on secondary extraction cannot silently become ordinary success | Structured fallback catches preserve typed refusal; per-file error results remain explicit | Each summary/writeup route refuses on call 1 and call 2 |
| Shared wrapper stays lossless | LLMClient response contract unchanged; Executor and Explorer chat retain their existing terminal policy; Explorer export guards before conversion | No shared-wrapper implementation edit |
| Signed thinking history stays append-only within Explorer's tool loop | Compaction returns original history for thinking or redacted_thinking; ordinary history still compacts | Three actual mocked model rounds preserve earlier system/tools/messages; both block types covered |

The original guard set covers refine, QA, PDF-upload Phase I/II summarization, Phase I writeup,
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

## Fable-requested revision after current-main integration

The additional scope is the live Phase I Dynamics summary service and Explorer’s separate AI export batch path. Their earlier omission was a preexisting code gap and an overstatement in the original inventory. This report covers the listed callers, not every LLM consumer in the repository. Automatic Sonnet admission remains blocked pending a separately reviewed complete consumer inventory and any required replay.

The Phase I guard rejects either normalized refusal signal before extracting text, writing `wmkf_ai_summary`, or recording a completed audit. The existing failure audit may retain the generic refusal error, never provider refusal text. Explorer’s batch adapter preserves refusal metadata and both text consumers guard it before parsing; sample refusal stops before schema/output parsing, and a refused work batch is not retried and does not produce refusal-derived AI cell content. A refused work batch terminates export after already-dispatched sibling batches settle; it does not become a blank-cell success artifact. The chat tool loop also stops with a refused outcome rather than feeding the error back for another model retry. Already-dispatched sibling tools may finish independently; the refusal message describes only the stopped export. Ordinary non-refusal partial-batch behavior remains unchanged. Current-main integration retains the superseding Factory plan and shipped safeguards.

Revision validation: twelve focused unit/integration suites passed (92 tests, one snapshot), including direct export and full chat-route refusal cases. Type checking and targeted ESLint passed; 25 scoped gates/self-tests passed. Luna built the correction; Sol and root approved the source. Fable found no remaining material findings and approved conditional on the then-running suites; all twelve suites subsequently passed, satisfying that condition. The optional transient-retry characterization was not added: unchanged non-refusal behavior was verified by source review. The [final review receipt](../plans/evidence/PR423_REVISION_REVIEW_2026-10-03.json) records the evidence and limits. No live provider replay or production write is part of this revision.
