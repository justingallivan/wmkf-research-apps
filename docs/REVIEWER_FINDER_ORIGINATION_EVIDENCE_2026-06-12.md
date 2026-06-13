# Reviewer-Finder Origination — Production-Data Evidence (J26 cohort)

> **Status:** Evidence record, 2026-06-12 (Session 244). **v2** — folds in a Codex
> adversarial review that found v1 OVERSTATED on both passes (strawmanned §12,
> over-read the saved-tag data, treated a confound as neutralized). This version
> states the *narrow* warranted conclusion and the falsifiers that must run before
> any direction change. Built from a read-only review of persisted production data
> for the six J26 research requests + three grounded-origination probes + one prod
> prompt change (seniority relaxation, shipped). Read against the prior direction it
> **informs but does not refute**: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12,
> `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`, `docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`,
> memories `project-reviewer-origination-multilane`, `project-reviewer-finder-retrieval-redesign`.
> Labels: `[DATA]`, `[INFERENCE]`, `[CONFOUND]`, `[CORRECTED]` (a v1 claim retracted).

## 0. Bottom line (narrow, warranted)

The J26 saved-reviewer data establishes exactly two things:
1. `[DATA]` **No pure-Track-B-only saved reviewers** in any of the six proposals
   (`scholarly-only saved = 0`).
2. `[DATA]` **Strong Claude involvement** in the saved/accepted set — but observed
   **under a Claude-present workflow**, so it shows what survives *with* Claude in
   the loop, **not** that Claude origination is causally superior.

It does **not** support the stronger claims v1 made: it does not refute §12 (which
attacks a *mechanism*, not Claude — see §4), does not prove Track-B contributes zero
value (the tag can mask merged Track-B evidence — §1), and does not discharge the
shadow-run prerequisite the redesign plan already requires before any cutover. The
warranted move is to **run three cheap falsifiers before changing direction** (§6),
while shipping the direction-independent improvements that don't depend on the
outcome.

## 1. The data `[DATA]`

Per-request saved `wmkf_appreviewersuggestion` rows tagged by `wmkf_sources`.
"claude-tagged" = `claude` token present; "scholarly-only" = a database source
(`pubmed`/`arxiv`/…) **without** `claude`; "other" = `manual`/`unknown`/untagged.

| Request | Field | saved | claude-tagged | scholarly-only | other | Accepted (tag) |
|---|---|---|---|---|---|---|
| 1002279 | reactive-S chemistry | 17 | 14 | **0** | 3 | Kalyanaraman, Chang, Xian (`claude,pubmed`) |
| 1002204 | RNA thermosensors | 13 | 11 | **0** | 2 | Capel, Chiu (`claude,pubmed`); Heyd (`unknown`) |
| 1002379 | ML/automated synthesis | 21 | 14 | **0** | 7 | Todd, Aspuru-Guzik (`claude,pubmed`); Newhouse, Natelson (`unknown`); Tropsha (`manual`) |
| 1002365 | microbial nutrient-sharing | 17 | 16 | **0** | 1 | Breitbart, Nadell, Cordero (`claude,pubmed`) |
| 1002108 | behavioral ecology | 17 | 14 | **0** | 3 | Westneat, Rubenstein, Sheldon (`claude,pubmed`) |
| 1002238 | fungal/biofilm | 17 | 15 | **0** | 2 | Glass, Adamatzky (`claude,pubmed`); Gladfelter (`unknown`) |

**What this licenses — and what it does not:**
- ✅ `scholarly-only saved = 0` ⇒ **no *pure* Track-B-only saved rows**, six for six.
- ❌ `[CORRECTED]` It does **not** show "Track-B contributed zero saved value." A
  Track-B discovered author who shares an ORCID with a Track-A row is **merged into
  that row with `isClaudeSuggestion: true` and `sources` unioned**
  (`lib/services/discovery-service.js:1056-1070`, verified). So a `claude,pubmed`
  tag can carry **folded-in Track-B corroboration** — the tag proves *Claude
  involvement*, not *Claude-only origination*.
- ⚠️ `[CONFOUND]` These J26 rows were written by the code **as it was at search
  time**; current source-tagging differs (`lib/utils/reviewer-provenance.js`
  `saveSourceListForCandidate`/`normalizeSource` do not even emit `claude`). The
  tag is read historically.

The accepted-tag split (≈15 of 20 `claude`, 4 `unknown`, 1 `manual`) is real but
**confounded** — see §5.

## 2. Supporting probes `[DATA]`

