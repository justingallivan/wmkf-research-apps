---
title: GraphService and SharePoint transport decomposition
domain: architecture
kind: plan
status: active
owner: product-engineering
summary: "Authorized local migration: staged extraction of GraphService behind its existing public facade, with characterization prerequisites and independent review checkpoints."
---

# GraphService and SharePoint transport decomposition

## 1. Decision and execution boundary

**Recommendation:** decompose `lib/services/graph-service.js` into responsibility-specific modules behind its existing public facade. This is the largest justified **unplanned shared-service refactor found in the bounded survey**, measured by cross-capability impact, unrelated responsibilities, and migration risk—not the longest file or an assertion that every possible refactor has been ranked.

**Status: [LOCAL EXECUTION / S8 ACCEPTED].** The planning-only statement below is historical to the planning session. The current user authorization covers the local S0–S11 migration sequence on the isolated `codex/graph-service-decomposition` branch, with stage gates and root acceptance. S8 is the folder creation owner extraction behind the unchanged GraphService facade; no live probe, deployment, infrastructure, dependency, or migration work is authorized.

Evidence baseline: `f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`, 2026-09-19. Line references below refer to that baseline; symbols control if lines drift. Before implementation, compare the current source against this baseline and re-review changed assumptions. Stage specifications and target labels below describe the original baseline proposal. Current completed modules/tests and acceptance evidence are recorded in `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md`; S0–S8 are accepted locally.

### Why this scope

[VERIFIED via tracked-source line census and CodeGraph/source] GraphService is 1,641 lines with 21 public static methods and the named `SHAREPOINT_CANONICAL_SITE_URL` export. It combines authentication, mutable caches, target resolution, file reads, version history/restoration, downloads/PDF conversion, search throttling, folder creation, simple/chunked uploads, conditional replacement, deletion, and per-attempt telemetry. Callers span governed writeups, external materials, reviewer files, Explorer, grantee files, and the intake drain. Changes to one concern currently require reviewing a file that also controls all the others.

| Candidate surveyed | Baseline evidence | Selection reasoning |
|---|---|---|
| GraphService | 1,641 lines; methods at `graph-service.js:159–1542`; independent selection review P1 | Chosen: broad shared substrate, cohesive extraction seams, existing facade, several unrelated failure models. |
| Reviewer suggestion adapter | 2,486 lines, `lib/dataverse/adapters/reviewer-suggestion.js` | Larger by lines; reviewer policy and named lifecycle operations require a separate contract study. This survey does not establish that splitting it yields more value. |
| Candidate save service | 1,788 lines, `lib/services/reviewer-finder/save-candidates-service.js` | Substantial alternative, but concentrates one domain's identity/promotion semantics; adjacent functional work must be separated first. |
| Staff deliberations UI | 1,673 lines, `shared/components/workbench/StaffDeliberationsTab.js` | Large UI surface, with existing design work; narrower platform impact. |
| Executor | 1,362 lines, `lib/services/execute-prompt.js` | Shared and important, but current extensions/cache work creates overlap. No evidence here justifies a new executor architecture. |
| Dataverse/Dynamics transport | Current `dynamics-service.js` delegates into `lib/services/dynamics/` | The DAL/decomposition work already has dedicated plans and implemented seams; do not plan it again as absent infrastructure. |

[VERIFIED via bounded docs/memory search + P1] No dedicated GraphService decomposition plan was found. Prior plans naming Graph are not proof it is planned: the Dynamics decomposition explicitly excludes Graph timeout consolidation, and governed-document decomposition leaves Graph intact. The Explorer extraction plan's older selection table calls Graph “already planned”; that classification is not sufficient evidence for a Graph migration. This plan supersedes that classification **only for Graph scope selection**, not the completed Explorer work. “Nobody has had time” is motivation supplied by the request, not a verified historical claim.

### Outcome and non-goals

Success means all existing imports and public methods continue working, operation bodies have one implementation each, mutable state has one owner, and tests independently protect the risky seams. The facade contains explicit delegators, `buildHeaders`, the canonical URL re-export, and cache-reset orchestration. File length is not an acceptance gate.

Do not change business policy, errors, return DTOs, authentication, permissions, host/library allowlists, deadlines, retries, upload limits, chunk size, path encoding, persistence, UI, dependencies, or provider SDKs. Do not merge Graph transport with Dynamics transport. Do not introduce a generic repository/client framework, durable job system, feature flag, or a second production implementation. Do not migrate existing callers to internal modules. Improvements discovered during characterization become separately scoped follow-ups.

**Proposed release classification: Tier 2**, because this shared seam handles external uploads and document writes even though the intended change is mechanical. Use `codex/graph-service-decomposition` in an isolated checkout after implementation is authorized. If scope grows into replacement of the storage contract or data-access authority, stop and re-plan as Tier 3; this plan does not authorize that expansion.

## 2. Contract surface and evidence

Change surface: Graph operation implementations and private helpers only, behind the current export path. Entry points: existing server services, routes, and scripts. Persistence: existing SharePoint drive items/versions; callers persist identities in Dataverse and staging/job state in Postgres/Blob. New persistence: **none**. Consumers: existing services, route DTOs, browser components, background classifiers, telemetry, and tests. Prior claim being verified: Graph was allegedly already planned; P1 refuted the cited plans as evidence for that claim.

### Whole-flow traces

