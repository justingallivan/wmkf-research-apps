---
title: "Workflow Chaining & Token Efficiency (Design Principle)"
domain: prompt-executor
kind: spec
status: active
summary: "Chaining fields and Vercel Executor persistence are live; the end-to-end Power Automate DAG remains unbuilt target architecture."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/BACKEND_AUTOMATION_PLAN.md
  - docs/GRANT_CYCLE_LIFECYCLE.md
---

# Workflow Chaining & Token Efficiency (Design Principle)

**Status:** Active design principle with a mixed implementation boundary.
**Owner:** Justin Gallivan
**Related docs:** `docs/PROMPT_STORAGE_DESIGN.md`, `docs/BACKEND_AUTOMATION_PLAN.md`, `docs/GRANT_CYCLE_LIFECYCLE.md`

## Current implementation boundary (reconciled 2026-07-27)

The Vercel-side foundation is shipped: the six `akoya_request` fields
`wmkf_ai_keywords`, `wmkf_ai_methodologies`, `wmkf_ai_riskflags`,
`wmkf_ai_teaminfo`, `wmkf_ai_budgetsummary`, and `wmkf_ai_timeline` are in the
tracked/deployed schema; prompt rows can declare
`wmkf_ai_promptoutputschema`; and the Executor can parse structured output and
coalesce declared targets onto the request write.

The end-to-end lifecycle DAG below remains **TARGET ARCHITECTURE**. A read-only
production probe on 2026-07-27 scanned all 114 cloud-flow definitions visible
to the Dataverse application user; none referenced any `wmkf_ai_*` field/table,
the Executor routes, Claude/Anthropic, or the WMKF Vercel app. The current
production PA ingest/chaining DAG is therefore **NOT DEPLOYED in the visible
flow metadata**. No current PA producer populates all six fields as this design
describes, and the proposed downstream compliance, reviewer-matching,
portfolio, and PD-assignment consumers remain unbuilt.

> Companion to `PROMPT_STORAGE_DESIGN.md`. Storage is about *where prompts live*. This doc is about *how workflows use them* — specifically, how to pass data between steps without re-uploading the source document to Claude on every call.

---

## Principle

**A proposal should be read by Claude as few times as possible.** The first call that receives the full proposal text should extract everything downstream steps will need. Subsequent calls consume structured fields from Dynamics, not the original document.

This is a token-efficiency principle but also a design principle — it forces explicit thinking about what data a workflow produces and consumes, which makes PA flows easier to reason about.

## Three techniques that serve it

Distinct optimizations; naming them separately so we can apply them appropriately:

### 1. Multi-output consolidation in one call

Instead of splitting extraction into multiple Claude calls — Call 1 = summary, Call 2 = keywords, Call 3 = methodologies — ask a single call to return structured JSON with all the fields:

```json
{
  "prose_summary": "...",
  "keywords": ["..."],
  "methodologies": ["..."],
  "risk_flags": ["..."],
  "team_info": {},
  "budget_summary": "...",
  "timeline": "..."
}
```

**Trade-offs:**
- Pro: one call vs. several — saves re-uploads of the input
- Pro: forces an explicit extraction schema, which is good discipline
- Con: complex prompts can degrade the model's attention on individual fields. Not every task is a fit.
- Con: JSON reliability — Claude's JSON output is good but not perfect. Schema validation + malformed-JSON retry is necessary. PA's native JSON handling is brittle; this becomes an argument for hybrid composition.

### 2. Prompt caching (Anthropic `cache_control`)

Mark the stable prefix of a prompt with `cache_control`; Anthropic caches it and subsequent calls to the same prefix within TTL cost ~10% of the cached portion.

**Caveats for backend workflows:**
- Ephemeral cache TTL is ~5 minutes
- PA workflows frequently span more than 5 minutes between steps (human approval gates, scheduled runs, batch processing)
- Net: caching helps Vercel apps where calls cluster in a single user session. For PA flows, either design spatially-tight clusters or accept no cache benefit.

### 3. Intermediate data capture

**The structural fix, and the one we should design the backend around.** First expensive call persists structured outputs to Dynamics fields. Every downstream step reads those fields, not the proposal text.

## Target worked example: Phase I proposal lifecycle

```mermaid
graph TD
    PDF["Proposal narrative +<br/>SharePoint attachments"]
    INGEST["phase-i-writeup<br/>(ingest: one expensive call)"]
    SUMMARY["prose summary<br/>→ akoya_request.wmkf_ai_summary"]
    STRUCT["structured fields<br/>keywords, methodologies,<br/>risk_flags, team_info,<br/>budget_summary, timeline"]

    COMP["compliance-field-set-c<br/>(consumes structured fields)"]
    MATCH["reviewer matching<br/>(future) — consumes<br/>keywords + expertise areas"]
    PORT["portfolio analytics<br/>(future) — consumes<br/>keywords + budget"]
    PD["PD assignment<br/>(future) — consumes<br/>keywords + methodologies"]

    PDF --> INGEST
    INGEST --> SUMMARY
    INGEST --> STRUCT
    STRUCT --> COMP
    STRUCT --> MATCH
    STRUCT --> PORT
    STRUCT --> PD
```

