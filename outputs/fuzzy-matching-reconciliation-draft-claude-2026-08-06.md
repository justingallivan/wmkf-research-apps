# Fuzzy-Matching Reconciliation — Claude Draft (input to Claude×Codex consensus)

Date: 2026-08-06 (Session 404)
Status: working draft. Inputs: `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md` (Claude) and `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` (Codex, 2026-08-04). Decision work only; no build authorized.

## 1. Agreements (both docs, independently reached)

1. **Fellegi–Sunter is the recommended scoring model**: additive field-level evidence weights, graded agreement levels, term-frequency/rarity adjustment, negative evidence as first-class weights.
2. **Three-band output everywhere**: resolved / review / unresolved. Abstention is the design center, not a failure mode; the existing PD confirm flow is the review band.
3. **ROR is the canonical institution catalogue, never the decision authority.** Local dump as data; never trust any provider's rank 1 (Codex proved this live: Touro ranked above UC system for "University of California"; `UCSD` affiliation-matching returned nothing despite the acronym being in the record).
4. **S2AFF is the institution baseline; S2AND is the person-disambiguation architectural reference.** State of the art is ~90–97% precision, therefore a review band is mandatory.
5. **Hierarchy policy**: parent-only evidence never silently becomes a campus; sibling campus requires campus evidence; multi-org strings allow multiple outputs or abstention.
6. **Identifiers (ORCID etc.) are strong evidence and anchors, never proof.** Identity-confirmed ≠ contact-validated.
7. **Benchmark before build**, seeded from the real failure archive plus a UC-system adversarial matrix (substitute sibling acronym/city/domain one at a time). Hard safety gate: zero wrong automatic sibling-campus decisions; owner-set resolved-only precision floor; precision (F0.5) over coverage for anything that clears a gate or enables a write.
8. **Embeddings/LLMs are never the primary matcher.** Challenger/escalation tier only, bounded to the review band, structured output, must abstain.
9. **Clustering / cross-request person records are deferred** until pairwise behavior is measured; false merges are the catastrophic direction and propagate.
10. **CRM/legal Accounts are a different namespace** from research-institution identity; nothing here authorizes Account linking.

## 2. What each doc has that the other lacks

**Codex doc only:**
- The **four-decision decomposition** (institution resolution; person identity; current affiliation; contact attribution) — the cleanest problem frame either doc produced. Claude's doc mostly fuses 3 and 4 into "person scoring".
- **Current affiliation as a dated evidence ledger** with an explicit source-priority order (directory > institution-asserted ORCID > lab page > self-asserted ORCID > byline > OpenAlex last-known), multiple concurrent affiliations representable.
- **Contact attribution as a separate verdict** with its own evidence grades.
- **Live ROR probes** (empirical, not literature): the UCSD/Touro findings above.
- **Rigorous evaluation design**: phased benchmark (150–300 falsification suite → 1,000–2,000 representative), leakage control (leave-one-campus-out), frozen ROR release/provider versions, calibration metrics (Brier/ECE), error-severity taxonomy, retrieval measured separately from decision.

**Claude doc only:**
- The **internal code inventory** — the quantified diagnosis (14 person-name normalizer definitions / 8 distinct; 11 institution / 6 distinct; two independent nickname maps; ~25 boolean predicates; one uncalibrated Dice coefficient). Codex's doc looks outward only; without this the consolidation step doesn't exist.
- **Step 1 consolidation** as a cheap, near-mechanical, independently shippable increment (one name normalizer, one institution normalizer, one nickname table) that removes the "same strings, different verdicts" bug class regardless of any scorer decision.
- **Per-seam threshold pairs tied to action risk** (display collapse < dedup < COI drop < invite < Dataverse write < payment) and decision governance: thresholds as owned artifacts, score+evidence logged per automated decision.
- Concrete name-matching machinery: nickname datasets, Jaro-Winkler/SoftTFIDF, name-frequency sources (Census files + own corpus), cultural/transliteration caveats (Müller/Mueller; romanization collisions).
- **Explainability as a product requirement** (per-decision evidence waterfall rendered in the review UI).
- **Entity-centric accumulation** (match against the accumulated entity, not record-vs-record per run) — relevant to per-request re-discovery.
- The buy-vs-build position: borrow Splink's **model**, not its engine; a small shared JS module at our scale.

## 3. Candidate disagreements (to settle or hand to owner)

1. **Benchmark size/investment.** Claude: failure archive + UC matrix, "a few dozen hours". Codex: phased 150–300 then 1,000–2,000 labeled cases with stratification and frozen splits. Proposed resolution: adopt Codex's *phasing* but gate Phase 2 (the 1,000–2,000 build-out) on an owner decision after the falsification suite proves which approach family survives. This is also owner question 4.
2. **Consolidation-before-scorer.** Claude sequences normalizer consolidation as Step 1; Codex's doc doesn't address internal code at all. Proposed resolution: consolidation is orthogonal to the research question and justified by the inventory alone; it proceeds first/parallel as pinned-behavior refactoring in independently shippable increments (S395 constraint).
3. **Evaluate-vs-commit on the scorer.** Codex frames Fellegi–Sunter/Splink, boosted trees, dedupe as comparators to *evaluate*; Claude *commits* to the Fellegi–Sunter shape as a local JS module and rejects heavyweight platforms outright. Proposed resolution: commit to the Fellegi–Sunter-shaped shared scorer as the *first implemented* model (interpretable, three-band native, cheap), with Codex's comparator list retained as benchmark comparators — the benchmark can dethrone it, but we don't build two systems speculatively.
4. **Sequencing of person vs institution work.** Claude: institutions first (Step 3) then person (Step 4). Codex: neutral. Likely a nit for the owner; institution-first matches the observed failure distribution (S399/S400, Shih) and the card's status-band dependency.

## 4. Proposed merged shape (one paragraph)

Adopt Codex's four-decision decomposition as the problem frame and Claude's one-ledger/one-scorer as the mechanism. Sequence: (0) labeled failure archive + UC adversarial matrix (~150–300 falsification cases, Codex's metrics and freeze discipline; Shih's Dana-Farber/Harvard case is row one) with today's predicates as the incumbent baseline; (1) normalizer/nickname consolidation, pure pinned-behavior refactor, independently shippable; (2) shared Fellegi–Sunter-shaped scorer (graded levels, TF weighting, additive weights, three bands, evidence breakdown object) hand-weighted then calibrated on the benchmark; (3) institution entity-linking against a local ROR dump (candidate union → feature rerank → hierarchy policy → three bands), consumers migrated seam by seam lowest-risk-first; (4) person scoring on the same ledger, anchor-first, with current-affiliation and contact-attribution as separate dated verdicts per Codex's model; (5) decision governance — per-seam threshold pairs tied to action risk, owner precision floor, zero-wrong-sibling gate, score+evidence logging, thresholds as owned artifacts. LLM adjudication of the review band is an optional later tier; clustering only after pairwise metrics exist; CRM Accounts stay out of scope.

## 5. Owner questions (carried from the Claude doc, still open)

1. Precision floor for fully-automatic decisions.
2. Acceptable review-queue volume per search/cycle.
3. ROR as canonical namespace for research-institution identity (distinct from CRM Accounts).
4. Benchmark investment level (falsification suite now, representative 1–2k suite when?).
