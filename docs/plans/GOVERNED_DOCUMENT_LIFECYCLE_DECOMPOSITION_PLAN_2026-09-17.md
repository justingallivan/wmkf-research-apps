---
title: Governed Document Lifecycle Decomposition Plan
domain: architecture
kind: plan
status: active
summary: Authorized local, staged, behavior-preserving decomposition of document generation, recovery, retained snapshots, distribution, and Final transitions, with test prerequisites and independent review checkpoints.
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Governed Document Lifecycle Decomposition

**Local implementation authorized by the owner on 2026-09-18.** Luna implements
and runs reconnaissance/builds; Sol reviews each stage; the orchestrator performs
final acceptance and takes over stalled correction loops. Work runs on
`codex/document-lifecycle-decomposition`; no push, deployment or live data writes
are authorized. Source planning baseline: `a7cf2518`, 2026-09-17; execution starts
from `02c41a08`. Stages remain **PLANNED** until their execution receipts are accepted.
This is a source-code migration, not a database migration. Accepted stages and
verification are recorded in
`docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md`.

**Implementation annotation — verified locally 2026-09-18.** Stages 1–7 have
accepted behavior-preserving runtime commits and receipts. The original service
modules remain compatibility facades; physical ownership now follows the staged
leaf inventory in this plan, including the neutral governed-DOCX hash leaf and
the distribution prepare/send/history/recovery leaves. This annotation records
source state only; it does not claim deployment or live-data migration.

## 1. Decision and scope

The recommended large refactor is **separating the governed document lifecycle's
transport, identity, read models, recovery, and domain orchestration**. Preserve the
existing public service entry points and the separate domain state machines.

This is an engineering ranking by cross-system failure risk, dependency direction,
and centrality to staff workflows; it is not a claim that file size proves a uniquely
largest refactor. Four implementation files contain 6,621 lines at this baseline:

| Source file under `lib/services/` | Lines | Reason to include |
|---|---:|---|
| `initial-assessment/artifact-service.js` | 1,648 | Owns cross-domain DOCX hashing as well as generation, registry claims, upload recovery, lineage, and reads. |
| `pre-site-visit/artifact-service.js` | 1,464 | Mixes prompt/input validation, versioned persisted envelopes, projections, generation and activation fences. |
| `pre-site-visit/distribution-service.js` | 2,428 | Mixes current Brief distribution, legacy attempts, retained snapshots, preview identity, email recovery/send, and history. |
| `final-writeup/transition-service.js` | 1,081 | Mixes state resolution, authorization, file verification, claim recovery, activation, and leadership review. |

**VERIFIED via source census and importer search:** ten other service files import
`hashGovernedDocxContent` from Initial Assessment. Meeting Tracker imports recipient
normalization from distribution. These dependencies pull unrelated orchestration
into consumers that need only a small primitive.

Alternatives inspected: `ReviewerSearchSection.js` (3,767 lines), `pages/admin.js`
(3,536), `graph-service.js` (1,641), and `execute-prompt.js` (1,281). UI decomposition
is worthwhile but has a different scope. Graph/Executor are narrower platform seams.
DAL, route/service, Discovery, Contact Enrichment, and Dynamics decomposition already
have plans and implemented boundaries; do not re-run those programs under this name.
No matching document-service decomposition plan was found in the audited `docs/`,
`.claude-memory/`, and current handoff. Nearby feature plans exist, notably the
Pre-Research Presentation Brief plan. This is a bounded search result, not a claim
about developers' intentions or whether anyone previously considered this work.

### Explicit limits

- No schema, alternate key, migration, persisted payload, prompt, template, generation
  key, hash prefix, URL, route, authorization, readiness-flag, or user-flow change.
- No new generic workflow engine, shared claim state machine, queue, retry policy,
  DI framework, feature flag, or Next.js router migration.
- Keep `pre-site-visit/reopen-service.js`, Initial Assessment controls, Pre-RP Brief
  generation/share-lock, briefing-page behavior, review-file behavior, Graph, Executor,
  DAL, `distribution-store.js`, and renderers intact. They are regression consumers;
  only neutral-hash import changes are allowed there.
- Do not rename the `pre-site-visit` public directory or distribution routes. The
  misleading legacy name is not a reason to bundle a product/API rename into this work.
- Keep compatibility facades permanently for this plan. No deletion stage is required.
- Newly discovered behavior defects become separate issues. Do not fix them during
  extraction or silently bless them by changing expected tests.

### Sequencing with active work

Before Stage 0, check the current branch, dirty files, active owner, and latest Brief/
review-bundle changes. The handoff's Production bundle-rebuild smoke is still separate
work. Do not imply this refactor closes it. Rebase the inventory if feature changes
land in any owned file. This plan does not change the product priority queue.

## 2. Verified contracts and evidence limits

Line numbers describe the baseline; symbol names are the durable anchors. Re-read
current source before every stage. **VERIFIED** here means local source/tests, not
fresh Production verification. No live data or deployment probes were run for this plan.
Source locations below are relative to `lib/services/` unless a full repo-relative
path is shown.
The Atlas was consulted for ownership; its historical deployment statements are not
used as proof of the current deployment.