| Flow | Producer → service → storage → consumer | Preserved contract / evidence |
|---|---|---|
| Staff version history | `ArtifactVersionHistory` → `pages/api/workbench/initial-assessment/versions.js` (`requireAppAccess`, GUID validation, DAL context) → artifact-service facade → `initial-assessment/artifact-reader.js` → Graph item/version reads → route JSON → version disclosure | Registry supplies drive/item IDs, not request input. `null` maps to `missing`; thrown failures map to `unavailable`; bounded partial lists retain `hasMore`. Component's `loadSequence` fences success/error/finally updates on context change. [VERIFIED via complete route/component and reader source] |
| Restore | guarded caller → `initial-assessment/controls-service.js:169–291` → Graph restore → metadata/content readback → conditional Request Document update (`:130–165`) → projected artifact | Graph's POST is not the whole transaction. Caller checks current identity/hash, rechecks registry, then persists and verifies metadata. Keep restore in transport, policy in caller. A completed restore followed by failed registry update must remain distinguishable from “nothing happened.” [VERIFIED via cited logical regions] |
| Applicant materials | token-verified finalize route → actor-bound staging claim → `finalizeMaterialUpload` → Graph folder/upload → candidate receipt → Request Document create → supersede prior row → staging completion → response | `contributor-service.js:205–360` and `pages/api/external/materials/[token]/finalize.js`. Graph returns IDs used by the candidate receipt and registry. A generation-key replay is accepted only when `replayIsBound` matches the candidate and current slot; ambiguous replay holds staging. No transport-level retry or compensating delete may be added. [VERIFIED via complete route/service source] |
| Explorer search | tool dispatcher → `dynamics-explorer/tools/documents.js:211–410` → Graph search → merge scope results → tool result and `_files` | Caller distinguishes no hits from failed/skipped scopes, propagates `retryAfterMs`, and keeps per-request queue/breaker. Graph owns a separate process cooldown. Neither may be merged or reset by the other. [VERIFIED via caller + transport source] |
| Intake drain | cron job → `cron/drain-submissions-service.js:608–650` → Graph upload → identity receipt → next job state | Error classification decides retryability; success receipts include item ID/web URL. Preserve structured versus plain errors; do not add retry around writes. [VERIFIED via upload/classifier call region; full drain algorithm is outside extraction scope] |

This is a code-contract audit, not a claim that tenant permissions, production data, or current deployment health were probed. Those remain **[UNKNOWN for this planning session]**. Existing Atlas ownership is a routing aid; no schema/data migration depends on stale row counts.

### Invariants the implementer must preserve

| ID | Source evidence in `lib/services/graph-service.js` | Required invariant |
|---|---|---|
| C1 | `:146–1542`; spies in existing Graph tests | Keep both named exports and all 21 statics. Every former `this.x` becomes `svc.x` inside extracted methods. Never import a sibling implementation to replace a facade dispatch. |
| C2 | `:120–124,159–215,1533–1542` | One auth cache/promise/generation owner. Per-caller waiting deadlines do not cancel the shared token fetch. A late pre-reset token result cannot populate the new cache or clear a newer promise. Credentials stay call-time reads; Graph scope remains separate from Dynamics. |
| C3 | `:231–357` | Host/library validation and resolution order, TTL, display-name then slug lookup, raw `libraryName` cache key, supplied-site behavior, and errors stay exact. Do not “fix” case sensitivity or make the cache site-keyed during extraction. |
| C4 | `:130–144,373–443,950–1085` | Path validation and each caller's encoding/filtering remain distinct. Listing stays files-first depth-first, capped, and first-page-only per folder. Do not add pagination to listing. |
| C5 | `:449–495,950–997,1319–1354,1454–1503` | By-ID metadata and upload publication readback do not use cTag as a version; by-path metadata and stable replacement currently do. Preserve this difference; one normalized metadata helper would change behavior. |
| C6 | `:529–723` | Fetch authoritative current version before pages; current identity wins ordering. Keep page/time bounds, exact nextLink origin/path/repeat checks, and stage-specific failure salvage. Only item metadata 404 means missing. Continuation 404/429/5xx or no-response/JSON failure can retain prior pages; 401/403 still throw. |
| C7 | `:804–940,1557–1576` | `downloadFile` returns an object; version/PDF downloads return Buffer. Current download has its own presigned-HTTP-failure fallback and plain errors. Redirect/CDN requests carry no Graph bearer token. Do not collapse the distinct implementations. |
| C8 | `:31–79,1101–1228` | Search-only HTTP retry policy, jitter, Retry-After budget, response-body drain, structured final error, process cooldown, and KQL/result filtering stay exact. Network exceptions are not newly retried. |
| C9 | `:1006–1085,1259–1503` | Folder 409 recovery reads exact cumulative path. Upload defaults to replace; fail/rename are distinct. Stable replacement requires If-Match. Large upload sends contiguous ranges without Authorization, cancels only on its existing non-ok response branch, and always attempts final metadata readback after its chunked branch obtains a final item ID. Its small-buffer branch still delegates to simple upload. Simple upload reads metadata only when PUT lacks a publication version and supplies an item ID; large upload retains the PUT publication version if readback provides none. No automatic write retry. |
| C10 | `:760–785,1515–1530` | Restore accepts only 204 success; delete accepts current ok/204/404 behavior. Keep existing error types/messages, including old source-path text in allowlist errors. |
| C11 | `:1547–1555,1578–1641` | One telemetry event per fetch attempt, zero on cache hits, emitter failures cannot change transport results. Timeout covers fetch, not a newly added response-body deadline. Signal overwrite behavior stays unchanged; folder cancellation remains checks between operations, not in-flight cancellation. |
| C12 | `:1533–1542` | `clearCaches()` stays synchronous: search state, auth state with generation increment, then site/drive state. No hidden second state store; no internal module imports the facade. |

### Seven-audit disposition

