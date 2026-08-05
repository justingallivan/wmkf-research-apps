---
title: Reviewer Identity and Institution Resolution Research
domain: reviewer-identity
kind: decision
status: active
summary: "Research-only strategy for institution resolution, reviewer identity, current affiliation, and contact attribution; no build is authorized."
canonical: false
cataloged: 2026-08-04
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - .claude-memory/project-reviewer-affiliation-institution-linking.md
  - .claude-memory/project-reviewer-contact-enrichment-anchoring.md
---

# Reviewer Identity and Institution Resolution Research

Date: 2026-08-04

## Status and boundary

This document records external research and a proposed evaluation strategy. It
does **not** authorize implementation, schema changes, provider adoption,
production writes, CRM Account linking, or changes to the existing fail-closed
identity gates.

The purpose is to step back from individual heuristics and define the problem
before more code is written. Any later build should begin with an owner-approved
benchmark and experiment plan derived from this research.

## Executive conclusion

The problem is not one fuzzy string match. It is four related but distinct
decisions:

1. **Institution resolution:** which canonical organization, if any, does an
   affiliation string identify?
2. **Person identity:** which real person, if any, is represented by a name,
   work, author record, or profile?
3. **Current affiliation:** what dated institutional relationship or
   relationships does that person currently hold?
4. **Contact attribution:** does a particular email address or webpage
   currently belong to that resolved person?

Mature entity-resolution systems consistently use a pipeline rather than one
similarity score:

```text
normalize/parse
  -> retrieve a high-recall candidate set
  -> score candidates with multiple positive and negative features
  -> calibrate thresholds on representative labeled data
  -> resolved / review / unresolved
  -> optional person clustering only after pairwise validation
```

