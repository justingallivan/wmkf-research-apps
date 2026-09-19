# GraphService decomposition execution receipt — 2026-09-19

Status: **[S0–S11 ACCEPTED LOCALLY — RELEASE BLOCKED]**. Luna built each stage, fresh Sol reviews accepted the work, and root completed final review and verified the recorded gates. The migration is complete on `codex/graph-service-decomposition`; no migration stage remains. Promotion requires the separately approved rehearsals and release decision specified in the S11 packet. No push, merge, deployment, or live rehearsal was performed.

## Historical S0–S11 stage evidence

The stage sections below preserve the code and verification at each accepted checkpoint. The post-Opus follow-up receipt at the end records the current mutation-runner behavior.

## Contract-reconcile Step 0

| Surface | S0 evidence and disposition |
|---|---|
| Change surface | `lib/services/graph-service.js` remains the sole implementation and public facade. S0 adds characterization tests, a bounded source-map checker, a disposable mutation runner, and this receipt. **[VERIFIED via git diff]** |
| Entry points | Public facade imports plus route/service/script callers were inventoried with `rg`; CodeGraph was unavailable because this worktree has no `.codegraph/` directory. **[VERIFIED via `rg -l 'GraphService|graph-service' lib pages shared modules scripts tests`]** |
| Persistence | SharePoint/Graph drive items and versions are read and written by existing callers; Dataverse request-document rows, Postgres/Blob workflows, and their ownership remain unchanged. S0 adds no durable state. **[VERIFIED via plan §2 and source review]** |
| Consumers | The required consumer manifest is listed below. Three real-facade bridges exercise partial version salvage, upload identity propagation, and search throttle/incomplete handling. **[VERIFIED via manifest run]** |
| Prior finding | The plan is a proposed staged extraction; S0 freezes the current behavior before any module move. **[VERIFIED via plan §§1, 4, 5]** |

## Invariant table

| ID | S0 proof added |
|---|---|
| C1 | Public named export, exact 21 own statics, arity/sync split, DTOs, and subclass receiver dispatch. |
| C2 | Cold/warm, expiry safety window, deduplication, independent deadlines, rejection retry, reset races, and call-time credentials. |
| C3 | Canonical host, allowlist, TTL/reset, display-name/slug precedence, raw-case cache keys, and supplied-site resolution. |
| C4 | Traversal/encoding, empty-path differences, files-first depth/count/deadline, and first-page-only listing. |
| C5 | By-path cTag fallback versus stable-ID publication-only metadata, including readback distinctions. |
| C6 | Current-version identity, bounded pagination, continuation salvage, nextLink checks, exact-version outcomes, and consumer DTO bridge. |
| C7 | Presigned/manual redirects, plain current-download errors, CDN bearer exclusion, object versus Buffer results, and path delegation. |
| C8 | Retry-After forms, jitter/budget, body drain, network rejection, cooldown, KQL scope, filtering, and decode failure. |
| C9 | Folder 409/partial/cancellation behavior, write conflict modes, If-Match, chunk ranges/failures/readback, and upload identity bridge. |
| C10 | Existing restore/delete assertions remain in the versions/write suites. |
| C11 | Success/error/cache telemetry, emitter failure, actual AbortController timeout, timer cleanup, and single event. |
| C12 | Synchronous cache reset behavior and boundary state inventory, including search cooldown fields. |

## Baseline and working surface

The planning baseline was **5 suites / 64 tests**, from the five existing Graph suites, against unchanged runtime code. The isolated checkout's initial all-gate baseline had one setup-only failure because the required agent-invariant memory symlink was not yet present; `check:agent-invariants:ci` and all other baseline checks passed. The symlink was then created by the parent task owner, and the final gate rerun is required below. **[VERIFIED via `/private/tmp/wmkf-graph-decomposition-logs/s0-gates-baseline.log`; setup detail from parent]**

Changed paths are tests, test helpers, the mutation runner, and this receipt. `git diff -- lib/services/graph-service.js` must remain empty before handoff. No dependency, environment, migration, service, or deployment change is included. **[VERIFIED via working-tree inspection at receipt update]**

## Consumer manifest

The bounded textual-reference census produced **124 files / 233 textual matches** in the tracked `lib`, `pages`, `shared`, `modules`, `scripts`, and `tests` roots. The committed file list is `docs/plans/GRAPH_SERVICE_DECOMPOSITION_CONSUMER_MANIFEST_2026-09-19.md`; the search output is `/private/tmp/wmkf-graph-decomposition-logs/graph-callers-rg.txt` when regenerated. The required minimum consumer suites are:

`initial-assessment-artifact-versions`, `initial-assessment-controls-service`, `workbench-initial-assessment-versions-route`, `artifact-version-history`; `site-visit-materials-contributor-service`, `external-materials-routes`, `external-materials-routes-client`, `consultant-feedback-attachment-service`; `dynamics-explorer-search-documents`, `dynamics-explorer-chat-characterization`, `workbench-proposal-document-listing`, `workbench-download-proposal-document-service`, `load-proposal-service`, `load-proposal`; `document-lifecycle-boundary`; `individual-review-file-service`, `review-upload`, `sharepoint-cleanup`, `cycle-dossier-sharepoint`, `grantee-upload-service`, `grantee-replace-submission-service`, `drain-files-moved-helpers`, `drain-record-failure`; and `tests/integration/review-manager-download-review.test.js`.

The added `tests/unit/graph-service-consumer-contract.test.js` uses the real facade with mocked fetch/persistence for three bridges: continuation-page version salvage to the Initial Assessment DTO; upload drive/item/version/web URL identity to the contributor candidate and Request Document registry; and 429 search failure to Explorer's incomplete/cooldown response. Every bridge rejects unexpected URL or method shapes and performs no live call. **[VERIFIED via focused and manifest Jest runs]**

## Boundary checker and fixtures

`tests/helpers/graph-service-boundary.js` and `tests/unit/graph-service-boundary.test.js` use the installed `@babel/parser` (version 7.29.7) and an explicit source map. The bounded analyzer resolves relative/extensionless/index and configured alias imports; parses ESM, side-effect imports, re-exports, `require`, and dynamic imports; checks reachable helper unresolved locals, external runtime imports, internal→facade edges, indirect cycles, nonliteral Graph edges, direct fetch/receiver use, duplicate owners/state, and exact one-return-call facade delegates. The fixture suite includes each required red shape plus positive facade/delegate examples. Sol's read-only boundary review accepted the final bounded checker after two named correction rounds (`reviewer sol_s0_boundary`).

## Named correction coverage map

These are the final named cases requested by the fresh Sol contract review and where the S0 characterization lives:

| Review case | Proof location |
|---|---|
| Expired and exact-60-second token safety window | `graph-service-auth-cache.test.js`, `does not reuse an expired token` table. |
| Late site and drive resolution after reset | `graph-service-resolution.test.js`, reset-during-site and reset-during-drive tests. The fixture starts the old fetch before reset, resolves fresh first and old last, and asserts that the old response overwrites the cache. This preserves the existing unfenced behavior. |
| Exact module exports and own statics | `graph-service-public-contract.test.js`, namespace key assertion plus 21-static exact own-name assertion. |
| Null/undefined/options getter boundary behavior | `graph-service-public-contract.test.js`, options defaults/null/getter test; receiver forwarding and DTO assertions remain in the same suite. |
| Empty-path method differences, first-page listing, body rejection | `graph-service-read-contract.test.js`, empty-path/root and response-body rejection tests. |
| Retry-After date/malformed/body drain/network/filter/decode | `graph-service-search-retry.test.js`, secondary handback additions. |
| Continuation 429/JSON/current mismatch/exact-version 404/mismatch | `graph-service-versions.test.js`, secondary handback additions. |
| Folder 409 reread file/error, partial creation, cancellation | `graph-service-folders.test.js`, secondary handback additions. |
| Plain current-download fallback errors | `graph-service-downloads.test.js`, current-file missing-Location and CDN-error test. |
| Stale pending history rejection | `artifact-version-history.test.js`, stale rejection after request switch and reopen. |
| Bridge request count and unexpected transport | `graph-service-consumer-contract.test.js`, exact 4/1/1 fetch counts and per-test URL/method guards. |
| Large-upload publication preservation and readback asymmetry | `graph-service-upload-large.test.js`, parameterized successful chunk path with absent readback publication retaining PUT `1.0` and newer readback publication returning `3.0`. |
| Actual timeout and cleanup | `graph-service-observability.test.js`, AbortController timer advancement, timer-count zero, and one timeout event. |

