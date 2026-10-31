---
title: Proposal Context Extraction Plan
domain: general
kind: plan
status: historical
summary: "Historical proposal for expanded structured context; existing dataExtract consumers do not establish the proposed schema or universal input contract."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/PROMPT_CACHING_PLAN.md
  - docs/WORKFLOW_CHAINING_DESIGN.md
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md
---

# Proposal Context Extraction Plan

**Created:** 2026-04-17 (Session 103)
**Status:** Historical design proposal; implementation and architecture are not approved by this document.

> **Current-state note (source-only review, 2026-10-31; no live probes):** A narrower `wmkf_ai_dataextract` surface already exists in source: Workbench reads it, the cycle-dossier snapshots it into `priorAiContext`, and the Executor can persist prompt-declared outputs to it. This does not prove the proposed A/B/C field set or the full list of downstream consumers. The successor Review Panel uses a frozen narrative-centered DTO with request identity, institution and title (`lib/services/review-panel-input.js`) and excludes the extract. The concept evaluator's eligibility flag is a separate concept-PDF flow. This plan's cycle scenario, expanded field list, token/cost arithmetic, model assumptions, and API/Dataverse implementation sequence are historical hypotheses; obtain current owner decisions and define actual consumers before expanding or reusing them.

## Motivation

The original 2026-04 scenario assumed separate Phase I and Phase II submissions in the upcoming cycle.

It then hypothesized a later single-package cycle with an initial AI pass and staff-selected deeper evaluation. That future-cycle premise is not a current cycle decision established here.

The original design proposed expanding structured context in Dynamics so selected downstream calls could read curated extracts. Its token sizes and proposed universal downstream reuse are assumptions, not current measurements or requirements. The narrower existing `wmkf_ai_dataextract` field does not establish this broader architecture.

## Why this matters more than it looks at first

The original proposal identified three possible ROI amplifiers. Its provider mix, call counts, model prices, and usage volumes are dated assumptions, not a current cost estimate:

1. **Expensive models.** When we move deeper-touch workflows to Opus or extended-thinking models, per-token cost is 5–10× Sonnet. Context savings matter correspondingly more. A compliance screen on a 5-page PDF with images might be $0.25 under Opus; against pre-extracted context, $0.03.

2. **Multi-model panel work.** The legacy Virtual Review Panel described in this estimate was retired 2026-10-04. Its successor Review Panel has a different configured-seat design and narrative-centered input contract. The old four-provider call-volume arithmetic does not describe the successor.

