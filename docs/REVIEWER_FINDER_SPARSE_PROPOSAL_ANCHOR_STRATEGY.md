---
title: Reviewer Finder - Sparse Proposal Anchor Strategy
domain: reviewer-identity
kind: plan
status: active
summary: "An anchor is an evidence item extracted from or derived from the proposal. It may seed work resolution, literature expansion, identity resolution,..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md
  - docs/REVIEWER_PROVENANCE_MODEL.md
  - scripts/probe-grounded-origination.mjs
  - scripts/probe-applicant-trail-origination.mjs
---

# Reviewer Finder - Sparse Proposal Anchor Strategy

Status: **Strategy / validated direction** (not yet built). This document captures the
2026-06-10 strategy discussion for the current grant cycle, where proposals do not
reliably contain formal bibliographies. **§12 records what three S239 read-only probes
EMPIRICALLY validated** (structured PI identity, the ORCID-works corpus fix, the
topic-aggregation lane, the multi-lane convergence model). §1–§11 are the original
design sketch; where §12 supersedes them it says so. It is not an implementation
record. Proposed behavior is labeled `[PROPOSED]`, validated findings `[VERIFIED via
probe]`; do not treat any of it as shipped.

## 1. Problem

[ASSUMED - current cycle observation] This grant cycle does not provide a reliable
bibliography for every proposal. Some proposals include inline DOI references. Some
include partial citations or informal mentions. Others include little or no formal
reference material. Most proposals list peer groups, but those peer-group mentions
can be difficult to resolve when the proposal gives only a surname, lab shorthand,
or institution-level clue.

[VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`] The reviewer finder
redesign already treats retrieval-originated people as hypotheses until work-level
grounding, identity clustering, and corroboration have been applied. The key
extension in this document is that the first unit of discovery should be a mixed
**anchor set**, not a bibliography.

## 2. Core Observation

The useful lesson from AI-assisted review-writing systems is not that an LLM can
write a good review. The useful lesson is that review writing starts from papers,
and papers expose the expert graph: authors, references, cited-by edges, co-citation
patterns, and topic neighborhoods.

For reviewer discovery, the goal is therefore not to infer experts directly from
keywords. The goal is to recover enough work-level anchors from the proposal to
build a field map, then derive reviewer candidates from resolved works and their
authorship neighborhoods.

## 3. Design Principle

**Anchors are not candidates.**

An anchor is an evidence item extracted from or derived from the proposal. It may
seed work resolution, literature expansion, identity resolution, or COI review. It
does not by itself make a person selectable.

[VERIFIED via `docs/REVIEWER_PROVENANCE_MODEL.md`] Existing provenance vocabulary
distinguishes `cited_reference`, `proposal_named`, `literature_retrieved`,
`applicant_suggested`, and barred parametric suggestions. This strategy preserves
that boundary:

- A resolved work author from an explicit proposal citation can become
  `cited_reference`.
- A specifically named person in proposal text can become `proposal_named`, subject
  to identity verification and COI review.
- Authors discovered through expansion, topic search, or graph traversal remain
  `literature_retrieved`.
- A peer-group or last-name-only mention is an anchor, not a candidate provenance
  kind, until it resolves to a specific work or a specific person with corroborating
  evidence.

## 4. Evidence Ladder

[PROPOSED] Extract and resolve anchors in this order. Higher tiers should dominate
lower tiers when ranking evidence strength.

| Tier | Anchor | Resolution target | Use |
|---|---|---|---|
| 1 | Inline DOI, PMID, PMCID, arXiv ID, or useful paper URL | Exact work | Resolve work, authorship, references, cited-by, related works |
| 2 | Partial inline citation | Candidate work | Search Crossref/OpenAlex by title, author-year, venue, and nearby context; keep unresolved if no confident work match |
| 3 | Applicant / PI publication trail | Applicant-authored works | Use recent applicant works as a proxy bibliography when the proposal lacks references |
| 4 | Peer group mention | Field/lab/person/work clue | Use as a weak search constraint or COI clue; do not promote last-name-only mentions directly |
| 5 | Scientific topic, method, disease area, model, material, organism, dataset, or instrument | Topic-seeded works | Seed literature retrieval when work anchors are sparse |
| 6 | LLM-generated query seed | Search query only | Use only to search source databases; never treat as a person source |

## 5. Proposed Pipeline

[PROPOSED] The sparse-proposal path should operate as a work-first pipeline.
**[SUPERSEDED in part by §12]** — S239 probes validated that PI identity is
*structured*, not inferred from proposal text: the request's Project Leader
(`_wmkf_projectleader_value`) is a contact carrying `wmkf_orcid`, so step 1's PI
extraction + step 9's name/affiliation resolution collapse to an exact ORCID lookup.
See §12.2–§12.3. The remaining steps (anchor extraction for DOIs/peer-groups, graph
expansion, identity/COI gates) stand.

1. Extract proposal anchors into a structured object with source spans, anchor type,
   confidence, and unresolved text.
2. Resolve direct identifiers to exact works.
3. Resolve partial citations only when metadata confidence is high enough to point
   to one specific work.
4. Build a fallback applicant publication trail when proposal references are sparse.
5. Use peer-group mentions as weak constraints for work search, institution search,
   and COI context, not as reviewer identities.
6. Expand from resolved works through references, cited-by edges, related works,
   bibliographic coupling, and co-citation neighborhoods.
7. Cluster works into topic neighborhoods before extracting reviewer candidates.
8. Extract author instances from high-value works, prioritizing recent, relevant,
   non-conflicted authors.
9. Resolve identities separately using OpenAlex author IDs, ORCID, authorship on
   specific works, affiliation evidence, co-author context, and field fit.
10. Surface only `confirmed` or `probable` identities as selectable; keep ambiguous
    or weakly grounded rows in needs-review or evidence-only views.

## 6. Anchor Provenance

[PROPOSED] Anchor records should preserve why a work or person hypothesis entered
the system. Suggested anchor-level labels:

| Anchor label | Meaning |
|---|---|
| `resolved_inline_identifier` | Proposal text contained a resolvable DOI, PMID, PMCID, arXiv ID, or paper URL |
| `resolved_inline_reference` | Proposal text contained a partial citation that resolved to one specific work |
| `unresolved_inline_reference` | Proposal text looked citation-like but did not resolve confidently |
| `applicant_work_reference` | Work came from the applicant or PI publication trail |
| `peer_group_mention` | Proposal named a peer group, lab, institution, or partial person clue |
| `topic_seed_work` | Work came from topic/method/material/disease search because stronger anchors were sparse |
| `query_seed_work` | Work came from a query generated by an LLM or field primer |

Candidate provenance should be derived after resolution:

- `cited_reference` only when the candidate is an author on a resolved work that
  the proposal actually cited or identified.
- `proposal_named` only when the proposal named a specific enough person and
  identity evidence supports that person.
- `literature_retrieved` for authors found by graph expansion, topic search, or
  query-seeded retrieval.

## 7. Peer Group Handling

[PROPOSED] Peer groups should be treated as high-value but low-precision signals.
They are useful because applicants often name the people or labs they consider
central to the field. They are dangerous because a surname alone can map to many
people, and a lab or group name may refer to a PI, a trainee, a collaborator, an
institution, or a broader school of work.

Operating rules:

- Parse peer-group mentions into structured clues: name text, institution text,
  lab/group wording, nearby scientific context, and proposal span.
- If the mention is surname-only, do not create a selectable person candidate from
  it.
- Use peer-group clues to search for works, author clusters, and COI context.
- Promote a peer-group clue to `proposal_named` only when it resolves to a specific
  person with independent identity corroboration.
- If a peer-group clue resolves only to a lab or institution, keep it as context for
  topic mapping and COI screening.

## 8. Guardrails

[VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`] Retrieval-originated
does not mean identity-grounded. A citation can ground an author string on a work,
but it does not prove current identity, affiliation, contactability, eligibility, or
lack of conflict.

