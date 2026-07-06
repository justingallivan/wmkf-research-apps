---
title: DiscoveryService Decomposition Plan
domain: architecture
kind: plan
status: draft
summary: "Decompose the 2,348-line DiscoveryService god-class into cohesive lib/services/discovery/*.js modules behind a thin delegating facade. Behavior-freeze."
canonical: true
owner: product-engineering
related:
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/agent-wiki/topics/reviewer-origination.md
  - docs/CI_GATES_REFERENCE.md
---

# DiscoveryService Decomposition Plan

**Status: STAGES 0–3 EXECUTED (S335) — plan approved via two Codex adversarial-review rounds; 8
modules extracted behind the facade (`constants`, `name-matching`, `affiliation`, `research-area`,
`pubmed-query`, `match-signals`, `provenance`, `publications`); facade 2,348 → 1,455 L. Stages 4–6
pending (Stage 3 Codex review next). See stage notes.**

All material claims below are grounded in artifacts produced THIS session — the mechanically-computed
internal call graph (a script over `lib/services/discovery-service.js`), a `grep -a` whole-repo caller
inventory, and reads of the file source — each cited inline as `[VERIFIED via …]`. Per-module
line-size targets in the layout table are forward estimates for code that does not yet exist, marked
there accordingly.

## Objective

`lib/services/discovery-service.js` is a 2,348-line static-method god-class (`DiscoveryService`,
54 methods) [VERIFIED via lib/services/discovery-service.js:30,2348] — the largest service in
`lib/services/` and the #1 refactor candidate carried since S331. This plan decomposes it into a set
of cohesive, single-responsibility modules under `lib/services/discovery/`, with
`discovery-service.js` reduced to a **thin facade** that delegates to them.

**Chosen strategy (owner-approved, S335): Facade + extracted modules.** `DiscoveryService` keeps its
full static surface; every `DiscoveryService.method()` call site — 2 production callers, 12 scripts,
8 test files — keeps working **unchanged**. This is a **behavior-freeze** refactor: pure code motion,
zero semantic change. The existing test suite is the safety net, same as the Stage-2 behavior-freeze
that extracted `lib/dataverse/core/odata.js`.

**Explicitly out of scope for this plan** (separate follow-ups): `contact-enrichment-service.js`
(1,776 L) decomposition, and the flat-`lib/services` domain-fold. This plan is discovery-only.

## Why a facade (not a call-site rewrite)

The full external surface is broad and reaches deep into "internal" methods, so a facade is the
low-churn, low-risk path. The caller inventory below is [VERIFIED via grep -a whole-repo, S335]:

- **Production callers (2):**
  - `pages/api/reviewer-finder/discover.js` — `discover`, `pubMedVerificationContract`,
    `checkCoauthorshipsForCandidates`, `rankAllCandidates`
  - `lib/services/workbench/enrich-recommended-service.js` — `pubMedVerificationContract`,
    `isClearlyNonBiomedicalVerifierArea`, `verifyClaudeSuggestions`,
    `checkCoauthorshipsForCandidates`, `countRecentPublications`, `YEARS_LOOKBACK`
- **Scripts (12 files** [VERIFIED via grep -rla scripts/, S335]**)** reach into internal methods
  directly: `generateNameVariants`, `buildAuthorQuery`, `buildDisambiguatedAuthorQuery`,
  `filterToMatchingAuthorMultiVariant`, `extractBestAffiliationMultiVariant`, `calculateExpertiseMatch`,
  `filterByExpertiseRelevance`, plus the entry points. (`debug-reviewer-finder.js`, `test-*.js`,
  `probe-*.mjs`, `profile-*.mjs`, `smoke-discover-dispositions.mjs`, `trace-reviewer-provenance.mjs`.)
- **Tests (8 files)** pin many methods by name AND mutate a static prop (see Constraint C1).

Because scripts and tests pin methods **by name on the class**, the facade must delegate the **entire
public (non-underscore) surface** — not just the route entry points. Underscore-prefixed methods
(`_isPreprintPublication`, `_affiliationWeightsMap`, `_recencyWeightedAffiliation`) are verified to
have **zero external references** [VERIFIED via grep -a `*.js`/`*.mjs`, excluding `.next/` and the
file itself, S335] and become module-private functions.

