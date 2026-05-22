---
name: PDF Processing Tiers
description: Tier 1 (auto/high-volume) uses text-only extraction; Tier 2 (manual/selective) uses full PDF vision API
type: project
---

Two processing modes based on volume and stage in the workflow:

- **Tier 1 (automatic, high volume):** Text-only via `pdf-parse`. Images stripped automatically. Sufficient for summaries, ~100x cheaper at scale. Used for every proposal that comes in.
- **Tier 2 (human-initiated, selective):** Full PDF via Claude's vision API (base64, `media_type: "application/pdf"`). Claude sees figures, tables, diagrams. Used for reviewer finding, detailed evaluation — far fewer queries.

**Why:** Early-stage automated work (summaries for every proposal) doesn't need images and cost matters at scale. Later-stage detailed work is selective and benefits from full document fidelity.

**How to apply:** Service endpoints should accept a `processingMode` parameter (`text` or `vision`) to switch between the two paths. No shell-command pre-processing needed — `pdf-parse` already ignores images for text mode.
