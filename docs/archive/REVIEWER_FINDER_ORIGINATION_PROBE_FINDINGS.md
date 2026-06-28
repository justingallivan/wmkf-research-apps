# Reviewer-Finder Origination Probe — Findings & Handoff

**Date:** 2026-06-10 (Session 239)
**Status:** Empirical results in. Verdict reached. No build started.
**Audience:** A fresh model asked to (a) pressure-test this verdict, and (b) if it holds, draft an implementation plan for fixing reviewer-finder *origination*.

## What this document is

In Session 238 we suspected the reviewer-finder's real problem was **origination** (how candidates first enter the system), not **disposition** (how they're verified/ranked/filtered afterward) — but that was asserted, not proven. A rescue review challenged us to test it cheaply before building the full retrieval redesign. This document reports the results of that test: a read-only probe run live against three real proposals.

**Read alongside:**
- `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md` — the problem statement + every prior strategy and how each fell short. Start there for full context.
- `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` — the canonical design (Part A plan · B field primer · C S238 discussion; **§8f** = the activity-signal flaw). The probe directly tests this plan's premises.
- `scripts/probe-grounded-origination.mjs` — the probe itself (read-only; reproducible).

**What we want from you:** challenge the framing first, the code second. Is "invert origination to a person-level query" actually the right call, or are we over-reading three runs? If it holds, what's the smallest correct build? A draft plan is welcome but a sharp critique of the verdict is more valuable than a plan built on a wrong premise.

---

## TL;DR verdict

The tool's candidate **origination** is the broken layer, and it is broken because **it never asks a data source the question we actually care about** — "who is actively publishing on this topic?" Instead it (A) asks the LLM to recall names from memory, and (B) asks a literature API "which *papers* match these keywords?" and then reverse-engineers people from those papers. Measured across three live proposals:

- **92–98% of surfaced candidates trace to a guess** (LLM-memory or keyword-crawl), not to a grounded pointer. **Domain-independent** — biomedical (PubMed's best case) was no better than physics.
- A grounded, person-level query (OpenAlex author-aggregation) **recovers unmistakable field leaders the current pipeline never surfaces at all** (e.g. Paul Corkum on an attosecond-physics proposal; Tom Muir on a chemical-biology one; Leona Samson on a DNA-repair one).
- The previously-scoped **§8f Part 1 fix is confirmed low-leverage** — it repairs a misleading number that only exists *because* origination is keyword-based. Fixing origination makes that number unnecessary.

The fix is **not free**: the probe surfaced three concrete problems any inversion must solve (facet generation, ranking, citation resolution). See "Open design questions."

---

## Background: how reviewer-finder originates candidates today

A proposal goes in; one LLM "analyze" call (`shared/config/prompts/reviewer-finder.js`, `createAnalysisPrompt`) returns three things, and the discovery service (`lib/services/discovery-service.js`) turns them into candidates via two tracks:

**Track A — LLM names people from memory (PART 2 of the prompt).**
Claude writes ~12 reviewer names with reasoning. The prompt's own priority order is: (1) people *named in the proposal*, (2) *authors of cited references*, (3) *known field leaders*. Only (1) is grounded in the document; (2) is the LLM recalling who the cited authors are (NOT resolving the actual citations — see below); (3) is pure recall from training. These names are then verified against a scholarly source where possible.

**Track B — LLM writes keyword queries; we reconstruct people from papers (PART 3 of the prompt).**
Claude generates a few keyword strings per source (PubMed / arXiv / bioRxiv / chemRxiv). Each is sent to that API, which returns *papers*. The system then takes **essentially one author per paper** (typically the senior/last author) as a candidate (`searchPubMed` etc., `discovery-service.js`). A candidate's pub-count field is therefore *how many of our keyword searches happened to hit them* — query-hit concentration, not real productivity.

Everything after that — identity resolution, COI checks, ranking, surface/drop — is **disposition**: it processes the pool the two tracks produced. If a strong reviewer is never *originated*, no disposition logic can recover them.

### The core diagnosis (the insight that reframed this)

Look at what question each track asks a *source*:
- Track A asks the **LLM's memory**: "who do you remember?"
- Track B asks **PubMed/arXiv**: "which *papers* match these words?" — then guesses people from papers.

**Neither asks a scholarly database the question we care about: "who is actively publishing on this topic right now?"** The large apparatus of name de-duplication, nickname maps, institution-alias tables, forename gates, namesake guards, and the 25-candidate identity-resolution cap all exist to climb from paper-level name strings *back up* to real people — work that only exists because origination emits ungrounded name strings in the first place.

The codebase already half-knows this. The provenance model (`lib/utils/reviewer-provenance.js`) classifies every candidate's origin and includes a `BARRED_PARAMETRIC` kind ("LLM named this person, no source confirms them") and defines a `CITED_REFERENCE` kind + `reference_list` source that **nothing ever populates** — because resolving the bibliography to authors was never built (`discovery-service.js` comment: *"SOURCE: References is intentionally NOT cited_reference; that requires a resolved DOI/PMID/arXiv work anchor, not a parser label."*). The instrumentation to distrust the guesses exists; the grounded origination to make the guesses unnecessary does not.

---

## The probe

`scripts/probe-grounded-origination.mjs` — **read-only** (same side-effect profile as the S238 smoke harness: 2 paid LLM calls + telemetry rows; no reviewer/grant/roster/Dataverse writes). It:

1. Reuses the smoke harness's loading path: resolve request → download/parse proposal → run the real analyze call → run the **current** discovery pipeline (Track A + Track B) with the route's post-discover sequence.
2. Buckets the current surfaced+ranked candidates by **provenance origin** and reports what % trace to a guess (`query_seed` keyword-crawl or `barred_parametric`) vs. a grounded pointer (proposal-named, applicant-suggested, etc.). *This is the "disease metric."*
3. Adds two **grounded, person-level lanes** and compares:
   - **G1 — OpenAlex author-aggregation.** For each analyze facet (the *same* keyword queries Track B uses, held constant), query `works?filter=title_and_abstract.search:<facet>,from_publication_date:<5yr>&group_by=authorships.author.id`. This asks the source "group all recent papers on this topic by author and rank authors by in-topic output" — returning real, already-identity-resolved people. *(Note: `per-page` caps the number of `group_by` buckets — verified live — so the probe uses `per-page=200`.)*
   - **G2 — reference-DOI resolution.** Regex-extract DOIs from the proposal text, resolve each to its real authors via OpenAlex, drop self-citations. The PI's own curated map of relevant experts.
4. Reports the **recall gap**: grounded, in-topic-active authors from G1/G2 that the current pipeline surfaced *zero* candidates for.

Privacy: the only data sent to public APIs are the keyword queries (which Track B already sends to PubMed/arXiv in production) and public reference DOIs. No applicant identity or raw proposal text leaves the box.

---

## Results (3 live requests, identical logic)

| Request | Field | Current pool | **Guess-origin %** | G1 recall gap (top 30) | G2 reference lane |
|---|---|---|---|---|---|
| 1002794 | physics (attosecond) | ~125 | **98%** | 22/30 absent — incl. **Corkum, Brabec, Wörner, Karimi** | 0 DOIs (Phase I, no bibliography in text) |
| 1002959 | chemical biology (histone code) | ~111 | **92%** | 26/30 absent — incl. **Tom Muir** + Maze-lab bench | 2 DOIs → 34 authors; **3 first/last-author anchors missed (incl. Woolfson)** |
| 1003020 | neuro (DNA-repair / memory) | ~124 | **96%** | 28/30 absent — incl. **Samson, van Loon, Bjørås** | 0 DOIs (Phase I, no bibliography in text) |

(Pool sizes and the exact absent lists vary run-to-run — the pipeline is nondeterministic — but the **disease % and the presence of named leaders in the recall gap are stable across runs.**)

### Reading the numbers

1. **The disease is real and domain-independent.** 92–98% of the candidates the tool surfaces came from a guess; only 2–8% from a grounded pointer (e.g. a person the proposal explicitly named). Biomedical — where one might expect PubMed coverage to rescue things — was *no better* than physics. **The problem is not source coverage; it is that we ask the wrong question.**

2. **The recall gap contains genuine leaders, not noise.** Asking OpenAlex the person-level question returned, absent from the current pool, people like **Paul Corkum** (effectively the founder of attosecond science), **Tom Muir** (protein semisynthesis), and **Leona Samson** (DNA repair). The obvious names (e.g. Ian Maze on the histone proposal) *were* present — the LLM knows them — but the deeper qualified bench is missed.
   **Honest caveat:** G1 is a strong *recall* source, not a finished *ranker*. Its raw top-of-list also includes incidental authors (someone who published one adjacent paper). The unambiguous evidence is the *named leaders* it recovers that the tool was missing — not the raw absent count.

3. **The reference lane works but is DOI-presence-limited.** On the one proposal whose text contained DOIs, 2 citations resolved to 34 real authors and surfaced a missed first/last-author anchor (Woolfson). But **2 of 3 Phase I "project description" documents had zero extractable DOIs** — they cite by author-year. A DOI-regex lane is inert there; it would need title→Crossref/OpenAlex resolution to be broadly useful.

---

## What this implies

- **Origination is the diseased layer.** The leverage is in *how candidates are generated*, not in downstream handling. The S238 disposition fixes (surface-don't-drop, graded COI) were correct but are symptom management.

- **§8f Part 1 is confirmed low-leverage.** That fix would recompute the misleading keyword-derived pub-count from a resolved author's real corpus. <!-- drain-table:ignore reason=candidate-field-not-pg-table --> But that number only exists because origination is keyword-based; invert origination and candidates arrive with a real activity signal already attached, so the repair is unnecessary. Don't spend the effort.

- **The inversion direction (rescue review) is empirically supported** — but with caveats that are now concrete rather than hand-wavy (below). It is NOT a mandate to build the full Part A redesign as specced; the probe suggests the simplest version (author-aggregation + reference resolution + the existing identity resolver/ranker) may obsolete the more expensive cross-source "hypothesis-builder/mosaic" stage, since author-aggregated candidates arrive already identity-resolved.

---

## Open design questions (what an inversion must solve)

1. **Facet generation for aggregation.** The current PART 3 queries are tuned as specific multi-word PubMed/MeSH strings; they're *too narrow* for OpenAlex full-text aggregation (5-word phrases returned corpora of 0–20 works). A person-level approach needs broader/atomic topic facets. What generates them — a reworked LLM prompt, OpenAlex concepts/topics, or both?

2. **Ranking the recall.** Author-aggregation gives recall, not a finished order. Raw in-topic count carries a prolific-lab bias and surfaces incidental authors. What's the ranking model — and how does "spread across sub-communities" (a stated non-relaxable property, redesign plan §8a) become a first-class, computed output rather than something nothing currently measures?

3. **Citation resolution without DOIs.** The bibliography lane is high-value (the PI's curated map) but most Phase I docs cite author-year with no inline DOIs. Resolving citations by *title* via Crossref/OpenAlex is required for this lane to apply broadly.

4. **What stays.** Track A's LLM suggestions are currently the *only* recall in fields PubMed can't confirm, and the forename gates make them safer — so the prior guidance was "add grounded lanes and prove coverage before demoting the LLM lane," not "remove it." Does the probe change that sequencing, or confirm it?

---

## Reproduce

```bash
# Read-only; ~2 paid LLM calls per request; prod reads only.
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-grounded-origination.mjs --request 1002794
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-grounded-origination.mjs --request 1002959
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-grounded-origination.mjs --request 1003020
# Flags: --years 5  --per-facet 25  --max-dois 80  --file-key "lib::folder::name"  --list-files
```