## Test matrix and mutation proof

The latest Graph-focused command was:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-folders.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-write-contract.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/artifact-version-history.test.js
```

It passed **14 suites / 196 tests** after the final namespace, drive-order, bridge-count, and large-upload publication-preservation additions. The complete named consumer manifest command passed **37 suites / 605 tests**; the accepted log is `/private/tmp/wmkf-graph-decomposition-logs/s0-consumer-manifest-final-accepted.log`. Focused and manifest logs are outside the repository so they do not become runtime artifacts.

The complete consumer command is:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-folders.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-write-contract.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/initial-assessment-artifact-versions.test.js tests/unit/initial-assessment-controls-service.test.js tests/unit/workbench-initial-assessment-versions-route.test.js tests/unit/artifact-version-history.test.js tests/unit/site-visit-materials-contributor-service.test.js tests/unit/external-materials-routes.test.js tests/unit/external-materials-routes-client.test.js tests/unit/consultant-feedback-attachment-service.test.js tests/unit/dynamics-explorer-search-documents.test.js tests/unit/dynamics-explorer-chat-characterization.test.js tests/unit/workbench-proposal-document-listing.test.js tests/unit/workbench-download-proposal-document-service.test.js tests/unit/load-proposal-service.test.js tests/unit/load-proposal.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/individual-review-file-service.test.js tests/unit/review-upload.test.js tests/unit/sharepoint-cleanup.test.js tests/unit/cycle-dossier-sharepoint.test.js tests/unit/grantee-upload-service.test.js tests/unit/grantee-replace-submission-service.test.js tests/unit/drain-files-moved-helpers.test.js tests/unit/drain-record-failure.test.js tests/integration/review-manager-download-review.test.js
```

At S0, the disposable source-copy runner was `scripts/run-graph-service-s0-mutations.mjs`. That version copied the monolith to a temporary sibling, loads that copy with its real relative dependencies, exercises a characterization scenario, and deletes the copy in `finally`; the tracked runtime is never edited. The required mutants are token-generation fence, CDN bearer forwarding, continuation-404 salvage, upload receiver dispatch, download receiver dispatch, replacement If-Match, and chunk-failure propagation. Run `node scripts/run-graph-service-s0-mutations.mjs` against the S0 checkout to reproduce this historical proof; the current runner is described in the post-Opus receipt. The accepted log is `/private/tmp/wmkf-graph-decomposition-logs/s0-mutations-final.log`: seven unmodified controls passed and seven mutants failed their named assertions. Sol and root verified the corrected runner and log. The earlier catch-all runner output was rejected and is not acceptance evidence.

## G and handoff ledger

| Item | Result |
|---|---|
| All Graph suites + manifest + boundary | **[VERIFIED]** Exact focused command: 14 suites / 196 tests. Exact named manifest command: 37 suites / 605 tests. |
| Full Jest | **[VERIFIED]** `npm test -- --runInBand --silent`: 984 suites / 14,480 tests passed, 1 snapshot passed, 125.603s. |
| Type check, lint, canonical build | **[VERIFIED]** Sequential `npm run check:types` passed; `npm run lint` passed with 114 existing warnings and 0 errors; `npm run build` passed with Next.js 16.3.5 Turbopack. Prebuild wrote the existing 52-file migration manifest and emitted only the known reviewer-reminder hold advisory. |
| Every `check:*` parent and immediate self-test | **[VERIFIED]** 67 sequential commands from `package.json` passed (each available self-test immediately followed its parent); log `/private/tmp/wmkf-graph-decomposition-logs/s0-all-checks.log`. |
| Runtime diff | **[VERIFIED]** `git diff --name-only -- lib/services/graph-service.js` is empty; no runtime move is allowed in S0. Disposable mutation copy is removed. |
| Body comparison | **N/A for S0**; no moved declarations. Source boundary and public contract comparisons are recorded above. |
| Fresh reviewer | Sol `sol_s0_boundary` accepted the bounded boundary checker after two bounded correction rounds. Sol `sol_s0_contracts` accepted the named S0 contract coverage conditional on G; root independently reviewed the mutation runner and resolution late-completion fixture. |
| Accepted commit / next stage | **[ACCEPTED BY ROOT]** S0 commit is the commit introducing this receipt (`git log --diff-filter=A --format=%H -- docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md`). Rollback baseline: `710892ac`. Next allowed stage: S1. Root verified all changed paths are tests, supporting tooling and docs; no runtime/dependency/schema changes. |

## Required final G command sequence

1. Run the explicit Graph + named consumer manifest command and `tests/unit/document-lifecycle-boundary.test.js` in the same sequential Jest invocation; retain the exact command and result.
2. Run `npm run check:types`, `npm run lint`, and `npm run build` sequentially. If the canonical build hits the documented Turbopack process/port sandbox signature, follow the CI runbook escalation path and record the result.
3. Enumerate every current `check:*` script and run each parent immediately followed by its self-test, sequentially. Record unrelated advisory failures separately; relevant red gates block S0. **[VERIFIED: 67 commands passed; see log above.]**
4. Run `npm test -- --runInBand --silent` in a fresh process. Inspect the complete diff and confirm no runtime file changed. **[VERIFIED: 984 suites / 14,480 tests passed.]**

### Receipt template for later stages

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

## S1 execution receipt

Status: **[S1 ACCEPTED]**. S1 is the first runtime extraction after the accepted S0 commit. The public `lib/services/graph-service.js` facade remains the only caller-facing entry point; no caller, dependency, environment, persistence, or deployment change was made.

### Stage, baseline, and owned paths

| Field | Evidence |
|---|---|
| Baseline | Accepted S0 commit `546efff8aa107c130333dff51fe30343e5c7cf41` |
| Candidate | Commit introducing this S1 receipt on `codex/graph-service-decomposition`; rollback baseline `546efff8` |
| Builder-owned runtime paths | `lib/services/graph-service.js`, `lib/services/graph/constants.js`, `lib/services/graph/paths.js`, `lib/services/graph/http.js` |
| Documentation path | This receipt and the S1 status line in `docs/plans/GRAPH_SERVICE_DECOMPOSITION_PLAN_2026-09-19.md` |
| Runtime callers | Unchanged; no imports of the new internals were added outside the facade |
| State owners | `tokenCache`, `tokenPromise`, `tokenGeneration`, `siteCache`, `driveCache`, `searchCooldownUntil`, and `searchCooldownStatus` remain in the facade |

### Exact mechanical move

The following declarations moved from the S0 facade into the listed modules. Baseline ranges below are from `git show 546efff8:lib/services/graph-service.js`; destination ranges are from the candidate working tree.

| Destination | Symbols | S0 source range | Candidate range |
|---|---|---:|---:|
| `lib/services/graph/constants.js` | `GRAPH_BASE`, `API_TIMEOUT`, `DOWNLOAD_TIMEOUT`, `CACHE_TTL`, `SHAREPOINT_CANONICAL_SITE_URL`, `ALLOWED_SHAREPOINT_HOSTS`, `ALLOWED_LIBRARIES` | lines 19–22, 87, 93–95, 100–114 | lines 7–39 |
| `lib/services/graph/paths.js` | `validatePath` | lines 130–144 | lines 7–21 |
| `lib/services/graph/http.js` | `clampApiTimeout`, `deadlineTimeoutError`, `remainingTimeoutMs`, `waitForPromiseWithin`, `safeEmitDependencyEvent`, `fetchWithTimeout` | lines 1547–1555, 1578–1641 | lines 5–77 |

`downloadRedirectBody` remains in the facade, as required for S1. The facade now imports the extracted helpers and re-exports `SHAREPOINT_CANONICAL_SITE_URL`; all operation methods, caches, search policy/state, and public statics remain in the facade.

### Body comparison and allowed boundary differences

Root independently compared the 14 moved declaration bodies against the S0 baseline and found all 14 exact, excluding source positions and comments. The allowed differences are module imports/exports, the facade re-export, declaration relocation, and comment relocation. No operation body, error string, timeout value, cache state owner, request construction, response mapping, or public method changed. The focused public and boundary suites also verify the facade export and delegate boundary after extraction.

### G evidence

The exact focused S1 command was `npx jest --runInBand --silent --runTestsByPath tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/drain-record-failure.test.js`.

