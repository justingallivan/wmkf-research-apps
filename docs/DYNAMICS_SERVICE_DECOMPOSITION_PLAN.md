---
title: DynamicsService Decomposition Plan
domain: architecture
kind: plan
status: active
summary: "PLANNED: DynamicsService (1,728 L Dataverse WRITE hub) → lib/services/dynamics/*.js behind a thin facade; behavior-freeze, DAL guards + 5 LAW gates preserved."
canonical: true
owner: product-engineering
related:
  - docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md
  - docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/agent-wiki/topics/dataverse-dynamics.md
  - docs/CI_GATES_REFERENCE.md
---

# DynamicsService Decomposition Plan

**Status: IN PROGRESS — Stage 0 EXECUTED (S338, commit `f65966f`); Checkpoint A Stages 1 (`auth.js`) + 2 (`restrictions.js`) + 3 (`annotations.js`) all EXECUTED + BATCHED adversarial review PASSED (S339, verdict SOUND/approve — "could not refute the behavior-freeze", no material findings, base `d4463548..HEAD`); Checkpoint B Stages 4 (`schema.js`) + 5 (`read-ops.js`) EXECUTED + BATCHED adversarial review PASSED (S341, Codex behavior-freeze verified; merged to main S342, commit `daac9761`); Checkpoint C Stage 6 (`write-core.js`) EXECUTED + DEDICATED adversarial review PASSED (S345, Codex verdict `approve`, "no material findings" — behavior-equivalent modulo the `this.`→`svc.` rewrite, 4 mutators still assert-first, impersonation fallback + 412/ETag/plain-error paths intact); Checkpoints D–F pending.** This applies the exact cadence proven on the
DiscoveryService decomposition (S335) and the ContactEnrichmentService decomposition (S336):
strategy chosen up front (facade + extracted modules), leaf-first staged extraction, each cluster
characterization-covered (baselined green pre-extraction, mutation-proven) BEFORE the code moves,
Codex review at risk-sized checkpoints. Behavior-freeze: pure code motion, byte-identical method
bodies, with only the permitted mechanical rewrites named in C1 and C4.

## Objective

`lib/services/dynamics-service.js` is **1,728 lines** [VERIFIED via `wc -l`] — a single static-method
class (`DynamicsService`, 33 static methods + 2 frozen static props + 14 module-private functions +
9 module-level constants/caches) that is the repo's **Dataverse WRITE hub**: every entity
create/update/delete/disassociate, the atomic `$batch` changeset, and the CRM email pipeline flow
through it, under DAL enforcement (`assertTrustedDalContext`, 8 call sites — see C2). This plan
decomposes it into cohesive modules under `lib/services/dynamics/`, with `dynamics-service.js`
reduced to a **thin delegating facade** that preserves the full static surface.

**Why this is higher-risk than the prior two decompositions:** (1) it is the trust boundary itself —
the fail-closed `assertTrustedDalContext` and `checkRestriction` guards live INSIDE the methods being
moved, not around them; (2) five LAW-mode CI gates key on this file's path or its method names; (3) the
external surface is enormous — essentially every method is pinned by adapters, services, scripts, and
tests (e.g. `queryAllRecords` 131 external refs, `executeChangeset` 77, `createAndSendEmail` 64,
`logAiRun` 25 [VERIFIED via mechanical `DynamicsService.<method>` grep, this session]); (4) tests both
`jest.spyOn` and **raw-reassign** class statics (`DynamicsService.getRecord = jest.fn()` in
`tests/unit/verify-suggestion-token.test.js:50`, `tests/unit/adapters-caller-id.test.js:55-58`,
`tests/unit/verify-grantee-token.test.js:48` [VERIFIED via grep]), which dictates the dispatch rule in C1.

**Chosen strategy: facade + extracted modules** (owner-approved pattern from the two prior projects).
Every `DynamicsService.method()` call site keeps working unchanged. **Out of scope:** any semantic
change — including "fixing" the unescaped filter interpolation in `resolveSystemUser` (see C7), any
consolidation with `graph-service.js`'s duplicate `fetchWithTimeout`, and any adapter/route changes.

## Open owner decisions

- **Q1 — Module granularity (RECOMMENDED: Option A, 12 modules).**
  - **A (recommended):** the 12-module layout in the table below (`constants`, `http`, `auth`,
    `restrictions`, `annotations`, `schema`, `read-ops`, `write-core`, `changeset`, `email`,
    `ai-run`, + facade). No module over ~350 L; each module is one cohesive concern; the three
    write-hub clusters (`write-core`, `changeset`, `email`) are isolated for dedicated review.
  - **B:** coarser 8-module fold (merge `http`→`auth`, `annotations`→`read-ops`,
    `restrictions`→`schema`). Fewer files but blurs the guard-bearing modules; not recommended
    because `restrictions.js` is a security boundary worth reviewing in isolation.
- **Q2 — Facade target size (RECOMMENDED: full-surface facade, ~260 L).** Delegate ALL 33 methods
  plus `_writeFetch`/`_withCallerId`/`_truncateForMemo` (zero external refs [VERIFIED via grep], but
  kept as wrappers for exact-surface parity, matching the discovery precedent), plus re-exposed
  `AI_RUN_TASK_TYPES`/`AI_RUN_STATUSES` frozen props (`:1121`,`:1128` — zero external readers, but
  `logAiRun` reads them via `this.` and tests may reach them). Alternative: drop the three
  underscore wrappers (saves ~15 L, breaks exact-surface parity). Recommend full surface.
- **Q3 — Cache-state seam (RECOMMENDED: co-locate caches with their owner modules + delegating
  `clearCaches`).** `tokenCache` (`:52`, a `let` that is **reassigned**, not mutated) moves into
  `auth.js`; `schemaCache` (`:53-61`, a `const` mutated in place, including the in-flight
  `fieldPromises` dedupe map) moves into `schema.js`. `clearCaches` (`:1509-1518`) cannot then be
  byte-identical — it becomes a facade method calling two NEW one-line reset functions
  (`resetTokenCache()` in `auth.js`, `resetSchemaCache()` in `schema.js`). **This is the single
  sanctioned non-verbatim seam in the whole plan** and needs explicit owner sign-off. Alternative:
  a shared `state.js` module holding both caches — rejected because `tokenCache` reassignment would
  force a `state.tokenCache = …` rewrite through `getAccessToken`'s body, a larger diff than two
  reset functions.
