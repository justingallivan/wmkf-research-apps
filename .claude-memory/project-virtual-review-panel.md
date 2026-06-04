---
name: Virtual Review Panel
description: Multi-LLM review panel app — Claude, GPT, Gemini, Perplexity independently review proposals against WMKF reviewer form, then Claude synthesizes
type: project
status: active
scope: reviewer
last_verified: S209 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: working on the Virtual Review Panel app, its multi-LLM pipeline, or its provider gating.

Do:
- Use app key `virtual-review-panel`; access is granted via admin dashboard (NOT in DEFAULT_APP_GRANTS).
- Honor `VRP_ALLOWED_PROVIDERS` (intersected with configured keys, fail-closed if unset, must include `claude`) via `lib/utils/vrp-providers.js`.
- Reference key files: `multi-llm-service.js`, `panel-review-service.js`, `shared/config/prompts/virtual-review-panel.js`, the SSE route + page.

Do not:
- Cite a "V24"/`024` migration — the real file is `lib/db/migrations/003_virtual_review_panel.sql`.
- Repeat the stale "not yet tested end-to-end" line — it's live and iterated through late-May 2026.

Ground truth: `docs/VIRTUAL_REVIEW_PANEL.md`; `pages/api/virtual-review-panel.js`, `lib/utils/vrp-providers.js`.

## Virtual Review Panel App

New app (Session 91) that creates a virtual review panel using 3-4 LLMs to independently review grant proposals.

**Why:** Foundation wants to augment human peer review with diverse AI perspectives. Using different LLM providers introduces genuine reasoning diversity vs. one model playing multiple roles.

**How to apply:** This is a new app registered as `virtual-review-panel` in appRegistry.js. NOT in DEFAULT_APP_GRANTS — access must be granted via admin dashboard.

### Architecture
- **Two-stage pipeline per LLM:**
  - Stage 1 (optional): Claim verification — check novelty claims against literature
  - Stage 2: Structured review — answer the 11 WMKF reviewer form questions
- **Synthesis:** Claude summarizes consensus, disagreements, rating matrix, questions for PI
- **Data flow:** Hybrid SSE streaming + DB persistence (panel_reviews, panel_review_items)

### Key Files
- `lib/services/multi-llm-service.js` — Unified interface for 4 LLM APIs (Claude, OpenAI, Gemini, Perplexity)
- `lib/services/panel-review-service.js` — DB CRUD + pipeline orchestration
- `shared/config/prompts/virtual-review-panel.js` — Stage 1, Stage 2, and synthesis prompts
- `pages/api/virtual-review-panel.js` — SSE streaming API route
- `pages/virtual-review-panel.js` — Frontend with provider selection, progress, results

### Environment Variables (New)
- `OPENAI_API_KEY` — required for GPT reviewer
- `GOOGLE_AI_API_KEY` — required for Gemini reviewer
- `PERPLEXITY_API_KEY` — required for Perplexity reviewer (best for Stage 1 claim verification due to built-in search)

### DB Tables (migration `003_virtual_review_panel.sql`)
- `panel_reviews` — one row per review session
- `panel_review_items` — one row per LLM per stage
- (The "V24" label in the original S91 note was wrong — the real file is `lib/db/migrations/003_virtual_review_panel.sql`; no `024`/`V24` exists. Fixed S209.)

### Status (S91 baseline; iterated since — S209)
- Infrastructure built and live; the S91 "not yet tested end-to-end" line is stale (`pages/virtual-review-panel.js` actively iterated through late-May 2026).
- Provider gating now hardened: `VRP_ALLOWED_PROVIDERS` allowlist intersected with configured keys, production fails closed if unset, must include `claude` (`lib/utils/vrp-providers.js`); see `docs/VIRTUAL_REVIEW_PANEL.md`.
- Prompts remain iterative; Stage 2 based on the actual WMKF Research Reviewer Form.