Whole-flow: representative critical consumers traced above; S0 builds the full caller/test manifest before code moves. Partial success: version-page salvage, upload/readback ambiguity, folder partial creation, upload/registry split, and restore/registry split are explicit test requirements below. Async: token generation fencing, shared promises, process cooldown, and existing component generation guard are preserved; no claim is made that every current caller has perfect cancellation. Helper extraction: permitted mechanics below, preserved-difference list C3–C11. Durable surfaces: no new table/entity/route/enum; migration manifest and API matrix changes are N/A unless scope changes. Documentation: this proposal adds no shipped-state claim; adjacent restatements are classified in §8. Symbol-consumer fan-out: no new values; retain all current `versionId`, `hasMore`, `status`, `retryAfterMs`, and error fields, with reader assertions rather than writer-only tests.

## 3. Target ownership and mechanical move rules

All destinations below are **[PLANNED]** beneath `lib/services/graph/`. The original facade path remains permanently supported. No barrel module is needed.

| Destination | Exact ownership | First stage |
|---|---|---|
| `constants.js` | GRAPH_BASE, API_TIMEOUT, DOWNLOAD_TIMEOUT, CACHE_TTL, canonical URL, host/library Sets | S1 |
| `paths.js` | validatePath | S1 |
| `http.js` | fetchWithTimeout, safeEmitDependencyEvent, clampApiTimeout, deadlineTimeoutError, remainingTimeoutMs, waitForPromiseWithin | S1 |
| `auth.js` | getAccessToken; tokenCache/tokenPromise/tokenGeneration; resetAuthCache | S2 |
| `resolution.js` | getSiteId/getDriveId; siteCache/driveCache; resetResolutionCaches | S3 |
| `files.js` | listFiles, getFileMetadataById, getFileMetadataByPath | S4 |
| `versions.js` | listFileVersions, getFileVersionMetadata, restoreFileVersion; MAX_VERSION_PAGES/MIN_VERSION_PAGE_BUDGET_MS | S5 |
| `downloads.js` | downloadFile, downloadFileVersion, downloadFileAsPdf, downloadFileByPath, downloadRedirectBody | S6 |
| `search.js` | searchFiles, isRetryableSearchStatus, parseRetryAfterMs, planSearchRetry; search constants/cooldown; resetSearchCooldown | S7 |
| `writes.js` | ensureFolderPath first, then uploadFile, replaceFileContent, deleteFile | S8, S9 |
| `upload-session.js` | uploadFileLarge | S10 |

Dependencies flow facade → operation modules → constants/paths/http → existing service-error/telemetry utilities. Operation modules call other public methods through their `svc` parameter. `http.js` must not depend on auth, resolution, search, or the facade. No new shared mutable state module.

Use the existing Dynamics decomposition only as a structural reference for explicit delegates and receiver injection; current Graph source is the behavioral authority. Graph keeps its own transport, `graph` service-error identity, timeout constants and telemetry; `http.js` imports `API_TIMEOUT` from its own constants module. Do not copy Dynamics target-interlock wiring or unify transports. [VERIFIED via source and catalog] The catalog's request-correlation section correctly lists both transports as telemetry consumers; it is not an interlock claim. The older statement in `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` that Graph uses the Dynamics HTTP helper is STALE historical context; S11 corrects that exact statement against then-current source, without adding an interlock to Graph.

Permitted mechanics: move declarations; fix relative imports; convert static methods to functions; add receiver parameter and replace `this.` accesses with `svc.`; add explicit facade delegates; move reset statements into owner reset functions; re-export the same canonical URL. No other body edits. Keep nested closures with their parent method. Keep literals/default parameters at their current evaluation points, including method-local upload limits.

Example **[PLANNED]**: retain the original explicit signature and async nature on the facade, forwarding arguments to `files.listFiles(this, ...)`. Preserve default-argument behavior, promise rejection behavior, method arity, and call-time environment evaluation. `buildHeaders` remains the original synchronous facade method. `clearCaches` remains synchronous. Never bind a captured facade method at module load; spies and subclass receivers must continue to work.

For destructured options, forward the already destructured values, not the raw original argument: reading an options getter twice would be a behavior change. For example:

```js
// PLANNED facade wrapper; the extracted function receives svc first.
static async getFileMetadataById(
  driveId,
  itemId,
  { siteId = null, timeoutMs = API_TIMEOUT } = {},
) {
  return files.getFileMetadataById(this, driveId, itemId, { siteId, timeoutMs });
}
```

Pin getter call count/order, missing/undefined/null options, and rejected-Promise versus synchronous throw behavior in the public-contract tests. After facade destructuring, do not forward raw options or `arguments`; reconstruct options from the bound values, preserving aliases. Add a facade comment pointing maintainers to `graph/constants.js`; preserve the old path text embedded in existing allowlist errors during extraction.

Intermediate cache ownership: S2 replaces only auth reset statements with `resetAuthCache()` while other resets remain local. S3 replaces only site/drive resets. S7 replaces search resets, producing the final synchronous reset sequence. At no point may old and new modules each own a cache/promise/cooldown copy.

## 4. Tests required before moving code

**S0 is a tests-only preparation stage. All new behavior characterizations below must pass against the unchanged monolith before S1 begins.** New architecture assertions may initially allow the monolith and grow only with the staged target inventory. They must not require nonexistent destination modules at S0.

[VERIFIED via planning-session Jest run] Existing suites: `tests/unit/graph-service-folders.test.js`, `graph-service-versions.test.js`, `graph-service-search-retry.test.js`, `graph-service-upload-large.test.js`, and `graph-service-observability.test.js`: **5 suites / 64 tests passed**. This proves their current assertions, not complete migration coverage.

All additional filenames in this section are **[PLANNED]**, under `tests/unit/`. Extend an existing suite where it already owns the concern; do not duplicate a passing scenario merely to hit a target test count. Tests call the public facade and mock the lowest external seam (`global.fetch`, clock, telemetry), not the implementation being extracted. Install an unexpected-network rejection in every new fixture.

