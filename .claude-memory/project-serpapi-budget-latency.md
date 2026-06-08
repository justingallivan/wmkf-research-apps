---
name: project-serpapi-budget-latency
description: "SerpAPI plan is ~15,000 calls/month (user-stated S234) — call COST is no longer the binding constraint on reviewer contact enrichment; LATENCY is. A program director won't use the tool if enriching is slower than Googling the names by hand."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-08
---

## Recall Rule
Read before changing reviewer contact/Scholar enrichment fan-out, retry/fallback breadth, or anything
that adds per-candidate external round-trips. Pairs with [[project-api-credit-monitoring]] and
[[project-reviewer-contact-enrichment-anchoring]].

## The fact (user-stated, S234)
The SerpAPI plan allows **~15,000 calls/month** — ample. Early enrichment design was shaped by
cost-minimization (contact search skipped if a free tier already found an email; single-shot per
candidate; broad-then-stop fallbacks). **That cost pressure is largely lifted.**

## What changed in the design posture
- It is now fine to spend MORE SerpAPI calls per candidate for correctness (e.g. cross-validate an
  ORCID/PubMed email against an anchored search; multi-profile topic-scoring) — *cost* is not the limiter.
- **The new binding constraint is LATENCY / wall-clock.** Enrichment runs largely sequentially per
  candidate and there is a `reviewer_time_budget_exceeded` deadline that aborts the run. Observed on
  1002794: analyze ~53s, discover ~52s, then per-candidate enrichment on top. The bar a PD applies:
  "could I just Google these myself in the same time?"
- Therefore prefer fixes that **reuse anchors already fetched** (OpenAlex author/work data, ORCID
  affiliation) and **abstain** over fixes that add sequential searches. If you must add round-trips,
  parallelize the per-candidate fan-out or bound it (≈2–3 probes), and `log()` anything dropped.

## Watch-outs
- Scholar-first reordering, topic-keyword query expansion, and per-candidate multi-profile web fan-out
  were all evaluated and scoped OUT for latency reasons (S234) — not cost. Don't re-justify them on
  "we have budget"; the question is wall-clock.
