---
name: project-reviewer-ranking-recency-over-citations
description: "Reviewer ranking principle (Justin, S223) — recent publication activity must outweigh cumulative citation metrics; h-index/total-citations are longevity-biased and penalize the current active expert (e.g. new professor) the search is meant to surface."
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

## How to apply
- Make **recent in-area activity the dominant positive** rank signal (recent publication years / recent-window output).
- **Do NOT let all-time h-index / total citations dominate.** Prefer Scholar's recent-window metrics (`cited_by.table.*.since_YYYY` — already in the payload we fetch) over all-time `.all` when a citation signal is used at all.
- Citations/h-index keep two NON-ranking jobs: (1) identity corroboration (the resolver anchors on Scholar metrics — see [[project-reviewer-identity-resolution-phase1]]), and (2) a rough "established-enough to review" floor. Pure recency with zero track record risks surfacing a current grad student, who is also a wrong reviewer — so demote citations, don't delete them.

## Data on hand (S223 live SerpAPI probe, `google_scholar_author`)
Recency signals confirmed populated and mostly free: `cited_by.table.*.since_2021` (recent-window h-index/citations, in the table we already parse but only read `.all`); `articles[]` with `sort=pubdate` → most-recent-first; `cited_by.graph` per-year citations; `author.affiliations` + verified-email domain (current affiliation). See [[reviewer-finder-next-topics]].
