---
title: "Reviewer Finder — future architecture sketch"
domain: reviewer-identity
kind: spec
status: active
summary: "Status: Design sketch (Session 110, 2026-04-25). Not yet implemented."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md
  - docs/REVIEWER_ARCHITECTURE.md
  - lib/services/
  - lib/services/discovery-service.js
---

# Reviewer Finder — future architecture sketch

> **Supersession banner (2026-05-19):** This document is a **historical design sketch from Session 110 (2026-04-25)**. The Wave 2 Dataverse migration it describes as "future / orthogonal track" was completed in **W3–W6 (2026-05-12)** — `researchers`, `publications`, `reviewer_suggestions`, `grant_cycles`, `proposal_searches` are now drain-only Postgres tables with no live application readers/writers; live reviewer state lives in Dataverse `wmkf_potentialreviewer` (which since the S213 collapse carries the bibliometric fields directly — the `wmkf_appresearcher` sidecar was dropped) / `wmkf_appreviewersuggestion` / `wmkf_appgrantcycle`. The prompt-migration analysis in this doc remains useful conceptually; specific claims about "Results still land in Postgres X" are pre-cutover history. See `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` for the actual migration log and `docs/REVIEWER_ARCHITECTURE.md` for current architecture.

**Status:** Design sketch (Session 110, 2026-04-25). Not yet implemented.
**Trigger for implementation:** Justin called Reviewer Finder out as the most complicated app + needed soon after May 1 cycle. This doc plans Session 112+ work.
**Owner:** Justin (Vercel implementation), Connor (Wave 2 Dataverse migration when researcher/publication tables move)

## Summary

Reviewer Finder is **not** a tool-use agent. It's a multi-step orchestration of:
1. Single-shot Claude calls (proposal analysis, search-strategy generation, candidate scoring)
2. External API fetches (PubMed, arXiv, BioRxiv, ChemRxiv, ORCID, OpenAlex; SerpAPI for contact lookup — Scholar metrics/literature migrated to OpenAlex S251)
3. DB lookups (existing `researchers` / `publications` pool, deduplication, COI filtering)
4. SSE streaming for progress updates to the UI

That orchestration *is* complex, but it lives in the **route**, not in the Claude call. Each individual Claude call fits the existing Executor contract today. Reviewer Finder does not require `executeAgent()` or any out-of-contract Executor extension.

## Migration shape

**Reconciled 2026-04-25 against actual code (Session 111):** the live pipeline has **two** Claude calls, not three. `createAnalysisPrompt` already does proposal-metadata extraction + reviewer suggestions + search-query generation in a single call — splitting it into separate `analyze` and `search-strategy` rows is a real prompt rewrite (and parser rewrite) for no Phase 0 benefit. We mirror reality:

Two Claude calls, two prompt rows in `wmkf_ai_prompt`:

| Prompt name | Purpose | Inputs | Outputs |
|---|---|---|---|
| `reviewer-finder.analyze` | Extract proposal metadata + suggest reviewers + emit DB search queries (combined) | `proposal_text`, `additional_notes_block`, `excluded_names_block`, `reviewer_count` (all override) | single delimited-text response (PART 1/2/3) |
| `reviewer-finder.score-candidates` | Given a batch of candidates + proposal summary, mark RELEVANT yes/no with reasoning + seniority | `proposal_summary`, `candidates_list` (override) | single delimited-text response |

Both prompts use **`parseMode: "raw"`** with a single `response_text` output and `target.kind: "none"`. The current text format (`REVIEWER:`/`NAME:`/`RELEVANT: Yes`/etc.) is parsed by hand-rolled regex helpers (`parseAnalysisResponse`, `parseDiscoveredReasoningResponse`); those stay in `reviewer-finder.js` and the route owns post-parsing. End-state JSON migration is a Phase 2 concern — defer until staff actually want to edit the structured output schema. This mirrors the `phase-i.summary` Phase 0 precedent: minimize prompt-text drift on first migration.

Conditional sections in the legacy prompt (`additionalNotes ? ... : ''`, `excludedNames.length > 0 ? ... : ''`) become caller-formatted blocks. The route builds either the full block or `""` and passes it via `overrideVariables`. Same pattern as `summary_length_suffix` in `phase-i.summary`.