- **Q4 — Gate-recognition mechanism for the new directory (RECOMMENDED: extend the source matchers +
  add the dir to self-exemptions, same commit as Stage 0).** Both
  `scripts/check-dataverse-access-layer.js:216` and `scripts/check-route-service-boundary.js:67`
  recognize the module by the regex `/(?:^|\/)dynamics-service(?:\.js)?$/` [VERIFIED via read]. New
  modules under `lib/services/dynamics/` would be INVISIBLE to both gates — a route or lib file could
  import `lib/services/dynamics/write-core.js` and bypass the entire access-layer law. Recommended:
  extend both matchers to also match `lib/services/dynamics/<file>` sources, add
  `lib/services/dynamics/` to `check-dataverse-access-layer.js` EXEMPT_DIRS (`:75-80`, alongside
  `lib/dataverse/core/`), and update both self-tests (`check-dataverse-access-layer-self-test.js`,
  `check-route-service-boundary-self-test.js`) with positive+negative fixtures — all in the Stage-0
  commit. Alternative (keep matchers, rely on convention): rejected — it converts a LAW into a hole.
  **Source-regex extension ALONE is insufficient** [flagged by adversarial review, S338]: the
  access-layer scanner attributes calls only for imports it can alias — an import named
  `DynamicsService`, a default import, or a namespace import from a matched source. An ordinary NAMED
  import (`import { createRecord, executeChangeset } from 'lib/services/dynamics/write-core.js'`) from
  a non-exempt `lib/`/`lib/shared/modules/` file would NOT be alias-attributed, so the bare
  `createRecord(...)`/`executeChangeset(...)` call slips the gate — a residual bypass hole the
  directory split OPENS. **Stage 0 must make `check-dataverse-access-layer.js` fail closed on ANY
  non-exempt import of `lib/services/dynamics/*` regardless of shape** — named import, namespace
  import, default import, `require()` destructure, dynamic `import()`, and re-export
  (`export { createRecord } from …`). The Stage-0 self-test matrix must include a FAILING fixture for
  each of those six shapes, from BOTH a `pages/api/` route and a non-exempt `lib/` file (the
  access-layer law covers `lib/shared/modules`, not just routes). Verify the matcher empirically
  against these fixtures; do not post-hoc trust the regex.

## Behavior-preservation constraints

- **C1 — svc-dispatch rule (the defining mechanical rewrite; supersedes per-edge judgment).** Tests
  spy or raw-reassign essentially every hub method: `queryRecords` (87 spy sites), `getRecord` (86),
  `updateRecord` (62), `queryAllRecords` (43), `createRecord` (19), `getAccessToken` (8),
  `createAndSendEmail` (3), `executeChangeset` (2), `getEntityKey`, `disassociate` [VERIFIED via
  spyOn tally, this session], plus raw `DynamicsService.X = jest.fn()` reassignment (see Objective).
  Because **nearly every method calls `this.getAccessToken()`** and many call other spied siblings
  (`updateIfEmpty` → `this.getRecord`/`this.updateRecord` `:880,:899`; `logAiRun` →
  `this.createRecord` `:1183`; `resolveSystemUser` → `this.queryRecords` `:1220`;
  `createAndSendEmail` → `this.createEmailActivity`/`this.addEmailAttachment`/`this.sendEmail`
  `:1371-1379`; `resolveEntitySetName`/`getPrimaryIdAttribute` → `this.getEntityDefinitions`
  `:1408,:1437`; `countRecords` → `this.getPrimaryIdAttribute` `:530`), a "self-call → direct
  import" rewrite would break class-level spies AND the raw-reassignment tests. **Rule: every
  extracted method becomes a module function whose first parameter is the class
  (`function queryRecords(svc, entitySet, opts)`), and every class-surface `this.` access in a moved
  body is rewritten to `svc.` — this covers both CALL edges (`this.getRecord(` → `svc.getRecord(`)
  AND non-call STATIC-PROPERTY reads (`this.AI_RUN_TASK_TYPES` → `svc.AI_RUN_TASK_TYPES`); nothing
  else in the body changes. The facade wrapper is
  `static queryRecords(...args) { return readOps.queryRecords(this, ...args); }`.** This is the ONLY
  permitted body rewrite besides C4's cache seam. It preserves spy/reassignment dispatch on every
  sibling edge uniformly and eliminates all compile-time import cycles (modules never import the
  facade). **The call-only reading of this rule is a known trap** [VERIFIED via read]: `logAiRun`
  (`:1152-1188`) reads `this.AI_RUN_TASK_TYPES` (`:1155`) and `this.AI_RUN_STATUSES` (`:1160`) as
  properties, not calls — extracting it to `function logAiRun(svc, …)` while leaving those as `this.*`
  would dereference an unbound receiver and throw. **Mechanical guard (Stage 0 + every extraction
  stage): after each extraction, grep the moved module for any surviving `this.` — a module function
  must contain ZERO `this.` tokens.** Land a `logAiRun` characterization that pins facade-static
  resolution (`svc.AI_RUN_TASK_TYPES`/`svc.AI_RUN_STATUSES` unknown-key throws) plus `svc.createRecord`
  dispatch BEFORE the ai-run extraction (Checkpoint F).
- **C2 — `assertTrustedDalContext` fail-closed sites move verbatim, position-exact.** The 8 call
  sites [VERIFIED via grep]: `createRecord:788`, `updateRecord:826`, `deleteRecord:932`,
  `disassociate:971`, `executeChangeset:1049`, `createEmailActivity:1232`,
  `addEmailAttachment:1304`, `sendEmail:1340`. Each must remain the FIRST statement of its moved
  body — **except `executeChangeset`, where the assert deliberately runs AFTER input validation
  (`:1031-1049`, the in-code comment explains malformed-input messages must win regardless of
  context); that ordering is load-bearing and must be preserved exactly.** Each write module imports
  `assertTrustedDalContext` directly from `../dynamics-context.js` (path depth +1, see C10) — the
  guard must live inside the moved implementation, NOT in the facade wrapper, so a future direct
  module import (post-Q4 gate extension) is still runtime-guarded. `DATAVERSE_DAL_ENFORCEMENT` is on
  in all envs (prod flipped 2026-07-04, S330 — `docs/agent-wiki/topics/dataverse-dynamics.md:54`);
  `tests/unit/dal-enforcement.test.js` must stay green at every checkpoint.
  [STALE-ACCEPTED: lib/services/dynamics-context.js — S338 added an unrelated additive `assertDataverseAccess` warn-guard (commit `5a16f36`, `DATAVERSE_DAL_UNIVERSAL`, default off) for the client.js prefs/app-access gap; it does NOT touch `assertTrustedDalContext`/`getDynamicsContext`/`checkRestriction`, so C2/C3 and every dynamics-context.js reference in this plan remain accurate.]
