---
title: "Reviewer Finder — Canonical Design Doc"
domain: reviewer-identity
kind: source-of-truth
status: canonical
summary: "- Part B — Field Primer + Prompt Decomposition (was REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md): the async-precomputed field primer and its..."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md
  - pages/api/reviewer-finder/analyze.js
  - pages/api/reviewer-finder/discover.js
  - shared/config/prompts/reviewer-finder.js
---

# Reviewer Finder — Canonical Design Doc

> **STATUS BANNER (S248): Track B is ARCHIVED OFF.** `DiscoveryService.TRACK_B_ENABLED=false`
> gates the four DB-search blocks; the code is dormant + reusable. Present-tense references
> below to "Track B discovers…" / "current Track B" / "live Track-A + Track-B" are
> **architectural/historical** — Track B produces no candidates today. See
> `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` + agent-wiki reviewer-origination
> ("Track B — archived working code").

> **CONSOLIDATED S238.** This is the single canonical reviewer-finder design doc. It
> merges three formerly-separate files (the other two were deleted; this filename was
> kept because it carried the most inbound references):
> - **Part A — Retrieval-First Redesign Plan** (below): the spine — problem/root-cause,
>   empirical evidence, fan-out→mosaic→adjudicate architecture, provenance model, typed
>   failures, sequencing. Mechanics live here.
> - **Part B — Field Primer + Prompt Decomposition** (was
>   `REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`): the async-precomputed field primer
>   and its hard "primer never creates candidates" boundary.
> - **Part C — Design Refinements (S238 discussion)** (was
>   `REVIEWER_FINDER_DESIGN_REFINEMENTS.md`): the reframes + decisions + verified code
>   findings + shipped fixes from the S238 design discussions.
>
> **Where the parts differ, Part C governs *intent/priorities* (it is the latest
> thinking) and Part A governs the *detailed mechanics*.** Key Part-C reframes that update
> Part A's emphasis: **recall over precision** (review is a floor/gate, not a ranker — so
> coverage/spread is the primary signal and the fine ranking machinery is lower-leverage);
> **COI is surface-not-gate** except the permanent policy conflicts (proposal-authors,
> same-institution); and the **primer's people-free `fieldMap` may seed queries but never
> creates candidates**. Internal cross-references between the parts that say "this extends
> [the other doc]" now mean "see the relevant Part of this doc."

---

## Part A — Retrieval-First Redesign Plan

Status: **DESIGN.** Phase-1 verify-hardening (forename gate + soft mismatch flags
+ PubMed year basis) is **SHIPPED to `main` in S231** (commits `a3e6cbb`,
`4638db6`; validated by unit tests + live smoke). Sequencing step 1 —
the provenance DTO contract (§4.2, §4.5) — is **IMPLEMENTED in S232** (build +
gates + 374 reviewer tests green; pending a ship decision on its ~30-pt Track-A
ranking change). Everything else is unbuilt. Every "current state" claim is labelled `[VERIFIED]` (read from source or
a live probe this session) or `[ASSUMED]`. Proposed behavior is labelled
`[PROPOSED]`. Do not present any `[PROPOSED]` item as built.

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
`[VERIFIED via probe]` Across 10 random research requests (cycle span ~1002794–1003083):
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
- `[VERIFIED]` the legacy analyze validator only warned (no count/dup/truncation
  enforcement, no retry); it was later superseded by `validateReviewerAnalysis`.
  At the time of this probe, `claude-reviewer-service.js:203-233` returned
  `success:true` with validation attached even when `valid:false`.
- **Sampling note:** **4 of 15 random draws (~1 in 4)** were
  **non-research/capital grants** (no reviewers needed) — must be filtered
  upstream. (Small sample; treat as a signal to filter, not a population rate.)