| Contract | Source evidence | Required preservation |
|---|---|---|
| Staff caller → authenticated identity → service | `pages/api/workbench/initial-assessment.js`; `pre-site-visit.js`; `pre-site-visit/distribution/send.js` | Keep `requireAppAccess`, `withDalContext`, allowlisted bodies, and session-derived actor/sender. Services remain downstream of these gates. |
| Initial Assessment generation | `initial-assessment/artifact-service.js:1138` `generateInitialAssessment`; `:699` `commitReadyLineage` | Narrative → identity → claim → Executor → DOCX/hash → upload → atomic registry/pointer/supersession → readback. No Ready result before confirmation. |
| IA replay differs from Pre-Site | IA `:1170`; Pre-Site `:1188` and `:889` | IA can reactivate an exact superseded Ready artifact. Pre-Site refuses stale lineage replay and fences activation against the observed pointer/correction cycle. Do not unify. |
| Pre-Site persisted draft | `pre-site-visit/artifact-service.js:796,1125` | Read persisted output/snapshot before rendering; failed upload retry can avoid another model call. Current writer emits envelope v4; older envelopes remain readable. |
| Shared DOCX identity | IA `:95-342` including `hashGovernedDocxContent` | Preserve `gdc1:` and package validation, relationship reachability, normalization, exact error behavior. Raw ZIP SHA-256 is not an equivalent replacement. |
| Current distribution source | `distribution-service.js:101-115,497-562,1527` | Current Pre-RP Brief pointer, drift gate before writes; new prepare mode `none`; reject stale-client attachment/material selections. Existing attempt modes remain readable/retryable subject to current source checks. |
| Frozen file ownership | `distribution-service.js:905,1020,1493`; `distribution-store.js` | SharePoint bytes + Request Document lineage; PG preview/send ledger; Dynamics activity/transport. A review bundle is a distinct retained PDF producer. |
| Word versus PDF/ICS identity | `distribution-service.js:2081` `attachmentContentMatches` | Governed Word hash; raw bytes for PDF/ICS; preserve recovered attachment checks and the existing size distinctions. |
| Send ambiguity and lease ordering | `distribution-service.js:2161-2335` | Reconcile already accepted send before liveness checks; recheck source/extensions/link before durable intent; renew lease immediately before transport. Do not promise exactly-once across stores. |
| Final adoption | `final-writeup/transition-service.js:615,739` | Reuse the same Word item, no copy/upload; atomically finalize source, ready Final row, set Final pointer, retain Pre-Site pointer. |
| Leadership checkpoint | `final-writeup/transition-service.js:924` | Distinct transition on existing Final row; retain actor/time and milestone immutability rules. |
| Writer enforcement | `scripts/check-request-document-writers.js:16-26,56-91` | Exact file-specific create seams, actor policies, and total adapter wiring census. Array has nine entries at baseline; header's eight is stale. Never derive count from header. |

### End-to-end contract map

| Flow | Entry/consumer | Persistence and return path | Failure boundary to test |
|---|---|---|---|
| IA | `InitialAssessmentTab` → `/api/workbench/initial-assessment` → service; cycles/versions use same facade | Request Document + current IA pointer + stable Graph item → artifact/attempt/milestone DTO → tab | Upload success with ambiguous/failed activation; preserve current Ready and newer pending attempt. |
| Pre-Site | `StaffDeliberationsTab` → `/api/workbench/pre-site-visit` → service | Persisted input/core → Graph → current Pre-Site pointer → staff-safe route projection → tab | Prompt race, pointer changes, promoted lifecycle, v2/v3/v4 diagnostics, no correction audit leakage. |
| Distribution | `PreSiteDistributionPanel` → prepare/preview → explicit send route | PG attempt → retained registry/files → Dynamics activity/attachments/transport → receipt/history | Lost prepare/send responses, changed preview, sender mismatch, attachments partly complete, accepted transport with expired link. |
| Briefing bundle | verified external briefing route → `briefing-page-service` → `retainReviewBundle` | retained PDF + PG bundle pointers → authorized member download | Rebuild from live review set; no changed token/member scope or source binding. |
| Final | `FinalWriteupTab` → Final and leadership routes → transition service | same Graph item + source/Final rows + distinct request pointers → status DTO | Source changes during verification, competing claim, lost atomic response, unauthorized actor. |

The browser's async generation/selection guards are regression scope, not refactor
scope. No new UI state writes, background work, or partial-batch semantics are added.
The existing scalar/enum values and every reader remain unchanged.

## 3. Target structure and dependency rules

**Migration specification.** Move existing functions, not behavior. Filenames below
are exact destinations; accepted stages are identified in the execution record. Retain all currently exported names at the original public file.
Use direct named imports/re-exports; no wildcard barrels.

1. Neutral leaf `lib/services/documents/governed-docx-hash.js` may import Node crypto
   and JSZip. It must not import a domain service, Graph, DAL, Executor, or settings.
2. Each domain's `artifact-model.js` or `transition-model.js` owns that domain's
   constants, pure projections, identity builders, and validation. Similar-looking
   helpers in different domains stay separate unless this plan explicitly moves them.
3. Domain read/state, lineage, and recovery modules import leaf modules and existing
   adapters/transports. They never import their public facade.
4. Public facades retain orchestration entry points or explicit exports and existing
   function signatures/defaults. External callers continue through facades except
   the ten intentional hash importer changes and agenda's normalizer import.
5. Initial Assessment keeps its existing direct adapter/module mocking seams. Do not
   rewrite it to dependency injection. Pre-Site, distribution, and Final preserve their
   existing dependency-object identity, default evaluation, overrides, and method lookup.
6. Default dependency objects get one owner per domain. New dependency modules import
   existing adapter/transport bindings and the existing injected Brief, link, and
   session services; never their own orchestration/read module.
   Do not duplicate `createDocument: requestDocumentAdapter.create` across files.
7. A moved helper exports only what another planned module needs. Preserve public
   facades without turning every private function into a new public API.

The exit condition is named ownership and acyclic dependencies, not an arbitrary line
limit. Expected facades retain a few hundred lines of domain sequencing; do not invent
abstractions merely to hit a target.

## 4. Common gate between EVERY stage

A stage is one reviewable change set. Run its prerequisite tests **before editing**.
If a prerequisite case is missing, add it against the old implementation in a separate
green test-only commit first. Do not mark a test implemented merely because a filename
exists. At each boundary record test names and scenario evidence, not only a count.

1. Verify branch/head and clean ownership; record baseline and file fingerprints.
2. Run prerequisite suites. A baseline failure blocks that stage; investigate separately.
3. Move the listed symbols and imports. Preserve conditional order, catch regions,
   property insertion order used in hashes, error codes/DTOs, and side-effect counts.
4. Run the stage suites, plus all prior stage suites. Inspect the full diff.
5. Run the runtime gate battery below, each gate followed by its self-test sequentially.
6. Run `npm run lint`, `npm run check:types`, `npm test -- --runInBand --silent`, then
   `npm run build`. Build and full tests are mandatory for each completed stage, not
   claimed as already run during planning. Do not run builds concurrently.
7. Obtain a fresh-context review under §9 and resolve findings. Re-run affected checks
   after corrections. Commit only the passing stage; record SHA, results and rollback.

Runtime gates: `check:request-document-writers`, `check:dataverse-access-layer`,
`check:dynamics-context-boundary`, `check:route-service-boundary`,
`check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:odata-escape`,
`check:api-routes`, `check:atlas`, `check:status-enum-parity`,
`check:prompt-injection-tagging`, `check:fact-consistency`, `check:doc-symbol-refs`,
`check:build-claim-freshness`, `check:canonical-pointers`, `check:doc-currency`,
`check:harness-framing`, and their defined self-tests. Also run
`check:migrations-manifest`, `check:docs-catalog`, and any newly applicable checks
found in current `package.json`/CI. Never waive a gate by excluding new directories.