## Verified internal call graph (behavior-freeze input)

Computed mechanically from the source (each method's body scanned for `this.`/`DiscoveryService.`
self-calls, static-prop reads, and external-service references) [VERIFIED via call-graph script over
lib/services/discovery-service.js, S335]. The graph is an **acyclic DAG** — no method cluster
mutually depends on another, so leaf-first extraction is safe.

Base layer: **constants**. `name-matching` → `affiliation`. `verification` and the `discover`
orchestrator are the top hubs that depend on most other modules; nothing depends on them.

## Target module layout

`lib/services/discovery/` (13 modules) + the facade. The `~L` column holds `[ASSUMED]` forward
estimates from the current method sizes; the design goal is **no module over ~300 lines** (down
from 2,348).

| # | Module | Methods (moved from the class) | Depends on | ~L |
|---|--------|--------------------------------|-----------|----|
| 1 | `constants.js` | **10 static class props:** `MIN_PUBLICATIONS`, `YEARS_LOOKBACK`, `COAUTHOR_COI_STRONG_MIN`, `VERIFICATION_STATUSES`, `VERIFICATION_SKIPPED_REASON`, `TRACK_B_IDENTITY_RESOLUTION_LIMIT`, `TRACK_B_ENABLED`, `NICKNAME_MAP`, `OPENALEX_PUB_BACKFILL_LIMIT`, `OPENALEX_PUB_BACKFILL_CONCURRENCY` **+ 3 env-derived module consts:** `DEBUG`, `NCBI_API_KEY`, `PUBMED_DELAY` (see C7) | — | 70 |
| 2 | `name-matching.js` | `normalizeNameForMatch`, `firstNamesEquivalent`, `nameMatchEvidence`, `namesMatch`, `evaluateNameEvidence`, `generateNameVariants`, `filterToMatchingAuthor`, `filterToMatchingAuthorMultiVariant` | constants (`NICKNAME_MAP`) | 230 |
| 3 | `affiliation.js` | `normalizeAffiliationForComparison`, `_affiliationWeightsMap`, `_recencyWeightedAffiliation`, `extractBestAffiliation`, `collectAffiliationHistory`, `extractBestAffiliationMultiVariant` | name-matching | 140 |
| 4 | `research-area.js` | `isClearlyBiomedicalResearchArea`, `isPhysicalOrEngineeringResearchArea`, `isClearlyNonBiomedicalVerifierArea`, `articlesLookBiomedicalOrClinical`, `evaluateCrossFieldNamesakeGuard`, `isCrossFieldDiscoveredContamination` | — | 70 |
| 5 | `match-signals.js` | `filterByExpertiseRelevance`, `calculateExpertiseMatch`, `checkExpertiseMismatch`, `checkInstitutionMismatch` | — | 290 |
| 6 | `provenance.js` | `normalizeSuggestionSource`, `provenanceOriginForVerifiedSuggestion`, `provenanceOriginForUnverifiedSuggestion`, `provenanceOriginForSpineSuggestion`, `mapSpineVerificationResult`, `unverifiedSuggestion`, `evaluateVerificationIncoherence` | constants, `reviewer-provenance` util, `ContactParser` | 200 |
| 7 | `publications.js` | `_isPreprintPublication`, `dedupePublicationsByTitle`, `backfillOpenAlexPublications`, `countRecentPublications` | constants (`YEARS_LOOKBACK`, `VERIFICATION_STATUSES`, `OPENALEX_PUB_BACKFILL_LIMIT`, `OPENALEX_PUB_BACKFILL_CONCURRENCY`), `OpenAlexService`, `chunk` | 110 |
| 8 | `pubmed-query.js` | `buildAuthorQuery`, `buildDisambiguatedAuthorQuery` | constants (`YEARS_LOOKBACK`) | 50 |
| 9 | `literature-search.js` | `searchPubMed`, `searchArXiv`, `searchBioRxiv`, `searchChemRxiv` | constants (`YEARS_LOOKBACK`, env `PUBMED_DELAY`), `PubMedService`/`ArXivService`/`BioRxivService`/`ChemRxivService`, `reviewer-provenance` | 250 |
| 10 | `track-b-identity.js` | `resolveTrackBIdentities`, `mapTrackBIdentityResult`, `mergeTrackBWithNeedsReviewBySharedOrcid`, `partitionByPublicationBar` | constants (`MIN_PUBLICATIONS` via pass-through, `VERIFICATION_STATUSES`), `ReviewerWorkAuthorResolver`+`normalizeOrcid`, `reviewer-provenance` | 130 |
| 11 | `coauthor-coi.js` | `gradeCoauthorCOI`, `checkCoauthorHistory`, `toPubMedAuthorFormat`, `checkCoauthorshipsForCandidates` | constants (`COAUTHOR_COI_STRONG_MIN`, env `NCBI_API_KEY`, env `PUBMED_DELAY`), `PubMedService` | 160 |
| 12 | `verification.js` | `verifyClaudeSuggestions`, `pubMedVerificationContract`, `suggestionVerifierRouting` | name-matching, affiliation, match-signals, provenance, publications, pubmed-query, research-area, constants (`MIN_PUBLICATIONS`, `VERIFICATION_STATUSES`, `VERIFICATION_SKIPPED_REASON`, env `DEBUG`, env `PUBMED_DELAY`), `PubMedService`, `ReviewerIdentityEvidence`, `reviewer-provenance` | 300 |
| 13 | `ranking.js` | `rankAllCandidates` | publications (`countRecentPublications`), `DeduplicationService`, `reviewer-provenance` (`withReviewerProvenance`) | 40 |
| — | `discovery-service.js` (**facade**) | `discover` orchestrator + all static props + the delegating static methods | all of the above | ~350 |

