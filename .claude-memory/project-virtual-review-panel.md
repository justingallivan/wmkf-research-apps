---
name: Virtual Review Panel
description: RETIRED 2026-10-04 (S573) — legacy multi-LLM review panel app, archived to _archived/; was Claude, GPT, Gemini, Perplexity independently review proposals against WMKF reviewer form, then Claude synthesizes
type: project
status: closed
scope: reviewer
last_verified: 2026-10-04 via retirement commit (S573)
---

## Retirement (2026-10-04, Session 573)

Owner decision. The page, SSE API route, panel-review service, literature-search service, prompt file and output schema moved to mirrored paths under `_archived/`: `_archived/pages/virtual-review-panel.js`, `_archived/pages/api/virtual-review-panel.js`, `_archived/lib/services/panel-review-service.js`, `_archived/lib/services/literature-search-service.js`, `_archived/shared/config/prompts/virtual-review-panel.js`, `_archived/shared/config/virtual-review-panel-output-schema.js`. `APP_LIFECYCLE_REGISTRY['virtual-review-panel']` is `deprecated`, successor `review-panel`. `panel_reviews` / `panel_review_items` and existing grants retained. `multi-llm-service.js` and `lib/utils/vrp-providers.js` stay live for the successor. Everything below is historical.

## Historical design and implementation record

This section records the legacy app's former design and runtime details. It is not current
operating guidance. For live Review Panel work, use the Review Panel wiki topic and current
source. The legacy pipeline was archived in S573; its successor and the few shared live
utilities are identified above.

The app introduced in Session 91 used 3–4 LLMs to independently review grant proposals.

The original rationale was to augment human peer review with perspectives from different
LLM providers.

### Former architecture
- **Two-stage pipeline per LLM:**
  - Stage 1 (optional): Claim verification — check novelty claims against literature
  - Stage 2: Structured review — answer the 11 WMKF reviewer form questions
- **Synthesis:** Claude summarizes consensus, disagreements, rating matrix, questions for PI
- **Data flow:** Hybrid SSE streaming + DB persistence (panel_reviews, panel_review_items)

### Files retained from the former app
- `lib/services/multi-llm-service.js` — Unified interface for 4 LLM APIs (Claude, OpenAI, Gemini, Perplexity)
- `_archived/lib/services/panel-review-service.js` — DB CRUD + pipeline orchestration (archived)
- `_archived/shared/config/prompts/virtual-review-panel.js` — Stage 1, Stage 2, and synthesis prompts (archived)
- `_archived/pages/api/virtual-review-panel.js` — SSE streaming API route (archived)
- `_archived/pages/virtual-review-panel.js` — Frontend with provider selection, progress, results (archived)

### Environment variables in the former app contract
- `OPENAI_API_KEY` — required for GPT reviewer
- `GOOGLE_AI_API_KEY` — required for Gemini reviewer
- `PERPLEXITY_API_KEY` — required for Perplexity reviewer (best for Stage 1 claim verification due to built-in search)

### Database tables created for the former app (migration `003_virtual_review_panel.sql`)
- `panel_reviews` — one row per review session
- `panel_review_items` — one row per LLM per stage
- (The "V24" label in the original S91 note was wrong — the real file is `lib/db/migrations/003_virtual_review_panel.sql`; no `024`/`V24` exists. Fixed S209.)

### Dated source status and runtime evidence
- The legacy infrastructure was present in source and had late-May 2026
  iteration/evidence refuting the S91 "not yet tested end-to-end" note. That
  checkpoint predates the S573 archival; it does not describe the retired app
  as live or establish its deployment or usage at retirement.
- At the time recorded, provider gating used `VRP_ALLOWED_PROVIDERS`, intersected the allowlist with configured keys, failed closed in production when unset, and required `claude` (`lib/utils/vrp-providers.js`); see the historical `docs/VIRTUAL_REVIEW_PANEL.md`.
- At the recorded checkpoint, prompts were still being iterated, and Stage 2
  was based on the WMKF Research Reviewer Form.

### Provider-key deployment snapshot (2026-06-05/S227)

At that snapshot, `PERPLEXITY_API_KEY` was present in production and
`VRP_ALLOWED_PROVIDERS` was unset. These values describe the legacy app's
2026-06-05 deployment snapshot only; they do not establish current deployment
configuration or behavior. Any decision about provider access to proposal text
belongs to the live Review Panel and must follow its current source and owner
direction, not revive the retired Virtual Review Panel.
