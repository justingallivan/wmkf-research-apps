# Reviewer Finder Origination Plan

Date: 2026-06-12

Status: ACTIVE PLAN

Supersedes: `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md` section 6

Revision (2026-06-12, Claude review folded into Codex's draft): grounded arm
re-specified to the actual §12 design (Claude plans facets, never names reviewers)
rather than a keyword-free strawman; grounded-arm coverage/starvation made a primary
outcome; the "roughly equal" gate given a pre-specified safety threshold; blinding
need confirmed against the UI.

## SECTION 1 - CORRECTLY-NARROWED EVIDENCE

The J26 saved-reviewer data licenses only this narrow claim: Claude-present candidates survived the historical production workflow and staff curation under the instrumentation and UI signals that existed when those rows were saved. It does not license a causal origination claim, a Track-B contribution claim, or a claim that Claude-assisted origination would beat grounded lanes under source-blinded conditions. [VERIFIED via `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md` section 0 and section 5]

The saved-tag data cannot speak to origination because the current save/dedup path suppresses or relabels exactly the cases that would be needed to measure independent grounded-lane contribution:

1. Track-B rows that match a verified Track-A reviewer are removed before Track-B identity resolution. The live file in this checkout is `lib/services/discovery-service.js`, not the prompt's nested `lib/services/reviewer-finder/discovery-service.js`: verified names are collected from `results.verified`, and discovered candidates are filtered by `DeduplicationService.areNamesSimilar` before deduplication and identity resolution. [VERIFIED via `lib/services/discovery-service.js:246`]
2. Track-B identity resolution is capped to the top relevance-ranked slice: `TRACK_B_IDENTITY_RESOLUTION_LIMIT` is applied with `rankedForIdentity.slice(0, identityLimit)`, and the remainder is deferred. That means lower-ranked grounded candidates never receive the identity state needed for save eligibility. [VERIFIED via `lib/services/discovery-service.js:295`]
3. The save route rejects system-discovered unresolved rows before persistence. `isUnresolvedIdentity()` exempts human/document-grounded provenance but treats unresolved system-discovered rows as save-ineligible; the batch loop records `identity_unresolved` and continues before adapter writes. The live file is `pages/api/reviewer-finder/save-candidates.js`, not the prompt's nested `lib/services/reviewer-finder/save-candidates.js`. [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:56`; `pages/api/reviewer-finder/save-candidates.js:127`]

Together, those paths make `scholarly-only saved = 0` nearly inevitable by construction: a grounded candidate that overlaps a verified Claude-present row is removed before independent resolution; a grounded candidate outside the top identity budget is left unresolved; and an unresolved system-discovered row is rejected at save. The saved rows therefore measure survival through a Claude-present, source-signaled, identity-budgeted, save-gated funnel, not independent origination. [VERIFIED via the three code paths above]

Closure: stop mining J26 saved tags for the origination question. The J26 dataset cannot be un-confounded after the fact because the missing rows were suppressed before the persistence surface that would be mined. J26 remains useful as a regression cohort for replay experiments, but not as saved-tag evidence for Track-A versus grounded-lane contribution.

## SECTION 2 - BANKED vs OPEN

### Banked Items

Seniority-relaxation prompt change: shipped in commit `13800e3`. It is independent of origination direction because it changes how the existing Claude-assisted prompt treats founder/Nobel/emeritus/very-senior candidates; it does not decide whether candidate origination should come from Claude-assisted names or grounded scholarly lanes. [VERIFIED via `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md` section 2]

SerpAPI erosion finding: `google_scholar_profiles` is discontinued, `google_scholar_author` remains active but has login-wall degradation risk, four of six SerpAPI uses can be replaced with free academic APIs, and only general web contact lookup plus news remain genuinely irreplaceable. This warrants migrating topic-to-author and metric-bearing scholarly retrieval toward OpenAlex, Semantic Scholar, PubPeer, and field-specific free APIs where coverage and latency are validated. It does not by itself decide whether Claude-assisted or grounded-lane origination wins; it changes the cost/risk calculus for the sources available to a grounded experiment. [VERIFIED via `.claude-memory/project-serpapi-capability-erosion.md`]

### Open Items

Prompt decomposition / structured keyword extraction remains open and must not ship as an origination-direction bet before the forward experiment. Keyword extraction that feeds scholarly search is entangled with the grounded-lane direction: if it improves grounded search, it is part of the treatment being tested, not independent evidence for it. Model/tone improvements to ranking text, staff-facing explanations, or non-candidate field-map prose are separable, but query/facet generation that changes which scholarly candidates are found is not.

Do not ship prompt-decomposition changes that alter candidate origination, source planning, query facets, or scholarly-search candidate pools **to production** until the Section 3 experiment settles the direction. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md:715` and `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md:723`]

Note (reconciles with §3): using Claude-planned facets **inside the grounded experiment arm** is the treatment being tested, not a production ship — that is permitted and required (§3). The entanglement constraint is about shipping facet/origination changes to the live pipeline, not about running them as the grounded arm.

## SECTION 3 - FORWARD DECISION PLAN (the decisive experiment)

This plan reconciles with the existing redesign sequence rather than adding a parallel hedge. The canonical sequence already requires a shadow run before cutover, comparing current versus new pipeline and cutting over only if the new pipeline improves identity/COI safety without unacceptable coverage or latency regressions. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md:652`]

