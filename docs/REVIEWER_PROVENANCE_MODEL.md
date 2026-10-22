---
title: "Reviewer Finder — what \"Claude-suggested\" means in the provenance model"
domain: reviewer-identity
kind: source-of-truth
status: canonical
summary: "Historical S232 migration; current seven-kind provenance and grounded-ranking membership, without implying candidate-origination flows shipped."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
---

# Reviewer Finder — what "Claude-suggested" means in the provenance model

This document preserves the **Session 232 provenance-DTO migration** as historical
context. **[VERIFIED via `lib/utils/reviewer-provenance.js` 2026-10-22]** The
current helper accepts seven provenance kinds and includes three kinds in its
grounded-ranking bonus. A kind being accepted by that helper does not
prove that a corresponding candidate-origination flow has shipped. The S232
ranking-delta analysis near the end is a dated snapshot, not a guarantee about the
current pipeline.

## Current model and S232 context

In the **old** model there was a binary axis: a candidate was either a *Claude
suggestion* or a *database discovery*, and being Claude-suggested earned a +25
ranking bonus and its own UI section.

In the S232 Track A/Track B model that axis was replaced. The provenance axis is
**groundedness, not "did Claude touch it."** Claude is demoted from a *candidate
source* to a **query
seed generator**. In that workflow, a name Claude proposes is only a *hypothesis*;
it becomes a literature-retrieved candidate only if the literature grounds it:

- **Claude name that verifies in PubMed** → `provenance.kind = literature_retrieved`
  — **identical** to a database-discovered author. The only residue that Claude
  originated it is the legacy `isClaudeSuggestion: true` flag and
  `seedRole: query_seed`. It gets no Claude-originated +25 bonus and sits in the
  same UI group as DB discoveries; the seed origin adds no current
  grounded-provenance bonus.
- **Claude name that cannot be grounded** → `provenance.kind = barred_parametric`
  — an ungrounded parametric invention, grouped under **"Needs identity review"**
  and (`[PROPOSED]` end-state) slated to be dropped silently.

So in this model, **"Claude-suggested" is not a provenance category.** There is no
`claude_suggestion` kind, no Claude-vs-database split, and no +25 for being
Claude-suggested. Claude proposes *query seeds*; the databases decide who is a real
candidate.

## Historical workflow (S232, with S248/S253 updates)

```mermaid
flowchart TD
    P[Proposal PDF] --> A["Stage 1 — Claude analyze<br/>(analyzeProposal)"]
    A --> S["reviewerSuggestions[]<br/>names from Claude's parametric memory"]
    A --> Q["analyze PART 3 → searchQueries — REMOVED S253<br/>(was per-database TOPIC queries feeding Track B;<br/>dropped with PART 3 when Track B was archived off S248)<br/>[future successor if grounded origination revisited: schema-constrained sourcePlan]"]
    A --> I["proposalInfo + COI context"]

    S --> TA{{"Track A — verify EACH suggested<br/>name in PubMed (verifyClaudeSuggestions)"}}
    Q --> TB{{"Track B — literature search (ARCHIVED OFF S248)<br/>PubMed / arXiv / bioRxiv / chemRxiv"}}

    TA -->|"≥3 pubs AND full-forename match<br/>(S231 forename gate)"| V["VERIFIED candidate<br/>source = claude_suggestion<br/>verificationSource = pubmed"]
    TA -->|"initial-only match / &lt;3 pubs / no person"| U["UNRESOLVED<br/>(pushed to unverified[])"]

    TB --> D["Discovered author<br/>source = pubmed|arxiv|biorxiv|chemrxiv"]

    V --> VP["provenance.kind = literature_retrieved<br/>sources = [pubmed]<br/>seedRole = query_seed<br/>isClaudeSuggestion = true  (legacy seed marker only)"]
    U --> UP["provenance.kind = barred_parametric<br/>sources = []<br/>ungrounded parametric invention"]
    D --> DP["provenance.kind = literature_retrieved<br/>sources = [the search source]<br/>isClaudeSuggestion = false"]

    VP --> G1["UI group: Literature-retrieved"]
    DP --> G1
    UP --> G2["UI group: Needs identity review"]

    G1 --> R["Historical S232 ranking terms (relevance-score.js):<br/>recency 0–35 · affiliation 10 · multi-source 0–10 · keyword 0–10<br/>grounded +25 bonus = cited_reference / proposal_named ONLY<br/>→ literature_retrieved gets NO bonus"]
    G2 --> R

    classDef barred fill:#fde8e8,stroke:#c0392b;
    classDef grounded fill:#e8f5e9,stroke:#2e7d32;
    class UP,G2 barred;
    class VP,DP,G1 grounded;
```