Build note: `prebuild` runs the reminder hold and builds the migrations manifest.
Inspect resulting diffs; this plan permits no schema/migration change. A sandbox
Turbopack process/port denial is an environment failure: retry the same build through
host approval per CI runbook. A webpack fallback must be reported as a fallback and
does not satisfy a claimed canonical build pass. Do not delete `.next` blindly.

No credentialed Generation, Send, restore, cleanup, migration, or Production read is
part of local verification. Tests mock I/O. Feature-specific preview/Production
rehearsals require the release authorization and data controls in §10.

## 5. Test inventory and prerequisite contracts

### Existing suites, inspected at planning time

Paths in this table are under `tests/unit/`; run with
`npm test -- --runInBand --silent <full-path> ...`.

| ID | Suites | What they currently exercise |
|---|---|---|
| H | `initial-assessment-artifact-service.test.js`, `review-docx-governed-hash.test.js` | Real DOCX package fixtures; content changes versus package normalization; malformed/transitive relationship rejection; shipped templates. |
| IA | `initial-assessment-artifact-service.test.js`, `initial-assessment-artifact-versions.test.js`, `workbench-initial-assessment-route.test.js` | Ready reuse/reactivation, ambiguous activation, exact cleanup, actor projection, file metadata, API contract. |
| PSV | `pre-site-visit-artifact-service.test.js`, `workbench-pre-site-visit-route.test.js` | Replay/pointer fences, snapshots/diagnostics, persisted-output retry, promoted lifecycle guard, route filtering. |
| DIST | `pre-site-distribution-service.test.js`, `pre-site-distribution-store.test.js`, `workbench-pre-site-visit-distribution-prepare-route.test.js` | Exact preview, drift acknowledgement, real roster→input→bundle contract, Word normalization, partial recovery, competing prepares, ledger writes. |
| FINAL | `final-writeup-transition-service.test.js`, `final-writeup-leadership-transition-service.test.js`, `workbench-final-writeup-route.test.js` | Same-item adoption, actor rules, claim conflict, atomic readback, leadership transition. |

**Executed at planning baseline:** the 12 distinct suites above passed, 293 tests.
This does not prove all additional tests below already exist or that Production is green.

### Tests that must be added or positively mapped before code moves

These are **PLANNED test requirements**, not fabricated existing coverage. Stage 0
records an exact existing test name for a requirement or implements the missing case.
Use the existing suites for behavior cases; add these focused files:
`tests/unit/document-lifecycle-public-contract.test.js`,
`tests/unit/document-lifecycle-import-boundary.test.js`,
`tests/unit/workbench-pre-site-visit-distribution-send-route.test.js`, and
`tests/unit/workbench-pre-site-visit-distribution-history-route.test.js`.
Both route suites must exercise method rejection, denied access,
`ServiceHttpError` status/body and successful responses. The **send** suite also
pins its body allowlist and session-derived sender/actor. The **history** suite
pins GET, the trimmed query `requestId`, downstream GUID validation, and the
existing absence of body validation/actor injection; do not add either behavior.
At least one public
contract case per flow must connect the real route/service/projection with mocked I/O
boundaries; mocking the service itself cannot prove extraction parity.

| Requirement | Minimum meaningful fixture/assertions | Required before |
|---|---|---|
| T0: public compatibility | Pin sorted exports for all four old modules; cover default dependencies and explicit injected overrides; preserve old route mocks and `ServiceHttpError` identity. | Any move |
| T1: hash compatibility | Before editing: fixed expected `gdc1:` digests and error fixtures from the old implementation, including real normalized/malformed packages and legacy/unknown scheme recovery. During Stage 1: add new-leaf versus frozen-value assertions and old-path compatibility. Two wrappers calling one changed function are not an independent oracle. | Baseline cases before Stage 1; new-path cases before its exit |
| T2: read purity/projection | Spies for every write/AI/upload/delete call; current+newer pending+milestone and malformed/unknown rows actually present; metadata fail/deadline cases; no correction audit for ordinary staff. | Stages 2, 4, 7 |
| T3: IA failure trace | Per-step ordered effect trace for fresh/reuse/reactivation; lost response before/after committed changeset; wrong pointer or competing Ready row; newer claimant and exact losing-upload cleanup; cleanup overflow; injected 412. | Stage 3 |
| T4: Pre-Site divergence | Exact old-Ready replay refused while IA reactivation stays allowed; pointer/correction-cycle changes; v2/v3/v4 reads; prompt change; persisted draft retry; failed upload then restart; unknown lifecycle/content rejected. | Stage 4 |
| T5: distribution compatibility | New mode none and stale-client legacy modes rejected; existing docx/pdf/both/ICS attempts exercised at send; stored source still eligible versus stale legacy source separately; default overrides and preview identity unchanged. | Stage 5a |
| T6: retention and recovery | DOCX normalized content versus byte hash; PDF/ICS exact bytes; upload-completed/row-not-Ready recovery; unknown existing path retained safely; snapshot conflict; review-bundle rebuild consumer uses real retention logic with mocked external I/O. | Stage 5b |
| T7: send/restart safety | For each persistence/transport boundary inject a lost response, replay from persisted fixture; accepted transport checked before expired link; stale source/slot/material/link blocks before intent; lost lease prevents send; ambiguous outcome stays uncertain; partial attachments do not duplicate. | Stage 6 |
| T8: Final identity/authorization | Same item, no upload/copy; strict actor gate; competing/expired claim; source change between reads; atomic pointer/lifecycle update; accepted ambiguous commit; leadership leaves milestone triple intact. | Stage 7 |
| T9: architectural enforcement | New neutral leaves cannot import domain orchestrators; internal modules cannot import old facade; no new cycles; old exports remain; no unregistered writer or duplicated adapter binding. Include deliberate failing fixture/import. | Stage 8 (baseline export half in Stage 0) |

Freeze time/UUIDs only in tests. Compare ordered adapter/Graph/Executor operations,
exact generation/preview hashes, normalized DTOs and persistent patches at public
boundaries. Do not snapshot volatile timestamps or change production code to make tests
easy. Negative assertions require the forbidden condition to be present in the fixture.
Do not split/rename legacy test files during these stages; retain them as compatibility
oracles. A green test suite achieved by mocking away the moved implementation is invalid.

