---
title: ContactEnrichmentService Decomposition Plan
domain: architecture
kind: plan
status: draft
summary: "IN PROGRESS (S336): decompose ContactEnrichmentService (1,776 L) into lib/services/contact-enrichment/*.js behind a thin facade. Stage 0 done; behavior-freeze."
canonical: true
owner: product-engineering
related:
  - docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/CI_GATES_REFERENCE.md
---

# ContactEnrichmentService Decomposition Plan

**Status: IN PROGRESS (S336) — plan authored + 2 Codex review rounds folded; Stage 0 EXECUTED
(`3f5c0fb8`); Stages 1–10 pending.** This applies the exact
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
so a facade is the low-churn path. Caller inventory — **corrected after Codex review round 1** (the
round-1 caller finding: the first-pass inventory listed `scholar-url.js` as a caller and claimed an
external `.COSTS` read; neither is true). This is a **mechanical `ContactEnrichmentService.<method>`
scan** [VERIFIED via node AST-ish grep over pages/lib/scripts/tests/shared excluding the file itself,
Codex round 1 + re-run S336]:

- **Production callers (2):**
  - `pages/api/reviewer-finder/enrich-contacts.js` — `estimateCost` (:98), `enrichCandidates` (:106)
  - `lib/services/workbench/enrich-recommended-service.js` — `enrichCandidates` (:249)
  - (`lib/utils/scholar-url.js` is **NOT** a caller — it has its own independent scholar-URL helper and
    only a comment reference at :35. Removed from the inventory.)
- **Scripts (3 — corrected in R2, this is the exact mechanical-scan output):**
  `scripts/test-contact-enrichment.js` (`claudeWebSearch`, :59),
  `scripts/smoke-identity-resolver-verdict.js` (`enrichCandidate`, :70),
  `scripts/smoke-reviewer-contact-anchoring.mjs` (`enrichCandidate` :108,:134;
  `_validateEmailAgainstVerifiedDomain` :76).
  (**Removed in R2:** `scripts/measure-scholar-orcid-crosstab.js` has only a comment reference, no call
  [VERIFIED via scan]; `scripts/probe-rudenko-email-trace.js` **does not exist** — both were carried into
  the first draft without verification.) Two `lib/services` files (`reviewer-contact-audit.js:6`,
  `reviewer-identity-resolver.js:5`) mention `ContactEnrichmentService.enrichCandidate` in **JSDoc
  comments only**, not as calls [VERIFIED via read] — they are imported BY this service, so a real call
  would be circular.
- **Tests (≈11 files)** pin many methods **including underscore ones** directly:
  `_attachEmailFromResolvedPage`, `_validateEmailAgainstVerifiedDomain`, `_collectContactLeads`,
  `_addContactLead`, `_selectGroundedEmail`, `_applyAffiliationOverride`,
  `_readjudicateNameMismatchRejectedEmail`, `_buildInstitutionDomainEvidence`, `saveToDatabase`,
  `claudeWebSearch`, `enrichCandidate`, `enrichCandidates`, `estimateCost` [VERIFIED via mechanical scan,
  S336]. **`.COSTS` is NOT read by any external caller** — the only `.COSTS` reference outside a method
  body is the class's own static assignment at `contact-enrichment-service.js:1774` [VERIFIED via scan].
  So the facade re-exposes `COSTS` only because `enrichCandidates`/`estimateCost` read it internally, not
  for an external consumer.

Because scripts and tests pin methods **by name on the class** — **and several tests `jest.spyOn` the
class methods** (`saveToDatabase`, `claudeWebSearch`, `enrichCandidate`; see C10) — the facade must
delegate the **entire surface those callers touch**, including the underscore methods they pin (kept as
thin delegating wrappers, module-private inside their cluster module) AND preserve spyable dispatch for
the internally-called ones.

## Verified internal self-call graph (behavior-freeze input)

