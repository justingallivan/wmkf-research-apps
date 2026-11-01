---
name: Staged Review Pipeline
description: Historical, unapproved three-stage proposal-triage design; current concept eligibility and successor Review Panel are separate capabilities
type: project
status: stale
scope: reviewer
last_verified: 2026-10-31 source-only audit at f6376751d; no live probes
---

## Recall Rule

Read this only as historical context when someone asks about the old staged proposal pipeline design. It is not current scope or an implementation plan.

Current evidence (source-only, 2026-10-31): the proposed staged pipeline and its persistence/UI were not found. The concept evaluator has a limited concept-PDF eligibility flag. The successor Review Panel is a separate narrative-only Workbench capability with configured seats and a chair; it is not wired into the old pipeline. No current pipeline architecture or build is approved here.

For current scope, get owner decisions and a fresh contract. Do not use the historical stage definitions, schemas, provider set, storage, or rollout sequence as requirements.

Historical design constraint, not a current implementation contract: the old proposal required staff confirmation before decline. Any new screening work needs its own current decision and safety contract.

Historical references only: `docs/STAGED_REVIEW_PIPELINE.md`, `docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md`. Current source evidence is in `pages/api/evaluate-multi-perspective.js`, `lib/services/review-panel-input.js`, `lib/services/review-panel-worker.js`, and `docs/atlas/postgres-review-panel.md`.

The following is the original 2026-05 proposal, retained as history. It does not establish current cycle architecture.

**Why:** Grant cycle is being redesigned — concepts may be eliminated, Phase I may go away. Higher proposal volume requires automated triage to recover staff capacity. Current cycle's implementation provides lessons for the redesigned cycle after.

**How to apply:** Do not use the old spec as a build plan. Reconfirm owner intent, cycle shape, data contract, and safety requirements first.

## Historical Stage Summary (Not Current State)
1. **Fit Screening** (Haiku) — proposed binary checklist against mission/eligibility criteria. A limited concept-PDF eligibility flag exists, but it is not this full-proposal checklist or routing stage.
2. **Intelligence Brief** (Perplexity + search APIs + Haiku) — proposed novelty, PI capability, and landscape brief. The described legacy panel intelligence work is archived; no shared stage output/routing surface was verified.
3. **Virtual Panel Review** — the old four-provider integration and proposed Devil's Advocate pass were a proposal. The legacy panel is retired; its successor is not the old pipeline stage.

## Historical Proposed Decisions (Not Approved Current Decisions)
- No proposal declined without staff confirmation (Stage 1 is advisory, not decisional)
- Intelligence Brief travels with proposal through all stages
- Devil's Advocate output labeled separately in synthesis, not averaged with panel
- Per-proposal file storage model (`proposal_{id}/stage1_*.json`, etc.)
- Staff dashboard with routing status, flag highlighting, override capability

## Existing Similar Capabilities (Not Pipeline Stages)
- The concept evaluator (`pages/api/evaluate-multi-perspective.js`) flags some concept PDFs as potentially outside funding scope and short-circuits that concept evaluation. This is not the proposed full-proposal checklist, persistent stage state, or staff routing.
- The legacy Virtual Review Panel is retired and archived. The successor Review Panel is a separate narrative-only Workbench capability; it does not consume a Stage 2 intelligence brief or implement old Stage 3 routing.
- No shared staged intelligence-brief pipeline has been established by this design.

## Historical Proposed Work (Unbuilt; Not a Commitment)
- Stage 1 fit screening (straightforward Haiku call)
- Devil's Advocate pass in Stage 3
- Proposal routing/dashboard UI
- Per-proposal storage model
- Batch processing across multiple proposals

## Implementation Plan
The linked implementation plan preserves the old two-app/five-phase proposal. It is historical and not scheduled or approved. Any future work requires fresh scope; do not infer a Power Automate architecture from it.
