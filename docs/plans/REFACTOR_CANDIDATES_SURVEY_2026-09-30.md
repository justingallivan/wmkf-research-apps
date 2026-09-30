---
title: Refactor Candidates Survey — 2026-09-30
domain: architecture
kind: plan
status: proposed
summary: Evidence-ranked, behavior-preserving refactor candidates at cd177c471, with active-work exclusions, graph limitations, and separate bug leads.
canonical: false
owner: product-engineering
---

# Refactor candidates survey — 2026-09-30

## Scope and recommendation

[VERIFIED via `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`, and `pwd`] Survey base: `cd177c471e9c9c6fd8a725c9765cbe31b5f6c2f3`, branch `codex/refactor-survey`, directory `/Users/gallivan/Code/WMKF_Apps-refactor`. Fetch succeeded; no pull or merge changed this base. This deliverable is one plan document; no implementation or release is authorized by it.

[ASSUMED] Prefer small extractions with unchanged public behavior. The five eligible candidates, in score order, are the roster projection, roster API orchestration, review-document hash canonicalization, Explorer executable tests with additive readiness coverage, and old read-only probe bootstrap duplication. The last has zero recent churn and is explicitly a **do-later** item, despite being fifth among eligible candidates. Do not turn this ranking into a broad cleanup campaign.

[VERIFIED via docs/SYSTEM_MODEL.md:36, docs/SYSTEM_MODEL.md:160, docs/SYSTEM_MODEL.md:180, docs/APPLICATION_STATE_ATLAS.md:18, docs/SERVICE_AND_UTILITY_CATALOG.md:21] The model distinguishes platform contracts, domain services, capabilities and substrate; the Atlas and service catalog provide storage/contract context. These are conceptual decomposition rules, not proof that every current route is a thin shell. The analysis also consulted `CLAUDE.md`, `docs/CLAUDE_REMEDIATION_PLAN.md`, `docs/CI_GATES_REFERENCE.md`, the release strategy, the queue, session handoff and standing memories.

[VERIFIED via docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:104] The survey itself is Tier 0. Candidate tiers below are **[ASSUMED] conservative classifications** using that document's §4: Tier 1 for contained internal behavior-preserving changes, Tier 2 for persistence/auth/email/background/cross-layer work, Tier 3 for shared-layer replacement. Hours include characterization, edits, focused checks and review, but exclude owner-operated live rehearsal and waiting for release windows.

## Method and metric limits