## 6. Ordered migration stages

| Checkpoint | Resulting boundary | Creation seam moved? |
|---|---|---|
| 0 | Existing behavior characterized before extraction | No |
| 1 | Neutral governed-DOCX hash leaf | No |
| 2 | IA model and reader | No |
| 3 | IA lineage and upload recovery | No |
| 4 | Pre-Site model, reader, lineage and recovery | No |
| 5a | Distribution model, composition, dependencies and context | No |
| 5b | Retained snapshots/bundles | Yes; update writer registry atomically |
| 6 | Distribution prepare, send, email recovery and history | No |
| 7 | Final state/claims with distinct command orchestrators | No |
| 8 | Import/export boundaries and durable documentation | No |

Every numbered stage, including 5a and 5b, ends at §4. Destination paths are planned
until their stage is accepted in the execution record.
Within a stage the file order below is mandatory: leaves before their consumers.
Edits that move a function and repair all its callers belong in one green commit;
never commit an intermediate tree with missing imports.

### Stage 0 — Freeze the boundary and prove the test harness

**Before starting:** read this plan plus current source; reproduce H/IA/PSV/DIST/FINAL;
resolve concurrent feature work. No runtime file move is permitted here.

1. Add T0 export/public-boundary assertions and record exact baseline hashes/effect
   traces for T1–T8 in the existing test suites. Missing fixtures for later stages can
   land in a test-only prerequisite commit immediately before that stage, but no
   runtime extraction may start before its listed cases pass against old code.
2. Start T9 with public export baseline and explicit list of four old entry points.
3. Record current writer array, importer census, suite inventory, input-envelope
   versions, and branch SHA in the stage receipt. Avoid copying live client data.
4. Full tests/lint/types/build and fresh review. Rollback is test-only revert.

### Stage 1 — Extract governed DOCX identity without changing a hash

**Before starting:** T0 + T1, H; consumer hash tests mapped.

1. Create `lib/services/documents/governed-docx-hash.js`.
   Move IA symbols `compareText`, `parseRelationships`, `resolvePartName`,
   `relationshipPartName`, `packagePartIndex`, `parseContentTypeOverrides`,
   `isGovernedWordContentType`, `assertPackageOpensGovernedDocument`,
   `canonicalizeDocumentRelationships`, `hashGovernedDocxContent`, and their
   constants (`GOVERNED_DOCX_HASH_PREFIX`, `OFFICE_DOCUMENT_RELATIONSHIP`);
   copy crypto/JSZip imports into the leaf. Export the prefix for internal recovery
   use, but do not add it to the old facade public API. Preserve source bodies exactly.
2. IA imports and explicitly re-exports the hash at its old path; remove only the
   moved definitions. Import `GOVERNED_DOCX_HASH_PREFIX` into the old IA module
   because `recoverUploadedFile` still reads it. Keep crypto in that module for
   `sha256` and `randomUUID`; only JSZip becomes unused there. At Stages 2–3 keep
   crypto imports in each model/lineage/facade that still calls it.
3. Change hash imports, in this order: IA controls; Pre-Site artifact, transition,
   reopen, distribution; Final transition; Pre-RP Brief artifact, share-lock;
   review-documents individual-file; deliberation-briefing page. A file importing
   IA `projectArtifact` as well must keep that import for now.
4. Update the mock in `tests/unit/individual-review-file-service.test.js` to mock
   the neutral hash leaf. Do not drop assertions or replace real hash fixture tests.
   Search *all* `jest.mock`/`require`/imports for the old hash path before finishing.

**Verify:** T1 unchanged digest fixtures through both import paths; all four core
suite groups; `initial-assessment-controls-service`, `initial-assessment-controls`
routes/versions tests, `pre-rp-brief-artifact-service`, `pre-site-visit-reopen-service`,
`individual-review-file-service`, `deliberation-briefing-page-service` tests and other
hash consumers identified in Stage 0. Writer registry is unchanged.
**Rollback:** revert imports and leaf extraction together; no persisted identity change.

### Stage 2 — Isolate Initial Assessment model and reads

**Before starting:** T0/T2, IA and Initial Assessment tab/version/control tests.

1. Create `initial-assessment/artifact-model.js`: IA's non-hash constants/select
   lists, `sha256`, `sameId`, `sanitizeFilePart`, `sanitizeError`, `validateGenerated`,
   `assertKnownRegistryRow`, `parseOrphanCleanup`, `projectArtifact`,
   `buildInitialAssessmentIdentity`. Import neutral hash only where actually used.
   Preserve the identity object's property order and all projection defaults.
2. Create `initial-assessment/artifact-reader.js`: `refreshArtifactFileMetadata`,
   `listInitialAssessmentArtifacts`, `resolveCanonicalInitialAssessment`,
   `listInitialAssessmentArtifactVersions`, `listInitialAssessmentCycles` with
   their existing direct adapter/Graph imports. Metadata concurrency and budget
   constants come from the model; do not change read scheduling.
3. Original `artifact-service.js` imports/re-exports the currently public model/read
   functions, retains generation, and uses model helpers directly. Controls continue
   through its old `projectArtifact` export. No internal reader imports the facade.

**Verify:** T2 exact DTOs/order, Ready/pending/milestone separation, zero durable writes
on reads, metadata timeout/failure and versions; old route/test mocks still intercept.
**Rollback:** revert this stage; Stage 1 neutral hash remains valid.

### Stage 3 — Isolate Initial Assessment claim, lineage, and upload recovery

**Before starting:** T3 must pass on Stage 2 tree; IA suites and controls regressions.

1. Create `initial-assessment/artifact-lineage.js`: `getRequestOrThrow`,
   `getActiveRequestBucket`, `rereadByGenerationKey`, `conditionalOptions`,
   `generatingLeaseActive`, `assertOwnedClaim`, `verifyReadyLineage`,
   `commitReadyLineage`, `claimExisting`, `prepareClaimForGeneration`,
   `markFailedIfOwned`. It depends on the model, adapters, bucket utility and
   changeset helper, never upload recovery or the facade.
