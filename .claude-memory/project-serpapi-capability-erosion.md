---
name: project-serpapi-capability-erosion
description: "SerpAPI WAS the project's largest monthly line item ($150/mo Production 15k); DOWNGRADED to Developer ($75/mo, 5k) 2026-06-28 by Justin after the S251 migration cut usage to ~1.7%. A 2026-06-11 audit found its value eroded: google_scholar_profiles is DEAD (Google login wall). MIGRATION STATUS (S251): Scholar metrics+domain (#2/#3, Slice 1b) and lit/PI-pubs (#4/#5, Slice 2) SHIPPED off SerpAPI → OpenAlex (NOT Semantic Scholar). PubPeer (#6) stays on SerpAPI — no public PubPeer API exists (verified); its migration is retired as a slice + parked as a contingent future item (full context in the integrity-screener agent-wiki topic). Residual = contact (#1) + PubPeer (#6) + news (#7)."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-28 — DOWNGRADED to Developer ($75/mo, 5k), confirmed via account API (was 259/cycle on 15k Production); 1b+2 shipped via OpenAlex (S251); PubPeer API non-existence verified
---

## Recall Rule
Read before adding/keeping a SerpAPI call, scoping reviewer-finder retrieval/enrichment
sources, or deciding whether a capability must be paid-for. Pairs with
[[project-serpapi-budget-latency]] (latency is the limiter for fan-out *design*; THIS file
is about the *subscription's value*) and [[project-api-credit-monitoring]].

## The cost fact (Justin-confirmed 2026-06-11; plan changed 2026-06-28)
**Now on the Developer plan: $75/mo, 5,000 searches/mo** (Justin downgraded 2026-06-28,
confirmed via account API). Was $150/mo Production (15k) — the project's largest line item
at the time; at $75 it may no longer be (re-check against actual Anthropic spend before
re-asserting "largest"). There is **no in-repo SerpAPI credit/usage monitoring** — admin stats track Anthropic spend
only; the invoice lives in the SerpAPI billing dashboard. **But live usage IS pullable
without the dashboard:** `GET https://serpapi.com/account?api_key=$SERP_API_KEY` returns
`this_month_usage`, `plan_searches_left`, `searches_per_month`, plan name/price (read-only;
discovered 2026-06-28). This is the data source the parked admin-observability item
([[project-api-credit-monitoring]]) would use for SerpAPI spend.

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

## Replace-or-keep (audit verdict + what SHIPPED S251)
- **KEEP on SerpAPI (genuinely irreplaceable):** general `google` web search for contact
  email/homepage lookup (Tier-4 enrichment, hot path) + `google_news` integrity checks. No free
  equivalent at quality.
- **REPLACED — SHIPPED S251 via OpenAlex** (NOT Semantic Scholar — the audit floated S2, but the
  implementation chose OpenAlex: already in-repo + SSRF-allowlisted, and OpenAlex gives h_index
  **AND i10_index** + cited_by_count where S2 lacks i10):
  - `google_scholar_author` metrics + the verified-email-domain guard → OpenAlex author + institution
    (**Slice 1b**); kills the login-wall risk + removes the 2 hot-path paid calls.
  - `google_scholar` lit/novelty + PI-pubs → OpenAlex works `searchWorks`/`getWorksByAuthor`
    (**Slice 2**).
- **PubPeer (`site:pubpeer.com` via `google`) — NOT replaced; stays on SerpAPI. The "PubPeer
  Developer API" does not exist** (verified S251 from primary sources). Its migration is retired as
  a slice + parked as a contingent future item — full context (facts, endpoint, load-vs-auth,
  build-if-granted) in `docs/agent-wiki/topics/integrity-screener.md`. Do NOT re-assume an API is
  available, and do NOT proactively resurface it (Justin recalls it on demand if PubPeer replies).
- **Downgrade DONE 2026-06-28 — Justin switched to Developer ($75/mo, 5,000), confirmed via
  account API.** Saves ~$75/mo vs Production. Basis [VERIFIED via account API]: `this_month_usage`
  = **259** when checked; the billing cycle resets ~the 20th (account created 2025-11-20), so 259
  was only ~8 days of a cycle → a full cycle projects to ~900–1,000 at that rate — which is exactly
  why Developer (5,000), not Starter (1,000): a peak review cycle (~3 residual SerpAPI calls/candidate:
  contact #1 + PubPeer #6 + news #7) could clear 1,000. Re-check a full peak cycle (J27 ~Dec 2026)
  before considering Starter. Ladder: Free $0/250 · Starter $25/1k · Developer $75/5k · Production
  $150/15k · Big Data $275/30k.
- Full migration plan + per-slice disposition: `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.

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
