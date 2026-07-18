# Reviewer Disambiguation & Email Discovery — Critical Evaluation with External Alternatives (Fable)

- **Date:** 2026-07-18
- **Repo state reviewed:** `claude/review-reviewer-email-evidence` at `a234ce0c`
- **Requested by:** owner ("look at this codebase as if you have not seen it before …
  the strategy for identifying reviewers and specifically how to disambiguate them
  and discover their emails … be extremely critical … investigate whether other
  alternatives might be better").
- **Method:** read-only architecture audit. Read the disambiguation and
  email-discovery paths end-to-end (`reviewer-identity-resolver.js`,
  `reviewer-identity-evidence.js`, `discovery/verification.js`,
  `discovery/name-matching.js`, `openalex-service.js`, `orcid-service.js`,
  the `contact-enrichment/` tier cluster incl. the new `scholarly-email.js`,
  `serp-contact-service.js`, `reviewer-invite.js`), the enforcement contracts,
  the holistic plan, and the local `outputs/reviewer-holistic-m1/` eval
  artifacts. Two external research passes (author disambiguation; email
  discovery) were run against the 2025–2026 vendor/API landscape; every external
  claim carries a source URL in the appendix. **No product code or durable
  documentation outside this file was changed.**
- **State labels:** `[VERIFIED]` = read from the current tree or a named
  artifact. `[EXTERNAL]` = from the 2026-07-18 research pass (source in
  appendix). `[ASSUMED]` = inference not directly probed.

> **Post-audit outcome (2026-07-18).** The live NCBI + Europe PMC core-record
> tier was measured at 27/40 structured addresses (20 ready, 7 quick-check). A
> bounded OA `fullTextXML`/JATS `<corresp>` fallback subsequently added 0/40 and
> increased median latency for the comparable missing subset from 375 ms to
> 1,052 ms. It was removed and not promoted. Recommendations below to implement
> `<corresp>` parsing are preserved as the historical audit position; the
> authoritative decision is `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md` W3.1.

---

## 0. One-paragraph verdict

The system is high-quality engineering aimed at a target that is smaller, and
better-served by free canonical recipes, than the machinery implies. Two
load-bearing criticisms. **(1) Disambiguation reimplements by hand the exact
author-resolution primitives OpenAlex now publishes a recommended recipe for —
and it queries the one OpenAlex endpoint (`authors?search=`) whose ranking is
citation-biased and therefore *manufactures* the famous-namesake failure mode
the code then spends a work-grounding rescue and an eight-branch promotion
grammar undoing.** **(2) Email discovery has a structural ceiling that the
project's own eval has already hit, and the paid search tiers spend money and
latency producing addresses the send-gate then refuses; the single cheapest
recall+precision win — structured corresponding-author email from Europe PMC
full-text — is on an API the system already calls but does not parse for that
field.** Neither finding is "it is broken." The safety posture
(abstain-is-safe, fail-closed at persistence, forename-contradiction gates, the
`research_only`-never-sends rule) is correct and should not be weakened. The
criticism is about effort allocation and free upgrades left on the table.

## 1. Scale frame (governs the rest)

- ~200 Phase-I proposals winnow to ~28 that go to review per cycle; 3 confirmed
  reviewers per proposal with a 5-slot decline buffer; ≈ 85–150 reviewer
  engagements per year `[VERIFIED via prior audit + count-invariant memory]`.
- Judged by one PD who the origination experiment showed is a reliable oracle
  (≈80% blind agreement with applicant recommendations)
  `[VERIFIED via REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md]`.
- Against this: ~2,200 LOC across the `contact-enrichment/` submodule cluster
  `[VERIFIED via wc: Σ 2,241 across 12 files]` behind a 541-line facade, plus the
  ~6,500 LOC finding/disambiguation figure
  from the prior holistic audit `[per docs/audits/reviewer-holistic-review-fable-2026-07-08.md]`,
  8 fail-closed enforcement contracts `[VERIFIED via REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md]`,
  a versioned identity-binding schema wave, and an evaluation-manifest subsystem.

At this scale the human is the best component and is already in the loop. Every
invited reviewer authenticates a magic link at their own address and self-reports
ORCID within days (`capture-self-reported-orcid.js`) — free ground truth for
exactly the population that matters. Automated disambiguation's real job is
therefore **bounded**: be right enough, before the human answers, that the
invite reaches the right person and COI is computed against the right person. It
does not need to *certify* identity — the lifecycle certifies it for free a few
days later.

## 2. Disambiguation — querying the wrong endpoint, hand-rolling the rest

### 2.1 What it does today `[VERIFIED]`

Claude (Opus 4.8) proposes *name + institution + expertise + seniority +
reasoning* (`shared/config/prompts/reviewer-finder.js`; no DOIs/paper anchors
required per candidate). Verification splits by field
(`discovery/verification.js` `suggestionVerifierRouting`):

- **Biomedical → PubMed.** Name-variant search + author-byline filter + a
  ≥3-publication bar (`MIN_PUBLICATIONS`) + forename-evidence gate + expertise
  and institution-mismatch checks.
- **Non-biomedical → the OpenAlex/ORCID "spine"**
  (`reviewer-identity-evidence.js` `evaluateSuggestion`):
  `OpenAlexService.searchAuthors(name, {limit:10})` → each record scored by
  `hasTokenOverlap` on affiliation (weight 2) and topic (weight 1) →
  best-scoring record picked, ties broken by a direct ORCID search → on abstain,
  `rescueByWorkGrounding` fetches the winner's recent work titles and requires
  ≥2 distinct shared topic tokens, forename-gated, with the ORCID works list as
  a merge-immune veto → ORCID profile fetched for employment corroboration.
- Classification (`reviewer-identity-resolver.js` `resolveIdentity`) →
  `confirmed | probable | ambiguous | unresolved | rejected`;
  `mayPersistIdentity` = confirmed||probable.

The safety intent is sound and documented: the S231 Laederach reproduction (a
fabricated "Alfred" verifying as the real "Alain" at 100% confidence) is why the
forename gates exist, and abstain is treated as the safe branch.

### 2.2 Where it is weak, and the better alternative

- **You query `authors?search=`, whose relevance ranking is citation-biased —
  which *is* the namesake hazard.** `[EXTERNAL]` OpenAlex documents that
  `relevance_score` mixes text similarity with citation count ("more cited =
  higher score"). That is the mechanism behind the Landsman worked example (a
  real ~24-work researcher losing the `search` ranking to a ~101-work
  namesake). `scoreRecord`/`selectRecord`/`rescueByWorkGrounding` then exist to
  *undo* that ranking. `[EXTERNAL]` OpenAlex's own published recipe ("Audit an
  Author Profile's Works") says the correct tool is the opposite: query
  **works** — `works?filter=raw_author_name.search:"<variant>",institutions.id:<I-id>,type:!paratext`
  — and collect the author IDs behind matching bylines. `raw_author_name.search`
  is described as "the one filter without a `search`-param equivalent — the
  right tool for matching a person to their works." `[VERIFIED via grep]` The
  system has `getWorksByAuthor` (works *by* an already-resolved author id) but no
  raw-byline works query in the identity path: the only `raw_author_name.search`
  usage in the tree is the standalone origination *probe*
  `scripts/origination-sniff-sources.mjs` (not imported by `lib/`/`pages/`) — the
  right primitive was touched in an experiment and never wired into resolution.

- **Institution matching is string token-overlap; it should be ID-space.**
  `[VERIFIED]` `scoreRecord` uses
  `hasTokenOverlap(suggestedInstitution, record.lastKnownInstitution)`. The
  service already resolves institutions to ROR/OpenAlex ids
  (`getInstitution`, `searchInstitutions`) for the email-domain guard — but not
  before scoring candidate authors. Resolving the claimed institution to an
  `I-id` first and matching in id space removes a class of string-mismatch
  misses and inverse over-matches.

- **No name-rarity prior.** `[VERIFIED absent]` `[EXTERNAL]` OpenAlex's recipe:
  "name rarity dominates everything else." The scorer treats a common name and a
  rare name identically. One cheap count call yields the prior; a common name
  with only institution+topic agreement should route to the human, a rare name
  with an institution match can auto-accept.

- **Hand-rolled PubMed disambiguation instead of the free measured one.**
  `[VERIFIED]` the biomedical path is name-variant + ≥3-pub — the exact "N papers
  by LastName+initial = identity" pattern that produced the Laederach
  false-verify. `[EXTERNAL]` NCBI publishes **PubMed Computed Authors** (21.3M
  disambiguated authors, >91% error-free profiles, weekly refresh, free API by
  PMID+name or ORCID) as an independent, published-accuracy clustering usable as
  the biomedical resolver or a second opinion.

- **A cached OpenAlex author id is persisted into an unstable namespace.**
  `[EXTERNAL]` OpenAlex split ~3.2M over-merged profiles in 2026 and an
  ORCID-driven merge wave is next; any cached `A-id` can dangle or change
  meaning. The durable fix is to store the **evidence bundle** (ORCID + 3–5
  anchor DOIs + ROR) and re-resolve from anchors on reuse — anchor DOIs survive
  reclustering, author ids do not. (This aligns with, but is distinct from, the
  Wave 13 binding-anchor work.)

- **Unused free ground-truth signals.** `[EXTERNAL]` OpenAlex 2026
  `parsed_longest_name.{first,middle,last,suffix}` would give the
  forename-contradiction gate a canonical parse instead of three hand-rolled
  comparators; Crossref `has-authenticated-orcid` (publisher-witnessed ORCID↔work
  link) is not used in the identity path.

### 2.3 Consequence

The disambiguation is not wrong, but it is a hand-rolled reimplementation of
primitives that now have a free, canonical, better-documented recipe — and it
queries the citation-biased endpoint that generates its own worst failure mode.
The eight-branch promotion grammar and the work-grounding rescue are largely
compensating machinery for that choice.

## 3. Email discovery — a structural ceiling, and paid tiers that don't clear the gate

### 3.1 What it does today `[VERIFIED]`

Tiered chain in `contact-enrichment/tiers.js`: Tier 0 affiliation-embedded email
→ Tier 1 single-PubMed extraction → Tier 2 ORCID public email → a structured
NCBI + Europe-PMC tier (`scholarly-email.js`) requiring the **same address on
two distinct recent works** (≤3 yr) for invite-ready (`scholarly_multi`), one
work = `scholarly_single`/quick-check → Tier 3 Claude web search (Haiku, 1
search, 256 tokens, name-consistency + anchor guards) → Tier 4 SerpAPI Google
scrape → an opt-in SSRF-bound faculty-page fetch (`REVIEWER_PAGE_EMAIL_TIER_ENABLED`,
**default OFF**). The send-gate (`reviewer-invite.js` `emailConfidence`) is
honest: `ready` sends, `quick_check` needs a per-recipient checkbox,
`research_only` (serp/claude/contested) is **never** sendable.

### 3.2 Where it is weak, and the better alternative

- **The ceiling is external and structural, not tunable.** `[EXTERNAL]` NLM
  stopped adding emails to affiliation strings in 2013; presence is
  journal-dependent (a virology parse recovered 0 emails from
  *J. Medical Virology*, which strips them); Crossref and OpenAlex expose no
  email field; ORCID public email is **<5%** of records. The "<3 years old"
  freshness rule is correctly justified by ~2%/yr address decay.

- **"Same address on two recent works" structurally excludes the target
  population.** `[VERIFIED]` `extractPublicationEvidence` requires the email in
  the **candidate's own** author-affiliation on two recent papers — in practice,
  the reviewer must be a recent *corresponding* author twice. That silently
  excludes senior last-authors (the "established professors/PIs" the analyze
  prompt requests) and early-career researchers with one lead paper.

- **Affiliation *strings* are parsed where Europe PMC offers structured
  corresponding-author email.** `[VERIFIED]` the scholarly tier queries Europe
  PMC with `resultType=core` and regex-extracts from affiliation text.
  `[EXTERNAL]` Europe PMC OA full-text is JATS XML with `<corresp>` /
  `corresp="yes"` markup carrying the corresponding-author email in a parseable,
  *disambiguated* field. This is the single cheapest recall+precision win and it
  is on an API already wired.

- **The paid tiers are close to theater.** `[VERIFIED via local eval]` the
  SerpAPI-first run over the 40-person new-to-WMKF cohort
  (`reviewer-email-serp-first-40-v1.json`) reached 87.5% raw email coverage but
  only **6/40** high-confidence — ~21 landed `search_contested` and ~8
  `serp_search`, i.e. `research_only`, i.e. the send-gate refuses them. The
  evidence-backed sendable coverage
  (`…-summary-email-evidence-v1.json`) is ~15%. Tier 3/4 spend Haiku calls,
  SerpAPI credits, and 7+ s latency per candidate to produce addresses policy
  will not send.

- **The honest tension, already named in memory
  (`feedback-prioritize-contact-recall-over-identity-precision`):** the
  identity-precision gates that prevent wrong-person sends are the same mechanism
  that withholds the contact. `[EXTERNAL]` confirms the human-findable email
  genuinely is not in structured metadata — it is on a faculty page. So the
  deliberate options are narrow: (a) parse `<corresp>` for the OA subset;
  (b) turn on and lean into the opt-in page-fetch tier — a page-grounded
  `institution_page` email is the only "ready"-grade web source; or (c) accept
  "no sendable email → hand to staff with a pre-built faculty-page link and stop
  paying for search tiers that can't clear the gate." What should not continue is
  the middle state: guarded paid web search that mostly yields unsendable leads.

## 4. Buy-vs-build (the alternatives the owner asked about)

| Option | What it gives | Honest fit |
|---|---|---|
| **OpenAlex works-recipe** (free) | The §2.2 disambiguation upgrade; ~$0.005/candidate under 2026 key pricing; ~200–400 candidates/day on the free $1/day key | **Best near-term move.** Replaces hand-tuned author-search with OpenAlex's canonical recipe; no vendor. |
| **PubMed Computed Authors** (free) | Measured biomedical disambiguation (>91% error-free), weekly refresh | Strong independent check for the biomedical portfolio. |
| **Prophy Referee Finder** (commercial) | Reviewer identification + disambiguation + **contact info**; 60M profiles; ~99.9% match w/ structured metadata; **the ERC's production reviewer tool** | Closest commercial match to the exact problem; returns the email the pipeline struggles to find. Deserves a real evaluation, not reflexive dismissal. |
| **WoS Reviewer Locator / Elsevier Find Reviewers** | Emails from a proprietary reviewer/author profile DB (Publons/Scopus) | Journal-scale throughput, subscription-gated; weaker fit for conflict-aware small-batch curation against a private CRM. |
| **Hunter / Apollo / RocketReach** | B2B email inference | **Poor for `.edu`** — catch-all academic domains defeat SMTP verification; academic coverage incidental; GDPR legitimate-interest burden for EU academics. Last-resort inference tier at best. |

The commercial reviewer tools that "just have the email" fuse a proprietary
reviewer/author profile database onto the same public metadata the system
already parses; the system replicates the metadata half and lacks the profile-DB
half, and that gap is structural. The genuine reason to keep building is
specific: **no vendor solves binding a resolved identity to your private
Dataverse CRM and computing COI against *this* proposal's PI.** That is yours
regardless. But the discovery-and-disambiguation front half — where the most code
and churn live — is exactly what OpenAlex's recipe (free) and Prophy (paid) do
better than a hand-tuned spine.

## 5. Recommended pipeline (the OpenAlex works-recipe, for the §6 prototype)

`[EXTERNAL — OpenAlex "Audit an Author Profile's Works" recipe, adapted]`

1. **Resolve institution first** → ROR + OpenAlex `I-id` (`institutions?search=`
   or ROR API); prefer exact ROR, confirm country. Converts token-overlap into
   id-space matching.
2. **Compute a name-rarity prior** (one `authors?filter=display_name.search:`
   count).
3. **Candidate generation from three independent sources** (widen from
   authors-only): (a) `authors?search=` top-10 *and* institution-scoped
   `authors?filter=display_name.search:…,affiliations.institution.id:<I-id>`;
   (b) the works-first probe
   `works?filter=raw_author_name.search:"<variant>",institutions.id:<I-id>,type:!paratext`
   with `~1`/`~2` slop and reversed-order variants for CJK names, collecting the
   author ids behind matching bylines; (c) ORCID expanded-search by
   family+given+affiliation/ROR.
4. **Evidence assembly:** authorship-level ORCID match ("essentially ground
   truth", ~30% recent-work coverage) via ORCID employments (dated) + works DOI
   overlap; Crossref `has-authenticated-orcid` cross-check on 2–3 anchor DOIs;
   topic fit vs claimed expertise; shared-coauthor block (3+ = high confidence);
   forename gate via `parsed_longest_name`; PubMed Computed Authors for
   biomedical, dblp for CS.
5. **Decision policy (hierarchy, not flat token overlap):** auto-accept
   ORCID+institution+works overlap; accept rare-name + institution-id + topic;
   human-review common-name/institution+topic-only, forename contradiction, or
   famous-namesake pattern; sample 3–5 works before final accept.
6. **Persist the evidence bundle (ORCID + anchor DOIs + ROR), not the bare
   `A-id`** (2026 split/merge churn).

Encoded failure modes: duplicate works inflating title overlap (dedupe by DOI
first); stale `last_known_institutions` (use dated `affiliations[].years` +
ORCID employments); `display_name_alternatives` cross-contamination (never match
on alternatives without a byline check); recent hires with no works at the new
institution (ORCID employments is the only signal); East-Asian names (require
ORCID/coauthor/institution corroboration, never name+topic alone).

## 5a. Prototype result — works-recipe vs current spine on the 40-case benchmark `[VERIFIED via run, 2026-07-18]`

A v1 of the §5 works-recipe (institution-anchored byline resolution) was run
head-to-head against the current spine (`ReviewerIdentityEvidence.evaluateSuggestion`)
over the frozen 40-case identity benchmark v2 (25 expected-Bind / 15
expected-Abstain), scored by anchor equivalence (ORCID- and OpenAlex-id-canonicalized).
Read-only, live OpenAlex/ORCID, ~$0.08 OpenAlex spend, no product code changed.
Harness + artifact are scratch prototypes (not committed).

**Raw scorecard (40 cases):**

| Arm | correct-bind | false-bind | miss | correct-abstain |
|---|---|---|---|---|
| Current spine | 14 | 3 | 11 | 12 |
| Works-recipe v1 | 21 | 7 | 1 | 11 |

**By expected class:**

| | Spine (expect-bind, n=25) | Works (expect-bind, n=25) | Spine (expect-abstain, n=15) | Works (expect-abstain, n=15) |
|---|---|---|---|---|
| correct | 14 bind | 21 bind | 12 abstain | 11 abstain |
| wrong | 0 false-bind, 11 miss | 3 false-bind, 1 miss | 3 false-bind | 4 false-bind |

**The result reframes on identity verification (each false-bind's true identity
was looked up live):**

- **Recall is materially better.** Works recovers 7 more correct binds (14→21)
  and nearly eliminates misses (11→1). The recovered people are exactly the
  fragmented/low-footprint real researchers the spine misses — Will Harcombe,
  John Travers, Curtis Suttle, Sara Seager, Jennifer Doudna, Pardis Sabeti,
  Carrie Partch, Prineha Narang. This validates §2: works-by-byline +
  institution beats author-search + token-overlap for recall.
- **Works also fixes 2 of the spine's 3 genuine wrong-binds** (initials-only
  `a-patel`, `j-kim` → correct abstain).
- **The 7 works "false-binds" are three different things, only 2 genuinely
  unsafe:**
  - **2 genuine wrong-cluster binds — the real safety gap:** `li-huei-tsai`
    (×2 cases, one underlying person, `merged_cluster` hazard) bound a 62-work
    **no-ORCID** Broad-Institute cluster instead of her canonical ORCID record.
    Right name + institution, contaminated/merged cluster — unsafe for
    COI/email.
  - **1 right-person / poor-fragment:** `ursula-keller` bound a 3-work no-ORCID
    **splinter** of the real Keller (OpenAlex split her); correct human, but an
    impoverished anchor the spine picked better via ORCID employment.
  - **4 correct-person binds the benchmark policy prefers to abstain on:**
    `fei-fei-li`, `emmanuelle-charpentier`, `nergis-mavalvala`, `joshua-weitz`
    — each verified to be the **real, correct person** (three via their actual
    ORCID). The benchmark labels these expected-abstain because the input is a
    mega-common/fragmented name where confident binding is the same mechanism
    that would bind a namesake wrong. The spine correctly abstained on 3 of
    these (it also bound Weitz).

**Conclusion.** The works-first recipe is the stronger *recall* engine and is
the right candidate-generation direction — it recovers ~half the spine's misses
with real people. The naive v1 is **not** promotion-safe: it has 2 genuine
merged-cluster wrong-binds and over-binds ambiguous famous names. Both are
directly addressed by the two §5 evidence-hierarchy steps this v1 omitted:

1. **ORCID-richest-cluster preference** — bind the ORCID-anchored / richest
   cluster, never a sparse no-ORCID fragment or a no-ORCID merged cluster.
   Indicated to fix Keller (bind her ORCID record) and Tsai (bind her
   ORCID-anchored cluster). `[HYPOTHESIS — identity-verified but not re-run]`
2. **Name-rarity / unique-anchor gate** — high candidate-count + no unique ORCID
   anchor → abstain, honoring the benchmark's abstain policy on
   fei-fei-li/charpentier/mavalvala (candidate counts 3–14, bound on
   institution-dominance alone). `[HYPOTHESIS — not re-run]`

Both arms currently fail the benchmark's "zero false-bind in hazard fixtures"
gate (3 each), so neither is promotion-ready as-is; the hardened works-recipe is
the more promising path because its recall is far higher and its 2 genuine
failures have a specific known fix. The 4 "correct-person-but-abstain-expected"
binds also surface a real **policy question for the owner** (§7): for a tool
whose human closes the loop via magic-link self-report, is binding the *right*
famous person with a verify flag better than abstaining? The benchmark currently
says abstain; the recall-vs-precision memory says maybe not.

Numbers are exact over n=40; do not generalize to a population claim from a
40-case fixture.

## 5b. Two owner-raised refinements (2026-07-18)

The owner surfaced two field observations that materially sharpen the v2 design.

### 5b.1 ORCID is not a unique key in practice — duplicate iDs exist

The owner has observed real researchers with **multiple ORCID iDs** (commonly a
co-author registered one without finding the person's existing iD). This breaks
the "ORCID = ground-truth unique key" assumption that both the current system and
the §5a v2 lean on. Consistent with ORCID's own duplicate-record merge process
and with OpenAlex's 2026 use of raw-ORCID conflicts to split over-merged
profiles `[EXTERNAL]`.

Where it bites:

- **Current ORCID path treats a person's own duplicate iD as a namesake.**
  `ORCIDService.findContact` returns `{status:'ambiguous'}` when the name search
  yields `distinctIds.size > 1` with no single-email tiebreak `[VERIFIED via
  lib/services/orcid-service.js findContact]` — so two iDs for one person →
  abstain (a recall loss caused by a duplicate, mislabeled as ambiguity).
- **The §5a v2 lean is defeated.** "Prefer the ORCID-richest cluster" can land
  the sparse *duplicate*; "unique ORCID = bind" is not a valid gate. Note
  `getRichestAuthorByOrcid` handles same-iD *splits*, not two-different-iD
  duplicates `[VERIFIED via lib/services/openalex-service.js]`.
- **Dedup/CRM:** ORCID-keyed joins (`mergeTrackBWithNeedsReviewBySharedOrcid`,
  honorarium `findByOrcidCandidates`) will not dedup a person who appears under
  two iDs → duplicate reviewer records.

Design correction for v2:

- Treat ORCID as **one corroborating signal inside an evidence bundle, not the
  key.** Anchor on the person (name + institution + works corpus); carry a **set**
  of observed ORCIDs, not one.
- **Duplicate-vs-namesake disambiguation:** when byline resolution surfaces two
  distinct ORCIDs both passing the name gate, decide by *corroboration
  agreement* — shared institution / co-authors / topic → same person, duplicate
  iD (bind the person, keep both iDs, prefer the richer for metrics);
  contradicting institution+field → namesake (abstain). The works-first
  byline-set is a **better substrate** for this than the ORCID-name-search path,
  which only sees "2 iDs = ambiguous."
- **Dedup on the union** of {any shared ORCID, shared OpenAlex author-id, strong
  name+institution+works overlap}, and store every observed iD.

### 5b.2 HHMI investigators are genuinely dual-affiliated — exempt the umbrella from COI

HHMI Investigators are employed by HHMI **and** based at a host university, so
their records legitimately carry both. A shared "HHMI" between a reviewer and a
PI is therefore **not** a same-campus conflict.

Current state (worse than unhandled): `DeduplicationService.institutionsMatchForCOI`
matches on shared OpenAlex/ROR id or normalized name `[VERIFIED via
lib/services/deduplication-service.js:816-853]`, and the alias table maps
`'hhmi': ['howard hughes medical institute', 'hhmi', 'janelia']` `[VERIFIED via
lib/services/discovery/match-signals.js:158]`. So:

- two co-HHMI investigators at different universities match (shared HHMI id
  `I1344073410` / name) → **false COI hard-drop**; and
- the alias **folds the Janelia campus into HHMI**, so an HHMI investigator at
  (say) Stanford and a Janelia group leader also false-match — even though
  OpenAlex holds them as distinct facilities (HHMI employer `I1344073410` / ror
  `006w34k90` vs Janelia Research Campus `I195573530` / ror `013sk6x84`)
  `[VERIFIED via live OpenAlex probe]`.

Fix (small, surgical):

- Add HHMI-employer (id `I1344073410` / normalized name) to a **COI-exempt
  umbrella-employer set**: a shared umbrella employer alone does not constitute
  institutional COI. Keep **Janelia Research Campus** as a real campus that can
  match Janelia-vs-Janelia — i.e. **remove `'janelia'` from the `'hhmi'` alias**
  so the employer and the physical campus stop being conflated.
- Same umbrella-employer set should be treated as a **weak/non-disambiguating
  affiliation** in the resolver (an HHMI `last_known_institution` must not fail
  institution-corroboration against a claimed host university) and should not
  fire the `reviewer_contact_affiliation_mismatch` alert.
- This is a policy call (co-HHMI is a funder-cohort relationship, not a campus
  conflict); it is consistent with the existing posture — hard-gate only current
  same-campus, rely on self-disclosure for relationships, no new soft COI flags.
- HHMI is the canonical case; a short curated umbrella list (candidates: CZ
  Biohub, Simons/HFSP investigator networks) can grow behind it, but start with
  HHMI. `[curated-list scope = ASSUMED; HHMI VERIFIED]`

### 5b.3 Generalize (Broad + adjacent institutes): one root cause, two distinct mechanisms

The owner asked to add the **Broad Institute** and a general "institute
affiliation" concept for institutes affiliated-with-but-adjacent-to a university
(e.g. the Institute for Advanced Study at Princeton). Untangling this surfaces
that HHMI/Janelia, Broad/MIT, and IAS/Princeton are the **same root cause** —
string/alias/geography matching instead of OpenAlex/ROR **ID-space** matching —
and that the "institute tag" is really **two different mechanisms** that must not
be flattened into one, or the fix reintroduces a false match in the other
direction.

**The data does most of the work.** OpenAlex exposes `associated_institutions`
with a `relationship` (`parent`/`child`/`related`) `[VERIFIED via live probe]`:
Broad `I107606265` → related MIT `I63966007` + Harvard `I136199984` (+ Boston
hospitals); Whitehead `I4210157710` → MIT; IAS `I40036882` → **empty**
(genuinely independent of Princeton), and there are **two** IAS records (US
`I40036882`, DE `I4210137766` — another namesake trap). So institute↔parent
links are largely derivable, not hand-maintained.

**Mechanism 1 — affiliation *consistency* (disambiguation + mismatch alert;
data-driven, keep-biased).** Treat two institutions as consistent when they
share an id OR one is in the other's `associated_institutions`. This makes
Broad⇔MIT, Broad⇔Harvard, Whitehead⇔MIT consistent automatically — so an HHMI/Broad/Whitehead
`last_known_institution` no longer fails institution-corroboration in the
resolver and no longer fires `reviewer_contact_affiliation_mismatch`
(`lib/services/alert-reviewer-affiliation-mismatch.js` compares normalized
name-strings today `[VERIFIED via file]`). It correctly does **not** make
IAS⇔Princeton consistent (empty associated), and ID-keying keeps IAS-US ≠ IAS-DE.
No curated list required.

**Mechanism 2 — COI *exemption* (owner policy; tiny curated id overlay).** A
shared institution that is an umbrella/affiliated institute does not, alone,
constitute institutional COI. This is a policy set of OpenAlex/ROR **ids** —
HHMI `I1344073410` (VERIFIED), Broad `I107606265` (owner-requested) — separate
from mechanism 1 because it is a judgment, not a data fact. Two precision rules:

- **Scope the exemption to the institute id, not the parent.** Reviewer at
  Broad/MIT and PI at MIT share **MIT** → still a real COI; only a shared *Broad*
  (or *HHMI*) is exempt.
- **Broad is a weaker exemption than HHMI** and is the owner's call per institute:
  HHMI is a funder-employer whose investigators sit at different host campuses
  (clearly not co-located), whereas Broad core members are physically co-located
  in Cambridge — so a shared Broad is closer to a real shared-community conflict.
  Recorded as owner-requested; flagged as a policy choice, not a bug-fix.

**Net:** switch institution matching to ID space + consume
`associated_institutions`, and the biology-biased hand-alias table
(`match-signals.js`, incl. the `hhmi→janelia` conflation) can **shrink**, not
grow. The only durable hand-maintained artifact is the small mechanism-2 COI
exemption id set (HHMI, Broad, + owner additions). Start with those two.

### 5b.4 Hospitals & medical schools (dual appointments) — the case that firewalls mechanism-1 from COI

Faculty routinely hold appointments at a university **and** an affiliated
hospital (Harvard ↔ Dana-Farber, Mass General, Brigham, …). `[VERIFIED via
probe:` Harvard `I136199984` has **40** `related` associated institutions incl.
Dana-Farber `I4210117453`, MGH, Brigham, McLean, Beth Israel; Dana-Farber's
homepage is `dana-farber.org`, not a `harvard.edu` subdomain.`]` This hits all
three axes and, crucially, sets the boundary on the §5b.3 model.

- **Disambiguation / mismatch (mechanism 1 — helps).** A person whose OpenAlex
  `last_known_institution` is "Dana-Farber" against a claimed "Harvard" is
  handled by the `associated_institutions` consistency rule (Dana-Farber
  `related` Harvard) — no false mismatch, corroborates identity. Additive.

- **COI (the correction — DO NOT reuse mechanism 1 here).** Using
  `associated_institutions` transitively for COI would make **all 40** Harvard
  affiliates mutually conflicting — Dana-Farber ≡ McLean ≡ MGH — mass
  false-dropping the Boston biomedical world. COI must stay on **direct id/name
  match** (today two different hospitals have different ids → correctly *not* a
  COI). A shared *parent ecosystem* (two Harvard hospitals; or a hospital
  reviewer vs the university where they likely also hold an HMS appointment) is
  at most a **soft surfaced signal**, never a hard drop — and given reviewer
  self-disclosure is reliable (reviewers over-recuse), leaving it to
  self-disclosure is defensible. **Firewall: `associated_institutions` is a
  consistency/disambiguation tool only; it must never widen the COI hard-drop
  set.** (The mechanism-2 exemption overlay is the *only* associated-org input
  to COI, and it *narrows*, never widens.)

- **Email — a new failure mode this exposes.** A dual-appointment person often
  carries **two valid emails** (e.g. `@dfci.harvard.edu` and `@hms.harvard.edu`,
  or `@dana-farber.org`). The structured scholarly tier treats a top-2 tie as a
  `conflict` and abstains (`scholarly-email.js:249` `[VERIFIED]`) — so one paper
  per address → **false abstain**, when both addresses reach the same person.
  Fix: treat two emails as **alternates, not a conflict**, when their domains are
  consistent with the *same* person's institution set — a shared registrable
  domain (`harvard.edu` covers both HMS/DFCI subdomains via the existing psl
  logic) or domains mapping to the person's `associated_institutions`. Then pick
  one and let the magic-link self-report settle the **preferred** address (the
  provisional-until-attested principle); do not abstain. A genuine `conflict`
  (namesake risk) is only two emails whose domains map to *different* people /
  unrelated institutions.

## 6. Lowest-regret changes (ranked)

1. **Parse Europe PMC `<corresp>`** for corresponding-author email on the OA
   subset — cheapest recall+precision win; API already wired.
2. **Prototype the OpenAlex works-recipe (§5) head-to-head with the current
   author-search spine against the frozen 40-case identity benchmark.**
   `[OWNER-APPROVED as an option, 2026-07-18]` If it wins, it retires a large
   fraction of the promotion-grammar/rescue complexity. Measurable in an
   afternoon; settles the disambiguation question with numbers.
3. **Decide the paid-search tiers' fate with the eval in hand** — route their
   yield through the page-fetch tier (turn it on) to earn `institution_page`
   grade, or cut them to a staff faculty-page-link terminal state.
4. **Store evidence bundles, not bare OpenAlex author ids** (2026 churn).
5. **Consolidate the three name comparators and the duplicated
   `normalizeOrcid`/institution-token/recency helpers** — three parallel
   forename semantics is how the next same-session Keller/Sang regression
   happens.
6. **No new promotion branch or heuristic gate without a failing case in a frozen
   eval set first** — the record shows the eval harness was the fix every time it
   was used and never the default first step.

**Do not touch:** the fail-closed save-boundary gates, the abstain-is-safe
posture, the forename-contradiction gate, and the `research_only`-never-sends
policy. Those are load-bearing and correct.

## 7. Open questions for the owner

1. **Is Prophy genuinely off the table?** It is the ERC's tool and returns the
   contact info the pipeline struggles with. Is the blocker cost,
   data-governance (sending proposal context to a vendor), or the private-CRM
   binding — or worth a real evaluation?
2. **Is the reviewer subsystem in "stabilize, don't rebuild" mode, or is
   replacing the hand-rolled author-search spine with the works-recipe in
   scope?** (Determines whether §6.2 is a prototype or a recommendation. Owner
   has approved it as an *option*.)
3. **Would you turn on the opt-in page-fetch tier**, or is "no sendable email →
   staff opens the faculty-page link by hand" the intended terminal state? The
   answer decides whether the paid search tiers are rehabilitated or retired.

## Appendix — source index

### Code (this tree, `a234ce0c`)
- Origination prompt: `shared/config/prompts/reviewer-finder.js`
- Field-routed verification: `lib/services/discovery/verification.js`,
  `lib/services/discovery/name-matching.js`
- Identity spine: `lib/services/reviewer-identity-evidence.js`,
  `lib/services/reviewer-identity-resolver.js`
- Sources: `lib/services/openalex-service.js`, `lib/services/orcid-service.js`,
  `lib/services/pubmed-service.js`
- Contact enrichment: `lib/services/contact-enrichment/` (`tiers.js`,
  `scholarly-email.js`, `email-adjudication.js`, `openalex-metrics.js`,
  `page-email.js`), `lib/services/serp-contact-service.js`
- Send gate: `lib/utils/reviewer-invite.js`;
  `lib/services/review-manager/send-emails-service.js`
- Contracts: `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`
- Local eval: `outputs/reviewer-holistic-m1/reviewer-email-*-40-v1.json`,
  `…-contact-readiness-summary-*.json`
- Prior audit (strategy, not superseded): `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`

### External research (2026-07-18)
- OpenAlex author-matching recipe: https://developers.openalex.org/guides/recipe-audit-author-profile-works
- OpenAlex search semantics / relevance_score / raw_author_name.search: https://developers.openalex.org/guides/searching ; https://developers.openalex.org/api-reference/authors
- OpenAlex 2026 splits/merges, embeddings, parser, pricing: https://blog.openalex.org/ ; https://blog.openalex.org/q2-2026-town-hall-what-we-shipped-and-whats-next/ ; https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/
- OpenAlex vs Clarivate ID accuracy (fragmentation numbers): https://arxiv.org/abs/2502.11610
- OpenAlex feature limitations (Goldin split, institution errors): https://arxiv.org/html/2512.16434v1
- PubMed Computed Authors (accuracy, API, FTP): https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/authors/ ; https://ftp.ncbi.nlm.nih.gov/pub/lu/ComputedAuthors/
- Semantic Scholar / S2AND: https://github.com/allenai/S2AND ; https://www.semanticscholar.org/product/api
- Scopus / WoS disambiguation + license limits: https://dev.elsevier.com/policy.html ; https://developer.clarivate.com/apis/wos-researcher
- LLM/embedding AND (LEAD, WhoIsWho/OAG, KDD Cup 2024 IND): https://arxiv.org/abs/2511.07168 ; https://arxiv.org/html/2402.15810 ; https://openreview.net/forum?id=1mYLGW4OqL
- NLM 2013 email policy / MEDLINE data quality: https://www.nlm.nih.gov/pubs/techbull/so13/brief/so13_author_affiliations.html ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10630407/
- Europe PMC `<corresp>` full-text markup: https://jats.nlm.nih.gov/archiving/tag-library/1.1/attribute/corresp.html ; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10767826/
- Crossref (no email; has-authenticated-orcid): https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/contributors/
- OpenAlex corresponding-author data (is_corresponding, no email): https://blog.openalex.org/a-big-improvement-to-our-corresponding-author-data/
- ORCID <5% public email / verified email domains: https://info.orcid.org/trust-markers-in-orcid-records-verified-email-domains/
- Prophy (ERC tool, contact info): https://www.prophy.ai/referee-finder/ ; https://www.ariessys.com/news-and-events/press-releases/aries-systems-and-prophy-partner-to-diversify-reviewer-search-and-invitation/
- Contact APIs / `.edu` catch-all verification limits: https://hunter.io/blog/ultimate-guide-accept-all-catch-all/ ; https://www.zerobounce.net/blog/email-resources/email-verification/catch-all-domains