| Test package | Mandatory cases before S1 | Used by stages |
|---|---|---|
| `graph-service-public-contract.test.js` | Snapshot export names, 21 own static method names/arity and sync-vs-async behavior; canonical URL identity; alternate receiver/subclass + spies for internal dispatch, especially large→simple upload and path→download. Assert exact DTO keys and representative error fields/messages. | All |
| `graph-service-auth-cache.test.js` | Cold/warm/expired and near-expiry tokens; same-request dedup; independent waiter deadlines; rejected promise clears for retry; reset during pending request; old request resolves/rejects after new request without cache contamination or clearing new promise; call-time env changes. | S1–S3 |
| `graph-service-resolution.test.js` | Allowed/disallowed/invalid site; allowed/disallowed/missing library; display-name/slug precedence; raw-case cache keys; TTL/reset; supplied site behavior; late in-flight site/drive completion after reset recorded as current behavior, not assumed generation-fenced. | S1–S4 |
| Extend folders/observability + `graph-service-read-contract.test.js` | Plain/encoded traversal, malformed URI, empty/nested paths at existing accepting/rejecting methods; files-first recursion/depth/count/deadline; metadata 404 versus error/identity mismatch; pinned identity pair; by-path cTag fallback versus by-ID publication-only. Fetch rejection/timeout, body rejection and event counts; emitter throw; timeout cleanup. | S1, S4 |
| Extend versions | First item/current-version/first-page versus continuation failures; cap/budget salvage; 401/403 throw despite prior page; invalid/repeated/wrong-host/wrong-item nextLink; current-entry mismatch; missing current version; stable sorting/limit; exact-version mismatch/404; restore 204 versus unexpected 2xx. | S5 |
| `graph-service-downloads.test.js` | Presigned success; non-ok HTTP fallback; presigned network failure's existing throw; 301/302/manual/no-location/direct 2xx; no Authorization on CDN requests; bytes and object-vs-Buffer return types; PDF/version error differences; path→facade download delegation; original filename/size/mime defaults. | S6 |
| Extend search-retry | 408/429/each 5xx class versus nonretryable 4xx; short/long/date/malformed Retry-After, jitter, max attempts/body draining; network rejection is not HTTP retry; concurrent cooldown maximum extension and reset; KQL scoping and off-site/disallowed-library result filtering; decode failure remains failure. | S7 |
| Extend folders | Existing path, missing segments, 409 reread folder/file/error, partial creation then later failure, empty path; cancellation at the existing pre-GET/pre-POST checks, including cancellation while resolving credentials. Abort after POST returns 409 still permits its recovery GET (`:1070` has no signal check); an aborted empty path still resolves credentials and returns root without a signal check. Freeze both behaviors. No implied cancellation of an in-flight fetch or every subsequent request. | S8 |
| `graph-service-write-contract.test.js` + extend versions/folders | All conflict modes + invalid value; Buffer/size/filename/pinned-pair checks; successful PUT with publication version makes zero readback requests; absent publication causes readback; HTTP-failed/mismatched-ID readback versus fetch/JSON throw after successful PUT; replacement exact If-Match/412/cTag behavior; delete 204/404/error; no extra PUT/DELETE retry. | S9 |
| Extend upload-large | Exact simple threshold and delegation; multi-chunk final short range; no auth on session PUT/DELETE; missing upload URL; HTTP-failed chunk with successful/failed cleanup; network-thrown chunk's distinct cleanup behavior; all chunks 202/no final ID; final item then readback HTTP/malformed/identity/transport failures; readback still occurs when final PUT has a publication version, and that version survives a readback without publication; no hidden retry. | S10 |
| `graph-service-boundary.test.js` | Source import graph: no internal→facade dependency, no external runtime direct imports of internals, no duplicate implementation/state owners, no cycle through a reachable local helper, no surviving `this.` in extracted operations, no raw fetch outside http. Test matcher with red fixtures for ESM imports (including side-effect imports), re-exports, require/dynamic import, relative and alias paths, extensionless paths and indirect cycles. Only dedicated test fixtures may import internal scanner helpers. | All; tighten staged inventory each move |

Mutation proof in S0: temporarily remove token generation fencing, forward bearer auth to a CDN request, change continuation 404 to `null`, replace the monolith's `this.uploadFile` with `GraphService.uploadFile` and `this.downloadFile` with `GraphService.downloadFile` one at a time (subclass fixtures must override those methods and fail on bypass), remove If-Match, and suppress the chunk failure. Each applicable test must fail for the intended reason. Restore all mutations; run tests green. Tests asserting “not called” must populate the excluded path so they prove exclusion. No runtime mutation is committed.

Boundary checker recipe **[PLANNED]**: create only `tests/helpers/graph-service-boundary.js` and its unit suite; use the already installed `@babel/parser`, not a new dependency or general-purpose gate framework. The private `parse`, `edgesOf` and `candidates` functions in `tests/helpers/document-lifecycle-boundary.js` are reference patterns, not exported APIs. Leave that helper unchanged. Accept an in-memory source map plus an explicit stage inventory, returning violations so negative fixtures exercise the same analyzer as real source.

