---
name: project-reviewer-ranking-recency-over-citations
description: "Reviewer ranking principle (Justin, S223), SHIPPED S223–S224 — recent publication activity must outweigh cumulative citation metrics; h-index/total-citations are longevity-biased and penalize the current active expert (e.g. new professor) the search is meant to surface. Final form: citations/h-index left the rank order ENTIRELY (no floor); h-index shown only as a human-facing seniority hint."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-05
  originSessionId: 5a67f95f-03ad-42d0-8160-d36ba5d936d7
---

## Recall Rule
Read this before designing or editing reviewer-candidate RANKING / relevance scoring (`lib/utils/relevance-score.js`, `DiscoveryService.rankAllCandidates`, the Workbench client re-rank) or any "score by citations / h-index" logic.

## The principle (Justin, S223)
**Recent publication activity must outweigh cumulative citation metrics.** Total citations and h-index are *longevity* signals, not current-relevance signals: older papers have had more years to accrue citations, and h-index only ever grows over a career. Justin's own most-cited paper is from 1999 though he's published elsewhere since.

**Why it's central, not a side-issue:** the bias points the wrong way for the whole goal of recency-weighted reviewer identification ([[reviewer-finder-next-topics]] Topic #2). The reviewer we want is often a *new professor* — sparse footprint, small h-index — so a citation-weighted ranker actively buries them under the prolific postdoc and the famous-but-dormant emeritus.

**It was already the wrong path in live code (S223 audit):** `relevance-score.js` gave up to **35 pts to all-time h-index + total citations** (20+15), 20 to a raw publication *count* (array length, no dates), and **0 to recency**.

## Shipped form (S223–S224 — what actually landed)
`relevance-score.js` now: recency is the dominant positive term, **pure linear** `min(35, 7·min(publicationCount5yr,5))` — h-index, total citations, AND the raw pub-array-length term were **removed from the score entirely**. The earlier "activity floor" (≥3 recent → +10) was **dropped** in the post-impl Codex pass (inert above count=1; reintroduced a seniority step). So there is **NO citation/h-index floor in the rank math** — a productive grad student with recent papers ranks on recency alone (accepted, Justin S223). Current-affiliation pinning + recency-weighted PubMed affiliation shipped S224. See `docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md`.

## How to apply (for FUTURE ranking edits — don't regress this)
- Keep **recent in-area activity the dominant positive** rank signal (last-5yr count via `publicationCount5yr`). Do not re-add a citation/h-index term or a seniority floor to the score.
- Citations/h-index keep two NON-ranking jobs only: (1) identity corroboration (the resolver anchors on Scholar metrics — see [[project-reviewer-identity-resolution-phase1]]), and (2) **human-facing display** — h-index is shown in the card/detail pane as a seniority hint for the picker to judge, never summed into the score. The "grad student risk" is handled by the human picker seeing h-index, not by a score floor.

## Data on hand (S223 live SerpAPI probe, `google_scholar_author`)
Recency signals confirmed populated and mostly free: `cited_by.table.*.since_2021` (recent-window h-index/citations, in the table we already parse but only read `.all`); `articles[]` with `sort=pubdate` → most-recent-first; `cited_by.graph` per-year citations; `author.affiliations` + verified-email domain (current affiliation). See [[reviewer-finder-next-topics]].
