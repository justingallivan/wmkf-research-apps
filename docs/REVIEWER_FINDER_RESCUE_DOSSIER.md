# Reviewer Finder — Rescue Dossier (fresh-eyes brief)

> **Why this document exists.** We (the operator + Claude + Codex) have iterated on the
> reviewer-finder for many sessions and we are worried we are **running in circles** —
> repeatedly patching the verification/disposition/ranking layer while the underlying
> behavior doesn't reliably improve. This brief hands a *fresh* model the problem, the
> objective, the as-built architecture, and an **honest account of every strategy we've
> tried and how it fell short**, with code references.
>
> **What we want from you, in order:**
> 1. **Challenge the framing first, code second.** Is our problem definition right? Is the
>    two-stage "LLM-generates-candidates → verify" architecture the wrong frame? Are we
>    over-building precision machinery for a problem whose real need is *recall + spread*?
> 2. Then look at the code and tell us where the architecture and the goal diverge.
> 3. Tell us if there's a materially simpler approach we've talked ourselves out of.
>
> Deep design history + the current plan live in
> `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (one consolidated doc: Part A retrieval-first
> plan, Part B field primer, Part C the S238 discussion incl. §8f, the most recent finding).
> This dossier is the orientation layer; that doc is the depth.

---

## 1. What the system is for, and what "good" means

The Reviewer Finder helps foundation staff assemble an **initial slate of external peer
reviewers** for a science/medical research grant proposal. The reviewers should know the
field's **big questions** *and* judge whether the **methods/techniques** are sound — usually
**two different communities**.

Operator-supplied truths that should anchor the design (these reframe "good"):

- **The slate is a toe-hold, not an answer.** It gets staff from 0 → ~75%. Many invited
  reviewers decline but **suggest alternatives**; staff iterate (a referral / snowball search).
  The system owns the cold-start; humans + referrals own convergence. **Invest proportionally.**
- **Recall over precision.** A 10-year retrospective found **≈no correlation between reviewer
  ratings and funded-project success** (selection-biased, so read it narrowly): peer review
  functions as a **floor/gate** (screen out the clearly-bad), not a fine **ranker**. So the
  product goal is **coverage/spread across the relevant competent sub-communities**, not
  precise ranking of individual fit.
- **Collective spread is the non-relaxable property; per-person precision is relaxable.**
  Snowball sampling stays in the seed's neighborhood, so a *collapsed* seed is entrenched by
  iteration, not fixed. The danger is **false negatives** (a sub-community never surfaced —
  unrecoverable) far more than false positives (a weak reviewer — discounted by staff).
- **COI is surface-not-gate, except permanent policy conflicts.** Reviewers *over*-recuse, so
  system over-exclusion is the expensive error. Hard-exclude only obvious policy conflicts
  (proposal authors, same institution); flag the rest for staff judgment.

**Implication:** the system's one job is to *reliably surface a well-spread set of real, active,
plausibly-relevant experts across the proposal's sub-communities, with obvious conflicts flagged.*
That is a **recall + coverage** problem. Much of what we built optimizes **precision** (identity
verification, fine ranking, COI grading) — possibly the wrong thing to have invested in.

---

## 2. The architecture as built (with references)

A two-stage pipeline. Streaming SSE route orchestrates service calls.

**Stage 1 — Analyze (one overloaded Claude call).**
`pages/api/reviewer-finder/analyze.js` → `ClaudeReviewerService.analyzeProposal`
(`lib/services/claude-reviewer-service.js`) using the prompt in
`shared/config/prompts/reviewer-finder.js` (`createAnalysisPrompt`). The **single** call emits
three things at once: PART 1 proposal metadata, PART 2 **reviewer-name suggestions** (from
Claude's parametric memory), PART 3 **database search queries** (3–6 words, "methods/organisms/
phenomena/systems"). Input is **one** proposal document (selected by
`pages/api/reviewer-finder/load-proposal.js` via a classifier; the full narrative is read, not
the reference list separately).

**Stage 2 — Discover.**
`pages/api/reviewer-finder/discover.js` → `DiscoveryService.discover`
(`lib/services/discovery-service.js`). Two lanes:
- **Track A** — verify Claude's suggested names against PubMed, or (non-biomedical) the
  OpenAlex/ORCID "spine" (`discovery-service.js` verify path ~`:466`+; field-aware routing shipped S236).
- **Track B** — keyword discovery: run the PART-3 queries against PubMed/arXiv/bioRxiv/chemRxiv
  (`searchPubMed`/`searchArXiv`/… ~`:1149`+), take **one author position per returned paper**
  (PubMed/arXiv = last author; bioRxiv/chemRxiv = corresponding/first), mint a candidate with that
  single paper as its `publications[]`.

**Cross-cutting:** identity resolution (`lib/services/reviewer-identity-resolver.js` +
`resolveTrackBIdentities`, capped at 25/run), recency-weighted ranking
(`lib/utils/relevance-score.js`; h-index/citations deliberately excluded from sort), dedup +
COI (`lib/services/deduplication-service.js`), a provenance model
(`lib/utils/reviewer-provenance.js`), and persistence (`pages/api/reviewer-finder/save-candidates.js`).

---

## 3. The core problem (what's actually wrong)

**Recall is fragile and non-deterministic, and the origination layer is the cause.**

Run the same request twice and you get **substantially different reviewers**. Measured (S238,
request 1002794, physics) with `scripts/smoke-discover-dispositions.mjs`: across a production run
and two fresh runs, the surfaced expert set varied widely; in one fresh run only ~4 of a prior
run's 15 clean experts re-appeared on a clean slate, several were undercounted into a buried
"weak tail," and ~3 didn't appear at all. The good slate, when it happens, leans on **Claude's
parametric suggestions** (Track A) — which vary every run because Claude names different people at
temperature — not on reliable retrieval.

The single sharpest illustration (**§8f** in the plan doc): **Olga Smirnova (h-index 61) surfaced
flagged "2 publications," ranked 28th.** Reconciliation: a Track-B candidate's publication count is
**keyword-search-hit concentration**, not the author's corpus. With ~3 queries × top-50 papers ×
one-author-per-paper, in a busy field those ~150 author-instances are mostly *distinct people* — so
almost everyone has count ≈1, and the `MIN_PUBLICATIONS≥3` "active researcher" bar mostly measures
how concentrated the query results are around a person. It **buries real leaders** and the few it
passes are senior-/prolific-lab authors. (Codex-adjudicated against source, S238.)

---

## 4. Strategies we've tried, and how each fell short

Roughly chronological. The pattern to notice is at the end.

1. **LLM as candidate *generator* (the original, still-live Stage-1 design).** Claude names
   reviewers from parametric memory. **Failure mode:** stale (training cutoff), senior-biased
   (founders over active mid-career), hallucination-prone (invents names/affiliations). The verify
   path then *launders* a fabricated name onto a real near-namesake. (Root-cause analysis: plan §1–§2.)

2. **Prompt-tuning the generator for COI/recency (S229).** Tried to fix seniority bias and COI
   bleed in the analyze prompt. **Failure mode:** patched symptoms; generation itself stayed
   stale/biased. Concluded the *cause is generation*, not the prompt wording.

3. **Web discovery via Perplexity (S225–S227).** Let a web agent propose reviewers.
   **ABANDONED S230** — verified hallucination of reviewers *and* affiliations; ungrounded.
   (`.claude-memory/project-reviewer-web-discovery-abandoned.md`.)

4. **Retrieval-first redesign (designed S231).** The principled fix: demote Claude to query-planner
   + synthesizer; candidates *originate* from grounded retrieval (field-routed fan-out → mosaic →
   adjudicate → rank). **Status: largely NOT built.** Only verify-hardening (forename gate, soft
   mismatch flags, PubMed year basis; S231) and a provenance-DTO contract (S232) shipped. The
   actual retrieval inversion, hypothesis-builder, and cited-reference lane are unbuilt. (Plan §4–§7.)
   (`.claude-memory/project-reviewer-finder-retrieval-redesign.md`.)

5. **Identity resolver + field-aware verification (S232–S236).** A post-enrichment identity
   classifier (`reviewer-identity-resolver.js`) and routing non-biomedical proposals to the
   OpenAlex/ORCID spine instead of PubMed. **Real and shipped, but partial** — it improves
   *precision/safety* of candidates that already exist; it does not improve *which* candidates exist.
   The fail-dangerous namesake hazard persists in places (e.g. the initial-only coauthor-COI search;
   `.claude-memory/project-reviewer-verify-fail-dangerous.md`).

6. **S238 disposition fixes (this session): surface-don't-silently-drop.** We found the pipeline was
   silently discarding grounded candidates and fixed three: low-publication candidates surfaced as a
   warning not dropped (`partitionByPublicationBar`); off-topic candidates surfaced + ranked-last not
   dropped (`aiFlaggedNotRelevant`); coauthor COI graded `likely`/`possible` not binary
   (`gradeCoauthorCOI`). Shipped, Codex-reviewed, **live-verified**. **But these are symptom
   surfacing, not recall fixes** — and the live smokes they enabled are precisely what exposed §3/§8f.

7. **The activity-signal flaw (§8f, S238): diagnosed, fix scoped, NOT built.** See §3. A two-part
   fix is scoped in the plan (in-pipeline: re-evaluate activity from the *resolved* author's real
   corpus + widen the OpenAlex backfill, which today only runs on empty-`publications` and only sets <!-- drain-table:ignore reason=candidate-field-not-pg-table -->
   the count when not-finite; plus a cap-25 selection complication — the pre-resolution ranking that
   picks which 25 to resolve uses the *same broken signal*, so heavyweights can be deferred and never
   resolved). And a redesign-scope part: **non-origination** — a heavyweight not in the minted author
   position of any returned paper is *never a candidate at all*, which no post-resolution patch fixes.

**The pattern (our honest worry).** Items 1–3 and 5–7 mostly iterate on the layer that decides
**which candidates to keep, flag, verify, or rank** — the *disposition/precision* layer. The layer
that decides **which candidates exist at all** — *origination* (Claude's variable parametric recall
+ a noisy, senior-author-only, top-50 keyword crawl) — has barely changed. We suspect that is the
circle: we keep refining the handling of a candidate pool that is itself unreliable and incomplete.

---

## 5. What is verified vs. open

- **Verified (source + live runs + Codex adjudication):** the origination funnel mechanics (§2/§3),
  the §8f activity-signal flaw and its two root mechanisms, the run-to-run nondeterminism (empirical),
  the disposition fixes' behavior.
- **Empirical-but-run-specific:** the exact overlap counts (e.g. "4–8 of 15") — the smoke's
  overlap matcher is fuzzy name-similarity with no identity anchor, so common-name collisions
  (Chen/Lu/Wu) can misbucket. Treat the *direction* (low, variable overlap) as solid, the exact
  numbers as run-specific.
- **Asserted/architectural, NOT proven by code alone:** that the retrieval-first redesign is the
  *right* or *only* path. Codex's caution (S238): the code proves a real, fixable flaw in the
  current pipeline; it does not prove the full redesign is necessary. **This is exactly the kind of
  assumption we'd like you to pressure-test.**

---

## 6. Open questions we'd most like a fresh take on

1. **Is the architecture inverted?** Should candidates originate from retrieval (with Claude as
   planner/synthesizer), or is there a simpler reliable-recall design we're missing? Is the
   generate-then-verify frame salvageable, or a dead end?
2. **Are we over-built on precision?** Given "recall over precision / review is a floor-gate / the
   slate is a toe-hold for a referral process," how much of the identity-resolution + fine-ranking
   + COI-grading machinery is actually load-bearing vs. gold-plating the wrong axis?
3. **Reproducibility:** is non-determinism acceptable (humans iterate anyway) or a primary defect to
   engineer out (e.g. aggregate-over-seeds, deterministic retrieval)?
4. **What is the *minimum* that reliably surfaces a spread of real active experts across a
   proposal's sub-communities?** Is that meaningfully smaller than what we've built?
5. **Origination author-extraction:** taking one author position per paper is clearly lossy. What's
   the right rule (all authors? corresponding + senior? cited-reference resolution?) given COI and
   noise tradeoffs?

---

## 7. Entry points (read in this order)

1. **This dossier** — the problem + failure history.
2. `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` — the consolidated design (Part A plan,
   Part B primer, Part C the S238 discussion; **§8f** is the latest, sharpest finding + scoped fix).
3. **Origination code (the suspected root):** `shared/config/prompts/reviewer-finder.js` (PART 3
   query generation), `lib/services/discovery-service.js` (`discover`, `searchPubMed` ~`:1149`,
   `partitionByPublicationBar` ~`:274`, `resolveTrackBIdentities` ~`:294`, `backfillOpenAlexPublications`
   ~`:348`), `pages/api/reviewer-finder/discover.js` (route orchestration).
4. **Disposition/precision code:** `lib/services/reviewer-identity-resolver.js`,
   `lib/utils/relevance-score.js`, `lib/services/deduplication-service.js`.
5. **Reproducible evidence:** `scripts/smoke-discover-dispositions.mjs` (read-only; runs the real
   pipeline on a request, dumps lane attribution + disposition flags + an overlap table vs a known
   reviewer set — this is how §3/§8f were measured) and `scripts/probe-source-coverage.mjs`
   (per-field scholarly-source coverage). `.env.local` points at prod; every call is a read.
6. **Intent/lessons memory:** `.claude-memory/project-reviewer-recall-over-precision.md`,
   `project-reviewer-finder-retrieval-redesign.md`, `project-reviewer-web-discovery-abandoned.md`,
   `project-reviewer-verify-fail-dangerous.md`.

---

## 8. The one thing to hold onto

The product goal is **recall + coverage of competent sub-communities**, surfaced reliably, with
obvious conflicts flagged — as the *first move* in a human referral process. Every prior effort has
either patched candidate *handling* or tried an *ungrounded* generator. The unsolved core is
**reliable, well-spread origination of real active experts.** If our framing or our architecture is
wrong about that, please say so plainly — that is the rescue we're asking for.
