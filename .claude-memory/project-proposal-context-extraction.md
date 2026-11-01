---
name: Proposal Context Extraction Plan
description: Historical proposal for structured proposal-context extraction; fields, consumers, cycle assumptions, and implementation are not approved current architecture.
type: project
originSessionId: 295c55b4-a2bb-431a-984e-49c1e47ea565
status: active
scope: prompt
last_verified: 2026-10-31 source-only audit at f6376751d; no live probes; estimates and cycle assumptions are historical planning values
---

## Recall Rule

Read this only as historical context if a future owner-approved workflow raises a need for shared proposal-context extraction. It is not a current capture contract.

Before any implementation, establish the current cycle and workflow, select its real inputs and consumers, and decide whether extraction is needed. Re-estimate token and cost assumptions for actual models and documents.

Do not assume downstream calls should consume extracted Dynamics fields. The successor Review Panel currently accepts a frozen proposal-narrative-only DTO; this plan's proposed fields are not its input contract.

Historical reference: `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`. It records candidate field categories and open decisions, not a settled capture shape or approved `wmkf_ai_dataextract` contract.

[VERIFIED 2026-10-31 via bounded source review at f6376751d; no live probe]:
The existing `wmkf_ai_dataextract` field is included in Workbench proposal reads
and in the cycle-dossier's captured `priorAiContext`; the Executor can persist
prompt-declared outputs to that field. This is a narrower existing surface, not
proof that the proposed A/B/C field set or all listed downstream consumers are
implemented. The successor Review Panel explicitly selects a frozen proposal narrative
with request identity, institution and title (`lib/services/review-panel-input.js`) and excludes
`wmkf_ai_dataextract`. Token figures below are historical planning estimates,
not measured current costs.

Historical scenario considered in April 2026: a possible single-phase cycle where staff select proposals for deeper review using the same submitted document. The current cycle/workflow assumptions need owner confirmation before this scenario is reused.

**Why:** The initial pass already reads the full 5-page proposal. If it also captures structured extractions (central question, hypotheses, specific aims, methods summary, required expertise, key claims, etc.) into Dynamics fields, every downstream call can reference curated ~1.5K-token extracts instead of the full ~7K-token proposal (or ~15K-token PDF with images on user-side paths).

**How to apply:** Treat the design and its field list as candidates only. Each future consumer must choose and enforce its own input contract; do not make these fields a default context surface without an explicit current decision.

**Key amplifiers of ROI:**
- Expensive models (Opus, extended thinking): savings scale with per-token cost
- Multi-LLM panels: savings multiply by provider count (Claude + GPT + Gemini + Perplexity)
- Chain depth: 5–10 downstream calls per advancing proposal is common

The field list and storage alternatives below are unresolved historical design questions for any expansion beyond the existing `wmkf_ai_dataextract` surface; they are not a settled capture shape. Keep this memory routed only as a reminder to seek a fresh owner-approved contract if a concrete workflow needs extraction.

The historical proposal does not authorize a build. Revisit only after an owner approves a concrete workflow need, its inputs and consumers, and whether the existing `wmkf_ai_dataextract` field is sufficient or needs expansion.
