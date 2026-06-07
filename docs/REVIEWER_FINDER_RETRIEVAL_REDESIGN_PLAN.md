# Reviewer Finder — Retrieval-First Redesign Plan

Status: **DESIGN / NOT BUILT.** This plan proposes re-architecting reviewer
candidate sourcing. Every "current state" claim is labelled `[VERIFIED]` (read
from source or a live probe this session) or `[ASSUMED]`. Proposed behavior is
labelled `[PROPOSED]`. Do not present any `[PROPOSED]` item as built.

Origin: Session 231 investigation (validating S229 COI/ranking work) → uncovered
a root-cause class → adversarial Codex review → empirical probes across a random
10-request sample of the current cycle. Evidence is summarized inline; probe
scripts are kept as evidence (see "Artifacts").

---

## 1. Problem statement & root cause

`[VERIFIED]` The pipeline is two stages:
- **Stage 1 `analyze`** (`pages/api/reviewer-finder/analyze.js` →
  `ClaudeReviewerService.analyzeProposal`): Claude reads the full proposal PDF and
  does double duty — (a) extracts proposal metadata, and (b) **suggests reviewer
  candidates from its own parametric memory**, with reasoning, seniority, COI, and
  DB search queries. Single response, `MAX_TOKENS=4096`.
- **Stage 2 `discover`** (`pages/api/reviewer-finder/discover.js` →
  `DiscoveryService`): Track A verifies Claude's names against PubMed
  (`verifyClaudeSuggestions`); Track B discovers from DB searches; a 2nd Claude
  call writes reasoning; COI + ranking.

**Root cause:** using an LLM as the *candidate generator* (1b) is the core
liability. It is:
- **stale** — training data lags, so it proposes who *was* prominent;
- **senior-biased** — prominence-in-training over-represents field founders;
- **hallucination-prone** — it mints names and attributes.

The verify path then *launders* these: it confirms a fabricated identity against
a real near-namesake and attaches that real person's record. The whole
verify/COI firefight is downstream of a self-inflicted wound.

### 1.1 Two distinct problems (do not conflate)
- **(a) Namesake ambiguity** — several *real* people share a name key. Solved by
  disambiguation (full forename, co-authors, ORCID, affiliation, topic).
- **(b) Hallucinated identity** — *no* real person has the claimed exact name.
  Solved only by a **gate** (exact-existence check that *fails closed*), never by
  a *resolver* ("nearest plausible real person"), which actively launders.

A topic/affiliation/title tiebreak is an optimizer for "best-fitting real
person." A hallucinated name is by construction a near-miss of a real person who
fits — so smarter disambiguation increases *false confidence* on (b). Sequencing
matters: **gate on exact identity first; disambiguate among real matches second.**

---

## 2. Empirical evidence (Session 231)

### 2.1 Hallucination is real and survives verification
- `[VERIFIED]` Wrong-forename on real people, observed in live analyze output:
  "Phillip Clote" (real: Peter Clote), "Matthew Pluth" (real: Michael Pluth),
  "Sigal Itzkovitz" (real: Shalev Itzkovitz), a recurring fabricated "Bhatt"
  surname cluster.
- `[VERIFIED]` **Verify path fails dangerous.** `generateNameVariants` emits an
  initial variant ("A Laederach"); PubMed `[Author]` is order-insensitive
  ("A Laederach" == "Laederach A"); `namesMatch` matches "a laederach" ==
  "alain laederach" via a first-initial rule (`discovery-service.js:1102`,
  reproduced). A fabricated **"Dr. Alfred Laederach" VERIFIED** against the real
  Alain Laederach's 8 papers + UNC affiliation, `confidence 100%`,
  `institutionMismatch=false`. The institution-mismatch guard misses because only
  the forename was wrong.
- `[VERIFIED]` `institutionMismatch` is advisory only — the candidate is still
  pushed to `verified` (`discovery-service.js:337,363,373`). Likewise
  `verifyClaudeSuggestions` accepts on `>= MIN_PUBLICATIONS` (=3) with no
  forename check (`:327`).