An internal self-call scan (`this.X(` / `ContactEnrichmentService.X(`) [VERIFIED via grep, S336] shows a
**shallow, near-flat helper structure**: two orchestration hubs — `enrichCandidate` (433 L, the Tier 0–4
driver) and `_finalize` (58 L, the post-tier finalize/persist hub) — call the leaf helpers, and almost
no helper calls another more than one hop deep. The busiest edges are `_addContactLead` (6 call sites),
`_cleanInstitution` (4), `_addInstitutionDomain` (4), `_finalize` (3). No mutual dependence surfaced →
the cluster graph is expected to be an **acyclic DAG**, so leaf-first extraction is safe.

### VERIFIED mechanical call graph (Stage 0, EXECUTED) — this SUPERSEDES the sketch `Depends on` column

A mechanical per-method analyzer (brace-matched method bodies → sibling `this.`/`ContactEnrichmentService.`
self-calls + tracked imported/const/dynamic-import identifiers, aggregated to the plan's module map) was
run over the file [VERIFIED via ce-callgraph analyzer, S336]. Result — **the graph is an acyclic DAG,
confirming leaf-first is safe** (Codex round-2's "regenerate before Stage 1" fix, done). Authoritative
per-module dependencies (module edges = a method calling a sibling in another module):

| Module | Module edges (→) | Imported/const identifiers | Dyn imports |
|--------|------------------|----------------------------|-------------|
| `identity-anchor` | (none — leaf) | `ORCIDService`, `normalizeOrcid` | — |
| `domain-evidence` | (none — leaf) | `ContactParser`, `OpenAlexService`, `mayPersistIdentity`, `normalizeOrcid` | — |
| `openalex-metrics` | (none — leaf) | `OpenAlexService`, `isOpenAlexAuthorAccepted`, `normalizeOrcid` | — |
| `search-tiers` | (none — leaf) | `ContactParser`, `getModelForApp`, `CLAUDE_WEB_SEARCH_SCHEMA` | `ai-payload-boundary`, `llm-client`, `ai-output-schema` |
| `persistence` | (none — leaf) | `ContactParser`, `EXPLICIT_EMAIL_PERSIST_SOURCES`, `RESOLVER_SOURCED_FIELDS`, `mayPersistIdentity`, `potentialReviewerAdapter`, `researcherAdapter`, `withDalContext` | — |
| `cost` | (none — leaf) | `COSTS` | — |
| `email-adjudication` | → `domain-evidence` (`_emailDomainRelatedToAny`) | `SEARCH_EMAIL_SOURCES` | — |
| `page-email` | → `domain-evidence` (`_domainRelated`, `_emailDomain`) | `ContactParser`, `SEARCH_EMAIL_SOURCES`, `abortError`, `hostWithinDomain`, `safeFetchInstitutionPage` | — |
| `tiers` | → `identity-anchor`, `domain-evidence`, `email-adjudication`, `openalex-metrics`, `page-email`, `persistence`, `search-tiers` | `ContactParser`, `ORCIDService`, `SerpContactService`, `evidenceFromEnrichment`, `mayPersistIdentity`, `resolveIdentity` | — |
| `facade` (`enrichCandidates`) | → `tiers` (`enrichCandidate`) | `COSTS`, `abortError`, `isDeadlineAbort`, `summarizeContactOutcomes` | — |

**Topological order (leaf → root):** `constants`/`abort` → { `identity-anchor`, `domain-evidence`,
`openalex-metrics`, `search-tiers`, `persistence`, `cost` } → { `email-adjudication`, `page-email` } →
`tiers` → `facade`. The mechanical run confirmed the R1/R2 hand-corrections AND surfaced two the by-eye
table still had wrong: `openalex-metrics` also uses `normalizeOrcid`, and `email-adjudication` does NOT
use `EXPLICIT_EMAIL_PERSIST_SOURCES` (only `persistence` does, via `_fieldPersistAllowed`). The sketch
`Depends on` column in the layout table below is now **historical** — use THIS table.

## Target module layout (DESIGN SKETCH)

`lib/services/contact-enrichment/` + the facade. `~L` is an `[ASSUMED]` forward estimate; the design
goal is **no module over ~250 L** (down from 1,776). The `Depends on` column is a **sketch pending the
Stage-0 mechanical call graph.**

| # | Module | Methods / symbols (moved from the class) | Depends on (SKETCH) | ~L |
|---|--------|------------------------------------------|---------------------|----|
| 1 | `constants.js` | `COSTS`, `SEARCH_EMAIL_SOURCES`, `EXPLICIT_EMAIL_PERSIST_SOURCES`, `CLAUDE_WEB_SEARCH_SCHEMA` (Tier-3 output schema — **carries the A7 prompt-injection marker**, C6) | — | 50 |
| 2 | `abort.js` | module fns `abortError`, `isDeadlineAbort` | — | 30 |
| 3 | `identity-anchor.js` | `_identityAnchorForCandidate`, `_cleanInstitution`, `_effectiveInstitution`, `_searchCandidateWithInstitution`, `_anchorWithInstitution`, `_hasOrcidAnchor`, `_markUnanchoredAbstain`, `_getAnchoredOrcidProfile` (`_fieldPersistAllowed` **moved to persistence.js**, R1) | `ORCIDService`, `normalizeOrcid` | 120 |
| 4 | `domain-evidence.js` | `_institutionTokens`, `_institutionsContradict`, `_resultContradictsAnchor`, `_normalizeDomain`, `_emailDomain`, `_domainRelated`, `_emailDomainRelatedToAny`, `_addInstitutionDomain`, `_currentOrcidInstitutionRefs`, `_strongInstitutionDisplayMatch`, `_buildInstitutionDomainEvidence` | identity-anchor (`_cleanInstitution`/`_effectiveInstitution`), `safe-fetch` (`safeFetchInstitutionPage`, `hostWithinDomain`), **`ContactParser` (:193,208), `normalizeOrcid` (:272), `mayPersistIdentity` (:278), `OpenAlexService`** (added, R1 BLOCKER-3) | 210 |
| 5 | `email-adjudication.js` | `_markEmailContested`, `_readjudicateNameMismatchRejectedEmail`, `_addContactLead`, `_collectContactLeads`, `_validateEmailAgainstVerifiedDomain` | domain-evidence, constants (`SEARCH_EMAIL_SOURCES`, `EXPLICIT_EMAIL_PERSIST_SOURCES`) | 180 |
| 6 | `openalex-metrics.js` | `_attachOpenAlexMetrics`, `_buildOpenAlexAuthorDto` | `OpenAlexService`, `reviewer-identity-resolver` (**`isOpenAlexAuthorAccepted` only**, :962 — `resolveIdentity` is in `_finalize`/`tiers.js` at :1247, R2 removed the false edge) | 140 |
| 7 | `page-email.js` | `_normForNameMatch`, `_parseCandidateName`, `_emailDomainRelated`, `_windowNamesCandidate`, `_personalPageSlug`, `_slugNamesCandidate`, `_selectGroundedEmail`, `_orderCandidateUrls`, `_attachEmailFromResolvedPage` | domain-evidence, `safe-fetch`, `ContactParser`, **constants (`SEARCH_EMAIL_SOURCES`, :1188), `abortError` (:1195)** (added, R1 BLOCKER-3) | 210 |
| 8 | `search-tiers.js` | `claudeWebSearch` (Tier 3, PAID/LLM), `buildGoogleScholarUrl` | `ContactParser`, constants (`CLAUDE_WEB_SEARCH_SCHEMA`), `getModelForApp`; **3 dynamic ESM imports preserved (C11): `ai-payload-boundary` (:1645), `llm-client` (:1660), `ai-output-schema` (:1722)**. (**`SerpContactService` REMOVED** — R2: it's Tier 4 inside `tiers.js` at :797, not used by `claudeWebSearch`) | 190 |
| 9 | `persistence.js` (**DAL / write path**) | `saveToDatabase`, **`_fieldPersistAllowed`** (moved here, R1 — only `saveToDatabase` uses it, :1529–1530) | `withDalContext`, `potentialReviewerAdapter`, `researcherAdapter`, `reviewer-identity-resolver` (`mayPersistIdentity`, `RESOLVER_SOURCED_FIELDS`), constants (`EXPLICIT_EMAIL_PERSIST_SOURCES`), `ContactParser` (`isDocumentUrl`) | 120 |
| 10 | `cost.js` | `estimateCost` | constants (`COSTS`) | 70 |
| 11 | `tiers.js` (**Q1-B, highest-risk cut**) | the five tier bodies from `enrichCandidate` as `applyTier{0..4}(candidate, result, options)` + `_finalize` + `_applyAffiliationOverride` (the finalize glue `_finalize` calls after resolver/domain/contact-lead work, :1273 — kept with `_finalize`, R1 MINOR-7) | identity-anchor, domain-evidence, email-adjudication, openalex-metrics, page-email, search-tiers, persistence, constants, `ContactParser`, **`ORCIDService` (:622), `SerpContactService` (:797), resolver exports (:1246)** (added, R1 BLOCKER-3); **must dispatch `claudeWebSearch`/`saveToDatabase` through the facade `this`, not imports (C10)** | 220 |
| — | `contact-enrichment-service.js` (**facade**) | `enrichCandidate` (~120 L shell that sequences `applyTier0..4` + `_finalize`) + `enrichCandidates` (batch) + all delegating wrappers + `COSTS` re-export | all of the above | ~350 |

**The `Depends on` column above is STILL a sketch with hand-applied round-1 corrections — Stage 0 must
replace it wholesale with the mechanical per-method call graph** (Codex round-1 BLOCKER-3: the sketch had
real missing/misplaced edges; the specific ones it named are folded in above, but a by-eye column is not
trustworthy — regenerate it). `_applyAffiliationOverride` lives with `_finalize` in `tiers.js`
(round-1 MINOR-7 resolved the earlier table/note contradiction).

## Q1 — DECIDED (owner, S336): extract the Tier 0–4 tiers (Q1-B)

`enrichCandidate` is **433 L** [VERIFIED via :468–901] — the single biggest reason the file is large. It
mutates `result` in place across five tiers.

**Owner decision (S336): Q1-B — extract the tiers.** The five tier bodies move into `tiers.js` as
`applyTier{0..4}(candidate, result, options)` functions (module 11 above), leaving a ~120 L
`enrichCandidate` shell on the facade that sequences them → facade **~350 L** (parity with the 668 L
discovery facade goal, thinner given a smaller wrapper set). This is the **riskiest cut** in the plan:
the mutable-`result` threading and the tier **early-return / short-circuit** control flow are exactly
where a naive move changes behavior (see C9). It gets the heaviest characterization coverage and the
most scrutinous Codex review, and lands as its own late stage (Stage 9) AFTER every leaf it depends on
is already extracted and green. The alternative (Q1-A: keep the orchestrator whole on the facade,
~750 L) was **not** chosen.

## Behavior-preservation constraints (the risk surface)

- **C1 — No runtime-mutated statics (unlike discovery).** Verified: nothing does
  `ContactEnrichmentService.X = …` [VERIFIED via grep tests/ + scripts/, S336]. `COSTS` moves to
  `constants.js` as a plain `require`; the facade re-exposes it as a static prop because
  `enrichCandidates`/`estimateCost` read it **internally** — **not** for an external consumer (round 1
  disconfirmed the first-draft "read externally" claim: the only `.COSTS` outside a method body is the
  class's own assignment at :1774 [VERIFIED via mechanical scan]). No live-value-passthrough wrappers
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
  **No allowlist entry should be needed** (round-1 correction — the first draft overstated this):
  `check-dataverse-access-layer.js` runs with **no allowlist file** [VERIFIED via
  scripts/check-dataverse-access-layer.js:14], `check-route-service-boundary.js` has **no baseline/ratchet**
  [VERIFIED via :12], and `withDalContext` is explicitly **allowed** by the context gate [VERIFIED via
  scripts/check-dynamics-context-boundary.js:45]. The gates stay green **provided `persistence.js` imports
  the adapters but does NOT re-export adapter identities**, and the `return withDalContext(…)` wrapper
  stays around every adapter call [VERIFIED via :1540]. Verify green after the move regardless.
- **C6 — A7 prompt-injection marker AND gate registry (round-2: the registry is the real gap).**
  `CLAUDE_WEB_SEARCH_SCHEMA` is the Tier-3 model-output schema [VERIFIED via :62–71]; `claudeWebSearch`
  validates model output against it. Moving the schema to `constants.js` and the method to
  `search-tiers.js` must carry the A7 surface marker. **Critically, the gate's registry hard-codes the
  file path** — `check-prompt-injection-tagging.js` has `{ id: 'contact-enrichment', … callSiteFiles:
  ['lib/services/contact-enrichment-service.js'] }` [VERIFIED via scripts/check-prompt-injection-tagging.js:325–329].
  So Stage 6 must update that `callSiteFiles` entry to `lib/services/contact-enrichment/search-tiers.js`
  (or list both during the transition) **in the same commit** as the method move, then run
  `check:prompt-injection-tagging` — otherwise the gate goes red.
- **C7 — Shared external singletons.** `ContactParser`, `ORCIDService`, `OpenAlexService`,
  `SerpContactService`, `reviewer-identity-resolver`, `reviewer-contact-audit`, `safe-fetch`,
  `getModelForApp`, `normalizeOrcid` are imported by multiple target modules. Each module imports what it
  needs directly; all are stateless static services — no shared-state concern.
- **C8 — No new Atlas rows / no new gate violations.** Pure code motion within `lib/services/` — no new
  data ownership, so no new `check:atlas` rows. Verify each stage against the touched gates
  (`check:doc-symbol-refs`, `check:doc-currency`, `check:agent-wiki`, plus the LAW gates for the
  persistence stage), per CLAUDE.md rule 4.
- **C9 — Tier extraction: mutable `result` + early-return control flow (the Q1-B care-point).**
  Rewritten after Codex round 1 (BLOCKER-2: the first draft only cited Tier 0's early return). The tiers
  mutate `result.contactEnrichment` in place and mix **terminal short-circuits**, **fall-through
  mutations**, and a **throw**. The control-flow inventory below is line-cited but **Stage 0 must confirm
  it is exhaustive** against the full :468–901 body (round 2 found round 1's list incomplete — do not
  treat this as final):
  - **Terminal returns through `_finalize`:** Tier 0 affiliation email `return this._finalize(…)`
    [:566]; Tier 1 **recent** PubMed email [:602]; the final catch-all return [:876].
  - **Tier 3 aborts by THROWING**, not finalizing [:772] — the shell must let it propagate, not convert
    it to a finalize.
  - **Fall-through (mutate, then continue to the next tier):** a *stale* (non-recent) PubMed email falls
    through; ORCID email/website/affiliation fall through; **ORCID errors + no-credential skips fall
    through** [:675–682]; the no-anchor abstain mutates then falls through; **Tier 3 skipped-no-anchor /
    no-API-key branches** [:777–780]; Tier 3 **non-abort** errors are swallowed (caught, not rethrown);
    **Tier 4 SerpAPI non-abort errors + no-key skips** [:859–872]; Tier 4 skips when **any** email already
    exists (not just a recent one). (Expanded in R2 — the round-1 list named the branch *classes* but not
    every concrete skip/error branch; this enumeration is now line-cited, but Stage 0 must still confirm
    it is complete against the full :468–901 body before extraction.)
  - **`_finalize` arg fidelity:** the early returns use the default `scholarCandidate = candidate`,
    while the final return passes `scholarCandidate: searchCandidate` — the extracted shell/sentinel must
    reproduce **each call's exact `_finalize` args**, not a single normalized call.

  When the tiers move to `tiers.js`, an `applyTierN` must signal "terminal / finalized" vs. "continue"
  vs. "throw" to the shell so no tier that used to run is skipped and none that was skipped now runs.
  The characterization suite must exercise every tier's found / not-found / stale / abort / non-abort-error
  branch AND the inter-tier short-circuit boundaries BEFORE the extraction.
- **C10 — Spyable facade dispatch (round-1 BLOCKER-1; the sharpest behavior-freeze trap).** Several tests
  `jest.spyOn(ContactEnrichmentService, 'saveToDatabase' | 'claudeWebSearch' | 'enrichCandidate')`
  [VERIFIED via grep tests/, S336 — e.g. contact-enrichment-affiliation-pin.test.js:137,309;
  contact-enrichment-abort.test.js:173; contact-enrichment-scholar-metrics.test.js:137,40]. These edges
  are called **internally**: `_finalize` calls `this.saveToDatabase` [:1276], Tier 3 calls
  `this.claudeWebSearch` [:717], `enrichCandidates` calls `this.enrichCandidate`. If the extracted
  `tiers.js`/`_finalize` code invokes these as **closed-over imported functions**, the class-level spies
  no longer intercept → both the tests break AND any real caller relying on the override sees different
  behavior. **Requirement:** the moved implementations must dispatch these spy-patched edges **through the
  facade class** (e.g. pass the facade as `this`, or inject `this.claudeWebSearch`/`this.saveToDatabase`/
  `this.enrichCandidate`), NOT via direct module imports. This is the one place where "self-call → direct
  import" (the normal C3 rewrite) is FORBIDDEN.
- **C11 — Runtime `process.env` reads + dynamic ESM imports must not be hoisted (round-1 MAJOR-6).**
  `_attachEmailFromResolvedPage` reads `process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED` **at call time**
  [VERIFIED via :1181]; a test mutates that env **after import**
  [VERIFIED via resolved-page-email-tier-service.test.js:37]. So the flag must NOT be hoisted to a
  module-load `const` in `page-email.js` — keep the read inside the function. Likewise `claudeWebSearch`
  uses **three dynamic `import()`s of ESM** [VERIFIED via :1645 `ai-payload-boundary`, :1660 `llm-client`,
  :1722 `ai-output-schema`]; `search-tiers.js` must preserve **all three** dynamic imports (no static
  top-of-file `require`/`import` conversion — `ai-output-schema.js` and the payload-boundary util are ESM
  and cannot be `require`d from CommonJS). (R2 added the third import — round 1 named only two.)
- **C12 — `_finalize` step ordering is a load-bearing invariant (round-2 new MAJOR).** `_finalize` runs a
  fixed sequence: OpenAlex metrics → identity resolve → institution-domain evidence → resolved-page email
  → domain validation → name-mismatch readjudication → contact-lead collection → affiliation override →
  persistence [VERIFIED via :1243–1276]. The in-code comments state several steps depend on a prior
  step's output (e.g. domain validation runs *after* the domain sets are built; lead collection runs
  *after* the cross-check discards; the affiliation pin runs *after* `resolveIdentity` so the override
  can't corrupt the evidence basis). When `_finalize` moves to `tiers.js`, this exact order must be
  preserved — C9 covers `_finalize`'s *arguments*, C12 covers its *internal step order*. Stage 9's
  characterization must assert the order (e.g. spy call-order on the step methods), not just the outputs.

## Staging (leaf-first, each stage independently green + reviewed)

Cadence per stage: **trace → land characterization coverage (baseline green pre-extraction,
mutation-prove it discriminates) → extract one cluster → run suite + touched gates → fresh-context Codex
review → commit.** Leaf modules first so the facade delegates incrementally and the DAG never breaks.

- **Stage 0 — `constants.js` + `abort.js` + facade wiring + mechanical call-graph. ✅ EXECUTED (S336,
  `3f5c0fb8`).** Extracted `CLAUDE_WEB_SEARCH_SCHEMA`/`SEARCH_EMAIL_SOURCES`/`EXPLICIT_EMAIL_PERSIST_SOURCES`/
  `COSTS` to `lib/services/contact-enrichment/constants.js` and `abortError`/`isDeadlineAbort` to
  `lib/services/contact-enrichment/abort.js` (verbatim); facade `require`s both and re-exposes
  `ContactEnrichmentService.COSTS`. No method bodies moved. Ran the mechanical call-graph and replaced the
  sketch dependency column with the VERIFIED table above (acyclic DAG confirmed). Verified: module loads,
  `COSTS` static identity-equal, values intact; 11 covering suites / 181 tests green; eslint clean; touched
  gates green (`prompt-injection-tagging`, `dataverse-access-layer`, `route-service-boundary`,
  `dynamics-context-boundary`, `doc-symbol-refs`, `atlas`, `agent-wiki`). [RECHECKED after
  lib/services/contact-enrichment/constants.js + abort.js + contact-enrichment-service.js change: this note
  matches the committed Stage 0 state (`3f5c0fb8`).]
- **Stage 1 — `identity-anchor.js`** (leaf; 9 methods). Characterize the untested ones first.
- **Stage 2 — `domain-evidence.js`** (depends on Stage 1).
- **Stage 3 — `email-adjudication.js`** (depends on domain-evidence; heavily test-pinned — largely
  already covered).
- **Stage 4 — `openalex-metrics.js`** (independent leaf).
- **Stage 5 — `page-email.js`** (depends on domain-evidence).
- **Stage 6 — `search-tiers.js`** (Tier-3 LLM + scholar URL). Carries the C6 A7 marker AND, in the same
  commit, updates the `check-prompt-injection-tagging.js` registry `callSiteFiles` to the new path; keeps
  all three dynamic ESM imports (C11); then run `check:prompt-injection-tagging`.
- **Stage 7 — `cost.js`** (trivial leaf).
- **Stage 8 — `persistence.js`** (the DAL write unit; C5). **Highest scrutiny + the three LAW gates.**
  Land last of the leaves so the write path moves as an isolated, independently reviewed step.
- **Stage 9 — `tiers.js` (Q1-B tier extraction; C9). The single highest-risk stage.** Only after every
  leaf it depends on (Stages 1–8) is extracted and green. First enumerate all early-return/short-circuit
  paths (C9) and land a mutation-proven characterization suite covering every tier's found/not-found
  branch + the inter-tier short-circuit boundaries; then move the five tier bodies + `_finalize` +
  `_applyAffiliationOverride` into `tiers.js`, leaving the ~120 L `enrichCandidate` shell on the facade.
  Fresh-context Codex review with the tier control-flow diff as the focus.
- **Stage 10 — facade finalize / dead-import cleanup.** Drop imports now only used by moved modules;
  confirm the facade is the `enrichCandidate` shell + `enrichCandidates` + delegating wrappers +
  `COSTS` re-export, ~350 L.

## Open questions

- **Q1 — DECIDED (owner, S336):** Q1-B, extract the tiers (facade ~350 L). See the Q1 section + C9.
- **Q2 — DECIDED (owner, S336):** 10 leaf modules as sketched (+ `tiers.js` from Q1-B = 11 total under
  `lib/services/contact-enrichment/`); no coarser fold.
- **Q3 (Codex round 1):** verify the regenerated per-method dependency column is complete and acyclic
  (the discovery round-1 BLOCKER class), and that C9's early-return enumeration is exhaustive.
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