The delegating wrappers number **50** = 54 total methods − 3 underscore-private − `discover` (which
the facade implements directly) [VERIFIED via call-graph method enumeration, S335].

> The module-layout table above is the FORWARD DESIGN for all 13 target modules; the 8 rows now
> extracted (Stages 0–3) match their committed source and the per-stage notes below carry the
> executed-state recheck (path, method list, Codex verdict). The 5 not-yet-extracted rows
> (`literature-search`, `track-b-identity`, `coauthor-coi`, `verification`, `ranking`) remain Stage 4–6
> design targets.
>
> [RECHECKED after lib/services/discovery/constants.js lib/services/discovery/name-matching.js lib/services/discovery/affiliation.js lib/services/discovery/research-area.js lib/services/discovery/pubmed-query.js lib/services/discovery/match-signals.js lib/services/discovery/provenance.js lib/services/discovery/publications.js change: all 8 extracted modules match their committed source per the per-stage notes below.]

The facade also
re-exposes **all 10 static class properties** (C2) — including the two OpenAlex-backfill statics an
external test reads directly (C1).

The `Depends on` column was regenerated mechanically after Codex review round 1 (a per-method pass
recording sibling-method calls, static-prop reads, module-level env consts, and imported identifiers)
[VERIFIED via call-graph script v2 over lib/services/discovery-service.js, S335]. The added arrows all
point at leaf modules (`constants`) or external services — no new inter-module *method* edge — so the
DAG remains acyclic and leaf-first extraction stays safe.

**Note on granularity.** The owner-approved sketch listed 6 illustrative modules
(`literature-search`, `name-matching`, `affiliation`, `verification`, `track-b-identity`, `ranking`,
with "…"). This is the sized-out version: keeping any single module under ~300 L requires splitting
the "verification" cluster's helpers (`provenance`, `research-area`, `match-signals`, `pubmed-query`)
and the publications/coauthor clusters into their own files. If a coarser layout is preferred, the
obvious consolidations are: fold `pubmed-query` → `name-matching` or `literature-search`; fold
`research-area` → `verification`; fold `coauthor-coi` → `verification`. **Open question for review
(Q1): 13 modules vs. a coarser layout (roughly 8)?**

## Behavior-preservation constraints (the risk surface)

These are the non-mechanical parts — where a naive cut-and-paste would silently change behavior.