2. Create `initial-assessment/artifact-upload-recovery.js`: `recordOrphanCleanup`,
   `cleanupSupersededUpload`, `recoverUploadedFile`; imports lineage/model/hash
   and Graph. Import `GOVERNED_DOCX_HASH_PREFIX` directly from the neutral leaf.
   Preserve current legacy raw-hash recovery and unknown-scheme rejection; both
   are present at baseline (`recoverUploadedFile`, lines 963–1006).
3. Leave the whole `generateInitialAssessment` body in `artifact-service.js`;
   replace helper references with direct imports. Keep its one create call and
   actor policy at the existing registered writer path. Re-export `commitReadyLineage`
   explicitly as before. No new default dependency object.

**Verify:** T3 ordered effect traces, unknown/ambiguous readbacks, exact cleanup
ownership and overflow; no flattening of nested try/catch scopes. Writer gate must
pass with the same IA registry entry and adapter wiring count.
**Rollback:** revert this extraction only; same public API and persisted rows.

### Stage 4 — Separate Pre-Site model/read logic from generation fences

**Before starting:** T2/T4; PSV, Pre-Site renderer, proposal-core, reopen and route tests.
This can be split into 4a (model/read) and 4b (lineage/recovery); each must run §4.

1. Create `pre-site-visit/artifact-model.js`: existing non-default constants,
   `sha256`, `sameNullableId`, `sanitizeFilePart`, `sanitizeError`,
   `conditionalOptions`, `parseJsonField`, `validateNarrativePrompt`,
   `validateTemplateContract`, `parseCleanupQueue`, `sourceManifest`,
   `buildPreSiteVisitInputSnapshot`, `buildPreSiteVisitIdentity`, `fileNameFor`,
   `assertPreSiteWordRow`, `validateDiagnostics`, `diagnosticsForRow`,
   `projectWarnings`, `projectPreSiteVisitArtifact`, `projectReopenHistory`,
   `staleGenerationReplayError`, `proposalCorePatch`, `documentFieldsFromSnapshot`,
   `persistedDraft`, `renderFingerprint`. Move each function's constants with it;
   keep template and prompt validators' existing imports. Do not merge diagnostics
   parsing with another domain or alter v2/v3/v4 fallback behavior.
2. Create `pre-site-visit/artifact-dependencies.js`: the one existing
   `DEFAULT_DEPENDENCIES` object, verbatim defaults. It may use select constants
   from the model; model must not import dependencies.
3. Create `pre-site-visit/artifact-reader.js`: `getPreSiteVisitArtifactStatus`.
   Import model and defaults; preserve explicit passed dependency objects.
4. Create `pre-site-visit/artifact-lineage.js`: `rereadByGenerationKey`,
   `generatingLeaseActive`, `assertOwnedClaim`, `claimExisting`, `markFailedIfOwned`,
   `activeRequestBucket`, `verifyReadyLineage`, `commitReadyLineage`,
   `prepareFreshFilename`. Import model; dependencies are passed exactly as today.
5. Create `pre-site-visit/artifact-upload-recovery.js`: `recordCleanup`,
   `recoverUploadedFile`, depending on model/lineage. Do not import the facade.
6. Keep `generatePreSiteVisitArtifact` in original `artifact-service.js`; retain
   current exports through direct bindings and the original create call. Import
   defaults from their sole owner. The writer registry path remains unchanged.

**Verify:** T4 proves IA reactivation and Pre-Site stale-replay rejection remain
intentionally different; ownership/expected-pointer/correction-cycle checks occur in
the same order, with the same cleanup decisions. Same envelopes and warning DTOs.
**Rollback:** revert current substage; no data conversion is needed.

### Stage 5a — Extract distribution leaves and composition context

**Before starting:** T0/T5; DIST plus agenda and distribution-panel tests.
All destinations below are under `lib/services/pre-site-visit/distribution/`.

1. Create `model.js`: existing distribution constants, `distributionError`, `sameId`,
   `sha256`, `canonicalHash`, `parseStoredObject`, `parseStoredArray`,
   `materialLinkComparisonTuple`, `materialLinksMatch`, `attemptAttachments`,
   `assertPreparedAttachments`, `projectDistributionAttempt`. Preserve current
   versus legacy mode sets and projection handling.
2. Create `composition.js`: `normalizeDistributionRecipients`,
   `includeCalendarOrganizer`, `escapeHtml`, `reviewBundleDocumentUrl`,
   `renderBriefingBody`, `sessionSnapshotOf`, `sessionSnapshotsMatch`,
   `sessionLineText`, `sessionHtml`, `briefingLinkHtml`, `distributionBodyHtml`,
   `normalizeComposeInput`. Own `BRIEFING_LINK_PLACEHOLDER` and
   `REVIEW_BUNDLE_LINK_PLACEHOLDER` here; other constants import from model.
   Keep `PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION` as the old facade alias of
   model `TEMPLATE_VERSION`; no public export or value changes.
3. Create `dependencies.js`: move the existing default object exactly once. Keep
   adapter/Graph/store/Brief/link/session dependencies; correct relative imports.
   It imports neither context nor original distribution facade. Where context's
   existing public defaults are needed, import this module; dependency graph stays
   one way. Preserve same wrapped Graph method lookup and direct adapter references.
4. Create `context.js`: `readDeliberationShareDefault`, `readDeliberationShareDefaults`,
   `readSessionSnapshot`, `eligibleMaterial`, `resolveMaterialLinks`,
   `calendarSnapshot`, `buildCalendar`, `resolveCalendar`, `resolveSource`,
   `receivedBoolean`, `computeStaleInputsDelta`, `assertBriefInputsReady`,
   `resolveBriefingLink`, `resolveBoundBriefingUrl`, `assertAttemptSourceCurrent`,
   `assertAttemptExtensionsCurrent`. It imports model/composition; all I/O dependencies
   stay explicit. Export `buildCalendar` for attachment recovery, not a new SDK.
5. Old `distribution-service.js` explicitly re-exports existing public helpers and
   keeps prepare/send/history/retention for now. Change only agenda's
   `normalizeDistributionRecipients` import to `distribution/composition.js`.

**Verify:** exact recipient validation/errors, rendering/escaping/placeholders,
legacy attempts, calendar byte identity, settings fallback semantics, override
injection, current Brief pointer and fail-before-write drift gate. Hash serialization
must retain insertion order. No create call moved yet; binding census stays constant.
**Rollback:** revert together, including agenda import; no external effect.

### Stage 5b — Isolate retained snapshots and review-bundle retention

**Before starting:** T6, DIST, `review-bundle-service` and briefing-page tests.

