---
name: reviewer-finder-next-topics
description: "Three reviewer-finder improvement topics Justin flagged end of S222 to discuss/scope next session — Claude-call timeout extension, recency-weighted reviewer identification, and Perplexity's role in disambiguation."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-04
  originSessionId: 613bb6ee-8f4b-4345-917d-032634550239
---

## Recall Rule
Read at the start of the next reviewer-finder session (or when picking up any of these three). Justin raised these EOD S222; they are discussion/scoping items, not yet specced.

## 1. Extend (and ideally make configurable) the Claude reviewer-call timeout
**Why:** Justin nearly lost a reviewer search to a timeout. All reviewer routes are at `maxDuration: 300` (5 min): `pages/api/reviewer-finder/{analyze,discover,generate-emails}.js` + `workbench/enrich-recommended.js`; `load-proposal.js` is 120. The long pole is **`discover.js`** (DB searches + per-batch Claude reasoning + enrichment). The LLM client (`lib/services/llm-client.js`) is 120s timeout + 3 retries.
**Nuance to discuss:** `maxDuration` is a STATIC build-time `export const config` — it can't be per-request runtime-configurable. "Configurable" realistically means raise it (to the Vercel plan's max — verify; Fluid Compute on Pro allows >300s) and/or env/build-driven, and/or make the LLM client timeout/retry budget tunable. Check the plan's hard cap first.

## 2. Use recency/dates to improve reviewer identification (prioritize current role over the digital tail)
**The problem (Justin's framing):** A potential reviewer has a long digital tail — grad school → postdoc → current. Web/Scholar footprint is often DOMINATED by the postdoc stage (more papers, more presence), but **the current role (e.g. a new professor) is who we actually want.** We should prioritize more RECENT signals even though they're sparser.
**Where it touches:** contact enrichment / affiliation extraction (`lib/services/contact-enrichment-service.js`), the identity resolver / disambiguation ([[project-reviewer-identity-resolution]]), and `rankByRelevance`. Levers: ORCID has dated employment history; Scholar has publication years — use dates to identify the CURRENT affiliation and weight it (and recent papers) above the historical tail. Hard part: current-role signal is sparse, so naive "most evidence wins" picks the wrong (postdoc) affiliation.

## 3. Figure out Perplexity's role in reviewer finding / disambiguation
**Confirmed state (S222 grep):** Perplexity is wired ONLY into the Virtual Review Panel (`lib/utils/vrp-providers.js`, `multi-llm-service.js`, `panel-review-service.js`, VRP prompts). **Not used anywhere in reviewer-finder / identity resolution.** No `PERPLEXITY_*`/`PPLX` key in `.env.local`. It was discussed for reviewer ID (see [[project-reviewer-identity-resolution-phase1]]) but never wired in.
**To decide:** what role should it play — web-search-grounded disambiguation (current affiliation, "is this the same person"), candidate discovery, or none? Compare against the existing SerpAPI/Scholar/ORCID enrichment path.

See [[project-reviewer-apps-redesign-direction]] for the workbench direction these feed.