[VERIFIED via `git ls-files lib pages/api shared scripts` and Appendix A] Inventory covers 1,616 tracked JavaScript/TypeScript modules (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`) under the requested roots, including `scripts/archive/` for the size census. SQL/JSON/Markdown are not counted as modules. LOC means physical lines including comments and blanks. There is no size threshold that proves a module should be split.

[VERIFIED via `codegraph explore "pruneCandidateForRoster"` and CodeGraph `project_metadata`] The worktree initially had no index. The owner created it during this survey; the inspected index reports `complete`, 2,958 accounted files, CodeGraph 1.3.0/extraction 24. Graph queries subsequently used this worktree. A sandbox SQLite-open failure was resolved with host-level read queries; no index was built or edited by the survey agent.

[VERIFIED via Appendix A graph census] **G** is the count of distinct source-symbol IDs with cross-file `calls` or `instantiates` edges into any symbol of a target module, with edge confidence at least 0.7 (absent confidence treated as 1). Test-directory and archive callers are excluded. **GF** is distinct source files on those same edges. **S** is distinct non-test/non-archive files with literal AST import/re-export/require/dynamic-import edges to that module. S was computed across 1,736 tracked source files, with zero parse failures. These measure different things: G counts calling symbols, GF calling files, S importing files. None measures HTTP traffic or execution frequency; a route/CLI can have S=0 and still be live. Symbol-level counts quoted from `codegraph explore` are its unfiltered displayed counts, not G or GF.

[VERIFIED via Appendix A raw graph query] A raw graph census contains false name-only matches: `scripts/reset-request-reviewers.mjs` has 367 apparent calling symbols because unrelated `sql` uses resolve to its local helper at confidence 0.4. The filtered table prevents those edges from driving the ranking. It does not prove all remaining edges correct. Inspect named paths before implementation; graph “no covering tests” is also not proof of no tests (the canonicalizers have enclosing service tests).

[VERIFIED via `git log --since=2026-07-03T00:00:00-07:00 --until=2026-10-01T00:00:00-07:00 --no-merges --format=%H HEAD -- <scope>`] **C90** counts distinct reachable non-merge commits touching a candidate's exact file set in the 90 calendar dates July 3–September 30, 2026, Pacific time. Multi-file commits count once. Branch/cherry-pick history can overcount equivalent edits; the survey does not equate commits with incidents or production changes.

[ASSUMED] Ranking score = **B × C90 ÷ H**. B estimates the number of independently coupled responsibilities/copies removed, not total callers: C1=3 (persistence projection, UI logic, service dependency direction); C2=3 (HTTP shell, authority reconciliation, domain orchestration); C3=2 (three copies become one); C4=1 (one brittle Explorer source-slicing seam; readiness census is retained); C5=2 (three bootstrap copies become one). H is estimated hours. This is a transparent prioritization heuristic, not a measured reduction in failures. C1 and C2 benefits overlap; do not add their scores as a portfolio return. Re-score after either lands. Active-work/decision conflicts are excluded **before** scoring.

## Largest modules

[VERIFIED via Appendix A LOC/AST/graph/git commands] Top ten by physical line count. G/GF and S retain the graph/static distinction. These are survey observations, not ten recommendations.

| Module | LOC | G / GF | S | C90 | Disposition |
|---|---:|---:|---:|---:|---|
| `lib/services/test-requests/run-runner.js` | 4256 | 1 / 1 | 1 | 70 | [ASSUMED] Blocked: Factory B4 |
| `scripts/setup-database.js` | 2990 | 0 / 0 | 0 | 68 | [ASSUMED] Blocked: shared schema/059/B4 |
| `lib/dataverse/adapters/reviewer-suggestion.js` | 2510 | 81 / 54 | 80 | 72 | [ASSUMED] Blocked: B4 binding and lifecycle surface |
| `lib/services/post-presentation-materials/material-service.js` | 1953 | 6 / 6 | 6 | 6 | [ASSUMED] Do not split just after release |
| `lib/services/reviewer-finder/save-candidates-service.js` | 1788 | 2 / 2 | 1 | 44 | [ASSUMED] Avoid broad identity/promotion rewrite |
| `shared/components/workbench/StaffDeliberationsTab.js` | 1704 | 1 / 1 | 1 | 35 | [ASSUMED] Only consider measured UI seams |
| `lib/services/review-manager/send-emails-service.js` | 1578 | 1 / 1 | 1 | 35 | [ASSUMED] Blocked: email/ledger ownership |
| `shared/components/workbench/AwardeeTab.js` | 1519 | 4 / 4 | 1 | 27 | [ASSUMED] Avoid broad awardee UI rewrite |
| `scripts/evaluate-reviewer-page-first-email.mjs` | 1485 | 0 / 0 | 0 | 1 | [ASSUMED] Cold evaluation script; leave |
| `lib/services/test-requests/basic-clone-steps.js` | 1473 | 59 / 7 | 6 | 15 | [ASSUMED] Blocked: Factory B4 |

[VERIFIED via `codegraph node -f lib/dataverse/adapters/reviewer-suggestion.js --symbols-only`] The adapter exposes 83 indexed symbols and is used by 95 indexed files in file-mode output (includes tests and more edge kinds). It is not comparable to the filtered 81 calling symbols / 54 files or 80 AST importing files above. [VERIFIED via `codegraph node -f lib/services/test-requests/run-runner.js --symbols-only`] The runner has 122 symbols and 11 indexed dependent files including tests. The large runner remains one production CLI entry in the filtered census.

## Highest caller fan-in

[VERIFIED via Appendix A graph census] Top ten modules by G, sorted across all inventory targets, with size and static imports beside them. High fan-in in a small, stable primitive is usually a reason to preserve its contract.

| Module | G | GF | S | LOC | C90 |
|---|---:|---:|---:|---:|---:|
| `lib/services/dynamics-service.js` | 416 | 176 | 171 | 479 | 14 |
| `lib/utils/guid.js` | 242 | 155 | 155 | 57 | 1 |
| `lib/dataverse/core/context.js` | 217 | 208 | 211 | 68 | 1 |
| `lib/utils/auth.js` | 196 | 192 | 193 | 462 | 13 |
| `lib/services/service-http-error.js` | 188 | 94 | 226 | 41 | 1 |
| `lib/services/dynamics-context.js` | 183 | 147 | 148 | 243 | 3 |
| `lib/services/graph-service.js` | 175 | 93 | 70 | 335 | 46 |
| `shared/utils/api-request.js` | 133 | 91 | 92 | 215 | 4 |
| `lib/dataverse/core/odata.js` | 124 | 46 | 42 | 83 | 2 |
| `lib/dataverse/adapters/grant-request.js` | 110 | 96 | 116 | 382 | 19 |

[VERIFIED via `codegraph explore "DynamicsService"`, `codegraph explore "ServiceHttpError"`, `codegraph explore "withDalContext"`, `codegraph explore "requireAppAccess"`, `codegraph explore "isGuid"`, `codegraph explore "GraphService"`] Representative displayed symbol counts are respectively 181, 473, 462, 398, 399 (the `lib/utils/guid.js` symbol), and 77. They include kinds/callers outside the filtered module metric. Do not substitute a class's displayed count for the union of all methods in its module.

[VERIFIED via Appendix A raw graph query] For transparency, the **unfiltered-confidence** top ten G values are: Dynamics service 416; `scripts/reset-request-reviewers.mjs` 367; GUID utility 242; `scripts/test-profiles.js` 225; DAL context 217; auth 196; ServiceHttpError 188; OData 183; Dynamics context 183; Graph service 175. Same source/archive/test filtering, but no confidence threshold. The spurious script ranks are why the main table uses the explicit threshold.

## Eligible ranking

[ASSUMED] All B, hours, risk tiers, expected benefits and “why” judgments in this table are estimates. [VERIFIED via the exact scope lists below and the C90 command] C90 and scores computed from those inputs are reproducible.

| Rank / ID | B | C90 | H | Score | Tier | Why now / why not now |
|---|---:|---:|---:|---:|---|---|
| 1 / C1 — Separate the roster persistence projection from UI search logic | 3 | 45 | 12 | 11.25 | 2 | Frequent edits reach both server storage and UI; preserve the DTO byte-for-byte. |
| 2 / C2 — Move roster orchestration behind the HTTP shell | 3 | 35 | 16 | 6.56 | 2 | The large route owns domain reconciliation; keep the separate partial-success bug out of the extraction. |
| 3 / C3 — Consolidate three review-document canonicalizers | 2 | 11 | 8 | 2.75 | 2 | Identical pure copies govern durable hashes; golden vectors must pin every byte. |
| 4 / C4 — Execute Explorer configuration assertions; augment readiness coverage | 1 | 4 | 4 | 1.00 | 0 | Cheap mock/pure tests remove Explorer formatting coupling while retaining readiness drift protection. |
| 5 / C5 — Consolidate bootstrap in three read-only probes | 2 | 0 | 6 | 0.00 | 2 | Real duplication but no 90-day edits: wait until one of these probes needs maintenance. |

### C1 — Roster projection ownership

[VERIFIED via shared/components/reviewers/reviewer-search-logic.js:1017, shared/components/reviewers/reviewer-search-logic.js:1026, pages/api/workbench/reviewer-roster.js:395, lib/services/reviewer-roster-store.js:112] `pruneCandidateForRoster` mixes render projection with durable identity/persist flags in a 1,231-line UI-named module. The route prunes again before `recordSurfaced` persists JSON into `reviewer_find_roster`; the discovery hook also uses the projection before POST. [VERIFIED via `codegraph explore "pruneCandidateForRoster"`] The symbol has **23 displayed callers**; the module has **15 S**. The graph exposes paths through `enrich-recommended-service`, `discover`, `reviewer-roster` and search hooks. [ASSUMED] Extract only the pure projection and its necessary pure helpers into a neutral shared domain module, retaining a compatibility export. No DTO redesign, field removal, key changes, new authority, or database migration. The active reviewer measured program remains untouched: this is a projection move, not identity-policy tuning or legacy-reader retirement. Score scope: `shared/components/reviewers/reviewer-search-logic.js` only.

[ASSUMED] Tier 2, 12 hours. Why now: one frequently edited module crosses browser and persistence boundaries; why not broaden: presentation trimming is not permission to change server trust semantics. [VERIFIED via shared/components/reviewers/reviewer-search-logic.js:1048, pages/api/workbench/reviewer-roster.js:399, lib/services/reviewer-roster-store.js:119, shared/components/reviewers/search/useReviewerDiscovery.js:279] Preserve identity permission flags, receipt verification, curation-winning upsert, and post-await generation checks. [ASSUMED] Regression defenses: existing `reviewer-search-logic`, `reviewer-candidate-attestation`, `reviewer-vetted-email`, `contact-leads-roster-promotion`, `reviewer-roster-endpoint` suites; `check:types`, `check:route-service-boundary`, `check:status-enum-parity`, and `reviewer-search-boundary.test.js`. Structural gates will not prove projection equivalence: compare complete outputs for existing fixtures, including raw enrichment present but excluded, false-over-true persist flags, reloads, and same-name/different-identity candidates. A changed serialized candidate falsifies the behavior-preserving premise.

### C2 — Roster route orchestration

[VERIFIED via pages/api/workbench/reviewer-roster.js:81, pages/api/workbench/reviewer-roster.js:145, pages/api/workbench/reviewer-roster.js:374, pages/api/workbench/reviewer-roster.js:455] The 679-line route performs HTTP dispatch, strips client authority, verifies receipts, restores stored authority and orchestrates writes. [VERIFIED via `codegraph explore "handlePost"`, `codegraph explore "recordSurfaced"`] Its local `handlePost` has **1 displayed caller**, while `recordSurfaced` has **6 displayed callers** across the route and services. Route S=0 is expected for a filesystem endpoint, not dead-code evidence; store S=10. [ASSUMED] Put authority reconciliation and roster commands behind a domain service, leaving method/auth/validation, DAL entry and exact HTTP mapping in the route. Preserve the request-scoped receipt/key binding and current result envelope. Score scope: `pages/api/workbench/reviewer-roster.js` only. This is a conceptual layering correction; it is **not** an existing route-boundary gate violation.

[ASSUMED] Tier 2, 16 hours; sequence after C1 or reassess overlapping helper moves. Why now: 35 commits in the route make mixed responsibilities costly. The possible partial-success bug at the end of this survey needs a separately scoped decision/reproduction before implementation; do not silently fix it in an extraction. [VERIFIED via scripts/check-route-service-boundary.js:6, scripts/check-route-service-boundary.js:23] The boundary gate prohibits direct adapter/Dynamics access and permits normal service calls; it cannot detect arbitrary domain logic left in a handler. [ASSUMED] Existing regression defenses: `reviewer-roster-endpoint.test.js`, `reviewer-roster-store.test.js`, `workbench-reviewer-roster-projection-service.test.js`, `reviewer-search-roster-contract.test.js`, `check:api-routes`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:dynamics-context-boundary`, and `check:route-service-boundary`. Exercise GET/POST/PATCH, forged receipts, stale candidate keys, partial storage failures and mixed authority sources; an auth-order/status/body or write-order difference falsifies the extraction contract.

### C3 — Review-document canonicalization

[VERIFIED via lib/services/review-documents/backfill-service.js:30, lib/services/review-documents/repair-service.js:23, lib/services/review-documents/individual-file-service.js:85] Three functions have the same recursive shape: preserve array order, return primitives, sort object keys, recursively map values; each feeds a JSON SHA-256 digest. [VERIFIED via `codegraph explore "canonicalize"`] Displayed local caller counts are **5 / 4 / 1**, respectively; module S counts are **1 / 1 / 3**. A fourth identical copy exists in `lib/services/reviewer-promotion-repair-classifier.js:179`; leave it outside the first slice because it owns a different manifest contract. [ASSUMED] Introduce one pure helper within the review-document domain and preserve each public digest/manifest function and its metadata. Score scope is exactly the three review-document files just cited.

[ASSUMED] Tier 2, 8 hours because hash bytes govern durable artifact/repair identity. Why now: three identical copies can drift; why not replace them with a generic serializer: Date/toJSON, undefined, numeric-looking keys, arrays, and Unicode can change digests under an apparently equivalent library. [VERIFIED via lib/services/review-documents/repair-service.js:61, lib/services/review-documents/backfill-service.js:54, lib/services/review-documents/individual-file-service.js:94] The consumers are manifest projections and content fingerprints, not UI formatting. [ASSUMED] Existing defenses: `review-docx-repair-service.test.js`, `review-docx-backfill-service.test.js`, the individual-file service suite and both CLI suites; `check:request-document-writers`, `check:reviewer-engagement-boundary`, `check:dataverse-access-layer`, `check:types`. Those gates protect write ownership, not hash parity. Require old/new digest equality over retained manifest fixtures and edge-case pure inputs before any replacement; keep target proof, ETags, cleanup ownership and upload behavior untouched.

### C4 — Executable tests at cheap seams

[VERIFIED via tests/unit/dynamics-explorer-call-config.test.js:4, tests/unit/dynamics-explorer-call-config.test.js:9, tests/unit/dynamics-explorer-call-config.test.js:16, lib/services/dynamics-explorer/model-call.js:8] The Explorer test slices text by function name and a decorative comment, then regex-matches token/effort configuration; production source explicitly carries marker comments to satisfy it. [VERIFIED via tests/unit/review-synthesis-readiness.test.js:178] The readiness suite also derives an emitted-reason inventory with source regexes, though it already has executable fixtures for most branches. [VERIFIED via `codegraph explore "callClaude"`, `codegraph explore "callClaudeBatch"`, `codegraph explore "evaluateReviewSynthesisReadiness"`] Target symbols have **2 / 3 / 10 displayed callers**; their modules have **2 / 5 S**, respectively (the two model functions share one module). [ASSUMED] Replace only the Explorer source-slicing assertions: mock `LLMClient` and assert the actual stream/complete arguments. Add readiness fixtures for uncovered malformed booleans/date/status/token cases through the public function, while retaining its source reason-inventory check: it detects newly emitted reasons absent from the exported allowlist, which fixtures limited to known inputs cannot guarantee. Score scope is exactly the two test files, not the whole implementation churn.

[ASSUMED] Tier 0, 4 hours, with no provider calls or runtime edits. Why now: a tiny isolated change can prevent “present in source but never executed” false confidence. Preserve AST boundary/census tests and schema-file parity checks whose purpose is structural: `api-error-response-hygiene.test.js`, `reviewer-search-boundary.test.js`, `send-emails-service-skip-reason-literals.test.js`, migration/schema parity and secret gates are not bad merely because they inspect source. [VERIFIED via the focused Jest command in Validation] Both selected suites passed at the baseline; the readiness census remains a useful structural test. [ASSUMED] Existing `check:status-enum-parity`, `check:model-registry` and `check:types` provide adjacent safeguards, but **no existing static gate proves that an LLM call receives the intended options**. Run both suites with network mocked; dropping `outputConfig`, switching the batch token limit, or omitting a blocker branch must make a behavioral test fail. This is a bounded test conversion, not a rewrite of the test corpus.

### C5 — Script bootstrap duplication

[VERIFIED via scripts/probe-akoya-wmkf-type-misc.js:14, scripts/probe-akoya-wmkf-type-taxonomy.js:21, scripts/probe-akoya-active-nodate.js:18] These three probes repeat the same environment parsing shape; their OAuth-token POST blocks also match at lines 25, 36 and 29. [VERIFIED via `codegraph node -f scripts/probe-akoya-wmkf-type-misc.js --symbols-only`, `codegraph node -f scripts/probe-akoya-wmkf-type-taxonomy.js --symbols-only`, `codegraph node -f scripts/probe-akoya-active-nodate.js --symbols-only`] Each has **0 indexed dependent files** and **0 S** (CLI entry points remain executable by an operator). [VERIFIED via `codegraph explore "getToken"`] The generic query is ambiguous and does not enumerate these three reliably; its counts are **not substituted** for their file-scoped zeroes. [ASSUMED] Consolidate just the identical bootstrap when a probe next changes. Score scope is exactly those three scripts; C90=0, so it earns no priority now.

[ASSUMED] Tier 2, 6 hours because bootstrap includes authentication configuration. Existing `lib/dataverse/client.js:31` is a possible loader reuse point, but [VERIFIED via lib/dataverse/client.js:45, scripts/probe-akoya-wmkf-type-misc.js:17] its parsing rules differ (trim/comment/quote handling and membership vs truthiness for existing env vars); switching loaders blindly is a behavior change. [ASSUMED] Pin missing-file behavior, empty existing variables, quotes, `=` inside values and root resolution before choosing reuse or a scripts-local helper. Keep each probe's distinct pagination/aggregation and read-only query behavior. Existing `check:secret-scan`, `check:dynamics-context-boundary`, `check:script-suggestion-writers` and `check:types` protect only adjacent surfaces; none proves env precedence or GET pagination. A mocked fetch/temporary-env test would be needed. Live execution is **skipped** here because `.env.local` is intentionally absent.

## Duplication, layering and dead-code findings outside the ranking

| Finding | Verified evidence / graph census | Disposition and regression boundary |
|---|---|---|
| Email placeholder substitution has four identical copies | [VERIFIED via lib/external/reviewer-reminder-email.js:41, lib/external/reviewer-withdraw-email.js:18, lib/external/grantee-invite-email.js:75, lib/services/reviewer-acceptance-email.js:34; `codegraph explore "applyPlaceholders applyTemplatePlaceholders"`] Displayed counts 4/1/2/1; S 5/2/6/2; union C90=17. | [ASSUMED] Tier 2, 6–10 h. **Blocked by decision/active ownership:** email ledger work and parked reviewer reminders. Preserve ordered replacement, escaping, signatures, token minting and transport intent. Existing renderer/send suites, `check:status-enum-parity`, `check:reviewer-reminder-hold`, `check:route-lifecycle-auth` would be relevant; they do not authorize changing send semantics. |
| Request-document claim reset repeats in at least three domains | [VERIFIED via lib/services/pre-site-visit/artifact-lineage.js:88, lib/services/initial-assessment/controls-service.js:339, lib/services/final-writeup/transition-claims.js:63, lib/services/pre-rp-brief/artifact-service.js:567] Generating status, claim token, attempts and failure clearing match. [VERIFIED via Appendix A] Respective module G/GF/S: 3/2/3, 4/4/3, 1/1/1, 3/3/5. | [ASSUMED] Tier 2, 16–24 h. **Not now:** similar payload does not prove identical lease recovery. Retain domain guards; do not invent a common state machine. `check:request-document-writers`, domain artifact/transition/race tests and target rehearsal are prerequisites. |
| Route authentication/method shells and SSE framing repeat | [VERIFIED via pages/api/workbench/triage.js:35, pages/api/workbench/export-candidates.js:22, pages/api/workbench/promote-applicant-reviewer.js:23; pages/api/qa.js:87, pages/api/reviewer-finder/discover.js:123, pages/api/review-manager/send-emails.js:101] Three-plus identical shapes; endpoints are filesystem entries. [VERIFIED via Appendix A] Each of these six route modules has G/GF/S=0/0/0, which does not measure its live HTTP use. | [ASSUMED] Tier 2, 12–20 h. **Not now:** a wrapper changes auth/error/disconnect ordering and gate recognition for little demonstrated gain. Keep explicit app-key tuples and typed envelopes. `check:api-routes`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, stream cancellation and route-contract suites would be required. |
| Formal route→Dataverse violations | [VERIFIED via `npm run check:route-service-boundary`, scripts/check-route-service-boundary.js:61] Gate passed; `pages/api/dataverse-export/` is explicitly exempt. | [ASSUMED] No new violation candidate. Do not “fix” the exemption or claim this gate proves conceptual layering throughout the repo. |
| Superseded peer-review generators remain reachable by a barrel | [VERIFIED via shared/config/index.js:45; `codegraph explore "createPeerReviewAnalysisPrompt"`] One displayed caller from the barrel; it is a retained export, not evidence of a live generation call. | [VERIFIED via .claude-memory/project-peer-review-executor-migration.md:25] **Blocked by decision:** rollback path retained. [ASSUMED] Tier 1, 2–4 h if later explicitly released; prompt/A7 tests and `check:prompt-injection-tagging` required. No deletion recommended. |
| Misleading “legacy” classification of live reviewer service | [VERIFIED via docs/APPLICATION_STATE_ATLAS.md:219, docs/SERVICE_AND_UTILITY_CATALOG.md:39, pages/api/reviewer-finder/analyze.js:21, pages/api/reviewer-finder/discover.js:18, lib/services/workbench/enrich-recommended-service.js:30] Live imports contradict a dead-code inference from the Atlas shorthand. [VERIFIED via Appendix A] Module G/GF/S = 12/12/11. | [ASSUMED] Keep `claude-reviewer-service.js`; no rename/removal project. Its catalog explicitly describes it as live and legacy-named. This survey records the discrepancy without editing either durable source. |
| Imports into actual archive directories | [VERIFIED via Appendix A literal AST import census and `rg -n 'claude-reviewer-service|archived/|archive/|peer-reviewer' lib pages/api shared scripts`] Zero resolved live literal import/re-export edges into `_archived/` or `*/archive/` in the inspected census. | [ASSUMED] This is bounded absence, not a deletion proof: computed imports, command execution, documented rollback and human-run scripts remain outside it. No archived code is proposed for removal. |

## Dynamics adapters and cron contracts: preserve the differences

[VERIFIED via `codegraph explore "buildServiceError"`] `buildServiceError` has **43 displayed callers**. [VERIFIED via lib/utils/service-error.js:37, lib/services/service-http-error.js:22] External-service errors carry `status`, service name, transient and Dataverse metadata; route-domain errors carry `httpStatus` and optional exact response body. [ASSUMED] Keep these separate: making one universal error class would conflate transport classification and caller-facing semantics.

| Path | Error / retry / idempotency mechanism | Survey conclusion |
|---|---|---|
| Reviewer suggestion upsert | [VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:553, lib/dataverse/adapters/reviewer-suggestion.js:574] 409/412 plus message-pattern alternate-key classification; reread winner; engagement/ETag guards before selection. [VERIFIED via `codegraph explore "setMatchReason"`] The adjacent `setMatchReason` has 2 displayed callers and rereads/retries a 412 once at lines 199–203. | [ASSUMED] A narrow duplicate-conflict predicate merits later Tier 2 characterization (8–12 h), but adapter edits overlap B4; **blocked**, not ranked. Keep winner recovery distinct from a blind retry. |
| Potential reviewer upsert | [VERIFIED via lib/dataverse/adapters/potential-reviewer.js:402; `codegraph explore "upsertByEmail"`] Alternate-key conflict recovery also uses status/message shape; 4 displayed callers, module S=49. | [ASSUMED] Same prospective predicate study, without merging person identity policy or synthetic-isolation behavior. Existing `reviewer-adapters-writeback`, `adapters-caller-id`, `potential-reviewer-synthetic-isolation` suites and DAL/boundary gates are required. |
| Contact ORCID / parent Account fills | [VERIFIED via lib/dataverse/adapters/contact.js:379, lib/dataverse/adapters/contact.js:395, lib/dataverse/adapters/contact.js:459, lib/dataverse/adapters/contact.js:472; `codegraph explore "setOrcidIfAbsent"`] ORCID has an accepted no-ETag fallback; parent Account instead rejects missing ETag, and both bound reread attempts. ORCID symbol: 1 displayed caller. | [ASSUMED] Do not normalize away the difference. A future policy change is Tier 2 (8–16 h) and needs its own decision; `backprop-reviewer-orcid.test.js` and parent-account tests protect distinct contracts. |
| Intake submission drain | [VERIFIED via lib/services/cron/drain-submissions-service.js:225, lib/services/cron/drain-submissions-service.js:251, lib/utils/drain-error-classifier.js:28, lib/utils/drain-error-classifier.js:97] Durable attempt/category caps and backoff; 409/412 Dataverse classification has create-recovery meaning in this workflow. [VERIFIED via `codegraph node -f lib/services/cron/drain-submissions-service.js --symbols-only`] 3 indexed dependent files including 2 tests. | [ASSUMED] Keep the classifier workflow-scoped. Tier 2, 16–24 h to reorganize; **blocked by parked intake product**. `drain-record-failure`, `drain-submissions-dal-context`, classifier/error-shape tests are relevant. |
| Grantee title cron | [VERIFIED via lib/services/cron/generate-grantee-titles-service.js:63, lib/services/cron/generate-grantee-titles-service.js:152, lib/services/cron/generate-grantee-titles-service.js:171, lib/services/cron/generate-grantee-titles-service.js:193; `codegraph explore "runGranteeTitleGeneration"`] 3 displayed callers; module S=1. Empty-field selection is the next-tick retry queue; fresh read + required ETag precede PATCH; 412 means concurrent skip. | [ASSUMED] Tier 2, 8–12 h for a bounded extraction, **not now**: different durable outcome than intake or email. Existing `cron-batch-services`, `generate-grantee-titles-cron`, `grantee-title-service` suites apply. Timer abandonment is a separate bug lead below. |
| Scheduled email / reviewer follow-up | [VERIFIED via SESSION_PROMPT.md:43, SESSION_PROMPT.md:103, docs/CURRENT_WORK_QUEUE.md:238] Part A hardening and reviewer-reminder ledger promotion have explicit ownership/sequence. | [ASSUMED] No generic cron retry/idempotency framework. Tier 2 for a narrow engine change; Tier 3 for replacement (40–80 h rough envelope). Live-Postgres crash/fencing tests, reminder-hold and lifecycle gates are required. **Blocked by decision/active work.** |

## Blocked by decision — excluded before ranking

[VERIFIED via `rg -n -i 'do not reopen' .claude-memory`, .claude-memory/project-peer-review-executor-migration.md:25, .claude-memory/project-merge-candidates-authorization-gap.md:78] The literal memory search found the peer-review rollback and org-open merge decisions. Both complete memories, the broader org-open decision, the deferred cleanup register, queue and current session section were inspected. Older historical handoff sections are not new authorization.

| Surface / tempting cleanup | Block and release condition | Tier / effort if separately authorized; safeguards |
|---|---|---|
| Factory runner/basic clone, reviewer-suggestion binding, shared setup/migrations | [VERIFIED via SESSION_PROMPT.md:16, SESSION_PROMPT.md:43; owner task assignment] Factory B4 belongs to the other Codex worktree; 058/V57 and 059/V58 allocation is settled. | [ASSUMED] Tier 2, 24–48 h for runner decomposition; Tier 3, 40–80 h for adapter replacement. Factory run-runner/clone/live-PG tests, migration manifest, DAL, reviewer-engagement, script-writer and isolation gates. Do not rank their high churn as available work. |
| Scheduled email engine/store, grantee-reminder cron, shared email rendering | [VERIFIED via SESSION_PROMPT.md:43, SESSION_PROMPT.md:103; owner task assignment] Claude's ledger/Part A work; reviewer cron-reminder promotion is also parked in the queue. | [ASSUMED] Tier 2, 16–32 h for a narrow later decomposition, or the 6–10 h renderer slice above. Keep send intent, recipient generation, approval, leases and reconciliation decisions. Live-PG crash tests and reminder/send suites required. |
| Workbench Integrity repeated reads / vendor empty-result cleanup | [VERIFIED via SESSION_PROMPT.md:46, docs/CURRENT_WORK_QUEUE.md:704] Findings 6/9 have an owner-directed next session; real vendor empty-response evidence is required. | [ASSUMED] Tier 1 for read consolidation, 4–8 h; Tier 2 if review-state behavior changes. Workbench integrity/unit/live-PG suites. Do not duplicate another agent's task or reopen re-screen permission. |
| `evaluateCrossFieldNamesakeGuard` removal | [VERIFIED via .claude-memory/project-deferred-code-cleanup.md:29] Deferred retirement requires proving no input both enters PubMed and triggers this guard. | [ASSUMED] Tier 2, 4–8 h verification/removal if authorized. Discovery/field-aware verification tests and a graph+live-input reachability audit; apparent inertness is not proof. |
| Legacy peer-review prompt generators / org-open merge restrictions | [VERIFIED via .claude-memory/project-peer-review-executor-migration.md:25, .claude-memory/project-merge-candidates-authorization-gap.md:78] Do not reopen without new decision. | [ASSUMED] Tier 1, 2–4 h for rollback cleanup; Tier 2, 8–16 h for authorization change. Executor/A7 and merge contract tests respectively. Neither is recommended. |
| Intake product, BILL onboarding, destructive reviewer cleanup | [VERIFIED via docs/CURRENT_WORK_QUEUE.md:659, docs/CURRENT_WORK_QUEUE.md:613] Parked programs; reviewer legacy readers/Track B remain until promotion plus a complete campaign. | [ASSUMED] Tier 3, 40–80+ h for a program replacement; no useful implementation estimate until scope is reopened. Full lifecycle, persistence and external-user rehearsal, not merely unit tests. |
| Retired-table operational scripts | [VERIFIED via docs/CURRENT_WORK_QUEUE.md:266, scripts/README.md:21] Quarantine/removal needs approved scope and caller review. | [ASSUMED] Tier 1, 4–8 h for code quarantine only; Tier 2/3 if data deletion enters scope. No execution here; import census alone cannot authorize removal of operator tooling. |
| J27 transitions, fixed-expiry fixtures, Liaison residuals | [VERIFIED via docs/CURRENT_WORK_QUEUE.md:44, docs/CURRENT_WORK_QUEUE.md:67, SESSION_PROMPT.md:57] Named/deferred work already exists. | [ASSUMED] Tier 0, 2–4 h for proven clock-fixture repair; J27/Liaison behavior is Tier 2 and needs separate scope. Keep this survey out of those decisions. |

## Explicitly not recommended

[ASSUMED] Do not replace Dynamics/Graph facades, auth, DAL context, GUID or OData primitives because they have high fan-in. The stable seam is valuable; whole-layer replacement is Tier 3. The observed 479-line Dynamics and 335-line Graph facades are not the original monoliths. [VERIFIED via lib/services/graph-service.js:48, lib/services/graph-service.js:241] Graph methods delegate into leaves already.

[ASSUMED] Do not split the just-released 1,953-line presentation material service or broadly rewrite StaffDeliberations/Awardee panels solely for size. Estimated narrow UI split: Tier 1, 8–16 h each; material lifecycle split: Tier 2, 16–32 h, only with upload/lease/identity/cleanup characterization and relevant request-document tests. [VERIFIED via SESSION_PROMPT.md:5] The presentation release has a recent bounded acceptance record; it is not a cleanup backlog item.

[ASSUMED] Do not broadly rewrite the 1,788-line save-candidates service (Tier 2, 24–40 h; save/promotion/identity/attestation suites plus DAL/reviewer-engagement gates), or the 1,485-line evaluation script (Tier 1, 8–16 h; evaluator fixtures). Their size does not justify identity-policy or evaluation-protocol changes. Do not delete a compatibility facade or legacy-named service from a zero/low count; incoming HTTP, CLI and historical recovery paths are not graph calls.

[ASSUMED] Do not unify retries, claim reset payloads or email template rendering across domains during active ledger work. Do not migrate prompts, storage tiers, the Pages Router, provider SDKs or application architecture as incidental refactoring. The system model labels several future concepts as target state; this survey does not convert those into built-state claims or approved work.

## Contract review and validation

[VERIFIED via the traces above] `/contract-reconcile` review surface: this plan, consumed by future implementers; persistence changed now: only the Markdown document. For C1/C2, trace is discovery hook → roster API → authority reconciliation → roster JSON → reload/UI. C3 is operator/service → canonicalization/digest → manifest/fingerprint comparison → guarded document write. C4 is executable test → mock/pure function → asserted output, with persistence N/A. C5 is operator CLI → bootstrap → OAuth/GET → console, with persistence N/A. None is implementation-ready solely because it is ranked.

[ASSUMED] Audit dispositions: whole-flow and helper-semantic risks are documented; partial success and timer abandonment are separated as bug leads; async guards must remain; durable schema/enum additions are out of scope; no new enum fan-out exists. Before implementation, recheck current branch/source, blocked-work ownership, characterization and gate scope. A source-only survey cannot prove live target posture, live data, current deployment or absence of all defects. [VERIFIED via fresh read-only agent review] The reviewer independently reproduced the 23 roster, 3 title-cron and 5/4/1 canonicalizer displayed counts and identified the C4 reason-census preservation and route metric corrections incorporated here. Repository-wide doc reconciliation is intentionally **not performed** under the one-document constraint; the Atlas/catalog discrepancy is recorded, not declared reconciled.

[VERIFIED via sequential `npm run check:*` execution from package.json, excluding `:self-test`] `/start` baseline ran **38 non-self-test checks: 37 passed, 1 failed**. The failure is `check:agent-invariants`: missing Claude memory symlink for this worktree; tracked `AGENTS.md -> CLAUDE.md` and `.agents/skills -> ../.claude/skills` were present, and `check:agent-invariants:ci` passed. The requested one-file guardrail takes precedence over creating that machine-local symlink. Fixture-writing self-tests were not run because they would write additional files. `check:types` ran with `--incremental false` to avoid a build-info artifact. No new check script was added to `/start`.

[VERIFIED via startup gate output] Advisory limits: memory-drift exited 0 but reported a stale/incomplete report and 5 live findings, not a fresh live probe; memory-health was advisory; J27 reported 61 ok, 0 stale, 6 unverifiable, 11 closed. Memory router passed at 7,928 bytes without its routine-audit trigger. These are not proof of repository-wide documentation freshness. [VERIFIED via `test -e .env.local`] `.env.local` is absent by design. Credential-dependent live probes/rehearsals are **skipped**, not passed; none of the five requested final document gates needed credentials.

[VERIFIED via `npx jest tests/unit/dynamics-explorer-call-config.test.js tests/unit/review-synthesis-readiness.test.js tests/unit/reviewer-roster-endpoint.test.js tests/unit/review-docx-repair-service.test.js tests/unit/review-docx-backfill-service.test.js --runInBand --no-cache`] **5 suites / 105 tests passed**, no snapshots. This is baseline evidence for candidate seams, not proof of a refactor that has not been implemented.

[VERIFIED via sequential final gate execution with only this document staged] All five required gates passed in order: `npm run check:doc-symbol-refs` (306 files, 1,817 references, 1 ignored); `npm run check:build-claim-freshness` (306 files, 1,661 references); `npm run check:docs-catalog` (302 top-level docs); `npm run check:harness-framing`; `npm run check:secret-scan` (4,293 tracked text files). The symbol/build-claim scanners cover memory/wiki and the catalog gate covers top-level docs; their passing results do not validate every citation in this standalone plan. Manual source-line checks and the independent review supplement them. [ASSUMED] Delivery procedure: re-run those gates sequentially on this final text, check the one-file diff and branch, commit, and push only `git push -u origin codex/refactor-survey`.

## Appendix A — reproducible censuses

[VERIFIED via commands executed in the survey worktree] All numerical inventories were generated from tracked files and the owner's index. The equivalent commands below are read-only; no new script file is part of this deliverable. Run at the pinned survey base for identical history/LOC counts. Graph counts may vary with a future CodeGraph version/index rebuild.

```bash
# Physical module lines, including comments and blank lines.
python3 - <<'PYCOUNT'
import pathlib, subprocess
files = subprocess.check_output(
    ['git', 'ls-files', 'lib', 'pages/api', 'shared', 'scripts'], text=True
).splitlines()
rows = [(len(pathlib.Path(f).read_text().splitlines()), f) for f in files
        if pathlib.Path(f).suffix in {'.js','.jsx','.ts','.tsx','.mjs','.cjs'}]
for count, f in sorted(rows, key=lambda row: (-row[0], row[1]))[:10]:
    print(count, f)
PYCOUNT

# Replace the paths after -- with the exact C1–C5 scope listed above.
git log --since=2026-07-03T00:00:00-07:00   --until=2026-10-01T00:00:00-07:00 --no-merges --format=%H HEAD --   shared/components/reviewers/reviewer-search-logic.js
```

[VERIFIED via the following SQL against `.codegraph/codegraph.db`] Module caller aggregation; removing the confidence predicate produces the raw table. `mode=ro&immutable=1` was used on the completed, quiet index to avoid SQLite journal writes; use an ordinary read-only connection with suitable host access if an index is being updated concurrently.

```sql
SELECT t.file_path, COUNT(DISTINCT s.id) AS G,
       COUNT(DISTINCT s.file_path) AS GF
FROM edges e
JOIN nodes s ON s.id = e.source
JOIN nodes t ON t.id = e.target
WHERE e.kind IN ('calls','instantiates')
  AND COALESCE(json_extract(e.metadata, '$.confidence'), 1) >= 0.7
  AND s.file_path <> t.file_path
  AND (t.file_path LIKE 'lib/%' OR t.file_path LIKE 'pages/api/%'
       OR t.file_path LIKE 'shared/%' OR t.file_path LIKE 'scripts/%')
  AND s.file_path NOT LIKE 'tests/%'
  AND s.file_path NOT LIKE '_archived/%'
  AND s.file_path NOT LIKE '%/archive/%'
GROUP BY t.file_path
ORDER BY G DESC, t.file_path;
```

[VERIFIED via the AST census] Static counts use `@babel/parser` with `sourceType: 'unambiguous'`, JSX/TypeScript plugins and error recovery. Enumerate `git ls-files` with the six module extensions, excluding `tests/`, `_archived/` and `/archive/` importers. Visit ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration and literal CallExpression require/import nodes; resolve relative paths or `@/` from repository root using the six extensions plus `/index.js` and `/index.ts`. Count distinct importer filenames per resolved tracked target. Nonliteral imports are not guessed. This follows file imports, not method dispatch. Scope includes root config/hooks/benchmarks if tracked and matching the extensions; it excludes external package imports. The graph census independently follows resolved calls. This algorithm explains why G/GF/S can disagree without implying dead code.

## Separate bug leads — no fixes made

- **Roster partial-write success may mislead the client.** [VERIFIED via lib/services/reviewer-roster-store.js:162, pages/api/workbench/reviewer-roster.js:456, shared/components/reviewers/search/useReviewerDiscovery.js:272] The store catches per-row failures and returns only a count; the route returns HTTP 200 with `success: true`; the hook ignores the count and adds all submitted candidates after the generation check. [ASSUMED] A failed DB write can therefore look saved/deduplicated until reload, including a zero-recorded batch. Existing curation conflicts can also produce zero, so a fix cannot simply treat every zero as failure. Needs a fault-injected route/store/client test and per-item outcome design in a separate bug task; no live DB reproduction was attempted.
- **Title-generation timeout abandons rather than cancels the provider work.** [VERIFIED via lib/services/cron/generate-grantee-titles-service.js:152, lib/services/cron/generate-grantee-titles-service.js:162] `Promise.race` returns after 40 seconds but passes no cancellation signal to the generation call. The timed-out row never reaches its later PATCH. [ASSUMED] Provider/audit work may continue and the next tick may pay for another attempt; this is a possible background-cost/observability defect, not demonstrated duplicate title writes. Verify the full Executor cancellation/budget behavior with delayed mocks before a separate fix.