1. Inventory tracked runtime JS/TS under `lib`, `pages`, `shared`, `modules` and `scripts`. Parse literal ESM imports/exports, side-effect imports, `require` and dynamic imports. Resolve relative paths and configured aliases using current repository configuration, including extensions and directory indexes. Report unresolved local edges in the Graph dependency closure; never silently drop them. Reject nonliteral dependency edges inside new Graph modules.
2. Allow only the facade to import operation modules and their reset exports; allow operation modules to import the named leaf modules and their existing utility dependencies. Reject runtime imports of internals from other files. Walk the facade's resolved local dependency closure to detect internal→facade paths and cycles involving new Graph modules, including paths through existing helpers; do not turn unrelated repository cycles into new scope.
3. Keep a small stage inventory of moved methods and named state variables. Assert each has exactly one declared owner, facade wrappers contain only the specified delegate, and moved operations contain no receiver `this` access or direct global fetch. S0 allows original monolith ownership; each later stage changes only its listed owners. Compare bodies separately under G; declaration counts alone do not prove parity.
4. Negative fixtures must include `./graph/auth.js`, extensionless relative imports, a side-effect import, re-export, require, dynamic import, configured alias, unresolved local edge, duplicate state, and an indirect helper cycle. Include a valid facade/delegate graph. A regex for `services/graph/` misses relative imports; existing `findImporters(fileContents, RegExp)` also omits side-effect imports and cannot substitute for this analyzer.

Static assertions supplement public contract tests; they do not establish behavior parity alone. Keep implementation bounded to this source-map analyzer and fixtures; if resolving actual import shapes requires a broader framework, stop S0 and re-plan that check rather than weakening its claimed coverage.

### Consumer suite manifest

S0 creates **[PLANNED] `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md`**, the single execution receipt used throughout S0–S11. Before S1, that committed receipt must list consumers discovered from the public import, re-exports, dependency wrappers, and raw methods. Use CodeGraph then targeted `rg` for shapes it omits. Include these **existing** minimum suites, confirming current filenames:

- `initial-assessment-artifact-versions`, `initial-assessment-controls-service`, `workbench-initial-assessment-versions-route`, `artifact-version-history`.
- `site-visit-materials-contributor-service`, `external-materials-routes`, `external-materials-routes-client`, `consultant-feedback-attachment-service`.
- `dynamics-explorer-search-documents`, `dynamics-explorer-chat-characterization`, `workbench-proposal-document-listing`, `workbench-download-proposal-document-service`, `load-proposal-service`, `load-proposal`.
- `document-lifecycle-boundary` (every stage: its dependency traversal reaches Graph).
- `individual-review-file-service`, `review-upload`, `sharepoint-cleanup`, `cycle-dossier-sharepoint`, `grantee-upload-service`, `grantee-replace-submission-service`, `drain-files-moved-helpers`, `drain-record-failure`.

These names resolve to `tests/unit/<name>.test.js`. Also include `tests/integration/review-manager-download-review.test.js`. Existing tests that mock Graph entirely prove consumer contracts but cannot prove the extraction. Add `graph-service-consumer-contract.test.js` **[PLANNED]** with real Graph facade + mocked fetch and mocked persistence for (a) partial version history to caller DTO, (b) upload identity to candidate/registry fields, (c) throttle error to Explorer `incomplete`/cooldown response. No real token, Blob, Graph, Dataverse, malware scan, or LLM call.

## 5. Stage-by-stage migration instructions

Every stage starts from the previous accepted commit. One builder owns files; one reviewer is read-only. No parallel gate runs in the same worktree. A red prerequisite blocks that stage. **“Green” means the exit commands actually ran successfully, including the canonical build; presumed equivalence is insufficient.** Stop after two unsuccessful correction/review rounds and escalate the concrete disagreement rather than widening scope.

### Shared exit gate G (required at every S0–S11 boundary)

1. Run all Graph suites, the stage's listed consumer suites, `tests/unit/document-lifecycle-boundary.test.js`, and the Graph boundary checker. S0 runs only tests that exist after its additions. Use `npx jest --runInBand --silent --runTestsByPath <explicit files>`; preserve an exact command in the receipt.
2. `npm run check:types`, `npm run lint`, then `npm run build`, sequentially. Build runs the existing prebuild; inspect the manifest/worktree afterward. Follow the sandbox retry guidance in `docs/CI_GATES_REFERENCE.md` if Turbopack fails on process/port permissions. A webpack fallback is supplemental, not a green canonical build. [VERIFIED via tsconfig and source] Current Graph code is outside direct checked-JavaScript coverage; `check:types` is a regression gate for its configured scope, not proof that extracted Graph functions are type-safe. Expanding type-check coverage is a separate change, not a prerequisite added by this refactor.
3. Enumerate current `check:*` scripts from package.json and run **all** gates, with each self-test immediately after its successful parent, sequentially. Continue collecting unrelated gate failures but do not advance with any relevant red gate. This intentionally avoids an incomplete handwritten path-based gate subset.
4. Inspect the complete diff. Perform the body comparison described below against the previous accepted source; allow only §3 transformations and import/reset seams. Record every exception; any semantic difference blocks acceptance. Do not update snapshots to make an unexplained difference green.
5. Fresh-context review R (§7), resolve findings, rerun impacted checks; if runtime changes again, rerun build. Commit one accepted stage with its receipt. Record its commit hash and working-tree cleanliness; do not merge/push main.

Body-comparison procedure: save the previous accepted file with `git show <accepted-sha>:<repo-relative-file>` to a temporary file. For each moved declaration, record its exact old/new source bounds, copy those complete regions into separate temporary files, and run `git diff --no-index -- <old-region> <new-region>` (exit 1 means differences to inspect, not tool failure). Use `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change <accepted-sha> -- <owned-files>` as a supplemental full-diff view. Review every changed line and record which §3 transformation explains it; compare reset statements in their original execution order as well. Do not run global whitespace/string replacement or normalize literals: template strings and error text are behavior. This is an explicit line-by-line source comparison corroborated by tests and a fresh reviewer, not an automated semantic-equivalence proof. Store region bounds, commands and the disposition of every nontrivial hunk in the receipt.