The most important policy is the third outcome: **insufficient evidence**.
Fellegi-Sunter record linkage has included match, possible match, and non-match
decisions since its original formulation. A ranked candidate is not necessarily
a resolved entity. [Fellegi and Sunter (1969)](https://www.tandfonline.com/doi/abs/10.1080/01621459.1969.10501049)

## Why the existing failures matter

The repository's documented failures cover several different error classes:

- **Same institution or lab, wrong person:** Li-Huei Tsai was associated with
  Masayuki Nakano's Scholar profile. Institution agreement did not distinguish
  a PI from another person in the same environment. See
  `.claude-memory/project-reviewer-identity-resolution-phase1.md`.
- **Wrong profile despite an academic-looking result:** Frank Noe was linked to
  Cecilia Clementi's Scholar profile. See the same memory.
- **Correct person, wrong contact-bearing namesake:** Olga Smirnova's identity
  was grounded, but a namesake supplied the contact evidence. Yanjun Chen was
  work-grounded while a pianist's web presence supplied contact and metrics.
  See `.claude-memory/project-reviewer-contact-enrichment-anchoring.md` and
  `docs/archive/REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md`.
- **Wrong forename laundering:** Alfred Laederach was presented where Alain
  Laederach was the verifiable person. A topic or institution match must not
  erase a full-forename contradiction.
- **Historical versus current institution:** documented cases include
  publication-era institutions that differ from current employment, and
  multiple or changing affiliations. A publication byline answers where an
  author claimed affiliation for that work, not necessarily where the person
  works now.
- **Institution-string false contradictions:** request 1002903 produced four
  false mismatch verdicts when decorated PubMed bylines were compared with
  clean listed institutions; a fifth Texas A&M/Northwestern case may be
  substantive. See `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` S399
  addendum and `outputs/s400-institution-checker-probe-findings.md`.
- **External model fabrication or false affiliation:** prior exploration
  documented fabricated people and plausible-looking but incorrect
  affiliations. A fluent explanation is not identity evidence.

These examples rule out a strategy based on name similarity, institution
similarity, topic similarity, web rank, or a provider's top candidate alone.

## Institution resolution research

### ROR: canonical registry, not decision authority

[RESEARCH] ROR provides typed official names, aliases, acronyms, domains,
locations, organization types, external identifiers, status/successor data,
and parent/child/related relationships. These are valuable resolver features.
[ROR data structure](https://ror.readme.io/docs/ror-data-structure)

[RESEARCH] ROR's own matching guidance distinguishes interactive search from
automatic affiliation matching and explicitly warns consumers not to choose a
result solely because it has the highest confidence score. It recommends the
local data dump when an application needs control over matching criteria.
[ROR matching guidance](https://ror.readme.io/docs/matching)

[LOCAL OBSERVATION, 2026-08-04] Live ROR probes exposed why this distinction
matters:

- Affiliation matching for `UCSD` returned no result even though the UC San
  Diego ROR record contains `UCSD` as an acronym.
- Ordinary name search for `UCSD` did return UC San Diego first.
- Affiliation matching for `University of California` ranked Touro University
  California first and the University of California system third. It did not
  mark Touro `chosen:true`, so a consumer following ROR's contract would
  abstain; a consumer taking rank 1 would make a severe error.
- Decorated or punctuated variants produced materially different rankings.

Conclusion: use ROR as the canonical entity catalogue and feature source. Do
not delegate the final institution decision to its search rank.

### S2AFF: strongest directly testable baseline

[RESEARCH] Semantic Scholar's open [S2AFF](https://github.com/allenai/S2AFF)
pipeline separates affiliation parsing, high-recall ROR candidate retrieval,
feature-based LightGBM reranking, and abstention. Its candidate stage uses
n-gram and token-Jaccard retrieval; the final decision uses both the leading
score and the margin over the second candidate.

On S2AFF's own manually labeled data, it reports candidate recall@100 of 0.984
and held-out precision@1 of 0.965. These figures make it a serious baseline,
not a production guarantee: its gold set is modest and does not establish
safety for UC sibling campuses or WMKF's input distribution.

### OpenAlex and AffilGood: evidence that input shape dominates

[RESEARCH] OpenAlex describes a layered institution parser: deep-learning
parsing, recurring corrective string rules, and ROR matching. It reports about
0.92 recall and 0.93 precision on its selected benchmark, while acknowledging
raw metadata errors, incomplete registry data, and matching failures.
[OpenAlex institution parsing](https://help.openalex.org/hc/en-us/articles/24831328396311-Institutions-and-Raw-Affiliation-String-Parsing)

[RESEARCH] The multi-dataset
[AffilGood evaluation](https://aclanthology.org/2024.sdp-1.13.pdf) separates
affiliation-span detection, organization/location extraction, and ROR entity
linking. Results vary sharply across multilingual strings, complex affiliations,
and strings containing several unrelated organizations. Its main lesson for
WMKF is that a headline score on one corpus cannot substitute for a benchmark
containing our actual hazards.

### Evaluated institution approach

The strongest candidate design is:

1. Parse organization spans, subunits, location, and domains.
2. Form a candidate **union** from exact normalized official names, aliases,
   acronyms, domains, character n-grams/BM25, and related ROR nodes.
3. Rerank using structured features rather than a single fuzzy score.
4. Apply hard contradictions and calibrated decision thresholds.
5. Return `resolved`, `ambiguous/review`, or `no match` with an evidence
   breakdown.

Useful positive features include:

- exact official-name, alias, acronym, or domain agreement;
- rarity of the matched alias or acronym;
- compatible city, region, country, and postcode;
- compatible organization type;
- compatible parent/child relationship; and
- supporting text that identifies the campus rather than only a department.

Required negative or exclusion features include:

- explicit sibling-campus disagreement;
- parent-system versus campus granularity conflict;
- incompatible city, domain, or institution type;
- multiple independent organizations in one string; and
- an acronym collision with no disambiguating evidence.

## Person identity research

### S2AND: best architectural reference

[RESEARCH] [S2AND](https://arxiv.org/abs/2103.07534) uses name-based blocking,
a gradient-boosted pairwise classifier, and clustering. Its evidence includes
name variants and name frequency, affiliations, coauthors, emails, author
position, year, venue, paper content, references, and publication embeddings.
It reported average B-cubed F1 of 0.90 versus 0.784 for the then-production
Semantic Scholar system, while also finding meaningful variation across
datasets and author cohorts.

The transferable lesson is not to copy the model blindly. It is to combine
independent signals, measure transfer to the local population, and treat same
institution/topic as supporting evidence only. A wrong full forename, stable-ID
conflict, or impossible timeline must be strong negative evidence.

### OpenAlex: useful candidate source, not a truth oracle

[RESEARCH] OpenAlex says its author disambiguation considers names, coauthors,
institutions, topics, citations/references, and ORCID. It also acknowledges
split and merge errors. All author-profile institutions and metrics are derived
from works assigned to the profile, so a wrong cluster contaminates everything
downstream. [OpenAlex author disambiguation](https://help.openalex.org/hc/en-us/articles/24347048891543-Author-disambiguation)

Therefore OpenAlex author IDs, `last_known_institutions`, and metrics are
evidence to evaluate, not standalone proof of identity or current employment.

### Evaluated person approach

Candidate generation should begin with compatible name blocks, stable IDs,
known works, and authorships. Pair scoring should consider:

- ORCID and other stable identifiers, with provenance;
- full-name compatibility and explicit forename contradictions;
- name rarity;
- authorship of the surfaced work;
- coauthor and publication history;
- normalized affiliation history with dates;
- email or official-domain evidence;
- research-topic compatibility; and
- impossible overlaps or timeline contradictions.

Publication and topic embeddings may rerank already plausible candidates. They
must not manufacture identity from a bare name or override a contradiction.
Person clustering should be deferred until pairwise behavior is measured,
because an erroneous merge propagates to publications, affiliations, metrics,
COI checks, and contact selection.

## Current affiliation and contact attribution

These are not fields to copy from the resolved author record.

[RESEARCH] ORCID represents affiliation as a separately sourced claim with an
organization identifier, role, department, start/end dates, and assertion
provenance. It permits multiple overlapping affiliations and distinguishes
employment from invited positions. [ORCID affiliation model](https://info.orcid.org/documentation/integration-guide/admin-guide-to-affiliations/)

[RESEARCH] ORCID also states that an ORCID iD is not an identity-verification
system. Organization-asserted data generally has stronger provenance than
self-asserted data, but consumers must assess fitness for purpose.
[ORCID identity assurance](https://support.orcid.org/hc/en-us/articles/360006972413-Does-an-ORCID-iD-assure-my-identity),
[ORCID trust markers](https://info.orcid.org/interpreting-the-trustworthiness-of-an-orcid-record/)

A future current-affiliation decision should use a dated evidence ledger rather
than one overwriteable string. Likely evidence priority:

1. current official institutional directory or faculty profile;
2. institution-asserted, open-ended ORCID employment;
3. current official lab or departmental page on a verified domain;
4. recent self-asserted ORCID employment;
5. recent publication affiliation, explicitly marked historical/work-level;
6. OpenAlex `last_known_institutions`, explicitly marked derived/last-observed.

Multiple current relationships must remain representable. Lack of an end date,
a sabbatical, a visiting role, or a joint appointment cannot safely be reduced
to one winner without product policy.

Contact attribution requires a separate verdict after identity resolution:

- An official current institutional profile naming the person and publishing
  the address is strong evidence.
- A current lab page on a verified institutional domain is supporting evidence.
- An email on an old paper is historical contact evidence.
- A plausible name plus email domain is candidate-generation evidence only.
- Corresponding authorship applies to a work and does not prove present contact
  ownership or reachability.

This preserves the existing repository principle: identity-confirmed does not
mean contact-validated.

## Scoring algorithms worth evaluating

### 1. Fellegi-Sunter / Splink — recommended interpretable baseline

[RESEARCH] Fellegi-Sunter scores the evidence for a candidate pair using the
likelihood of each field agreement under match versus non-match. Splink exposes
this as additive, field-level match weights and supports term-frequency
adjustments, so a rare acronym or domain contributes more than common words or
names. [Splink model guide](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html),
[term-frequency guide](https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html)

This is a strong first model for institution and person pair scoring because it
is inspectable and naturally supports separate automatic-match, review, and
non-match thresholds. Risks include correlated evidence overstating confidence
and poor calibration if the local labels are unrepresentative.

### 2. Supervised logistic regression or gradient-boosted trees

[RESEARCH] Dedupe learns regularized logistic-regression weights and blocking
rules through active learning, prioritizing informative uncertain pairs for
human labeling. [Dedupe matching](https://docs.dedupe.io/en/latest/how-it-works/Matching-records.html)

S2AFF and S2AND demonstrate the usefulness of feature-based gradient-boosted
models for institution and author matching. These become attractive after a
representative benchmark exists. They should be trained with deliberately hard
negatives, not random easy pairs.

### 3. Neural or LLM rerankers — challenger only

Transformer and LLM matchers may help parse complex affiliation text or rerank
a bounded candidate set. They are not recommended as the initial decision
authority because reproducibility, calibration, explanation, and contradiction
handling matter more than fluency here. Any such model should compete against
the interpretable baselines on the same frozen test set and must be allowed to
abstain.

### Options not recommended as the primary answer

- ROR or OpenAlex rank 1 without a local decision layer;
- token-set similarity, which rewards containment and generic shared tokens;
- topic or embedding similarity as identity proof;
- broad web search rank;
- graph propagation before pairwise contradictions are reliable; or
- clustering that assumes transitivity without false-merge evaluation.

## UC system falsification test bed

The UC family is a useful institution-resolution test because it combines a
parent system, sibling campuses, acronyms, punctuation variants, locations,
domains, medical centers, laboratories, and related foundations.

### Required entity policy

- The University of California system is distinct from each campus.
- Each campus is distinct from every sibling campus.
- Hospitals, laboratories, foundations, and institutes are separate where ROR
  and WMKF product policy require separate identity.
- A bare `University of California` resolves to the system if system-level
  output is allowed; if a campus is required, the result is `ambiguous`.
- Parent-only evidence must never silently become a campus.
- Multi-organization strings must allow multiple outputs or abstention.

### Minimum falsification cases

| Input class | Expected behavior |
|---|---|
| `UCSD`, case/punctuation variants | Retrieve UC San Diego through exact acronym evidence |
| `University of California, San Diego` | Resolve UC San Diego |
| Decorated UCSD department/byline/address | Resolve UC San Diego if the campus survives parsing |
| `U.C. San Diego` | Resolve UC San Diego after punctuation normalization |
| `University of California` | UC system or ambiguous-by-policy; never a campus guess |
| `UCLA` with Los Angeles/domain evidence | Resolve UCLA |
| UCSD string with UCLA city/domain substituted | Reject or review; never auto-resolve either campus |
| Parent name plus one sibling's city and another's acronym | Ambiguous/contradictory |
| UC hospital/lab/foundation | Preserve the chosen product granularity and hierarchy |
| Unrelated California institution, including Touro | Never auto-resolve as UC or outrank an exact UC-system entity |

For every target campus, substitute every sibling's acronym, city, domain, and
campus word one at a time. This adversarial matrix tests whether negative
evidence actually matters instead of merely lowering a positive similarity
score.

## Proposed benchmark and experiment sequence

No benchmark is authorized by this document; this section records the proposed
shape for a later owner decision.

### Phase 0: labeled case inventory

Consolidate the repository's known failure examples into distinct labels for:

- institution entity;
- person identity;
- work authorship;
- current affiliation(s);
- contact ownership; and
- expected `resolved`, `review`, or `unresolved` outcome.

Do not collapse these into one “correct candidate” label.

### Phase 1: compact falsification suite

Use approximately 150-300 carefully labeled cases to reject unsafe approaches
quickly. Emphasize UC siblings, parent/child conflicts, wrong forenames,
same-institution namesakes, historical affiliations, and wrong contacts.
This suite is for falsification, not model training or production calibration.

### Phase 2: representative benchmark

Before selecting thresholds or training a learned model, expand toward roughly
1,000-2,000 examples across natural and explicitly marked synthetic cases.
Stratify by institution/campus, input type, difficulty, name frequency, source,
and temporal scenario. Keep source-specific strings together to prevent
train/test leakage; include leave-one-campus-out and leave-one-variant-family-out
tests.

Freeze and record the ROR release, upstream provider versions, inputs, labels,
and threshold-tuning split.

### Comparators

Evaluate on the same frozen cases:

1. current ROR affiliation API using `chosen:true` only;
2. ROR ordinary search ranking, measured but never treated as authoritative;
3. S2AFF;
4. OpenAlex institution parsing;
5. a local exact-alias/domain/hierarchy plus n-gram baseline;
6. a Fellegi-Sunter/Splink scorer; and
7. only later, a supervised boosted-tree or neural/LLM challenger.

### Metrics

Measure candidate retrieval separately from final decisions:

- candidate recall@1, @5, and @100;
- resolved-only precision, recall, F0.5, and coverage;
- review-band recall;
- correct abstention rate;
- top-1 wrong-answer rate;
- calibration using reliability curves, Brier score, and/or expected
  calibration error;
- institution error severity: sibling campus, wrong parent/child, unrelated
  organization;
- person clustering B-cubed precision/recall/F1 if clustering is evaluated;
- current-versus-historical affiliation accuracy;
- contact-attribution precision; and
- results by campus, input type, name frequency, source, and time condition.

For any automatic action that can clear an identity-review gate or enable a
write, optimize for precision rather than coverage. ROR likewise recommends
precision/recall rather than generic accuracy and suggests F0.5 when false
positives are more costly. [ROR evaluation guidance](https://ror.org/blog/2024-11-06-how-good-is-your-matching/)

A proposed hard safety gate is zero wrong automatic sibling-campus decisions in
the held-out UC suite, plus an owner-selected resolved-only precision floor.
Abstention is preferable to a confident wrong association.

## Relationship to CRM Account cleanup

This research does not supersede
`.claude-memory/project-reviewer-affiliation-institution-linking.md`.
Research-affiliation entities and WMKF legal/payee Accounts are different
namespaces. Even a correct ROR resolution does not by itself identify the legal
Account to use for contracting or honoraria.

The previously parked sequence remains intact: canonicalize/deduplicate CRM
Accounts and define the ROR/EIN crosswalk before reviewer-to-Account automation.
No typeahead, cache, or automatic Account linking is proposed here.

## Decision record

As of 2026-08-04:

- **Accepted as research direction:** decompose the four decisions; use
  multi-stage candidate generation and structured scoring; preserve negative
  evidence, provenance, time, and abstention; benchmark before selecting a
  library or model.
- **Recommended baseline candidates:** S2AFF for institution linking,
  Fellegi-Sunter/Splink for interpretable record linkage, and S2AND as the
  person-disambiguation architectural reference.
- **Rejected as sufficient:** provider rank 1, one fuzzy score, topic similarity,
  or a single current-looking publication/profile.
- **Not authorized:** implementation, dependency adoption, schema work,
  production experimentation, or changes to live identity/write gates.

## Primary sources

- [Fellegi and Sunter, A Theory for Record Linkage](https://www.tandfonline.com/doi/abs/10.1080/01621459.1969.10501049)
- [Splink model and scoring theory](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html)
- [Dedupe matching and active learning](https://docs.dedupe.io/en/latest/how-it-works/Matching-records.html)
- [S2AFF repository and evaluation](https://github.com/allenai/S2AFF)
- [S2AND paper](https://arxiv.org/abs/2103.07534)
- [ROR matching guidance](https://ror.readme.io/docs/matching)
- [ROR data structure](https://ror.readme.io/docs/ror-data-structure)
- [OpenAlex institution parsing](https://help.openalex.org/hc/en-us/articles/24831328396311-Institutions-and-Raw-Affiliation-String-Parsing)
- [OpenAlex author disambiguation](https://help.openalex.org/hc/en-us/articles/24347048891543-Author-disambiguation)
- [AffilGood multi-dataset evaluation](https://aclanthology.org/2024.sdp-1.13.pdf)
- [ORCID affiliation model](https://info.orcid.org/documentation/integration-guide/admin-guide-to-affiliations/)
- [ORCID trust markers](https://info.orcid.org/interpreting-the-trustworthiness-of-an-orcid-record/)
