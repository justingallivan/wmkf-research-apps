---
title: ContactEnrichmentService Decomposition Plan
domain: architecture
kind: plan
status: draft
summary: "DRAFT (S336): plan to decompose ContactEnrichmentService (1,776 L) into lib/services/contact-enrichment/*.js modules behind a thin facade. Behavior-freeze."
canonical: true
owner: product-engineering
related:
  - docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/CI_GATES_REFERENCE.md
---

# ContactEnrichmentService Decomposition Plan

**Status: DRAFT (S336) — authored, not yet Codex-reviewed, not executed.** This applies the exact
cadence proven on the DiscoveryService decomposition (S335, `docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`):
strategy chosen up front (facade + extracted modules), then leaf-first staged extraction, each cluster
characterization-covered (baselined green pre-extraction, mutation-proven) BEFORE the code moves, each
stage independently Codex-reviewed. Behavior-freeze: pure code motion, zero semantic change.

All structural claims below are grounded in artifacts produced THIS session — a whole-repo caller
inventory (`grep`), the file's method enumeration, an internal self-call frequency scan, and reads of
the load-bearing method bodies — cited inline as `[VERIFIED via …]`. Per-module line targets are
forward `[ASSUMED]` estimates for code that does not yet exist. **The per-method dependency column is a
DESIGN SKETCH; it must be regenerated mechanically in Stage 0 and re-verified in Codex review round 1 —
that column was the round-1 BLOCKER on the discovery plan, so treat it as unverified until the
call-graph script runs.**

## Objective

`lib/services/contact-enrichment-service.js` is a **1,776-line** static-method class
(`ContactEnrichmentService`, ~44 methods) [VERIFIED via wc -l + method enumeration, S336] — the #2
oversized service in `lib/services/` after DiscoveryService (now done). It implements the tiered
(Tier 0–4) reviewer contact-lookup + enrichment writeback flow. This plan decomposes it into cohesive,
single-responsibility modules under `lib/services/contact-enrichment/`, with
`contact-enrichment-service.js` reduced to a **thin facade** that delegates to them.

**Chosen strategy: Facade + extracted modules** (same as discovery, owner-approved pattern).
`ContactEnrichmentService` keeps its full static surface; every `ContactEnrichmentService.method()`
call site keeps working **unchanged**.

**Explicitly out of scope** (separate follow-ups): `dynamics-service.js` (1,728 L) and the flat
`lib/services` domain-fold. This plan is contact-enrichment-only.

## How this differs from the discovery decomposition (the added risk surface)

Two structural differences make this **higher-risk than discovery** and drive the constraints below:

1. **It is a WRITE path, not a pure read/compute service.** `saveToDatabase` runs inside
   `withDalContext('contact-enrichment-save', …)` and calls `potentialReviewerAdapter` +
   `researcherAdapter` (`getByEmail`/`upsertByEmail`/`upsertByPotentialReviewer`/`writeIdentityDecision`/
   `clearIdentityFields`) [VERIFIED via contact-enrichment-service.js:1527-1631]. This means the
   **LAW-mode boundary gates apply**: `check:dataverse-access-layer`,
   `check:route-service-boundary`, `check:dynamics-context-boundary`. The persistence code must move as
   ONE intact unit that retains the `withDalContext` wrapper and the adapter calls verbatim — see C5.
2. **It threads a mutable enrichment context object** (`result` / `result.contactEnrichment`, referred
   to as `ce` in the leaf helpers) through the tier flow, rather than returning pure values. Most
   helpers already take that object as an explicit parameter (`_addContactLead(ce, …)`,
   `_validateEmailAgainstVerifiedDomain(ce)`, `_collectContactLeads(ce)`) [VERIFIED via method
   signatures, S336], so extraction stays mechanical — but the orchestrator (`enrichCandidate`) mutates
   `result` in place across all five tiers, which is why the tier-extraction granularity is the key
   open question (Q1).

**One thing that is SIMPLER than discovery:** there are **no runtime-mutated statics** — no test or
script does `ContactEnrichmentService.X = …` [VERIFIED via grep over tests/ + scripts/, S336]. So there
is **no C1 (live-mutated-static) trap** here; the constants can be plain module `require`s.

## Why a facade (not a call-site rewrite)

The external surface reaches deep into underscore-prefixed "internal" methods (tests pin them by name),
so a facade is the low-churn path. Caller inventory [VERIFIED via grep whole-repo, excluding
`.next/` and `.claude/worktrees/`, S336]:

- **Production callers (3):**
  - `pages/api/reviewer-finder/enrich-contacts.js` — `enrichCandidates`
  - `lib/services/workbench/enrich-recommended-service.js` — `enrichCandidate`, `enrichCandidates`,
    plus internal helpers it reaches into
  - `lib/utils/scholar-url.js` — `buildGoogleScholarUrl`