### Candidate Sets

Run exactly two isolated candidate sets on the same sampled requests:

1. Current Claude-assisted pipeline: the production-style analyze/discover flow where Claude may suggest reviewer names and Track A verifies them, with current hardening retained. This is the incumbent control. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part A section 1]
2. Grounded-lane (the actual §12 design, NOT a keyword-free strawman): people are **originated only from resolved works / retrieval** — Claude **never names a reviewer** in this arm (§12.4: "the LLM never names a reviewer — people are derived only from resolved works"). But Claude **does** plan the retrieval, exactly as §12 specifies: it reads the proposal and generates **query facets / search terms** (the §12.7 broad-facet role) and adjudicates/synthesizes over retrieved real people. What is forbidden is Claude *minting candidate names from parametric memory* — not Claude planning queries. The arm uses: structured request metadata, proposal documents, PI/project-leader ORCID + ORCID works lists, OpenAlex author/work resolution and topic→author aggregation **over Claude-planned facets**, and existing deterministic identity/COI gates.

   **Why facet-planning must stay in the grounded arm [VERIFIED via this session's probes]:** facet quality is decisive. A broad facet "temperature-dependent alternative splicing" surfaced the real J26 reviewer Florian Heyd at #2 (corpus 166); the narrow production facets collapsed to corpus 0–11 and surfaced wrong-field noise (1002279 plant-cyanide biology; 1002365 soil microbiome). A grounded arm with Claude facet-planning *removed* would be tested in its crippled state and would lose for the wrong reason — handing the experiment a rigged answer.

Isolation rules:

- Do not union the two arms before staff outcome collection.
- Claude MAY plan facets/queries for the grounded arm (per §12); what it must NOT do is seed the grounded arm with any Claude-*named* reviewer candidate. The grounded arm's people come only from retrieval over resolved works.
- Do not let grounded candidates inherit Claude-written rationale or source badges.
- Preserve per-arm provenance internally for analysis, but remove arm/source labels from the staff-facing collection surface.
- If a person appears in both arms after identity resolution, keep one blinded staff-facing row and record both arm memberships in hidden experiment metadata.

### Blinding

Today `DiscoveryService.rankAllCandidates()` stamps the signal directly: verified candidates are passed through `withReviewerProvenance({ ...c, isClaudeSuggestion: true })`, while discovered candidates are stamped `isClaudeSuggestion: false`. [VERIFIED via `lib/services/discovery-service.js:2278`] **And the staff UI surfaces it** — results are "split by provenance group plus Unverified," provenance labels render as Pills, and the Unverified group is literally captioned "Claude suggestions the searched databases couldn't verify." [VERIFIED via `shared/components/reviewers/ReviewerSearchSection.js:18,306,413,667`] So the blinding code change is **strictly required**, not optional — staff see the arm today.

For the experiment, staff must not see `isClaudeSuggestion`, Claude/provenance section labels, source badges that reveal arm, or Claude-written reasoning that differs systematically from grounded-arm rationale. Concretely, one of these must change before collection:

- Preferred code change: add an experiment response transform that emits a blinded candidate DTO with `isClaudeSuggestion` omitted or set to `null`, neutral display grouping, neutral rationale fields, and hidden server-side `experimentArmIds[]` persisted only in experiment metadata.
- Acceptable process fallback for a short pilot: export candidates into a separate blinded review sheet where source/arm columns are hidden from staff and only an experiment coordinator can rejoin arm membership after outcomes are collected.

Do not use the normal Workbench/Finder UI for outcome collection unless it is modified to shield this signal; the current UI/source grouping is not blinded. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part A section 4.2]