Variable kinds: all `override`. The route owns input plumbing (the proposal text comes from upload; the candidate list comes from external APIs after the route runs them). No `dynamics` or `sharepoint` source kinds needed — Reviewer Finder doesn't read from `akoya_request` or SharePoint today.

Results still land in Postgres `proposal_searches` + `reviewer_suggestions` (eventually Dataverse Wave 2 tables, orthogonal to this migration).

## What the migration does NOT change

- **External API services** (`pubmed-service.js`, `arxiv-service.js`, `orcid-service.js`, `serp-contact-service.js`, etc.) — stay in `lib/services/`. Not Claude calls; not relevant to prompt storage.
- **Discovery orchestration** (`lib/services/discovery-service.js`, 1464 lines) — the large state machine that fans out external API calls and merges results stays put. Way too much logic to fit in a prompt.
- **Deduplication / COI filtering** (`deduplication-service.js`) — pure data work, not AI.
- **Streaming SSE** in `discover.js` — that's how progress reaches the UI. Stays at route level. The Executor is synchronous; progress events happen *between* Executor calls.
- **Postgres data** (`researchers`, `publications`, `proposal_searches`, `reviewer_suggestions`) — Wave 2 of the migration plan moves these to Dataverse later. Orthogonal to the prompt migration; can happen on its own track.

## Why this matters

The fear was that Reviewer Finder would need `executeAgent()` (a tool-use companion to `executePrompt()`) and that would be a huge build. Reading the actual code makes it clear that's not the case. The contract's "out of scope: tool-use loops" exclusion does not block Reviewer Finder.

The migration is real work — three prompts to author, route refactors to wire `executePrompt` into each call site, smoke testing — but it's mechanical, in the same shape as the Phase 0 work just shipped. Probably 1.5–2 sessions, post-cycle.

## When `executeAgent()` IS needed

Eventually we may want a true agent loop somewhere — most likely for:
- **Dynamics Explorer chat** (already implemented as a custom tool-use loop in `pages/api/dynamics-explorer/chat.js`; could be migrated to share infrastructure)
- A future "Research Question Decomposition" agent that iteratively refines a proposal's key questions through tool-use against the literature

But none of these are blocking. Reviewer Finder migrates cleanly without it. Defer `executeAgent()` until there's a second concrete caller asking for the same shape.

## Sequenced plan (post-cycle)

1. **Author the two prompt rows** in `wmkf_ai_prompt` (Session 111, ahead of route refactor). Source-of-truth templates live at `shared/config/prompts/reviewer-finder-dynamics.js`; seed via `scripts/seed-reviewer-finder-prompts.js`. Naming: `reviewer-finder.analyze`, `reviewer-finder.score-candidates`.
2. **Refactor `analyze.js`** to call `executePrompt('reviewer-finder.analyze', ...)` with the four override variables. Route still owns post-parse via `parseAnalysisResponse`. Smallest call site; good warm-up.
3. **Refactor `discover.js` / `claude-reviewer-service.js`** to use `executePrompt('reviewer-finder.score-candidates', ...)` per batch inside `generateDiscoveredReasoning`. Streaming SSE stays at the route level — emit progress events between Executor calls.
4. **Smoke test** end-to-end against a known proposal.
5. **(Independent track) Wave 2 Dataverse migration** moves `researchers`/`publications`/`proposal_searches`/`reviewer_suggestions` to Dataverse. Doesn't affect prompt rows; affects where saved candidate state lives. Do this when Postgres bill or staff-facing data discoverability becomes a real driver.

## Open questions

- **Caching strategy.** `reviewer-finder.analyze` reads the proposal text every time. If staff run the analyzer multiple times on the same proposal during a session, prompt cache helps (5-min TTL). If runs are days apart, caching doesn't help. No action needed in Phase 0; mention to Justin if observed.
- **Score-candidates input size.** When the candidate list from external APIs is large (50+ researchers), it can blow past Claude's context window. Currently `discovery-service` pre-filters; verify the filter is tight enough before migrating.
- **Per-user customization.** Reviewer Finder has heavily-customized search workflows per user (saved preferences, COI lists, expertise weighting). The Executor's `overrideVariables` covers per-call customization; saved per-user defaults live in Dataverse `wmkf_appuserpreferences` (Wave 1 retired 2026-05-12). No new mechanism needed.