- **C1 — Runtime-mutated static (`MIN_PUBLICATIONS`).** `tests/unit/discovery-verification-status.test.js`
  does `DiscoveryService.MIN_PUBLICATIONS = 3` before calling `verifyClaudeSuggestions`, then restores
  it [VERIFIED via tests/unit/discovery-verification-status.test.js:63-64,72]. Two methods read it:
  `verifyClaudeSuggestions` and `partitionByPublicationBar` [VERIFIED via call-graph script, S335].
  **Requirement:** the facade keeps `MIN_PUBLICATIONS` as a live static property, and its delegating
  wrappers pass the *current* value into the extracted functions — e.g.
  `static partitionByPublicationBar(c) { return partitionByPublicationBar(c, this.MIN_PUBLICATIONS); }`
  and the extracted `partitionByPublicationBar(candidates, minPublications)` takes it as a parameter.
  A module that `require`s a frozen constant instead would break the test's mutation and any runtime
  override. `MIN_PUBLICATIONS` is the **only** static the tests/scripts *mutate* [VERIFIED via grep for
  `DiscoveryService.<STATIC> =` assignments in tests/ and scripts/, S335]; the other 9 statics are
  read-only. **But read-only is not the same as internal:** `OPENALEX_PUB_BACKFILL_CONCURRENCY` is read
  as `DiscoveryService.OPENALEX_PUB_BACKFILL_CONCURRENCY` by
  `tests/unit/discovery-openalex-publications.test.js:143` [VERIFIED via grep, S335], and a production
  caller reads `DiscoveryService.YEARS_LOOKBACK`. So the read-only statics can be plain `require`s
  inside their consuming modules (value is identical), **and** the facade must re-expose **all 10** as
  static props so external `DiscoveryService.<CONST>` reads keep resolving.
- **C2 — Full facade surface.** Every non-underscore method must remain callable as
  `DiscoveryService.foo` (scripts + tests pin them). The facade delegates all 50 public non-`discover`
  methods and re-exposes all **10** static class properties (the top-8 block + the two OpenAlex-backfill
  statics at `discovery-service.js:422-423` my first-pass call-graph missed — Codex review round-1
  BLOCKER). Underscore methods stay private (verified no external refs).
- **C3 — `this` / `DiscoveryService` self-references.** The `discover` orchestrator (stays on the
  facade) calls sub-methods via both `this.foo()` and `DiscoveryService.foo()`
  [VERIFIED via discovery-service.js:166-375]. Those keep resolving through the facade's delegating
  wrappers. Inside a moved cluster, `this.helper()` / `DiscoveryService.helper()` self-calls become
  direct imported-function calls (`helper()` from the sibling module). This rewrite is the main
  mechanical care-point.
- **C4 — Module system.** The file is CommonJS (`require` / `module.exports = { DiscoveryService }`)
  [VERIFIED via discovery-service.js:11-21,2347]. One production caller uses ESM
  (`import { DiscoveryService } from '.../discovery-service'`) [VERIFIED via
  workbench/enrich-recommended-service.js import, S335] — interop already works via the default/named
  bridge, so **the facade stays CommonJS** and the new modules are CommonJS too (matches the rest of
  `lib/services/`). No `.mjs`, no ESM conversion.
- **C5 — Shared external singletons.** `PubMedService`, `OpenAlexService`, the rxiv services,
  `DeduplicationService`, `reviewer-provenance`, `ContactParser`, `ReviewerWorkAuthorResolver` are
  imported by multiple target modules. Each module imports what it needs directly; no shared-state
  concerns (these are stateless static services).
- **C6 — No new gate violations.** `check:dataverse-access-layer`, `check:route-service-boundary`,
  `check:atlas`, `check:doc-symbol-refs`, `check:doc-currency` all scan `lib/services`. Moving code
  within `lib/services/discovery/` must not trip them; the doc-symbol-ref and atlas gates in
  particular reference `lib/services/discovery-service.js` paths that will still exist (facade stays).
  New module paths get no new Atlas rows (no new data ownership — pure code motion). **Verify each
  stage against the touched gates**, per CLAUDE.md rule 4.