### Outcome Metric

The outcome metric is per-reviewer-candidate accept/decline/referral from actual review decisions, aggregated per source arm. A candidate counts at the point of staff invitation and downstream response:

- accepted invitation
- declined without useful referral
- declined with useful referral
- staff selected but not invited, if staff keep a structured reason
- staff rejected before invitation, if staff keep a structured reason

Primary metrics (two, co-equal): (1) accepted-invitation-plus-useful-referral rate per candidate, by arm; AND (2) **per-arm coverage — invite-worthy candidates produced per proposal, and the fraction of proposals where the arm STARVES** (produces too few invite-worthy candidates to staff a panel). Coverage is primary, not secondary, because this session's probes predict the grounded arm will starve on a real fraction of proposals (pivot / sparse-corpus: 1002279, 1002365 collapsed to corpus 0–11). A grounded arm that produces high accept-rate on the few candidates it finds but starves on a third of proposals is a *different* verdict than one with comparable coverage — and the experiment must distinguish them. Secondary metrics: acceptance-only rate, useful-referral-only rate, staff pre-invite rejection rate, identity/COI error rate, time-to-usable-reviewer. Do not use cosine similarity, saved-tag count, or J26 saved-source tags as decision metrics.

### Sample Size

Base rate, partial: the J26 saved data carries `invited`/`accepted` flags, giving a rough **accept-among-invited rate ≈ 50%** (e.g. 1002365: 3 accepted of ~6 invited) [DATA, J26 sweep] — a usable anchor for the MDE, though invite counts per proposal are small. Use a practical minimum anchored on a minimum detectable effect.

**Sample selection — do NOT pre-filter to grounded-friendly proposals.** Draw a representative sample across fields and novelty (continuing-line AND pivot proposals). Grounded-arm starvation on a proposal is a *result* (a coverage verdict), not a reason to drop that proposal; excluding starve-prone proposals would rig the coverage metric.

Minimum: 40 blinded candidates per arm across at least 8 proposals, with each proposal contributing candidates from both arms where feasible (a proposal where the grounded arm starves still counts — recorded as zero/low grounded coverage). This can detect only large directional effects, which is acceptable for a cutover gate: if grounded-only is plainly better or plainly worse, it should show up in acceptance plus useful-referral rate, staff pre-invite rejection rate, and identity/COI error rate at this scale. If results are close or noisy, extend to 80 candidates per arm before making a cutover decision.

Rationale: a small pilot is enough to falsify catastrophic failure modes such as grounded lanes producing too few invite-worthy reviewers, excessive COI/identity problems, or no referral yield. It is not enough to prove small percentage-point improvements. Treat any small advantage under 40 per arm as inconclusive.

### Minimal Build

Build only what is necessary to run the experiment and align it with the redesign sequence:

1. Reuse the existing S232 provenance DTO / consumer contract as the carrier for candidate metadata. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part A section 4.2]
2. Add a grounded-lane-only runner for ORCID-works plus OpenAlex author/work resolution. Use the Section 12 rule: PI corpus comes from the ORCID record's own works list, not a merge-prone OpenAlex author cluster. [VERIFIED via `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md:265`]
3. Add a bounded identity/hypothesis adapter sufficient to mark `confirmed`, `probable`, `ambiguous`, or `unresolved` for grounded candidates before they become selectable. This follows the redesign sequence's hypothesis-builder / resolver adapter step. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` section 7]
4. Add a blinded experiment DTO or export path that hides `isClaudeSuggestion`, provenance group labels, source badges, and arm-specific rationale from staff while preserving hidden arm membership for analysis. [VERIFIED via `lib/services/discovery-service.js:2278`]
5. Add outcome capture fields for per-candidate staff decision, invitation status, accept/decline, useful referral, and notes on identity/COI defects. This may be a lightweight experiment table, a controlled CSV export/import, or an internal-only admin artifact; it does not need to be the final production UI.
6. Run the existing shadow-run comparison dimensions from the redesign plan: identity false-positive rate, COI miss rate, field coverage, latency, API-failure rate, duplicate-cluster rate, and human-review queue volume. [VERIFIED via `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md:652`]

