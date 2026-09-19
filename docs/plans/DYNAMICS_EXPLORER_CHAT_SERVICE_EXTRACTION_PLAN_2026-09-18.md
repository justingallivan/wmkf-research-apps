---
title: Dynamics Explorer Chat Service Extraction Plan
domain: dataverse
kind: plan
status: draft
summary: Proposed staged extraction of the 2,983-line Dynamics Explorer chat route into a service layer so the route dir can leave the Route→Service law exemption; implementation is not authorized.
canonical: false
owner: product-engineering
related:
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md
  - docs/CI_GATES_REFERENCE.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Dynamics Explorer chat: extract the tool engine from the route

## 1. Decision and authorization boundary

**[PLANNED] Recommendation:** move the Dynamics Explorer tool engine out of
`pages/api/dynamics-explorer/chat.js` into a new `lib/services/dynamics-explorer/`
module family, leaving the route as the thin shell every other API route already
is. Then remove `pages/api/dynamics-explorer/` from the Route→Service law
exemption. Behavior is byte-identical: same SSE events, same tool schemas, same
restriction enforcement, same Postgres writes, same model calls, same prompt.

**Why this is the largest unplanned refactor.** The Route→Service Consolidation
Plan reached law mode at Stage 7. Its own baseline table carried two route
directories over as permanent exemptions rather than converting them
[VERIFIED via `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:55`]. One of those,
`pages/api/dataverse-export/`, already has its service layer
(`lib/services/dataverse-export/`). The other, `pages/api/dynamics-explorer/`,
does not: its `chat.js` is the largest API route in the repository at 2,983
lines [VERIFIED via `wc -l` over `find pages/api -name '*.js'`; the next largest
API file is under 1,600 lines], and holds eleven tool implementations, entity
resolution, relationship traversal, SharePoint search with a per-request circuit
breaker, Excel export, AI batch processing, restriction enforcement, and three
Postgres tables' access. None of the 160 plan documents proposes decomposing it
[VERIFIED via `grep -l 'chat.js' docs/*PLAN*.md docs/plans/*.md`: five hits,
each about bypass stripping, chunk loops, telemetry, or prompt behavior].