One call reads the proposal. Four or five downstream steps read structured fields instead. Rough savings for five downstream tasks on a 50k-token proposal: 5 × 50k = 250k input tokens collapses to 50k (ingest) + maybe 5 × 2k (downstream reads of structured fields). Order-of-magnitude win, and the downstream calls also complete faster.

## What this changes about prompt design

### Prompts declare their outputs

Today's Vercel prompts return unstructured markdown. Target-state Pattern A prompts should declare their structured outputs explicitly, so downstream callers and the dashboard know what fields they produce:

```json
// wmkf_ai_prompt.wmkf_ai_promptoutputschema for phase-i-writeup
{
  "prose_summary": {
    "type": "markdown",
    "target": "akoya_request.wmkf_ai_summary",
    "description": "The 500-600 word Phase I writeup"
  },
  "keywords": {
    "type": "string[]",
    "target": "akoya_request.wmkf_ai_keywords",
    "description": "5-10 keywords characterizing the research area"
  },
  "methodologies": {
    "type": "string[]",
    "target": "akoya_request.wmkf_ai_methodologies",
    "description": "Key experimental approaches and techniques"
  },
  "risk_flags": {
    "type": "string[]",
    "target": "akoya_request.wmkf_ai_riskflags",
    "description": "Compliance or feasibility concerns for downstream screening"
  }
}
```

### Prompt chaining is first-class

A downstream prompt's `wmkf_ai_promptvariables` can reference upstream prompt outputs rather than raw inputs:

```json
// wmkf_ai_prompt.wmkf_ai_promptvariables for compliance-field-set-c
{
  "summary": {"source": "akoya_request.wmkf_ai_summary"},
  "keywords": {"source": "akoya_request.wmkf_ai_keywords"},
  "risk_flags": {"source": "akoya_request.wmkf_ai_riskflags"},
  "team_info": {"source": "akoya_request.wmkf_ai_teaminfo"}
}
```

Compliance doesn't re-read the proposal. It reads the structured outputs the ingest step produced.

## Historical prerequisites and current disposition

The original blockers classify as follows:

1. **Dynamics schema additions — SHIPPED.** The deployed logical names are the
   six `wmkf_ai_*` fields listed in the current boundary above, not the
   underscore-heavy draft names in the original sketch.

2. **Prompt output declaration — SHIPPED on Vercel.**
   `wmkf_ai_promptoutputschema` is provisioned and consumed by the Executor.
   A generalized automatic `{source:"..."}` input resolver is not established
   by this document and should not be assumed.

3. **PA flow complexity — PLANNED/UNBUILT.** The 2026-07-27 production probe
   found no prompt-Executor flow. Any future PA ingest flow still needs
   equivalent parse, validation, coalesced write, and retry behavior.

4. **Validation parity — VERCEL SHIPPED / PA UNBUILT.** Vercel Executor
   structured parsing/output checks are live. There is no deployed PA side
   against which to claim validation/retry parity.

## Honest caveats

**Not every task can chain from extractions.** Tasks that require nuanced judgment about the full proposal — deep methodology critique, review drafting, Q&A on specific sections — still have to go back to the source. The principle is "chain when downstream can be served by upstream extraction," not "never re-read."

**Multi-output prompts can hurt quality.** Consolidating 8 extractions into one call sometimes produces worse individual outputs than focused extractions. Empirically check per-prompt. The editor test-run mechanism in `PROMPT_STORAGE_DESIGN.md` is the right tool — run the draft against a known input and inspect each structured output field.

**Re-running the ingest.** If downstream consumers change (new field needed), the ingest prompt either grows (adds output slots) or a second ingest-style prompt is created that re-reads the proposal once. Rare in steady state but will happen during rollout. Append-only prompt versioning handles this cleanly — ingest v2 produces more fields than v1, and the old versions stay queryable.

**Prompt caching and chaining are complementary, not alternatives.** Even in chained workflows, the ingest call itself can still cache its system-prompt prefix across multiple proposals in a single batch run. Both techniques stack.

## Relationship to PROMPT_STORAGE_DESIGN.md

The storage design is about *where prompts live* and *how they're versioned*. This doc is about *how workflows use them* to pass data between steps.

This doc's principles add to the storage design:
- A new column in `wmkf_ai_prompt`: `wmkf_ai_promptoutputschema`
- Possibly: extended `wmkf_ai_promptvariables` entries with `source:` references to upstream outputs
- A design assumption that the first call in a workflow is an "ingest" call that produces data for many downstream callers
- A reshaping of the Phase I writeup prompt itself: in the target state it's an *ingest* prompt producing structured fields, not just a prose-summary prompt

## Out of scope for this doc

- Specific list of which Dynamics fields to add on `akoya_request` — separate schema exercise with Connor
- PA flow-by-flow authoring — belongs in `BACKEND_AUTOMATION_PLAN.md`
- Real-time eval of whether chained outputs match what direct re-read would produce — A/B eval exercise, deferred
- Reshaping Pattern B / C Vercel apps around this principle — most Vercel apps are already single-call-per-user-action; this work is primarily a backend concern