- **Scripts (≈4):** `scripts/test-contact-enrichment.js`, `scripts/smoke-identity-resolver-verdict.js`,
  `scripts/measure-scholar-orcid-crosstab.js`, `scripts/probe-rudenko-email-trace.js`.
- **Tests (≈11 files)** pin many methods **including underscore ones** directly:
  `_attachEmailFromResolvedPage`, `_validateEmailAgainstVerifiedDomain`, `_collectContactLeads`,
  `_addContactLead`, `_selectGroundedEmail`, `_applyAffiliationOverride`,
  `_readjudicateNameMismatchRejectedEmail`, `_buildInstitutionDomainEvidence` [VERIFIED via
  `ContactEnrichmentService.<method>` grep, S336], and `.COSTS` is read as a static prop.

Because scripts and tests pin methods **by name on the class**, the facade must delegate the **entire
surface those callers touch** — including the underscore methods they pin (kept as thin delegating
wrappers, module-private inside their cluster module, exactly as discovery did for its 3 underscore
methods).

## Verified internal self-call graph (behavior-freeze input)

An internal self-call scan (`this.X(` / `ContactEnrichmentService.X(`) [VERIFIED via grep, S336] shows a
**shallow, near-flat helper structure**: two orchestration hubs — `enrichCandidate` (433 L, the Tier 0–4
driver) and `_finalize` (58 L, the post-tier finalize/persist hub) — call the leaf helpers, and almost
no helper calls another more than one hop deep. The busiest edges are `_addContactLead` (6 call sites),
`_cleanInstitution` (4), `_addInstitutionDomain` (4), `_finalize` (3). No mutual dependence surfaced →
the cluster graph is expected to be an **acyclic DAG**, so leaf-first extraction is safe. **This must be
confirmed by the mechanical per-method call-graph in Stage 0** (the discovery round-1 BLOCKER was an
incomplete dependency column derived by eye).

## Target module layout (DESIGN SKETCH)

`lib/services/contact-enrichment/` + the facade. `~L` is an `[ASSUMED]` forward estimate; the design
goal is **no module over ~250 L** (down from 1,776). The `Depends on` column is a **sketch pending the
Stage-0 mechanical call graph.**

| # | Module | Methods / symbols (moved from the class) | Depends on (SKETCH) | ~L |
|---|--------|------------------------------------------|---------------------|----|
| 1 | `constants.js` | `COSTS`, `SEARCH_EMAIL_SOURCES`, `EXPLICIT_EMAIL_PERSIST_SOURCES`, `CLAUDE_WEB_SEARCH_SCHEMA` (Tier-3 output schema — **carries the A7 prompt-injection marker**, C6) | — | 50 |
| 2 | `abort.js` | module fns `abortError`, `isDeadlineAbort` | — | 30 |
| 3 | `identity-anchor.js` | `_identityAnchorForCandidate`, `_cleanInstitution`, `_effectiveInstitution`, `_searchCandidateWithInstitution`, `_anchorWithInstitution`, `_hasOrcidAnchor`, `_fieldPersistAllowed`, `_markUnanchoredAbstain`, `_getAnchoredOrcidProfile` | `ORCIDService`, `normalizeOrcid` | 130 |
| 4 | `domain-evidence.js` | `_institutionTokens`, `_institutionsContradict`, `_resultContradictsAnchor`, `_normalizeDomain`, `_emailDomain`, `_domainRelated`, `_emailDomainRelatedToAny`, `_addInstitutionDomain`, `_currentOrcidInstitutionRefs`, `_strongInstitutionDisplayMatch`, `_buildInstitutionDomainEvidence` | identity-anchor (`_cleanInstitution`/`_effectiveInstitution`), `safe-fetch` (`safeFetchInstitutionPage`, `hostWithinDomain`) | 210 |
| 5 | `email-adjudication.js` | `_markEmailContested`, `_readjudicateNameMismatchRejectedEmail`, `_addContactLead`, `_collectContactLeads`, `_validateEmailAgainstVerifiedDomain` | domain-evidence, constants (`SEARCH_EMAIL_SOURCES`, `EXPLICIT_EMAIL_PERSIST_SOURCES`) | 180 |
| 6 | `openalex-metrics.js` | `_attachOpenAlexMetrics`, `_buildOpenAlexAuthorDto` | `OpenAlexService`, `reviewer-identity-resolver` (`resolveIdentity`/`isOpenAlexAuthorAccepted`) | 140 |
| 7 | `page-email.js` | `_normForNameMatch`, `_parseCandidateName`, `_emailDomainRelated`, `_windowNamesCandidate`, `_personalPageSlug`, `_slugNamesCandidate`, `_selectGroundedEmail`, `_orderCandidateUrls`, `_attachEmailFromResolvedPage` | domain-evidence, `safe-fetch`, `ContactParser` | 210 |
| 8 | `search-tiers.js` | `claudeWebSearch` (Tier 3, PAID/LLM), `buildGoogleScholarUrl` | `llm-client`/`MultiLLMService`, `SerpContactService`, `ContactParser`, constants (`CLAUDE_WEB_SEARCH_SCHEMA`), `getModelForApp` | 190 |
| 9 | `persistence.js` (**DAL / write path**) | `saveToDatabase` | `withDalContext`, `potentialReviewerAdapter`, `researcherAdapter`, `reviewer-identity-resolver` (`mayPersistIdentity`, `RESOLVER_SOURCED_FIELDS`), identity-anchor (`_fieldPersistAllowed`), `ContactParser` (`isDocumentUrl`) | 110 |
| 10 | `cost.js` | `estimateCost` | constants (`COSTS`) | 70 |
| — | `contact-enrichment-service.js` (**facade**) | `enrichCandidate` (Tier 0–4 orchestrator) + `enrichCandidates` (batch) + `_finalize` + `_applyAffiliationOverride` + all delegating wrappers + `COSTS` re-export | all of the above | see Q1 |