| Stage | Prerequisites that must already be green | Exact move/edit order | Consumer verification and accepted end state |
|---|---|---|---|
| **S0 — Freeze behavior** | Current five Graph suites and current all-gate baseline; implementation authorization and isolated branch | 1. Record baseline/caller manifest and release tier. 2. Add §4 characterizations and boundary fixtures against original source. 3. Mutation-prove selected tests. 4. Record known behavior discrepancies separately. **No runtime moves.** | Run complete consumer manifest + full `npm test -- --runInBand --silent`, then G. Exit: missing coverage closed or stage remains blocked; no “tests later.” |
| **S1 — Extract leaves** | Every §4 characterization; public surface and transport fixtures | 1. Create constants.js and re-export canonical URL from old path. 2. Create paths.js; replace private uses with import. 3. Create http.js with deadline/telemetry helpers and imports adjusted one level. 4. Remove moved declarations from facade. Keep all methods/caches in facade. | Observability + consumer bridge, drain error tests; G. Exit: one raw-fetch implementation, no timeout/error/event drift. |
| **S2 — Auth owner** | Auth race/dedup/reset/environment tests | 1. Move token state + getAccessToken to auth.js. 2. Add resetAuthCache with original auth reset statements in order. 3. Replace original method with explicit async delegate. 4. Replace auth portion of clearCaches only. | Folder metadata deadline and observability tests; G. Exit: one token promise owner; short waiter does not cancel long waiter; old completion cannot corrupt new state. |
| **S3 — Resolution owner** | Resolution TTL/key/supplied-site tests and auth tests | 1. Move siteCache/driveCache with getSiteId/getDriveId. 2. Add resetResolutionCaches. 3. Delegate both methods through svc. 4. Replace remaining site/drive reset portion. | Workbench listing and load-proposal consumer suites; G. Exit: same cache keys/resolution/errors; no new stale-generation promises. |
| **S4 — File reads** | Read/path/list/metadata differences and facade dispatch tests | Move in order: listFiles, getFileMetadataById, getFileMetadataByPath to files.js; add matching delegates after each. Keep nested walk with listFiles. | Metadata/history reader, Workbench listing/download, Graph consumer bridge; G. Exit: exact identities, errors, projection, ordering and caps. |
| **S5 — Versions** | Version pagination/security/salvage tests; existing restore/controls tests | 1. Move version bounds and listFileVersions as one unit. 2. Move getFileVersionMetadata. 3. Move restoreFileVersion, preserving POST/204 enforcement. 4. Add delegates. Do not modify restore caller or registry writes. | Artifact reader/route/UI, controls-service, real-facade partial-history bridge; G. Exit: current-first bounded history and restore/readback split unchanged. Dedicated review of restore is required despite sharing a file with reads. |
| **S6 — Downloads** | Download/redirect tests, version/PDF tests, dispatch fixtures | 1. Move private downloadRedirectBody. 2. Move downloadFile. 3. Move downloadFileVersion, downloadFileAsPdf. 4. Move downloadFileByPath last. Keep separate current-file fallback logic. | Download-review integration, individual-review-file, Workbench download, review-upload; G. Exit: object/Buffer distinctions, error shapes and no-auth CDN legs unchanged. |
| **S7 — Search and cooldown** | Search policy/result fixtures and process-reset tests | Move search retry helpers/constants, both cooldown variables, and searchFiles together. Add resetSearchCooldown; replace first two clearCaches statements with its call. | Explorer search and chat characterization + real-facade throttle bridge; G. Exit: final reset sequence search→auth→resolution; no retry/cooldown broadened to uploads. |
| **S8 — Folder creation** | Folder 409/partial/cancellation/pinned-identity tests | Create writes.js with ensureFolderPath only; delegate. Keep per-segment loop, cancellation checks and 409 reread together. | Site-visit materials, Cycle Dossier SharePoint, controls-service; G. Exit: no extra folders/cleanup or signal composition. |
| **S9 — Simple writes** | Write ambiguity/readback/ETag/delete tests; S8 green | Move uploadFile first, replaceFileContent second, deleteFile last into writes.js, adding delegates. Keep upload metadata readback inline; replacement is not normalized with it. | Real-facade upload→registry bridge; contributor, grantee upload/replacement, review upload, cleanup, drain failure suites; G. Exit: identical conflict behavior, receipts, write count and failure paths. |
| **S10 — Upload sessions** | Large-upload branch/error/cleanup matrix; S9 green | Move uploadFileLarge to upload-session.js. Keep small-buffer branch calling svc.uploadFile; preserve chunk loop and readback. Delegate original method. | Applicant/consultant attachment services and external materials routes; G. Exit: exact session request, contiguous ranges, cleanup and post-commit ambiguity unchanged. |
| **S11 — Closure and release packet** | All prior receipts accepted; complete source partition and public contract tests | 1. Remove only imports proven unused after extraction. 2. Verify all 21 facade methods + canonical URL remain. 3. Tighten boundary inventory to final modules. 4. Update relevant catalog/source headers and exact source references, with a scoped sweep. 5. Prepare release/rollback packet. Do not remove facade or change consumers. | Full Jest suite + entire consumer manifest + G; Mode A mocked staff/external journeys in §6. Exit: build-green candidate and reviewable release packet; release still requires separate owner decision. |

If a stage is too large for the implementation agent, split it **before editing**, at a named method boundary, preserving the same prerequisites, G, R and rollback rules for each substage. Never split a state owner from its mutation/reset code across accepted commits.

## 6. Rehearsal, promotion, and rollback

S0 and S11 require full Jest; all stages require the complete Graph contract suite and canonical build. Full suite failures are not dismissed as unrelated without an independently reproduced baseline and explicit disposition; relevant failures block progression.

S11 Mode A journeys use synthetic fixtures and no network side effects:

