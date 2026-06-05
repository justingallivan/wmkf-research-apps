---
name: reviewer-finder-next-topics
description: "Three reviewer-finder improvement topics Justin flagged EOD S222. #1 (timeout) SHIPPED S223; #2 (recency-weighted identification + current-affiliation pinning) SHIPPED S224; #3 (Perplexity's role) still OPEN."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-05
  originSessionId: 613bb6ee-8f4b-4345-917d-032634550239
---

## Recall Rule
Read when picking up reviewer-finder improvement work. Justin raised these EOD S222. **#1 + #2 are SHIPPED; only #3 (Perplexity) remains open** — go there first for new work in this area.

## 1. Extend (and ideally make configurable) the Claude reviewer-call timeout — ✅ SHIPPED S223 (`493f4cd`, deployed)
Admin-configurable wall-clock search budget: Dataverse setting `reviewer.time_budget_seconds` (default 600s, clamped [120,800]), superuser `/admin` card + `GET/PUT /api/admin/reviewer-time-budget`. All 5 reviewer search routes pinned at `maxDuration: 800` (Pro cap) with an app-level AbortSignal deadline (maxDuration is build-time-static → can't be a live setting). See [[project-reviewer-prompt-dataverse-migration]] sibling work and `docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md`.

## 2. Use recency/dates to improve reviewer identification (prioritize current role over the digital tail) — ✅ SHIPPED S223–S224
**Was (Justin's framing):** a reviewer's long digital tail (grad → postdoc → current) is dominated by the postdoc stage, but the CURRENT role (often a new professor, sparse-but-correct) is who we want. **Shipped:** ranking rebalanced so recent in-area publication activity dominates and h-index/citations left the rank order (S223, `c694bcb`); PubMed affiliation is recency-weighted; current-affiliation pinning (ORCID > Scholar > PubMed-recency, identity-gated in `contact-enrichment-service._finalize`) with `affiliationSource` provenance shown in the cards (S224). Full design + Codex-round history: `docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md` + [[project-reviewer-ranking-recency-over-citations]].

## 3. Figure out Perplexity's role in reviewer finding / disambiguation — ⬜ OPEN (next)
**Confirmed state (S222 grep):** Perplexity is wired ONLY into the Virtual Review Panel (`lib/utils/vrp-providers.js`, `multi-llm-service.js`, `panel-review-service.js`, VRP prompts). **Not used anywhere in reviewer-finder / identity resolution.** No `PERPLEXITY_*`/`PPLX` key in `.env.local`. It was discussed for reviewer ID (see [[project-reviewer-identity-resolution-phase1]]) but never wired in.
**To decide:** what role should it play — web-search-grounded disambiguation (current affiliation, "is this the same person"), candidate discovery, or none? Compare against the existing SerpAPI/Scholar/ORCID enrichment path.

See [[project-reviewer-apps-redesign-direction]] for the workbench direction these feed.