Result: **16 suites / 260 tests passed**, with zero snapshots. This covers all 14 Graph/contract suites plus the lifecycle and drain boundary consumers. The explicit route boundary checker and its self-test were run sequentially and passed, including the live repository census: `npm run check:route-service-boundary`, followed by `npm run check:route-service-boundary:self-test`.

Type check, lint, and canonical build were run sequentially: `npm run check:types`, `npm run lint`, and `npm run build`. All passed. Lint reported the repository's existing **114 warnings and 0 errors**. The Next.js **16.3.5 Turbopack** build compiled, generated all 32 static pages, and completed with the two known dynamic-filesystem tracing warnings in the pre-RP/pre-site-visit DOCX renderers. Prebuild retained the existing reviewer-reminder hold advisory and wrote the existing 52-file migration manifest without a tracked diff.

Every current `check:*` parent and available immediate self-test was then run sequentially from `package.json`. The complete output is retained at `/private/tmp/wmkf-graph-decomposition-logs/s1-all-checks.log`; the log contains **67 commands, 67 exit code 0, 0 failures**.

### Reviewer and handoff

Fresh Sol review **`sol_s1`** accepted the exact 14-leaf body comparison and whole-facade preservation, conditional on the G results. Root independently matched the moved leaves and reviewed the remaining facade, including `downloadRedirectBody`. No unresolved S1 contract finding remains. Root final review and G acceptance are complete. Next allowed stage is S2; no S0 mutation runner was rerun because its source anchors are baseline-specific.

### Unresolved assumptions and release blockers

No S1 test or gate failure remains. The worktree has no live-service or provider-API evidence, by design. No release, push, deployment, dependency change, migration, or later-stage extraction is authorized by this receipt.

## S2 execution receipt

Status: **[S2 ACCEPTED]**. Baseline is accepted S1 commit `77e94c0d`; the accepted candidate is the commit introducing this S2 receipt on `codex/graph-service-decomposition`.

### Owned move and parity

S2 changed only the authentication owner and explicit boundary inventory:

- `lib/services/graph/auth.js` now owns `tokenCache`, `tokenPromise`, `tokenGeneration`, `getAccessToken`, and `resetAuthCache` (candidate lines 14–17, 29–86, and 88–92).
- The baseline auth implementation was `lib/services/graph-service.js:100–177`; its three cache declarations, token method body, and generation-fenced shared promise were moved verbatim apart from the receiver parameter and module imports.
- The baseline `clearCaches()` auth reset statements were `lib/services/graph-service.js:1497–1499`. The facade now calls `resetAuthCache()` at the same position after the two search reset statements and before site/drive reset statements (`lib/services/graph-service.js:1426–1432`).
- The facade preserves the original public signature `static async getAccessToken({ timeoutMs = API_TIMEOUT } = {})` and has a sole return delegate: `return getAccessToken(this, { timeoutMs });` (`lib/services/graph-service.js:107–109`). This preserves receiver spies/subclasses, getter/default evaluation, async rejection behavior, and call-time environment reads.

Root's source comparison found the auth method body and three reset assignments exact against `77e94c0d`, with only permitted module-boundary changes: imports, the receiver parameter, explicit facade delegate, reset-owner call, and declaration relocation. No caller or other cache owner changed. The explicit real-source boundary inventory in `tests/unit/graph-service-boundary.test.js` names the S2 method owner, three state owners, and delegate; generic fixture options remain separate.

### S2 G evidence

The exact focused command was the 16-suite Graph/lifecycle/drain command recorded in the S1 receipt, rerun unchanged after S2. Result: **16 suites / 260 tests passed**, zero snapshots. The targeted auth, boundary, folders, and observability proof passed **4 suites / 64 tests** before the full run.

Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed. Lint reported **114 warnings and 0 errors**. The canonical Next.js **16.3.5 Turbopack** build completed with the same two known DOCX dynamic-filesystem tracing warnings and existing reviewer-reminder hold advisory.

Every current `check:*` parent and available immediate self-test ran sequentially. Complete output is `/private/tmp/wmkf-graph-decomposition-logs/s2-all-checks.log`: **67 commands, all exit code 0**.

Fresh Sol review **`sol_s2`** accepted the auth body/reset parity and explicit boundary inventory conditional on G. Root independently verified the body, reset replacement, and wrapper shape. No unresolved S2 finding remains. Root final review and G acceptance are complete; next allowed stage is S3; the S0 mutation runner remains baseline-specific and was not rerun.

## S3 execution receipt

Status: **[S3 ACCEPTED]**. Baseline is accepted S2 commit `7ff2f90f`; the accepted candidate is the commit introducing this S3 receipt on `codex/graph-service-decomposition`.

### Owned move and parity

S3 changed only the SharePoint resolution owner and explicit boundary inventory:

- `lib/services/graph/resolution.js` now owns `siteCache`, `driveCache`, `getSiteId`, `getDriveId`, and `resetResolutionCaches` (candidate lines 20–21, 27–67, 79–145, and 147–151).
- The baseline resolution implementations were `lib/services/graph-service.js:101–102` and `:124–164` and `:178–244`; both method bodies were moved with only `this` receiver calls rewritten to `svc` and module imports adjusted.
- The baseline `clearCaches()` site/drive reset statements were `lib/services/graph-service.js:1430–1432`. The facade now calls `resetResolutionCaches()` at the same position after the auth reset (`lib/services/graph-service.js:1306–1311`).
- The facade preserves `static async getSiteId()` and `static async getDriveId(libraryName, { siteId: suppliedSiteId = null } = {})`, each as a sole receiver-forwarding return delegate (`lib/services/graph-service.js:116–124`).

Raw-case drive cache keys, TTL checks, supplied-site behavior, host/library validation, display-name then slug matching, errors, and unfenced late in-flight completion remain unchanged. Root matched all three moved method bodies after normalizing `this` to `svc` and verified the three reset statements. The explicit real-source boundary inventory names both resolution method owners, both cache owners, and both delegates; generic fixture options remain separate.

### S3 G evidence

The exact S1 focused command plus `tests/unit/workbench-proposal-document-listing.test.js tests/unit/load-proposal-service.test.js tests/unit/load-proposal.test.js` passed **19 suites / 297 tests**: all Graph suites, lifecycle/drain tests, `workbench-proposal-document-listing.test.js`, `load-proposal-service.test.js`, and `load-proposal.test.js`. The targeted resolution/boundary/consumer run passed **5 suites / 67 tests**.

Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed. Lint reported **114 warnings and 0 errors**. The canonical Next.js **16.3.5 Turbopack** build completed with the same two known DOCX dynamic-filesystem tracing warnings and existing reviewer-reminder hold advisory.

Every current `check:*` parent and available immediate self-test ran sequentially. Complete output is `/private/tmp/wmkf-graph-decomposition-logs/s3-all-checks.log`: **67 commands, all exit code 0**.

Fresh Sol review **`sol_s3`** accepted the resolution body/reset parity and explicit boundary inventory conditional on G. Root independently verified the normalized method bodies, cache ownership, reset placement, and no stale-generation redesign. No unresolved S3 finding remains. Root final review and G acceptance are complete; next allowed stage is S4; the S0 mutation runner remains baseline-specific and was not rerun.

## S4 execution receipt

Status: **[S4 ACCEPTED]**. Baseline is accepted S3 commit `2addf72a`; the accepted candidate is the commit introducing this S4 receipt on `codex/graph-service-decomposition`.

### Owned move and exact bounds

S4 changed only the file-read owner and explicit real-source boundary inventory. Bounds below were derived from `git show 2addf72a:lib/services/graph-service.js` and `nl -ba` on the current candidate after the final `files.js` header correction.

| Symbol | Baseline facade range | Candidate module range | Facade delegate |
|---|---:|---:|---:|
| `listFiles` | lines 146–216 | `lib/services/graph/files.js:36–106` | `lib/services/graph-service.js:147–149` |
| `getFileMetadataById` | lines 222–269 | `lib/services/graph/files.js:112–160` | `lib/services/graph-service.js:155–161` |
| `getFileMetadataByPath` | lines 723–771 | `lib/services/graph/files.js:169–218` | `lib/services/graph-service.js:615–625` |

`listFiles` retains the original raw `options = {}` signature and in-body destructuring at `files.js:36–45`; its nested files-first walk, defaults, depth/file caps, deadline, path validation, and errors remain unchanged apart from `this`→`svc`. The two originally destructured metadata signatures reconstruct their bound fields in the sole facade return delegates. By-ID metadata retains publication-only `versionId` behavior and identity checks; by-path metadata retains its publication-or-cTag fallback and paired supplied site/drive behavior. Root's six-function body comparison matched all three moved bodies after the permitted `this`→`svc` and receiver/header boundary rewrites.