- **C7 — Module-level env-derived consts (`DEBUG`, `NCBI_API_KEY`, `PUBMED_DELAY`).** These are
  top-of-file `const`s derived from `process.env` at module load [VERIFIED via discovery-service.js:24,
  27-28], read inside methods that move to `verification.js`, `literature-search.js`, and
  `coauthor-coi.js` (`PUBMED_DELAY` at :550,563,1227,2202,2303; `DEBUG` at :572,590,619,720;
  `NCBI_API_KEY` at :2265) [VERIFIED via grep, S335]. **Requirement:** extract them once into the shared
  `constants.js` (env section) and have every consuming module import them from there — do NOT
  re-derive them independently per module (harmless while env is stable, but it invites drift and a
  test that stubs `process.env` in one place would then see divergent values). They are NOT class
  statics and are never read as `DiscoveryService.X`, so the facade does not re-expose them. This is
  the Codex review round-1 dependency-fidelity BLOCKER — every method that reads one of these carries a
  `constants` dependency in the layout table above.

## Staging (leaf-first, each stage independently green + reviewed)

Same cadence proven on site-33: **trace → extract one cluster → run suite → fresh-context Codex
review → commit**. Leaf modules first so the facade delegates incrementally and the DAG never breaks.

- **Stage 0 — `constants.js` + facade wiring. ✅ EXECUTED (S335).** Created
  `lib/services/discovery/constants.js` with the 10 static class props **and** the 3 env-derived module
  consts (C7). The facade `require`s it as `C`, re-exposes the 10 statics as own static props
  (`static MIN_PUBLICATIONS = C.MIN_PUBLICATIONS;` etc.), and destructures `DEBUG`/`NCBI_API_KEY`/
  `PUBMED_DELAY` from it (module-level bindings unchanged). No method bodies moved. Verified: module
  loads; all 10 statics equal the constants; `MIN_PUBLICATIONS` is still a reassignable own prop (C1);
  8 DiscoveryService-covering unit suites (111 tests) + the enrich-recommended integration suite
  (14 tests) green; touched gates (`check:dataverse-access-layer`, `check:route-service-boundary`,
  `check:atlas`, `check:doc-symbol-refs`, `check:doc-currency`, `check:agent-wiki`) green. Fresh-context
  Codex review of the diff (`f688dce7` vs `949a61c8`): SATISFIED, no material findings.
  [RECHECKED after lib/services/discovery/constants.js + lib/services/discovery-service.js change:
  this note describes the committed Stage 0 state (`f688dce7`) — constants.js holds the 10 statics +
  3 env consts; the facade re-exposes all 10 as own static props and destructures the env consts.]
- **Stage 1 — `name-matching.js` (pure leaf). ✅ EXECUTED (S335).** Moved the 8-method cluster
  (`normalizeNameForMatch`, `firstNamesEquivalent`, `generateNameVariants`, `nameMatchEvidence`,
  `namesMatch`, `filterToMatchingAuthor`, `filterToMatchingAuthorMultiVariant`, `evaluateNameEvidence`)
  to `lib/services/discovery/name-matching.js`; internal `this.X` self-calls became direct function
  calls, `NICKNAME_MAP` from `./constants`; the facade delegates all 8. Per Q2 (none had direct unit
  coverage), first landed a 25-test characterization suite `tests/unit/discovery-name-matching.test.js`,
  baselined green against pre-extraction code, then mutation-proven (neutralize the nickname branch →
  suite goes red). Post-extraction: 10 suites / 150 tests green; touched gates green; facade 2,290 →
  2,135 L. Fresh-context Codex review of the diff (`649c9d33` vs `f688dce7`): SATISFIED, no material
  findings (independently diffed all 8 bodies, ran the 25 characterization cases + an old-vs-current
  fixture comparison). [RECHECKED after lib/services/discovery/name-matching.js change: this note
  describes the committed Stage 1 state — the module exports the 8 functions and the facade delegates
  each.]
- **Stage 2 — `affiliation.js` (depends on Stage 1). ✅ EXECUTED (S335).** Moved the 6-method cluster
  (`extractBestAffiliation`, `_affiliationWeightsMap`, `_recencyWeightedAffiliation`,
  `collectAffiliationHistory`, `normalizeAffiliationForComparison`, `extractBestAffiliationMultiVariant`)
  to `lib/services/discovery/affiliation.js`; internal `this.X` → direct calls, author-name matching
  imported from `./name-matching`; the facade delegates all 6 (the `normalizeAffiliationForComparison`
  wrapper param renamed `affiliationString` to avoid shadowing the imported module). The 3 public
  methods were already covered; per Q2 added 6 characterization cases for the untested
  `normalizeAffiliationForComparison` regex branches (baselined green, mutation-proven). Post-extraction:
  10 suites / 156 tests green; touched gates green; facade 2,135 → 2,029 L. Fresh-context Codex review
  of the diff (`4dea718a` vs `b7fb6be1`): SATISFIED, no material findings (body-identical, hoisting,
  shadowing, dep graph, characterization all checked). [RECHECKED after
  lib/services/discovery/affiliation.js change: this note describes the committed Stage 2 state — the
  module exports the 6 functions and the facade delegates each.]