**[OWNER DECISION 2026-09-18]** After planning checkpoints P1 to P3, the owner
authorized execution of stages S0 through S9 on a feature branch, chose §3.4
option (a) for the OData-escape gate, and directed that this plan document land
on `main` as Tier 0 documentation. No live data probe, provider call, or
deployment is authorized by this document, and the Preview smoke and merge
remain the owner's actions. Treat the release as
**Tier 1** under the campaign release strategy, whose definition names "an
internal refactor with a stable public contract" and requires a short-lived
branch, automated tests, a preview deployment where useful, review of the final
diff, and a deliberate merge [VERIFIED via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:112-117`]. A route
rewrite that carries restriction enforcement is not Tier 0 even though behavior
is intended to be identical. Promotion needs a signed-in Explorer smoke on a Preview deployment.
Do not push runtime stages directly to `main`.

### What a user should notice

Nothing. This is a structural change. The measurable outcomes are internal:

- `check:route-service-boundary` runs with no exempt route directory for the
  Explorer.
- A change to one Explorer tool touches one file of a few hundred lines instead
  of a 3,000-line route.
- Each tool has a direct unit-test seam that does not require mocking the whole
  Dataverse, Graph, Excel, and auth chain at import time.

### Alternatives considered

| Candidate | Evidence | Decision |
|---|---|---|
| `pages/api/dynamics-explorer/chat.js` service extraction | 2,983 lines; only route in an exempt dir with no service layer; sibling routes are already clean | Selected |
| `pages/admin.js` decomposition | 3,536 lines, but 17 sections already live in `shared/components/admin/`; UI-only, Tier 0, no gate law is violated | Smaller follow-on; not selected |
| Reviewer-suggestion adapter and Graph service monoliths | Owned by the Data Access Layer and Dynamics Service decomposition plans; headers read only [NOT-READ: lib/dataverse/adapters/reviewer-suggestion.js — header only, out of scope] [NOT-READ: lib/services/graph-service.js — header only, out of scope] | Already planned; excluded |
| Legacy pages folding into the Workbench (`virtual-review-panel`, `expertise-finder`) | Adjacent to the in-flight Workbench responsiveness plan and its client surfaces | Excluded to avoid overlapping surfaces |
| `pages/api/dataverse-export/` exemption removal | Has `lib/services/dataverse-export/`; the four routes total 557 lines | Same pattern, separate small follow-on; excluded here |
| Rewrite the Explorer tool set or prompt | Active behavior campaign owns the prompt and eval harness | Excluded; this plan changes no prompt or tool schema |

## 2. Source baseline and evidence ledger

Planning baseline: `2e611d9a42fd51f065da72a59e653500b5ae10da` (`main`, clean
tree, one commit ahead of `origin/main`), inspected 2026-09-18 PT. Anchors refer
to that tree; re-resolve every anchor at each stage.

| ID | Verified mechanism | Evidence |
|---|---|---|
| E1 | The route file is 2,983 lines; sibling routes are 99 to 110 lines and none imports `dynamics-service` or an adapter | `wc -l pages/api/dynamics-explorer/*.js`; `grep -l 'dynamics-service\|dataverse/adapters' pages/api/dynamics-explorer/*.js` → only `chat.js` |
| E2 | The Route→Service boundary gate is law mode with `pages/api/dynamics-explorer/` and `pages/api/dataverse-export/` as the only exempt route dirs; its self-test uses the Explorer dir as a green fixture | `scripts/check-route-service-boundary.js:61-63,119-120,551,602`; `scripts/check-route-service-boundary-self-test.js:93,97,268,287` |
| E3 | The Dataverse access-layer gate exempts the Explorer route dir and, by file, `lib/services/dynamics-explorer-taxonomy.js` with the rationale "sole importer is chat.js"; `lib/services/dataverse-export/` is the precedent for an exempt service dir | `scripts/check-dataverse-access-layer.js:66-80` |
| E4 | The dynamics-context boundary gate forbids `withDynamicsContext` with non-literal restrictions everywhere except under `pages/api/dynamics-explorer/`; `withDalContext` is a bypass wrapper and cannot replace the Explorer's loaded-restrictions context | `scripts/check-dynamics-context-boundary.js:30-37,77`; `lib/dataverse/core/context.js:46-53`; `lib/services/dynamics-context.js:48-59` |
| E5 | The model-override warming gate requires an awaited `loadModelOverrides()` in any route that reaches `getModelForApp` directly or through a repo-local import | `scripts/check-model-override-warming.js:19-28`; current warm at `chat.js:185` |
| E6 | The A7 prompt-injection registry pins two Explorer surfaces to `pages/api/dynamics-explorer/chat.js` as `callSiteFiles`; the preamble and wrap sites are at `chat.js:199,343` (chat) and `chat.js:2506,2514,2561,2599` (export batch) | `scripts/check-prompt-injection-tagging.js:292-298,336-341` |
| E7 | The route handler owns auth, rate limit, SSE writer, body validation, request id, abort controller, disconnect classification, lifecycle telemetry, model warm, role and restriction load, `withDynamicsContext`, the agentic loop, and top-level failure copy | `chat.js:87-413` |
| E8 | Tools emit SSE events directly through the `sendEvent` closure: `document_links` (list and search), `export_progress`, `file_ready`, `thinking` (blocked tool); the client switches on exactly eight event names | `chat.js:751,763,2444,2651`; `pages/dynamics-explorer.js:263-343` event switch |
| E9 | Two restriction layers exist and differ: a local pre-execution string guard over `table_name`, `select`, `field`, `group_by`, `$expand` (`checkRestriction`), and the ALS fail-closed read guard inside `DynamicsService`. The local guard never inspects `$filter`; the OData validator covers that | `chat.js:2870-2917`; `lib/services/dynamics-service.js:14`; `tests/integration/dynamics-explorer-tool-serialization.test.js:795,983` |
| E10 | Three Postgres helpers live in the route: `getUserRole` (fail-soft to `read_only`), `getActiveRestrictions`, and `logQuery` with a correlated insert and a `42703` column-missing fallback to the uncorrelated shape | `chat.js:2956-2983` |
| E11 | `roles.js` and `restrictions.js` read the same tables with different semantics (admin CRUD, not the chat's fail-soft read) | `pages/api/dynamics-explorer/roles.js:37,70,92`; `restrictions.js:36,66-78,99` |
| E12 | A 41-case route-level harness imports the handler and mocks by module path: rate limiter, model overrides, baseConfig, prompt module, dynamics-service, taxonomy, telemetry, dynamics-context, graph-service, sharepoint-buckets, llm-client, exceljs; `@vercel/postgres` is mocked by `tests/helpers/auth-mock.js` | `tests/integration/dynamics-explorer-tool-serialization.test.js:9-124` |
| E13 | Three unit tests couple to the route file's shape: one reads the file as text and slices `async function callClaude(` to the next `\n// ───` marker; two import `searchDocuments` and `deriveRecordCount` from the route | `tests/unit/dynamics-explorer-call-config.test.js:1-24`; `tests/unit/dynamics-explorer-search-documents.test.js:60`; `tests/unit/dynamics-explorer-record-count.test.js:31` |
| E14 | The export batch loops at `chat.js:2547-2660` are a coupled pair that a prior plan chose to leave together | `docs/CHUNK_CONSOLIDATION_PLAN.md:204,211` |
| E15 | The route file has seventeen section markers that already partition it into the module boundaries below | `grep -n '^// ───' chat.js` → lines 415,470,499,596,641,920,951,1159,1364,1506,1922,2050,2311,2470,2728,2868,2956 |
| E16 | Two docs cite the route path by behavior and will need path updates when the behavior moves: the AI-run Atlas page and the route security matrix row | `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md:69`; `docs/API_ROUTE_SECURITY_MATRIX.md:177` |
| E17 | The OData-escape gate scans `lib/` and exempts only `pages/api/dynamics-explorer/`; one hand-rolled escape survives inside `getEntity` only through that exemption | `scripts/check-odata-escape.js:44,57-59,65,101`; `chat.js:1253`; self-test exempt fixture `scripts/check-odata-escape-self-test.js:105-107,150` |
| E18 | Terminal ordering today is finalize first, then `response` and `complete`; `errorStage` starts as `'context'` and stays so for taxonomy, prompt-build, and trim failures; `'context'` is a real stored value | `chat.js:131,198-202,257-268,389-392`; `lib/services/dynamics-explorer-request-telemetry.js:21,97` |
| E19 | `exportCsv` and `callClaudeBatch` call `getModelForApp` directly; the warming gate's transitive rule covers them through the route's awaited warm | `chat.js:2379,2479`; `scripts/check-model-override-warming.js:19-23` |
| E20 | `getEntity` calls `DynamicsService.searchRecords` for name lookups (a service method, not the local `searchRecords` tool, whose only caller is `executeTool` at `:673`), `getRelated` calls `getEntity` and reads `ENTITY_TYPE_CONFIGS`, and `lastModel` is first written after prompt build and before round 1 | `chat.js:1273,673,2783,1371,1377,218,244-246`; `errorStage` writes inside the loop at `chat.js:227,272` (the `:175` write is the route-owned API-key path) |
| E21 | The harness mocks `GraphService` and `exceljs` as empty objects, so `document_links`, `export_progress`, and `file_ready` are never emitted under its default mock set | `tests/integration/dynamics-explorer-tool-serialization.test.js:104,118`; `chat.js:2678` |

**[VERIFIED via local commands]** Every `check:*` script enumerated from
`package.json` (`grep -o '"check:[a-z0-9:-]*"' package.json | sort -u`, 67
entries) was run sequentially at the baseline and exited 0. The 12
Explorer-related Jest suites in §9 passed: **151 tests in about 2 seconds**. No
new test or runtime code was written for this plan. No application build was
run for this plan.

### Contract trace

Caller: `pages/dynamics-explorer.js` POSTs `{messages, sessionId}` and consumes
an SSE stream. Route: method check → `requireAppAccess('dynamics-explorer')` →
rate limit → SSE headers → body validation → lifecycle start row → model warm →
role and restriction reads → `withDynamicsContext({restrictions, requestId})` →
agentic loop (model call, local restriction guard, OData validator, tool
execution, A7 wrapping, per-tool query log, compaction) → terminal event and
lifecycle finalize. Persistence [VERIFIED via `chat.js:2956-2983` and the
security matrix row]: reads `dynamics_user_roles` and `dynamics_restrictions`;
writes `dynamics_query_log`, `dynamics_explorer_requests` (telemetry module),
and `api_usage_log` (LLM client). Reads Dataverse through `DynamicsService` on
arbitrary tables and SharePoint through `GraphService`. Excel bytes go to the
client as base64 in a `file_ready` event [VERIFIED via `chat.js:2440-2452`;
`grep '@vercel/blob' chat.js` returns nothing]; the matrix row's "export to
Blob" wording is stale and is corrected at S9.

**[PLANNED] Persistence change: none.** No table, column, migration, Atlas
ownership, or route path changes.

## 3. Target contract, freeze before implementation

### 3.1 Scope law

- **Pure move, byte-identical behavior.** Extract each logical region verbatim,
  update imports, delete the old copy in the same commit. The precedent is the
  header of `lib/dataverse/core/odata.js`: extracted verbatim; characterization
  tests are the safety net.
- **No prompt edits.** `shared/config/prompts/dynamics-explorer.js` belongs to
  the active behavior campaign. Do not touch it.
- **No telemetry, serializer, taxonomy, or validator edits.** The four existing
  extracted modules stay as they are.
- **No tool-schema, restriction-semantic, event-name, payload-shape, model,
  token, effort, or rate-limit changes.** If a stage needs one, stop and re-scope.
- **Two restriction layers stay two.** The local guard and the ALS guard are
  preserved as separate mechanisms. The `$filter` gap in the local guard is
  pre-existing and is not fixed by this plan; record it, do not widen scope.
- **The route keeps `withDynamicsContext` with loaded restrictions.** It is the
  only sanctioned caller of that shape (E4). Do not move it into a service and
  do not replace it with `withDalContext`, which would run the Explorer under an
  empty restriction set.
- **The route keeps `await loadModelOverrides()`** before any model resolution
  (E5). Model resolution for the loop stays where it is today, inside the moved
  region at `chat.js:216-218`, after the taxonomy block, prompt build, trim, and
  the first `thinking` event; the warming gate's transitive rule covers a
  resolver reached through a repo-local import (E5). Moving resolution into the
  route would change the event sequence when `getModelForApp` throws, so do not.
  `exportCsv` and `callClaudeBatch` keep their own direct calls (E19). Do not thread a model into export to "fix" this; that is scope.
- **Two law-gate exemptions relocate, they are not eliminated.** The Explorer
  reads arbitrary tables, so no entity adapter can exist; the new service dir
  therefore needs the same Dataverse access-layer exemption the route dir has
  today, and the same OData-escape exemption unless the owner chooses the
  one-line escape swap in §3.4. §1's measurable outcome is that the *route*
  gate has no exemption. This relocation is an owner choice, presented in §3.4,
  not a settled mechanism.

### 3.2 Module map (all paths **new**)

Directory: `lib/services/dynamics-explorer/`. Each file carries the standard
source header naming its owner, contract, and the route section it came from.

| Module | Moves from `chat.js` region | Exports | Depends on |
|---|---|---|---|
| `failure-copy.js` | 415–498 | `describeChatFailure`, `detectPossibleFailure` | nothing |
| `conversation.js` | 499–595 | `trimConversation`, `compactMessages`, `summarizeToolResult` | nothing |
| `result-shaping.js` | 69, 74–86, 648–669, 798–919, 2936–2955 | `MAX_RESULT_CHARS`, `TOOL_CHAR_LIMITS`, `OPERATIONAL_LOG_TABLES`, `sanitizeSelect`, `applyActiveOnlyFilter`, `isOperationalLogTable`, `stripEmpty`, `truncateResult`, `deriveRecordCount`, `getThinkingMessage` | nothing |
| `restriction-guard.js` | 926–950, 2870–2935 | `checkRestriction`, `splitChatExpandSegments`, `restrictedFieldsForTable`, `redactRestrictedFieldNames` | nothing |
| `tool-errors.js` (moves at S5, after `get-entity`) | 777–797, 951–1046 | `validateEffectiveODataCall`, `validatorReject`, `classifyToolError`, `closestFieldNames` | `dynamics-odata-validator`, `DynamicsService` (metadata reads), prompt module `TABLE_ANNOTATIONS`, `result-shaping`, `restriction-guard`, `tools/get-entity` for `ENTITY_TYPE_CONFIGS` (`chat.js:788`) |
| `explorer-store.js` | 2956–2983 | `getUserRole`, `getActiveRestrictions`, `logQuery` | `@vercel/postgres` |
| `model-call.js` | 596–640, 2476–2498 | `callClaude`, `callClaudeBatch` | `LLMClient`, `baseConfig` (`getModelForApp`, `chat.js:2479`) |
| `tools/describe-table.js` | 920–925 (marker and orphaned JSDoc), 1047–1158 | `describeTable` | `DynamicsService`, prompt module annotations, `restriction-guard`, `result-shaping`, `dynamics-odata-validator` |
| `tools/get-entity.js` | 1159–1363 | `getEntity`, `ENTITY_TYPE_CONFIGS` | `DynamicsService`, `result-shaping` (`stripEmpty`) |
| `tools/get-related.js` | 1364–1921 | `getRelated`, `resolveEntity`, relationship handlers | `DynamicsService`, `tools/get-entity` (`getEntity`, `ENTITY_TYPE_CONFIGS`) |
| `tools/documents.js` | 1922–2310 | `listDocuments`, `searchDocuments` | `GraphService`, `sharepoint-buckets`, `DynamicsService`, `tools/get-entity` (`chat.js:1949,2139`) |
| `tools/export.js` | 2311–2469, 2661–2727 | `exportCsv`, `generateExcelExport`, `recordsToExcel`, `cleanColumnName` | `ExcelJS`, `DynamicsService`, `batch-processing`, `tool-errors`, `result-shaping`, serializer, `getModelForApp`, `estimateCostCents` |
| `tools/batch-processing.js` | 70–73 (`DYNEXP_EXPORT_MAX_CHARS`), 2499–2660 | `runSampleProcessing`, `processRecordsBatch` | `model-call`, `ai-payload-boundary`, serializer |
| `tools/composite.js` | 2728–2867 | `findReportsDue`, `searchRecords` | `DynamicsService`, `result-shaping` |
| `tool-executor.js` | 670–776 | `executeTool` (inline `query_records`, `count_records`, `aggregate` at 695–739) | every `tools/*`, `tool-errors`, `result-shaping` (`sanitizeSelect`, `applyActiveOnlyFilter`, `stripEmpty`), `DynamicsService` |
| `chat-session.js` | 68 (`MAX_TOOL_ROUNDS`, moved with the loop; not a parameter), 192–392 (the callback body inside `withDynamicsContext`) | `runExplorerChat` | `model-call`, `tool-executor`, `restriction-guard`, `conversation`, `result-shaping`, `explorer-store`, `failure-copy` (`detectPossibleFailure`, `chat.js:268`), `tool-errors` (`classifyToolError`, `chat.js:305`), `baseConfig` (`getModelForApp`, `getFallbackModelForApp`, `chat.js:216-217`), serializer, `ai-payload-boundary`, prompt builder, taxonomy |

Marker-only or comment-only lines 641–647, 2470–2475, and 2868–2869 move with
the region that follows them; line 414 is blank. Every other line of the
baseline file is assigned exactly once above or to the shell.

The route shell keeps lines 1–67, 87–191, and 393–413 in substance: imports, method dispatch,
auth, rate limit, SSE writer, body validation, request id, abort controller,
disconnect classification, lifecycle start and finalize, API-key check, model
warm, role and restriction reads, `withDynamicsContext`, the
outer catch that maps an error to `describeChatFailure`, and the `finally` that
detaches listeners and ends the response.

Dependencies point route → `chat-session` → `tool-executor` → `tools/*` →
leaf helpers, with one declared exception: `tool-errors` imports
`ENTITY_TYPE_CONFIGS` from `tools/get-entity`, which is why it moves at S5.
No tool imports another tool except `get-related` and `documents` importing
`get-entity` (E20). No module under `lib/services/dynamics-explorer/` imports a page,
a component, or another route. No barrel file.

### 3.3 Emitter and session contracts

Tools currently call the route's `sendEvent(event, data)` closure. Preserve the
exact signature and pass it down as a parameter named `sendEvent`; do not rename
it and do not introduce an event bus. The route owns the writer and its
`writableEnded`/`destroyed` checks. Event names and payload shapes are a client
contract (E8) and are pinned by the Stage 0 test:

| Event | Emitted by | Payload keys (unchanged) |
|---|---|---|
| `thinking` | route loop, blocked tool | `message` |
| `text_delta` | model call callback | `text` |
| `response` | loop terminal without stream, max rounds | `content` |
| `complete` | loop terminal, max rounds | `requestId`, `rounds`, `outcome`, `suggestFeedback`, optional `maxRoundsReached` |
| `error` | route | `message`, `requestId`, dev-only `details`; the body-invalid path at `chat.js:117` emits `message` only |
| `document_links` | list_documents, search_documents | `files`, optional `requestNumber` |
| `export_progress` | batch processing | `processed`, `total`, `failed` |
| `file_ready` | export | `base64`, `filename`, `recordCount`, `totalCount`, `capped`, `columns`, and the remaining keys at `chat.js:2444-2452` |

`runExplorerChat` signature (frozen at Stage 0, implemented at S8):

```js
runExplorerChat({
  messages, sessionId, userProfileId, userRole, restrictions,
  requestId, apiKey,   // model and fallbackModel are resolved INSIDE the service at the chat.js:216-217 position
  sendEvent, signal, isDisconnected, // isDisconnected(): boolean, read at the two points the loop reads disconnectObserved today (chat.js:221,369)
  onRoundComplete, // ({ round, model, stopReason }) => void; see firing positions below
  onStage,         // (stage) => void; called with 'model' at the position of chat.js:227
                   // and 'tool' at chat.js:272; the route assigns errorStage = stage
  onTerminal,      // async ({ outcome, rounds }) => void; the service MUST await it
                   // before emitting `response` or `complete` (E18 ordering)
})
// resolves { outcome: 'completed'|'truncated'|'refused'|'max_rounds', rounds } after onTerminal settled
// or resolves { outcome: 'client_disconnected' } when isDisconnected() is observed;
//   the route then awaits finalizeLifecycle('client_disconnected') itself, exactly as
//   chat.js:222,370 do today (the disconnect listener's own finalize also still fires,
//   so the count stays two, the pre-existing behavior)
// rejects with the ORIGINAL error object, never mutated; no property is added to it
```

`onRoundComplete` fires twice per round shape: once with
`{ round: 0, model, stopReason: null }` at the position of `chat.js:218`, after
prompt build and trim and before round 1, and once per round at the position of
`chat.js:244-246`, immediately after `callClaude` resolves and before restriction
checks or tool execution. The route's handler is exactly
`completedRounds = round; lastModel = model || lastModel; lastStopReason = stopReason;`
with the round-0 call updating only `lastModel`. Firing at the end of a round
instead would change `roundsUsed` and `stopReason` on a tool-stage error or on a
disconnect observed at `chat.js:369`. `errorStage` is state, not a wrapper: any
throw after `onStage('model')` and before `onStage('tool')`, including a malformed
provider response at `chat.js:247`, finalizes as `model` today and must still.

The route keeps `terminalIntent`, `disconnectObserved`, `completedRounds`,
`lastModel`, `lastStopReason`, and `errorStage` as its own variables. Inside
`onTerminal` the route sets `terminalIntent = true` and awaits
`finalizeLifecycle(outcome)`, exactly as `chat.js:257-258,389-390` do today, so
the Postgres finalize completes before the `complete` event is written. The
service never calls telemetry directly. The `onTerminal` and `onRoundComplete`
callbacks are the only non-verbatim code this plan
introduces, together with `onStage`; keep them that small.

### 3.4 Gate decisions, each a reviewed commit

| Gate | Change | When |
|---|---|---|
| `check:dataverse-access-layer` | Add `lib/services/dynamics-explorer/` to `EXEMPT_DIRS` with the `lib/services/dataverse-export/` precedent and the rationale "arbitrary-table explorer; no entity adapter can exist". Update the `dynamics-explorer-taxonomy.js` `EXEMPT_FILES` comment to name the new importer. Add a green fixture to the self-test. | S1, before any module that imports `DynamicsService` |
| `check:prompt-injection-tagging` | Change `callSiteFiles` for `dynamics-explorer-chat` to `['lib/services/dynamics-explorer/chat-session.js']` and for `dynamics-explorer-export` to `['lib/services/dynamics-explorer/tools/batch-processing.js']` in the same commit that moves each wrap site. Run the self-test. | S7 for export, S8 for chat |
| `check:dynamics-context-boundary` | No rule change. Update the header comment that cites `chat.js:124` to the shell's current line. | S8 |
| `check:model-override-warming` | No rule change. Route keeps the awaited warm. | verify every stage |
| `check:odata-escape` | **Owner choice, decide before S1.** (a) Add `lib/services/dynamics-explorer/` to `EXEMPT_DIRS` (`scripts/check-odata-escape.js:57-59`), update the header at `:15-16,55-57` which says the list mirrors the access-layer gate, and add a green fixture beside the existing exempt-dir fixture at `scripts/check-odata-escape-self-test.js:105-107,150`; a pure move. (b) Replace the one hand-rolled escape at `chat.js:1253` with `escape()` from `lib/dataverse/core/odata.js` as a deliberate one-line edit with a unit assertion that the produced `$filter` is identical for an identifier containing `'`; not a pure move, and must be its own commit. `escape()` coerces a non-string where today's call would throw; the tool schema types `identifier` as a string (`shared/config/prompts/dynamics-explorer.js:723`), so this is acceptable and must be stated in the commit. **Owner chose (a) on 2026-09-18.** | S1 for (a); S5 step before `get-entity` for (b) |
| `check:route-service-boundary` | Remove `pages/api/dynamics-explorer/` from `EXEMPT_ROUTE_DIRS`. Self-test: the exempt fixtures at `:94` and `:272` are already `dataverse-export`; move the Explorer fixtures at `:93,268` (adapter import) and `:97,287` (`chat-submodule.js`, the GREEN half of the S338 matcher-extension guard whose RED half is `:87,278-283`) to `pages/api/dataverse-export/` paths with the same imports, keeping both in `GREEN_ROUTES` so the guard and the count assertion at `:307-308` are unchanged; give the relocated fixtures names distinct from the existing `thing.js`. Update the gate header `:10-11`, the self-test header `:51-52`, and `docs/CI_GATES_REFERENCE.md:54`. | S9, last |

Never satisfy a gate with an env edit, an ignore marker, or a baseline file.

### 3.5 Test seams that break on move

Fix each in the same green commit as the move; do not leave re-exports on the
route shell to keep old imports alive.

- `tests/unit/dynamics-explorer-call-config.test.js` reads the route as text and
  slices by `async function callClaude(` and the `\n// ───` marker. Repoint the
  path to `model-call.js` and keep a `// ───` section marker after each function
  so the slicer still terminates.
- `tests/unit/dynamics-explorer-search-documents.test.js` imports
  `searchDocuments` from the route. Repoint to `tools/documents.js`. Its
  module mocks keep working because the new module imports the same paths.
- `tests/unit/dynamics-explorer-record-count.test.js` imports
  `deriveRecordCount` from the route. Repoint to `result-shaping.js` and change
  nothing else in that test.
- The 41-case harness and `tests/integration/auth-routes.test.js` import the
  handler and mock by module path (E12). They survive every stage unchanged
  because Jest module mocks are registry-wide. If a stage needs to edit the
  harness, that is a stop signal: the move changed a seam.

## 4. Prerequisite tests, Stage 0

Add `tests/unit/dynamics-explorer-chat-characterization.test.js` (**new**) and
`tests/unit/dynamics-explorer-restriction-guard.test.js` (**new**). Both must
pass against the unmodified route before any move. They are the discriminating
fixtures for every later stage.

Characterization, driven through the real handler with the E12 mock set:

1. **SSE event census.** For one scripted conversation that exercises
   `list_documents`, `search_documents`, `export_csv` with `process_instruction`
   **and `confirmed: true`** (an unconfirmed export returns the estimate at
   `chat.js:2351` and emits nothing), a blocked tool, and a final answer, assert the exact ordered sequence of
   `event:` names and the exact key set of each payload. Snapshot the joined
   `res.write` output after replacing the `requestId` value, which is
   `crypto.randomUUID()` at `chat.js:124`, with a fixed token; without that
   normalization the snapshot hash can never match. The harness's default
   mocks make `GraphService` and `exceljs` empty objects (E21), so this test
   must override them per test with a minimal `GraphService` stub, an
   `ExcelJS.Workbook` stub whose `xlsx.writeBuffer` returns a fixed buffer, an
   `LLMClient` override whose `complete` resolves `{ text: <JSON string>, usage:
   { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } }` (the
   batch path calls `complete`, `chat.js:2483`, and the harness mock exposes
   only `stream`), and `queryAllRecords` rows for the export.
   Label the stubs as S0 scaffolding; the base64 in `file_ready` is
   deterministic only under the stub, so the snapshot hash is defined only
   with it.
2. **Blocked tool path.** A restricted `table_name` yields a `thinking`
   `Blocked:` event, a `DENIED` tool result, and a `logQuery` call with
   `wasDenied: true` and the reason string.
3. **Tool throw path.** A tool that rejects is classified by `classifyToolError`
   and the `tool_result` keeps the original `tool_use_id`.
4. **Terminal outcomes.** `completed`, `truncated`, `refused`, `max_rounds`,
   `client_disconnected` mid-round, and `error` at each `errorStage`, each
   asserting the finalize call arguments exactly. The harness already covers
   truncated and refused (`:262-264`), max_rounds (`:284`), abort during the
   model call (`:327`), and error at stage `model` (`:1403`). Add:
   - **4b, finalize-before-complete ordering.** Mock `finalizeRequest` with a
     deferred promise; assert no `event: complete` write occurs until it
     resolves. This is the discriminating test for the §3.3 `onTerminal` rule.
   - **4c, disconnect observed during tool execution.** Trigger the disconnect
     while a tool promise is pending so the polling check at `chat.js:369`
     fires, not the abort path. Script a second model response with final text
     so a service that drops the poll would produce `completed` and a
     `complete` event. Assert exactly two `client_disconnected` finalize calls
     (the listener's and the poll's, the pre-existing count), no other outcome,
     and no `complete` event.
   - **4d, error at stage `context`.** Reject `buildResolvedTaxonomyPromptBlock`;
     assert finalize is called with `errorStage: 'context'` and `model: null`.
   - **4e, error after the model call resolves.** Resolve the model stream with
     `content: undefined` so `chat.js:247` throws; assert `errorStage: 'model'`.
   - **4f, round-1 arguments.** A model rejection in round 1 finalizes with the
     resolved `model` and `roundsUsed: 0`. A disconnect observed at
     `chat.js:221` in round 1 produces two finalize calls: the listener's at
     `:153` with `model: null` and the loop's with the resolved `model`. Assert
     the full finalize objects with `toHaveBeenCalledWith`, not
     `objectContaining`.
   - **4g, tool-stage outer-catch error.** Ordinary tool rejections never reach
     the outer catch; use a restriction row with `table_name: null` plus an
     `$expand` input so the local guard throws at `chat.js:2895`, and assert
     `errorStage: 'tool'` with `roundsUsed` equal to the current round.
5. **`logQuery` fallback.** A `42703` rejection on the correlated insert issues
   the uncorrelated insert once; any other error warns once and does not retry.
   The `sql` mock comes from `tests/helpers/auth-mock.js:29-45`, keyed on query
   text and accepting an `Error` value: use
   `setMockSqlResults({ request_round: Object.assign(new Error('col'), { code: '42703' }) })`
   so only the correlated insert (`chat.js:2972`) matches, and flush with a
   `setTimeout(0)` as the harness does at `:362`.
6. **`getUserRole` fail-soft.** A rejected query returns `read_only`; use
   `setMockSqlResults({ dynamics_user_roles: new Error('x') })`.
7. **Model resolution order.** Mock `loadModelOverrides` with a deferred
   promise and assert zero `getModelForApp` calls before it resolves. After S8
   the resolver lives in another module, and the warming gate does not check
   ordering across function boundaries
   (`scripts/check-model-override-warming.js:24-27`), so this test becomes the
   only guard that `runExplorerChat` is not invoked before the awaited warm.

Restriction guard, pure unit (import `checkRestriction` from the route at S0;
repoint at S2):

8. Table-level block, field-level block via `select`, via `field` and
   `group_by`, via `$expand` navigation property, via nested `$select` in
   `$expand`, and the negative case that `$filter` is not inspected (pin the
   pre-existing gap so a later "fix" is a deliberate change).
9. `splitChatExpandSegments` with nested parentheses.
10. `redactRestrictedFieldNames` replaces every occurrence and leaves other text
    intact.

Known limit of the harness, carried into S0: its `getDynamicsContext` mock
returns `{ restrictions: [] }` (`tests/integration/dynamics-explorer-tool-serialization.test.js:101`),
so the ALS read guard inside `DynamicsService` is never exercised; S0 evidences
the local guard only. Do not claim otherwise in a receipt.

`checkRestriction`, `splitChatExpandSegments`, `restrictedFieldsForTable`, and
`redactRestrictedFieldNames` are not exported today [VERIFIED via
`grep -n '^export' chat.js`: only `config`, `handler`, `deriveRecordCount`,
`searchDocuments`]. S0 adds `export` to those four declarations with no other
change; that is the only S0 source edit.

Record the baseline: the 12 existing suites plus these two, test counts, and the
joined SSE snapshot hash in the execution receipt (**new**, created only during
implementation).

## 5. Ordered implementation stages

Every stage: prerequisite tests exist and pass on the unmodified code, then one
bounded implementation commit that moves the named region, deletes the original,
repoints imports and tests, and leaves every §9 check green. No stage begins
until the prior stage's receipt is accepted by a fresh-context review (§7).
"Move" means cut the region verbatim, paste under a source header, add imports,
and remove it from the route in the same commit. Never copy and leave two owners.

### S0, Characterize and freeze

**Before starting:** run §9 baseline; verify SHA, clean tree, and that no other
agent owns `pages/api/dynamics-explorer/` or `lib/services/dynamics-explorer/`.

**Add:** the two §4 test files and the two `export` keywords. **Exit:** both
suites green; SSE snapshot hash recorded; §3.3 signature and §3.2 module map
frozen in the receipt. No source moves.

### S1, Gate preparation

**Order:** (1) `scripts/check-dataverse-access-layer.js` `EXEMPT_DIRS` add plus
comment update for the taxonomy file; (2) self-test green fixture for a
`lib/services/dynamics-explorer/` file importing `DynamicsService`;
(3) run the gate then its self-test, sequentially; (4) if the owner chose
§3.4 option (a) for `check:odata-escape`, the same three steps for that gate in
a second commit.
**Exit:** both green; no runtime change. **Rollback:** revert the commit.

### S2, Leaf helpers

**Prerequisites:** S0 tests. **Order:** (1) `failure-copy.js`; (2)
`conversation.js`; (3) `result-shaping.js` and repoint the record-count test;
`MAX_TOOL_ROUNDS` stays in the route until S8 and `DYNEXP_EXPORT_MAX_CHARS`
until S7; (4) `restriction-guard.js` and repoint the new guard test to it.
`tool-errors.js` does **not** move here: it reads `ENTITY_TYPE_CONFIGS`
(`chat.js:788`), which moves at S5. One commit per file is acceptable; one
commit for all four is acceptable if every check is green.
**Exit:** route imports the four modules; no exported symbol remains defined in
both places (`grep -n 'function <name>' chat.js` returns nothing for each moved
name). **Rollback:** revert the commit, or the up-to-four commits, in reverse.

### S3, Postgres helpers

**Prerequisites:** S0 items 5 and 6. **Order:** move `explorer-store.js`.
**Helper-extraction audit:** `roles.js` and `restrictions.js` keep their own SQL
(E11). Do not collapse the chat's fail-soft `getUserRole` with the admin
route's CRUD reader; do not share `getActiveRestrictions` with the admin list
endpoint, whose ordering and columns may diverge later. **Exit:** the fallback
test passes against the new module path.

### S4, Model calls

**Prerequisites:** repointed call-config test written first and shown failing
against the old path. **Order:** move `model-call.js` with both functions and a
`// ───` marker after each. **Exit:** call-config test passes against the new
path; the route no longer imports `LLMClient`.

### S5, Read tools

**Prerequisites:** harness cases for `describe_table`, `get_entity`,
`get_related`, `search`, `find_reports_due` identified by name in the receipt.
**Order:** (0) if the owner chose §3.4 option (b), the one-line escape swap at
`chat.js:1253` as its own commit with its unit assertion; (1)
`tools/composite.js`, which references nothing later than S2; (2)
`tools/describe-table.js`; (3) `tools/get-entity.js`; (4) `tool-errors.js`, importing `ENTITY_TYPE_CONFIGS`
from `tools/get-entity`; (5) `tools/get-related.js` with every relationship
handler.
**Exit:** route no longer contains `ENTITY_TYPE_CONFIGS`, `VALID_RELATIONSHIPS`,
`classifyToolError`, or any `handle*` function; harness green;
`check:odata-escape` green without an ignore marker.

### S6, Document tools

**Prerequisites:** search-documents unit test repointed and shown failing
against the old path; harness throttle cases named. **Order:** move
`tools/documents.js` including `enqueueSearch`, the throttle helpers, and the
`searchDocuments` export. `sendEvent` is passed by the executor, not imported.
**Exit:** route no longer imports `GraphService` or `sharepoint-buckets`.

### S7, Export and batch processing

**Prerequisites:** S0 census items for `export_progress` and `file_ready`;
A7 registry edit prepared. **Order:** (1) `tools/batch-processing.js` keeping
the coupled loop pair together (E14) and its A7 wrap site; (2) update the
`dynamics-explorer-export` registry entry in the same commit; (3) `tools/export.js`.
**Exit:** route no longer imports `ExcelJS`; prompt-injection gate and self-test
green; `file_ready` payload keys unchanged in the census.

### S8, Dispatcher and session

**Prerequisites:** every prior stage accepted; S0 terminal-outcome cases; the
frozen §3.3 signature. **Order:** (1) `tool-executor.js`; (2) `chat-session.js`
implementing `runExplorerChat` by moving the loop body verbatim and replacing
direct lifecycle-variable writes with the callback and result described in §3.3;
(3) move the A7 preamble and wrap sites with it and update the
`dynamics-explorer-chat` registry entry; (4) reduce the route to the shell,
keeping `withDynamicsContext`, the awaited warm, and the `onTerminal`
finalize-before-`complete` ordering in place, with `onStage` and the two
`onRoundComplete` positions exactly as §3.3 states;
(5) update the dynamics-context gate header comment, which cites `chat.js:124`
while the call is at `:191` today.
**Exit:** normalized SSE snapshot hash from S0 is identical; every terminal
outcome test 4b through 4g passes; the route imports no
`DynamicsService`, `GraphService`, `ExcelJS`, `LLMClient`, or `@vercel/postgres`
(`grep -n "import" chat.js` is the check; line count is not a criterion). Run full Jest and `npm run build`.

### S9, Gate flip, docs, receipt

**Order:** (1) `check-route-service-boundary.js` exempt-dir removal and self-test
fixture swap; (2) `docs/CI_GATES_REFERENCE.md:54` wording; (3)
`docs/SERVICE_AND_UTILITY_CATALOG.md` entries for each new module; (4) Atlas line
`docs/atlas/dataverse-wmkf-ai-run-and-prompt.md:69` path update; (5) matrix row
`docs/API_ROUTE_SECURITY_MATRIX.md:177`: logic lives in the service dir, and the
pre-existing "export to Blob" wording is corrected to base64-to-client; (6) `/sweep` for any other
restatement, including the historical line anchors in
`docs/CHUNK_CONSOLIDATION_PLAN.md:204,211` and the carry-over row in
`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:55`; (7) full §9 gate run; (8) release
receipt with tier, Preview smoke evidence, and rollback deployment.
**Exit:** `check:route-service-boundary` green with no Explorer exemption;
`check:doc-currency`, `check:doc-symbol-refs`, `check:build-claim-freshness`,
`check:atlas`, `check:api-routes` green.

## 6. File move order

```text
S0  tests only (+ two export keywords)
S1  scripts/check-dataverse-access-layer.js (+ self-test fixture)
S1  scripts/check-odata-escape.js (+ self-test) if owner option (a)
S2  chat.js 415–498  → lib/services/dynamics-explorer/failure-copy.js
    chat.js 499–595  → conversation.js
    chat.js 69, 74–86, 648–669, 798–919, 2936–2955 → result-shaping.js
    chat.js 926–950, 2870–2935 → restriction-guard.js
S3  chat.js 2956–2983 → explorer-store.js
S4  chat.js 596–640, 2476–2498 → model-call.js
S5  chat.js 1253 escape swap if owner option (b), own commit
    chat.js 2728–2867 → tools/composite.js
    chat.js 920–925, 1047–1158 → tools/describe-table.js
    chat.js 1159–1363 → tools/get-entity.js
    chat.js 777–797, 951–1046 → tool-errors.js
    chat.js 1364–1921 → tools/get-related.js
S6  chat.js 1922–2310 → tools/documents.js
S7  chat.js 70–73, 2499–2660 → tools/batch-processing.js (+ A7 registry)
    chat.js 2311–2469, 2661–2727 → tools/export.js
S8  chat.js 670–776 → tool-executor.js
    chat.js 68, 192–392 → chat-session.js (+ A7 registry, context-gate comment)
S9  scripts/check-route-service-boundary.js (+ self-test), docs
```

Line numbers are the baseline's. After each stage they shift; re-resolve by the
`// ───` section markers, which move with their regions.

## 7. Fresh-context review protocol

**Reviewed content hash.** The reviewed content is §1 through §10 of this file.
Every receipt cites the SHA-256 of that region at review time, computed as
`sed -n '/^## 1\. /,/^## 11\. /p' <plan> | sed '$d' | shasum -a 256`. A
receipt-only edit changes §11 and does not need a new review; any edit above §11
does.

**Planning checkpoints:** P1 source census and scope; P2 target contracts, gate
decisions, and stage order; P3 final executable order and tests. Each uses a new
reviewer with no conversation history. Root continues independent inspection
while a review runs. Reusing the author's context is not a fresh review.

**Implementation checkpoints:** review after every stage, before the next
starts, and again after any scope expansion or failed assumption. One
implementer per stage. The reviewer is read-only.

Reviewer prompt:

> Read CLAUDE.md, the latency-plan scope-accretion postmortem memory, this plan,
> the accepted previous receipt, and the staged diff at BASE..HEAD. Use CodeGraph
> first, then read every moved region and every caller. Re-resolve every
> evidence anchor E1 to E21 at the reviewed HEAD and report any that no longer
> hold. Do not trust the author's summary. Attempt to disprove: byte-identical
> tool behavior, SSE event and payload equivalence, both restriction layers
> intact, lifecycle finalize arguments identical for every terminal outcome,
> the route still owning `withDynamicsContext` with loaded restrictions and the
> awaited model warm, gate self-tests actually exercising the changed fixture,
> and that no symbol is defined in two places. Confirm each prerequisite test
> would fail against the discriminating broken implementation. Separate
> pre-existing defects from new ones. Return cited findings with severity,
> disconfirming cases, missing evidence, and READY or NEEDS REWORK. Do not edit
> files, call live systems, or use a paid review product.

Receipt fields: checkpoint or stage; reviewer identity and transcript location;
baseline SHA and reviewed content hash; inherited assumptions from the prior
stage re-verified at this HEAD; files independently inspected; tests and gates
actually run with counts; findings; author dispositions; residual assumptions;
next permitted stage. "Reviewed" without a source-anchored receipt is
insufficient.

## 8. Contract-reconcile audit disposition

| Audit | Scope and acceptance |
|---|---|
| Whole flow | §2 trace covers client, route, service, Dataverse, Graph, Postgres, and SSE consumer; harness plus S0 census exercise the real route boundary |
| Partial success | Batch processing keeps per-record failure counts and `export_progress` semantics; `logQuery` keeps its fail-soft fallback; no new batch writer |
| Async and stale state | Disconnect classification stays in the route; `isDisconnected()` is read at the same two points the loop reads `disconnectObserved` today (`chat.js:221,369`); the finalize-before-`complete` ordering is preserved by the awaited `onTerminal` callback and pinned by test 4b; abort signal threads unchanged into the model call |
| Helper extraction | `explorer-store.js` does not absorb `roles.js` or `restrictions.js` semantics; `sendEvent` keeps its signature; no shared event bus |
| Durable surface | No table, migration, route path, or Atlas ownership change; matrix row and Atlas line get path updates only; catalog entries added; gates changed only by reviewed commits |
| Documentation | This plan marks no stage built; the route-service plan's carry-over row remains historical until S9; `/sweep` at S9 |
| Symbol fan-out | No new enum or status; every SSE event name and payload key preserved and pinned by S0 |

## 9. Commands and green-stage gate

Explorer baseline subset (12 suites, 151 tests at planning time):

```bash
npm test -- --runInBand --silent \
  tests/unit/dynamics-explorer-search-documents.test.js \
  tests/unit/dynamics-explorer-call-config.test.js \
  tests/unit/dynamics-explorer-record-count.test.js \
  tests/integration/dynamics-explorer-tool-serialization.test.js \
  tests/integration/auth-routes.test.js \
  tests/unit/dynamics-explorer-request-telemetry.test.js \
  tests/unit/dynamics-explorer-serializer.test.js \
  tests/unit/dynamics-explorer-taxonomy.test.js \
  tests/unit/dynamics-explorer-prompt.test.js \
  tests/unit/dynamics-explorer-terminal-state.test.js \
  tests/unit/maintenance-cleanup-dynamics-explorer-requests.test.js \
  tests/unit/operational-event-grouping.test.js
```

At every stage, in this order:

1. The subset above plus the two S0 suites.
2. `npm run lint`; `npm run check:types`.
3. Gates, each followed by its self-test, sequentially, never in parallel:
   `check:route-service-boundary`, `check:dataverse-access-layer`,
   `check:dynamics-context-boundary`, `check:model-override-warming`,
   `check:prompt-injection-tagging`, `check:api-routes`,
   `check:trust-boundary-guid`, `check:odata-escape`, `check:doc-symbol-refs`,
   `check:build-claim-freshness`, `check:harness-framing`,
   `check:scaffolding-tokens`, `check:secret-scan`; plus `check:docs-catalog`.
4. At S8 and S9: `npm test -- --runInBand --silent` (full) and `npm run build`
   (canonical). If the build fails with the documented sandbox Turbopack
   permission signature, retry through the approved host mechanism.
5. Inspect the full diff for any behavior change, obtain the fresh review,
   reconcile findings, commit only the stage's changes, record the receipt.
6. At S0 and S9, discover and run every current `check:*` script as `/start`
   requires; do not freeze the list above as the future inventory.

## 10. Stop, rollback, and non-goals

Stop the stage on: a harness edit needed to stay green; a changed SSE snapshot
hash; a symbol defined in two files; a gate satisfied by an env edit, ignore
marker, or baseline; any prompt-file diff; any change to `withDynamicsContext`
placement; a lifecycle finalize argument that differs for any outcome; a
`complete` event written before its finalize settles (test 4b).

Pre-existing defects recorded, not fixed: double finalize on disconnect
(`chat.js:151-153` plus `:221-224,369-372,395-398`, benign through the
`outcome = 'running'` guard at telemetry `:97`); the local guard's `$filter`
gap; the harness never exercising the ALS read guard. The context-boundary gate
comment and the matrix row's "export to Blob" wording are pre-existing too but
are fixed by labelled edits at S8 and S9.

Rollback each stage by reverting its commit. Modules are additive and unused
until the route imports them, so a stage revert leaves nothing dangling. Revert
S1 only after S2 through S8 are reverted. Revert S9 first if the gate flip lands
before a consumer regression is found. No durable state exists to repair.

Excluded: prompt or tool-schema changes, restriction-semantic fixes including
the `$filter` gap, telemetry changes, `pages/admin.js`, `pages/api/dataverse-export/`,
the client page, any Workbench surface, new tables or migrations, and any
performance work.

## 11. Planning review receipts and remaining unknowns

P1, 2026-09-18, fresh `general-purpose` subagent with no conversation history,
read-only, baseline `2e611d9a`, reviewed content hash
`cc44cf97cd956372449a8e2e9c1b083599fb8d7403556c72eb3bc27570a06c58`.
Verdict on that draft: NEEDS REWORK. Findings: HIGH-1 `check:odata-escape`
omitted from the gate table and red at S5 (`chat.js:1253`); HIGH-2 the session
contract inverted finalize-before-`complete` ordering with no test to catch it;
MEDIUM-3 `tool-errors` depends on `ENTITY_TYPE_CONFIGS` and two constants were
orphaned, so S2 could not build; MEDIUM-4 region double-assignment between the
shell and `chat-session` and between the guard and error modules; MEDIUM-5
`errorStage: 'context'` not reproducible; LOW-6 snapshot hash unattainable
without `requestId` normalization; LOW-7 warming statement incomplete; LOW-8
self-test fixture lines wrong. Anchors E5, E6, E8, and E2 self-test lines
failed re-resolution and were corrected; E17 to E19 added. Root confirmed every
finding against source before editing and incorporated all of them above; the
relocation of two gate exemptions is now an explicit owner choice in §3.4.
Reviewer inspected the route, the client page, seven gate scripts and their
self-tests, the context and telemetry modules, the five coupled tests, and six
docs; ran hash, grep, sed, wc, and one CodeGraph query; ran no Jest suite,
gate, or live call; edited nothing. The reviewed hash predates this revision;
After root re-resolved the anchors it had inherited from the reviewer and fixed
four more anchors and the S0 export list, the revised sections 1 to 10 hash is
`4df7fa8344c3df8afdec1e4206dd81b64c3829a848c564c2216fe8159e3706c8` at baseline `2e611d9a`. P2, 2026-09-18, fresh `general-purpose` subagent, no conversation history,
read-only, baseline `2e611d9a`, reviewed content hash
`4df7fa8344c3df8afdec1e4206dd81b64c3829a848c564c2216fe8159e3706c8` (confirmed
by the reviewer). Verdict: NEEDS REWORK. Findings: HIGH-1 `getEntity` calls
`searchRecords` (`chat.js:1273`) so S5 was unbuildable in the stated order;
HIGH-2 the contract lost the round-0 `lastModel` write (`chat.js:218`) and did
not pin when `onRoundComplete` fires, changing finalize `model`, `roundsUsed`,
and `stopReason` on round-1 and tool-stage paths; MEDIUM-3 test 4c asserted one
disconnect finalize where two occur today and lacked a discriminating fixture;
MEDIUM-4 the `explorerStage ?? 'context'` rule treated a state as a wrapper and
mutated the rejection; MEDIUM-5 the self-test rewrite deleted the GREEN half of
the S338 guard; MEDIUM-6 the census could not emit three events under the
harness mocks; LOW-1 to LOW-6 line coverage, `MAX_TOOL_ROUNDS` ambiguity, an
unlabeled model-resolution reorder, incomplete dependency cells, `escape()`
coercion, and the tool-stage outer-catch fixture. Anchors E17 and E18 had wrong
lines. Root confirmed each finding against source and incorporated all of them:
`composite` moves first in S5, `onStage` replaces the error tag, two
`onRoundComplete` positions are fixed, model resolution stays in the loop, the
route finalizes on the disconnect result, tests 4c to 4g and the census stubs
are specified, the self-test fixtures relocate to `dataverse-export`, E20 and
E21 were added. Reviewer ran the 12 Explorer suites (151 tests), a symbol
cross-reference script, and one CodeGraph query; edited nothing; no gate, live
call, or paid product. Revised sections 1 to 10 hash after incorporation:
`01e06d615e2b864a7701d338c2963f4441b9a11e14fa3e9d1b4cd9cc0dcf4efc` at baseline `2e611d9a`.

P3, 2026-09-18, fresh `general-purpose` subagent, no conversation history,
read-only, baseline `2e611d9a`, reviewed content hash
`01e06d615e2b864a7701d338c2963f4441b9a11e14fa3e9d1b4cd9cc0dcf4efc` (confirmed).
Verdict: NEEDS REWORK on text edits only. Findings: HIGH-1 the §3.3 signature
still passed `model`/`fallbackModel` in from the route while §3.1 and S8 kept
resolution in the loop; MEDIUM-2 `chat.js:1273` is `DynamicsService.searchRecords`,
so the P2-era `get-entity` → `composite` dependency was false (root had accepted
it without checking; E20 corrected); MEDIUM-3 the census needed `confirmed: true`
and an `LLMClient.complete` stub to emit the export events; MEDIUM-4 incomplete
`chat-session` dependency cell; MEDIUM-5 §10 listed two items as unfixed that S8
and S9 fix; LOW-6 to LOW-11 region cosmetics, 4f wording, the `sql` mock keys for
tests 5 and 6, test 7 being load-bearing after S8, self-test header and fixture
names, and six line drifts. P3 mechanically verified that §3.2 assigns lines
1–2983 exactly once, that S5 is buildable in order with no import cycle, that
the `onStage` and `onRoundComplete` positions are correct, and that tests 4b to
4g and 7 each fail against their named broken implementation. Reviewer ran the
12 Explorer suites (151 tests), one CodeGraph query, and a line-coverage diff;
edited nothing; no gate, live call, or paid product. Root incorporated every
finding and recorded the owner's three decisions of 2026-09-18 in §1 and §3.4.
Revised sections 1 to 10 hash: `f1cd0809ca4e87accfd484de1337dbc9b6fe73aa5bcc09104ce5f1585dbb5174` at baseline `2e611d9a`.

Next: the owner authorized a Codex adversarial review of this plan and
execution of S0 to S9 on a feature branch (see §1).

Remaining unknowns: exact line drift by the time implementation starts; whether
the Explorer behavior campaign lands prompt changes concurrently (coordinate on
the branch, since this plan never edits the prompt file); the campaign release
window for a Tier 1 promotion.
