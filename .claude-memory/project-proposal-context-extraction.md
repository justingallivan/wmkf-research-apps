---
name: Proposal Context Extraction Plan
description: Pre-extract structured context from proposals in the initial pass so downstream deep-dive calls use ~1.5K tokens of curated fields instead of the full ~7K-token proposal. Matters most in the single-phase cycle (2 cycles out) where deep-dive work happens on the same document the initial pass processed.
type: project
originSessionId: 295c55b4-a2bb-431a-984e-49c1e47ea565
status: active
scope: prompt
last_verified: 2026-04-17 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: building deep-touch workflows (reviewer matching, virtual review panel, compliance screens, staff Q&A) for the single-phase grant cycle, or designing the `wmkf_ai_dataextract` capture.

Do:
- Default downstream calls to read extracted Dynamics fields (~1.5K-token curated extracts), not the full ~7K-token proposal (~15K with images).
- Capture structured extractions (central question, hypotheses, aims, methods, required expertise, key claims) in the initial pass that already reads the full proposal.

Do not:
- Build this yet — deferred until the single-phase cycle is imminent or a concrete deep-dive workflow first needs the extracted context.

Ground truth: `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md` (field categories A/B/C, downstream economics, open design decisions); this is the capture shape for the deferred `wmkf_ai_dataextract`.

Pre-extraction strategy for the single-phase grant cycle (2 cycles from 2026-04-17). In that cycle, proposals get one initial Claude pass; staff select some for deeper touch; deeper touch uses the SAME document with no new information from the submitter.

**Why:** The initial pass already reads the full 5-page proposal. If it also captures structured extractions (central question, hypotheses, specific aims, methods summary, required expertise, key claims, etc.) into Dynamics fields, every downstream call can reference curated ~1.5K-token extracts instead of the full ~7K-token proposal (or ~15K-token PDF with images on user-side paths).

**How to apply:** When building deep-touch workflows (reviewer matching, virtual review panel, compliance screens, staff Q&A) for the single-phase cycle, default to reading extracted Dynamics fields rather than the full proposal. The extraction fields become the shared "context surface" for all downstream work.

**Key amplifiers of ROI:**
- Expensive models (Opus, extended thinking): savings scale with per-token cost
- Multi-LLM panels: savings multiply by provider count (Claude + GPT + Gemini + Perplexity)
- Chain depth: 5–10 downstream calls per advancing proposal is common

**This is the capture shape for the deferred `wmkf_ai_dataextract`** — see `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md` for the full field list (categories A/B/C), downstream economics, and open design decisions (JSON-in-Memo vs individual columns, multi-output vs focused-pass ingest, freshness policy).

Not building yet — deferred until single-phase cycle is imminent or until a concrete deep-dive workflow first needs the extracted context.