Do not build reference-resolution, field-routed ADS/arXiv/DBLP expansion, primer storage, or full prompt decomposition merely to answer this experiment unless a sampled proposal cannot produce a grounded arm from ORCID-works plus OpenAlex. Those remain redesign work, not the minimal decisive experiment.

### Decision Gates

Grounded wins: if grounded-lane-only materially beats current Claude-assisted on accepted invitation plus useful referral rate without worse identity/COI errors, coverage collapse, or unacceptable latency, gate the build toward retrieval-first cutover. Next build decision: proceed with the redesign sequence's hypothesis-builder, grounded provenance, source expansion, and eventual inversion to retrieval-first origination; keep Claude only for extraction/adjudication/rationale roles that do not name reviewers.

Roughly equal: if grounded-lane is within a pre-specified margin of current Claude-assisted on the accept-plus-referral metric (set the margin BEFORE the run — e.g. within ±X percentage points, X fixed in advance), gate toward staged cutover only if grounded clears a **pre-specified, numeric** safety/coverage bar fixed before the run — e.g. identity false-positive rate and COI-miss rate each ≤ the incumbent's, AND grounded-arm starvation on ≤ a pre-set fraction of proposals. "Clearly better safety" is not a usable criterion unless the threshold is written down first; otherwise this gate can rationalize either decision. Next build decision (if the bar is cleared): continue building grounded lanes as the safer/auditable spine, but keep Claude-assisted Track A as a cold-start lane until grounded coverage is proven proposal-by-proposal. If the bar is NOT cleared, treat as Claude-assisted-wins.

Claude-assisted wins: if current Claude-assisted materially beats grounded-lane-only on accepted invitation plus useful referral rate and grounded does not offset that with major identity/COI safety gains, gate against cutover. Next build decision: keep Claude-assisted origination, ship only direction-independent hardening and SerpAPI/free-stack replacements, and defer retrieval-first inversion until a stronger grounded arm exists.

In all outcomes, do not use J26 saved tags as the deciding evidence.

## SECTION 4 - OPEN QUESTION AND FAIR ACCOUNTING OF SECTION 12

Origination direction remains open. The current evidence supports neither "Claude-assisted should remain the long-term origination spine" nor "grounded-lane-only should replace it now." The causal question requires the forward, source-blinded decision experiment above.

Section 12 of `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` deserves a fair accounting:

- Section 12.3 shows positive evidence that the ORCID-works corpus can surface field leaders the keyword pipeline missed. The Wen Li ORCID-works trail surfaced Keller, Dörner, Corkum, Krausz, Kling, and Vrakking after avoiding a contaminated OpenAlex author cluster. [VERIFIED via `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md:265`]
- Section 12.4 shows positive evidence that independent grounded lanes can surface candidates or anchors where the prompt/PI-trail path yields zero or misses a pivot field. It records PI-trail wins for 1002794 and 1002959, proposal-named/peer-group strength, and topic-to-author aggregation surfacing DNA-repair specialists for 1003020. [VERIFIED via `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md:288`]
- Section 12.4 also keeps the safety boundary explicit: current production Track A still has Claude suggest names, and that path is out of scope for Section 12 until grounded coverage is proven. [VERIFIED via `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md:294`]

J26 neither refutes nor validates Section 12. It cannot refute Section 12 because saved-tag zeros are confounded by pre-resolution dedup, top-25 identity resolution, and save-time rejection of unresolved system-discovered candidates. It cannot validate Section 12 because Section 12's grounded lanes were not run as a blinded production candidate source with actual accept/decline/referral outcomes.

Section 12 evidence is from a thin pilot: three read-only probes, not a production experiment. It is enough to justify a forward grounded-lane experiment; it is not enough to confirm at scale or authorize cutover.