- **C3 — `checkRestriction` fail-closed context read.** `checkRestriction` (`:219-268`) reads the
  AsyncLocalStorage context via `getDynamicsContext()` and **throws when no context is set**
  (`:224-227`). This whole method + `splitExpandSegments`/`parseExpandSegment` (`:1528-1563`) move
  as one unit to `restrictions.js`; the no-context throw and the state-leak `console.warn`
  (`:232-234`) are byte-identical. Every read method's `this.checkRestriction(...)` call becomes
  `svc.checkRestriction(...)` per C1 — six external callers also pin
  `DynamicsService.checkRestriction` directly [VERIFIED via grep], so the facade wrapper is required.
- **C4 — Mutable module state has exactly one owner module (the Q3 seam).** `tokenCache` (`:52`) is
  reassigned by `getAccessToken` (`:128`) and `clearCaches` (`:1510`); `schemaCache` (`:53-61`) is
  read/written by `getEntityDefinitions`, `getEntityAttributes` (including the `fieldPromises`
  in-flight-dedupe map `:337-373`), `getEntityRelationships`, `resolveEntitySetName`,
  `getPrimaryIdAttribute`, `clearCaches`. All `schemaCache` users cluster into `schema.js` so the
  cache never crosses a module boundary; `tokenCache` + `getAccessToken` cluster into `auth.js`.
  `clearCaches` becomes a facade delegate to `resetTokenCache()` + `resetSchemaCache()` — the one
  sanctioned non-verbatim change (Q3). 8 external `clearCaches` callers [VERIFIED via grep] see
  identical behavior; a characterization test must pin cache-reset behavior (token invalidated,
  field/relationship/entity-set maps emptied, `fieldPromises` cleared) BEFORE Stage 1.
- **C5 — Gate-config extension is a Stage-0, same-commit requirement (Q4).** Named against real
  config: `check-dataverse-access-layer.js` EXEMPT_FILES contains `lib/services/dynamics-service.js`
  (`:69`) and the source matcher is `:216`; `check-route-service-boundary.js` matcher is `:67`.
  Without extension, (a) the new modules are un-gated import targets (bypass hole), and (b) nothing
  breaks visibly — the failure mode is silent. Stage 0 must: extend both matchers to
  `lib/services/dynamics/`, add the dir to access-layer EXEMPT_DIRS, make the access-layer gate fail
  closed on ANY non-exempt import shape from `lib/services/dynamics/*` (named / namespace / default /
  `require()` destructure / dynamic `import()` / re-export — NOT just `DynamicsService`-aliased
  imports; see Q4 for why source-regex extension alone leaves a named-import hole), extend BOTH
  self-tests with the six-shape FAILING-fixture matrix from both a route and a non-exempt `lib/` file,
  and run `check:dataverse-access-layer`, `check:dataverse-access-layer:self-test`,
  `check:route-service-boundary`, `check:route-service-boundary:self-test`. The
  `NON_ENTITY_TRANSPORT_METHODS` closed list (`check-dataverse-access-layer.js:106-111`:
  `createAndSendEmail`, `addEmailAttachment`, `createEmailActivity`, `logAiRun`) keys on method
  NAMES, which the facade preserves — no census change needed.
