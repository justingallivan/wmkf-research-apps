# Build brief: Test Request Factory admin form, slice 2b (status setter)

Date: 2026-10-01 (S562). Orchestrator: Fable. Builder: Sonnet. Reviewers: Opus, then Fable, then Codex (adversarial).

Plan: `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md`: read *Status setter in the form*, the slice 2b row, *Contract-reconcile* items 1 and 2, and *Slice 2 build record*. Slice 2 brief (route pattern): `docs/plans/briefs/FACTORY_ADMIN_FORM_SLICE2_BRIEF_2026-10-01.md`. Where this brief and the plan differ, this brief governs; the differences are under *Plan corrections*.

## Where

Worktree `/Users/gallivan/Code/WMKF_Apps-factory-form`, branch `claude/factory-admin-form-slice2b` (stacked on `claude/factory-admin-form-slice2`, PR #398, not yet merged). Stay in this directory and on this branch. Commit in small steps; push with `git push -u origin claude/factory-admin-form-slice2b`. Never push to `main` or to the slice 2 branch.

**No live systems.** Unit tests with fakes only. Never read `.env*` values. **Never run `npm run check:factory-ledger`** and never run `npx next build` (it loads `.env.local`; the orchestrator runs the build). Do not add Postgres integration tests.

## Scope: three parts, in this order, each its own commit(s)

- **A. Shared runner rule:** exactly one PATCH per status change, for the CLI and the form (`status-change-runner.js`, `status-transitions.js`, two ledger methods, their tests). Commit A before starting B, so the shared-code change can be reviewed alone.
- **B. Form:** three service methods and two route files, matrix rows, route count.
- **C. CLI:** `--status-abandon=<runId> --change-id=<changeId> [--confirm]`.

No UI (slice 3). No schema change, no migration, no new table, lock or column.

## Facts [VERIFIED S562 on this branch; re-read before relying on them]

Abbreviations: RUN = `lib/services/test-requests/status-change-runner.js`, TR = `lib/services/test-requests/status-transitions.js`, LED = `lib/services/test-requests/run-ledger.js`, CLI = `scripts/rehearse-test-request-sandbox.mjs`, SVC = `lib/services/test-requests/admin-run-service.js`.

- Every ledger status method returns `mapStatusChange(rows[0] || null)`: **`null` when no row matched**, never a throw (LED:746-763).
- `markStatusChangeDispatched` (LED:1252-1259): `WHERE change_id = $1 AND status IN ('planned', 'dispatched')`, `dispatched_at = COALESCE(dispatched_at, NOW())`. A second caller gets the row back.
- `markStatusChangeApplied` (LED:1261-1268): `status IN ('dispatched', 'applied')`. `completeStatusChange` (LED:1270-1278): `status = 'applied'`. `markStatusChangeNeedsAttention` (LED:1280-1290): `status IN ('planned', 'dispatched', 'applied')`.
- `planStatusChange` (LED:1236-1250): a second open change raises a raw Postgres unique violation (`error.code === '23505'`), not a `ServiceHttpError`.
- The runner ignores every `mark*` result today (RUN:87, 102, 107, 184, 187, 222); `markStatusChangeApplied`'s result is used unchecked (RUN:110, 226), so a `null` becomes a TypeError at RUN:168.
- Resume branch RUN:216-227: any outcome other than `needs_attention` or `recovered` falls into `dispatch()`; a mismatch closes the change `needs_attention` whatever its status.
- `decideResume` (TR:151-155) returns `recovered | redispatch | needs_attention`; its only callers are RUN:217 and the transitions test.
- Runner and transition refusals are plain `Error` with `.code` (RUN:31-33, TR `refusal`), not `ServiceHttpError`. `bodyOrThrow` failures and fence refusals are plain `Error` with no code. Codes today: `status_change_refused` (default), `_noop`, `_replay`, `_ambiguous`, `_conflict`, `_open`, `_resume`, `_jobs_open`, `_effects`, `_edge`.
- `awaitJobs` sets `deadline = now() + maxWaitMs` when it starts, after the PATCH (RUN:134-136). `COMPLETION_DEFAULTS`: poll 20 s, max wait 10 min, min quiet 90 s (RUN:29). The CLI passes no `completion`.
- The CLI status modes build a **plain** client (`createClient({ resourceUrl, token })`, CLI:1325); the PATCH is fenced inside the runner by `fenceStatusChangeClient` (RUN:88-90). SVC `readClient(target)` (SVC:271-275) is the same construction. The CLI status modes use no actor.
- `runStatusChange` loads the run itself with no ownership check (RUN:202); `assertChangeable` (RUN:74-84) requires a production run in status `ready`.
- SVC as built: `withLedger` (:246-254), `loadOwnedRun` (:256-263, 404 `factory_run_not_found`, no environment or status check), `requireWritable` (:219-221), `assertIsolation` (:225-230), `recheck` (:502-519, the Foundation recheck; its route `runs/[runId]/recheck.js` already exists). SVC injects `advanceOne` via `deps.advanceRun`; nothing injects the status runner yet.
- Route pattern: `pages/api/admin/test-requests/runs/[runId]/advance.js` (literal `maxDuration: 300`, `routeDeadline(config.maxDuration)` as the handler's first statement, gate, validation, `withDalContext`, `sendError`, `Cache-Control: no-store`). Helpers in `lib/services/test-requests/admin-run-route-helpers.js`.
- Route count 247 (`docs/CANONICAL_COUNTS.md:39-43`); matrix rows for the run routes at `docs/API_ROUTE_SECURITY_MATRIX.md:146-151`.
- CLI parsing: status flags CLI:256-260; mode list CLI:276; `--confirm` allowed only with `--create-cast` (CLI:289); status modes need `--target=production` (CLI:304-306); run-ID GUID check CLI:402-404; help CLI:433-434; dispatch CLI:1317-1325 and `runStatusMode` CLI:1188-1200. `main()` is guarded so the script can be imported by tests (CLI:1423). `tests/unit/ledger-guard.test.js:67` lists `WRITE_MODES`.
- Test fakes: `memoryLedger` in `tests/unit/test-request-status-change-runner.test.js:18-42` enforces state predicates through `move(id, from, to)`; its `markStatusChangeDispatched` accepts `['planned', 'dispatched']`.

## Plan corrections (orchestrator, S562)

1. **A second ledger method changes.** The plan's state table keeps an automatic `needs_attention` for a `planned` change that cannot dispatch. That close is only safe if it is itself conditional on `planned`: a caller holding a stale `planned` snapshot would otherwise close a change another caller has just dispatched. `markStatusChangeNeedsAttention` gains an optional `onlyIf` status (decision A2).
2. **No `vercel.json` entry** (as slice 2): literal `maxDuration: 300` in the route's `config`.
3. **The wait budget is an absolute deadline** passed into the runner's completion options (decision A6), not a `maxWaitMs` computed before the PATCH.
4. **Names:** the form's status recheck is service method `statusRecheck` (`recheck` is the Foundation recheck).

## Part A decisions (do not reopen)

A1. **`markStatusChangeDispatched` becomes the single `planned` → `dispatched` compare-and-set:** `WHERE change_id = $1 AND status = 'planned'`. Keep `dispatched_at = COALESCE(dispatched_at, NOW())`. It returns `null` to every caller but the first.

A2. **`markStatusChangeNeedsAttention({ changeId, error, effects, onlyIf })`:** `onlyIf` optional; when given it must be one of `planned | dispatched | applied` (else throw the ledger's usual unsafe-value error) and the predicate becomes `status = <onlyIf>`. Without it, behaviour is unchanged. Pass the status as a query parameter, never by string concatenation.

A3. **`decideResume(change, current)` returns `recovered | dispatch | mismatch`** (pure, status-agnostic): target value present → `recovered`; before-value and the same ETag → `dispatch`; anything else → `mismatch`. `redispatch` is retired. Rewrite its docblock.

A4. **The resume branch in `runStatusChange` is this table, implemented as an explicit `switch` on `open.status` whose `default` refuses** (an unknown status or decision must never reach `dispatch()`):

| `open.status` | `decideResume` | Action |
|---|---|---|
| `applied` | (not consulted) | `complete()` (unchanged) |
| `planned` | `dispatch` | `dispatch()` (the CAS decides who PATCHes) |
| `planned` | `recovered` or `mismatch` | `markStatusChangeNeedsAttention({ onlyIf: 'planned' })`. A row back → refusal `status_change_resume` (existing message). `null` → refusal `status_change_in_progress`, no further write |
| `dispatched` | `recovered` | `markStatusChangeApplied`; a row back → `complete()`; `null` → refusal `status_change_concurrent` |
| `dispatched` | `dispatch` (unchanged before-value and ETag) | refusal `status_change_in_progress`. **No ledger write, no PATCH** |
| `dispatched` | `mismatch` | refusal `status_change_resume`. **No ledger write, no PATCH** |

A5. **`dispatch()`:** call the CAS first and check it. `null` → refusal `status_change_in_progress`, no PATCH. After the PATCH: on 412 and on a non-ok answer call `markStatusChangeNeedsAttention({ onlyIf: 'dispatched' })` and throw the existing refusals whatever it returns (this caller is the only dispatcher). On success call `markStatusChangeApplied`; `null` → refusal `status_change_concurrent`. `complete()`: check `completeStatusChange` and the effects-failure `markStatusChangeNeedsAttention({ onlyIf: 'applied' })`; a `null` from `completeStatusChange` → refusal `status_change_concurrent` (never a success summary without a ledger row). New refusal messages: `status_change_in_progress`: "Change <n> is already being sent by another caller, or was sent and its result is not yet known; nothing was sent now."; `status_change_concurrent`: "Change <n> was moved on by another caller; reload its status." Every refusal raised for an open change carries `changeId` and `sequence` as properties on the error.

A6. **Completion deadline:** `completion` accepts an optional absolute `deadlineAt` (epoch ms). `awaitJobs` uses `Math.min(now() + maxWaitMs, deadlineAt ?? Infinity)`. The `status_change_jobs_open` message reports the seconds actually waited. Defaults and CLI behaviour are unchanged when it is absent.

A7. **Comments and messages:** update RUN:1-12 header, RUN:96-99, RUN:170-173, TR:143-150, and the LED:1230-1235 header (the journal still has no lease; say that one PATCH per change is enforced by the `planned` → `dispatched` compare-and-set). Leave the migration file's comment alone (applied file).

A8. **Tests for A** (`tests/unit/test-request-status-change-runner.test.js`, `test-request-status-transitions.test.js`, `test-request-run-ledger.test.js`). First change the fake: `memoryLedger.markStatusChangeDispatched` accepts `['planned']` only, and `markStatusChangeNeedsAttention` honours `onlyIf`. Then:
- replace runner :149-156: a lost response that never landed → the second call refuses `status_change_in_progress`; patches are exactly `['W/"100"']`; the row stays `dispatched`
- replace runner :159-164: a `dispatched` change whose Request moved on → `status_change_resume`, zero patches, the row **stays `dispatched`**
- replace transitions :132-134: before-value at the same row version → `'dispatch'`; the others → `'recovered'` / `'mismatch'`
- barrier test: caller B runs while caller A's PATCH is unresolved (hold A's `patchWithOptions` on a promise) → exactly one PATCH, B refuses `status_change_in_progress`, the journal stays `dispatched` until A resolves, then A completes and the row is `complete`
- two callers racing a fresh plan (B finds A's `planned` row and dispatches; A's CAS returns `null`) → one PATCH, A refuses `status_change_in_progress`
- stale snapshot: a caller holding a `planned` snapshot whose row is already `dispatched`, Request at the target → zero ledger writes by that caller, `status_change_in_progress`, the row stays `dispatched`
- a `planned` change interrupted before its PATCH resumes through the CAS and completes (one PATCH)
- `planned` + target already present → `needs_attention` (never treated as recovered)
- `dispatched` + unchanged stays in progress on repeated calls, with a clock far past any timer
- `dispatched` + target present → recovered, completes, no PATCH; effects recorded before recovery stay in the census (`dispatchedAt` unchanged)
- `applied` resumes completion without a PATCH (existing :180 test stays green)
- `markStatusChangeApplied` returning `null` → `status_change_concurrent`, not a TypeError; `completeStatusChange` returning `null` → `status_change_concurrent`, no success summary
- an unknown `open.status` or an unknown `decideResume` value never reaches `dispatch()` (zero patches)
- completion `deadlineAt` earlier than `maxWaitMs` ends the wait at the deadline with `status_change_jobs_open`
- replay: a non-producing change can be planned again after `needs_attention`; a producing change with prior effects, or with a prior dispatch whose effects are unknown, is refused `status_change_replay` without `rerun`
- ledger unit tests: the SQL text of the CAS (`status = 'planned'`), and `onlyIf` (parameterised predicate; an invalid value throws)

## Part B decisions

B1. **Service methods** (SVC; each starts with `actorFor(profileId)`, `currentTarget()`, `withLedger`, `loadOwnedRun`; refuse a non-production run with 409 `factory_run_not_production` as `recheck` does). Inject `runStatusChange`, `recheckStatusChange`, `readLiveOptions` through `deps` (mirror `advanceOne`) so tests can fake them. All three use `readClient(target)`.
- `statusOptions({ profileId, runId })` (read; no kill switch): returns `{ runId, runStatus, options: { phase1: [...], phase2: [...] }, changes }` from `readLiveOptions` for both fields and `listStatusChanges`.
- `changeStatus({ profileId, runId, field, optionLabel, deadlineAt })` (write): `requireWritable()`, `assertIsolation(target)`, ownership, production, then run status must be `ready` (409 `factory_run_not_ready`); `field` is `phase1 | phase2`, mapped with `fieldFor`; a deadline checkpoint requiring at least `MIN_STATUS_BUDGET_MS = 150_000` before calling the runner (504 `factory_deadline_exceeded`, the slice 2 helper); then `runStatusChange({ client, ledger, runId, field, optionLabel, completion: { deadlineAt: deadlineAt - 30_000, now } })`. **Never pass `rerun`.**
- `statusRecheck({ profileId, runId })` (writes the ledger journal only): `requireWritable()`, ownership, production, then `recheckStatusChange`.

B2. **Outcome mapping in `changeStatus`** (the service translates; the route stays thin). Return a value for the first two rows, throw `ServiceHttpError` for the rest; anything not listed is rethrown and becomes the generic 500.

| Runner result | Service result | HTTP |
|---|---|---|
| success | `{ outcome: 'complete', ...result }` | 200 |
| `status_change_jobs_open` | `{ outcome: 'jobs_open', code, message: 'The change was written. Background jobs on the Request are still finishing; check again.', changeId }` | 202 |
| `status_change_in_progress` | `{ outcome: 'in_progress', code, message, changeId, abandonCommand }` | 202 |
| `status_change_ambiguous` | `{ outcome: 'unconfirmed', code, message: 'The change was sent but its result could not be read. Check again; do not start a different change.', changeId }` (never the upstream error text) | 202 |
| `status_change_noop`, `_open`, `_conflict`, `_resume`, `_effects`, `_edge`, `_concurrent`, `_refused` | `ServiceHttpError` 409 with the runner's code and message | 409 |
| `status_change_replay` | 409, message: "This change already created a payment or status-tracking row on this Request. Repeating it needs the owner CLI (`--set-status … --rerun`) after inspection." | 409 |
| Postgres `23505` from `planStatusChange` | 409 `status_change_open`, "Another status change on this run is already open; reload." | 409 |

`abandonCommand` is exactly `node scripts/rehearse-test-request-sandbox.mjs --target=production --status-abandon=<runId> --change-id=<changeId>` (no `--confirm`), with the in-progress message: "This change is being sent, or was sent and its result is not yet known. Do not retry. If it never resolves, the owner closes it from the CLI after establishing that no sender is still running." `statusRecheck` maps `status_change_refused` to 409 the same way.

B3. **Routes:** `pages/api/admin/test-requests/runs/[runId]/status/index.js` (GET → `statusOptions`; POST → `changeStatus`) and `status/recheck.js` (POST → `statusRecheck`). Same order and helpers as `advance.js`. `status/index.js` sets literal `maxDuration: 300` and computes `routeDeadline(config.maxDuration)` as its first statement; `status/recheck.js` sets no `maxDuration`. POST body is exactly `{ field, optionLabel }`: `field` is `'phase1'` or `'phase2'`, `optionLabel` a string of 1–200 characters after trim; unknown keys (including `rerun`) are 400. `status/recheck` takes no body. The POST answers 200 for `outcome: 'complete'` and 202 otherwise. All responses `Cache-Control: no-store`.

B4. **Matrix and count:** two rows after the existing run rows, from the plan's two `status` rows corrected to the build (guard `requireSuperuser`; `withDalContext`; write switch; isolation flags on the POST; one fenced `If-Match` PATCH per change, ever; 202 states; no `rerun`; `status/recheck` appends late effects to the ledger journal only). Risk High for `status`, Low for `status/recheck`. Mark both **[BUILT, NOT ENABLED: `TEST_REQUEST_FACTORY_FORM` unset; no live verification.]**. Route count 247 → 249 with `npm run check:fact-consistency -- --write`.

B5. **Tests for B:** extend `tests/unit/test-request-admin-runs-routes.test.js` with the two files in the per-route `CASES` (method, gate, profile from the gate, `ServiceHttpError` pass-through, generic 500, malformed `runId`, `withDalContext` label), plus: body shape (`field: 'phase3'`, missing `optionLabel`, over-length label, `rerun` key → 400, service not called); 200 vs 202 by `outcome`; `deadlineAt` anchored at entry (slow-gate test); `maxDuration` literal test covers the two new files. Service tests in `tests/unit/test-request-admin-run-service.test.js`: every row of the B2 table (assert no upstream error text in `unconfirmed`, and the exact `abandonCommand`); `rerun` is never passed to the runner; write switch off → `changeStatus` and `statusRecheck` 503, `statusOptions` still answers; isolation off on production → `changeStatus` 503; another actor's run → 404 on all three; sandbox run → 409 on all three; non-`ready` run → 409 before the runner is called; under 150 s left → 504, runner not called; the runner receives `completion.deadlineAt === deadlineAt - 30_000`; a second POST for a `jobs_open` change calls the runner again and the (real) runner sends no second PATCH (one integration-style test with the real `runStatusChange` and the runner test's fakes).

## Part C decisions

C1. **Flags:** `--status-abandon=<runId>` (a run mode), `--change-id=<changeId>`, `--confirm`. Add the mode to the one-mode list (CLI:276), allow `--confirm` with it (CLI:289), require `--target=production` (CLI:304), GUID-check both ids (CLI:402), require `--change-id` with it and refuse `--change-id` without it, add a help line. `ledgerSchemaCheck` mode name `'status-abandon'`; add it to `WRITE_MODES` in `tests/unit/ledger-guard.test.js`.

C2. **Behaviour** (an exported function, testable like `runCastMode`; plain client as the other status modes; **no Dataverse write, no write ack required or read**):
1. load the run; refuse unless it exists and `destinationEnvironment === 'production'`
2. `listStatusChanges(runId)`; refuse unless one has `changeId`
3. refuse unless its status is `dispatched`: for `planned` or `applied` say "resume with --set-status instead"; for `complete` or `needs_attention` say it is already closed
4. read the Request's field (`$select` the change's field and `akoya_requestid`); if it holds the target value refuse: "recovered — resume with --set-status instead"
5. print the no-dispatcher checklist: stop or disable form dispatch; establish that every form invocation has ended; stop or account for every CLI process, including paused ones; a timer or a rollback alone is not enough
6. without `--confirm`: print the proposed transition (`dispatched` → `needs_attention`) and stop. No ledger update
7. with `--confirm`: one `markStatusChangeNeedsAttention({ changeId, onlyIf: 'dispatched', error: 'Owner confirmed no dispatcher is running; abandoned unresolved status change.' })`; a `null` result is an error ("the change moved on; nothing was changed"), never a success message

