---
name: project-reviewer-finder-retrieval-redesign
description: "Reviewer-finder redesign direction (S231): demote Claude from candidate GENERATOR (stale/senior-biased/hallucinated) to query-planner + synthesizer; candidates ORIGINATE from field-routed retrieval (fan-out/fan-in). Full plan: docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md. NOT BUILT."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-07
---

## Recall Rule
Read before any reviewer candidate-sourcing / verification / discovery work. The
durable design lives in `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (read it
in full; this is the routing + intent layer). Status: **DESIGN, NOT BUILT** as of
S231.

## The realization (why this exists)
The root liability is using an LLM as the *candidate generator* (Stage-1 `analyze`
suggests reviewers from parametric memory): it is stale (training cutoff),
senior-biased (founders over active mid-career), and hallucination-prone. S229's
recency/COI prompt-tuning was patching a *symptom*; the cause is generation
itself. The verify path then *launders* fabrications. So: **candidates must
originate from grounded retrieval; Claude plans queries + synthesizes over
retrieved real people, and never mints names.** This is the principled version of
the abandoned web-discovery experiment ([[project-reviewer-web-discovery-abandoned]])
— retrieval-first, ground-or-drop.

## Load-bearing decisions (detail in the plan doc)
- **Architecture:** fan-out (field-routed retrieval) → mosaic → adjudicate. Gate
  on exact identity FIRST (fail closed on a wrong forename), disambiguate among
  real matches SECOND. A topic/affiliation tiebreak is a resolver that *launders*
  a hallucinated name — must be an adjudicator (confirm/refute/insufficient).
- **Provenance model** (axis = groundedness, not "did Claude touch it"): keep
  cited-reference authors (DOI/PMID → exact), proposal-named peers (+COI flag),
  applicant-suggested, literature-retrieved; bar Claude parametric inventions
  (or grounded-seed-only). Asymmetric ground-or-drop: parametric ungroundable →
  drop silently; authoritative-source ungroundable → human review, never silent.
- **REUSE, don't rebuild:** `lib/services/reviewer-identity-resolver.js` already
  is the identity-states/abstention classifier ("unresolved acceptable;
  wrong-and-confident not") — EXTEND it (add publication-cluster/forename/co-author
  anchors); `lib/utils/relevance-score.js` already does recency-over-citations
  ranking ([[project-reviewer-ranking-recency-over-citations]],
  [[project-reviewer-identity-resolution]]).
- **Coverage by field (VERIFIED S231):** PubMed = biomedical depth ONLY (its
  non-bio "coverage" is sparse-real + namesake-conflated, unsafe to verify).
  **Cross-field spine = OpenAlex + ORCID** (OA for breadth + inline ORCID
  discovery; trust OA for presence, NOT completeness/metrics). Field-routed depth:
  NASA ADS / arXiv for astro-physics (PubMed-blind), DBLP for CS, INSPIRE for HEP.
  Semantic Scholar ≈ OA on recall but no inline ORCID + heavy fragmentation →
  optional corroborator. All scholarly APIs free except Google Scholar (SerpAPI).

## How to apply
**Sequence matters:** add field-routed retrieval sources BEFORE demoting Claude
generation, or PubMed-blind fields (astro/physics) lose all coverage (Claude's
astro suggestions were real, correct people — currently the only recall there).
The fail-dangerous verify bug is the live hazard motivating this:
[[project-reviewer-verify-fail-dangerous]]. This is the next big reviewer-finder
direction beyond the now-closed threads in [[project-reviewer-finder-next-topics]].
