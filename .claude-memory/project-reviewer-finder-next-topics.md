---
name: reviewer-finder-next-topics
description: "Three reviewer-finder improvement topics Justin flagged EOD S222. #1 (timeout) SHIPPED S223; #2 (recency-weighted identification + current-affiliation pinning) SHIPPED S224; #3 (Perplexity's role) SCOPED + backend increment-1 built S225 (read-only web-suggestions panel)."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-05
  originSessionId: 613bb6ee-8f4b-4345-917d-032634550239
---

## Recall Rule
Read when picking up reviewer-finder improvement work. Justin raised these EOD S222. **#1 + #2 SHIPPED; #3 (Perplexity) SCOPED + backend increment-1 built S225** — see §3 for exact state before continuing.

## 1. Extend (and ideally make configurable) the Claude reviewer-call timeout — ✅ SHIPPED S223 (`493f4cd`, deployed)
Admin-configurable wall-clock search budget: Dataverse setting `reviewer.time_budget_seconds` (default 600s, clamped [120,800]), superuser `/admin` card + `GET/PUT /api/admin/reviewer-time-budget`. All 5 reviewer search routes pinned at `maxDuration: 800` (Pro cap) with an app-level AbortSignal deadline (maxDuration is build-time-static → can't be a live setting). See [[project-reviewer-prompt-dataverse-migration]] sibling work and `docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md`.

## 2. Use recency/dates to improve reviewer identification (prioritize current role over the digital tail) — ✅ SHIPPED S223–S224
**Was (Justin's framing):** a reviewer's long digital tail (grad → postdoc → current) is dominated by the postdoc stage, but the CURRENT role (often a new professor, sparse-but-correct) is who we want. **Shipped:** ranking rebalanced so recent in-area publication activity dominates and h-index/citations left the rank order (S223, `c694bcb`); PubMed affiliation is recency-weighted; current-affiliation pinning (ORCID > Scholar > PubMed-recency, identity-gated in `contact-enrichment-service._finalize`) with `affiliationSource` provenance shown in the cards (S224). Full design + Codex-round history: `docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md` + [[project-reviewer-ranking-recency-over-citations]].

## 3. Perplexity's role — DECIDED + backend increment-1 built (S225)
**Decision (S225, w/ Justin):** Perplexity Search API as a web-grounded **candidate-discovery lead source** to counter Claude's training-cutoff + fame bias (surface currently-active mid-career researchers, not field founders/laureates). **NOT** an identity gate. **v1 = READ-ONLY web-suggestions panel** via a SEPARATE path — does NOT merge into the discovery pipeline / ranking / COI / roster / save (a `/contract-reconcile` whole-flow trace proved every integration approach generated HIGHs; read-only deletes that surface). The full pipeline integration is deferred v2.
**Built S225 (commit `f842c22`, backend only, inert in prod — no route/UI yet):** `lib/services/web-discovery-service.js` (Perplexity `/search` → A7-wrapped name extraction → `WebLead[]`; leads-only; `provenanceUrl` from `results[].url` only; fail-soft; caps 3×10; `search_cache` `perplexity` namespace; Perplexity vs Claude keys kept separate — a Codex post-impl HIGH was that they'd been crossed), `createWebExtractionPrompt` (static, A7-registered), `api-capabilities.reviewerWebSearch`. 15 unit tests green.
**Next (increment 2):** the route `/api/reviewer-finder/web-suggestions` (+ security-matrix entry) + the read-only UI panel + capability-gated `searchWeb` toggle on both surfaces. Then live Perplexity contract test before enabling (no key set yet; `search_after_date_filter` format unconfirmed).
**Note:** the Perplexity SEARCH API is a different surface from the VRP `sonar` CHAT call. Plan + deferred-v2 contracts: `docs/REVIEWER_WEB_DISCOVERY_PLAN.md`.

See [[project-reviewer-apps-redesign-direction]] for the workbench direction these feed.