The real-source boundary inventory explicitly assigns `listFiles`, `getFileMetadataById`, and `getFileMetadataByPath` to `graph/files.js` and names all three facade delegates. Generic fixture ownership options remain separate. No other method, state owner, caller, or runtime path changed.

### S4 G evidence

The exact required consumer-inclusive Jest command was:

`npx jest --runInBand --silent --runTestsByPath tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/drain-record-failure.test.js tests/unit/initial-assessment-artifact-versions.test.js tests/unit/initial-assessment-controls-service.test.js tests/unit/workbench-proposal-document-listing.test.js tests/unit/workbench-download-proposal-document-service.test.js`

Result: **20 suites / 307 tests passed**, zero snapshots. The post-correction affected subset (`graph-service-boundary`, `graph-service-read-contract`, `graph-service-consumer-contract`, `initial-assessment-artifact-versions`, `workbench-proposal-document-listing`, and `workbench-download-proposal-document-service`) passed **6 suites / 58 tests**.

Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed. Lint reported **114 warnings and 0 errors**. The canonical Next.js **16.3.5 Turbopack** build completed with the same two known DOCX dynamic-filesystem tracing warnings and existing reviewer-reminder hold advisory.

Every current `check:*` parent and available immediate self-test ran sequentially. Complete output is `/private/tmp/wmkf-graph-decomposition-logs/s4-all-checks.log`: **67 commands, all exit code 0**.

Fresh Sol review **`sol_s4`** accepted the six moved body comparisons and explicit boundary inventory conditional on G. Root independently verified all six extracted functions and facade delegates after correcting the `listFiles` source header/body shape. No unresolved S4 finding remains. Root final review and G acceptance are complete; next allowed stage is S5; the S0 mutation runner remains baseline-specific and was not rerun.

## S5 execution receipt

Status: **[S5 ACCEPTED]**. Baseline is accepted S4 commit `c20b6538`; this candidate keeps the public GraphService facade and callers unchanged while moving version-history reads and restore into `lib/services/graph/versions.js`. No policy, registry caller, dependency, environment, persistence, live-service, deployment, or later-stage change was made.

### Owned move and exact bounds

The exact source ranges below were derived from `git show c20b6538:lib/services/graph-service.js` and `nl -ba` on the candidate after the final whitespace cleanup.

| Symbol | Baseline facade range | Candidate module range | Facade delegate |
|---|---:|---:|---:|
| `MAX_VERSION_PAGES`, `MIN_VERSION_PAGE_BUDGET_MS` | lines 97, 99 | `lib/services/graph/versions.js:21,23` | N/A |
| `listFileVersions` | lines 194–388 | `lib/services/graph/versions.js:56–250` | `lib/services/graph-service.js:158–164` |
| `getFileVersionMetadata` | lines 391–419 | `lib/services/graph/versions.js:252–280` | `lib/services/graph-service.js:167–169` |
| `restoreFileVersion` | lines 425–449 | `lib/services/graph/versions.js:286–310` | `lib/services/graph-service.js:174–176` |

The three method bodies were moved from exact source slices with only the receiver parameter and `this.`→`svc.` boundary changes. The facade preserves the original `listFileVersions` destructured options signature and reconstructs `{ siteId, timeoutMs, limit }` for its sole delegate return. The exact metadata and restore methods retain their raw argument signatures and forward those arguments directly. Current-version-first materialization, bounded pagination, continuation salvage/security checks, sorting/capping, Graph error mapping, and restore POST/204 enforcement remain unchanged. The facade import is the only additional runtime edge; `clearCaches()` and all other cache reset order remain unchanged.

The explicit real-source boundary inventory in `tests/unit/graph-service-boundary.test.js` assigns both version bounds and all three methods to `graph/versions.js`, and names all three facade delegates. Generic fixture ownership options remain separate. Fresh Sol review **`sol_s5`** accepted the source parity and dedicated restore review conditional on G; root independently matched all nine moved declarations and confirmed the restore caller/registry boundary was unchanged.

### S5 G evidence

The exact required consumer-inclusive Jest command was:

```text
npx jest --runInBand tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/drain-record-failure.test.js tests/unit/initial-assessment-artifact-versions.test.js tests/unit/workbench-initial-assessment-versions-route.test.js tests/unit/initial-assessment-controls-service.test.js
```

Result: **19 suites / 304 tests passed**, zero snapshots. The focused S5 characterization set was **7 suites / 118 tests passed** before the full run. Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed. The canonical Next.js **16.3.5 Turbopack** build compiled successfully with the two known dynamic-filesystem tracing warnings; lint completed without errors.

Every current `check:*` parent and available immediate self-test ran sequentially. The retained log is `/private/tmp/wmkf-graph-decomposition-logs/s5-all-checks.log`; it contains **67 status lines, all exit code 0**. Final syntax and whitespace checks after the receipt-only cleanup were `node --check lib/services/graph-service.js`, `node --check lib/services/graph/versions.js`, and `git diff --check`, all passing. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

No unresolved S5 contract finding remains. Root final review and G acceptance are complete; the next allowed stage is S6. The commit introducing this receipt is the accepted S5 checkpoint; rollback is accepted S4 commit `c20b6538`.

## S6 execution receipt

Status: **[S6 ACCEPTED]**. Baseline is accepted S5 commit `ac4a03b4`; this candidate keeps the public GraphService facade and download callers unchanged while moving the download transport owner into `lib/services/graph/downloads.js`. No dependency, environment, persistence, policy, registry caller, live-service, deployment, or later-stage change was made.

### Owned move and exact bounds

The ranges below were derived from `git show ac4a03b4:lib/services/graph-service.js` and the candidate AST/source bounds. The private redirect helper was compared byte-for-byte by root.

| Symbol | Baseline facade range | Candidate module range | Facade delegate |
|---|---:|---:|---:|
| `downloadRedirectBody` | lines 897–916 | `lib/services/graph/downloads.js:171–190` | N/A |
| `downloadFile` | lines 196–268 | `lib/services/graph/downloads.js:31–103` | `lib/services/graph-service.js:181–183` |
| `downloadFileVersion` | lines 275–288 | `lib/services/graph/downloads.js:110–123` | `lib/services/graph-service.js:187–189` |
| `downloadFileAsPdf` | lines 295–307 | `lib/services/graph/downloads.js:130–142` | `lib/services/graph-service.js:193–195` |
| `downloadFileByPath` | lines 313–333 | `lib/services/graph/downloads.js:148–168` | `lib/services/graph-service.js:199–201` |

The four public methods were moved from exact source slices with only the receiver parameter and `this.`→`svc.` boundary changes. Raw signatures and default evaluation points remain unchanged. `downloadFile` retains its presigned URL attempt and manual redirect fallback; CDN follow requests still omit Graph authorization. Version and PDF routes still return buffers through the private redirect helper with the original error/status behavior. `downloadFileByPath` keeps path validation, stable drive resolution, metadata lookup, and its final `svc.downloadFile(driveId, item.id)` dispatch. No cache/reset or unrelated facade method changed.

The explicit real-source boundary inventory in `tests/unit/graph-service-boundary.test.js` assigns all four public methods to `graph/downloads.js` and names their facade delegates. The private helper remains module-local and has no public owner inventory entry. Fresh Sol review **`sol_s6`** accepted the public bodies and dedicated private-helper parity conditional on G; root independently verified all 13 moved declarations and the unchanged download-review/Workbench consumer contracts.

### S6 G evidence

The exact required download and consumer command was:

```text
npx jest --runInBand tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/integration/review-manager-download-review.test.js tests/unit/download-review-service.test.js tests/unit/individual-review-file-service.test.js tests/unit/review-upload.test.js tests/unit/review-upload-response.test.js tests/unit/workbench-download-proposal-document-route.test.js tests/unit/workbench-download-proposal-document-service.test.js
```

Result: **22 suites / 380 tests passed**, zero snapshots. Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed. Lint reported the repository's existing **114 warnings and 0 errors**. The canonical Next.js **16.3.5 Turbopack** build completed with the two known dynamic-filesystem tracing warnings and no compile errors.

