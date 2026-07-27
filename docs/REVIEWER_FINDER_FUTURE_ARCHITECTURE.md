---
title: "Reviewer Finder — historical architecture sketch"
domain: reviewer-identity
kind: spec
status: historical
summary: "Historical Session 110 design sketch; current reviewer architecture and migration state are documented in the linked canonical pages."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md
  - docs/REVIEWER_ARCHITECTURE.md
  - lib/services/
  - lib/services/discovery-service.js
---

# Reviewer Finder — historical architecture sketch

> **Superseded historical sketch.** This document records Session 110
> (2026-04-25). The Dataverse migration it treated as future completed in
> W3–W6. Migration 018 then dropped the historical Postgres `researchers`,
> `publications`, `researcher_keywords`, `reviewer_suggestions`, and
> `proposal_searches` tables on 2026-06-04. Postgres `grant_cycles` alone
> remains as a drain-only snapshot; live grant-cycle authority is Dataverse.
> Current reviewer state lives in `wmkf_potentialreviewer` and
> `wmkf_appreviewersuggestion`. Use `docs/REVIEWER_ARCHITECTURE.md` for current
> architecture and `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` for migration
> history. The prose below is retained as drafting-time rationale, not an
> implementation checklist or current-state contract.

**Status:** Historical design sketch (Session 110, 2026-04-25), superseded by
the current architecture and migration records linked above.
**Historical trigger:** Justin called Reviewer Finder out as the most
complicated app and needed it soon after the May 1 cycle.
**Owner:** Justin (Vercel implementation), Connor (Wave 2 Dataverse migration when researcher/publication tables move)

## Summary

Reviewer Finder is **not** a tool-use agent. It's a multi-step orchestration of:
1. Single-shot Claude calls (proposal analysis, search-strategy generation, candidate scoring)
2. External API fetches (PubMed, arXiv, BioRxiv, ChemRxiv, ORCID, OpenAlex; SerpAPI for contact lookup — Scholar metrics/literature migrated to OpenAlex S251)
3. Drafting-time Postgres pool lookups (the historical `researchers` /
   `publications` tables), deduplication, and COI filtering
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

At drafting time, results still landed in the historical Postgres
`proposal_searches` and `reviewer_suggestions` tables. That persistence
statement is no longer current: both tables were dropped by migration 018, and
reviewer suggestion state now persists in Dataverse.

## Historical scope boundary

- **External API services** (`pubmed-service.js`, `arxiv-service.js`, `orcid-service.js`, `serp-contact-service.js`, etc.) — stay in `lib/services/`. Not Claude calls; not relevant to prompt storage.
- **Discovery orchestration** (`lib/services/discovery-service.js`, 1464 lines) — the large state machine that fans out external API calls and merges results stays put. Way too much logic to fit in a prompt.
- **Deduplication / COI filtering** (`deduplication-service.js`) — pure data work, not AI.
- **Streaming SSE** in `discover.js` — that's how progress reaches the UI. Stays at route level. The Executor is synchronous; progress events happen *between* Executor calls.
- **Historical Postgres data boundary.** The sketch treated `researchers`,
  `publications`, `proposal_searches`, and `reviewer_suggestions` migration as a
  later independent track. That track completed, and migration 018 dropped the
  four tables.

## Why this matters

The fear was that Reviewer Finder would need `executeAgent()` (a tool-use companion to `executePrompt()`) and that would be a huge build. Reading the actual code makes it clear that's not the case. The contract's "out of scope: tool-use loops" exclusion does not block Reviewer Finder.

At drafting time, the proposed prompt work consisted of authoring prompt rows,
route refactors, and smoke testing. This estimate is historical and must not be
used as a current work queue.

## When `executeAgent()` IS needed

Eventually we may want a true agent loop somewhere — most likely for:
- **Dynamics Explorer chat** (already implemented as a custom tool-use loop in `pages/api/dynamics-explorer/chat.js`; could be migrated to share infrastructure)
- A future "Research Question Decomposition" agent that iteratively refines a proposal's key questions through tool-use against the literature

But none of these are blocking. Reviewer Finder migrates cleanly without it. Defer `executeAgent()` until there's a second concrete caller asking for the same shape.

## Historical proposed sequence

The numbered sequence below records the proposal made in April 2026. It is not
a current checklist; verify each prompt path against source and
`docs/PROMPT_STORAGE_DESIGN.md` before treating it as shipped or outstanding.

1. **Author the two prompt rows** in `wmkf_ai_prompt` (Session 111, ahead of route refactor). Source-of-truth templates live at `shared/config/prompts/reviewer-finder-dynamics.js`; seed via `scripts/seed-reviewer-finder-prompts.js`. Naming: `reviewer-finder.analyze`, `reviewer-finder.score-candidates`.
2. **Refactor `analyze.js`** to call `executePrompt('reviewer-finder.analyze', ...)` with the four override variables. Route still owns post-parse via `parseAnalysisResponse`. Smallest call site; good warm-up.
3. **Refactor `discover.js` / `claude-reviewer-service.js`** to use `executePrompt('reviewer-finder.score-candidates', ...)` per batch inside `generateDiscoveredReasoning`. Streaming SSE stays at the route level — emit progress events between Executor calls.
4. **Smoke test** end-to-end against a known proposal.
5. **Independent Dataverse track — completed differently from this forecast.**
   Reviewer person and suggestion authority moved to Dataverse; migration 018
   dropped the historical Postgres `researchers`, `publications`,
   `proposal_searches`, and `reviewer_suggestions` tables.

## Historical open questions

- **Caching strategy.** `reviewer-finder.analyze` reads the proposal text every time. If staff run the analyzer multiple times on the same proposal during a session, prompt cache helps (5-min TTL). If runs are days apart, caching doesn't help. No action needed in Phase 0; mention to Justin if observed.
- **Score-candidates input size.** When the candidate list from external APIs is large (50+ researchers), it can blow past Claude's context window. Currently `discovery-service` pre-filters; verify the filter is tight enough before migrating.
- **Per-user customization.** Reviewer Finder has heavily-customized search workflows per user (saved preferences, COI lists, expertise weighting). The Executor's `overrideVariables` covers per-call customization; saved per-user defaults live in Dataverse `wmkf_appuserpreferences` (Wave 1 retired 2026-05-12). No new mechanism needed.
