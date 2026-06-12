---
name: project-serpapi-capability-erosion
description: "SerpAPI is the project's LARGEST monthly expense ($150/mo Production ~15k calls, Justin-confirmed 2026-06-11). A 2026-06-11 audit found its value eroded: google_scholar_profiles is DEAD (Google login wall), and 4 of 6 uses are now done better by FREE academic APIs (Semantic Scholar / OpenAlex). Only general web-search (contact lookup) + news are irreplaceable. Migration could drop us to the Hobby tier."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-11 via audit agent (SerpAPI docs cited) + Justin cost confirmation
---

## Recall Rule
Read before adding/keeping a SerpAPI call, scoping reviewer-finder retrieval/enrichment
sources, or deciding whether a capability must be paid-for. Pairs with
[[project-serpapi-budget-latency]] (latency is the limiter for fan-out *design*; THIS file
is about the *subscription's value*) and [[project-api-credit-monitoring]].

## The cost fact (Justin-confirmed 2026-06-11)
**SerpAPI = the largest monthly line item: $150/mo** (Production, ~15,000 calls/mo).
There is **no in-repo SerpAPI credit/usage monitoring** — admin stats track Anthropic spend
only; actual call volume + invoice live in the SerpAPI billing dashboard, not the repo.

## Capability erosion (audit 2026-06-11; SerpAPI docs cited)
- **`google_scholar_profiles` (author profile SEARCH) is DISCONTINUED** — Google's Scholar
  login wall broke the scrape (practical failure ~Dec 2024; SerpAPI deprecation doc June 2025).
  Already migrated in code (`serp-contact-service.js:330-338` → `google` engine + `site:scholar.google.com`).
  **Relevance to the new design:** this was the natural "topic→author / find-the-people-in-this-field"
  capability — its loss is exactly WHY topic→author "leaders" aggregation must come from
  **OpenAlex `group_by=authorships.author.id`**, not Scholar. See [[project-reviewer-origination-multilane]].
- **`google_scholar_author` (h-index/citations by ID) is still ACTIVE** but faces the same
  login-wall risk, and **nothing in the repo would detect it silently returning null** — a real
  unmonitored degradation risk.

## Replace-or-keep (audit verdict)
- **KEEP on SerpAPI (genuinely irreplaceable):** general `google` web search for contact
  email/homepage lookup (Tier-4 enrichment, hot path) + `google_news` integrity checks. No free
  equivalent at quality.
- **REPLACE with free APIs:**
  - `google_scholar_author` metrics → **Semantic Scholar** `/graph/v1/author` returns `hIndex`
    directly (free; ORCID→S2 lookup straightforward) — removes a hot-path paid call + kills the
    login-wall risk.
  - `google_scholar` lit/novelty/PI-pubs → **Semantic Scholar / OpenAlex** paper search (free,
    broader OA/preprint coverage).
  - PubPeer integrity (`site:pubpeer.com` via `google`) → **PubPeer Developer API** (native, free key).
- After those, residual SerpAPI use (contact + news) may fit the **Hobby tier (~$50/mo / 5k)** →
  ~$100/mo saved — **confirm against real call volume in the billing dashboard before downgrading.**

## Caveat (don't migrate blind)
Semantic Scholar / OpenAlex are not free lunches: they rate-limit (~1 rps even keyed — a LATENCY
cost, the binding constraint per [[project-serpapi-budget-latency]]) and their coverage differs by
field (PubMed-for-biomedical, ADS/arXiv-for-astro instincts still apply per
[[project-reviewer-finder-retrieval-redesign]]). Validate coverage + latency on real requests
before wholesale cutover; recall-over-precision posture.

## Tie-in
Semantic Scholar (free `citationCount` + paper search + `hIndex`) is also the grounding source for
the planned staff one-page field review (key-papers + metrics), so this migration and
`docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md` reinforce each other — the one-pager can be
grounded on free APIs, not paid Scholar.