Every current `check:*` parent and available immediate self-test ran sequentially. The retained log is `/private/tmp/wmkf-graph-decomposition-logs/s6-all-checks.log`; it contains **67 commands, all exit code 0**. Final syntax and whitespace checks after the generated-file cleanup were `node --check lib/services/graph-service.js`, `node --check lib/services/graph/downloads.js`, and `git diff --check`, all passing. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

No unresolved S6 contract finding remains. Root final review and G acceptance are complete. The commit introducing this receipt is the accepted S6 checkpoint; rollback is `ac4a03b4`; S7 is next.

## S7 execution receipt

Status: **[S7 ACCEPTED]**. Baseline is accepted S6 commit `0f5c90db`; this candidate moves the search retry policy, cooldown state, and search method into `lib/services/graph/search.js` while preserving the public facade and all consumers. S0–S6 remain accepted. No upload retry behavior, dependency, environment, persistence, policy, live-service, deployment, or later-stage change was made.

### Owned move and exact bounds

The ranges below were derived from `git show 0f5c90db:lib/services/graph-service.js` and `nl -ba` on the candidate; the moved bodies are exact source slices with only `this.`→`svc.` receiver injection where required.

| Symbol | Baseline facade range | Candidate module range | Facade delegate/reset |
|---|---:|---:|---:|
| `isRetryableSearchStatus` | lines 48–50 | `lib/services/graph/search.js:24–26` | N/A |
| `SEARCH_MAX_ATTEMPTS` | line 51 | `lib/services/graph/search.js:27` | N/A |
| `SEARCH_BACKOFF_CAP_MS` | line 54 | `lib/services/graph/search.js:30` | N/A |
| `SEARCH_MAX_RETRY_WAIT_MS` | line 59 | `lib/services/graph/search.js:35` | N/A |
| `searchCooldownUntil`, `searchCooldownStatus` | lines 65–66 | `lib/services/graph/search.js:41–42` | N/A |
| `parseRetryAfterMs` | lines 69–76 | `lib/services/graph/search.js:45–52` | N/A |
| `planSearchRetry` | lines 83–92 | `lib/services/graph/search.js:59–68` | N/A |
| `resetSearchCooldown` | lines 756–757 (clearCaches assignments) | `lib/services/graph/search.js:70–73` | `lib/services/graph-service.js:565–569` call order |
| `searchFiles` | lines 323–455 | `lib/services/graph/search.js:86–218` | `lib/services/graph-service.js:263–265` |

`clearCaches()` preserves the required search → auth → resolution reset order. The real-source boundary inventory names all four private helpers/reset symbols, all three search constants, both cooldown state variables, and the public delegate. Its duplicate test first analyzes the actual source map with `REAL_SOURCE_OPTIONS`, then appends duplicate declarations to an in-memory facade copy and asserts the named owner errors; no runtime source is mutated. Fresh Sol review **`sol_s7`** accepted the source move and inventory conditional on G; root independently matched the moved declarations and retry state against the baseline.

### S7 G evidence

The exact required Graph/lifecycle/Explorer command was:

```text
npx jest --runInBand tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/drain-record-failure.test.js tests/unit/dynamics-explorer-search-documents.test.js tests/unit/dynamics-explorer-chat-characterization.test.js
```

Result: **18 suites / 291 tests passed**, one snapshot passed. After the final boundary-fixture correction, the affected rerun was:

```text
npx jest --runInBand tests/unit/graph-service-boundary.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/dynamics-explorer-search-documents.test.js tests/unit/dynamics-explorer-chat-characterization.test.js
```

It passed **5 suites / 80 tests**, one snapshot. Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed; lint reported **114 warnings and 0 errors**, and the canonical Next.js **16.3.5 Turbopack** build retained the two known DOCX dynamic-filesystem tracing warnings. Every current `check:*` parent and available immediate self-test passed sequentially: `/private/tmp/wmkf-graph-decomposition-logs/s7-all-checks.log` records **67 commands, all exit code 0**. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

No unresolved S7 contract finding remains. Root final review and G acceptance are complete. The commit introducing this receipt is the S7 checkpoint; rollback is `0f5c90db`; S8 is next. Runtime files remain unchanged after the source-ready review; the final correction changed only the boundary characterization fixture.

## S8 execution receipt

Status: **[S8 ACCEPTED]**. Baseline is accepted S7 commit `4c6191d6`; this candidate moves only `ensureFolderPath` into `lib/services/graph/writes.js` and keeps the public facade and callers unchanged. No upload, replacement, delete, dependency, environment, persistence, policy, live-service, deployment, or later-stage change was made.

### Owned move and exact bounds

The declaration bounds below were derived from `git show 4c6191d6:lib/services/graph-service.js` and `nl -ba` on the candidate. The extracted body matches the baseline after the permitted receiver substitution (`this.`→`svc.`) and indentation change; the normalized body comparison returned zero differences.

| Symbol | Baseline facade declaration | Candidate declaration | Facade delegate |
|---|---:|---:|---:|
| `ensureFolderPath` | `lib/services/graph-service.js:176–256` | `lib/services/graph/writes.js:19–100` | `lib/services/graph-service.js:177–187` |

The facade keeps the original destructured options signature and default evaluation, reconstructing `{ siteId, driveId, signal }` for the single delegate call. The extracted owner preserves the per-segment traversal, path validation, pinned site/drive and credential resolution order, cancellation checks between operations, partial creation behavior, unguarded 409 recovery read, exact cumulative-path reread, and all existing error strings. The explicit real-source inventory maps `ensureFolderPath` to `graph/writes.js` and its facade delegate; the generic fixture inventory remains separate. Fresh Sol review **`sol_s8`** accepted the source move conditional on G; root staged the runtime and boundary files for tracked-source review.

### S8 G evidence

The exact required Graph/lifecycle/site-visit/Cycle Dossier/controls command was:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/artifact-version-history.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-folders.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-write-contract.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/document-lifecycle-public-contract.test.js tests/unit/site-visit-materials-contributor-service.test.js tests/unit/site-visit-material-file.test.js tests/unit/site-visit-materials-card.test.js tests/unit/site-visit-materials-collection-service.test.js tests/unit/site-visit-materials-collection-store.test.js tests/unit/site-visit-materials-line.test.js tests/unit/site-visit-materials-summary-reader.test.js tests/unit/site-visit-materials-upload-cap.test.js tests/unit/cycle-dossier-sharepoint.test.js tests/unit/cycle-dossier-worker.test.js tests/unit/initial-assessment-controls-service.test.js tests/unit/workbench-initial-assessment-controls-routes.test.js
```

Result: **28 unique suites / 375 tests passed**, zero snapshots (`/private/tmp/wmkf-graph-decomposition-logs/s8-jest-final.log`). This corrected run supersedes an earlier command that listed the contributor suite twice. The focused prerequisite set (`graph-service-folders`, `graph-service-write-contract`, `graph-service-boundary`, and `graph-service-consumer-contract`) passed **4 suites / 65 tests**. Sequential `npm run check:types`, `npm run lint`, and `npm run build` passed; lint reported **114 warnings and 0 errors**, and the canonical Next.js **16.3.5 Turbopack** build retained the two known DOCX dynamic-filesystem tracing warnings. Every current `check:*` parent and available immediate self-test passed sequentially: `/private/tmp/wmkf-graph-decomposition-logs/s8-all-checks.log` records **67 commands, all exit code 0**. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

No unresolved S8 contract finding remains. Root final review and G acceptance are complete. The commit introducing this receipt is the accepted S8 checkpoint; rollback is `4c6191d6`; S9 is next.

## S9 execution receipt

Status: **[S9 ACCEPTED]**. Baseline is accepted S8 commit `c8bf1848`; this stage moved only `uploadFile`, `replaceFileContent`, and `deleteFile` into the existing `lib/services/graph/writes.js`, updated the explicit real-source boundary inventory, and kept the public facade and callers unchanged. No upload-session move, dependency, environment, persistence, policy, live-service, deployment, or later-stage change was made.

### Contract-reconcile surface and invariants

| Surface | S9 evidence |
|---|---|
| Change surface | Simple upload, stable-item replacement, and delete transport owners move to `graph/writes.js`; `GraphService` remains the public facade. **[VERIFIED via diff and boundary analyzer]** |
| Entry points | `GraphService.uploadFile`, `GraphService.replaceFileContent`, `GraphService.deleteFile`; all existing service/route callers remain unchanged. **[VERIFIED via source and consumer manifest]** |
| Persistence | SharePoint/Graph drive items only; no schema, registry, Blob, or Dataverse ownership changes. **[VERIFIED via moved bodies and consumer tests]** |
| Consumers | Real-facade upload/registry bridge plus contributor, grantee upload/replacement, review upload, cleanup, drain, lifecycle, and complete named manifest suites. **[VERIFIED via S9 G]** |
| Prior findings | Fresh Sol `sol_s9` source review accepted conditional on G; root reviewed facade receiver forwarding and the 18-body parity result. **[VERIFIED via handoff]** |

| Invariant | Evidence |
|---|---|
| Simple upload retains conflict modes, validation, conditional publication readback, stable identity, and readback failure handling. | `graph-service-write-contract.test.js`; baseline/candidate AST parity. |
| Replacement retains stable drive/item identity, exact `If-Match`, 412 mapping, cTag fallback, and one write. | `graph-service-write-contract.test.js`; baseline/candidate AST parity. |
| Delete retains 204/404 success, error text/status, and no retry. | `graph-service-write-contract.test.js`; baseline/candidate AST parity. |
| Facade signatures/default destructuring remain unchanged and each delegate has one explicit receiver-forwarding return. | `graph-service-boundary.test.js`; facade lines 227–240, 339–347, 357–359. |

### Owned move and exact AST bounds

The bounds below were derived from `git show c8bf1848:lib/services/graph-service.js` and `nl -ba` on the candidate. The moved function bodies match after normalizing only source positions/comments and the permitted `this`→`svc` receiver change; the parity command returned zero unexplained differences.

| Symbol | S8 facade declaration | Candidate declaration | Facade delegate |
|---|---:|---:|---:|
| `uploadFile` | `lib/services/graph-service.js:222–318` | `lib/services/graph/writes.js:124–221` | `lib/services/graph-service.js:227–240` |
| `replaceFileContent` | `lib/services/graph-service.js:417–468` | `lib/services/graph/writes.js:228–280` | `lib/services/graph-service.js:339–347` |
| `deleteFile` | `lib/services/graph-service.js:478–492` | `lib/services/graph/writes.js:290–304` | `lib/services/graph-service.js:357–359` |

`writes.js` now imports `DOWNLOAD_TIMEOUT` in addition to its existing folder-write imports. The upload owner preserves the conditional readback branch exactly; replacement remains a separate cTag/If-Match path. The facade retains the original signatures and reconstructs the aliased upload fields for its explicit delegate; replacement forwards `{ siteId, ifMatch }`; delete forwards its raw identifiers.

### Required tests and G evidence

The prerequisite command initially caught the missing `DOWNLOAD_TIMEOUT` import; after that one source correction, it passed **4 suites / 95 tests**:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-write-contract.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/document-lifecycle-boundary.test.js
```