- **C6 — `check:dynamics-context-boundary` stays green passively, but verify per write stage.** The
  gate forbids `bypassDynamicsRestrictions` / `enterDynamicsBypassForScript` imports and
  empty-restrictions `withDynamicsContext` (`check-dynamics-context-boundary.js:1-50`).
  `dynamics-service.js` imports only `getDynamicsContext` + `assertTrustedDalContext` (`:12`) —
  allowed symbols; the `enterDynamicsBypassForScript` mention at `dynamics-service.js:222` is
  comment-only (AST-invisible per the gate's own doc `:43-46`). Moved modules must import the same
  two allowed symbols only. Run the gate at every checkpoint that touches `restrictions.js` or a
  write module.
- **C7 — `check:odata-escape` + the frozen unescaped filter.** The file contains NO hand-rolled
  quote-doubling escape [VERIFIED via read vs. `check-odata-escape.js` ESCAPE_CALL_RE], so the gate
  is green before and after. **`resolveSystemUser` interpolates the email RAW into an OData filter
  (`:1222`) — behavior-freeze forbids "fixing" this during the move** (routing it through
  `odata.escape` is a semantic change and a separate follow-up). Flag it in the Stage-8 review notes
  as known-and-frozen so a reviewer doesn't "helpfully" patch it mid-motion.
- **C8 — `check:trust-boundary-guid` keys on facade method names in routes.** The gate's sinks are
  `DynamicsService.getRecord/updateRecord/deleteRecord` id-arg positions in `pages/api/`
  (`check-trust-boundary-guid.js:20-27`) — it never scans `lib/services/`, and the facade preserves
  the names, so no gate change is needed. Run it at Checkpoints C and F as confirmation.
  [STALE-ACCEPTED: scripts/check-trust-boundary-guid.js — S342 touched it only with a reverted
  temporary debug line; the file is byte-identical to origin/main (no net change), so this reference
  stays accurate.]
- **C9 — Call-time env reads must not be hoisted.** `process.env.DYNAMICS_URL` is read inside nearly
  every method body; `DYNAMICS_IMPERSONATION_ENABLED` is read at call time in `_withCallerId`
  (`:164`) and `createAndSendEmail` (`:1366`); the four `DYNAMICS_*` creds are destructured inside
  `getAccessToken` (`:88-93`). Tests set env per-case; no read may be hoisted to a module-load
  `const` (same trap as ContactEnrichment C11).
- **C10 — ESM + relative-path depth rewrites.** The file is ESM (`export class DynamicsService`,
  `:69`; imports `:11-14`). New modules are ESM `.js` under `lib/services/dynamics/`, one level
  deeper: `./dynamics-context.js` → `../dynamics-context.js`, `../utils/ai-run-retention.js` →
  `../../utils/ai-run-retention.js`, `../utils/service-error.js` → `../../utils/service-error.js`.
  There are NO dynamic `import()` string paths in this file [VERIFIED via read] — simpler than
  ContactEnrichment C13; a wrong static path throws at load and the suite catches it.
- **C11 — Changeset atomicity + fail-closed parser semantics are byte-identical (the tiers.js-analog).**
  `executeChangeset` (`:1030-1112`) + the 8 module-private batch builders/parsers (`:1572-1698`) move
  as ONE unit to `changeset.js`. Load-bearing invariants that must not drift: input validation before
  the DAL assert (C2); the `failed`-op preference over outer HTTP status for 412/400/409
  classification (`:1080-1085`); the `allConfirmed` under-count guard that throws rather than
  returning `ok` on an unprovable commit (`:1094-1106`); Content-ID = 1-based index; CRLF body
  construction; the intentional non-surfacing of `OData-EntityId` (JSDoc contract `:1017-1023`).
  Characterization BEFORE the move: parser fixtures for CRLF and LF endings, nested multipart,
  bare-JSON error envelope (non-multipart → `parseBatchResponse` returns `[]` → outer-status path),
  under-count → throw, per-op `If-Match` 412 → `.status` 412 propagation.
- **C12 — Impersonation 403-fallback contract moves intact.** `_withCallerId` (`:163-168`) +
  `_writeFetch` (`:185-200`) — the 403-retry-without-`MSCRMCallerID` + structured warn + `noFallback`
  escape hatch — live in `write-core.js`; `executeChangeset` and the email methods reach them via
  `svc._withCallerId`/`svc._writeFetch` per C1 (facade wrappers exist per Q2).
  `tests/unit/dynamics-service-caller-id.test.js` and `tests/unit/adapters-caller-id.test.js` are the
  characterization baseline and must be green pre- and post-move.
- **C13 — Error-shape freeze.** Error construction is deliberately inconsistent per method and
  callers branch on it: `createRecord`/`updateRecord` throw `buildServiceError` (412-aware,
  `:846`), `deleteRecord`/`disassociate` throw plain `Error` with `.status` attached
  (`:950-952`, `:985-987`), email methods throw plain `Error` with interpolated status text
  (`:1287`, `:1329`, `:1354`), `getAccessToken` throws a forced non-transient config error
  (`:99-104`), `fetchWithTimeout` wraps no-response errors via `buildNoResponseError` (`:1724`).
  Byte-identical bodies preserve all of this automatically; reviewers must reject any "normalize the
  errors" cleanup.
- **C14 — Token secrecy surface.** `getAccessToken`'s JSDoc security contract (`:75-81`) and the
  `.semgrep/token-audit.yaml` enforcement travel with the method to `auth.js`. The semgrep rules are
  content-based, not path-pinned to this file [VERIFIED via grep of token-audit.yaml — host regex
  only], so the move does not weaken them; confirm the semgrep run is green at Checkpoint A.

## Mechanical call graph (clusters + DAG)

Method enumeration [VERIFIED via full read, this session]. Cluster → members (with line refs):

1. **constants** — `KNOWN_ENTITY_SETS:18`, `ENTITY_SET_TO_LOGICAL:43`, `KNOWN_ENTITY_SET_VALUES:49`,
   `TABLE_CACHE_TTL/FIELD_CACHE_TTL/API_TIMEOUT/MAX_EXPORT_RECORDS/EXPORT_PAGE_SIZE:63-67`.
2. **http** — `fetchWithTimeout:1709-1728` (module fn), `buildHeaders:137-145`.
3. **auth** — `getAccessToken:82-133` + `tokenCache:52`.
4. **restrictions** — `resolveLogicalName:207-209`, `checkRestriction:219-268`,
   `splitExpandSegments:1528-1544`, `parseExpandSegment:1552-1563`.
5. **annotations** — `processAnnotations:1446-1474`.
6. **schema** — `getEntityDefinitions:275-324`, `getEntityAttributes:329-374`,
   `getEntityRelationships:379-425`, `resolveEntitySetName:1390-1414`,
   `getPrimaryIdAttribute:1423-1439`, `getEntityKey:1487-1504`, `filterEntities:1700-1707`,
   `schemaCache:53-61`.
7. **read-ops** — `queryRecords:434-477`, `getRecord:482-507`, `countRecords:526-556`,
   `aggregateRecords:570-617`, `queryAllRecords:626-683`, `searchRecords:698-763`.
8. **write-core** — `_withCallerId:163-168`, `_writeFetch:185-200`, `createRecord:787-808`,
   `updateRecord:825-848`, `updateIfEmpty:875-915`, `deleteRecord:931-954`, `disassociate:970-989`.
9. **changeset** — `executeChangeset:1030-1112` + `BATCH_CRLF:1572`, `buildChangesetOp:1575`,
   `buildChangesetBatchBody:1598`, `extractBoundary:1611`, `splitHeadersAndBody:1622`,
   `splitMultipart:1633`, `parseEmbeddedHttp:1652`, `collectHttpParts:1665`, `parseBatchResponse:1692`.
10. **email** — `resolveSystemUser:1219-1229`, `createEmailActivity:1231-1292`,
    `addEmailAttachment:1303-1331`, `sendEmail:1339-1356`, `createAndSendEmail:1365-1382`.
11. **ai-run** — `AI_RUN_TASK_TYPES:1121`, `AI_RUN_STATUSES:1128`, `logAiRun:1152-1188`,
    `_truncateForMemo:1194-1198`.
12. **facade** — `clearCaches:1509-1518` (Q3 seam) + all delegating wrappers.

**Static-import DAG (what a module `import`s at load).** Under C1 svc-dispatch, cross-module METHOD
calls never create imports — only leaf utility imports exist:

- `constants` → (none)
- `http` → `../../utils/service-error.js` (`buildNoResponseError`)
- `auth` → `http`, `constants`, `service-error` (`buildServiceError`)
- `restrictions` → `constants` (reverse map), `../dynamics-context.js` (`getDynamicsContext`)
- `annotations` → (none)
- `schema` → `http`, `constants`
- `read-ops` → `http`, `constants`, `service-error`
- `write-core` → `http`, `constants` (API_TIMEOUT), `../dynamics-context.js`
  (`assertTrustedDalContext`), `service-error`
- `changeset` → `crypto` (`randomUUID`), `../dynamics-context.js`, `service-error`
- `email` → `../dynamics-context.js`, `http`, `constants`
- `ai-run` → `../../utils/ai-run-retention.js`
- `facade` → all of the above

**This import graph is acyclic** — asserted by construction (modules never import the facade or each
other's method modules; only `constants`/`http` are shared leaves). **Runtime call DAG via `svc`**
(module → modules whose methods it reaches through the facade):
`auth` → {`http`} (`getAccessToken` bare-calls `fetchWithTimeout`);
`schema` → {`auth`, `restrictions`, `http`} (+ intra-module `getEntityDefinitions`);
`read-ops` → {`auth`, `restrictions`, `schema`, `annotations`, `http`};
`write-core` → {`auth`, `http`, `annotations`, `read-ops`} (the `read-ops` edge is
`updateIfEmpty` → `svc.getRecord`);
`changeset` → {`auth`, `write-core`};
`email` → {`auth`, `read-ops`, `schema`, `write-core`, `http`};
`ai-run` → {`write-core`}.
`restrictions`, `annotations`, `http`, `constants` are pure leaves (no outgoing cross-cluster edge);
`http` is the shared base every network-calling cluster reaches for `buildHeaders`/`fetchWithTimeout`.
No back-edges exist (`read-ops` never calls a write module) — **the runtime graph is an acyclic DAG;
no BLOCKER cycles found.** Because `http` was extracted first (Stage 0), its universal in-edges
resolve as static imports into an already-materialized lower module, so leaf-first ordering holds.
**[VERIFIED S338 via mechanical scan — `scripts`-style AST scan (`@babel/parser`), re-runnable at
`scratchpad/dag-scan.js`].** Regenerated per-method (`this.X(` calls + bare private-fn calls +
non-call `this.<PROP>` reads); ACYCLIC confirmed; **zero `this` inside nested non-arrow functions**
(C1 svc-dispatch is safe). Correction vs the prior hand-built table: it wrongly listed `auth` as a
pure leaf and omitted the `→ http` edges on `auth`/`schema`/`read-ops`/`email` — every
network-calling cluster calls `fetchWithTimeout`/`this.buildHeaders` directly, not only via
`write-core`. No cycle introduced; extraction order unaffected.

## Target module layout

`lib/services/dynamics/` + the facade. `~L` is an `[ASSUMED]` forward estimate; goal: no module over
~350 L (down from 1,728). `Facade-target` = the wrapper the facade keeps.

| # | Module | Methods / symbols | Deps (static imports) | ~L | Facade-target |
|---|--------|-------------------|----------------------|----|---------------|
| 1 | `constants.js` | entity-set maps, TTLs, timeouts, export caps | — | 65 | none (internal) |
| 2 | `http.js` | `fetchWithTimeout`, `buildHeaders` | service-error | 55 | `buildHeaders` wrapper (2 ext refs) |
| 3 | `auth.js` | `getAccessToken`, `tokenCache`, `resetTokenCache` (Q3) | http, constants, service-error | 80 | `getAccessToken` wrapper (15 ext refs, 8 spy) |
| 4 | `restrictions.js` | `resolveLogicalName`, `checkRestriction`, expand parsers | constants, dynamics-context | 115 | both wrappers (2+6 ext refs) |
| 5 | `annotations.js` | `processAnnotations` | — | 45 | wrapper (3 ext refs) |
| 6 | `schema.js` | `getEntityDefinitions`, `getEntityAttributes`, `getEntityRelationships`, `resolveEntitySetName`, `getPrimaryIdAttribute`, `getEntityKey`, `filterEntities`, `schemaCache`, `resetSchemaCache` (Q3) | http, constants | 340 | all 6 wrappers |
| 7 | `read-ops.js` | `queryRecords`, `getRecord`, `countRecords`, `aggregateRecords`, `queryAllRecords`, `searchRecords` | http, constants, service-error | 350 | all 6 wrappers (heaviest external surface) |
| 8 | `write-core.js` | `_withCallerId`, `_writeFetch`, `createRecord`, `updateRecord`, `updateIfEmpty`, `deleteRecord`, `disassociate` | http, constants, dynamics-context, service-error | 250 | all 7 wrappers (underscores per Q2) |
| 9 | `changeset.js` | `executeChangeset` + 8 batch builders/parsers + `BATCH_CRLF` | crypto, dynamics-context, service-error | 250 | `executeChangeset` wrapper (77 ext refs) |
| 10 | `email.js` | `resolveSystemUser`, `createEmailActivity`, `addEmailAttachment`, `sendEmail`, `createAndSendEmail` | dynamics-context, http, constants | 195 | all 5 wrappers (64 ext refs on `createAndSendEmail`) |
| 11 | `ai-run.js` | `AI_RUN_TASK_TYPES`, `AI_RUN_STATUSES`, `logAiRun`, `_truncateForMemo` | ai-run-retention | 95 | `logAiRun` + `_truncateForMemo` wrappers; frozen props re-exposed as statics |
| — | `dynamics-service.js` (facade) | all delegating statics + `clearCaches` (Q3 seam) + frozen props | all modules | ~260 | — |

## Execution cadence (checkpoints, review mode, gates tripped)

Per-stage work (identical to the proven cadence): trace → land characterization coverage (baseline
green pre-extraction, mutation-proven) → extract one cluster verbatim (C1 rewrite only) → run suite +
touched gates → commit. Leaf-first per the DAG.

- **Stage 0 — scaffolding + gate extension + mechanical call graph. DEDICATED review. — EXECUTED
  S338 (commit `f65966f`).** `constants.js` (48 L) + `http.js` (42 L) extracted verbatim; facade
  −56 L (static `buildHeaders` delegate + `fetchWithTimeout` import; `tokenCache`/`schemaCache` left
  in place). Both LAW gates extended fail-closed on `lib/services/dynamics/*`; the access-layer
  matcher is **resolution-based** (`isDynamicsSubmoduleTarget` resolves relative specifiers to a
  repo-rel path) — a strengthening beyond the six-shape framing, closing a relative-import hole
  (`./dynamics/x.js` from a non-exempt `lib` sibling) that raw-substring matching missed, caught by
  Lead probe during the stage. Six-shape self-test matrix (relative form) + sibling probe landed;
  agent-wiki watch_paths updated. Verified: bypass probes fail the gate (exit 1) / green after
  delete; all 4 LAW gates + self-tests, `check:doc-symbol-refs`, `check:agent-wiki` green; full suite
  4945/4945 (behavior-freeze holds). **DAG regen — DONE (S338, pulled forward from Checkpoint C):**
  the mechanical per-method scan ran (`scratchpad/dag-scan.js`, `@babel/parser`); graph is ACYCLIC and
  the hand-built table was CORRECTED — it had wrongly listed `auth` as a pure leaf and omitted the
  `→ http` edges on `auth`/`schema`/`read-ops`/`email` (see the Mechanical call graph section). No
  cycle, extraction order unaffected; also confirmed zero `this` in nested non-arrow functions (C1
  safe). **ADVERSARIAL REVIEW (DEDICATED,
  plan-mandated): DONE (S338).** Two independent Codex passes; the plan-doc pass returned
  SOUND-WITH-FIXES (C1 static-read + named-import bypass, both folded in pre-build); the Stage-0 build
  pass returned BLOCKER on a computed/non-literal source gap — `auditDynamicsSubmoduleImports` matched
  literal strings only, so `` import(`./dynamics/${x}`) `` / `require(constPrefix + 'x.js')` slipped.
  Fixed: require()/dynamic-import() sources now go through `matchesDynamicSource` (the gate's
  `resolveString` for const-bound/concat + a TemplateLiteral static-prefix check). Lead-verified: both
  computed probes now fail the gate (exit 1), a non-dynamics computed-import green control is NOT
  flagged (no false positive). **ACCEPTED RESIDUAL (Lead override, bounded):** a *fully opaque* source
  (`require(externalVar)` / call-sourced import with no resolvable static part) cannot be resolved by
  static analysis and is left unflagged — flagging all non-literal dynamic imports repo-wide would
  false-positive on legitimate Next.js lazy-loading. This tail (a) is shared by the pre-existing
  `dynamics-service.js` matcher (not a Stage-0 regression) and (b) is backstopped at runtime by
  `assertTrustedDalContext` inside every write method (C2), which fires regardless of import mechanism
  — so the static-census gap does not defeat the actual write-enforcement boundary.

  Stage 0 recheck ledger (paths changed this session, each re-verified against commit `f65966f`):
  - [RECHECKED after scripts/check-dataverse-access-layer.js change: `f65966f` + computed-source follow-up — source-based `isDynamicsSubmoduleTarget` (relative + namespace) AND `matchesDynamicSource` (const/concat/template-prefix); relative, namespace, template-literal, and const-concat bypass probes all fail the gate (exit 1); non-dynamics computed-import green control not flagged; tree green]
  - [RECHECKED after scripts/check-route-service-boundary.js change: `f65966f` — `boundaryKind` extended to the new dir; self-test + route fixture green]
  - [RECHECKED after scripts/check-dataverse-access-layer-self-test.js change: `f65966f` + computed-source follow-up — six-shape relative matrix + `./dynamics` sibling probe + computed RED (template + concat) + computed GREEN control; self-test green]
  - [RECHECKED after scripts/check-route-service-boundary-self-test.js change: `f65966f` — dynamics-submodule fail-closed fixtures; self-test green]
  - [RECHECKED after lib/services/dynamics/constants.js change: `f65966f` — verbatim extraction; facade loads; full suite 4945/4945]
  - [RECHECKED after lib/services/dynamics/http.js change: `f65966f` — verbatim extraction, `fetchWithTimeout` takes a `timeout` param (not `API_TIMEOUT`); suite green]
  - [RECHECKED after lib/services/dynamics-service.js change: `f65966f` — facade rewired (`buildHeaders` delegate + `fetchWithTimeout` import), behavior-freeze; suite green]

  Create `lib/services/dynamics/` with `constants.js` + `http.js` (verbatim moves of `:18-67`,
  `:137-145`, `:1709-1728`); facade imports them. **Same commit:** the C5/Q4 matcher + EXEMPT_DIRS +
  fail-closed-on-all-import-shapes + six-shape self-test matrix updates to
  `check-dataverse-access-layer.js` and `check-route-service-boundary.js` (see Q4/C5 — a bare named
  import must FAIL, not just a `DynamicsService`-aliased one). Run the mechanical per-method
  call-graph script and replace this plan's hand-built DAG table. Gates tripped:
  `check:dataverse-access-layer` (+self-test), `check:route-service-boundary` (+self-test),
  `check:doc-symbol-refs`, `check:agent-wiki` (add `lib/services/dynamics/**` to the
  dataverse-dynamics topic watch_paths in the same commit). Dedicated review because a bad matcher
  extension silently opens a LAW hole.
- **Checkpoint A Stage 1 — `auth.js`. EXECUTED S339 (main checkout, parallel with the Q9 worktree
  build).** `tokenCache` (module `let`) + `getAccessToken` (static, uses no `this`) moved verbatim
  to `lib/services/dynamics/auth.js`; the Q3 `resetTokenCache` export created and the facade's
  `clearCaches` now calls it (schemaCache resets stay inline until Stage 4). Facade keeps a thin
  `static getAccessToken()` delegating wrapper (mirrors the Stage-0 `buildHeaders` pattern — the
  module import shadows inside the method body; the ~15 internal `this.getAccessToken()` sites and 8
  test spies on `DynamicsService.getAccessToken` unchanged). Characterization added FIRST
  (`tests/unit/dynamics-service-auth.test.js`: caching reuse, 60s pre-expiry refresh, still-valid
  no-refresh, missing-env forced non-transient) — green pre-extraction, green post. Verified: full
  suite **4957/4957**; `check:dataverse-access-layer` + `check:dynamics-context-boundary` green
  (599 files, 0 violations, now incl. `auth.js`); semgrep `.semgrep/token-audit.yaml` 0 findings on
  `auth.js` (C14). **BATCHED review still pending** — runs after Stages 2–3 land.
  - [RECHECKED after lib/services/dynamics/auth.js change: S339 — verbatim `getAccessToken` + `tokenCache` + new `resetTokenCache`; deps http/constants/service-error; semgrep token-audit 0 findings; suite 4957/4957]
  - [RECHECKED after lib/services/dynamics-service.js change: S339 — facade rewired (`getAccessToken` delegate + `resetTokenCache` in `clearCaches`), behavior-freeze; no stray `tokenCache` ref; suite green]
  - Note: this extraction shifts `dynamics-service.js` line numbers below the old auth block up by ~48; the Q9 plan's `dynamics-service.js` line citations (method-name-anchored) are reconciled at the Q9 worktree merge, not mid-flight.
- **Checkpoint A Stage 2 — `restrictions.js`. EXECUTED S339.** `resolveLogicalName` +
  `checkRestriction` (both static, `this`-free) moved verbatim to
  `lib/services/dynamics/restrictions.js`, together with the two module-private `$expand` parsers
  (`splitExpandSegments`, `parseExpandSegment`) used only by `checkRestriction`. Facade keeps both
  as thin delegating wrappers (internal `this.` + external `DynamicsService.` calls unchanged); its
  now-orphaned imports dropped (`getDynamicsContext` from dynamics-context, `ENTITY_SET_TO_LOGICAL`
  from constants — both were used only by this cluster). Characterization added FIRST
  (`tests/unit/dynamics-service-checkrestriction.test.js`: fail-closed no-context throw, table +
  field denials, `$expand` table + nested-`$select` field denials, requestId-mismatch warn,
  `resolveLogicalName` mapping) — green pre- and post-extraction. Verified: full suite
  **4965/4965**; `check:dynamics-context-boundary` + self-test green (600 files, 0 violations —
  `restrictions.js` imports `getDynamicsContext`, a read, not `bypassDynamicsRestrictions`, so the
  boundary gate is satisfied); `check:dataverse-access-layer` green. **Checkpoint A batched review
  still pending** — after Stage 3.
  - [RECHECKED after lib/services/dynamics/restrictions.js change: S339 — verbatim `resolveLogicalName` + `checkRestriction` + private expand parsers; deps constants/dynamics-context; suite 4965/4965; context-boundary gate green]
  - [RECHECKED after lib/services/dynamics-service.js change: S339 — facade rewired (both wrappers delegate; `getDynamicsContext`/`ENTITY_SET_TO_LOGICAL` imports removed), no stray refs, behavior-freeze; suite green]
- **Checkpoint A Stage 3 — `annotations.js`. EXECUTED S339.** `processAnnotations` (static, pure —
  no `this`, no deps) moved verbatim to `lib/services/dynamics/annotations.js`; facade keeps a thin
  delegating wrapper (internal `this.processAnnotations` + the 3 external
  `DynamicsService.processAnnotations` refs — `dataverse-export/live-taxonomy.js`,
  `dataverse-export/fetch-client.js`, `dynamics-explorer/chat.js` — unchanged). Characterization
  added FIRST (`tests/unit/dynamics-service-annotations.test.js`: `@odata.etag`→`_etag` preservation,
  FormattedValue→`_formatted`, lookuplogicalname→`_entity`, other `@odata`/`@Microsoft` stripped,
  non-object passthrough) — green pre- and post-extraction. Verified: full suite **4970/4970**;
  `check:dataverse-access-layer` + `check:dynamics-context-boundary` green (601 files, 0 violations).
  - [RECHECKED after lib/services/dynamics/annotations.js change: S339 — verbatim `processAnnotations`, pure/no-deps; suite 4970/4970]
  - [RECHECKED after lib/services/dynamics-service.js change: S339 — facade wrapper delegates, impl fully moved (no stray `annotationSuffix`), behavior-freeze; suite green]
  **→ Checkpoint A leaf batch (Stages 1–3) CODE-COMPLETE + BATCHED adversarial review PASSED
  (S339, Codex, base `d4463548..HEAD`): verdict SOUND/approve, "could not refute the
  behavior-freeze", no material findings (it independently confirmed byte-identity modulo the
  static→function outdent, wrapper delegation to module bindings with no recursion, facade call
  sites still `this.X`, leaf-module imports confined to the facade, and the shared `auth.js`
  token-cache binding). Checkpoint B (read path) is UNBLOCKED.**
- **Checkpoint A — leaf batch. BATCHED review.** Stage 1 `auth.js` (+ `resetTokenCache`, C4/C14;
  add characterization for token caching/expiry/missing-env non-transient error), Stage 2
  `restrictions.js` (C3; add characterization for no-context throw, table/field/expand restriction
  denials, requestId-mismatch warn), Stage 3 `annotations.js` (characterize `_etag` preservation +
  annotation suffix mapping). Gates: `check:dataverse-access-layer`,
  `check:dynamics-context-boundary` (restrictions imports `getDynamicsContext`), semgrep token-audit
  (C14).
- **Checkpoint B — read path. EXECUTED S341 + BATCHED review PASSED (Codex behavior-freeze verified); merged to main S342 (`daac9761`).** Stage 4 `schema.js` (C4 `schemaCache` +
  `fieldPromises` in-flight dedupe — characterize the dedupe and TTL paths; `dynamics-service-count`
  + adapter suites cover the rest), Stage 5 `read-ops.js` (85+ spy sites are the de-facto
  characterization; add direct pins for `countRecords` countdistinct fallback semantics `:526-556`,
  `queryAllRecords` 5000-cap/paging `:671-677`, `aggregateRecords` op allowlist `:571-574`,
  `searchRecords` normalization `:741-756`). Gates: `check:dataverse-access-layer`,
  `check:route-service-boundary`, `check:odata-escape`.
  [RECHECKED after lib/services/dynamics/read-ops.js + lib/services/dynamics-service.js change:
  S342 added `// @ts-check` + JSDoc branded-`Guid` annotations for the `check:types` gate (getRecord
  `recordId`, facade write selectors) plus one behavior-preserving guard tweak in `aggregateRecords`;
  the facade read wrappers were restored from `...args` to real typed signatures (runtime-neutral,
  same forwarded args, suite 5144/5144). Extraction/behavior claims above remain accurate; see the
  TS gate note under Checkpoint F and `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.]
- **Checkpoint C — `write-core.js` (Stage 6). CODE-COMPLETE S345; DEDICATED review PENDING.** The
  DAL entity-write core: `_withCallerId`, `_writeFetch`, `createRecord`, `updateRecord`,
  `updateIfEmpty`, `deleteRecord`, `disassociate` moved verbatim to
  `lib/services/dynamics/write-core.js` (333 L) with the C1 svc-dispatch rewrite; facade keeps 7 thin
  delegating wrappers and drops the now-orphaned `fetchWithTimeout`/`API_TIMEOUT` imports (`buildNoResponseError`
  was already import-only on origin/main — pre-existing, deferred to facade-finalize). The 4
  `assertTrustedDalContext` sites (C2) stay first-statement inside the moved mutators; the impersonation
  403-fallback (C12) lives in `_writeFetch`; 412/ETag + plain-Error/`.status` shapes (C13) and the
  `updateIfEmpty` five-outcome discriminated result are byte-identical. Characterization landed FIRST
  (`tests/unit/dynamics-service-write-core.test.js`, 12 tests: `updateIfEmpty`'s five outcomes + read-before-write,
  `deleteRecord`/`disassociate` plain-Error/`.status` + 404-idempotent, `createRecord`/`updateRecord`
  buildServiceError incl. 412) — green pre- and post-extraction. Verified: C1 guard (zero `this.` in
  function bodies); full suite **5190/5190**; build green; ALL FIVE LAW gates + self-tests green
  (`check:dataverse-access-layer` recognizes write-core.js as an exempt dynamics submodule;
  `check:dynamics-context-boundary` 613 files, 0 violations — write-core imports `assertTrustedDalContext`,
  a read, not a bypass); `check:types` green (facade wrappers keep real typed signatures incl. the `Guid`
  brand on `recordId`). Baseline suites (`dal-enforcement`, `dynamics-service-caller-id`,
  `adapters-caller-id`, `reviewer-adapters-writeback`) green pre- and post-move.
  - [RECHECKED after lib/services/dynamics/write-core.js change: S345 — verbatim `_withCallerId`/`_writeFetch`/`createRecord`/`updateRecord`/`updateIfEmpty`/`deleteRecord`/`disassociate`; deps http/constants/dynamics-context/service-error; 4 assert sites first-statement; zero body `this.`; suite 5190/5190]
  - [RECHECKED after lib/services/dynamics-service.js change: S345 — facade rewired (7 delegating wrappers pass `this`; `_withCallerId`/`_writeFetch` svc-less per Q2), orphaned `fetchWithTimeout`/`API_TIMEOUT` imports dropped, behavior-freeze; no stray refs; suite green]
  - [RECHECKED after docs/agent-wiki/topics/dataverse-dynamics.md change: S345 — assert-site file attribution reconciled (4 entity mutators now in write-core.js; executeChangeset + 3 email remain in dynamics-service.js; total still 9); check:agent-wiki green]
  - **DEDICATED adversarial review PASSED (S345, Codex).** Verdict `approve`, "no material findings":
  independently confirmed the moved bodies are behavior-equivalent modulo the planned `this.`→`svc.`
  rewrite, all 4 direct mutators still `assertTrustedDalContext` first, impersonation 403-fallback
  intact, and the 412/ETag/plain-error paths preserved. Gates green pre-review: ALL FIVE —
  `check:dataverse-access-layer`, `check:route-service-boundary`, `check:dynamics-context-boundary`,
  `check:odata-escape`, `check:trust-boundary-guid`. **→ Checkpoint D (`changeset.js`, the
  highest-risk cluster) is UNBLOCKED.**
- **Checkpoint D — `changeset.js` (Stage 7). DEDICATED review — the highest-risk cluster**
  (mirrors ContactEnrichment's isolated `tiers.js`). C11 characterization suite lands and is
  mutation-proven BEFORE the move; review focuses on byte-identical parser/builder bodies, the
  validate-then-assert order (C2), and the fail-closed `allConfirmed` guard. 77 external
  `executeChangeset` refs (reviewer submit flow among them) make this the one stage where a subtle
  parser drift corrupts durable state silently. Gates: `check:dataverse-access-layer`,
  `check:dynamics-context-boundary`.
- **Checkpoint E — `email.js` (Stage 8). DEDICATED review.** These three methods are exempt from the
  static access-layer gate as `NON_ENTITY_TRANSPORT_METHODS` (`check-dataverse-access-layer.js:106`),
  so **the runtime `assertTrustedDalContext` asserts (`:1232,:1304,:1340`) are the ONLY enforcement
  on this surface — a dropped assert would be CI-invisible.** Review confirms assert-first placement
  post-move, the `createAndSendEmail` impersonation precheck (`:1366`), sequential attachment loop
  (`:1373-1376`), and the frozen unescaped `resolveSystemUser` filter (C7 note). Gates:
  `check:dataverse-access-layer`, `check:dynamics-context-boundary`.
- **Checkpoint F — `ai-run.js` (Stage 9) + facade finalize (Stage 10). BATCHED review.** `logAiRun`
  picklist maps + retention plumbing (characterize truncation marker math `:1194-1198` and
  unknown-taskType/status throws); then dead-import cleanup, confirm facade ≈260 L, full suite +
  ALL FIVE law gates + `check:doc-currency`/`check:agent-wiki`/`check:doc-symbol-refs`, update this
  plan's status header, `/sweep` the fact-level restatements (the agent-wiki assert-site count was
  corrected 5→8 in `docs/agent-wiki/topics/dataverse-dynamics.md` S338, commit `426463c` — 8 in
  dynamics-service.js + 1 in `core/changeset.js:97`; re-verify at finalize).
  - **TS gate — facade coverage DONE (S342, `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`).** Checkpoint B
    had turned the facade's read selectors into thin `...args` forwarding wrappers, which erased the
    branded `Guid` signature. S342 restored the read wrappers (`getEntityDefinitions`, `queryRecords`,
    `getRecord`, `countRecords`, `aggregateRecords`, `queryAllRecords`, `searchRecords`,
    `resolveEntitySetName`, `getPrimaryIdAttribute`, `getEntityKey`) to real typed signatures,
    `// @ts-check`'d the facade, and added `dynamics-service.js` to `tsconfig.check.json` — so the
    `Guid` brand now bites callers through the public `DynamicsService.*` API (verified via a facade
    disconfirming check). Runtime-neutral: the wrappers forward the same arguments; full suite
    5144/5144 green. NOTE for facade-finalize: the read wrappers are no longer `...args`.

If any checkpoint review returns a BLOCKER, that checkpoint converges (fold → re-review) before the
next begins.

## Testing

```bash
# Covering suites (baseline before + after each stage)
npx jest tests/unit/dal-enforcement.test.js tests/unit/dynamics-service-count.test.js \
  tests/unit/dynamics-service-caller-id.test.js tests/unit/adapters-caller-id.test.js \
  tests/unit/adapter-characterization-stage2.test.js tests/unit/reviewer-adapters-writeback.test.js \
  tests/unit/review-answers.test.js tests/unit/send-emails-service.test.js \
  tests/unit/test-email-service.test.js tests/unit/verify-suggestion-token.test.js

# LAW gates (mandatory at Checkpoints C and F; per-checkpoint subsets named above)
npm run check:dataverse-access-layer && npm run check:route-service-boundary \
  && npm run check:dynamics-context-boundary && npm run check:odata-escape \
  && npm run check:trust-boundary-guid

# Gate self-tests (mandatory in the Stage-0 commit)
npm run check:dataverse-access-layer:self-test && npm run check:route-service-boundary:self-test

# Full suite
npm test
```

## Risks & unknowns

- **[ASSUMED] Per-module line estimates** — forward estimates for code that does not exist; the
  Stage-0 mechanical call graph re-verifies clustering but not sizes.
- **[ASSUMED] The access-layer gate's "unattributable-use" detection tolerates the facade's new
  `import * as readOps from './dynamics/read-ops.js'` shape.** The facade file is in EXEMPT_FILES, so
  it should be skipped wholesale, but the gate is 43 KB of AST analysis
  (`check-dataverse-access-layer.js`) — Stage 0 must prove this empirically with the self-test, not
  by reading.
- **[ASSUMED] No consumer depends on method function identity across reloads** (e.g. caching
  `DynamicsService.queryRecords` in a variable then comparing). The C1 wrappers change function
  identity exactly once (at decomposition), same as both prior projects; no such consumer was found,
  but the scan was reference-based, not dataflow-based.
- **[ASSUMED] The `svc` parameter convention is acceptable to the owner as the C1 permitted rewrite**
  (prior projects used per-edge facade dispatch; this plan generalizes it because the spy surface
  here is total). If the owner prefers the prior per-edge style, Q1's table stands but every stage's
  diff grows and the review burden rises.
- **[ASSUMED] No script or cron path imports `dynamics-service.js` by a shape the caller reference
  scan missed** (the grep covered `pages/lib/shared/modules/scripts/tests` for `dynamics-service` and
  `DynamicsService.<method>`; dynamic-path imports would evade it).
- **Characterization gaps to close before their stages** (Q4-analog): `getEntityAttributes`
  in-flight-promise dedupe, `getEntityRelationships` partial-failure tolerance (`:405-406` swallows
  a non-ok side), `searchRecords` result normalization, `updateIfEmpty` all five discriminated
  outcomes, the changeset parser (C11 fixtures), `_truncateForMemo` marker math.
- **Known-and-frozen defect surface**: `resolveSystemUser`'s unescaped filter (C7) and
  `getRecord`/`updateRecord`/`deleteRecord` raw id interpolation (guarded at route edge by
  `check:trust-boundary-guid`, not in-service) are carried as-is; fixing them is explicitly a
  post-decomposition follow-up so the freeze stays pure.