1. Create `distribution/retained-snapshot.js`: `assertStableSource`,
   `assertStableFrozenWord`, `captureCurrentSource`, `loadCapturedSource`,
   `oneSnapshotRow`, `snapshotProjection`, `assertStableSnapshotRead`,
   `stableUploadedMetadata`, `validateReadySnapshot`, `slugifyInstitutionName`,
   `ensureSnapshot`, `retainReviewBundle`. Import model, defaults only for the
   public defaulted function, and the existing `review-bundle-service.js` assembler.
   Do not move or modify bundle assembly itself.
2. Old facade imports these helpers and re-exports `retainReviewBundle` with its
   original positional signature, including the third actor argument. Briefing-page
   caller stays at the facade for compatibility; no direct import is required.
3. In the same commit update only the distribution entry in
   `scripts/check-request-document-writers.js` to the new physical create file
   `lib/services/pre-site-visit/distribution/retained-snapshot.js`, keeping
   `dependencies.createDocument(` and `REQUIRED`. One default adapter binding
   remains in `dependencies.js`; do not add another. Add self-test cases proving
   missing/moved writer, duplicate create/binding, wrong policy and missing actor
   context still fail. Update scoped path references in current docs/Atlas.

**Verify:** retain all nine registered seams and policies; gate and self-test in
sequence; T6 distinguishes normalized DOCX from PDF/ICS bytes; exact interrupted
finalization recovery and bundle consumer work through old facade. No registry/snapshot
producer or folder/filename change; no GC or legacy deletion.
**Rollback:** revert physical move, facade imports and registry entry together.

### Stage 6 — Separate prepare, send, and history without changing their sequencing

**Before starting:** T7 plus T5/T6; DIST, store schema parity, prepare route,
distribution panel, briefing page, and agenda suites.

1. Create `distribution/email-recovery.js`: `recoverEmailActivity`,
   `persistEmailIdentity`, `assertEmailActivityMatches`, `attachmentContentMatches`,
   `ensureEmailAttachment`. Import model and `context.buildCalendar`; no send intent
   or lease ownership may move into this helper.
2. Create `distribution/prepare.js`: the whole `preparePreSiteDistribution` body,
   defaults from `dependencies.js`, helpers from the Stage 5 modules. Keep its
   exact ordered drift/identity/freeze/ledger sequence, not a new pipeline runner.
3. Create `distribution/send.js`: the whole `sendPreSiteDistribution` body,
   same defaults, helpers above. Keep early accepted-send recovery, two liveness
   checks, intent, lease renewal, transport and uncertainty handling in this file.
4. Create `distribution/history.js`: `resolveAcknowledgingActorNames` and
   `getPreSiteDistributionHistory`, same dependency defaults and best-effort name
   lookup behavior. Preserve template version export at original facade.
5. Reduce old `distribution-service.js` to explicit exports of the original public
   names from model/composition/context/retention/prepare/send/history. No new
   caller import churn. Ensure it has no side effects or back-import cycle.

**Verify:** T7 ordered traces, confirmed-versus-uncertain DTOs and restart cases;
legacy sent rows and in-progress attempts; no duplicate model/upload/email/attachment
under covered recovery cases. Full behavior suites exercise real extracted modules,
with only external systems mocked. Physical create seam remains Stage 5b's location.
**Rollback:** revert Stage 6; Stage 5 facades still read every existing attempt.

### Stage 7 — Decompose Final state and activation; keep commands distinct

**Before starting:** T2/T8; FINAL, leadership routes, Final tab/dashboard tests.

1. Create `final-writeup/transition-model.js`: non-default constants including
   request select, copied fields and verification error tuples; `sameId`, `sha256`,
   `finalError`, `sanitizeError`, `conditionalOptions`, `assertKnownRow`,
   `stableMetadataMatches`, `persistedIdentityMatches`, `requestRows`,
   `resolveSource`, `assertEligibleSource`, `resolveAuthorization`, `projectArtifact`,
   `findCurrentFinal`, `stageOf`, `committedFinal`, `pendingFinalForSource`,
   `generationKey`, `claimPayload`, `leadershipConflict`, `leadershipResult`,
   `leadershipCommittedByThisCall`. Preserve distinct error tuples.
2. Create `final-writeup/transition-dependencies.js`: existing default object once;
   model constants allowed, no command imports.
3. Create `final-writeup/transition-state.js`: `readState`, `getFinalWriteupStatus`,
   `verifyDocument`, `verifySource`. Same dependency/default behavior, Graph
   before/after reads and schema-off status behavior.
4. Create `final-writeup/transition-claims.js`: `rereadByGenerationKey`,
   `assertClaimIdentity`, `leaseActive`, `claimExisting`, `reconcileCompetingClaim`,
   `assertOwned`, `activate`, `markFailedIfOwned`; imports model/state, never facade.
5. Leave `startFinalWriteup` and `advanceToLeadershipReview` bodies in original
   `transition-service.js`. Explicitly re-export existing status, generation-key,
   projection names; preserve exported aliases. Keep the one create call and
   registered actor policy in that original file.

**Verify:** T8, no upload/copy or new source query, exact conditional changeset
payload/order/readback, fallback actor-resolution semantics, source/Final pointer
separation, leadership actor/time and milestone fields. No generic generation helper.
**Rollback:** revert stage; same rows, pointers and files remain readable.

### Stage 8 — Enforce boundaries and close the source migration

**Before starting:** all previous stages green; T9 negative fixtures implemented.

1. Complete import-boundary test: hash leaf imports no domains/transports; agenda
   does not import the distribution coordinator; domain internals do not import
   their facade; new module graph has no cycles. Use AST import/export/dynamic
   import/require inspection, not a blanket filename substring assertion.
2. Check every old exported name against Stage 0 manifest and every moved symbol
   against §6. No route URL/guard, DTO, prompt/template/producer/version, persisted
   field/enum/hash change. Keep old facade tests; no facade deletion.
3. Update source headers, relevant catalog entries, Atlas path pointers, and current
   plan/handoff references for physical writer/read moves. Search literal old paths
   and symbols across runtime, tests, docs, memory and wiki; classify historical
   references rather than rewriting old evidence. No broad unrelated docs audit.
4. Full §4 gates/tests/build, fresh final review and artifact fingerprint receipt.
   Verify no migrations, schema, dependency lockfile, readiness/env, cron, or UI
   behavior changes occurred. Stop before any push/deployment without authorization.