The complete S9 Graph and consumer command was:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-folders.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-write-contract.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/artifact-version-history.test.js tests/unit/initial-assessment-artifact-versions.test.js tests/unit/initial-assessment-controls-service.test.js tests/unit/workbench-initial-assessment-versions-route.test.js tests/unit/site-visit-materials-contributor-service.test.js tests/unit/external-materials-routes.test.js tests/unit/external-materials-routes-client.test.js tests/unit/consultant-feedback-attachment-service.test.js tests/unit/dynamics-explorer-search-documents.test.js tests/unit/dynamics-explorer-chat-characterization.test.js tests/unit/workbench-proposal-document-listing.test.js tests/unit/workbench-download-proposal-document-service.test.js tests/unit/load-proposal-service.test.js tests/unit/load-proposal.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/individual-review-file-service.test.js tests/unit/review-upload.test.js tests/unit/sharepoint-cleanup.test.js tests/unit/cycle-dossier-sharepoint.test.js tests/unit/grantee-upload-service.test.js tests/unit/grantee-replace-submission-service.test.js tests/unit/drain-files-moved-helpers.test.js tests/unit/drain-record-failure.test.js tests/integration/review-manager-download-review.test.js
```

Result: **37 suites / 606 tests passed**, one snapshot (`/private/tmp/wmkf-graph-decomposition-logs/s9-jest-final.log`). This includes the real-facade upload/registry bridge, `artifact-version-history`, `document-lifecycle-boundary`, contributor/grantee upload and replacement, review upload, cleanup, drain, and the complete named consumer manifest.

Sequential regression commands all passed:

```text
npm run check:types                         # passed
npm run lint                                # passed; 114 existing warnings, 0 errors
npm run build                               # passed; Next.js 16.3.5 Turbopack, known DOCX tracing warnings
```

Every current `check:*` parent and available immediate self-test ran sequentially; `/private/tmp/wmkf-graph-decomposition-logs/s9-all-checks.log` records **67 commands, all exit code 0**. The body comparison is `/private/tmp/wmkf-graph-decomposition-logs/s9-body-parity.log` (**3/3 moved S9 bodies passed**); final `git diff --check` passed. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

### Review and handoff

Fresh Sol review **`sol_s9`** accepted the source extraction conditional on G, with no material finding. Root independently verified facade receiver forwarding and the all-18-body parity result. No unresolved S9 contract finding remains after G. Root final review and G acceptance are complete; the commit introducing this receipt is the S9 checkpoint; rollback remains accepted S8 commit `c8bf1848`. No live rehearsal, push, deployment, or merge is authorized; S10 is next.

## S10 execution receipt

Status: **[S10 ACCEPTED]**. Baseline is accepted S9 commit `1dad580e`; this stage moved only `uploadFileLarge` into the new `lib/services/graph/upload-session.js`, updated the explicit real-source boundary inventory, and kept the public facade and callers unchanged. No S11 closure, dependency, environment, persistence, policy, live-service, deployment, or later-stage change was made.

### Contract-reconcile surface and invariants

| Surface | S10 evidence |
|---|---|
| Change surface | Large upload-session transport owner moves behind the unchanged `GraphService.uploadFileLarge` facade. **[VERIFIED via diff and boundary analyzer]** |
| Entry points | `GraphService.uploadFileLarge`; existing applicant, consultant, and external-material callers remain unchanged. **[VERIFIED via source and G consumers]** |
| Persistence | SharePoint/Graph upload sessions and drive items only; no registry, schema, Blob, or Dataverse ownership changes. **[VERIFIED via moved body and consumer tests]** |
| Consumers | All Graph suites, lifecycle boundaries, applicant/site-visit contributor, consultant attachment, and external-material routes. **[VERIFIED via S10 G]** |
| Prior findings | Fresh Sol `sol_s10` source review accepted conditional on G; root reviewed the facade signature/receiver forwarding and 19-body parity. **[VERIFIED via handoff]** |

| Invariant | Evidence |
|---|---|
| Small buffers retain facade receiver dispatch to `svc.uploadFile`. | `graph-service-upload-large.test.js`, `graph-service-public-contract.test.js`, facade lines 251–263. |
| Session chunks remain contiguous and pre-authorized, with no bearer header on session PUT/DELETE. | `graph-service-upload-large.test.js`; moved body parity. |
| HTTP chunk failure performs existing cleanup; network-thrown chunk failure does not add cleanup. | `graph-service-upload-large.test.js`; moved body parity. |
| Final item readback remains unconditional and preserves final PUT publication when readback lacks publication. | `graph-service-upload-large.test.js`; moved body parity. |

### Owned move and exact AST bounds

The bounds below were derived from `git show 1dad580e:lib/services/graph-service.js` and `nl -ba` on the candidate. The moved function body matches after normalizing only source positions/comments and the permitted `this`→`svc` receiver change; the parity command returned zero unexplained differences.

| Symbol | S9 facade declaration | Candidate declaration | Facade delegate |
|---|---:|---:|---:|
| `uploadFileLarge` | `lib/services/graph-service.js:250–332` | `lib/services/graph/upload-session.js:21–104` | `lib/services/graph-service.js:251–263` |

The original facade signature and default destructuring remain unchanged. The delegate reconstructs `{ conflictBehavior, chunkBytes }`; the extracted owner retains the small-buffer `svc.uploadFile` call, session POST, chunk ranges, cleanup branch, and unconditional readback exactly. No logic was consolidated with `writes.js` simple upload.

### Required tests and G evidence

The pre-move prerequisite passed **2 suites / 17 tests**:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-public-contract.test.js
```

The source-ready boundary rerun passed **3 suites / 41 tests** (`graph-service-upload-large`, `graph-service-public-contract`, `graph-service-boundary`).

