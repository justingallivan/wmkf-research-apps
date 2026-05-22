---
name: Virtual Review Panel
description: Multi-LLM review panel app — Claude, GPT, Gemini, Perplexity independently review proposals against WMKF reviewer form, then Claude synthesizes
type: project
---

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

### DB Tables (V24 migration)
- `panel_reviews` — one row per review session
- `panel_review_items` — one row per LLM per stage

### Status (Session 91)
- Infrastructure built, build passing
- Not yet tested end-to-end (needs API keys configured)
- Prompts are experimental — Stage 1 especially will need iteration
- Stage 2 prompts based on actual WMKF Research Reviewer Form