3. **Chain depth.** Any one proposal advancing to deep-dive may hit 5–10 downstream calls (reviewer match, panel claim-verification, panel structured-review, panel devil's-advocate, panel synthesis, compliance, staff Q&A). At 7K vs. 1.5K per call × 8 calls, that's ~44K tokens saved per advancing proposal.

Note: this is **not a prompt-caching play** — it's a pre-extraction play. The two are complementary. Caching helps within a session (same prompt prefix reused within the 5-min TTL). Pre-extraction helps across days/weeks (context extracted once, reused forever).

Worth knowing: Session 103's ~2,048-token Sonnet 4.6 result is a dated empirical observation,
not current model guidance. Anthropic now documents a 1,024-token minimum for Sonnet 4.6; use
the concrete model's current floor from [Anthropic's prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
The original architectural hypothesis was that selected downstream calls could
use smaller curated extracts. No universal consumer contract or current ~1.5K-token
input size is established; each workflow must validate its own required context.
See `docs/PROMPT_CACHING_AUDIT.md`.

## What to capture in the initial pass

Three categories, ranked by downstream ROI.

### A. Token-expensive scientific decomposition (highest value)

Things a deep-dive call would otherwise re-extract from the raw text:

| Field (proposed name) | Content | Downstream use |
|---|---|---|
| `wmkf_ai_centralquestion` | Verbatim quote of the central research question | Panel review, reviewer matching, classification |
| `wmkf_ai_hypotheses` | JSON array of hypotheses (numbered, paraphrased) | Panel review, claim verification |
| `wmkf_ai_specificaims` | JSON array `[{aim, methods, outcomes}]` | Feasibility analysis, reviewer matching |
| `wmkf_ai_methodssummary` | 200–400-word methods-only condensation | Feasibility review, equipment/expertise matching |
| `wmkf_ai_preliminarydata` | Key preliminary results cited | Feasibility, novelty assessment |
| `wmkf_ai_innovationclaims` | What the proposal claims is novel | Novelty evaluation, prior-art checking |
| `wmkf_ai_expecteddeliverables` | What's produced when the project ends | Impact assessment, classification |

### B. Review-matching metadata (moderate value, enables new workflows)

Computed once, reused every time we search for reviewers or run a panel:

| Field | Content |
|---|---|
| `wmkf_ai_requiredexpertise` | JSON array of expertise tags needed to review well |
| `wmkf_ai_competinggroups` | Labs/institutions cited as doing related work (COI candidates) |
| `wmkf_ai_citedauthors` | Key PI collaborators cited (COI filtering input) |
| `wmkf_ai_methodstags` | Standardized method tags (single-cell RNA-seq, CRISPR, etc.) |
| `wmkf_ai_disciplinetags` | Subfield taxonomy tags |
| `wmkf_ai_equipmentrequired` | Specialized equipment/facilities mentioned |

### C. Verbatim passages (lower volume, high targeted value)

Critical quotes that downstream prompts can reference without re-parsing:

| Field | Content |
|---|---|
| `wmkf_ai_budgetsummary` | Budget paragraph verbatim or structured JSON |
| `wmkf_ai_keyclaims` | Top 3–5 quantitative/qualitative claims needing verification (panel claim-verification input) |
| `wmkf_ai_teamsummary` | PI/co-PI roles, track record highlights |

## Downstream economics

Per-call input-token comparison for the same 5-page proposal:

| Call type | Today (full proposal) | Post-extraction |
|---|---|---|
| Reviewer-finder expertise match | ~7K tok | ~1.5K tok |
| Panel claim-verification | ~7K tok | ~500 tok (key claims only) |
| Panel structured review | ~7K tok | ~2K tok (aims + methods + prelim) |
| Panel devil's advocate | ~7K tok | ~2K tok |
| Panel synthesis | ~7K tok | ~2K tok |
| Compliance screen | ~7K tok | ~1K tok (budget + team) |
| Staff deep-dive Q&A | ~7K tok/turn | Full proposal only when question demands it |

### Sample arithmetic for one advancing proposal

- Pre-extraction: ingest once, ~7K tok (with images in user-side path: ~15K tok)
- 8 downstream calls at full-proposal-as-context: 8 × 7K = **56K tokens** of input
- 8 downstream calls post-extraction: 8 × 1.7K = **13.6K tokens** of input
- **Savings per proposal: ~42K input tokens**

Multiplied by providers (panel = 4-way fan-out, so 3 extra providers also skip the full proposal): savings climb to ~170K tokens per advancing proposal across the panel stages alone.

The dollar savings above are historical scenario arithmetic only. They are not a current forecast; remeasure against approved workflows, actual documents, current models, and current prices before using them.

## Connection to existing plans

- `docs/WORKFLOW_CHAINING_DESIGN.md` — the historical proposal linked an initial extraction output to later inputs. It does not establish that every downstream stage reads these fields; current consumers must be traced independently.
- `docs/PROMPT_STORAGE_DESIGN.md` — the old design proposed a prompt row and structured-output schema. No current row or schema for the full A/B/C shape is established here.
- `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` — historical proposal to extend the existing AI field surface; this plan does not establish that the listed fields or columns were approved or added.
- Memory: `wmkf_ai_dataextract` was previously deferred. This document proposed candidate fields but did not settle the contract; the capture shape remains undecided.

## Design decisions still open

1. **Multi-output prompt vs. multiple focused passes?** One big structured Claude call producing categories A+B+C together, or 2–3 focused calls?
   - **One call:** cheaper (single proposal ingest), simpler workflow, one `wmkf_ai_run` audit row.
   - **Multiple calls:** better quality per category, easier to rerun one category on a prompt improvement, each can use a different model.
   - **Likely:** one multi-output call with a well-designed JSON schema. Claude handles this well at Sonnet.

2. **JSON-in-Memo vs. individual columns?**
   - **JSON-in-Memo:** flexible, cheap to add fields, not searchable in Dynamics views.
   - **Individual columns:** searchable, filterable, rigid.
   - **Likely hybrid:** individual columns for fields we know we want to filter/aggregate on (`disciplinetags`, `budgetsummary` structured bits, `verdict`, `centralquestion`), JSON Memo for arrays we won't filter (aims, hypotheses, claims, cited authors).

3. **Freshness / re-extraction policy.** When the ingest prompt improves, do we:
   - Leave old extractions alone (treat them as snapshots tied to a prompt version)
   - Re-run affected proposals on demand
   - Re-run automatically via backend job
   - **Likely:** snapshot-with-version, re-run on demand driven by staff.

4. **Proposal format drift.** Extraction assumes a certain structural regularity (distinct "Aims" section, bibliography, etc.). Grant format varies; Keck will standardize the template for the single-phase cycle. The extraction prompt will need to be resilient to format variation but can optimize for the standardized template once locked.

5. **What we don't need to capture.**
   - Full proposal text (already in SharePoint; reference by link)
   - Things cheap to re-derive (word count, section counts)
   - Format-specific artifacts that won't generalize across cycles
   - PI names/institution already captured by Dynamics record fields

## Historical Suggested Implementation Order (Not Authorized)

1. Connor adds the proposed fields to `akoya_request` (ideally named consistently with v3 AI fields spec)
2. Define the JSON output schema for the extraction in `wmkf_ai_promptoutputschema`
3. Write the ingest prompt — one structured-output Claude call producing all A/B/C
4. Build an `/api/proposal-ingest` endpoint (or PA flow, or both) that runs the ingest and writes all fields
5. Refactor reviewer-finder / panel / compliance prompts to read from the extracted fields instead of the full proposal
6. A/B test: same proposal with full-proposal context vs. extracted-field context. Measure: output quality (blind-graded by staff), token cost, latency
7. Roll forward once A/B validates quality

## Historical Deferrals (Not Current Schedule)

- Not building this for the current or next grant cycle. The payoff lives in the single-phase cycle when deep-dive work happens on the same docs the initial pass processed.
- Not retrofitting existing Phase II apps — they operate on different documents (Phase II is a separate, more detailed proposal today).
- Not over-engineering the schema. Start with a minimal set of fields that serve known downstream workflows; add more as new deep-dive patterns emerge.