[PROPOSED] The sparse-proposal strategy should enforce these guardrails:

- Never convert a last-name-only peer mention directly into a selectable reviewer.
- Never treat generic `SOURCE: References` text as `cited_reference`; only resolved
  work authorship qualifies.
- Prefer unresolved or needs-review over confident nearest-neighbor identity matches.
- Keep work grounding and person identity verification as separate steps.
- Store source spans and resolution evidence for every anchor.
- Treat source outages, ambiguous work matches, and ambiguous person matches as
  abstentions, not best guesses.
- Preserve COI review separately from field relevance. A proposal-named or
  peer-group-adjacent person may be important, conflicted, or both.

## 9. Current-Cycle Operating Mode

[PROPOSED] For the current grant cycle, the practical goal is not to create a perfect
field graph for every proposal. It is to maximize high-quality work anchors before
falling back to weaker topic search.

Minimum useful pass per proposal:

1. Extract all DOI/PMID/arXiv-like identifiers and resolve them.
2. Attempt resolution for the strongest partial citations.
3. Build an applicant/PI recent-work trail when explicit references are sparse.
4. Parse peer-group mentions as search and COI anchors, with last-name-only mentions
   held below candidate-promotion threshold.
5. Run topic-seeded retrieval only after stronger anchors have been exhausted.
6. Derive reviewer candidates from resolved works and graph neighborhoods, then run
   identity and COI gates before selectability.

## 10. Non-Goals

This document does not propose:

- Using an LLM-written review as a reviewer-finder artifact.
- Treating peer-group mentions as reviewer identities by default.
- Replacing ORCID/OpenAlex/person identity verification.
- Changing persistence, UI selectability, or save behavior without a full
  caller-to-persistence-to-consumer reconcile.
- Adding new source/provenance labels to production without updating the shared
  provenance helper, ranking, roster storage, save paths, and Workbench UI together.

## 11. Implementation Questions

[PROPOSED] Before implementation, resolve these design questions:

1. Where should anchor records live during discovery: transient route state,
   persisted diagnostics, or a reusable proposal-context artifact?
2. What confidence threshold is required before a partial citation becomes a
   resolved work?
3. How many applicant works should be pulled when a proposal has no bibliography?
4. How should peer-group anchors be displayed to staff: hidden search context,
   evidence badges, or a separate "proposal clues" panel?
5. Which graph expansion is cost-effective for this cycle: references, cited-by,
   related works, co-citation, bibliographic coupling, or a capped combination?
6. What UI behavior should unresolved peer-group-derived hypotheses have if they
   are useful for human review but unsafe for selection?

## 12. Validated direction (S239 — three live probes)

Validated by three **read-only** probes on real prod requests — 1002794 (attosecond
physics), 1002959 (de novo protein design), 1003020 (DNA-repair/memory neuroscience).
Reproducible scripts (no writes; result files gitignored):

- `scripts/probe-grounded-origination.mjs` — provenance/origination breakdown +
  topic→author-aggregation + reference-DOI resolution.
- `scripts/probe-applicant-trail-origination.mjs` — Tier-3 PI trail via structured
  ORCID identity + ORCID-works corpus.

Two independent Codex reviews (S239) are folded in: the origination-verdict
falsification (its correct catch — the "guess" label — is adopted in §12.1) and a
review of THIS doc, whose safety findings are applied throughout §12 — most importantly
that **cross-lane convergence must be on resolved IDENTITY (shared ORCID / exact work
authorship), never on a shared name** (§12.4–§12.5), that COI is broader than the
trail's co-author exclusion (§12.8), and that the ORCID-works fix has scoped tradeoffs
(§12.3). Codex's overall verdict on building this as-written was **NOT-YET**; this
revision clears the *identity/name-convergence* and *ORCID-fallback* safety items at
the doc level. **Still open before implementation:** COI-per-lane — and note that
**advisor/advisee and all-time-collaborator COI have NO deterministic production gate
today** (prompt-text only), so those are *net-new gate design*, not wiring an existing
gate (the gates that exist are proposal-author filtering, institutional COI, and PubMed
coauthorship — §12.8) — plus the service integration seams (§12.8).

