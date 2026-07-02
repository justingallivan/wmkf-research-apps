---
title: Virtual Review Panel
domain: prompt-executor
kind: spec
status: active
summary: Thin design / operations reference for the Virtual Review Panel app. Created S191 to receive content extracted from CLAUDE.md so the table-row...
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/config/appRegistry.js
  - pages/virtual-review-panel.js
  - lib/services/panel-review-service.js
  - lib/services/multi-llm-service.js
---

# Virtual Review Panel

Thin design / operations reference for the Virtual Review Panel app. Created S191 to receive content extracted from CLAUDE.md so the table-row trim wouldn't drop load-bearing facts (notably the access posture).

## Status and access

- **App key:** `virtual-review-panel` (`shared/config/appRegistry.js` — find by app key).
- **Page route:** `/virtual-review-panel` (`pages/virtual-review-panel.js`).
- **API route:** `/api/virtual-review-panel` (single endpoint; streams SSE).
- **Auth gate:** `requireAppAccess(req, res, 'virtual-review-panel')`.
- **Access posture: admin-assigned only, NOT in default grants.** `DEFAULT_APP_GRANTS` in `shared/config/appRegistry.js` currently grants only `dynamics-explorer` to new signups; VRP must be granted explicitly via `/admin → User Access`. This is the load-bearing operational fact — sessions that assume VRP is a standard grant app will misdiagnose access issues.
- **Rate limit:** 3 requests / window via `nextRateLimiter({ max: 3 })`.

## Pipeline stages

Orchestrated by `PanelReviewService` in `lib/services/panel-review-service.js`; multi-provider transport via `MultiLLMService` in `lib/services/multi-llm-service.js`.

1. **(Optional) Stage 0a — Claim extraction.** Claude only; extracts structured claim data from proposal text.
2. **(Optional) Stage 0b — Database searches.** `LiteratureSearchService.searchAll(claimData)` queries PubMed, arXiv, bioRxiv, ChemRxiv, OpenAlex in parallel. No LLM call. (Novelty + PI-publication search moved from SerpAPI Google Scholar to free OpenAlex works in S251 — see `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.)
3. **(Optional) Stage 0c — Search collation.** Claude only (Haiku); operates on extracted `claimData` plus raw search results, **not** raw proposal text.
4. **(Optional) Stage 0d — Perplexity synthesis.** Runs only when Perplexity is configured AND allowed by `VRP_ALLOWED_PROVIDERS`; synthesizes field landscape from claims + collated results.
5. **(Optional) Stage 1 — Claim verification.** Each selected provider checks claims against literature.
6. **Stage 2 — Structured review.** Each selected provider returns the WMKF reviewer form (affiliation / impact / risk / overall rating + narrative).
7. **(Optional) Devil's Advocate pass.** Each selected provider re-reviews with the adversarial system prompt.
8. **Synthesis.** Claude only; produces panel summary with consensus, disagreements, open questions.

Two stages intentionally do NOT receive raw proposal text: search collation (Stage 0c) operates on `claimData` + search results, and synthesis operates on parsed reviewer outputs. Both invariants are pinned by tests so a refactor that piped raw proposal text in would fail loudly. See `docs/AI_DATA_FLOW_MATRIX.md` § "Virtual Review Panel" for the full payload-boundary spec.

## Provider policy

- Configured providers: Claude (Anthropic), OpenAI (GPT), Google (Gemini), Perplexity.
- **`VRP_ALLOWED_PROVIDERS` env var gates which providers can be used.** Production fails closed if unset. Must include `claude` (synthesis + Stage 0a/0c call Claude unconditionally). Resolved set is persisted per-run in `panel_reviews.config`.
- **Model resolution is asymmetric:** only the synthesis stage uses `getModelForApp('virtual-review-panel')` (so admin `/admin` per-app overrides take effect for synthesis only). The provider stages (Stages 1, 2, Devil's Advocate, plus the Stage 0d Perplexity call) use `MultiLLMService.getDefaultModel(provider)` and are NOT controlled by the per-app model override.
- See `docs/CREDENTIALS_RUNBOOK.md` § "Optional — Virtual Review Panel (multi-LLM)" for the per-provider API keys.

## Persistence and data boundary

- **Tables (Postgres, permanent):** `panel_reviews` (one row per run, includes `config` JSONB with resolved provider set + cost summary), `panel_review_items` (one row per provider-stage output). Migration: `lib/db/migrations/003_virtual_review_panel.sql`.
- **Proposal text:** stored as `proposal_text_hash` only — the raw text is never persisted (hashed at service entry). Bounded at the route boundary by `VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS` (defined in `lib/utils/ai-payload-boundary.js`) before fan-out to providers.
- **Vendor exposure:** materially higher than Claude-only routes because the bounded proposal text fans out to up-to-four providers. The fail-closed `VRP_ALLOWED_PROVIDERS` allowlist is the primary mitigation.

## Cross-references

- Route security: `docs/API_ROUTE_SECURITY_MATRIX.md`
- Provider env vars: `docs/CREDENTIALS_RUNBOOK.md` § "Optional — Virtual Review Panel (multi-LLM)"
- Payload-boundary contract + multi-provider risk analysis: `docs/AI_DATA_FLOW_MATRIX.md` § "Virtual Review Panel"
- Storage: `docs/APPLICATION_STATE_ATLAS.md` (search for `panel_reviews`)
- Source files: `pages/api/virtual-review-panel.js`, `lib/services/panel-review-service.js`, `lib/services/multi-llm-service.js`, `lib/utils/vrp-providers.js`
