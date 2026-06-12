# Reviewer-Finder Origination — Production-Data Evidence (J26 cohort)

> **Status:** Evidence + decision record, 2026-06-12 (Session 244). Built from a
> read-only review of **persisted production data** for the six J26 research
> requests, three live grounded-origination probes, and one prod prompt change
> (seniority relaxation, shipped). Written to be reviewed against the *prior*
> reviewer-finder origination direction (§12 grounded-multilane rebuild) it
> partially **contradicts** — see `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12,
> `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`, `docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`,
> and memories `project-reviewer-origination-multilane`, `project-reviewer-finder-retrieval-redesign`.
> Claims are labelled `[DATA]` (from the persisted DB / a probe), `[INFERENCE]`,
> or `[CONFOUND]`.

## 0. Bottom line

The J26 production outcome data contradicts the core premise of the reviewer-finder
**redesign** (§12: "Claude origination is the disease; demote it and ground
candidate origination in retrieval"). On the only metric that matters — **who got
saved and used as a reviewer** — Claude-led origination + PubMed verification is the
effective mechanism, and the keyword-retrieval "Track B" the redesign was reacting
against contributed **zero** used reviewers across all six proposals.

This is a **course correction back toward the original architecture**, now with an
evidence base it never had, a correct relocation of the real gaps, and a cheaper
roadmap than the rebuild.

## 1. The data `[DATA]`

Per-request saved `wmkf_appreviewersuggestion` rows, tagged by `wmkf_sources` (the
origination/verification provenance written at search time). "claude-tagged" = the
`claude` token present; "scholarly-only" = a database source (`pubmed`/`arxiv`/…)
present **without** `claude`; "other" = `manual` / `unknown` / untagged.

| Request | Field | saved | claude-tagged | scholarly-only | other | Accepted reviewers (tag) |
|---|---|---|---|---|---|---|
| 1002279 | reactive-S chemistry | 17 | 14 | **0** | 3 | Kalyanaraman, Chang, Xian (all `claude,pubmed`) |
| 1002204 | RNA thermosensors | 13 | 11 | **0** | 2 | Capel, Chiu (`claude,pubmed`); Heyd (`unknown`) |
| 1002379 | ML/automated synthesis | 21 | 14 | **0** | 7 | Todd, Aspuru-Guzik (`claude,pubmed`); Newhouse, Natelson (`unknown`); Tropsha (`manual`) |
| 1002365 | microbial nutrient-sharing | 17 | 16 | **0** | 1 | Breitbart, Nadell, Cordero (all `claude,pubmed`) |
| 1002108 | behavioral ecology | 17 | 14 | **0** | 3 | Westneat, Rubenstein, Sheldon (all `claude,pubmed`) |
| 1002238 | fungal/biofilm | 17 | 15 | **0** | 2 | Glass, Adamatzky (`claude,pubmed`); Gladfelter (`unknown`) |

**Two robust observations:**
1. **`scholarly-only` saved = 0 in every proposal.** Track-B keyword→author
   discovery — which the probe's "disease metric" reports as 96–100% of *surfaced*
   candidates — contributed **0** to the *saved* pool. It is surfaced volume with
   no saved value, six for six.
2. **~15 of ~20 accepted reviewers were `claude`-tagged.** The non-Claude accepted
   tail is 4 `unknown` (Heyd, Newhouse, Natelson, Gladfelter) + 1 `manual` (Tropsha).

## 2. Supporting probes `[DATA]`

- **Seniority relaxation (shipped, commit `13800e3` + prod Dataverse reseed).** The
  `analyze` prompt's "DE-PRIORITIZE field founders, Nobel laureates, emeritus, very-
  senior figures" line was relaxed. A confirmation run on 1002279 surfaced **Jon
  Fukuto (#3)** + other eminent figures (Gladwin, Mootha) absent before the change.
- **Broad-facet aggregation recovers the genuine tail.** For 1002204, the non-Claude
  accepted reviewer **Florian Heyd** (`unknown`) is **not** recoverable by the
  probe's narrow facets ("thermosensitive alternative splicing intron retention
  temperature" → **1 work**). A *broad* facet "temperature-dependent alternative
  splicing" → **corpus 166**, with **Heyd at #2**. So OpenAlex topic→author
  aggregation can recover the tail **iff** the facet is well-formed — but facet
  wording is delicate (sibling phrasings pulled TRP-channel thermosensation and
  Drosophila-circadian clusters instead).

## 3. The instrument error that produced the prior (wrong) conclusions `[INFERENCE]`

During this session I drew, then had to retract, several probe-based conclusions.
They are preserved in the session commits/transcript; the corrections matter:

| Intermediate conclusion (probe-based) | Correction (DB-based) |
|---|---|
| "Downweight aggregation — it's noise in both regimes" | Aggregation is noisy **with narrow facets**; a broad facet recovers the real tail (Heyd). |
| "Claude misses a recall tail: Kalyanaraman, Nadell, Breitbart" | **Wrong.** All three are `claude,pubmed` in the DB — Claude surfaced them; the probe missed them to sampling variance. |
| "Nadell/Breitbart came from Track-B keyword discovery" | **Wrong.** Both `claude,pubmed` (Track-A). |

**Root cause:** the probe runs a **single `analyze` draw** (Track-A only, temp 0.3,
reviewerCount 12), against my **reconstruction** of the J26 documents, and reports a
**surfaced-volume** disease metric. None of that measures the production *outcome*.
A multi-draw test confirmed the variance directly (union grew 12 → 17 → 21 across 3
draws). The persisted DB is the correct instrument; probe re-runs are not.

**The §12 premise inherited the same flaw:** it rests on "~92–98% of candidates
originate from keyword reconstruction = the disease." That is a *surfaced-volume*
metric. The *saved-value* metric is the inverse (Claude-dominated, Track-B = 0). The
redesign optimized against the wrong number.

## 4. What is robust vs. confounded

**Robust `[DATA]`:** `scholarly-only saved = 0` across 6 proposals; Claude-tag
dominance of the saved/accepted set; broad-facet Heyd recovery; Track-A sampling
variance.

**Confounds `[CONFOUND]` (do not over-read):**
- These are the user's **own picks made *with* the Claude-based tool** → Claude-
  favoring bias. Mitigant: the user curated hard (saved ~13–21 of ~100+ surfaced,
  accepted ~3) and added non-Claude reviewers where needed — so not pure circularity,
  but not a clean controlled comparison either.
- **J26-era source tagging.** The `claude`/`pubmed` convention is read from the code
  *as it was* at search time; current code tags differently (provenance-kind based).
  A candidate Claude suggested *and* Track-B also found could merge to `claude,pubmed`
  — so `claude,pubmed` proves **Claude involvement**, and most likely Track-A
  origination, but the precise Track-A-vs-merge split is not certain from the tag alone.
- N = 6 proposals, all research-track, one cohort, one user.

## 5. Corrected direction

**Keep (it works):** Claude-led origination via `analyze`; PubMed verification (every
`claude` accepted reviewer is `claude,pubmed`); identity/abstain-or-confirm safety.

**Fix (cheap, targeted):**
1. **Cure the recall-sampling gap** — request more candidates and/or multiple draws;
   the per-run undersampling, not a missing lane, is what loses real people.
2. **Referral capture** (`add suggested candidate`) for the human/referral tail —
   already endorsed (`project-reviewer-referral-capture`).
3. **Broad-facet topic→author aggregation as a *tail* augment only** — gated on the
   facet-quality work (the `field-review → search-queries` chain in
   `REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`), not as an origination replacement.
4. **Cost** — migrate metrics/lit-search off the flat SerpAPI sub to free academic
   APIs (`project-serpapi-capability-erosion`).

**Sunset / demote from the prior plan:** the §12 grounded-multilane rebuild **as the
primary origination direction**, and the Track-B keyword-discovery flood (0 saved
value, all latency/noise cost). The prompt-decomposition + staff one-pager survive,
reframed as **search-basis + legibility** improvements layered on Claude, not as a
replacement for it.

## 6. For Codex — review frame

Two passes requested:
- **(a) On its own:** is §1–§5 sound? Scrutinize the §1 inference that `scholarly-only
  = 0` ⇒ "Track-B contributes no saved value" (is the source-tag semantics read
  correctly — confirm against `lib/utils/reviewer-provenance.js` `saveSourceListForCandidate`
  / `normalizeSource` and how J26-era code tagged sources); and the §5 claim that the
  fix is sampling + tail-augment, not a rebuild.
- **(b) Against the tail of prior conclusions:** read the §12 direction
  (`REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12,
  `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`, the multilane/retrieval memories) and
  this session's commit trail, and judge whether **this** conclusion is robust or is
  itself another over-correction by an author who reversed repeatedly. Specifically:
  given the §4 confounds, is "Claude-led is what works" actually warranted by the data,
  or is it swinging too far back? What additional evidence would falsify it?
