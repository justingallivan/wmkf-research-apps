# Reviewer Finder — Retrieval-First Redesign Plan

Status: **DESIGN.** Phase-1 verify-hardening (forename gate + soft mismatch flags
+ PubMed year basis) is **IMPLEMENTED on branch `reviewer-verify-identity-states`**
(validated by unit tests + live smoke S231; not yet merged). Everything else is
unbuilt. Every "current state" claim is labelled `[VERIFIED]` (read from source or
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
- `[VERIFIED]` `validateAnalysisResult` only warns (no count/dup/truncation
  enforcement, no retry) (`shared/config/prompts/reviewer-finder.js:478`;
  `claude-reviewer-service.js:203-233` returns `success:true` with the
  validation attached even when `valid:false`).
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
- **Current consumer migration required:** `[VERIFIED]` `/discover` currently
  streams `verified/unverified/discovered/ranked` with binary source semantics
  (`pages/api/reviewer-finder/discover.js:362-367`); the roster collapses source
  to `claude_verified` vs `database`
  (`lib/services/reviewer-roster-store.js:23-27`); save maps source to
  `claude/pubmed/arxiv/biorxiv/unknown`
  (`pages/api/reviewer-finder/save-candidates.js:79-84`); the Workbench UI splits
  sections by `isClaudeSuggestion || source === 'claude_suggestion'`
  (`shared/components/reviewers/ReviewerSearchSection.js:78-83,787-788`). The
  redesign must update all four contracts together: `/discover` emits the
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
  [IMPLEMENTED on branch — see §5.]

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
- **Cost:** currently integrated scholarly APIs are free except Google Scholar
  (SerpAPI, paid), but ADS and production Semantic Scholar constraints are still
  unverified and must be checked before treating them as operationally settled.
  For the known free APIs, the constraint is rate limits, not money. The recurring
  spend is the LLM calls. (S2 key obtained S231; 1 req/s cumulative; only public
  author names sent to scholarly APIs — proposal content goes only to Claude.)

---

## 7. Sequencing
1. **Route current `verifyClaudeSuggestions` through identity states — no new
   sources.** The current verifier is isolated in
   `discovery-service.js:327-388`; first make it emit the new identity/provenance
   DTO and update `/discover`, roster, save, and UI section contracts together
   (§4.2). This establishes the candidate wire shape before fan-out changes.
2. **Bug-fix hardening (§5) without source expansion.** Forename gate on
   initial-only verification, institution/expertise mismatch → soft flags (not
   demotion), PubMed year basis, COI parity, and non-research grant filtering.
   These are behavioral safety fixes around current sources. (The forename gate +
   soft mismatch flags + year basis are already IMPLEMENTED on the branch.)
3. **Analyze contract rewrite.** Replace delimiter parsing with schema output,
   retry/repair, typed invalid-analysis failure, and no parametric candidate
   names. Keep source planning and proposal/reference extraction, not reviewer
   invention.
4. **Add field-routed retrieval sources with provenance plumbing already in
   place.** OpenAlex + ORCID spine, ADS/arXiv/DBLP/INSPIRE as field-routed lanes,
   and reference-resolution should land **with** the DTO/UI/save/roster
   provenance contract, not before it.
5. **Add the hypothesis-builder and resolver input adapter.** Publication
   clusters, forename/co-author/affiliation evidence, and cross-source
   corroboration feed the pure resolver; the resolver remains classification and
   persistence-gating only.
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