**Rollback:** test/docs commit can be reverted independently. Runtime rollback uses
reverse stage order on an isolated branch; do not revert unrelated feature commits.

## 7. Exact writer registry schedule

| Boundary | IA create file | PSV create file | Distribution create file | Final create file |
|---|---|---|---|---|
| Baseline–5a | original artifact service | original artifact service | original distribution service | original transition service |
| 5b onward | unchanged | unchanged | `pre-site-visit/distribution/retained-snapshot.js` | unchanged |

All other writer rows and policies remain byte-for-byte unchanged. The gate scans
physical source text and separately counts adapter binding strings. Passing imports
through additional `requestDocumentAdapter.create` aliases can break the count even
without an extra runtime call. Verify the literal census AND the actual behavior;
do not weaken the check or add a second registered creation path to accommodate a move.

## 8. Stage receipts and stop conditions for a lower-cost executor

Work on **one stage only** per task. Suggested runtime branch:
`codex/document-lifecycle-decomposition`. New stage starts from the prior accepted
commit, never a concurrent dirty checkout. Use the same agent/module authentication
rules as the repository; no provider API keys for delegated reviews.

Required receipt:

```text
Stage / prior accepted SHA / current SHA:
Files and symbols moved (old → new):
Invariants and existing test names verified before editing:
New prerequisite cases added before runtime edits:
Ordered side-effect / hash / DTO comparison results:
Scoped tests, full test run, lint, types, canonical build:
Gate then self-test results:
Independent reviewer ID + reviewed file/diff fingerprint + verdict:
Findings fixed; checks re-run after fixes:
Remaining unknowns and release authorization:
Rollback commit(s):
Next permitted stage:
```

Stop and re-plan when a source symbol/consumer differs from the inventory, a new import
cycle is required, a test needs a behavior expectation changed, a public default or
mock seam changes, writer census/policy changes unexpectedly, or an external write
would be needed to prove a claim. A timeout is not a passing review. Do not widen scope
because the next helper happens to be nearby. Do not leave placeholders/TODO runtime
modules for the next stage; each accepted tree must build and run independently.

## 9. Fresh-context review method and planning checkpoints

### Interval and independence

Planning has three explicit checkpoints: **P1 scope**, **P2 moves/tests/ordering**,
**P3 executable final plan**. After each checkpoint use a newly spawned reviewer with
no conversation history. Give it the document path, baseline SHA and bounded review
question; it reads current code independently. Do not pass the author's conclusions
as proof. Record findings and corrections here. For migration execution, repeat this
process **after every stage/substage**, and before continuing if any owned file changes.

Review proof consists of reviewer identity, baseline SHA, plan/content fingerprint,
source locations inspected, findings, resolution, and verdict. A full-context continuation
of the implementer is not a fresh review. New reviewers may be lower-cost models, but
must use the repository's OAuth agent session and ordinary review mechanism. No paid
review product is authorized by this plan.

Review prompt template:

> Read the plan at [path] and current checkout [SHA], without prior conversation.
> Review checkpoint [P1/P2/P3 or migration stage]. Do not edit or execute external
> operations. Use current source, callers, tests and enforcement scripts to falsify
> assumptions. Check every proposed move's imports/exports/defaults, writer census,
> exact hash identity, separate replay policies, cross-store partial success and
> catch/await order. Identify missing prerequisite tests and planned files presented
> as existing. Return evidence with file/symbol/line and READY, READY WITH NAMED
> CONDITIONS, or NEEDS REWORK. Never approve merely because the document says a
> gate passes. Name what you did not inspect.

If findings alter the architecture, move order or prerequisites, revise and get a
fresh re-review of the affected checkpoint before advancing. Editorial-only changes
need doc checks and a recorded diff; do not repeat full runtime tests without a reason.

### Actual planning review record

- **P1 — completed:** fresh agent `plan_p1_review`, no inherited history; baseline
  `a7cf2518`; input `/tmp/wmkf-refactor-scope.md`. Verdict READY for scope, not
  implementation. Independent evidence confirmed ten hash consumers, current Brief
  distribution versus legacy attachment modes, separate reopen/Final/send semantics,
  filename-sensitive writer gate, and absence of a matching decomposition plan in
  audited surfaces. Incorporated all five findings: §§1–3, 5, 6 and 7. Narrowed direct
  decomposition from six candidate files to four; reopen and Brief remain regression
  consumers so this plan does not become a generic lifecycle rewrite.
- **P2 — initial review and fresh re-review completed:** agent
  `plan_p2_review`, baseline `a7cf2518`, reviewed SHA-256
  `1d090d962dd087fcaa129d4f1b6ba61c388888f981685e305f13722805b55964`.
  Verdict NEEDS REWORK: retain/import the hash-prefix and crypto consumers; separate
  pre-move T1 fixtures from new-leaf exit parity; move distribution defaults before
  context and explicitly permit existing injected domain services. All corrections
  are now incorporated in §§3, 5 and 6. Reviewer independently checked symbol
  coverage, defaults/mock seams, writer registry and state-module dependency direction;
  did not claim exhaustive test coverage or a full transitive cycle analysis.
  Fresh reviewer `plan_p2r_review` returned **READY for P2** against SHA-256
  `25c9e9d85dd384c0b9c09db88df0153b61c7a0f6a949f2613d66f81a2238cb2f`.
  It independently confirmed the prefix/crypto consumers, feasible test timing,
  defaults-before-context order, all 34 suite paths and coverage of all 172
  top-level functions by the move inventory. No blocking findings remained.
- **P3 — final audit and fresh correction review completed:**
  agent `plan_p3_review` returned READY WITH NAMED CONDITIONS against SHA-256
  `e34009c479145379a80a13f84137609ea34c025897a861f4e1ca09f3f77d13ea`.
  Its only required change was to distinguish send-body/actor assertions from
  history GET/query/auth/error assertions. §5 now does so, matching the actual
  history route. Independent checks also supported the replay-policy distinction,
  Brief/legacy mode split, send recovery order, retained-snapshot writer move,
  Final atomic transition, real bundle test seam and non-executing handoff.
  Review did not claim exhaustive UI/cycle coverage or live deployment proof.
  Fresh reviewer `plan_p3r_review` returned **READY** against SHA-256
  `0b993ccb19dde5e62282800ddddce9c42e27fd1f5d1fdc2a947c41ffaa0866f7`.
  It independently verified send POST/body/session identity, history GET/query-only
  input, downstream GUID validation and error propagation. No blocking mismatch
  remained in this bounded correction. Fingerprints identify reviewed snapshots;
  this administrative receipt was appended afterward.

