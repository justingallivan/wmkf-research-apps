# GraphService decomposition execution receipt — 2026-09-19

Status: **[S0 ACCEPTED — S1 NEXT]**. Root accepted the tests-only freeze after Sol review, full G and final diff audit. User authorization covers all local stages; S1 may begin from the accepted S0 commit. No push, deployment or live rehearsal is authorized.

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

The disposable source-copy runner is `scripts/run-graph-service-s0-mutations.mjs`. It copies the monolith to a temporary sibling, loads that copy with its real relative dependencies, exercises a characterization scenario, and deletes the copy in `finally`; the tracked runtime is never edited. The required mutants are token-generation fence, CDN bearer forwarding, continuation-404 salvage, upload receiver dispatch, download receiver dispatch, replacement If-Match, and chunk-failure propagation. Run `node scripts/run-graph-service-s0-mutations.mjs` against the S0 checkout to reproduce this proof; later extractions change its source anchors. The accepted log is `/private/tmp/wmkf-graph-decomposition-logs/s0-mutations-final.log`: seven unmodified controls passed and seven mutants failed their named assertions. Sol and root verified the corrected runner and log. The earlier catch-all runner output was rejected and is not acceptance evidence.

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