- **Stage 3 — independent leaves, one commit each (or grouped):** `research-area.js`,
  `match-signals.js`, `provenance.js`, `publications.js`, `pubmed-query.js`. None depend on each other.
  **Batch 1 ✅ EXECUTED (S335):** `research-area.js` (6 methods:
  `isClearlyBiomedicalResearchArea`, `isPhysicalOrEngineeringResearchArea`,
  `isClearlyNonBiomedicalVerifierArea`, `articlesLookBiomedicalOrClinical`,
  `evaluateCrossFieldNamesakeGuard`, `isCrossFieldDiscoveredContamination`) and `pubmed-query.js`
  (2 methods: `buildAuthorQuery`, `buildDisambiguatedAuthorQuery`, `YEARS_LOOKBACK` from `./constants`).
  Added characterization suites `tests/unit/discovery-research-area.test.js` (11 cases) +
  `tests/unit/discovery-pubmed-query.test.js` (3 cases), baselined green + mutation-proven; 12 suites /
  167 tests green; touched gates green; facade 2,029 → 1,967 L.
  **Batch 2 ✅ EXECUTED (S335):** `match-signals.js` (4 pure methods: `filterByExpertiseRelevance`,
  `calculateExpertiseMatch`, `checkInstitutionMismatch`, `checkExpertiseMismatch`), `provenance.js`
  (7 methods: `normalizeSuggestionSource`, `provenanceOriginForVerifiedSuggestion`,
  `provenanceOriginForUnverifiedSuggestion`, `provenanceOriginForSpineSuggestion`,
  `mapSpineVerificationResult`, `unverifiedSuggestion`, `evaluateVerificationIncoherence`), and
  `publications.js` (4 methods: `_isPreprintPublication`, `dedupePublicationsByTitle`,
  `backfillOpenAlexPublications`, `countRecentPublications`). Added characterization suites
  `discovery-match-signals.test.js` (16 cases) + `discovery-provenance.test.js` (8 cases) for the
  untested clusters (baselined green + mutation-proven); `publications` relied on existing
  `discovery-openalex-publications.test.js`. Facade wrappers `dedupePublicationsByTitle(pubs)` and
  `checkExpertiseMismatch(pubs)` renamed their param to avoid shadowing the `publications` import.
  14 suites / 190 tests green; touched gates green; facade 1,967 → 1,455 L (**2,348 → 1,455 overall,
  ~38%**). [RECHECKED after lib/services/discovery/match-signals.js + provenance.js + publications.js
  change: this note describes the committed batch-2 state — each module exports its functions and the
  facade delegates each.] **Stage 3 Codex review (both batches, `dcfb8483..5e112eb9`): SATISFIED, no
  material findings** — all 23 methods verified body-identical, facade surface intact, statics still
  exposed, no require cycle, old-vs-new runtime samples matched.
- **Stage 4 — mid-tier:** `literature-search.js`, `track-b-identity.js`, `coauthor-coi.js`,
  `ranking.js`.
- **Stage 5 — `verification.js`** (the hub; depends on Stages 1–4). The 272-line
  `verifyClaudeSuggestions` is the single most delicate move — extract last, with the constant
  pass-through (C1) and the `this.`→import rewrite (C3) under the most scrutiny.
- **Stage 6 — facade finalization.** `discovery-service.js` now holds only `discover` + static props
  + delegations. Confirm the target line count, confirm the full public surface still resolves, final
  full-suite run + fresh review.

Stages 3 and 4 may each be split into per-module commits if a review round wants finer granularity.

## Test / safety net

