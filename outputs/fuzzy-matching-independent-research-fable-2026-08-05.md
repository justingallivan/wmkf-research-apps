# Fuzzy Matching of People and Institutions — Independent Research Position

Date: 2026-08-05 (Session 402)
Author: Claude (Fable), independent of `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` (Codex, 2026-08-04). Reconciliation with that document is a deliberate later step; this document records the independent view first.

Status: research and opinion only. Nothing here authorizes implementation, dependency adoption, schema work, or changes to live identity/write gates.

> **Historical boundary, updated 2026-08-07:** this independent position's
> locally-held ROR-dump recommendation is superseded by the owner's server-side
> ROR API decision. The dump is offline-only. Current build authority is
> `outputs/institution-resolution-handoff-to-codex-2026-08-07.md`.

Evidence basis: five parallel web-research sweeps (record-linkage frameworks; person-name matching; academic author disambiguation; institution resolution; modern LLM-era matching and decision design) plus a full inventory of the matching code this repository has actually accumulated. Source URLs are cited inline; claims marked [directional] came from preprints or vendor material and should be re-verified before load-bearing use.

---

## 1. The diagnosis, quantified

The owner's hypothesis — "we have tried to code our way out of disambiguation without a well-thought-out strategy" — is confirmed by the code inventory, and the scale of it is worth stating plainly:

- **14 person-name normalizer definitions, reducible to 8 genuinely distinct algorithms** — some fold diacritics, some don't; some strip honorifics, some don't; one reorders "Last, First". Two are byte-identical copies; four re-define the same two-function composite.
- **11 institution normalizer definitions, 6 distinct algorithms**, including two verbatim copies of a keyword-set extractor.
- **Two independent nickname maps** (`discovery/constants.js` NICKNAME_MAP; `integrity-matching-service.js` NAME_VARIANTS) — so "Chris = Christopher" is true in PubMed byline matching and retraction screening but false everywhere else, including the exclusion filter, dedup keys, roster keys, and the proposal-author COI filter.
- **~25 comparison predicates**, almost all boolean, each hand-built for one call site. The only statistical similarity in the entire system is one Dice-coefficient library (`string-similarity`) at two uncalibrated thresholds (0.85 names, 0.9 institutions).
- **Nothing from the standard toolkit is present**: no Jaro-Winkler, no edit distance on names, no phonetic coding, no name-frequency weighting, no TF-IDF/rare-token weighting for institutions, no calibrated scores anywhere.

Two things follow. First, the same pair of strings gets different answers at different seams — that is not a tuning problem, it is the absence of a shared evidence model. Second, and worth crediting: the codebase has independently converged on several ideas the literature validates — identifier-first matching (ORCID/OpenAlex ID equality beats any string), explicit abstention (`unresolved` fail-closed), negative evidence (`forenamesContradict`, anchor-conflict veto, `institutionsContradict`), and "initials are compatible-but-weak, never contradiction" (the S236 fix). The instincts are right. What's missing is one framework that makes the evidence additive, weighted, calibrated, and reusable.

## 2. What the field actually does

This problem has a name — **entity resolution / record linkage** — and a 55-year-old core theory that is still what national statistics offices, health systems, and the UK Ministry of Justice run in production.

### 2.1 The Fellegi–Sunter framework is the "scoring algorithm" the owner asked about

Fellegi & Sunter (1969) formalized exactly the desired behavior: each field comparison (surname agrees / forename is nickname-equivalent / affiliations share a rare token / middle initials conflict) contributes a **log-likelihood weight** — positive evidence when agreement is common among true matches and rare among non-matches, negative evidence for disagreement, roughly zero for missing data. Weights **add** into one score. Three properties matter for us:

1. **Rarity is built in.** Agreement on "Zbigniew" outweighs agreement on "John" via term-frequency-adjusted u-probabilities (Winkler 1989; implemented as first-class "term frequency adjustments" in Splink). Agreement on "Keck" outweighs agreement on "University". This single mechanism replaces our containment hacks and conflictingWords vetoes with principled math. (https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html)
2. **Negative evidence is native.** Disagreement carries a weight of log((1−m)/(1−u)) — a contradicted full forename is a large negative number, not a special-case boolean. Graded comparison levels (exact > nickname > initial-compatible > disagree) each get their own weight. Our `forenamesContradict` is a hand-rolled special case of this. (https://www.robinlinacre.com/m_and_u_values/)
3. **The output is a three-way decision by design**: match / clerical review / non-match, with the two thresholds chosen to bound false-match and false-non-match rates. The review band is not a failure mode — it is the design center. (http://www2.stat.duke.edu/~rcs46/linkage_readings/2015-Murray-Blocking-FellegiSunter.pdf)

**Splink** (UK MoJ, MIT license, Splink 4 in 2024) is the modern implementation — EM-trained weights without labeled data, term-frequency adjustments, threshold-selection tooling, and per-pair "waterfall" charts showing exactly which fields contributed how much evidence. It runs the UK 2021 Census self-linkage and NHS record linkage. (https://github.com/moj-analytical-services/splink)

**Independent take on buy-vs-build:** our matching problems are small — candidate lists of tens, rosters of hundreds, a registry of ~120k institutions — not the 100M-row problems Splink's engine exists for. What we should adopt is Splink's **model** (additive field-level evidence weights, term-frequency adjustment, three bands, waterfall explanations), which at our scale fits in one shared JS module with hand-assigned-then-calibrated weights. The expensive part is not the engine; it is the labeled evaluation data and the discipline of one shared scorer.

### 2.2 Person names: mostly a solved lookup-plus-metric problem

- **Chris ↔ Christopher is a dictionary, not an algorithm.** Open, widely-used nickname/diminutive datasets exist (carltonnorthern/nicknames ~1,600 names; diminutives.db; Behind the Name API for cross-cultural variants). The correct treatment is a graded comparison level ("nickname-equivalent forename" scoring slightly below "exact forename"), with the caveat that nickname→formal is one-to-many (Chris → Christopher/Christine/Christian) so it weakens, not proves. (https://github.com/carltonnorthern/nickname-and-diminutive-names-lookup)
- **Jaro-Winkler** was designed at the US Census specifically for person names; the classic Cohen/Ravikumar/Fienberg comparison found the best all-round name metric to be **SoftTFIDF** — TF-IDF token weighting with Jaro-Winkler as the within-token comparator — i.e., rare-token weighting and typo tolerance combined. Christen's survey (the standard reference) concludes there is no single best metric: choose per field, combine evidence. (https://people.csail.mit.edu/emax/public_html/papers/approximate-string-matching/iiweb03.pdf; https://users.cecs.anu.edu.au/~Peter.Christen/publications/tr-cs-06-02.pdf)
- **Phonetic codes (Soundex/Metaphone/Beider-Morse) survive as cheap recall/blocking keys**, not deciders. Optional for us; useful if we ever need "did we miss a spelling variant" retrieval.
- **Name frequency matters and is obtainable**: US Census surname files (and, newly, first-name frequencies from the 2020 Census release) plus our own corpus counts. A surname match on "Krishnan" and one on "Smith" should never score the same. [directional on the 2020 first-names release date]
- **Negative evidence has published treatment**: linkage methodology explicitly distinguishes "both middle initials present and different" (affirmative non-match evidence) from "one missing" (neutral). Cultural caveats bound it: surname change at marriage is Western-specific; transliteration explosions (≈40 Latin renderings of one Arabic name; Pinyin collisions across distinct Chinese names) mean a "contradiction" in romanized form can be spurious. Diacritic hazard: Müller folds to "Muller" but transliterates to "Mueller" — an equivalence class, not a fold. (https://www.ncbi.nlm.nih.gov/books/NBK253312/)

### 2.3 Institutions: a registry-linking problem, not a string-pair problem

The field's consensus architecture treats "UCSF" vs "University of California, San Francisco" not as string similarity but as **entity linking against a canonical registry**:

- **ROR** is the canonical open registry (~120k orgs): typed name arrays (display/label/alias/acronym — "UCLA" is *data*, not something to derive), registered web domains, GeoNames locations, and explicit parent/child/related links (UC System → campuses → institutes; LBNL deliberately separate from Berkeley). ROR's own guidance: use the registry as data, accept its affiliation-matcher only on `chosen: true`, never threshold its scores; a new single-search matching strategy is rolling out as default in Q1 2026. (https://ror.readme.io/docs/ror-data-structure; https://ror.org/blog/2025-12-02-announcing-a-new-affiliation-matching-strategy/)
- **The reference pipeline is S2AFF** (Allen AI): parse the string into main-org / child-org / address → high-recall top-100 ROR candidate retrieval (recall@100 = 0.984) → feature-based LightGBM rerank (precision@1 ≈ 0.97) → accept using both the top score **and the margin over #2**. The 2025 OpenAIRE comparison (AffRo paper) puts S2AFF at P=0.964, OpenAlex's parser at P=0.914 on a curated benchmark — i.e., ~90–97% is the state of the art, so a review band is mandatory, not optional. (https://github.com/allenai/S2AFF; https://arxiv.org/html/2505.07577)
- **The generic-token trap is documented**: token-set/containment scoring rates "University of California" a perfect subset of "University of California San Francisco" — precisely the parent/sibling trap. The published fix is **rare-token (TF-IDF) weighting**: "University/of/California" contribute almost nothing; "Francisco", "UCSF", "ucsf.edu" decide. (https://tilores.io/content/company-name-normalization-isnt-enough-for-fuzzy-matching/)
- **The hierarchy problem has published policy answers**: OpenAlex marks the UC System `is_super_system: true` and excludes it from campus lineage so system-level attribution can't masquerade as campus attribution; AffRo's default when location evidence is missing is to resolve to the **parent**, never guess a sibling; CWTS Leiden maintains an explicit curated medical-center→university mapping rather than trusting strings. Translation for us: a bare "University of California" resolves to the system or abstains — campus assignment requires campus evidence (city, domain, acronym, campus token). (https://developers.openalex.org/api-reference/institutions; https://arxiv.org/html/2505.07577)
- **Domains are a first-class join key**: ROR records carry registered institutional domains; ucsf.edu vs berkeley.edu distinguishes UC entities directly. Our contact-enrichment domain anchoring already exploits this instinct; it should become scored evidence in the same ledger.
- Nobody publishes sibling-campus confusion rates specifically (flagged gap in the sweep) — the closest evidence is a 25% false-attribution finding in an OpenAlex institutional case study. Our UC falsification matrix would be genuinely novel and worth having.

### 2.4 Author disambiguation: what production systems teach

- The production pattern everywhere (S2AND, PubMed Computed Authors, Scopus): **block on surname + first initial → gradient-boosted pairwise classifier over many features → cluster**. S2AND's three most valuable features: paper-embedding similarity, affiliation, **name frequency**. Reported: ~0.90 B³ F1 (S2AND); 98–99% precision (Scopus, Author-ity). (https://arxiv.org/abs/2103.07534)
- **ORCID is an anchor and a feature, never the solution**: only ~48% of ORCID profiles list even one work; coverage skews by field (17%–93%) and career stage; assertion error ≈1.5%. PubMed's rule is instructive — differing ORCIDs keep records apart *unless* model probability >0.99 AND affiliations agree: identifiers constrain, evidence decides. (https://www.frontiersin.org/journals/research-metrics-and-analytics/articles/10.3389/frma.2022.1010504/full)
- The literature's split/merge (homonym/synonym) framing maps exactly onto our failure archive: namesake collisions are homonyms; Chris/Christopher and transliteration variants are synonyms. PubMed's rebuild published the trade explicitly (splitting 7.7%→3.6% bought merging 2.2%→5.3%) — you tune this trade, you don't escape it. For a reviewer-invite pipeline, false merges (wrong person invited/paid) are the catastrophic side, so we tune toward splits and route the residue to humans.
- Big scholarly indexes mostly **always-assign then offer correction**; the closest analogues to us (publisher reviewer-matching: Frontiers AIRA) are explicitly **recommend-plus-human-decision** with COI checks as flags. That matches, and validates, our workbench posture — our PD confirm flow *is* the clerical-review band and should be formalized as such.
- Zero-shot LLMs on the hard benchmark (WhoIsWho) currently lose to trained feature pipelines by a wide margin (best ≈76 AUC) [directional]; no major index documents an LLM in its production disambiguation loop.

### 2.5 Decision design: the most transferable lesson

The mature adjacent industries (healthcare master-patient-index, sanctions/KYC screening) converge on the same operating pattern, and it is the piece we most lack:

1. **Three bands everywhere**: auto-accept / human review / auto-reject, with thresholds set from score distributions against target error rates, documented as governed artifacts, and periodically re-validated (OFAC treats threshold validation as a compliance requirement).
2. **Asymmetric costs are explicit**: when false merges are costly, optimize F0.5 or fix a precision floor; production match thresholds in cancer-registry linkage sit at 0.95–0.999999999.
3. **Name similarity alone never auto-decides** — corroborating attributes (DOB, address, identifier) gate the decision; a name-only hit on a common name is presumptively false. Substitute ORCID/domain/geography for DOB/address and this is our exact situation.
4. **Explainability is a product requirement**: every decision must answer "why did these match" with a per-field evidence breakdown (Splink's waterfall chart is the reference UX). Our review band (PD rescue modal) should show exactly this.
5. **LLM as escalation tier is now empirically supported**: a 2025 Federal Reserve working paper found LLMs cut sanctions-screening false positives ~92% vs the best fuzzy baseline but ran ~4 orders of magnitude slower — hence the cascade: cheap deterministic/scored matching for the easy mass, LLM adjudication only for the uncertain middle band. LLM matchers also show order/transitivity inconsistency, so they adjudicate with structured prompts and voting, never as the primary scorer. (https://www.federalreserve.gov/econres/feds/files/2025092pap.pdf) [directional]
6. **Entity-centric accumulation** (Senzing's pattern): match new observations against the *accumulated* entity (every name variant, domain, identifier seen so far), not record-vs-record from scratch each run — directly relevant to our per-request re-discovery and cross-request person records.

## 3. Independent recommendation

### 3.1 Strategy in one paragraph

Treat identity as **one evidence ledger and one scorer** instead of thirty predicates. Every seam that today asks a boolean ("same name?", "same institution?") should instead ask the shared scorer for a calibrated score plus an evidence breakdown, then apply a seam-specific threshold pair chosen by the risk of the action it gates (display collapse < search dedup < COI drop < invite send < Dataverse write < payment). Institutions become entity-linking against a locally-held ROR dump with rare-token retrieval and hierarchy-aware policy (parent-on-ambiguity, sibling-requires-evidence). People stay anchor-first but anchors are strong evidence, not proof. The middle band routes to the PD review affordances we already built. Nothing auto-decides on a bare name.

### 3.2 Concrete sequence (proposed, not authorized)

**Step 0 — benchmark before touching anything.** Consolidate our real failure archive (namesake collisions, Kwong, Krishnan, the S399/S400 institution false-mismatches, UC cases) into a labeled suite, plus a UC-system adversarial matrix (per campus: substitute each sibling's acronym/city/domain one at a time; parent-only strings must never resolve to a campus). Run today's predicates against it first — the incumbent heuristics are the baseline any replacement must beat. Target metrics: resolved-only precision (floor, owner-set), review-band recall, correct-abstention rate, zero wrong sibling-campus auto-decisions.

**Step 1 — consolidation (cheap, near-mechanical, high value).** One canonical name normalizer and one institution normalizer (parameterized where seams genuinely differ), one nickname table, delete the duplicates. This is refactoring with pinned behavior tests, not new capability, and it removes the "same strings, different verdicts" class of bug outright.

**Step 2 — the shared scorer.** A small JS module implementing the Fellegi–Sunter shape: graded comparison levels per field (names: exact > nickname > initial-compatible > disagree; institutions: id-equal > acronym/alias-exact > rare-token overlap > generic-only), term-frequency weighting from our own corpus + Census name files, additive weights, three-band output, and a per-decision evidence breakdown object (the waterfall) that the review UI can render. Weights start hand-assigned from the literature's priors and get calibrated against the Step-0 benchmark. Jaro-Winkler as the within-token comparator (one tiny dependency or ~60 lines).

**Step 3 — institution entity linking.** Local ROR dump as the canonical catalogue; candidate union from exact alias/acronym/domain joins + rare-token retrieval; feature scoring (geo, domain, hierarchy, acronym rarity); policy layer: parent-on-ambiguity, campus-only-with-campus-evidence, abstain on multi-org strings. Evaluate S2AFF as either a reference or a directly-run component. Replace the six institution normalizers' consumers seam by seam, starting with the lowest-risk (display/dedup) and ending with COI.

**Step 4 — person scoring on the same ledger,** folding in what already works (anchor-first keys, forename contradiction as a heavy negative weight, work-grounding) and adding what's missing (nickname level everywhere, name frequency, coauthor/venue overlap where available). Clustering/cross-request person records only after pairwise behavior is measured — false merges propagate.

**Step 5 — decision governance.** Write down, per seam, the threshold pair and who owns it; log score + evidence for every automated decision; review thresholds when the benchmark grows. Optional after that: LLM adjudication of middle-band pairs (structured prompt, evidence-cited verdict), cheap and bounded because the band is small.

### 3.3 What I would explicitly not do

- Not adopt a heavyweight ER platform (Splink engine, Zingg, dedupe) — wrong scale; Zingg is AGPL besides. Borrow the model, not the machinery.
- Not use embeddings or LLMs as the primary matcher for names/institutions — short strings carry little semantics; purpose-trained character embeddings are promising for name variants [directional: ComplyAdvantage 88% vs 59% for edit-distance] but that's an optimization for later, not the foundation.
- Not trust any provider's rank 1 (ROR search, OpenAlex, Scholar) as a decision — every source in the sweep, including ROR itself, warns against exactly this.
- Not build phonetics, Beider-Morse, or cross-script transliteration now — real but not our observed failure distribution; revisit if the benchmark says otherwise.
- Not attempt one universal threshold — the whole point is per-seam bands tied to action risk.

## 4. Open questions for the owner

1. **Precision floor**: for fully-automatic decisions (auto-collapse, auto-COI-drop, auto-link), what wrong-decision rate is tolerable? (My prior: ~zero for sibling-campus and person-merge errors that can reach an invite or payment; the design assumes abstain-and-review is always acceptable as the fallback.)
2. **Review capacity**: the three-band design deliberately produces a human queue. Roughly how many review decisions per search/cycle is acceptable before the bands must be re-tuned?
3. **Registry commitment**: is ROR acceptable as the canonical institution namespace for *research* identity (distinct from CRM/legal Accounts)? Everything in Step 3 assumes yes.
4. **Benchmark investment**: Step 0 is a few dozen hours of curation. Is the UC adversarial matrix + failure-archive suite worth owning as a permanent regression asset? (My view: it is the single highest-leverage artifact in this whole area.)

---

*Next step (separate, deliberate): reconcile this position against `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` (Codex, 2026-08-04) — agreements, disagreements, and what each found that the other missed.*