- **Seniority relaxation — SHIPPED** (commit `13800e3` + prod Dataverse reseed). The
  `analyze` "DE-PRIORITIZE field founders/Nobel/emeritus/very-senior" line was
  relaxed; a confirmation run on 1002279 surfaced **Fukuto (#3)** + Gladwin/Mootha,
  absent before. This is direction-independent and already live.
- **Broad-facet aggregation — one data point.** For 1002204's non-Claude accepted
  reviewer **Florian Heyd** (`unknown`): the probe's narrow facet → **1 work**; a
  broad facet "temperature-dependent alternative splicing" → **corpus 166, Heyd #2**.
  Sibling phrasings pulled wrong clusters (TRP thermosensation; circadian). So broad
  facets *can* recover a tail member — **n=1**, and facet wording is delicate. This
  does **not** establish "aggregation is/ isn't a needed lane" either way.

## 3. The instrument error + the corrections it forced `[CORRECTED]`

The probe runs a **single `analyze` draw** (Track-A only, temp 0.3, count 12), over a
**reconstruction** of the J26 docs, and reports a **surfaced-volume** disease metric.
None of that measures the production *outcome*. Conclusions I drew from it this
session and then had to retract (preserved in the session commits/transcript):

| Probe-based claim (retracted) | Correction (DB / code) |
|---|---|
| "Downweight aggregation — noise in both regimes" | Aggregation is noisy with *narrow* facets; a broad facet recovered Heyd (n=1). |
| "Claude misses a recall tail: Kalyanaraman, Nadell, Breitbart" | All three are `claude`-tagged in the DB; the probe missed them to **sampling variance** (multi-draw union grew 12→17→21). |
| "Nadell/Breitbart came from Track-B" | `claude,pubmed` — Claude-involved (Track-A origination or merged corroboration, §1). |

**Lesson:** the persisted DB is the instrument for the recall question; probe re-runs
are not.

## 4. What §12 actually says (v1 strawmanned it) `[CORRECTED]`

§12 (`docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md:238-298`) does **not**
say "Claude origination is the disease, replace it." It says:
- the defect is the **mechanism** — paper-match + 1-author minting — **"not the use
  of LLM keywords"**;
- run **every lane** the proposal enables; coverage = union;
- the production **Track-A (Claude suggests names) is explicitly OUT OF SCOPE for §12
  until grounded coverage is proven.**

So the J26 data is **consistent with §12's own caution** (don't demote Track-A before
grounded coverage is proven). It does not refute §12; v1's "the data contradicts the
redesign premise" was attacking a position §12 doesn't hold.

## 5. The confound is a blocker on the causal claim `[CONFOUND]`

The accepted set was curated **inside a Claude-present workflow** (staff saw Claude's
candidates + Claude-written "why this reviewer" blurbs). It therefore validates *what
survives with Claude in the loop* — it **cannot** show Claude wins **source-blinded**
or Claude-absent. Mitigants (hard curation; non-Claude additions like Heyd/Newhouse)
soften but do not neutralize this; it is **fatal to any causal "Claude-led is what
works" claim.** The `analyze` prompt is also not clean parametric origination — it
prioritizes proposal-named people, reference authors, *and* known leaders
(`shared/config/prompts/reviewer-finder.js:81-84`), mixing grounded and parametric
cues in one black box.

## 6. Corrected direction

**Do NOT** (v1 errors): declare Claude causally superior; sunset the grounded /
multilane direction; treat "back to where we started" as established.

**Keep the synthesis the S239 memory already held**
(`project-reviewer-origination-multilane`): **Claude Track-A is a productive
cold-start lane; keep it while testing grounded lanes for coverage / tail recovery /
source-blinded quality.** Do not demote Track-A before grounded coverage is proven
(also the retrieval memory's sequencing rule —
`project-reviewer-finder-retrieval-redesign`, PubMed-blind fields).

**Run these three falsifiers before any direction change (all cheap vs a rebuild):**
1. **Source-blinded shadow run** — staff choose among Claude-led-verified vs
   grounded-lane candidates with sources hidden. If grounded lanes match/beat on
   accepted/referral outcomes, the "Claude-led is what works" lean fails. (Already a
   redesign-plan prerequisite — `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md:652-656`.)
2. **J26 replay through grounded lanes** — do non-Claude lanes recover the accepted
   `claude,pubmed` reviewers *before* seeing Claude names? If yes, the tag was masking
   alternate origination (§1 merge path).
3. **Multi-draw + broad-facet on a J26 mini-harness** — if more draws still miss
   accepted/referral-quality tail members that broad-facet/PI-trail lanes recover,
   then "undersampling, not a missing lane" is falsified. (No golden-set harness
   exists today — `docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md:164-175` — but a
   J26-anchored mini-harness is ~1 session.)

**Ship now — direction-INDEPENDENT (do not wait on the above):**
- Seniority relaxation (done).
- **Recall sampling**: bump `analyze` candidate count / multiple draws — the
  multi-draw variance (12→17→21) shows real people are lost to undersampling
  regardless of which origination direction wins.
  **[S248 refinement → S249 SHIPPED — supersedes the "multiple draws" half of this
  rec]** S248 tested re-drawing and found Claude is *consistent* at temp 0.3 (extra
  draws return the same head, a wasted call), so the lever is a **single deeper draw**,
  not multiple draws; the default candidate count was raised **12→15 (S249)**. See
  `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` §2 for the current statement.
- **Referral capture** (`project-reviewer-referral-capture`) for the `unknown` tail.
- **SerpAPI → free-stack cost migration** (`project-serpapi-capability-erosion`).
- **Prompt-decomposition + staff one-pager** — as a search-basis + legibility
  improvement layered on whatever origination wins.

## 7. For Codex — strong adversarial review (v2)

Try hard to break this version. Specifically: (1) is the §1 "no pure-Track-B saved"
claim now correctly bounded, or still over-read (e.g. does the merge path or the
J26-era tagging admit *other* masking I haven't named)? (2) Is §6's "keep Track-A +
run three falsifiers" itself a hedge that dodges a decision the data already forces?
(3) Are the three falsifiers actually decisive, or could each pass/fail without
resolving the real question? (4) Does anything here still smuggle in a causal claim
the §5 confound forbids? (5) Is there a cheaper or more decisive falsifier than the
three listed? Cite file:line / quote docs; end with SOUND / OVERSTATED / UNSUPPORTED.