1. Staff opens history, sees current-first entries and partial-history notice; metadata missing and unavailable remain different; switch request while success/error is pending and verify no old result paints the new request.
2. Staff downloads a nested/archive proposal and a generated review/PDF; check bytes/content headers and server-selected identity through mocked network seams.
3. External contributor completes small and large synthetic uploads; retry after simulated registry failure and after lost finalize response. Verify same IDs/receipt semantics; ambiguous replay remains held, not silently duplicated.
4. Restore conflicts before POST, successful POST with failed registry persistence, and safe caller reconciliation remain existing outcomes. Do not actually restore a tenant file.
5. Explorer search throttles: partial results are visibly incomplete; later same-request tool calls and process cooldown do not create a new fetch storm.

Automated coverage is bounded to the §4 suites and three real-facade bridges: journey 1 maps to artifact history component/route/reader tests and the partial-history bridge; journey 2 to Workbench/review download suites and Graph download tests; journey 3 to contributor/finalize suites, upload tests and the upload-to-registry bridge; journey 4 to controls-service and Graph restore tests; journey 5 to Explorer suites and the throttle bridge. S0 adds missing cases in those suites, recording the exact case and command for each journey. API mocks alone do not replace the real-facade bridges.

[VERIFIED via current `tests/e2e` inventory] No existing end-to-end test was identified for all five journeys. This plan does not require a new Playwright harness in S0. Component/service tests establish their asserted portions only; they do not prove complete browser behavior. S0 records uncovered browser steps as release obligations. S11 runs available Mode A browser checks and records any remaining staff/external-user rehearsal gaps explicitly; required Tier 2 rehearsals remain promotion blockers until performed in an approved environment.

Before promotion, record branch/head, accepted receipts, current campaign window, approved rehearsal mode, last-known-good deployment, expected side effects, and rollback operator. An isolated Dataverse target does **not** isolate Graph/SharePoint. No live write rehearsal is authorized by this plan; any needed live verification requires separately named target, synthetic files, expected writes and cleanup ownership. Keep paid calls out of routine verification.

Tier 2 staff and external-user rehearsal requirements still apply. A missing authorized environment or required rehearsal means **release blocked**, not “tests passed, therefore production proved.” No env/config/schema changes are needed for extraction. No dual-running writes for comparison.

Before release, rollback is reverting the most recent stage commit and rerunning G; subsequent stages must not depend on a rejected stage. After release, first restore the recorded previous deployment, then reconcile any files/versions or downstream receipts produced during the interval. Code rollback does not undo SharePoint/Dataverse/Postgres state. Never delete uploaded files or version history as an automatic rollback step. Retain the facade; no later facade-removal stage is part of this plan.

## 7. Fresh-context review method and cadence

Planning has three checkpoints: **P1 scope selection**, **P2 contract/ownership assumptions**, **P3 executable stage plan**. Finish each with a newly spawned read-only reviewer with no conversation history. Supply the baseline SHA, document path/section, bounded question, and permission to read current source—not the author's reasoning transcript. The author may work on independent evidence while the review runs, but may not finalize the dependent planning stage until findings are incorporated. No reviewer runs gates while the owner runs them.

For implementation, run **R after every S0–S11 stage** before accepting its commit, and immediately after upstream edits touch Graph, listed consumers, tests, or gate assumptions. Fresh context means a new reviewer task, not asking the builder to “take another look.” Use the configured model/session; if a cheaper builder cannot resolve a source-backed disagreement, escalate to the owner. Agent sessions use the existing subscription/OAuth path; no model API keys or separately metered review product.

Copyable review brief:

> Read-only review of stage [ID] in GRAPH_SERVICE_DECOMPOSITION_PLAN_2026-09-19.md. Baseline [SHA], candidate [SHA plus working-tree diff hash], owned files [list]. Read current code using CodeGraph first, including both sides of each moved call and state owner/reset. Try to refute invariants C1–C12 and this stage's prerequisites. Check complementary/error/partial-success paths, facade spies, every await that can commit or publish state, and current caller DTO consumers. Do not trust plan labels or passing test names as proof. Do not edit, run gates, contact live services, or delegate. Return BLOCK / ACCEPT WITH NAMED CHANGES / ACCEPT, with file:line evidence, missing tests, one disconfirming check per recommendation, and any unread surfaces. Do not waive unresolved material findings.

Receipt template (append to the execution receipt, not a new parallel roadmap):

```text
Stage / baseline / candidate / diff fingerprint:
Builder-owned paths:
Required tests present before code moved (command + result):
Exact moved symbols and state owners:
Body-comparison exceptions:
G commands, results, build identity:
Fresh reviewer identity and context isolation:
Findings / code evidence / resolution / recheck:
Unresolved assumptions and release blockers:
Accepted commit / rollback commit / next allowed stage:
```

The builder opens only the current stage plus global invariants/test map. It must not prebuild later modules “while nearby,” rewrite error handling, auto-fix unrelated lint, or regenerate expectations without explanation. On stale baseline, missing prerequisite, unexplained source difference, red gate, or unresolved material review finding: stop the stage, report evidence, retain the last accepted green commit.

## 8. Planning evidence, limits, and review receipts

**Planning validation actually run (historical):** all 38 `check:*` gates and 29 self-tests passed during the planning session; five Graph suites / 64 tests passed against unchanged runtime code. Document currency, symbol references, build-claim freshness, fact consistency, canonical pointers, catalog, scaffolding and secret checks plus their defined self-tests passed after staging the plan; harness-framing and its self-test also passed. Existing consumer-suite filenames were checked on disk, and the staged diff passed whitespace checks. These gates have bounded registries/scan roots; they do not independently prove every plan statement. The full application build, full Jest suite, and new S0 prerequisites were intentionally left to the now-authorized S0 execution; tenant probes and browser rehearsals remain outside S0.