The complete S10 Graph/lifecycle/applicant-consultant/external-material command was:

```text
npx jest --runInBand --silent --runTestsByPath tests/unit/graph-service-folders.test.js tests/unit/graph-service-versions.test.js tests/unit/graph-service-search-retry.test.js tests/unit/graph-service-upload-large.test.js tests/unit/graph-service-observability.test.js tests/unit/graph-service-boundary.test.js tests/unit/graph-service-public-contract.test.js tests/unit/graph-service-auth-cache.test.js tests/unit/graph-service-resolution.test.js tests/unit/graph-service-read-contract.test.js tests/unit/graph-service-downloads.test.js tests/unit/graph-service-write-contract.test.js tests/unit/graph-service-consumer-contract.test.js tests/unit/artifact-version-history.test.js tests/unit/document-lifecycle-boundary.test.js tests/unit/document-lifecycle-public-contract.test.js tests/unit/site-visit-materials-contributor-service.test.js tests/unit/consultant-feedback-attachment-service.test.js tests/unit/external-materials-routes.test.js tests/unit/external-materials-routes-client.test.js tests/unit/review-upload.test.js
```

Result: **21 suites / 364 tests passed**, zero snapshots (`/private/tmp/wmkf-graph-decomposition-logs/s10-jest-final.log`).

Sequential regression commands all passed:

```text
npm run check:types                         # passed
npm run lint                                # passed; 114 existing warnings, 0 errors
npm run build                               # passed; Next.js 16.3.5 Turbopack, known DOCX tracing warnings
```

Every current `check:*` parent and available immediate self-test ran sequentially; `/private/tmp/wmkf-graph-decomposition-logs/s10-all-checks.log` records **67 commands, all exit code 0**. The body comparison is `/private/tmp/wmkf-graph-decomposition-logs/s10-body-parity.log` (**1/1 moved S10 body passed**); final `git diff --check` passed. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

### Review and handoff

Fresh Sol review **`sol_s10`** accepted the source extraction conditional on G, with no material finding. Root independently verified facade forwarding and the all-19-body parity result. No unresolved S10 contract finding remains after G. Root final review and G acceptance are complete; the commit introducing this receipt is the S10 checkpoint; rollback remains accepted S9 commit `1dad580e`. No live rehearsal, push, deployment, or merge is authorized; S11 is next.

## S11 closure receipt

Status: **[S11 ACCEPTED LOCALLY — RELEASE BLOCKED]**. Baseline is accepted S10 commit `7bf1ce2d`; this closure pass performs only proven source cleanup, boundary-inventory tightening, stale Graph documentation reconciliation, and release-packet evidence. No runtime behavior, public signature, dependency, environment, persistence, policy, live-service, deployment, merge, or push change is included. Accepted S11 checkpoint: `76cfbbcb`. The subsequent handoff commit changes documentation only.

### Closure surface and source ownership

The facade retains exactly 21 public static methods and the canonical `SHAREPOINT_CANONICAL_SITE_URL` export. Unused facade imports were removed after source-use verification. Headers now identify the physical Graph transport and state owners; `constants.js` owns immutable configuration, `versions.js` covers restore as well as reads, and `writes.js` covers folder and file writes. The Dynamics helper comment distinguishes its own transport from Graph's separate `graph/http.js` helper. Historical facade paths in error strings remain unchanged for caller compatibility.

`tests/unit/graph-service-boundary.test.js` now inventories all real top-level Graph helpers, constants, and reset owners, with explicit physical `movedOwners` and public delegate maps. Private helpers remain private. The analyzer recognizes exported variable declarations, and the negative fixture appends duplicate helper/constant declarations to an in-memory facade copy; it passed without introducing duplicate imported identifiers or changing production runtime code. Boundary inventory result: **1 suite / 25 tests passed** (`/private/tmp/wmkf-graph-decomposition-logs/s11-boundary-inventory.log`). Root's supporting parity evidence also passed: all 21 facade signatures/default expressions/async flags and `buildHeaders` body against `710892ac`; all 14 leaf declarations; and all 19 moved operation bodies with only the permitted receiver substitution.

### Durable sweep evidence

| Surface | Classification and evidence |
|---|---|
| Graph source and service catalog | **AGREE / VERIFIED via current source and AST inventory.** The catalog lists the facade and physical Graph owners, including `upload-session.js`; Graph owns its transport and is outside the Dataverse interlock. |
| `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` | **STALE sentence corrected.** The exact claim that Graph uses the Dynamics HTTP helper now identifies Graph's separate transport and the interlock's Dataverse scope. |
| Telemetry catalog | **AGREE / unchanged.** Its two transport telemetry references are accurate and were not treated as an interlock claim. |
| Consumer manifest | **HISTORICAL S0 baseline, dated 2026-09-19.** Its 124-file/233-match count is labelled baseline scope, not a current runtime inventory. |
| Decomposition plan | **HISTORICAL stage specifications reconciled.** Current top status, section headings, implementation summary, recommendation table context, and tail identify S0–S11 as accepted locally and promotion as blocked. |
| `SESSION_PROMPT.md` | **ROOT-OWNED handoff.** Root records local completion and the same release boundary separately from the stage commit. |
| External environment, campaign window, last-known-good deployment, rollback operator | **UNKNOWN.** No live probe or external-state claim was made. |

### Required gates and exact results

The full Jest command was:

```text
npm test -- --runInBand --silent
```

It passed **984 suites / 14,482 tests / 1 snapshot**, exit 0, in 140.258 seconds. The accepted log is `/private/tmp/wmkf-graph-decomposition-logs/s11-full-jest.log`. This is compared with the S0 baseline of 984 suites / 14,480 tests: one test was added during S7 and one S11 inventory test was added here.

The complete 37-suite named consumer command (Graph, lifecycle, artifact-version-history, document lifecycle, applicant/consultant attachments, external materials, upload/replacement/review-upload/cleanup/drain, and the real-facade bridges) passed **37 suites / 607 tests / 1 snapshot**, exit 0. Reproduction uses the complete 37-path consumer command recorded in the S0 test matrix above. The result summary is in `/private/tmp/wmkf-graph-decomposition-logs/s11-consumer-manifest.log`.

Sequential configured gates passed:

```text
npm run check:types                         EXIT 0
npm run lint                                EXIT 0
npm run build                               EXIT 0
all current check:* parents plus immediate self-tests, sequentially: 67 commands, EXIT 0
```

Logs are `/private/tmp/wmkf-graph-decomposition-logs/s11-check-types.log`, `s11-lint.log`, `s11-build.log`, and `s11-all-checks.log`. `git diff --check` passed. The S0 mutation runner was not rerun because its source anchors are baseline-specific.

After the canonical build, the existing fully mocked Mode A browser check ran against a local `next start` server with `NEXTAUTH_SECRET=e2e-throwaway-nextauth-secret-32-chars`, `NEXTAUTH_URL=http://localhost:3198`, and `E2E_PORT=3198`:

```text
npx playwright test tests/e2e/workbench-responsiveness.spec.js --project=chromium --reporter=line
```

It passed **3 tests**, exit 0, in 1.6 seconds. The server log records missing Postgres/Azure credentials while the app enforced auth; no external provider or live route was used. The first restricted-shell attempt was blocked before page execution by the host Chromium `MachPortRendezvousServer` permission boundary; the same test passed outside that boundary. Evidence: `/private/tmp/wmkf-graph-decomposition-logs/s11-modea-browser-escalated.log` and the initial bounded failure log `/private/tmp/wmkf-graph-decomposition-logs/s11-modea-browser.log`.

### Five Mode A journeys and release limits