### 12.1 The disease, measured `[VERIFIED via probe]`

Current origination is **~92–98% keyword-reconstruction**, domain-independent
(physics ≈ biomedical). Pure parametric hallucination (`barred_parametric`) was **~0**
across all three runs — candidates are *real people reconstructed from keyword-matched
papers*, not invented. The defect is the **mechanism** (ask "which papers match these
words?", then mint one author per paper, with pub-count = query-hit concentration),
**not** the use of LLM keywords. Earlier framing called this a "guess" rate; that
over-loaded the word (Codex flagged it, correctly) — the honest statement is
"keyword-reconstructed origination dominates." The fix is to ask the **person-level**
question instead, by several grounded routes (§12.4).

### 12.2 PI identity is structured and free `[VERIFIED via probe]`

The PI is the request's **Project Leader**: `akoya_request._wmkf_projectleader_value`
→ a `contact` that already carries `wmkf_orcid`. ORCID → exact OpenAlex author. **No
LLM extraction, no fuzzy name/institution match, no name-*search* namesake hazard**
(ORCID is the hard key). Confirmed for all three PIs (Wen Li `0000-0002-3721-4008`,
Katherine Albanese `0000-0002-2336-1621`, Ted Abel `0000-0003-2423-4592`). This
**supersedes** the LLM-extract identity path (§5 steps 1, 9): the earlier fuzzy
resolver misresolved "Wen Li" → "Yanping Li" with false confidence; the structured
ORCID path removes that hazard at the root. **Residual risk (Codex):** a *mis-entered*
ORCID on the contact would silently resolve to the wrong person — so the implementation
must cross-check the contact name against the ORCID-registry record (verified manually
for all three; e.g. `0000-0002-3721-4008` → ORCID registry = Wen Li, Wayne State). The
probe does not yet enforce this check.

### 12.3 Corpus: the ORCID works list, not the OpenAlex author cluster `[VERIFIED via probe]`

Identity-exact ≠ corpus-clean. OpenAlex **merges** same-name authors, so a common-name
PI's ORCID can resolve to a contaminated cluster — Wen Li's ORCID returned a Yantai
organic-chemistry record (311 works, none his). **Fix:** take the PI corpus from the
**ORCID record's own self-asserted works list** (PI-curated), then resolve those works
to OpenAlex for their references + co-authors. Verified: Wen Li's ORCID works are clean
attosecond physics, and the trail then surfaces Keller, Dörner, **Corkum**, **Krausz**,
Kling, Vrakking — the field's leaders, and exactly the people the keyword pipeline
missed. Two guards *flag* contamination — PI email-domain vs OpenAlex
last-known-institution mismatch, and anchor-titles vs proposal-topic mismatch — but in
the probe they only **print a warning for human judgment**; the implementation must make
them deterministic.

**Scoped tradeoffs (Codex).** The ORCID-works list avoids OpenAlex's *merge* failure
but is not a free lunch: it is (a) **DOI-filtered** — works without a DOI are dropped;
(b) **recency-filtered** (≤N years); and (c) **user-curated** — an ORCID profile can be
incomplete, stale, or padded with non-author works. So it trades a merge failure for
curation/coverage gaps. **Fallback contract:** when the contact has no ORCID, or the
ORCID yields zero recent DOI-bearing works, the PI-trail lane goes **inert** and the
proposal is carried by the other lanes (§12.4) — it does not fall back to the
merge-prone OpenAlex author cluster.

### 12.4 The lanes are independent harvesters — coverage = union, confidence = convergence `[VALIDATED DIRECTION]`

Reframe of §4's ladder: **do not treat the tiers as a fragile fallback chain.** Run
every lane the proposal's signals enable; the candidate set is their **union**, and
confidence comes from **convergence** across lanes — where *convergence means two lanes
resolve to the SAME IDENTITY (shared ORCID or exact authorship of a specific work), not
the same name string* (§12.5). In the proposed grounded lanes the LLM never names a
reviewer — people are derived only from resolved works (this is the *target*; the
current production pipeline's Track A still has Claude suggest names, then verifies
them, and is out of scope for §12 until grounded coverage is proven, per the findings
doc's open question).

| Lane | Best for | S239 evidence |
|---|---|---|
| Cited-reference (inline DOIs) | any proposal that has them | strongest when present; 2/3 Phase-I docs had **none** |
| PI citation trail (Tier 3, ORCID-anchored) | continuing-line proposals | **WIN** on 1002794 (post ORCID-works fix) + 1002959 (Baker, DeGrado, Kortemme, Fleishman); PI co-authors excluded — necessary, not sufficient COI (§12.8) |
| Proposal-named / peer-groups | the applicant pointing at central people | strongest single signal; a mention must **resolve to a specific ORCID/identity** before promotion — name-only is unsafe (§7, `REVIEWER_TRACK_B_IDENTITY_SPEC.md`) |
| Topic → author-aggregation | **pivot** proposals (PI corpus ≠ the proposal's novel field) | surfaced the DNA-repair specialists (Samson, van Loon, Bjørås, **Madabhushi**) for 1003020 that the PI-trail could not |

**Worked example — 1003020 (the "pivot"):** PI Ted Abel is proposing a novel
DNA-repair-as-memory-substrate hypothesis *not* in his corpus, so the PI-trail surfaces
his established neuro field and misses the frontier. But the proposal narrative names
the peer group directly — *"Peer Groups: Madabhushi and Tsai described how DNA damage
regulates gene expression"* `[VERIFIED — proposal text, per Justin 2026-06-10]` —
naming the two DSB-in-memory leaders (Ram Madabhushi, Li-Huei Tsai), **and**
topic-aggregation independently surfaces a Madabhushi. So the proposal hands us the
right people the PI-trail cannot.

**What convergence does and does NOT buy here (Codex safety correction).** Two lanes
agreeing on the *name* "Madabhushi" is **not** identity proof and must **not** make him
selectable — that would reintroduce the wrong-affiliation/wrong-email failure the
save-path force-null gate exists to prevent, and it contradicts §7 and
`REVIEWER_TRACK_B_IDENTITY_SPEC.md`. Convergence is only valid when both lanes resolve
to the **same identity** (a shared ORCID, or exact authorship of a specific DSB-in-memory
work). A surname in a peer-group sentence is a high-value *anchor* to resolve, not a
candidate. So 1003020 is well-covered in the sense that the right anchors are *present*
in non-PI-trail lanes — but promotion still requires per-person identity resolution.
Neither probe implements peer-group parsing yet; that lane is designed, not validated.

### 12.5 Ranking: corroboration + recency `[VALIDATED DIRECTION]`

Rank by **cross-lane corroboration** and **recency**. Corroboration counts **only when
lanes resolve to the same IDENTITY** (shared ORCID or exact authorship of a specific
work) — a candidate confirmed by ≥2 lanes *at the identity level* outranks one from a
single lane. **Name-string overlap across lanes is NOT corroboration** and must never
substitute for identity equality (Codex; §7; `REVIEWER_TRACK_B_IDENTITY_SPEC.md`).
Recency: references skew to foundational work → senior/emeritus bias; recency-weight to
surface active mid-career people. This is the recall-over-precision posture applied to
grounded origination: surface, don't silently drop; let *identity-level* convergence and
recency order the pool.

### 12.6 Posture `[VALIDATED DIRECTION]`

**Do not architect for the worst case.** Not every proposal has DOIs or clear
peer-group names — degrade gracefully when signals are thin (fewer lanes fire), and
**exploit eagerly** when they are rich (inline DOIs + a clean PI ORCID + named peers →
a deeply grounded, multiply-confirmed set). No proposal must trigger every lane; none
triggers zero. The earlier "2 of 3 had no DOIs" reading was a coverage-hole framing;
the correct one is opportunistic harvest over the union of available signals.

### 12.7 Surviving caveats / open tuning

- **Facet quality:** Claude's current 5-word MeSH-style queries are too narrow for
  OpenAlex full-text aggregation (corpora of 0–20). Generate broader/atomic facets
  from the proposal. A tuning problem, not a ceiling.
- **Detector reads the aggregate:** "anchor-titles match the proposal?" must read the
  *aggregate of frequent anchors*, not a raw sample — a multi-topic PI's sample may
  show a side line (Wen Li's LiDAR instrumentation) while the frequency-ranked experts
  are correctly the dominant field.
- **Recency-weighting** is still to be implemented; the probe ranks freq-then-recency.
- The probe's 200-reference resolution cap is a sampling bound, not a design limit.
- **COI is broader than the trail's exclusion (Codex).** The PI-trail only removes the
  PI + their *recent DOI-bearing* co-authors. Every lane's candidates must still pass
  the **existing production COI gates** — proposal-author filter, institutional COI,
  PubMed coauthorship (§12.8) — before selectability; the trail's co-author drop is a
  head-start, not a substitute. **Two COI classes have NO gate today and are net-new
  design, not wiring:** *all-time collaborators* (outside the recent DOI corpus) and
  *advisor/advisee ties* (currently prompt-text only — `reviewer-finder.js:105-107` —
  not deterministic). Until those gates exist, candidates from every lane carry residual
  COI risk on those two axes; this is implementation work, not a doc-level claim to make.

### 12.8 What this does NOT change — and the integration seams (Codex)

Persistence, provenance vocabulary, identity/COI gates, and selectability still follow
the existing model (§3, §6, §8) and `docs/REVIEWER_PROVENANCE_MODEL.md`. Lanes map onto
existing provenance kinds (`cited_reference`, `proposal_named`, `literature_retrieved`).
No new provenance label, ranking change, or UI ships without the full
caller→persistence→consumer reconcile in §10.

**The probes are read-only diagnostics, not a parallel pipeline.** They use raw
`fetch` and bypass the production contracts; building §12 means adding lanes *into*
those contracts, never porting probe code as-is. The seams that must own the new lanes:

- `DiscoveryService.discover()` — Track A/B output shape + bounded identity resolution.
- `lib/services/openalex-service.js` — must gain the new calls (ORCID→author, ORCID
  works list, author-aggregation); the probes' inline `fetch`es do not belong in prod.
- `lib/utils/reviewer-provenance.js` — provenance kinds, groups, save-source mapping,
  selectability (`provenanceGroupOf`).
- COI gates in `pages/api/reviewer-finder/discover.js` (proposal-author filter,
  institutional-COI mark, PubMed coauthorship) — every lane routes through these. These
  are the gates that **exist**; advisor/advisee + all-time-collaborator COI are NOT
  gated here and require net-new design (§12.7).
- `pages/api/reviewer-finder/save-candidates.js` — force-nulls contact/identity fields
  for unresolved rows. The cardinal boundary: **a name-converged-but-unresolved
  candidate is NOT a confirmed identity** and must stay non-selectable.
- Workbench UI (`ReviewerSearchSection.js`) — groups by `provenanceGroupOf`, blocks
  needs-review selection.

Per Codex, building this is the **NOT-YET** work: wire the lanes into these seams with
identity-equality corroboration and per-lane COI, not a side pipeline.