## Why a verified-Claude candidate is `literature_retrieved`, not its own kind

The historical S232 path in `discovery-service.js` built a Claude suggestion that
passed PubMed verification with `withReviewerProvenance({...suggestion,
source:'claude_suggestion', verificationSource:'pubmed'}, {kind:
LITERATURE_RETRIEVED, sources:['pubmed'], seedRole: QUERY_SEED})`. The candidate was
*grounded against real PubMed publications* — that grounding is what makes it a
candidate, so its provenance is `literature_retrieved`, the same as any author
pulled from a literature search. "Claude proposed the name" is recorded only as the
`seedRole` and the legacy `isClaudeSuggestion` boolean — neither is a provenance
kind, and neither earns a ranking advantage.

## Current provenance kind vocabulary

**[VERIFIED via `lib/utils/reviewer-provenance.js` 2026-10-22]** The helper
accepts the seven kinds in this table.

| `provenance.kind` | Grounded by | Today's pipeline | Disposition |
|---|---|---|---|
| `cited_reference` | A cited reference | Accepted by the provenance helper; origination flow is not established by kind membership alone | Included in grounded-ranking bonus |
| `proposal_named` | A person named in proposal text | Accepted by the provenance helper; origination flow is not established by kind membership alone | Included in grounded-ranking bonus |
| `applicant_suggested` | the applicant | existing flow | Own UI group |
| `referred` | A contacted reviewer suggested the person | Implemented referral capture; see `REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md` and its current-contract section | Included in grounded-ranking bonus; identity-review-exempt |
| `literature_retrieved` | Literature evidence | S232 recorded a Track A path; current Track A origination is not established by kind membership here. Track B was archived off S248. | No grounded-provenance bonus |
| `grounded_seed` | a query seed that grounded | Accepted by the provenance helper; no origination claim implied | No grounded-ranking bonus |
| `barred_parametric` | No external grounding recorded | Accepted by the provenance helper | Needs identity review |

## S232 legacy `isClaudeSuggestion` flag (and why)

In the S232 snapshot, `isClaudeSuggestion` was still set (`true` for Track A,
`false` for Track B) and rode on the candidate during migration, but it was **no longer
authoritative**: provenance, the UI grouping, and the ranking bonus all read
`provenance`, never `isClaudeSuggestion`. The flag remains only so legacy
roster/save/UI reads don't break mid-migration. Provenance is **never** inferred
from it (`reviewer-provenance.js`).

## Historical S232 ranking-delta analysis

The following analysis describes the Session 232 code/sample only. Later provenance
kinds and source changes mean it must not be read as the current universal ranking
delta.

Two things change for a verified-Claude (Track-A) candidate: it is now
`literature_retrieved` so it loses the +25 grounded bonus, **and**
`claude_suggestion` no longer counts as a corroborating "source" so its
multi-source bonus falls 10→5.

**Analytically guaranteed for that S232 code snapshot** (recency/affiliation/keyword terms
are untouched, so they cancel in the delta):
- Every Track-A candidate drops **exactly 30 points** (−25 bonus, −5 multi-source);
  every Track-B candidate is **unchanged (0)**. This holds because Track A only ever
  grounds via PubMed (`verificationSource:'pubmed'`, `source:'claude_suggestion'`),
  so the old multi-source count is always 2 and the new is always 1.
- A uniform −30 shift applied to one subset **cannot reorder candidates within that
  subset**, so verified-Claude candidates keep their relative order, and **the only
  possible reordering is at a Track-A / Track-B boundary** (an A dropping below a B).

> **Note (S248):** Track B is now **archived off** (`DiscoveryService.TRACK_B_ENABLED=false`),
> so the discovered set is empty and there are **no Track-B candidates** in practice — the
> Track-A/Track-B boundary reordering above is **moot** until Track B is re-enabled. The
> per-candidate delta analysis remains valid for the code as written.

**Observed in the Session 232 sample (2 research requests; small, not a population
rate — analyze is stochastic, so candidate sets vary slightly run-to-run):** the
displayed tables were 11 Track-A / 1 Track-B (1002959) and 9 Track-A / 0 Track-B
(1003020). Every Track-A delta printed was −30 and every Track-B delta 0, with no
counter-instance. Both lists were Track-A-dominated, so boundary crossovers were few
(1–2 across runs) — a literature-discovered candidate rising past the weakest
verified-Claude one. How often that fires in general depends on how many Track-B
candidates a request surfaces, which this two-request sample is too small to
quantify.

Absolute `wmkf_relevancescore` compresses ~30 pts for verified candidates, but
nothing gates on an absolute reviewer score (`[VERIFIED]` — ordering/display only).
