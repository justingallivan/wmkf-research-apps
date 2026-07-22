---
title: Proposal Context Extraction Plan
domain: general
kind: plan
status: active
summary: "Created: 2026-04-17 (Session 103) Status: Planning — relevant to single-phase cycle (two cycles out)."
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
**Status:** Planning — relevant to single-phase cycle (two cycles out)

## Motivation

In the upcoming grant cycle we still have separate Phase I and Phase II submissions. Phase I runs at volume (hundreds of proposals, automated low-touch processing); Phase II runs at lower volume with higher-touch work (reviewer finding, deep dives, virtual panels).

In the cycle after that, there will be **no separate Phase I/II submission** — each institution submits one proposal. All proposals get an initial Claude pass producing Phase-I-like outputs. Staff then select which proposals advance to deeper evaluation. The critical difference from the prior cycle: **no new information arrives for advanced proposals.** The deeper evaluation re-reads the same document we already processed.

That's an opportunity. If the initial pass captures the right structured context and stores it in Dynamics, every downstream call can read curated extracts (~1–2K tokens) instead of the full proposal (5–7K tokens of text, potentially 12–20K with PDF images). The savings compound across deeper-touch workflows — reviewer matching, multi-LLM panels, compliance screens, staff Q&A.

## Why this matters more than it looks at first

Three amplifiers push the ROI higher than raw per-call savings suggest:

1. **Expensive models.** When we move deeper-touch workflows to Opus or extended-thinking models, per-token cost is 5–10× Sonnet. Context savings matter correspondingly more. A compliance screen on a 5-page PDF with images might be $0.25 under Opus; against pre-extracted context, $0.03.

2. **Multi-LLM panel work.** Virtual Review Panel calls Claude + GPT + Gemini + Perplexity per stage. If we give each provider the full proposal, context cost is 4× per stage. If we give them pre-extracted structured context, the saving multiplies by the provider count. Panel runs are already 343 calls/year and growing.

3. **Chain depth.** Any one proposal advancing to deep-dive may hit 5–10 downstream calls (reviewer match, panel claim-verification, panel structured-review, panel devil's-advocate, panel synthesis, compliance, staff Q&A). At 7K vs. 1.5K per call × 8 calls, that's ~44K tokens saved per advancing proposal.

Note: this is **not a prompt-caching play** — it's a pre-extraction play. The two are complementary. Caching helps within a session (same prompt prefix reused within the 5-min TTL). Pre-extraction helps across days/weeks (context extracted once, reused forever).

Worth knowing: Session 103's ~2,048-token Sonnet 4.6 result is a dated empirical observation,
not current model guidance. Anthropic now documents a 1,024-token minimum for Sonnet 4.6; use
the concrete model's current floor from [Anthropic's prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
The architectural point still holds: once extraction lives in Dynamics, downstream calls are
designed to be small (~1.5K tokens of curated fields) and do not need full-proposal context.
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

At Sonnet 4.6 pricing: ~$0.50 saved per advancing proposal. At Opus pricing: ~$2.50 saved. Across 100 advancing proposals/cycle and a panel model mix, we're talking $200–500/cycle in direct savings, plus meaningful latency improvements.

## Connection to existing plans

- `docs/WORKFLOW_CHAINING_DESIGN.md` — this doc is the "ingest" side of ingest-once/chain-downstream. The extraction here is the *output* of the initial multi-output prompt; every downstream stage reads these fields as *input*.
- `docs/PROMPT_STORAGE_DESIGN.md` — the initial-pass prompt goes in `wmkf_ai_prompt` like any other. Its structured-output schema lives in `wmkf_ai_promptoutputschema` (single row defining the full extraction shape above).
- `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` — needs extension with the field set above. Connor would add the columns and choose the `wmkf_ai_` vs `wmkf_` naming convention (same open question as the rest of the AI fields).
- Memory: `wmkf_ai_dataextract` was deferred "until the capture shape is settled." **This is the capture shape.**

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

## Implementation order (when we get here)

1. Connor adds the proposed fields to `akoya_request` (ideally named consistently with v3 AI fields spec)
2. Define the JSON output schema for the extraction in `wmkf_ai_promptoutputschema`
3. Write the ingest prompt — one structured-output Claude call producing all A/B/C
4. Build an `/api/proposal-ingest` endpoint (or PA flow, or both) that runs the ingest and writes all fields
5. Refactor reviewer-finder / panel / compliance prompts to read from the extracted fields instead of the full proposal
6. A/B test: same proposal with full-proposal context vs. extracted-field context. Measure: output quality (blind-graded by staff), token cost, latency
7. Roll forward once A/B validates quality

## Not doing (for now)

- Not building this for the current or next grant cycle. The payoff lives in the single-phase cycle when deep-dive work happens on the same docs the initial pass processed.
- Not retrofitting existing Phase II apps — they operate on different documents (Phase II is a separate, more detailed proposal today).
- Not over-engineering the schema. Start with a minimal set of fields that serve known downstream workflows; add more as new deep-dive patterns emerge.
