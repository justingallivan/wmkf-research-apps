---
name: Staged Review Pipeline
description: Three-stage automated proposal triage pipeline planned for the new grant cycle — fit screening, intelligence brief, virtual panel review
type: project
---

Three-stage LLM-assisted proposal review pipeline for the new grant cycle (higher volume, full proposals instead of concepts + Phase I).

**Why:** Grant cycle is being redesigned — concepts may be eliminated, Phase I may go away. Higher proposal volume requires automated triage to recover staff capacity. Current cycle's implementation provides lessons for the redesigned cycle after.

**How to apply:** Full spec saved at `docs/STAGED_REVIEW_PIPELINE.md`. When planning implementation work, reference that doc for stage definitions, schemas, and routing logic.

## Stage Summary
1. **Fit Screening** (Haiku) — binary checklist against mission/eligibility criteria. No flags → auto-pass; flags → staff review. New work.
2. **Intelligence Brief** (Perplexity + search APIs + Haiku) — novelty assessment, PI capability check, field landscape. Largely built as Stage 0 in Virtual Review Panel. Main new work: standalone output format for staff consumption, routing UI.
3. **Virtual Panel Review** (Claude + GPT + Gemini + Perplexity) — existing pipeline plus Devil's Advocate pass (adversarial single-model review, rotated). Intelligence Brief injected as context.

## Key Design Decisions
- No proposal declined without staff confirmation (Stage 1 is advisory, not decisional)
- Intelligence Brief travels with proposal through all stages
- Devil's Advocate output labeled separately in synthesis, not averaged with panel
- Per-proposal file storage model (`proposal_{id}/stage1_*.json`, etc.)
- Staff dashboard with routing status, flag highlighting, override capability

## What Already Exists
- Stage 0 intelligence pass (claim extraction → parallel search → collation → Perplexity synthesis) = Stage 2 sub-tasks
- Virtual Review Panel pipeline = Stage 3 core
- PI disambiguation fix (institution + field in search queries) = Stage 2 Sub-task C concern addressed

## What's New
- Stage 1 fit screening (straightforward Haiku call)
- Devil's Advocate pass in Stage 3
- Proposal routing/dashboard UI
- Per-proposal storage model
- Batch processing across multiple proposals

## Implementation Plan
Full implementation plan saved at `docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md`. Two new apps (Fit Screener + Proposal Pipeline), 5 phases, designed so service layer migrates directly to PowerAutomate triggers later. Not yet scheduled for implementation — saved for a future session.