1. **History and stale-request handling:** `tests/unit/artifact-version-history.test.js`, `tests/unit/document-lifecycle-boundary.test.js`, `tests/unit/graph-service-versions.test.js`, and the Initial Assessment artifact/version/control/route suites passed. Consumer suites use mocked dependencies; the dedicated Graph suites and `graph-service-consumer-contract.test.js` provide the real-facade transport bridge. Browser stale-request rendering remains outside these mocked checks.
2. **Downloads and review bytes:** `tests/integration/review-manager-download-review.test.js`, `tests/unit/individual-review-file-service.test.js`, `tests/unit/workbench-download-proposal-document-service.test.js`, `tests/unit/review-upload.test.js`, and `tests/unit/graph-service-downloads.test.js` passed. Browser byte/content-header behavior remains unproven for live storage.
3. **External uploads and registry identity:** `tests/unit/site-visit-materials-contributor-service.test.js`, `tests/unit/external-materials-routes.test.js`, `tests/unit/external-materials-routes-client.test.js`, `tests/unit/consultant-feedback-attachment-service.test.js`, `tests/unit/grantee-upload-service.test.js`, `tests/unit/grantee-replace-submission-service.test.js`, `tests/unit/graph-service-upload-large.test.js`, `tests/unit/graph-service-write-contract.test.js`, and `tests/unit/graph-service-consumer-contract.test.js` passed with mocked seams; the dedicated real-facade bridge additionally asserts exact request counts and registry identity. Real user/registry replay was not live.
4. **Restore and publication identity:** `tests/unit/initial-assessment-controls-service.test.js`, `tests/unit/artifact-version-history.test.js`, `tests/unit/graph-service-versions.test.js`, and `tests/unit/graph-service-write-contract.test.js` passed. Tenant-level restore rehearsal was not performed.
5. **Search throttle and incomplete response:** `tests/unit/dynamics-explorer-search-documents.test.js`, `tests/unit/dynamics-explorer-chat-characterization.test.js`, `tests/unit/graph-service-search-retry.test.js`, and `tests/unit/graph-service-consumer-contract.test.js` passed. No live browser/provider throttle loop was run.

The available browser check covers mocked Workbench responsiveness only; no existing E2E harness covers all five Graph journeys. Browser live-provider, SharePoint, Dataverse, external-user, and Tier 2 campaign rehearsals remain uncovered. No approved external environment, campaign window, last-known-good deployment, or rollback operator was supplied, so those facts remain **UNKNOWN**. Local migration is complete and accepted by root; release remains blocked until the owner decision and approved rehearsals exist. No live probe, deploy, push, merge, or promotion was performed.

### Blocked promotion packet — plan §6

| Required field | Recorded state / action before promotion |
|---|---|
| Branch and candidate head | `codex/graph-service-decomposition`; accepted S11 code/test checkpoint `76cfbbcb` (parent `7bf1ce2d`). The final handoff commit is documentation-only. Resolve and record the exact branch HEAD and verify a clean tree again at any later promotion. |
| Approved rehearsal mode | Only local Mode A synthetic/mocked verification was authorized and run. Any external rehearsal mode and its authorization remain **UNKNOWN / REQUIRED**. |
| Approved environment and fixtures | **UNKNOWN / REQUIRED**: name the SharePoint tenant/site/library, synthetic files, Dataverse and other affected targets, actors, and cleanup owner. An isolated Dataverse target does not isolate Graph. |
| Expected side effects | **UNKNOWN until a specific rehearsal is approved**. Enumerate expected uploads, versions/restores, replacements/deletes, registry writes, and any downstream effects for the chosen journeys; record before/after identities. The local verification here caused no remote file or registry writes. |
| Campaign window and promotion approval | **UNKNOWN / REQUIRED**: owner must choose timing and explicitly approve release after the required staff/external Tier 2 evidence is complete. |
| Last-known-good deployment and rollback operator | **UNKNOWN / REQUIRED**: record the exact deployment/commit and named operator before promotion. Prior-session deployment records are not current evidence for this release. |

Release is **BLOCKED** until these fields and required rehearsals are resolved.
After a future release, rollback first restores the recorded previous deployment,
then reconciles files, versions, and downstream receipts produced during the
release interval. Code rollback does not reverse persisted state. Never delete
uploaded files or version history automatically as part of rollback. Before any
release, revert the rejected local stage and rerun G against its accepted predecessor.

### Accepted history and rollback

Accepted stage commits: S0 `546efff8`, S1 `77e94c0d`, S2 `7ff2f90f`, S3 `2addf72a`, S4 `c20b6538`, S5 `ac4a03b4`, S6 `0f5c90db`, S7 `4c6191d6`, S8 `c8bf1848`, S9 `1dad580e`, and S10 `7bf1ce2d`. S11 is accepted in `76cfbbcb`. Its local rollback point is `7bf1ce2d`; any rollback must preserve unrelated work and rerun G before continuing. Code rollback does not undo any external state; no external state was changed by this local run.

Fresh Sol review **`sol_s11`** accepted the S11 source/test closure and, after inspecting the completed evidence, accepted the final receipt and blocked-promotion packet with no material finding. Root's independent parity and forwarding checks are recorded above. Root completed final review and accepts S11. No unresolved local source or gate finding remains; external rehearsals and promotion remain separate owner-controlled work.

## Post-Opus verification-tool follow-ups — current

Status: **[ACCEPTED LOCALLY — RELEASE STILL BLOCKED]**. Claude Opus 5 reviewed candidate `f6eb06d2` through the OAuth/subscription CLI and returned ACCEPT with two optional tooling findings. The owner explicitly authorized those two follow-ups. Luna implemented them, fresh Sol `sol_followups` accepted the final changes, and root completed source/log review. The review transcript is retained locally at `/private/tmp/graph-opus-review-f6eb06d2/REVIEW.md`; Opus did not review these subsequent edits.

### Contract and bounded invariants

Change surface: mutation proof runner and static boundary tests only. Entry points are `node scripts/run-graph-service-s0-mutations.mjs` and the Graph boundary Jest suite. Persistence is disposable local files, removed in `finally`; no application state is written. Consumers are local verification and Jest. Runtime, public contracts, callers, dependencies, and release conditions are unchanged. **[VERIFIED via diff against `f6eb06d2`]** UI/request/persistence contracts, durable schema, and remote partial-success audits are N/A for this tooling change.

| Invariant | Implementation and evidence |
|---|---|
| Mutation proof works against the current decomposition without editing tracked runtime. | Runner copies the facade and every Graph module into a fresh temporary directory for each control/mutant, preserves relative layout, and links existing utility/observability dependencies. Unique directories isolate Graph module state. `finally` removes the copies and restores fetch and the three fixture environment fields. |
| A failure counts only when it proves the named invariant. | Every unchanged control must pass. Each mutant must fail with `ERR_ASSERTION` and its exact case marker; import errors and unrelated failures reject the run. All seven control/mutant pairs passed. Receiver mutants bypass the subclass through its base class rather than adding a forbidden internal facade import. |
| Variable-bound function owners cannot evade duplicate ownership checks. | Analyzer counts identifier declarations initialized with arrow or function expressions. Fixtures accept exported-arrow and local-function-expression sole owners, then reject duplicate owners. Other variable declarations remain state inventory entries. |
| Explicit global fetch calls remain confined to the HTTP owner. | Analyzer rejects bare `fetch`, `globalThis.fetch`, and literal `globalThis["fetch"]` calls outside `graph/http.js`. Fixtures reject both global forms outside the owner and accept the owner's global call. This is bounded syntax detection, not general alias or dynamic-property analysis. |

### Verification and reconciliation

- `node scripts/run-graph-service-s0-mutations.mjs`: **7 controls passed / 7 mutants rejected by named assertions**. Log: `/private/tmp/wmkf-graph-decomposition-logs/followups-mutations.log`.
- `npx jest --runInBand tests/unit/graph-service-*.test.js`: **13 suites / 189 tests passed** before the ownership fixture expansion. Log: `/private/tmp/wmkf-graph-decomposition-logs/followups-graph-tests.log`.
- Final affected rerun, `npx jest --runInBand tests/unit/graph-service-boundary.test.js`: **29 tests passed**. Log: `/private/tmp/wmkf-graph-decomposition-logs/followups-boundary.log`.
- Seven sequential document/security checks passed: doc-currency and self-test, fact-consistency and self-test, docs-catalog, secret-scan and self-test. Log: `/private/tmp/wmkf-graph-decomposition-logs/followups-doc-gates.log`.
- Scoped ESLint and `node --check` passed on the three changed source/test files; `git diff --check` passed. Full Jest/build evidence above remains the S11 checkpoint evidence and was not rerun for this tooling-only follow-up.

Scoped `/sweep` Mode A searched runner and baseline-specific claims across the plan, execution receipt, source/tests, session handoff, memory, and wiki. Prior stage statements are historical evidence under the explicit S0–S11 boundary; the S0 runner paragraph now directs current use here. The plan's original S0 mutation requirements remain historical specifications. No remaining live stale claim was found within this bounded scope. The analyzer remains deliberately limited; this follow-up does not claim complete JavaScript dataflow analysis. Promotion remains blocked by the unchanged S11 packet.