**`_applyAffiliationOverride`** (~40 L) is small and called only from `_finalize`; sketch keeps it with
the orchestration core on the facade, but it could fold into `persistence.js` or its own file — a
granularity nit for review.

## Q1 — The key open decision: where does the Tier 0–4 orchestrator live?

`enrichCandidate` is **433 L** [VERIFIED via :468–901] — the single biggest reason the file is large. It
mutates `result` in place across five tiers. Two options:

- **Q1-A (lower risk, chosen default): `enrichCandidate` + `enrichCandidates` + `_finalize` stay whole
  on the facade** as the orchestration layer (mirrors `discover` staying on the discovery facade). Facade
  lands at **~700–750 L** — smaller than today but not as thin as the 668 L discovery facade, because
  this orchestrator is bigger than `discover` was.
- **Q1-B (thinner facade, higher behavior-freeze risk): extract the five tiers** into a `tiers.js`
  (each tier a `applyTierN(candidate, result, options)` function threading the mutable `result`), leaving
  a ~120 L `enrichCandidate` shell on the facade → facade **~350 L**. This is the riskiest cut (the
  mutable-context threading is exactly where a naive move changes behavior), so it would get the heaviest
  characterization + Codex scrutiny.

**Recommendation: start with Q1-A** (ship the low-risk win: 1,776 → ~750 L facade + 10 clean leaf
modules), and treat Q1-B as an optional follow-up stage once the leaves are safely out and green. Owner
to confirm before Stage 0.

## Behavior-preservation constraints (the risk surface)

- **C1 — No runtime-mutated statics (unlike discovery).** Verified: nothing does
  `ContactEnrichmentService.X = …` [VERIFIED via grep tests/ + scripts/, S336]. `COSTS` is *read*
  externally (`.COSTS`) but never mutated, so it can be a plain `require` from `constants.js`, and the
  facade re-exposes it as a static prop for the external reads. No live-value-passthrough wrappers
  needed.
- **C2 — Full facade surface.** Every method a script/test pins must remain callable as
  `ContactEnrichmentService.foo` — including the underscore methods tests pin (list in "Why a facade").
  The facade delegates them as thin wrappers (module-private inside their cluster modules).
- **C3 — `this` self-references.** `enrichCandidate` and `_finalize` call sub-methods via `this.foo()`
  [VERIFIED via :542,566,1243–1276]. Those keep resolving through the facade's wrappers. Inside a moved
  cluster, `this.helper()` self-calls become direct imported-function calls. Main mechanical care-point.
- **C4 — Module system.** CommonJS (`require` / `module.exports = { ContactEnrichmentService }`)
  [VERIFIED via :1776]. One caller uses ESM `import` (`workbench/enrich-recommended-service.js`) — the
  named/default interop bridge already works, so **facade + new modules stay CommonJS**. No `.mjs`.
- **C5 — DAL write boundary is load-bearing (the defining constraint).** `saveToDatabase` MUST move as
  one intact unit into `persistence.js` and keep: the `withDalContext('contact-enrichment-save', …)`
  wrapper; the `potentialReviewerAdapter`/`researcherAdapter` calls; the partial-failure logging
  contract (step-1-succeeded-then-sidecar-fails path); and the identity-gate blocks
  (`mayPersistIdentity`, `RESOLVER_SOURCED_FIELDS`, `blockByIdentity`/`blockScholar`)
  [VERIFIED via :1527–1631]. **Run the three LAW-mode gates after this stage:**
  `check:dataverse-access-layer`, `check:route-service-boundary`, `check:dynamics-context-boundary`.
  The gates are line-tolerant allowlists keyed on file — a new `lib/services/contact-enrichment/persistence.js`
  path may need an allowlist entry; verify against the gate baselines before committing (Stage 8 note).