C3. **Tests for C** (`tests/unit/test-request-production-target.test.js` for parsing; a new or existing CLI-mode test file for behaviour, with a fake client that records every call): parsing rules in C1; target present refuses; `planned` and `applied` refuse; unknown `changeId` and a `changeId` of another run refuse; no `--confirm` → zero ledger updates; `--confirm` → exactly one ledger update with `onlyIf: 'dispatched'`; a `null` result is reported as a failure; in every case **zero Dataverse writes** (the fake client throws on any `patch`/`post`/`delete`) and no read of `DATAVERSE_PROD_WRITE_ACK`.

## Mutation checks (do at least four, record them)

Widen the CAS predicate back to `IN ('planned', 'dispatched')` (in the fake and assert the SQL-text test) → the barrier test fails. Ignore the CAS result in `dispatch()` → the racing-plan test fails. Drop `onlyIf` in the resume branch → the stale-snapshot test fails. Pass `rerun: true` from the service → the never-passed test fails. Return the upstream message for `status_change_ambiguous` → the no-leak test fails.

## Gates (sequential; a gate, then its self-test)

`npx jest --testPathPatterns "test-request|ledger|maintenance|rehearse"`, then: `check:api-routes`, `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:odata-escape`, `check:script-suggestion-writers`, `check:fact-consistency`, `check:canonical-pointers`, `check:doc-currency`, `check:secret-scan` (each with its `:self-test`), then `check:docs-catalog` and `check:types`. Report pass counts and any red output verbatim. If a gate fires on something this brief did not anticipate, stop and report; do not widen exemption or allow lists.

## Not in this slice

UI; `rerun` in the form; bind, slot or retire; Atlas, runbook and plan prose (the orchestrator writes those); any change to the fence, the transition table, the effects census, the schema, or `preview.js`.

## Hand-back

Commits pushed on the branch (A separate from B and C); a report with: files changed; test counts; the mutation checks; each gate's result; the list of every test you replaced or deleted and why; anything you had to decide that this brief did not cover (list it, do not bury it).