### 2.2 Reliability of the analyze stage (random 10-request sample)
`[VERIFIED]` Across 10 random research requests (cycle span ~1002794–1003083):
- **2/10 effectively failed** at analyze: 1002899 returned an **empty** model
  response (0 suggestions/title/queries); 1003032 returned **1** suggestion for a
  request asking 12.
- **Placeholder/padding** in ~3/8 successful runs (1003063 padded to 17 with 5
  hallucinated-then-retracted entries). Exact duplication did not recur on this
  sample (it was seen earlier on a 44k-char proposal — token-pressure variant).
- **High COI-flag rates** where Claude proposes the field's giants / the
  proposal's named competitors (protein design 10/12, neuroscience 9/12,
  geobiology 8/12) — evidence that parametric generation surfaces the obvious
  senior/named people rather than independent active reviewers.
- `[VERIFIED]` `validateAnalysisResult` only warns (no count/dup/truncation
  enforcement, no retry) (`reviewer-finder.js:478`).
- **Sampling note:** **4 of 15 random draws (~1 in 4)** were
  **non-research/capital grants** (no reviewers needed) — must be filtered
  upstream. (Small sample; treat as a signal to filter, not a population rate.)

### 2.3 Source coverage by field (free APIs; suggested-author sample)
`[VERIFIED]` Coverage (% of suggested authors found):

| Field (sample request) | PubMed | OpenAlex | ORCID | Sem.Scholar |
|---|---|---|---|---|
| Stellar astrophysics (1002896) | 92%* | 100% | 92% | 92% |
| Protein design (1002959) | 100% | 100% | 92% | 100% |
| Immunoengineering (1003005) | 92% | 92% | 92% | 92% |
| Neuroscience (1003020) | 100% | 92% | 83% | 92% |
| RNA/viroids (1003024) | 92% | 83% | 75% | 92% |
| Geobiology (1003075) | 83% | 83% | 75% | 83% |

Key reads:
- **\*PubMed astro "92%" counts name-string presence, not reliable identity.**
  Dumping the journals/affiliations of the hits (disconfirming check) shows a
  *mix*, not uniform namesake noise: distinctive-name astronomers have
  **sparse-but-real** MEDLINE presence via Nature/Science — sometimes `>=3`
  (Frebel: 4 real MIT-physics/Kavli papers → would verify *correctly*), often `<3`
  (Ramirez-Ruiz: 2 real UCSC papers → **false-negative**, dropped); common-name
  astronomers **conflate namesakes** (David Yong: 1 real ASTRO-3D paper + 8
  biomedical/chem namesakes → **mis-verifies with a wrong affiliation**). Net:
  PubMed neither reliably *covers* astro (false-negatives) nor safely *verifies*
  it (common-name conflation). PubMed is dependable depth **for biomedicine only**.
- **OpenAlex + ORCID cover the PubMed-blind field (astro) on presence/identity** —
  OA found 100% and returned an **inline ORCID** for most; ORCID-direct 92%.
- **OpenAlex finds, but its science records are fragmented** — implausibly low
  `works_count` for senior astronomers (Frebel 6, Gieles 1). Trust OA for
  *presence + ORCID discovery*, not for *completeness/metrics*.
- **Semantic Scholar ≈ OpenAlex on recall but inferior for identity** — its
  `author/search` returned **0 ORCIDs** (would need a 2nd `/author/{id}` call,
  doubling load under its 1 req/s limit) and shows severe fragmentation
  (David Baker top hit "D. Baker", papers:8 of ~600). Optional corroborator, not
  the spine.
- **Field gap none of us listed:** astrophysics lives in **NASA ADS** / arXiv
  astro-ph, not PubMed/bioRxiv/chemRxiv/INSPIRE. DBLP (CS) correctly returned ~0
  for astro.
