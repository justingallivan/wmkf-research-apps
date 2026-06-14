# Reviewer Finder — Prompt Decomposition & Grounded Field-Review Design

> **Status:** DESIGN, pre-implementation (2026-06-11, Session 244). For Codex
> pre-impl review before any code. Captures the Justin↔Claude design session that
> decomposes the monolithic `reviewer-finder.analyze` prompt into a chain of
> task-specific prompts and adds a grounded, staff-facing one-page field review.
> Claims are labelled `[VERIFIED via source]`, `[PROPOSED]`, or `[OPEN]`.
> Sibling/parent docs: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md`
> (§12 — the validated multilane origination direction), `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
> (S231 retrieval-first direction), `docs/EXECUTOR_CONTRACT.md` /
> `docs/PROMPT_STORAGE_DESIGN.md` (prompt storage). This doc is the **upstream /
> prompt-shape** layer; §12 remains the lane-architecture authority.

## 1. Problem

`[VERIFIED via source — PART 3 since REMOVED S253, see note]` Reviewer-finder today runs **one**
Dataverse prompt, `reviewer-finder.analyze`, that conflates multiple cognitive jobs in one
call: (PART 1) extract proposal metadata and (PART 2) **name reviewers** from parametric memory.
_(PART 3 — **generate keyword search queries** — was REMOVED S253: it only fed Track B, archived
off S248. The decomposition proposed below now applies to the surviving PART 1/PART 2 only.)_ A second prompt, `reviewer-finder.score-candidates`,
writes reasoning over already-discovered candidates. (Resolver:
`lib/services/reviewer-prompt-resolver.js`; composer
`lib/services/reviewer-prompt-composer.js`; call path
`pages/api/reviewer-finder/analyze.js` → `lib/services/claude-reviewer-service.js`
→ `LLMClient.complete`; parse `shared/config/prompts/reviewer-finder.js`.)

`[VERIFIED via probe — SPARSE_ANCHOR §12.1]` ~92–98% of candidates originate from
**Track-B keyword-reconstruction**: Claude emits narrow keyword queries → each
source (PubMed/arXiv/bioRxiv/chemRxiv) returns papers → the pipeline **mints the
last author of each paper** as a candidate (`lib/services/discovery-service.js`
~L1158-1180). Pure hallucination is ~0 — these are *real people surfaced by the
wrong question*.

**The diagnosis from the design session:** we have invested heavily in the
**downstream** half of the pipeline (identity resolution via the OpenAlex/ORCID
spine, COI gates, recency ranking, verification) and very little in the
**upstream** half — *reading the proposal to form a good search basis*. §12.7
records the symptom: Claude's 5-word MeSH-style queries are too narrow, yielding
OpenAlex corpora of 0–20. A weak basis starves a strong downstream.

## 2. Design principle

**Separate the cognitive tasks, and ground anything that names people or papers.**

The monolith is split because extraction, comprehension, and query-generation are
genuinely different jobs (different abstention behavior, temperature, and even
model tier). And the new role for the LLM, per §12, is: **Claude plans queries and
synthesizes over retrieved real people — it never mints names.**

That yields **two** new Claude roles, both concrete:

- **Query-planner (upstream):** read the proposal → evaluate the field ("why
  now?") → emit targeted searches. Pre-retrieval.
- **Synthesizer (downstream):** assemble a one-page, staff-facing field review
  whose *leaders / key papers / activity level are pulled from retrieval results,
  never from parametric memory*. Post-retrieval.

## 3. The prompt chain `[PROPOSED]`

Justin's mental model — **(1) read → (2) write a mini-review evaluating the field
→ (3) use that to start queries** — maps to three upstream prompts plus a fourth
downstream synthesis prompt.

### 3.1 `reviewer-finder.extract-anchors` — read for *evidence* (extraction)
- **Input:** proposal text.
- **Output (structured):**
  - `identifiers`: inline DOIs / PMIDs / arXiv IDs / paper URLs, each with its
    proposal span → seeds the cited-reference lane.
  - `named_entities`: peer-groups, named people/labs —
    `{ name_text, institution_hint?, context, span }` → **anchors to *resolve*,
    never candidates** (a surname is not a person; see §7 of the anchor strategy).
  - `applicant_framing`: what the PI claims about prior work / the field's key
    players.
- **Behavior:** pure extraction, **abstain when unsure**; invent nothing.

### 3.2 `reviewer-finder.field-review` — the *mini-review* (comprehension; the centerpiece)
- **Input:** proposal text **+ the PI's recent works** (the structured ORCID
  trail: `akoya_request._wmkf_projectleader_value` → `contact.wmkf_orcid` → the
  ORCID record's self-asserted works list, per SPARSE_ANCHOR §12.2–§12.3). One
  fetch, two consumers — the same corpus the future PI-trail lane uses.
- **Output (prose + structured tail):**
  - the **field mini-review** narrative (human-legible — see §4 for the
    staff-facing one-pager this becomes).
  - `novelty_basis` (the **"why now?"** verdict — Keck's core evaluative lens):
    `{ type: enabling_technique | new_hypothesis | incremental,
       what: "...", departure_from_pi_corpus: low | moderate | high }`.
  - `reviewer_sourcing_strategy`: the neighborhoods to search — derived from the
    why-now verdict (see §3.5).
  - `ideal_reviewer_profile`: the expertise a strong reviewer must have.
- **Boundary:** this is a **field-and-experts** assessment to drive *reviewer
  sourcing*, **not** a merit review of the proposal. It reports the *degree* of
  departure relative to the corpus with evidence; it never certifies originality.

### 3.3 `reviewer-finder.search-queries` — *form the basis of the searches* (generation)
- **Input:** §3.2's structured tail (NOT the raw proposal again — chained, so it
  reasons over a clean characterization). May also consume §3.1 `named_entities`
  to bias queries toward named neighborhoods.
- **Output:**
  - `aggregation_facets`: deliberately **broad / atomic** OpenAlex queries (the
    §12.7 fix) for topic→author aggregation.
  - `database_queries`: per-source (`pubmed` / `arxiv` / `biorxiv` / `chemrxiv`),
    each tagged with breadth + which facet it serves.

### 3.4 `reviewer-finder.synthesize-review` — the grounded one-pager (synthesis; downstream)
See §4. Runs **after** retrieval; grounds leaders/papers/activity in real results.

### 3.5 Why-now → sourcing strategy (the payoff)
The why-now verdict is not just evaluation — it is a **retrieval-routing signal**:
- **enabling_technique** ("possible now because of advances in X") → search the
  **technique** neighborhood *and* the **target domain** — two neighborhoods,
  typically more independent of the PI than the home subfield (better COI posture).
- **new_hypothesis** → search the people who can judge the *conceptual leap* and
  *proposed tests* — bridged/adjacent fields, not incumbents.
- **incremental** (the disfavored case) → the natural reviewers *are* the PI's
  established crowd; surfacing "this reads as incremental" is itself a signal
  staff want before spending reviewer effort.

## 4. The staff-facing one-page field review `[PROPOSED]`

A one-page briefing per request. **Grounding rule: anything that names a person, a
paper, or a quantity comes from retrieval, never from the model.** Otherwise the
hallucinated-names disease simply relocates into prose.

| One-pager element | Grounded source (NOT parametric) |
|---|---|
| Field overview + **why-now** narrative | upstream `field-review` (§3.2) — written from proposal + PI corpus; the one genuinely model-authored part |
| Is the field active? (volume **+ trend**) | facet→corpus-size counts (the same metric as the §6 eval), recency-weighted → hot vs. mature |
| Who are the leaders? | topic→author-aggregation output (frequency × recency) — **resolved real authors** |
| Key papers | the actual high-value **resolved** works (most-aggregated / most-cited), with real DOIs |

**Consequences worth noting:**
- **"Leaders" and the reviewer-candidate list are the same grounded data, shown
  two ways** — so they cannot drift.
- Some leaders are **COI-conflicted** (the PI's own collaborators). They still
  belong in the *field overview* as prominent, flagged "not eligible —
  collaborator." Staff see the whole landscape, including who is conflicted out.
- **Coverage/confidence line** (optional but recommended): "rich corpus + clean PI
  ORCID" vs "thin signal — no references, no ORCID." Tells staff how far to trust
  the page and which proposals need a human deep-dive.

## 5. Integration seams + what stays untouched `[VERIFIED via source]`

This swaps the **front** of the pipeline (proposal → query basis) and **adds** a
synthesis artifact. It does **not** touch the downstream contracts.

- **New prompt rows** in Dataverse `wmkf_ai_prompt` (`reviewer-finder.extract-anchors`,
  `.field-review`, `.search-queries`, `.synthesize-review`), resolved through the
  existing `reviewer-prompt-resolver.js` (per-user override → Dataverse `iscurrent`
  → code fallback) and composed with the **code-owned A7 untrusted-content
  preamble** (`reviewer-prompt-composer.js`; never in the editable body). Admin
  versioned-publish editor + per-user overrides (shipped S222) extend to the new
  rows for free.
- **Swap-in point:** the query half of `analyze.js` /
  `claude-reviewer-service.analyzeProposal` is replaced by the §3.1–§3.3 chain;
  `discovery-service.js` Track-B retrieval consumes the new `database_queries`
  (and, when the aggregation lane lands, `aggregation_facets`).
- **Untouched:** Track-B retrieval/minting mechanics, the OpenAlex/ORCID identity
  spine, `lib/utils/reviewer-provenance.js`, the `save-candidates.js` force-null
  gate for unresolved rows, COI gates, recency ranking, and the Workbench UI
  selection model. Better inputs flow into the proven machinery.
- **The probes are diagnostics, not a pipeline** — building this means adding the
  ORCID-trail fetch and (later) aggregation calls *into* `openalex-service.js` /
  `orcid-service.js`, never porting probe `fetch`es.

## 6. Evaluation `[PROPOSED]`

The upstream outputs are checkable *without* waiting on reviewer quality — a cheap
front-of-pipeline eval runnable on real D26 proposals this week:
- **anchor-recall:** did `extract-anchors` capture the DOIs / named peers actually
  present in the proposal text?
- **facet→corpus-size:** does each `aggregation_facet` / query return a non-trivial
  corpus (not 0–20)? This is both the §12.7 quality bar and the one-pager's
  "is the field active?" number.
- Reviewer-finder has **no eval/golden-set harness today** (only structural
  `validateReviewerAnalysis()` + a one-off `scripts/validate-reviewer-analyze.mjs`).
  A small golden set of real requests + these two metrics is the proposed harness.

## 7. D26 scope (next ~week) vs. follow-on

- **Now (D26):** decompose `analyze` into the §3.1–§3.3 chain; ship the grounded
  one-pager (§4) as a **synthesis over the *current* Track-B retrieval** (which
  already pulls papers + authors) + the facet→corpus eval. This is additive
  upstream improvement, low blast-radius; downstream untouched.
- **Follow-on (post-D26, per SPARSE_ANCHOR §12):** the grounded lanes proper
  (PI-trail as a first-class candidate source, real topic→author-aggregation,
  peer-group parsing), identity-equality corroboration, and the two net-new COI
  gates (advisor/advisee, all-time-collaborator). The one-pager's sections get
  sharper as each lane lands under them; the page itself is the durable artifact.

## 8. Open questions / decisions still owed `[OPEN]`

1. **Chaining/caching shape:** run §3.1 ‖ §3.2 off a single cached proposal prefix
   (Executor `<<<CACHE_BOUNDARY>>>`), §3.2 → §3.3? Confirm the cache-boundary
   mechanics work across separate `wmkf_ai_prompt` rows in the SSE path (which
   does *not* use `executePrompt`).
2. **One call vs. several:** four prompts means four LLM calls. Is the legibility /
   independent-iterability worth the latency + token cost vs. a 2-call merge
   (e.g. extract+field-review together)? Latency is the live limiter for the
   enrichment fan-out elsewhere.
3. **ORCID-trail failure contract for `field-review`:** when the PI has no ORCID or
   it yields zero recent DOI-bearing works, the mini-review degrades to
   proposal-only "why-now" (no corpus baseline). Confirm that's acceptable and how
   the one-pager flags reduced confidence.
4. **Model-cutoff vs. newest enabling technique:** mitigated by mining the
   proposal's own "why now" claims rather than parametric recall — sufficient?
5. **Where the one-pager lives:** transient route state, a persisted artifact, or a
   reusable proposal-context record (anchor-strategy §11 Q1)?

## 9. For Codex — review frame

Two questions for this **design** pass (no code yet):
1. **High-level completeness:** are we missing anything at the architecture level —
   a task that should be its own prompt, a seam we'd break, a failure mode of the
   grounded-synthesis approach, a piece of the one-pager that can't actually be
   grounded as claimed?
2. **Soundness of what is written:** is the reasoning in §2–§5 sound — particularly
   the upstream-framing vs. grounded-synthesis split (§4), the why-now→sourcing
   mapping (§3.5), and the claim that this is low-blast-radius because it only
   swaps the front of the pipeline (§5)?