- **Existing coverage (the primary net):** 6 unit suites + 1 integration suite already pin
  affiliation, dedup, Track-B identity/merge/partition, COI grading, ranking, cross-field
  contamination, verification routing, suggestion normalization, and `pubMedVerificationContract`
  [VERIFIED via test-file inventory, S335]. These run unchanged after each stage — a green suite proves
  the code motion was faithful.
- **Coverage gaps to characterize BEFORE moving (site-33 lesson — mutation-prove discrimination):**
  `checkInstitutionMismatch` (139 L, no direct unit test), `nameMatchEvidence`/`evaluateNameEvidence`,
  the four `search*` methods (dormant Track-B, `TRACK_B_ENABLED=false` — low risk but zero coverage),
  and `checkExpertiseMismatch`. **Open question (Q2):** add targeted characterization tests for these
  before their stage, or accept the existing integration coverage as sufficient given pure code motion?
- **Gates:** run the touched gates listed in C6 at each stage; full `npm test` before Stages 5/6 commit.
- **Per-stage fresh-context Codex review** on the shipped diff (`reference-codex-detached-exec-protocol.md`).

## Open questions — RESOLVED after Codex review round 1

1. **Module granularity → KEEP 13.** Codex: keep 13 only *after* regenerating the dependency table
   from a mechanical pass; otherwise consolidate. The table has now been regenerated (see the note
   under the layout table), so 13 modules stands. The alternative coarser layout (roughly 8) remains
   documented above as a fallback if a later stage finds the import surface unwieldy.
2. **Characterization gaps → PRE-WRITE tests.** Codex: add characterization tests before extraction
   for the uncovered clusters — "pure code motion is not enough here." Adopted: each stage that moves a
   currently-untested cluster (`checkInstitutionMismatch`, `nameMatchEvidence`/`evaluateNameEvidence`,
   the four `search*` methods, `checkExpertiseMismatch`) first lands a characterization test,
   mutation-proven to discriminate (neutralize the moved logic → test goes red), THEN moves the code.
3. **`gradeCoauthorCOI` placement → `coauthor-coi.js`.** Codex concurs: keep it with its only caller
   `checkCoauthorshipsForCandidates`, not `track-b-identity.js`. Settled.
4. **Facade delegation style → explicit hand-written wrappers.** Codex concurs, and notes the missing
   OpenAlex static is direct evidence that grep/static visibility matters — a programmatic
   `Object.assign` loop would have hidden exactly that surface. Settled.

## Review log

- **Round 1 — Codex adversarial review (S335, plan commit `a9ba8ca3`): CHANGES-REQUIRED.** Two
  BLOCKERs, both verified against source and reconciled here:
  (1) the plan under-counted static class props as 8 — the class has **10** (`OPENALEX_PUB_BACKFILL_LIMIT`
  / `OPENALEX_PUB_BACKFILL_CONCURRENCY` at `discovery-service.js:422-423`, the latter externally read by
  `discovery-openalex-publications.test.js:143`); (2) the `Depends on` column dropped real deps
  (`DEBUG`/`NCBI_API_KEY`/`PUBMED_DELAY` module consts, `PubMedService`/`ReviewerIdentityEvidence` in
  `verification`, `withReviewerProvenance` in `ranking`). Fixes: constants row → 10 statics + 3 env
  consts; new constraint **C7**; dependency column regenerated mechanically; the four open questions
  resolved with Codex's recommendations. The DAG-acyclic / method-mapping / facade-strategy core was
  confirmed sound.
- **Round 2 — Codex adversarial re-review (S335, reconciled plan commit `84d9eb43`): SATISFIED /
  approve, no material findings.** Independently re-verified against source: all 10 statics enumerated
  and re-exposed, `MIN_PUBLICATIONS` pass-through preserved, env consts carried into the affected
  dependency rows, all 54 methods mapped exactly once, re-derived module DAG acyclic. No new
  inaccuracies or staging blockers. **Cleared to execute Stage 0.**

## Non-goals / do-not-touch

- No semantic change to any discovery behavior — this is code motion only.
- No change to the 2 production callers, the 12 scripts, or the 8 test files' call sites.
- No ESM conversion; no change to `TRACK_B_ENABLED` (stays `false`, dormant).
- `contact-enrichment-service.js` and the `lib/services` domain-fold remain separate future work.