- **Cross-source-zero is a reliable hallucination filter** (Sigal Itzkovitz,
  Andréa Bhatt = zero everywhere). A *single* source's zero is not (it also drops
  real-but-obscure people).
- `[VERIFIED]` `pubmed-service.js:226` derives `year` from
  `DateCompleted || DateRevised || PubDate` — record-maintenance dates, not
  publication date → corrupts recency counts.

---

## 3. What already exists (REUSE, do not rebuild)

`[VERIFIED]` The repo already contains much of the "identity + ranking" layer:
- **`ReviewerIdentityResolver`** (`lib/services/reviewer-identity-resolver.js`):
  a pure classifier with statuses `confirmed / probable / ambiguous / unresolved
  / rejected`, weak/strong anchors, ORCID (institution-corroborated = strong) +
  Scholar (weak, rejected on name/institution mismatch), a `mayPersistIdentity`
  gate, display-only confidence band ("never a sort key"), principle *"unresolved
  is acceptable; wrong-and-confident is not."* **Limitation:** consumes only
  ORCID + Scholar enrichment evidence; does **not** see PubMed publication-cluster
  / forename / co-author evidence; `confirmed` not yet reachable.
- **Recency-dominant ranking** (`lib/utils/relevance-score.js`, S223): h-index /
  citations are **deliberately excluded** from rank order (kept for identity +
  display); recency (recent-pub count) is the dominant signal. The "recency over
  citations" goal is already implemented. **Caveat:** a 25-pt "Claude-suggestion
  bonus" currently rewards *parametric* suggestions — re-scope to grounded
  provenance (§4.2).
- **Scholar guarded as a weak anchor** (`serp-contact-service.findScholarProfileViaGoogle`):
  organic Google lookup with name/institution-mismatch flags. Consistent with
  "Scholar is not ORCID-grade."
- **COI machinery**: proposal-author/co-I filter, same-institution flag,
  coauthorship check, affiliation history (`discovery-service.js`,
  `deduplication-service.js`).

The redesign therefore **extends** these, it does not replace them.

---

## 4. Proposed architecture `[PROPOSED]`

### 4.1 Fan-out / fan-in
- **Stage 0 — extract & plan (Claude, no parametric names):** proposal →
  structured field/subfield, topics, methods, keywords, PI/co-Is/institution
  (COI), per-source query strategies, and **names explicitly mentioned in the
  proposal** with their **role** (peer/competitor, collaborator, applicant-
  suggested, cited-reference author). **No background-knowledge candidate names.**
  Structured/schema-constrained output with **count/section enforcement + retry/
  repair** (fixes §2.2).
- **Stage 1 — field-routed retrieval (fan-out):** candidates *originate* from
  retrieval. Sources chosen by extracted field:
  - biomedical → PubMed + bioRxiv
  - chemistry → PubMed + chemRxiv (+ OpenAlex)
  - physics/astro → **arXiv + NASA ADS** (+ OpenAlex); INSPIRE for HEP only
  - CS/ML → arXiv + DBLP (+ OpenAlex)
  - cross-field spine everywhere → **OpenAlex + ORCID**
  - **Reference-resolution lane (high precision):** extract DOI/PMID/arXiv IDs
    from the proposal's reference list → resolve exact works → exact author lists
    (zero name ambiguity). Cited-reference authors are a top-precision seed pool
    (COI-filter them).
- **Stage 2 — mosaic (fan-in):** cluster author-instances across sources into
  candidate real-people with aggregated evidence (ORCID, per-author affiliation +
  history, MeSH/topic, co-authors, recency, cross-source corroboration).
- **Stage 3 — adjudicate & rank:** route each candidate through the (extended)
  identity resolver → identity status; rank only `probable`+ via the existing
  recency-dominant scorer; surface `unresolved`/`ambiguous` separately. LLM used
  only on residual ambiguity, framed as **adjudication (confirm/refute/insufficient
  against the exact claim, evidence-cited, may not introduce facts)** — never
  best-match resolution.