## 10. Release, rollback, and acceptance

This is Tier 2 runtime work when executed: cross-store document/email safety matters
although intended behavior is unchanged. A docs-only planning commit is Tier 0.
No push/deployment is authorized by this request. Runtime stages use a branch and
explicit promotion, not direct pushes to production `main`.

Local acceptance requires all stage gates and full build green. Preview acceptance
uses mocked browser/API flows or approved data modes. Do not infer that a Preview
URL isolates Dataverse/SharePoint/PG. Before a real production generation, restore,
reopen, or send, obtain separate authorization for named test records and approved
recipients; capture mode alone may write tokens/lifecycle fields. Existing external
smoke gaps remain visible instead of being relabeled as refactor success.

Each stage changes source layout only, so rollback is a code revert with the same
schemas, generation identities, stored attempts and facade contracts. Reverting code
does not undo any real writes made during separately authorized rehearsals. Record
last-known-good deployment before promotion. Promote only an accepted stage and run
signed-in read-only status/history checks appropriate to that release; stop on a
changed DTO, duplicate/current-pointer discrepancy, or uncertain transport outcome.

The migration is complete only when all owned orchestration has the explicit module
boundaries above, compatibility exports and writer policies are preserved, prerequisite
and regression tests pass, the canonical build is green, and fresh review has no
unresolved blocking finding. Completion does not authorize deletion of legacy rows,
services, public facades, templates, or historical send modes.

## 11. Planning evidence and remaining limits

- Current source and AST-local function dependency census informed the symbol moves;
  raw importer searches supplemented CodeGraph where its result was incomplete.
- Test baseline: 12 core suites / 293 tests and 22 consumer suites / 531 tests
  passed on unchanged runtime source: **34 suites / 824 tests total**. Full runtime
  build/lint/test:ci were not run for this planning-only document; Stage 0 must do so.
- Live environment/schema/row counts were not re-probed. No deployment/readiness claim
  in this plan depends on those historical counts. New migrations are excluded.
- Six nonblocking J27 unverifiable rows and unrelated memory advisory findings remain
  outside this refactor. No product priority or owner decision was changed.
- Architectural benefit is inferred from source coupling. Runtime performance benefits
  are not claimed; code motion can preserve behavior without making requests faster.

## 12. Reproducible commands and executor starter

Run the baseline test groups (all paths currently exist):

```bash
npm test -- --runInBand --silent \
  tests/unit/initial-assessment-artifact-service.test.js \
  tests/unit/initial-assessment-artifact-versions.test.js \
  tests/unit/review-docx-governed-hash.test.js \
  tests/unit/pre-site-visit-artifact-service.test.js \
  tests/unit/pre-site-distribution-service.test.js \
  tests/unit/pre-site-distribution-store.test.js \
  tests/unit/final-writeup-transition-service.test.js \
  tests/unit/final-writeup-leadership-transition-service.test.js \
  tests/unit/workbench-initial-assessment-route.test.js \
  tests/unit/workbench-pre-site-visit-route.test.js \
  tests/unit/workbench-final-writeup-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-prepare-route.test.js
```

For broader consumers, use the following exact existing suite inventory. Run all
for Stage 1; thereafter select the named consumers in that stage and include all
previously accepted stage suites. §4 still requires the full suite at stage exit.

```bash
npm test -- --runInBand --silent \
  tests/unit/initial-assessment-controls-service.test.js \
  tests/unit/workbench-initial-assessment-controls-routes.test.js \
  tests/unit/workbench-initial-assessment-versions-route.test.js \
  tests/unit/initial-assessment-tab.test.js \
  tests/unit/site-visit-transition-service.test.js \
  tests/unit/pre-site-visit-reopen-service.test.js \
  tests/unit/pre-site-visit-docx-renderer.test.js \
  tests/unit/pre-site-visit-proposal-core-service.test.js \
  tests/unit/pre-rp-brief-artifact-service.test.js \
  tests/unit/pre-rp-brief-share-lock-service.test.js \
  tests/unit/individual-review-file-service.test.js \
  tests/unit/deliberation-briefing-page-service.test.js \
  tests/unit/review-bundle-service.test.js \
  tests/unit/pre-site-distribution-panel.test.js \
  tests/unit/pre-site-distribution-schema-parity.test.js \
  tests/unit/meeting-tracker-agenda-service.test.js \
  tests/unit/meeting-tracker-agenda-route.test.js \
  tests/unit/meeting-tracker-agenda-panel.test.js \
  tests/unit/workbench-final-writeup-leadership-review-route.test.js \
  tests/unit/final-writeup-tab.test.js \
  tests/unit/final-writeups-dashboard-service.test.js \
  tests/unit/staff-deliberations-tab.test.js
```

Inventory refresh (read-only; CodeGraph first when exploring changed source):

```bash
git rev-parse HEAD
git status --short --branch
wc -l lib/services/initial-assessment/artifact-service.js \
  lib/services/pre-site-visit/artifact-service.js \
  lib/services/pre-site-visit/distribution-service.js \
  lib/services/final-writeup/transition-service.js
rg -n 'hashGovernedDocxContent|normalizeDistributionRecipients' lib pages shared tests
rg -n 'requestDocumentAdapter.create|dependencies.createDocument' lib/services scripts/check-request-document-writers.js
rg -n 'artifact-service|distribution-service|transition-service' docs .claude-memory SESSION_PROMPT.md
```

Task prompt for the executing model:

> Implement only Stage N of this plan after explicit execution authorization. Read
> the prior accepted receipt and current source; run that stage's prerequisites
> before editing. Preserve behavior and public exports; perform the listed moves
> in order. If a prerequisite test is missing, add and pass it on the old code first.
> Do not deploy, change data, merge state machines, or do adjacent cleanup. Complete
> §4, get a fresh-context review, commit the green stage, write the §8 receipt and
> stop. Name any drift or blocked prerequisite instead of guessing.

Planning documentation checks: doc-currency, fact-consistency, canonical-pointers,
doc-symbol-refs, build-claim-freshness, harness-framing, docs-catalog and J27-register
passed with their defined self-tests run sequentially. These are document checks;
they do not replace the future runtime stage gates.