- **C6 — A7 prompt-injection marker.** `CLAUDE_WEB_SEARCH_SCHEMA` is the Tier-3 model-output schema
  [VERIFIED via :62–71]; `claudeWebSearch` validates model output against it. Moving the schema to
  `constants.js` and the method to `search-tiers.js` must carry the A7 surface marker so
  `check:prompt-injection-tagging` stays green.
- **C7 — Shared external singletons.** `ContactParser`, `ORCIDService`, `OpenAlexService`,
  `SerpContactService`, `reviewer-identity-resolver`, `reviewer-contact-audit`, `safe-fetch`,
  `getModelForApp`, `normalizeOrcid` are imported by multiple target modules. Each module imports what it
  needs directly; all are stateless static services — no shared-state concern.
- **C8 — No new Atlas rows / no new gate violations.** Pure code motion within `lib/services/` — no new
  data ownership, so no new `check:atlas` rows. Verify each stage against the touched gates
  (`check:doc-symbol-refs`, `check:doc-currency`, `check:agent-wiki`, plus the LAW gates for the
  persistence stage), per CLAUDE.md rule 4.

## Staging (leaf-first, each stage independently green + reviewed)

Cadence per stage: **trace → land characterization coverage (baseline green pre-extraction,
mutation-prove it discriminates) → extract one cluster → run suite + touched gates → fresh-context Codex
review → commit.** Leaf modules first so the facade delegates incrementally and the DAG never breaks.

- **Stage 0 — `constants.js` + `abort.js` + facade wiring + mechanical call-graph.** Extract the pure
  constants and the two abort helpers; wire the facade to `require` them. **Also run the per-method
  call-graph script and replace the "Depends on" sketch above with its verified output** (this is the
  discovery-round-1 lesson). No method bodies move yet. Gate: full suite + touched gates green.
- **Stage 1 — `identity-anchor.js`** (leaf; 9 methods). Characterize the untested ones first.
- **Stage 2 — `domain-evidence.js`** (depends on Stage 1).
- **Stage 3 — `email-adjudication.js`** (depends on domain-evidence; heavily test-pinned — largely
  already covered).
- **Stage 4 — `openalex-metrics.js`** (independent leaf).
- **Stage 5 — `page-email.js`** (depends on domain-evidence).
- **Stage 6 — `search-tiers.js`** (Tier-3 LLM + scholar URL; carries C6 marker).
- **Stage 7 — `cost.js`** (trivial leaf).
- **Stage 8 — `persistence.js`** (the DAL write unit; C5). **Highest scrutiny + the three LAW gates.**
  Land last of the leaves so the write path moves as an isolated, independently reviewed step.
- **Stage 9 — facade finalize / dead-import cleanup.** Drop imports now only used by moved modules;
  confirm the facade is `enrichCandidate` + `enrichCandidates` + `_finalize` (+ `_applyAffiliationOverride`
  per Q1-A) + wrappers. (Optional **Stage 10 = Q1-B** tier extraction, only if owner opts in.)

## Open questions for review

- **Q1 (owner):** Q1-A (orchestrator stays whole on facade, ~750 L, low risk) vs Q1-B (extract tiers,
  ~350 L facade, higher risk). Recommendation: Q1-A now, Q1-B as optional later stage.
- **Q2 (owner/Codex):** module granularity — 10 modules as sketched, or coarser? Obvious folds:
  `abort` → `constants`; `cost` → `constants` or the facade; `identity-anchor` + `domain-evidence` into
  one `identity.js` (~340 L, over the 250 target).
- **Q3 (Codex round 1):** verify the regenerated per-method dependency column is complete and acyclic
  (the discovery round-1 BLOCKER class).
- **Q4:** characterization-coverage gaps — which of the ~44 methods have NO direct unit coverage today
  and need a mutation-proven characterization suite added before their cluster moves.

## Testing

```bash
# Contact-enrichment covering suites (baseline before + after each stage)
npx jest tests/unit/contact-enrichment-*.test.js tests/unit/contact-leads-slice2a.test.js \
  tests/unit/save-to-database-identity-gate.test.js tests/unit/resolved-page-email-*.test.js \
  tests/unit/reviewer-enrich-contacts-route.test.js tests/unit/reviewer-identity-guard.test.js \
  tests/unit/reviewer-route-identity-gate.test.js tests/integration/enrich-recommended-route.test.js

# LAW-mode boundary gates (mandatory after the persistence stage, C5)
npm run check:dataverse-access-layer && npm run check:route-service-boundary \
  && npm run check:dynamics-context-boundary && npm run check:prompt-injection-tagging \
  && npm run check:doc-symbol-refs

# Full suite
npm test
```