> **"Retrieval-originated" ≠ "identity-grounded."** A citation grounds an author
> *string on a work*, not a *person*. Candidates from retrieval are *hypotheses*
> until clustered and corroborated. (Codex correction — adopted.)

### 4.2 Candidate provenance model (axis = groundedness, not "did Claude touch it")

| Source | Grounded by | Disposition |
|---|---|---|
| Cited-reference authors | DOI/PMID → exact authorship | Top precision; COI-filter |
| Proposal-named peers/competitors | proposal text (expert-authored, recent) | High-value hypotheses **+ COI flag** (not auto "top tier") |
| Applicant-suggested reviewers | the applicant | Existing flow |
| Literature-retrieved | the databases | The new spine (hypotheses until resolved) |
| Claude parametric inventions | training data | **Barred**, OR grounded-seed-only (a seed is just a query; ground-or-drop) |

- **Asymmetric ground-or-drop:** parametric, ungroundable → **drop silently**.
  Authoritative-source (proposal/applicant/cited-ref), ungroundable → **surface
  for human review, never silent drop** ("named by applicant, couldn't verify").
- **Re-scope the 25-pt ranking bonus** (§3) from `isClaudeSuggestion` to grounded
  provenance (cited-ref / proposal-named), not parametric.
- **Attribute grounding:** Claude supplies *no* identity attributes
  (affiliation/contact). Affiliation is retrieval-derived, confidence/recency-
  stamped, **"mover"-flagged** (early-career movers like Wayment-Steele: the cited
  paper's affiliation lags the current one); prefer ORCID/OpenAlex for current.
  **Separate "fit" (any recent papers, location-agnostic) from "contactability"
  (current affiliation + email, verify-before-outreach).**

### 4.3 Extend the identity resolver
Add anchor types beyond ORCID/Scholar:
- **forename-equality anchor** (the §2.1 fix): a full-name suggestion is confirmed
  only if a recent topical cluster's author **forename exactly matches** (initials
  Claude itself supplied / nicknames / accents allowed). Initial-only matches →
  at most `citation_hits_only`, never `verified`. Fail closed.
- **publication-cluster anchor**: recent topical papers clustered by forename /
  co-author overlap / affiliation.
- **cross-source corroboration**: PubMed + OpenAlex + ORCID agreement raises
  confidence; conflict → lower / human review.
- Make `verifyClaudeSuggestions` (or its successor) emit **identity states**, not
  bare `verified:true`. Demote `institutionMismatch`/`expertiseMismatch` from
  advisory to confidence-lowering / `unresolved`.

---

## 5. Concrete bug fixes (independent of the big redesign)
Hardening wins that fix the demonstrated failures now:
1. **Initial-only hits must never verify a full-name candidate** without a second
   independent signal (forename / ORCID / co-author / affiliation).
2. **`institutionMismatch` (and `expertiseMismatch`) must demote** to
   `unresolved`, not sit beside `verified:true`.
3. **`article.year`**: prefer real publication date (`ArticleDate`/`PubDate`) over
   `DateCompleted`/`DateRevised` for recency.
4. **Analyze contract**: structured output + enforce requested count, no
   duplicates, complete sections; retry/repair on truncation/empty (fixes the
   20% analyze-failure rate).
5. **Filter non-research/capital grants** before running the pipeline.

---

## 6. Coverage & sourcing decisions
- **Cross-field spine = OpenAlex + ORCID** (OA for breadth + inline ORCID
  discovery; ORCID as the hard key). **Trust OA for presence/identity, not
  completeness/metrics.**
- **PubMed = biomedical depth only** (non-biomedical presence is sparse-real +
  namesake-conflated — unreliable to either cover or verify; see §2.3).
- **Field-routed depth:** NASA ADS / arXiv for astro-physics; DBLP for CS;
  INSPIRE for HEP only.
- **Semantic Scholar = optional corroborator** (CS/AI breadth), not required for
  this portfolio. ORCID via S2 needs the detail endpoint (2nd call).