Scoped sweep Mode B: claims are (1) Graph remains one implementation module, (2) prior plans do not supply this extraction, (3) target modules/tests are proposed, (4) no durable data change is required. Source authority is the complete Graph module and the cited consumer regions. Searched docs, plans, memory, handoff, runtime and test references using `graph-service`, `GraphService`, decomposition/refactor qualifiers and candidate names. Existing import paths are AGREE; completed Dynamics/DAL plans and prior candidate-selection discussions are historical context; the Explorer “already planned” classification is STALE/CONFLICT for selection and explicitly superseded here; unrelated Graph feature plans remain UNRELATED to extraction. No shipped implementation status is changed by this document. This is not a whole-repository documentation clean bill; older unrelated factual drift is outside scope.

Relevant memories read: `feedback-latency-plan-scope-accretion-postmortem`, `feedback-one-session-runs-gates-per-worktree`, `project-sharepoint-integration`, and `project-dynamics-explorer-archive-libs`. They constrain scope and route evidence; their historic tenant observations were not treated as fresh probes.

| Checkpoint | Independent result | Incorporated changes |
|---|---|---|
| P1 — selection | Fresh `scope_review`, no inherited history: Graph recommended within bounded comparison; misleading prior-plan classification identified. | Qualified “largest”; retained facade; excluded already planned work and avoided exact importer counts from text matches. |
| P2 — contracts | Fresh `contract_review`, no inherited history: READY WITH NAMED CHANGES; source-only review, no test execution. | Explicit buildHeaders owner and receiver forwarding; preserve cTag/error/readback differences, raw resolution cache keys and reset races; split folders from other writes; preserve source-path error strings. Required cases mapped to S0. |
| P3 — stages | Fresh `plan_review`, no inherited history: ACCEPT WITH NAMED CHANGES, then **ACCEPT** after checking all three corrections; full plan + Graph source reviewed, no execution. | Preserved 409-recovery and empty-path cancellation exceptions; supplied destructured-options forwarding example and getter tests; named the S0 execution receipt. No material finding remains from that bounded review. |

### Opus adversarial review and amendment disposition

The subscription/OAuth Claude Opus review of the original plan returned **READY WITH NAMED CHANGES** (source-only; no gates, migration or live probes). The author checked the findings against current source before this amendment. Opus has not reviewed the amended text. Dispositions:

| Finding | Decision and incorporated change |
|---|---|
| F1 — boundary checker underspecified | Accepted the gap, not the proposed regex-only replacement. §4 now names the installed parser, source-map analyzer, resolution rules, staged ownership inventory and negative fixtures, including relative/side-effect imports the suggested matcher misses. |
| F2 — missing Dynamics reference / transport distinction | Added the structural reference and Graph-specific differences in §3. Rejected the claim that the telemetry catalog is an incorrect interlock statement; separately identified the actual stale interlock-plan sentence for S11 correction. |
| F3 — S0 mutation names nonexistent `svc` | Replaced with concrete mutations of existing `this.uploadFile` and `this.downloadFile`, proven by subclass overrides. |
| F4 — body comparison underspecified | Added exact baseline extraction, region/diff commands and per-hunk receipts; no unsafe textual normalization or claim of automated equivalence. |
| F5 — upload readback asymmetry | C9 and both write test rows explicitly pin simple-upload conditional versus large-upload unconditional readback and publication fallback. |
| F6 — C12 dependency wording reversed | Corrected to “no internal module imports the facade.” |
| F7 — browser scope could grow without bound | Bounded S0 additions to named suites/bridges; kept unproven browser steps and Tier 2 rehearsals as explicit release obligations. |
| F8 — missing transitive boundary/load-proposal suites | Named both load-proposal suites; lifecycle boundary runs at every stage. |
| F9 — type gate overstates Graph coverage | Marked `check:types` as a configured-scope regression gate; no type-check expansion smuggled into migration. |

Amendment checkpoint P4: fresh `amendment_review`, no inherited history, returned **ACCEPT** after checking the amended plan against `877b84c9` and current source, including the final C9 qualification. It verified the analyzer recipe, body-comparison procedure, upload branches, bounded coverage/release obligations, receiver mutations, suite names, type-check scope and transport distinction. Source-only review; no tests, gates, build or live calls. It did not independently re-audit unchanged consumer flows or the original Opus transcript. Amendment validation: nine relevant document/security gates and eight defined self-tests passed; whitespace checks passed. Only this plan changed.

### Recommendation evidence

| Recommendation | Current prerequisite / execution availability | Tested evidence | Disconfirming check / status |
|---|---|---|---|
| Extract behind facade | Existing named class with explicit static calls; available now | Five existing Graph suites green | A caller that relies on a bypassed sibling spy or changed return type refutes compatibility; S0 must pin full surface. **[PLANNED; source-grounded, not implemented]** |
| Separate state owners | Auth, resolution and search state used by distinct operation groups | Existing deadline/cooldown tests; reset-race matrix still required | Any mutable variable left with two owners blocks S2/S3/S7. **[PLANNED]** |
| Freeze metadata/error differences | Source branches C5–C11 exist today | Existing version/observability tests, additional cases required | Differential fixtures that disagree after permitted rewrites block stage. **[PLANNED]** |
| Promote after isolated rehearsal | Release policy requires Tier 2 evidence; tenant rehearsal availability unknown | No release experiment performed | Missing safe target/rehearsal/owner promotion means release blocked. **[UNKNOWN until release preparation]** |

Final planning verdict (historical): **READY TO IMPLEMENT after implementation authorization and S0 prerequisites**. The original three planning checkpoints and fresh amendment checkpoint P4 completed; their named corrections are incorporated, with Opus dispositions recorded above. The current user authorization now covers the local S0–S11 sequence; S0–S8 are accepted; subsequent stages retain their specified tests, G and fresh-review prerequisites. No release, push, deployment, or live rehearsal is authorized by this local execution.