### 2.3 Source coverage by field (free APIs; suggested-author sample)
`[VERIFIED via probe]` Coverage (% of suggested authors found):

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
- **OpenAlex finds; its canonical (ORCID-anchored) records are complete — the
  "fragmented records / low `works_count`" reading was a NAME-SEARCH ARTIFACT.**
  `[CORRECTED S239 via scripts/probe-grounded-origination.mjs — see docs/archive/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md]`
  A naive author-search returns the canonical record *plus* ORCID-less stub shards
  that share the name; the original probe picked a stub. Live re-check: Frebel's
  canonical record = **323 works + ORCID + MIT** (the "6" was a 0-citation,
  ORCID-less stub). Disambiguation is trivial — prefer the ORCID-bearing /
  highest-cited record — so OA metrics on the *resolved* record ARE trustworthy.
  This corrects the original "trust OA for presence only, not metrics" conclusion.
  (Distinct from §4's claim, which is about OA *coverage* as exhaustive
  ground-truth and still stands — see §8d's role-scope qualifier.)
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
  a **pure post-enrichment classifier** with statuses `confirmed / probable /
  ambiguous / unresolved / rejected`; it **does not fetch, cluster, or build
  hypotheses**. It consumes the normalized ORCID + Scholar evidence passed to it,
  applies weak/strong anchor rules, exposes a `mayPersistIdentity` gate, and keeps
  confidence bands display-only ("never a sort key"). **Limitation:** publication
  cluster / forename / co-author / affiliation-history evidence is not in the
  resolver input today, and `confirmed` is still unreachable under the current
  ORCID/Scholar-only rules (`reviewer-identity-resolver.js:1-24,117-163`).
- **Recency-weighted ranking** (`lib/utils/relevance-score.js`, S223): h-index /
  citations are **deliberately excluded** from rank order (kept for identity +
  display). Recency is the dominant positive **activity** signal (0-35 pts), but
  substantial non-recency bonuses still exist (~45+ possible points in practice),
  including the 25-pt source/provenance bonus plus affiliation, multi-source, and
  keyword bonuses. The "recency over citations" goal is implemented, but the
  25-pt parametric `isClaudeSuggestion` bonus must be re-scoped to grounded
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
  repair** (§4.4; fixes §2.2).
- **Stage 1 — field-routed retrieval (fan-out):** candidates *originate* from
  retrieval. Sources chosen by extracted field:
  - biomedical → PubMed + bioRxiv
  - chemistry → PubMed + chemRxiv (+ OpenAlex)
  - physics/astro → **arXiv + NASA ADS** (+ OpenAlex); INSPIRE for HEP only
  - CS/ML → arXiv + DBLP (+ OpenAlex)
  - cross-field spine everywhere → **OpenAlex + ORCID**
  - **Reference-resolution lane (high precision):** extract DOI/PMID/arXiv IDs
    from the proposal's reference list → resolve exact works → exact work
    authorship. This removes **work-level** ambiguity (which paper and which
    byline), not **person-identity** ambiguity; cited-reference author strings are
    still hypotheses that pass through clustering, identity resolution, and COI.
    **For question-driven proposals this lane should be the PRIMARY origin — keyword
    `searchQueries` (analyze PART 3) bias toward surface tokens and miss the
    proposal's actual question; see §4.5 for the primacy rationale, failure modes,
    and a Step-5 build sketch.**
- **Stage 2 — hypothesis-builder / mosaic (fan-in):** cluster author-instances
  across sources into candidate-person hypotheses with aggregated evidence:
  normalized name, full forename/initials, ORCID IDs, publication clusters,
  per-author affiliation + history, author position, corresponding-author flags,
  MeSH/topic terms, co-authors, recency, and cross-source corroboration. This
  helper fetches/receives source records and builds clusters; it must not decide
  persistence eligibility.
- **Stage 3 — adjudicate & rank:** convert each cluster into the resolver input
  contract (§4.3), route it through `ReviewerIdentityResolver`, then rank only
  `probable`+ (and later `confirmed`) candidates via the existing recency-weighted
  scorer. Surface `unresolved`/`ambiguous` separately. LLM use is limited to
  residual ambiguity, framed as **adjudication (confirm/refute/insufficient
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

- **Wire contract:** candidates carry `provenance.kind` (`cited_reference`,
  `proposal_named`, `applicant_suggested`, `literature_retrieved`,
  `grounded_seed`, `barred_parametric`), `provenance.sources[]` (e.g. `pubmed`,
  `openalex`, `orcid`, `arxiv`, `ads`, `biorxiv`, `chemrxiv`,
  `proposal_text`, `applicant_form`, `reference_list`), `provenance.seedRole`
  (`cited_author`, `peer_or_competitor`, `collaborator`, `applicant_suggested`,
  `query_seed`), `provenance.groundingWorkIds[]` (DOI/PMID/arXiv/ADS/OpenAlex
  work IDs), and legacy-compatible `source`/`sources` fields during migration.
  Do **not** infer provenance from `isClaudeSuggestion`.
- **Analyze-source guard:** Claude's analyze `SOURCE: References` label must
  **not** map to `cited_reference`; real cited-reference provenance requires
  DOI/PMID/arXiv resolution (§4.5) and the work-grounding rule (§4.1). Only
  `SOURCE: Mentioned in proposal` maps to `proposal_named`.
- **Consumer migration — IMPLEMENTED S232 (pending ship):** `[VERIFIED]` pre-S232,
  `/discover` streamed `verified/unverified/discovered/ranked` with binary source semantics
  (`pages/api/reviewer-finder/discover.js:362-367`); the roster collapses source
  to `claude_verified` vs `database`
  (`lib/services/reviewer-roster-store.js:23-27`); save maps source to
  `claude/pubmed/arxiv/biorxiv/unknown`
  (`pages/api/reviewer-finder/save-candidates.js:79-84`); the Workbench UI splits
  sections by `isClaudeSuggestion || source === 'claude_suggestion'`
  (`shared/components/reviewers/ReviewerSearchSection.js:78-83,787-788`). The
  S232 updated all four contracts together (Codex-built, reviewed): `/discover` emits the
  provenance DTO on every candidate; roster `source_kind` stores the provenance
  kind (plus raw `provenance` in the candidate JSON); save persists/memoizes the
  ordered scholarly sources plus the provenance kind instead of collapsing to
  `claude`; and the UI sections render provenance groups such as
  "Cited/proposal-named", "Literature-retrieved", "Applicant-suggested", and
  "Needs identity review" rather than Claude vs database.
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

### 4.3 Split clustering from identity classification
`[PROPOSED]` Add a separate **candidate hypothesis builder** before the resolver:
- Input: raw retrieved works, author records, proposal-named strings, applicant
  suggestions, cited-reference work IDs, and source metadata.
- Output: `CandidateHypothesis` clusters with `name`, `normalizedName`,
  `claimedInstitution`, `provenance`, `sourceRecords[]`, `publicationCluster`
  (works + author ordinal/corresponding flag), `nameEvidence` (forename,
  initials, aliases), `coAuthorEvidence`, `affiliationEvidence`, `topicEvidence`,
  `identityEvidence` (ORCID/Scholar/OpenAlex author IDs), and `coiEvidence`.
- Responsibility boundary: build and explain clusters only. It may fetch or
  consume source records, but it must not set persistence gates and must not
  collapse "same name" into "same person" without explicit evidence.

`[PROPOSED]` Extend the resolver **input** contract, not the resolver's fetching
responsibility. `evidenceFromEnrichment()` remains a normalizer for already
gathered evidence; a new adapter should feed the resolver anchors derived from
the hypothesis builder:
- **forename-equality anchor** (the §2.1 fix): a full-name candidate reaches
  `probable`/future `confirmed` only when a topical cluster's author forename
  exactly matches or an approved alias/nickname/accent variant matches.
  Initial-only matches → at most `unresolved`, never `verified`. Fail closed.
- **publication-cluster anchor:** recent topical papers clustered by forename,
  co-author overlap, author position, and affiliation.
- **cross-source corroboration:** PubMed + OpenAlex + ORCID/ADS/arXiv agreement
  raises confidence; conflicts lower to `ambiguous`/`unresolved` or human review.
- Make current `verifyClaudeSuggestions` (`discovery-service.js:327-388`) or its
  successor emit **identity states**, not bare `verified:true`. The **forename
  gate is the sole demoter**; `institutionMismatch`/`expertiseMismatch` stay
  **soft flags** on the candidate (they do NOT demote a forename-confirmed
  identity) and only corroborate demotion when the match is initial-only.
  [SHIPPED to `main` S231 — see §5.]

### 4.4 Analyze, grant-type, COI, and fan-out contracts
`[PROPOSED]` **Analyze retry/repair contract:** Stage 0 must return schema-valid
JSON, not delimiter text. Required top-level keys: `proposalInfo`,
`grantScreening`, `proposalPeople`, `referenceIds`, `sourcePlan`, and
`qualityChecks`. Attempt 1 is the normal extraction prompt. If JSON parsing or
schema validation fails, if required sections are empty, or if `qualityChecks`
reports truncation/insufficient extraction, run one repair prompt that includes
only the validation errors, the model's prior response, and the exact output
schema. Max attempts = 2 total. A second empty/invalid response returns
`success:false`, `status:'analysis_invalid'`, `validation.issues[]`, and no
`proposalInfo` result frame; the API/UI must show a retryable error instead of
continuing to discovery. This closes the current success-on-invalid path
(`claude-reviewer-service.js:168-233`).

`[PROPOSED]` **Non-research/capital-grant filter:** Source of truth is the
Dataverse `akoya_request` record before proposal analysis: grant program /
program area/type fields already projected in reviewer flows
(`reviewer-suggestion.js:469-498`) and request-scoped Workbench entry already has
the `requestId` (`ReviewerFindPanel.js:50,184-199`). If the request is clearly
outside Research / Medical Research / Science & Engineering reviewer workflows
(e.g. capital, discretionary, undergraduate education, site/office/phone, or no
PI-bearing research program), fail closed for reviewer discovery and return a
typed "no reviewers needed" response: `success:true`,
`status:'reviewers_not_required'`, `reason`, and the checked grant metadata. The
UI renders an informational empty state and does not call `/discover`. If the
grant type cannot be read, fail open with a warning and continue so a metadata
outage does not block real research requests.

`[PROPOSED]` **COI parity across provenance lanes:** proposal-author exclusion,
same/current/historical institution marking, and coauthor-history checks run on
**all** candidate lanes: cited-reference, proposal-named, applicant-suggested,
literature-retrieved, and any grounded-seed-derived candidate. Today coauthor
history is run only for verified Claude suggestions
(`discover.js:236-249`), while discovered candidates get proposal-author filter
and institution marking only (`discover.js:305-330`). The new pipeline must run
the same COI package after clustering and before ranking/surfacing; unresolved
COI evidence lowers display status and puts the candidate in human review rather
than silently promoting them.

`[PROPOSED]` **Author extraction rule:** retrieval-first does not take only the
last/corresponding author. Current Track B is senior-biased: PubMed and arXiv
take last author (`discovery-service.js:428-445,485-500`; `arxiv-service.js:95-
101`), bioRxiv/ChemRxiv take corresponding or first author
(`discovery-service.js:546-563,608-623`; `biorxiv-service.js:81-88`). The new
collector gathers **all authors** from resolved works where the source exposes
them, preserving author ordinal and corresponding flags as evidence. Ranking may
weight cited-reference authors, senior/corresponding authors, and recent-topic
authors differently, but candidate origination must not discard first/middle
authors before identity/COI screening.

`[PROPOSED]` **Fan-out/time-budget contract:** every source call accepts an
`AbortSignal`, source-specific timeout, max queries, max records, max candidates,
and retry policy. Default caps: no more than 3 query strategies per field-routed
source, 50 works per query, 150 raw works per source, 75 author hypotheses per
source before clustering, 1 retry for retryable 429/5xx with bounded backoff, and
no retry for schema/4xx errors. The overall `reviewer.time_budget_seconds` budget
is split into analyze, retrieval, enrichment/adjudication, and response buffers;
partial source failures return `sourceStatus[]` with `ok/timeout/aborted/error`,
counts, latency, and whether results were partial. A fully empty run succeeds
only when at least one source completed and produced an explainable zero; if all
enabled sources fail/timeout, return `success:false`, `status:'retrieval_failed'`.
This replaces today's best-effort external DB searches that do not observe the
route deadline signal (`discover.js:65-68`).

### 4.5 Reference-resolution (cited-reference) lane — primacy, failure modes, build sketch
`[PROPOSED]` **Status:** the `cited_reference` provenance kind, its `cited_author`
seedRole, the `reference_list` source, the grounded ranking bonus, and the
"Cited / proposal-named" UI group are **wired** in the S232 DTO
(`lib/utils/reviewer-provenance.js`), but there is **no producer** — `[VERIFIED via
grep]` no reference extraction or DOI/PMID resolution from proposals exists yet
(`pubmed-service.js` extracts DOIs from PubMed *API responses*, not reference lists).
The wire shape is ready; the lane is unbuilt.

> **S253 update:** the keyword `searchQueries` lane analyzed below was removed *at the source* —
> analyze PART 3 query generation is gone (Track-B-only consumer, archived off S248). The §4.1
> critique here remains the rationale for that removal and for the cited-reference-first redesign;
> read the `searchQueries` discussion as design analysis of the former behavior, not current state.

**Why it should be the PRIMARY origination path for question-driven proposals.**
The keyword `searchQueries` lane (§4.1 / analyze PART 3) is structurally biased
toward *surface tokens*: the prompt steers Claude to "methods, organisms, phenomena,
or systems" in 3–6-word MeSH-friendly queries. That reliably captures techniques and
model systems but **misses the proposal's fundamental question**, which is relational
and often novel (not an indexed term). For a proposal whose novelty is a
*question/hypothesis applied to a common system* (e.g. a regulatory hypothesis tested
in *E. coli*), the queries collapse to generic tokens and retrieve a large,
mostly-irrelevant crowd; Track B then takes the senior author of each hit, yielding a
soup of unrelated PIs. A proposal's **cited references** encode the
question-community by construction (expert-curated, question-specific), bypassing
keyword "aboutness" limits. Recommendation: for question-driven proposals treat the
cited-reference lane as the **primary** candidate origin and demote keyword
`searchQueries` to a *recall supplement*, not a co-equal source. This is a
per-proposal routing decision: distinctive-phenomenon proposals (where the science
has a nameable indexed term — observed in the S231/S232 samples) keyword queries
still serve, so route by whether the proposal's novelty is a *question* or a
*nameable phenomenon* rather than replacing keyword search wholesale.

**Failure modes (precision is not free).** The lane trades the keyword problem for a
different, harder set — weigh these before treating it as a silver bullet:
1. **Highest COI density of any lane.** Heavily-cited authors are disproportionately
   the applicants' collaborators, mentors, and direct competitors — exactly the
   reviewers to *exclude*. The §4.4 COI package (proposal-author, coauthor-history,
   same/historical-institution) is mandatory and load-bearing here; unfiltered, the
   top of this lane is unusable.
2. **Methods-citation noise.** Reference lists also cite tool/stats/foundational-
   review papers whose authors are off-question — the surface-token crowd reappears
   *inside* the citation set. Substantive-vs-methodological citation weighting is
   unsolved; start without it and measure.
3. **Citation grounds a work, not a person** (§4.1 caveat). A cited multi-author work
   yields N author-string hypotheses; all pass through clustering + identity
   resolution. Taking all authors is noisy; taking senior/corresponding reintroduces
   seniority bias.
4. **Seniority & staleness skew.** Cited work is often old/foundational, so cited
   authors skew senior and may be dormant or have moved institutions — a *grounded*
   echo of the bias the redesign fights. Cross-check against the recency ranker and
   the fit-vs-contactability split (§4.2).
5. **Self-citation.** A portion of the list is the applicants' own prior work → those
   authors are the proposal authors → drop as COI (also a clean COI signal).
6. **Extraction reliability is the real engineering risk.** PDF bibliographies mangle
   on parse; many references lack DOIs (older work, books, theses, some preprints);
   formats vary. Coverage will be partial and noisy — this, not the concept,
   determines whether the lane works.

**Build sketch (Step-5 slice, on top of the S232 DTO).**
- **Prerequisite:** the hypothesis-builder adapter (§4.3) must land before or
  with this lane; reference resolution produces grounded author instances, but
  still needs the adapter to turn them into candidate-person hypotheses.
- **Extract:** isolate the reference/bibliography section of the parsed proposal
  text; regex out DOIs (`10.\d{4,}/\S+`), PMIDs, and arXiv IDs → a deduped ID set
  with the raw reference string for audit. Log extraction coverage (IDs found vs
  reference entries) — a §4.4-style "no silent caps" report, since partial extraction
  is expected.
- **Resolve:** ID → exact work + full author byline. Crossref for DOIs, PubMed eutils
  for PMIDs, arXiv API for arXiv IDs, OpenAlex as cross-resolver/back-stop. Honor the
  §4.4 fan-out/time-budget contract (AbortSignal, per-source caps, retry policy);
  cache by ID. **Verify before relying:** Crossref/eutils/arXiv rate limits and the
  real DOI-coverage of proposal reference lists are unmeasured — probe a sample of
  current-cycle proposals for extraction yield first.
- **Hypothesize:** each author instance → candidate hypothesis with
  `provenance.kind = cited_reference`, `seedRole = cited_author`,
  `groundingWorkIds = [the resolved ID]`, plus author ordinal/corresponding flags and
  the work's recency. Feed the hypothesis-builder adapter (§4.3); do **not**
  special-case persistence here.
- **Screen + rank:** run the full §4.4 COI package on every cited-reference candidate
  BEFORE surfacing (this lane's highest-risk step), route through the identity
  resolver, then the recency ranker. Cited-reference candidates carry the grounded
  +25 bonus (already wired) — but COI-flagged ones drop to human review, never
  auto-top.

---

## 5. Concrete bug fixes (independent of the big redesign)
Hardening wins that fix the demonstrated failures now:
1. **Initial-only hits must never verify a full-name candidate** without a second
   independent signal (forename / ORCID / co-author / affiliation).
2. **The forename gate is the *sole* demoter** (IMPLEMENTED). `institutionMismatch`
   and `expertiseMismatch` must NOT demote a forename-confirmed identity — they
   ride along as **soft display flags** (a wrong institution is usually Claude's
   stale attribute guess, not a wrong person; `checkExpertiseMismatch` is
   title+abstract substring matching — not MeSH — which the old code deliberately
   never rejected on). They corroborate demotion only when identity is weak
   (initial-only). Validated S231: under the earlier demote-on-mismatch policy the
   correct expert Silvi Rouskin was wrongly demoted on a stale institution guess;
   under the forename-only policy she verifies with the mismatch as a flag.
3. **`article.year`**: prefer real publication date (`ArticleDate`/`PubDate`) over
   `DateCompleted`/`DateRevised` for recency.
4. **Analyze contract**: structured output + enforce requested count, no
   duplicates, complete sections; retry/repair on truncation/empty; a second
   invalid response returns typed failure, not `success:true`.
5. **Filter non-research/capital grants** before running the pipeline (§4.4).
6. **COI parity:** run proposal-author, institution, and coauthor-history checks
   across every provenance lane before ranking/surfacing (§4.4).

### 5.1 Live case — request 1002794 "Robert Sang" (namesake laundering + ungated contact)
`[VERIFIED via prod roster + Codex code review S232]` A physics proposal (attosecond
"Clocking quantum tunneling with molecular shake-up") surfaced a **Frankenstein
record**: correct name + Claude's physics expertise tags, but a *different real*
Robert Sang's affiliation ("Intl. Centre of Insect Physiology & Ecology, Nairobi,
Kenya"), a Google Scholar URL seeded with that wrong affiliation, and a LinkedIn
(`linkedin.com/in/john-fazakerley`) belonging to a **third, unrelated** person. It is
the §2.3 PubMed namesake-conflation hazard firing on a non-biomedical proposal,
compounded by an ungated contact link. (`[ASSUMED via user report]` The 5 *saved*
reviewers on this request were applicant-recommended, not pipeline output.)

Root causes (Codex-confirmed against current code):
- **Track-A verification ignores the UI source toggles and is PubMed-hardwired.**
  `DiscoveryService.discover` calls `verifyClaudeSuggestions` whenever suggestions
  exist, with no source argument (`lib/services/discovery-service.js:134`); the
  variant loop starts at `:303`, the simple/disambiguated PubMed queries are built
  at `lib/services/discovery-service.js:305` and `:318`, and it stamps
  `verificationSource:'pubmed'` (`:416`). The
  `searchPubmed/...` toggles gate only Track B (`:157,172,187,202`). The user
  deselected PubMed; verification used it anyway. (Precision: every suggestion is
  PubMed-*attempted*; only `>=MIN_PUBLICATIONS` + full-forename evidence enter
  `verified[]` — `:380,407,462`.)
- **The forename gate can't catch same-full-name, cross-field namesakes.** "Robert
  Sang" == "Robert Sang" satisfies `firstNamesEquivalent` / `fullForenameMatch`
  (`:1161,1236`), so no demotion (`:401`). The gate (§5 items 1-2) only defends
  wrong/initial forenames.
- **Contact links have no name gate.** `isUsefulWebsiteUrl(url)` takes no candidate
  name and accepts any `linkedin.com/in/` (and returns true for all non-generic
  URLs) (`lib/utils/contact-parser.js:295-334`, the `isUsefulWebsiteUrl` helper);
  SerpAPI/enrichment attach it as `website`
  (`serp-contact-service.js:85,154`; `contact-enrichment-service.js:303`). Email has
  a name-consistency guard; websites do not
  (`ContactParser.isNameConsistentEmail(...)` at
  `lib/services/contact-enrichment-service.js:358`).
- **The proposal-named anchor is discarded.** Claude tags `SOURCE: Mentioned in
  proposal` (`reviewer-finder.js:81,107,379`), but Track A overwrites
  `source:'claude_suggestion'` (`discovery-service.js:441`); the provenance helper
  only maps the literal `proposal_named` (`reviewer-provenance.js:102`), so the
  strongest local identity anchor is lost.
- **The verified composite is incoherent yet ranks normally.** The candidate keeps
  Claude's `expertiseAreas` (physics) while affiliation/publications come from the
  namesake; ranking then scores `expertiseAreas` + affiliation/pub-count bonuses
  (`relevance-score.js:53,67`) as if the record were coherent. (Correction to an
  earlier read: `expertiseMismatch` *is* computed from the matched articles vs
  Claude's terms — `:395,1455` — it is simply advisory; the displayed expertise
  staying Claude's is the `...suggestion` spread at `:411,433`.)

Fix bundle (`[PROPOSED]`, Codex-reviewed; mixed effort, still shippable before the
big redesign):
7. **Gate Track-A verification on the source contract.** If `searchPubmed===false`
   (or `proposalInfo.primaryResearchArea` is clearly non-biomedical), do **not**
   PubMed-verify; route suggestions to `unverified[]` / identity-review with
   `verificationStatus:'unresolved'` (provenance `barred_parametric` unless
   proposal-named / applicant-suggested). Gate the post-verify PubMed coauthor-COI
   pass (`discover.js:250` → `discovery-service.js:1498`) on the same contract.
   Also apply this to the applicant-recommended verify path
   (`pages/api/workbench/enrich-recommended.js:203-208`), which currently calls
   `DiscoveryService.verifyClaudeSuggestions` against PubMed unconditionally, for
   non-biomedical proposals.
   **UX / effort (Codex):** small-to-medium, multi-layer. The "Needs identity
   review" provenance group is currently selectable (normal `CandidateCard` with
   `onToggle`, `ReviewerSearchSection.js:795-815,1013-1021`); only the separate
   "Unverified suggestions" section is read-only (`:1057-1065`). Making these
   suggestions visible-but-not-selectable requires an explicit service contract,
   API route, and UI change. Surface unresolved candidates with the reason
   "verification skipped — PubMed off / no verifier for this field"; never silently
   drop proposal-named/applicant signals.
8. **Name-gate every profile/website URL.** Small-but-multi-helper: give the
   website helper the candidate name; for personal/profile domains (LinkedIn,
   ResearchGate, X, etc.) require a forename/surname token in the URL slug or page
   title/snippet before attaching (mirror the email name-consistency guard).
   `john-fazakerley` vs `Robert Sang` is rejected on the slug alone. Scope includes
   the SAVE/PERSIST boundary: wrong websites can survive in saved payloads unless a
   save-time/roster-time website sanitization guard is added at
   `pages/api/reviewer-finder/save-candidates.js:75,151`.
9. **Preserve the proposal-named source.** Map parsed `SOURCE: Mentioned in proposal`
   → `source:'proposal_named'` / `provenance.kind = proposal_named` **before** Track
   A, so the anchor survives (do not overwrite to `claude_suggestion`). Proposal-
   named is a high-value *hypothesis + COI flag*, not auto-confirmation (§4.2).
   Ordering: land this before or with fix 7, because fix 7's unresolved fallback
   depends on distinguishing barred-parametric suggestions from proposal-named and
   applicant signals. Guardrail: Claude analyze `SOURCE: References` does **not**
   become `cited_reference`; only resolved reference-list works do.
10. **Cross-field / second-signal namesake guard.** Outside biomedicine, a
    same-full-name PubMed match reaches `verified`/`probable` only with a second
    corroborating signal — affiliation match to Claude/proposal context, ORCID,
    coauthor/context overlap, or topical overlap between proposal keywords and the
    matched articles (the code computes expertise match but does not gate on it —
    `discovery-service.js:385`). Otherwise `unresolved`. A coarse journal/category
    "looks biomedical vs physics" check is the cheapest first cut.
11. **Don't rank an incoherent composite as coherent.** When affiliation/publications
    come from a verification match that conflicts with the suggested attributes,
    reconcile or down-weight rather than scoring Claude-expertise +
    namesake-affiliation together.

Parity note (Codex): the post-verify coauthor-history COI pass runs only on Track-A
`verifiedWithCOI` candidates (`discover.js:241`); discovered candidates get
proposal-author + institution marking but no coauthor-history (`discover.js:310,333`)
— fold into the §4.4 COI-parity item.

---

## 6. Coverage & sourcing decisions
- **Cross-field spine = OpenAlex + ORCID** (OA for breadth + inline ORCID
  discovery; ORCID as the hard key). **Trust OA for presence/identity — and, on the
  ORCID-anchored canonical record, for recent-works metrics** (the earlier
  "not metrics" caveat was a name-search stub artifact; corrected S239 — see §2.3).
- **PubMed = biomedical depth only** (non-biomedical presence is sparse-real +
  namesake-conflated — unreliable to either cover or verify; see §2.3).
- **Field-routed depth:** NASA ADS / arXiv for astro-physics; DBLP for CS;
  INSPIRE for HEP only.
- **Semantic Scholar = optional corroborator** (CS/AI breadth), not required for
  this portfolio. ORCID via S2 needs the detail endpoint (2nd call).
- **Cost:** all integrated scholarly APIs are now free — the paid Google Scholar
  (SerpAPI) metrics/literature path was migrated to free OpenAlex (S251). ADS and
  production Semantic Scholar constraints are still unverified and must be checked
  before treating them as operationally settled.
  For the known free APIs, the constraint is rate limits, not money. The recurring
  spend is the LLM calls. (S2 key obtained S231; 1 req/s cumulative; only public
  author names sent to scholarly APIs — proposal content goes only to Claude.)

---

## 7. Sequencing
1. **[IMPLEMENTED — identity states S231, provenance DTO + 4-consumer contracts
   S232] Route current `verifyClaudeSuggestions` through identity states — no new
   sources.** The verifier (`discovery-service.js`) emits identity/provenance DTOs,
   and `/discover`, roster, save, and the UI section contracts all carry the DTO
   (§4.2). This established the candidate wire shape before fan-out changes. (S232
   pending a ship decision on its ~30-pt Track-A ranking change — see §4.2 tail.)
2. **Bug-fix hardening (§5) without source expansion.** Forename gate on
   initial-only verification, institution/expertise mismatch → soft flags (not
   demotion), PubMed year basis, COI parity, and non-research grant filtering.
   These are behavioral safety fixes around current sources. (The forename gate +
   soft mismatch flags + year basis are already SHIPPED to `main` in S231.)
3. **Analyze contract rewrite.** Replace delimiter parsing with schema output,
   retry/repair, typed invalid-analysis failure, and no parametric candidate
   names. Keep source planning and proposal/reference extraction, not reviewer
   invention.
4. **Add the hypothesis-builder and resolver input adapter.** Publication
   clusters, forename/co-author/affiliation evidence, and cross-source
   corroboration feed the pure resolver; the resolver remains classification and
   persistence-gating only.
5. **Add field-routed retrieval sources — provenance plumbing now in place (S232).**
   Build the **reference-resolution lane (§4.5) after or with the hypothesis-builder
   adapter** — for question-driven proposals it is the primary candidate origin,
   with keyword `searchQueries` demoted to a recall supplement. Then OpenAlex +
   ORCID spine and ADS/arXiv/DBLP/INSPIRE as field-routed lanes. All ride the S232
   DTO contract.
6. **Invert to retrieval-first candidate origination.** Parametric generation is
   barred except as grounded query seeds that must ground-or-drop.
7. **Shadow-run before cutover.** Compare current vs new pipeline on sampled
   requests and report: identity false-positive rate, COI miss rate, field
   coverage, latency, API-failure rate, duplicate-cluster rate, and human-review
   queue volume. Cut over only when the new pipeline improves identity/COI safety
   without unacceptable coverage or latency regressions.

---

## 8. Prerequisites & open items
- **Parse richer PubMed XML** (currently only name + affiliation): add `Initials`,
  author `Identifier Source="ORCID"`, `MeshHeadingList`, `ArticleDate`/`PubDate`,
  `PublicationType`, author ordinal/corresponding (`pubmed-service.js:197`).
  These are prerequisites for the proposed identity anchors: initials/forename
  matching, ORCID corroboration, MeSH/topic fit, real recency, and author-position
  weighting cannot be reliable without them.
- **Register `SEMANTIC_SCHOLAR_API_KEY`** in `lib/utils/tracked-secrets.js` when
  it gets a production consumer (added to Vercel S231; no consumer yet), and sync
  the credentials runbook / operational docs at the same time.
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

---

## Part B — Field Primer + Prompt Decomposition

*(Formerly `REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`. Where it says "the redesign plan" / "this EXTENDS …", read Part A above.)*


> **Status:** DRAFT / iterating (S237). Not built. **This EXTENDS — does not duplicate —
> `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`**, which already specifies the
> retrieval-first decomposition (Stage 0 extract-&-plan with *no parametric names*,
> field-routed retrieval, the hypothesis-builder/mosaic layer, the provenance model,
> typed failure outcomes, COI parity, and a shadow-run-before-cutover). The **new**
> contribution here is the **field primer** and the decision to **pre-compute it
> asynchronously at submission**. Codex pre-impl review (S237) folded in.

## What's already decided (in the redesign plan — reuse, don't re-spec)

`REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` already covers the decomposition itself:
- **Stage 0** — Claude extracts topical facts + `grantScreening` + `proposalPeople` +
  `referenceIds` + `sourcePlan` + `qualityChecks`, **no background-knowledge candidate
  names**; identity facts (PI/institution) come from Dataverse (§4.1, §4.4).
- **Stage 1** — candidates *originate from grounded retrieval*, field-routed (§4.1).
- **Stage 2** — hypothesis-builder/mosaic clusters author-instances → person hypotheses (§4.3).
- **Stage 3** — adjudicate via `ReviewerIdentityResolver` + recency rank (§4.1, §4.3).
- Typed failures (`analysis_invalid`, `reviewers_not_required`, `retrieval_failed`),
  COI parity across lanes, structured-JSON output + retry/repair, fan-out time budgets,
  prompt rewrite, and §7 sequencing incl. a shadow run.

**My earlier sketch's "Step 2 = reviewer suggestion" was wrong** (Codex): if it means Claude
*names people*, it contradicts the retrieval-first rule. Candidates must originate from
retrieval; Claude parametric names are **barred or grounded-seed-only (ground-or-drop)**.
Treat that decomposition as settled by the plan; this doc only adds the primer + staging.

## The new piece: the field primer

**Intent.** Start from Claude's knowledge, then point it at the wider internet and have it
write a **structured, cited review of the research field** for a proposal: what the field is,
its sub-areas, key methods, current frontiers/open questions, the landscape of active
research communities, and notable venues — each claim tied to a real, resolvable source.

**Two roles:**
1. **Standalone PD deliverable.** A non-specialist program director gets an orienting field
   map — valuable *on its own*, even when reviewer yield is thin (e.g. a thin Phase-I
   narrative, or a proposal whose best peers were all self-excluded). Degrades gracefully.
2. **Scaffold** for the redesign's Stage 0/1: its sub-areas/methods/venues become inputs to
   the **`sourcePlan`** and field-routing and to query seeds — *not* a candidate source.

**KEY DECISION — pre-compute it asynchronously at submission (latency non-issue).**
The primer is generated **soon after proposal submission**, as a **standalone, cached,
durable artifact** — NOT part of the synchronous reviewer-finder run. This removes it from
the latency budget entirely (Codex's top concern; the synchronous path is already ~50s+50s
before enrichment per `project-serpapi-budget-latency`). When a PD later runs discovery, the
primer is already there to read and to seed Stage 0/1.

## The hard boundary — the primer can NOT create candidates (Codex: non-negotiable)

The real risk isn't only "the primer names someone and we treat them as a candidate." It's
**framing contamination**: the web-sourced primer frames the field around certain
communities/people, then a downstream prompt regenerates the same fabricated-affiliation
failure through that framing, and grounded verification confirms the nearest real namesake
(the exact failure class in the redesign plan §1, §5.1, and `project-reviewer-web-discovery-abandoned`).

So the boundary is **machine-readable and code-enforced**, not prose:
- Primer output is partitioned into:
  - **`fieldMap`** — `subAreas[]`, `methods[]`, `frontiers[]`, `venues[]`, `searchTerms[]`.
    These may seed `sourcePlan` / queries (they carry no person identity).
  - **`unverifiedLeads[]`** — any named groups/people, each with its provenance URL and a
    flag. A lead is *never* a candidate field.
- **Only the grounded lanes** (cited-reference / literature-retrieved → hypothesis-builder →
  resolver, per the plan) may create candidate **identity / affiliation / contact /
  eligibility** fields. A primer lead may at most become a *grounded-seed query* that must
  ground-or-drop through PubMed/ORCID/OpenAlex — affiliation/contact always from the verified
  record, never the primer.
- The primer's prose is **never** the source of an email, affiliation, or "confirmed" reviewer.

**Citations ≠ grounding.** Web content is UNTRUSTED (A7) — wrap it. Treat each citation as a
claim to validate (URL resolves, source is the type claimed, claim is supported), and never
let a citation become identity evidence.

## Staging (your "smaller steps / more focused tasks")

The primer is itself one **decoupled** stage; break it further so each task is small:
- **P1 — knowledge draft:** Claude writes a structured field map from its own knowledge (no web).
- **P2 — web-grounded revision:** web search → revise/cite the field map; emit `fieldMap`.
- **P3 — leads partition:** extract any named groups/people into `unverifiedLeads[]` with URLs
  (kept strictly out of `fieldMap`).
Each is independently promptable/versionable. The synchronous decomposition (Stage 0–3)
follows the plan's §7 sequencing; the primer slots in *ahead of and beside* it as a cached input.

## Open decisions (primer-specific — add to the plan's §8 open items)

1. **Web tooling:** Claude-native web search vs a separate retrieval layer (the abandoned attempt
   used Perplexity `sonar` *for reviewers* — a different, higher-risk use).
2. **Primer scope:** people-agnostic field map only, vs the partitioned `unverifiedLeads[]`
   above. Recommend the partition (keeps leads, enforces the boundary structurally).
3. **Caching / scope / freshness:** request-scoped? proposal-version-scoped? regenerate on
   resubmission? where stored (Blob? Dataverse?)?
4. **PD UX:** present it explicitly as an *orienting field review, not verified reviewer
   evidence* — mirroring the old web panel's deliberate isolation from ranking/COI/save.
5. **Prompt-version migration:** new prompt names (`reviewer-finder.field-primer.*`,
   `reviewer-finder.extract`, …) break the resolver/override/validator wiring keyed to
   `reviewer-finder.analyze`/`.score-candidates` — plan names, validators, fallbacks, and
   stale-override handling up front.
6. **Evaluation before build:** does a people-agnostic primer measurably improve Stage-0/1
   `sourcePlan`/query quality (yield, false-affiliation rate, field coverage) in a shadow run?
   Is the primer itself useful to PDs (acceptance/usefulness)? Define metrics first.

## First step (de-risk — Codex + plan §7.7)

A **shadow, non-candidate-producing prototype** on a small set of prior proposals: structured
extraction + **people-agnostic** primer + query/`sourcePlan` generation → feed **only the
generated queries** into the existing retrieval → compare yield / latency / false-positives
against the current path. **Do not** prototype "primer names people" first — that tests the most
dangerous behavior before the safe scaffold is proven. Pair with rebuilding the parameterized
analyze-evaluation harness the plan calls for (§Artifacts).

## Relationship to existing work
Extends `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (the decomposition + hypothesis layer +
typed failures + sequencing). Respects `project-reviewer-web-discovery-abandoned` (web stays out
of naming/verification; enforced by the machine-readable boundary). Pairs with
`project-reviewer-finder-proposal-doc-context` (the PA-assembled doc improves the *input*; the
primer + decomposition improve how we *use* it). Aligns with `project-reviewer-finder-retrieval-redesign`.

---

## Part C — Design Refinements (S238 discussion)

*(Formerly `REVIEWER_FINDER_DESIGN_REFINEMENTS.md`. Cross-references to the decomposition / redesign docs mean Parts B / A above.)*


> **Purpose / how to use this Part.** This is a refinement layer on top of Parts B
> (field primer) and A (retrieval-first plan) above. It captures conclusions from a
> design discussion and is meant to **hone** the existing spec, not replace it.
> Each item is tagged **DECIDED**, **REFRAMED**, **DEFERRED**, or **RETRACTED** so
> the changes are easy to apply. Where a conclusion overturns something said earlier
> in the discussion, that is stated explicitly so stale reasoning isn't reintroduced.

---

## 0. The organizing principle (applies everywhere)

**One objective per unit of work.** The original failure — a single prompt asked to
read, research, synthesize, and emit machine output at once — is the same failure that
showed up in the *design process itself* (conflating "build the primer" with "prove the
primer isn't biased," plus a substrate argument, all held in one context). The remedy is
the same at every scale: isolate objectives. Independently corroborated by Silva et al.
(see §6): isolating planning, critique, and rewriting lets each step work under a
constrained subgoal.

**Two separate problems, not one.** The rest of this document is organized around the
single most useful clarification from the discussion:

1. **The primer** — a buildable deliverable, mostly already specced, low contention.
2. **The bias / coverage measurement** — a quality check on the primer. Optional, later,
   and the source of nearly all the complexity. It is **not** required to ship a primer.

The substrate debate (OpenAlex / Semantic Scholar / PubMed / iCite) lives *entirely
inside* problem #2. If the measurement is deferred, that whole thread goes quiet.

---

## 1. The primer (DECIDED — buildable now)

The primer is the real goal: orient a **non-specialist program director** to a research
field. Structure is already in the spec and unchanged:

- **P1 — knowledge draft:** structured field map from model knowledge, no web.
- **P2 — web-grounded revision:** web search → revise/cite → emit `fieldMap`.
- **P3 — leads partition:** named groups/people → `unverifiedLeads[]` with provenance,
  kept strictly out of `fieldMap`.
- **Hard boundary unchanged:** the primer never creates candidate reviewers. `fieldMap`
  (people-free: `subAreas[]`, `methods[]`, `frontiers[]`, `venues[]`, `searchTerms[]`)
  may seed `sourcePlan`/queries; `unverifiedLeads[]` is never a candidate field. Boundary
  is code-enforced, not prose.
  - **Reconciliation (S248): the SHIPPED standalone primer service MAY name experts in
    its staff-facing prose.** The invariant is *"never CREATES CANDIDATES,"* not "never
    prints a name." The `people-free fieldMap` / `unverifiedLeads[]` partition is the
    discipline for the *scaffold* role (a `fieldMap` that seeds the retrieval pipeline);
    the **standalone staff deliverable** (`lib/services/field-primer-service.js`,
    Executor prompt `field-primer.generate`, S248) has **no candidate write-path** —
    output target `kind:'none'`, no discovery/save/COI — so naming experts there cannot
    breach the invariant. Decided with Justin. See
    `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` Stage 0.
- **Async pre-compute at submission**, cached durable artifact, out of the synchronous
  latency budget. Unchanged.

### What the discussion actually changed about the primer

- **DECIDED — the primer is a NEUTRAL, accurate field map.** Lay out the field's
  mainstream structure plainly so staff can apply their own judgment to a clean map.
- **RETRACTED — do NOT instruct the primer to surface or editorialize "divergent /
  heterodox perspectives."** An earlier version of this discussion added that instruction;
  it is now withdrawn. Reasoning is in §2: the critical/contrarian function belongs to
  the humans, and a primer that pre-loads it risks nudging a non-specialist PD into
  treating the system's framing as the critical take.

---

## 2. What the review process actually is (REFRAMED — changes the quality bar)

This reframe is the most consequential outcome and should propagate into how every
component's quality target is written.

- The review process is a **distributed system with redundancy and checks-and-balances**,
  **not a brittle pipeline with a single critical path.**
- **Staff are dispositive; reviewers provide signal, not a verdict.** Staff can see when a
  reviewer trashes something merely for breaking with dogma, and discount it.
- The premise-challenging / "goes against the dogma" function is **distributed across both
  staff and reviewers** — including the mainstream "in-crowd," who are often *reasonable
  skeptics* and frequently give good comments even on heterodox proposals. These are
  **soft distinctions, not fixed roles.** Not every proposal is heterodox.
- Genuine disagreement in reviews is often a *feature*: staff are sometimes drawn to a
  proposal precisely *because* it challenges dogma, so the reviewer pool's mainstream lean
  and the staff's contrarian lean produce a productive tension. That tension is the
  product, not a defect to engineer away.

**Implication for build quality:** the primer (and its metric) must be **useful and
honest, not airtight or load-bearing.** Directional quality is acceptable. It is one input
into a human judgment that has its own downstream correctives. Do not design any single
component as if a coverage gap or slightly skewed map propagates uncaught to a bad
decision — the system tolerates imperfect parts by design. (Prior turns over-engineered on
the opposite, brittle-pipeline assumption; that assumption is wrong.)

**RETRACTED — "find the rare premise-challenging reviewer" as a system objective.** The
system was never supposed to locate the contrarian. That function is the humans'. The
metric's job is correspondingly narrower (see §3).

**DECIDED — the applicant-suggested-reviewer exclusion is load-bearing, not nice-to-have.**
Friends-of-PI are the one reviewer population biased in the *applicant's* direction with no
skeptical counterweight. Removing them (using the existing provenance field) is what makes
"in-crowd reviewer" and "reasonable skeptic" the same person. Keep this exclusion firmly in
the design.

---

## 3. The coverage / bias metric (DEFERRED — optional, later, narrowed)

- **Status: optional and later.** Not needed to ship a primer. A worse-is-fine first
  validation is to read primer outputs by eye against fields the team already knows. That
  unblocks building today while this question stays open.
- **Narrowed goal.** The metric is **not** "detect the heterodox / fringe voice." It is:
  *does the seeded reviewer pool spread across the relevant competent sub-communities, or
  collapse onto one cluster?* I.e. a **redundancy check** — five reviewers from one cluster
  is a weaker signal than five spread across the relevant ones, regardless of anyone's
  position on the dogma.
- **Why this is the robust framing.** Checking *spread across well-indexed mainstream
  communities* is exactly the check that survives the field-dependent indexing problems in
  §4 — because it does not depend on detecting thinly-published fringe work. The metric
  gets easier and more honest the moment it stops trying to find the contrarian.
- **It is a sanity check, not a gate.** Directional is enough; the distributed human checks
  (§2) absorb the rest.

---

## 4. Citation substrate (DEFERRED — inside §3; per-field, not universal)

The substrate question only matters if/when the metric in §3 is built. Conclusions:

- **OpenAlex is disqualified as a ground-truth backbone.** Its coverage is
  **field-dependent** (it tracks open-access density, which varies by field norms /
  mandates / economics). Its gaps correlate with the *dangerous* axis (less-OA corners
  skew non-Anglophone, less-commercial, more-theoretical), so indexing failure would be
  **indistinguishable from, and correlated with, the bias the metric is meant to detect.**
  That makes it worse than no instrument *in the ground-truth role*.
- **The observed problem is corpus COVERAGE, not graph/clustering ability.** Present papers
  cluster fine; the weak link is which papers are present. This decouples corpus assembly
  (a retrieval problem) from clustering (sound). It narrows the fix considerably.
- **Semantic Scholar** was tried earlier in this project and was less promising than hoped.
- **Biomedical core (the strong case):** assemble the corpus from **PubMed** (trusted
  coverage, already the load-bearing retrieval substrate), take citation edges from the
  **NIH Open Citation Collection (iCite)** (anchored to MEDLINE indexing, not OA density),
  use **MeSH** for cluster labeling (replaces contrast-derived keyword extraction). Because
  the clustering substrate == the trusted retrieval substrate, the
  indexing-vs-coverage confound dissolves and the metric is *calibrated* here.
- **Outside biomedicine (chem / materials / physics):** no coverage-trusted citation
  substrate currently. The clustering backbone is unavailable; the metric is *directional
  at best*; the primer leans harder on the P1 knowledge draft + targeted retrieval.
  Field-specific indices exist (e.g. INSPIRE for HEP) but chasing them per field is likely
  not worth it at current volume.
- **Architecturally cheap:** this is **substrate-per-field**, a parameter on routing the
  spec already has (field-routed retrieval + `sourcePlan`). Label the metric *calibrated*
  in the biomedical case and *directional* elsewhere. No new machinery.

---

## 5. Source-role principle (DECIDED — recurring, generalizes)

**What gates a source is the ROLE it plays, not its type.**

- **As a query/seed generator:** patchiness is tolerable. A missed seed is a recoverable
  missed query. (OpenAlex, a thin citation graph, etc. are acceptable *here*.)
- **As ground truth for "what the field contains":** patchiness is disqualifying. Gaps
  become false findings. (This is why OpenAlex fails the §4 ground-truth role.)
- **Non-scholarly sources (news, press releases):** legitimate as *frontier signals* that
  generate queries — they sometimes point at an emerging area ahead of the formal
  literature. They must **not** be what is *cited* as establishing state of the art. Any
  frontier claim surviving into the cited `fieldMap` must resolve to something checkable.
- **Provenance should record the role** (seed-only vs cited-claim), not just the URL, so
  the boundary is on what the source is *doing*. ("Citations ≠ grounding" from the existing
  spec is the same principle: a citation is a claim to validate, never automatically
  identity/affiliation evidence.)

---

## 6. Lessons distilled from Silva et al. (transferable, with cautions)

*Silva, Gouveia, Zielinski, Oliveira, Amancio, Bruno, Oliveira Jr. "AI-Assisted Tools for
Scientific Review Writing: Opportunities and Cautions." ACS Appl. Mater. Interfaces 2025,
17, 47795–47805. CC-BY 4.0.* An empirical proof-of-concept for automated review-paper
generation; their goal is far beyond ours, but several findings transfer.

- **TRANSFERABLE — their best input strategy.** Build a citation network from a broad
  query → community detection (Infomap) → derive cluster keywords by *contrast* (terms
  over-represented in a cluster vs. all others) → sample input papers *proportional to
  cluster size*. The clustering machinery is sound and maps onto both the field-structure
  seed (P1/P2) and the §3 coverage metric. (Substrate caveat per §4 — use PubMed/iCite, not
  their OpenAlex, for our biomedical core.)
- **CAUTION — single-source capture.** Removing *one* paper from a 138-paper input changed
  the output dramatically; one document's vocabulary overlap let it dominate similarity
  retrieval across many queries. This is framing contamination **from inside a clean,
  web-free corpus** — the `fieldMap`/`unverifiedLeads` boundary does not catch it because
  nothing crossed the boundary. **Mitigation:** proportional cluster sampling (not global
  top-k), and run >1 seeding while watching for a single recurring dominant source. This is
  the concrete reason the coverage check is worth running routinely (as hygiene, per §2 —
  not as an ideological guard).
- **CORROBORATION — decomposition.** They reach our §0 principle independently.
- **CORROBORATION — citation handling.** References resolve to real DOIs (via Crossref),
  validation is deterministic (Python, not an LLM step); they name the still-unbuilt hard
  layer as "does the source actually support the claim" — exactly our "citations ≠
  grounding."
- **CALIBRATION — quality ceiling.** Nine-expert evaluation of their best version:
  "excellent starting point, better than a student/postdoc draft, major-to-minor revision,
  *not* publishable." That tier sits comfortably **at or above the PD-orientation bar** —
  encouraging for the primer. The tier they *couldn't* reach (deep critical / divergent
  analysis) is **not our reviewer bar either**, because per §2 that function is distributed
  to the humans.
- **OBJECTIVE — now aligned (note, since an earlier turn said the opposite).** Their system
  optimizes for faithful, comprehensive representation of the field's consensus. Earlier in
  the discussion this was framed as the *opposite* of what we want. After the §2 reframe it
  is actually **aligned**: we want a neutral mainstream map, and the heterodoxy lives in the
  humans. Their consensus-fidelity objective is the right objective for *our primer*. (They
  flag consensus-default as a weakness *for review writing*; for our use it is acceptable.)

---

## 7. Next step (unchanged from existing spec, with a pointer)

The **shadow, people-agnostic, non-candidate-producing prototype** is still step one (per
the redesign plan §7 / the decomposition doc's "First step"). The only addition from this
discussion: **point it at a biomedical proposal first**, where corpus ground truth is
firmest (§4), before trusting any number it produces in a field where the corpus can't be
trusted.

---

## 8. Session 238 discussion — process reframe, COI calibration, verified code findings

A second design discussion (S238). The conceptual items below are **intentionally
under-defined in places** — they are direction, not build spec. The *code findings* at the
end are `[VERIFIED via source]` and precise. Where an item sharpens or qualifies §2–§5 it
says so.

### 8a. Process / objective reframes

- **REFRAMED — recall over precision (empirical).** A 10-year retrospective found
  **essentially no correlation between reviewer ratings and project success among *funded*
  projects.** This is selection-biased (we only observe funded outcomes), and the honest read
  is restriction-of-range: review functions as a **floor / gate** (screen out the
  clearly-bad), not a **ranker** (resolve which good ones succeed). Implication: optimize
  **coverage/recall of competent sub-communities**; **relax fine-grained rating precision.**
  Do **not** over-read this into "reviewer quality doesn't matter" — the selection bias
  forbids that conclusion. This is the empirical warrant for §2's quality-bar relaxation, but
  ONLY on the precision axis (see 8a-spread).
- **REFRAMED — the slate is a toe-hold (0→~75 %), seeding a referral-driven search.** Many
  invited reviewers decline but **suggest alternatives**; staff iterate on those referrals.
  Decline→refer→iterate is **snowball sampling**, and expert referral is the real convergence
  engine — better-grounded than anything the system synthesizes. The system owns the
  cold-start; humans + referrals own the rest → **invest proportionally** (don't over-engineer
  the first slate to "perfect"; the process is built to correct individual misfires).
- **DECIDED — collective seed *spread* is the non-relaxable property (8a-spread).** Snowball
  sampling stays in the seed's neighborhood, so a **collapsed seed is entrenched by
  iteration, not fixed.** Per-person precision is relaxable (decline/referral corrects it);
  **collective spread is not.** This is exactly the false-negative / coverage axis: staff
  cannot correct a sub-community the system never surfaces, and referral can't escape a
  neighborhood the seed never entered. The distributed-human redundancy of §2 absorbs
  **false positives** (a weak reviewer gets discounted); it does **not** absorb
  **false negatives** (a missing community). Apply §2's "directional is fine" to ranking, NOT
  to coverage.
- **DECIDED — two-axis fit is a built-in spread floor + a cheap eval anchor.** A competent
  slate needs **field-question experts** (the big questions) AND **methods/technique experts**
  (are the methods satisfactory) — usually *different communities*. Maps onto `fieldMap`
  (`subAreas`/`frontiers` vs `methods`). Cheap, human-anchorable evaluation for the shadow
  prototype: on a known biomedical proposal, do the generated queries/seeds **surface both
  communities**, or collapse to one? That is a spread check with ground truth, without the
  deferred §3 substrate metric.
- **RE-PRICES §3 (reconciliation, not contradiction).** §3 files the coverage/bias metric as
  "optional, later." 8a keeps that true for the **rigorous citation-substrate instrument**
  (§4) — still deferred — but **elevates the coverage *property* itself to the primary quality
  signal**, because the retrospective says spread (the gate) carries the value while ranking
  precision (the ceiling) does not. Net: the *cheap* spread check (two-axis eyeball on a known
  biomedical proposal) is **not** optional and belongs in the first shadow run; only the
  *heavy* substrate-calibrated metric stays deferred. Read §3's "optional/directional" as
  scoped to the instrument, not to coverage as an objective.

### 8b. COI calibration

- **REFRAMED — the dominant COI failure is over-recusal, not under-detection.** Potential
  reviewers are **abundantly cautious and self-declare**, removing themselves from contention.
  So a system-side COI **false positive (over-exclusion) is the expensive error** — it stacks
  on the reviewers' own over-caution and collapses an already-thin pool. The system must not
  become a *third* over-recuser. (Scope, §8c: the over-exclusion this warns against is
  **inferred / borderline** COI, NOT the obvious high-precision kind. Track-B's silent
  institution-COI **hard drop** (`filterConflicts`) is **policy-correct** — per foundation policy
  same-institution is *always* a conflict and would never be invited, so dropping it costs
  nothing [Justin, S238]. Track-A surfaces the same signal via `markInstitutionCOI`; the
  disposition differs but neither is the failure mode.)
- **DECIDED — calibrate by detection *precision*, not COI severity.** **Hard-flag up front the
  obvious / high-precision COI** (same institution, substantial co-publication, applicant-named,
  recent coauthor) — these are true-positives the staff wouldn't invite in the initial batch
  anyway, so the cost is ~zero. **Soft-flag the inferred / borderline; never gate on it** — the
  reviewer's own conservatism is the backstop. Keep COI on the obvious signals already built;
  **resist extending into inference.**
- **DECIDED — batch-relative retain-with-status, for the RECOVERABLE COI kinds only.**
  Borderline cases (e.g. a single hub-artifact co-authorship) may legitimately re-enter later
  iterations (referral, pool thinning), so represent them as a **status/flag on a retained
  candidate**, not a hard removal — a held-out coauthor is recoverable, matching the snowball
  reality. This does **not** apply to **permanent** conflicts: same-institution is always a
  conflict by foundation policy and correctly stays a hard drop (§8c) [Justin, S238].
- **DECIDED — co-authorship is a graded proxy with a low-end false-positive mechanism.** A
  *single* shared paper is often a **hub artifact**: a corresponding-author X invites A and B
  as collaborators for specific techniques; A and B co-appear without a real relationship. 8
  shared papers is a genuine collaboration; 1 may be noise. Disambiguating texture (**count,
  author position, recency, co-author-list size**) is computable. **A naive binary
  co-authorship flag disproportionately penalizes methods-experts** — the technique people who
  get invited onto many groups' papers — i.e. exactly the methods-axis half of the spread
  requirement. So co-authorship texture **protects methods-axis recall**; it is not cosmetic.
- **NOTE — adjacent high-leverage lever (out of finder scope).** If over-recusal is a *main*
  failure mode, clarifying at **invitation time** what actually constitutes a disqualifying
  conflict (vs. a disclosable-but-fine relationship) could recover more pool than any
  finder-side change. Lives in the invite/onboarding flow.

### 8c. Verified code findings (S238, `[VERIFIED via source]`)

Traced the live Track-A (Claude-verified) + Track-B (DB-discovered) disposition. The question
was: *is anything excluded by a gate staff would never see?* Answer: **yes — several**, almost
all on the Track-B (database-retrieved) path, which runs a gauntlet of silent hard filters
before any staff-visible disposition. (My first pass found only the `isRelevant` gate and
wrongly called everything else "flag-not-drop"; Codex's S238 review surfaced the rest — see the
CORRECTION bullet below.)

- **Co-authorship COI flag was BINARY — FIXED S238 (8d fix 1).** `checkCoauthorHistory` collected
  per-author `paperCount` + recent papers but the verdict was `hasCoauthorship = length > 0` → **1
  shared paper == 8**, grading texture thrown away. Now graded via `coauthorCOIStrength`
  ('likely'/'possible'). (Still open: co-author search uses initial-only PubMed format `LastName F`
  → namesake-prone, can **over**-flag a same-initial person; it remains a **flag, not a drop**.)
- **SILENT DROP GATE — `isRelevant !== false` — FIXED S238 (8d fix 2).** (`discover.js:307`). Track-B
  database-discovered (real, retrieved) candidates tagged `RELEVANT: No` by the **second Claude
  reasoning call** (`reviewer-finder.js:436`) are filtered out with **count-only** reporting
  (`:310-315`) — **no names streamed.** A parametric Claude judgment culling *grounded* real
  people, invisible to staff = the LLM-gatekeeping the redesign exists to remove. (Defaults to
  relevant when Claude is silent, so it only acts on explicit "No"s — but those are unlogged by
  name.)
- **Proposal-author filter — VISIBLE for Track-A, COUNT-ONLY for Track-B.** Removes PI/co-Is
  (`discover.js:199-222,318-338` → `deduplication-service.js:319-345`). The **verified** path
  streams excluded **names** (`discover.js:210-217`); the **discovered** path streams only a
  **count** — names are logged server-side, not surfaced (`discover.js:326-334`).
- **Track-B silent hard-drop gauntlet (CORRECTION — this is the real answer to "what would I
  never see").** Before any staff-visible disposition, database-discovered (real, retrieved)
  candidates pass through several **silent hard filters**, most reporting only a count or
  nothing: (a) exact excluded/already-surfaced-name partition on verified+unverified+discovered
  (`discover.js:158-178`, count-only); (b) verified-name dedup against Track-A
  (`discovery-service.js:241-244`); (c) cross-field contamination drop
  (`discovery-service.js:248-250`); (d) **institution-conflict HARD DROP** via `filterConflicts`
  — same-institution `return false`, only a `stats.filteredByCOI` count
  (`discovery-service.js:254-261` → `deduplication-service.js:356-374`); (e) `<3` publications
  drop — **FIXED S238**: now surfaced as a `lowPublicationCount` warning via
  `partitionByPublicationBar`, not dropped (§8d fix 3). Plus Stage-1 validation drops
  placeholders/incomplete/duplicate/excluded suggestions before discovery
  (`reviewer-finder.js:546-578`).
- **What IS flag-not-drop (the corrected, narrower claim):** Track-A institution COI
  (route-level `markInstitutionCOI`, "flag, don't filter" `discover.js:225`); Track-A coauthor
  COI (above); forename/institution/expertise mismatch — only the **forename gate** demotes
  verified→`unverified[]` (still surfaced), institution/expertise are soft flags; Track-A `<3`
  pubs → `unverified[]` (`discovery-service.js:695-707`, UI read-only). Ranking is **sort-only**
  (`relevance-score.js:95-99`); `filterByHIndex`/`filterByMinimumQualifications` is **dead code**
  (no live caller). **My earlier "flag-not-drop everywhere else" was wrong** — it described the
  Track-A route path and missed the Track-B service-path drops above.
- **§8b "surfaces, doesn't exclude" is Track-A-only — and the Track-B drop is CORRECT.** For
  Track-B, institution COI is a **hard exclude** (`filterConflicts`), but per foundation policy
  same-institution is *always* a conflict, so the drop is **right, not a gap** [Justin, S238].
  The retain-with-status principle (8b) applies to *recoverable/borderline* COI (co-authorship),
  not to institution. (My earlier "this violates the principle" framing was wrong.)
- **Upstream invisibilities (before discover runs):** excluded names are fed into the *analyze
  prompt* so Claude doesn't generate them, plus the exact-name partition above. **Track-A is NOT
  purely parametric** (Codex correction): the analyze prompt explicitly asks for
  proposal-mentioned names + reference authors *before* known experts
  (`reviewer-finder.js:81-85`) and `normalizeSuggestionSource` preserves
  `SOURCE: Mentioned in proposal` → `proposal_named` (`discovery-service.js:741-759`). The
  parametric-invention concern is scoped to the "known experts" portion, not the whole pool.

**Shippable fixes, independent of the big redesign:**
1. **SHIPPED S238 — graded co-authorship COI.** `hasCoauthorCOI` stays boolean for all
   consumers; new `coauthorCOIStrength` ('likely' vs 'possible') from `gradeCoauthorCOI` tiers
   on the strongest single co-author tie (`COAUTHOR_COI_STRONG_MIN`=3). A single shared paper now
   reads as amber "possible coauthor overlap (may be incidental)" instead of a red COI — protects
   methods-axis recall (8b). Both Find clients + persisted COI notes + exports gate on strength;
   roster DTO persists it. (Author position / list-size not used — co-author search doesn't fetch
   them; count-based v1.)
2. **SHIPPED S238 — `isRelevant` drop made visible.** The reasoning pass no longer hard-drops
   off-topic Track-B candidates; they are kept, tagged `aiFlaggedNotRelevant`, sorted last
   (server + Workbench re-rank), shown with a warning in both clients, and reported by name.
   Restores the surface-don't-silently-exclude posture (8b).
3. **SHIPPED S238 — Track-B `<3`-pubs is now a warning, not a silent drop.**
   `DiscoveryService.partitionByPublicationBar` keeps under-bar candidates (tagged
   `lowPublicationCount`) and surfaces them instead of filtering them out; qualified (`>=` MIN)
   candidates keep priority for the identity-resolution budget, low-pub ones are appended after
   and resolved only if budget remains. Both Find clients render a "Few publications found"
   warning. Motivated by dedup undercount (a preprint + its published version collapsing to one
   can push a real reviewer under the bar) [Justin, S238]. Regression test in
   `tests/unit/discovery-track-b-identity.test.js`.
4. **(Optional, lower priority) Count→name reporting for the OTHER Track-B silent drops** (dedup,
   cross-field contamination) for staff auditability. **NOT** institution-COI — that hard drop is
   policy-correct and stays [Justin, S238].

### 8d. Open — Codex's prior-review caveats on this doc (reconcile when building)

From the S238 Codex review of §1–§7 (treat as a build-time rigor check, per the "Codex informs
rigidity once we build" stance): §4's OpenAlex "**DISQUALIFIED**" needs a **role-scope
qualifier** (it is disqualified as *metric ground-truth*, but the redesign plan endorses
OpenAlex+ORCID as the cross-field **spine** for presence/seeding — §5's own role principle);
"the confound **dissolves**" for PubMed+iCite+MeSH is overstated (at most "calibrated", and the
plan still lists richer-XML/MeSH/ORCID parsing as prerequisites); and the Silva et al. specifics
(Infomap, the one-paper dominance finding, the quality-ceiling rating) are **unverified against
the actual paper** — treat as external evidence pending source review, not settled authority.

### 8e. Lock before building (Codex S238 — its rigidity informing the build, not the discussion)

Codex independently verified §8c against source (confirmed the binary coauthor flag and the
silent `isRelevant` drop; surfaced the Track-B gauntlet I'd missed) and judged §8a/§8b reasoning
**sound** (recall-over-precision correctly scoped, §3 re-pricing coherent, snowball/two-axis
clean). The over-recusal premise it flagged as **plausible-but-unverified domain reasoning** — fine
as direction, but pin the specifics before they become thresholds/UX. The four forks to settle
**before** writing code (each changes API-response shape, UI sections, and staff auditability):

1. **Disposition model for COI candidates.** Current code mixes hard removal, flags, and
   read-only unresolved states. SETTLED: hard-drop proposal-authors AND same-institution (policy,
   §8c) [Justin, S238]. Still to decide: co-authorship COI → graded retained status; batch-relative
   "held out initially, recoverable later" for the *recoverable* kinds only.
2. **`isRelevant` handling — RESOLVED S238 (8d fix 2):** chose down-rank-and-flag (kept, sorted
   last, warned, names streamed) over hard-drop / separate bucket.
3. **Track-B pre-reasoning filters** (excluding institution-COI = settled policy, and `<3` pubs =
   FIXED S238 → warning). The remaining silent filters (dedup, cross-field contamination) still
   remove real retrieved candidates. Decide: keep as hard gates *with named audit output*;
   convert to retained low-confidence candidates; or apply only after a staff-visible status.
4. **Coauthor-COI grading thresholds — RESOLVED S238 (8d fix 1):** v1 grades on max shared papers
   with one author (≥3 = 'likely'/red, 1-2 = 'possible'/amber). Recency / author-position /
   list-size deferred (the co-author search doesn't fetch them yet).

Items 1 and 3 remain the build-time rigidity points — settle them when that work starts.

### 8f. Track-B activity-signal flaw (the "h-index 61 vs 2 publications" paradox) — CONFIRMED, fix scoped

`[VERIFIED via source + Codex adjudication, S238]` Triangulated three independent ways
(the live paradox below, Codex's line-level code adjudication, and the funnel math) — this
is a real structural flaw, not a shifting read.

**The paradox.** On request 1002794 (physics), a confirmed-identity Olga Smirnova
(h-index 61, ~14k citations) surfaced flagged `lowPublicationCount` with **"2 publications"**,
ranked **28th**. Reconciliation: the two numbers measure different things — h-index is a
career bibliometric (display only; ranking excludes it, `relevance-score.js`), while
"2 publications" is the size of the candidate's `publications[]` array, which for Track-B is
built **from this run's keyword-search hits**, not the author's corpus.

**The origination funnel (verified).** One proposal *narrative* (e.g. `ProjectDescription.pdf`)
→ **one overloaded Claude call** (`createAnalysisPrompt`, `shared/config/prompts/reviewer-finder.js`)
that emits metadata + reviewer names + PART-3 `searchQueries` together → ~3 queries per source,
each **3–6 words**, "methods/organisms/phenomena/systems", no author names → each query fetches
the **top 50** recent papers (`searchPubMed`, 5-yr `pdat` filter) → each paper mints **one**
candidate from a **single author position** (PubMed/arXiv = last author `discovery-service.js:1149-1164,1210`;
bioRxiv/chemRxiv = corresponding/first `:1278,1341`) with `publications: [that one paper]` →
dedup merges by author (`deduplication-service.js:192,228`, no preprint/DOI dedup at the merge).

**The funnel math (the operator's point, S238).** ~3 queries × top-50 × single-author-position
≈ up to 150 author-instances; in a *busy* field those are mostly **distinct** people, so the
expected per-author count is **~1**. Empirically on 1002794 (run-specific — the exact split
varies run to run, which is itself the nondeterminism finding): the great majority of discovered
candidates were flagged `<3` (≈75–80 of ≈83–85 across two runs, most with exactly 1 paper); only
a handful cleared `MIN_PUBLICATIONS=3`. So the `≥3` bar — intended as an
"active researcher" filter — actually measures **query-result concentration**, which is near-zero
for almost everyone. It fails in *both* directions: it buries real leaders who matched only one
facet as senior author, and the few who clear it are senior-/prolific-lab authors matching
multiple query facets (a senior-bias signal, not a best-reviewer signal).

**Two root mechanisms (Codex precisions applied):**
1. **Wrong instrument.** Track-B `publications.length` = query coverage, not productivity <!-- drain-table:ignore reason=candidate-field-not-pg-table -->
   (`partitionByPublicationBar`, `discovery-service.js:~274`).
2. **Wrong ordering — and the *flag* is not what buries her.** The burial is driven by a low,
   *finite* `publicationCount5yr` flowing into the recency scorer (`deduplication-service.js:229`,
   `relevance-score.js:50,111`); the `lowPublicationCount` flag is a *parallel* symptom of the
   same root, not the cause. Both are computed from the search hits **before** identity resolution
   (`:294`) and the OpenAlex works backfill (`:348`). Backfill then can't fix it: it targets only
   candidates with an OpenAlex id **and empty `publications`** (`:414,417`) — a 2-hit candidate is <!-- drain-table:ignore reason=candidate-field-not-pg-table -->
   not a target — and only sets `publicationCount5yr` when `!Number.isFinite` (`:440`), but dedup
   already set a finite low value (`deduplication-service.js:229`). Nothing re-evaluates either
   field after `confirmed` identity (`:945`).

**Principle (DECIDED).** Once an identity is resolved to `confirmed`/`probable` against
OpenAlex/ORCID, the activity/standing signal must come from **that resolved author's real recent
corpus**, never from incidental keyword-hit counts.

#### Fix scope

**Part 1 — Activity-from-resolved-corpus (near-term, in-pipeline; the higher-leverage change).**
After `resolveTrackBIdentities`, for every `confirmed`/`probable` Track-B candidate with a resolved
OpenAlex/ORCID author id:
- **Widen the backfill target** (`backfillOpenAlexPublications`) from "empty `publications` only" <!-- drain-table:ignore reason=candidate-field-not-pg-table -->
  to "any confirmed/probable candidate", and have it **overwrite** `publicationCount5yr` from the
  resolved author's real recent (≤5-yr) works — not just fill when absent. (Both the target
  condition `:414,417` and the `!Number.isFinite` guard `:440` must change for this path.)
- **Re-evaluate `lowPublicationCount` after resolution**: clear it when the *real* recent-works
  count ≥ threshold; keep it (now meaningful) when the real corpus is genuinely thin.
- **Stop gating/flagging confirmed identities on the search-hit count.** For *unresolved*
  candidates the search-hit count is the only signal we have — keep surfacing them as a warning
  (Fix #1 behaviour) rather than dropping.
- **Sequencing complication (must address):** identity resolution is capped at
  `TRACK_B_IDENTITY_RESOLUTION_LIMIT=25` and the *pre-resolution* ranking that selects which 25 to
  resolve uses the same broken search-hit signal — so a heavyweight with 1 hit can be **deferred
  and never resolved**, and Part 1's repair never reaches them. Options: raise/elastic cap; select
  for resolution by a signal other than hit-count (e.g. resolve all distinct authors with any
  topical match, budget permitting); or resolve-then-rank in passes. Decide before building.
- **Risks/verify:** more OpenAlex calls (bounded by candidate count — check latency budget);
  overwriting `publicationCount5yr` shifts rankings broadly → validate on a sample that the
  heavyweights rise and nothing good regresses (reuse the smoke + overlap harness,
  `scripts/smoke-discover-dispositions.mjs`).

**Part 2 — Origination ceiling (redesign-scope; a post-resolution patch CANNOT fix this).**
PubMed/arXiv mint only last authors and bioRxiv/chemRxiv only corresponding/first, so a heavyweight
who is not in those positions in any returned paper is **never minted as a candidate** in that run
— and the 3–6-word query crowd is large and surface-biased. This is the §4.4 author-extraction rule
(take **all** authors) and the §4.1/§4.5 retrieval redesign (field-routed sources + cited-reference
lane + decomposed, non-overloaded query generation). Part 1 raises the ceiling for people who *do*
get minted + resolved; Part 2 is what gets the right people minted in the first place.

**Not in scope here** (tracked separately): the initial-only coauthor-COI namesake bug (the
"Jian Wu / 10 papers" false COI, §8c / §5.1) — a different defect in the COI search, not the
activity signal.

---

## Quick decided / deferred / retracted index

**DECIDED (apply now):**
- Primer = neutral, accurate, mainstream field map (§1).
- Primer quality bar = useful + honest, not load-bearing (§2).
- Applicant-suggested-reviewer exclusion is load-bearing (§2).
- Source gated by role, not type; provenance records role (§5).
- Mitigate single-source capture via proportional cluster sampling + multi-seeding (§6).
- Recall over precision; review is a floor/gate not a ranker (10-yr retrospective, §8a).
- Collective seed *spread* is non-relaxable (snowball entrenches it); precision is (§8a).
- Two-axis fit (questions + methods) = spread floor + cheap eval anchor (§8a).
- COI: hard-drop the permanent policy conflicts (proposal-authors, same-institution); flag/surface the rest; soft-flag inferred/borderline (never gate); batch-relative retain-with-status for the recoverable kinds (§8b).
- Co-authorship is graded (count/position/recency/list-size); binary flag harms methods-axis recall (§8b).
- The cheap two-axis spread check is NOT optional in the first shadow run (re-prices §3, §8a).
- Track-B activity signal must come from the RESOLVED-identity real corpus, never search-hit counts; the `MIN_PUBLICATIONS≥3` bar measures query-result concentration (CONFIRMED flaw, fix scoped, §8f).

**DEFERRED (optional, later):**
- The coverage/bias metric, narrowed to "spread across competent sub-communities" (§3).
- Citation substrate, per-field: PubMed + iCite/MeSH for biomedical, directional elsewhere (§4).

**RETRACTED (do not reintroduce):**
- Instructing the primer to surface/editorialize divergent perspectives (§1, §2).
- "Find the rare premise-challenging reviewer" as a system objective (§2).
- OpenAlex (or any single graph) as the metric's required ground-truth backbone (§4).
- The framing that Silva et al.'s objective is the opposite of ours (§6).