- **Cost:** all scholarly APIs are free except Google Scholar (SerpAPI, paid).
  Free-API constraint is *rate limits*, not money. The recurring spend is the LLM
  calls. (S2 key obtained S231; 1 req/s cumulative; only public author names sent
  to scholarly APIs — proposal content goes only to Claude.)

---

## 7. Sequencing
1. **Hardening wins (§5)** — fix the fail-dangerous verifier, year basis, mismatch
   demotion, analyze retry, grant filter. Low risk, high value, no architecture
   change.
2. **Add field-routed retrieval sources** (OpenAlex + ORCID spine; ADS/arXiv) —
   **before** demoting Claude generation, or PubMed-blind fields (astro/physics)
   lose all coverage. (Claude's astro suggestions were *real, correct* people —
   currently the only recall source there.)
3. **Extend the identity resolver** to consume publication-cluster/forename/
   cross-source evidence; route verify through identity states.
4. **Invert to retrieval-first candidate origination** + provenance model;
   demote parametric generation to grounded-seed-only.
5. Shadow-run new pipeline against current; diff candidate sets before cutover.

---

## 8. Prerequisites & open items
- **Parse richer PubMed XML** (currently only name + affiliation): add `Initials`,
  author `Identifier Source="ORCID"`, `MeshHeadingList`, `ArticleDate`/`PubDate`,
  `PublicationType`, author ordinal/corresponding (`pubmed-service.js:197`).
- **Register `SEMANTIC_SCHOLAR_API_KEY`** in `lib/utils/tracked-secrets.js` when
  it gets a production consumer (added to Vercel S231; no consumer yet).
- **Verify before relying:** S2 `/author/{id}` ORCID availability; current
  SerpAPI Scholar terms; NASA ADS API (key, rate limits) — none confirmed yet.
- **Open decisions:** pooled vs tiered ranking for proposal-named vs literature-
  retrieved; how aggressively to LLM-adjudicate vs abstain; cost/latency budget
  for fan-out (reuse `reviewer.time_budget_seconds`).

---

## 9. Prior art (author-name disambiguation)
Do **not** train a model. Use deterministic features + external author IDs +
abstention. Relevant: OpenAlex (name/coauthor/institution/topic/citation + ORCID
clustering; admits split/merge errors), ORCID (authoritative when matched),
Semantic Scholar (CS/AI), INSPIRE (HEP, ORCID-principal), DBLP (CS curated),
NASA ADS (astro). Benchmarks: WhoIsWho/AMiner, PubMed Computed Authors (ORCID
especially helpful in hard cases). (Per Codex review.)

---

## Artifacts (Session 231)
Kept (reusable):
- `scripts/validate-reviewer-analyze.mjs` — read-only single-request analyze probe
  (full proposal → ranked suggestions).
- `scripts/probe-source-coverage.mjs` — read-only multi-source coverage probe
  (PubMed/OpenAlex/ORCID/DBLP/keyed-S2) by name/group. Decoupled from the analyze
  prompt; use it to (re)settle source routing as ADS/arXiv are added. NASA ADS +
  INSPIRE are documented TODOs in its header (physics coverage gap, §6).
- `scripts/lib/use-extensionless.mjs` — ESM resolver hook so raw `node` can run
  app modules.

Deleted (throwaways; findings already captured above): the one-off batch-analyze
harness and the `/tmp` probe data. **The batch-analyze evaluation harness should
be rebuilt as a proper parameterized script when the redesign work begins** — it
is coupled to the current analyze prompt (which this plan rewrites), so its logic
lives in §2.2 here rather than in carried code, to avoid bit-rot.
- Related existing docs: `REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`,
  `REVIEWER_RECENCY_WEIGHTING_PLAN.md`, `REVIEWER_WEB_DISCOVERY_PLAN.md`
  (abandoned — the ungrounded-generation precedent this plan avoids repeating).
