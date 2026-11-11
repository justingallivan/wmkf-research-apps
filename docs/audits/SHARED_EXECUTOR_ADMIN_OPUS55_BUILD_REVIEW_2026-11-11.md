# Shared Executor Admin build review and disposition

**Review verdict:** READY WITH NAMED CHANGES.

The owner-authorized read-only Claude Code OAuth review used
`claude-opus-5-5`. The successful CLI result lists only
`claude-opus-5-5` in `modelUsage`. The review made no edits and ran no
tests or provider inference. The response below is preserved verbatim.

## Verbatim review

**Verdict: READY WITH NAMED CHANGES.** One Medium change is required in the new shared-task editor. The other items below are Low or need confirmation, and none of them blocks the slice. I made 12 read-only calls, wrote nothing, and ran no tests, inference or advisor calls. I didn't read the test files, so I can't speak to how strong the test assertions are.

## Medium: required

**M1. The editor reports some saved task publications as failures, and its "retry" message can loop forever.** `shared/components/admin/SharedPromptEditor.js:154,157`
- The editor only counts `completed` and `already_published` as success. The publish service can also return `partial` (`prompts-publish-service.js:341`) and `failed` (`:347`), sometimes after the new row is already written.
- A retry with the same draft never tries again. The request ID is tied to the draft content, so it only changes when the draft changes (`SharedPromptEditor.js:22-25`). The service replays any recorded final result, including `failed` (`prompts-publish-service.js:202-211`). That happens before the code that would resume a half-finished publish (`:247`).
- **Example:** creating version N+1 succeeds, then switching the old row off returns a 503 (not a 412). The audit records `failed`, and N+1 and N are both marked current. The editor says "Retry the same previewed draft." Retrying returns the same `failed` replay and the same error every time. If the admin edits the draft instead, it gets a new request ID, and the resume step's content-hash check fails, so the service refuses because two rows are current (`:248-249`).
- **Remedy (UI only, simplest):**
  - Handle `partial`, and `failed` or `concurrency_conflict` responses that include `newPromptId`, as their own case: show "The new version may exist and needs reconciliation. Reload the task."
  - Reload the task, and stop offering "retry the same."
  - Add a test that replays a `failed` final audit and checks that the copy no longer offers a retry.

## Low or needs confirmation

**L1. A temporary hold-up just before dispatch permanently fails the task.** `worker.js:117` → `:122` → `:41-43`
- If the lease deadline passes, or `store.markDispatching` throws a temporary database error, this happens before an attempt exists. The task is then marked `failed_pre_dispatch` / `profile_execution_failed` for good.
- This is safe, since the provider is never called, but a transient condition becomes terminal.
- **Remedy:** tag a lease-deadline throw as `dispatch_check_unavailable`, so the task waits instead.

**L2. Possible stall after `snapshot_too_large` (needs confirmation).** `worker.js:61-74`
- When the snapshot is too large, every queued task is marked failed, and the job's snapshot ID stays empty.
- On the next tick, the same branch finds no queued tasks and returns `needs_attention` (`:63`). It never reaches the code that would settle the job (`:174/176`).
- I didn't check whether `store.claim` skips jobs whose tasks are all terminal. If it doesn't, the job returns `needs_attention` on every tick and never completes.
- **Remedy:** a one-tick follow-up test, plus either an early check for "all tasks terminal" or letting the job fall through to the completion branch.

**L3. A request the provider received and rejected leaves no audit row.**
- An attempt that was really sent and then rejected (400/401/429/529) is marked `failed_pre_dispatch` with audit state `none` (`store.js:501-502`). So that call never gets a `wmkf_ai_run` row.
- The Executor marks such calls as possibly billed (`paidCall = true` at `execute-prompt.js:500`), but the worker discards that. The label "pre-dispatch" is also inaccurate for a request that was sent.
- **Remedy:** accept and document this, or record a `failed` audit for these attempts.

## Accepted limitations to keep on record
- **429/529 errors fail the task permanently.** This is safe: single-attempt calls disable the client's built-in retry (`execute-prompt.js:833`), and only exact canonical error messages count as rejections (`:879-882`). The cost is that a rate-limit or overload error kills a trial task.
- **Races on the same profile key** rely on the alternate key plus the readback check. No live index has been verified.

## Checked and found sound
- **Profile service (`prompt-profiles-service.js`):**
  - Replay is checked before the version check.
  - A failed create triggers a readback, and success is proved only by an exact request-ID and profile match (`:65-77`).
  - Corrupt stored rows fail closed (`:39`).
- **Pins** must match key, revision and hash exactly (`:79-83`).
- **Temperature:** a null value becomes 0 before the content hash is computed (`:131` runs before `prompts-publish-service.js:184`). That stays consistent with the hash taken from the stored row (`:712`).
- **Reserved names:** a legacy prompt can't be switched into the new mode, and the marker can't be removed (`:124-128`).
- **Request IDs:** a caller-supplied request ID is required in both create and update (`:129`, called with `requestIdArg`).
- **Executor:** the profile path requires frozen context, no persistence and deferred audit (`execute-prompt.js:175-181`). An empty system prompt is normalized before the snapshot is validated and bound (`:412`).
- **Worker callback sequence:**
  - Authorization unavailable → waiting.
  - Authorization denied before or after dispatch starts → terminal failure.
  - An uncertain outcome after dispatch → `unknown`, with no retry.
- **Admin profile route:** requires a superuser, uses a trusted DAL context, and keeps administrator-written text out of the logs. I didn't confirm it is listed in `docs/API_ROUTE_SECURITY_MATRIX.md`; `npm run check:api-routes` would confirm it.

## Dispositions

- **M1 — accepted.** The branch editor treats `partial` as a publication
  reconciliation case. It applies the same rule to `failed` and
  `concurrency_conflict` when the response carries a `newPromptId`. It retains the draft, invalidates its
  preview, and reloads the task. Publication stays blocked until readback
  confirms the intended sole current version and the editor chooses to use
  that version as the base. A subsequent publish requires a fresh preview.
  This avoids replaying a recorded failure as if it were a new attempt.
  The counterexamples in `tests/unit/shared-prompt-editor.test.js` cover
  each status and a duplicate-current readback. Those cases passed in the
  integrated run below.
- **L1 — accepted.** If the late dispatch check consumes the remaining
  lease window, `lib/services/prompt-jobs/worker.js` tags the deadline
  as `dispatch_check_unavailable`. That tick returns `waiting` before
  an attempt or provider call. A failed or uncertain ledger write still
  uses the existing attempt/lease fence. It does not become automatic
  provider retry eligibility.
- **L2 — verified as an existing terminal outcome.** The real PostgreSQL
  case in `tests/integration/prompt-jobs-executor.pg.test.js` checks that
  oversized preparation calls the source once, records
  `snapshot_too_large`, and returns `needs_attention` on the next tick.
  There is no provider attempt and eligible initialization slots release.
  An all-failed job intentionally needs attention. This internal worker
  has no separate persisted job completion state or scheduler.
- **L3 — accepted named limit.** The worker records a confirmed provider
  rejection on its PostgreSQL attempt as `failed_pre_dispatch` with
  `provider_rejected`. The existing enum label is reused after dispatch
  intent and provider response. Audit state is `none`, so this receipt
  creates no Dataverse `wmkf_ai_run` row. `paidCall:true` on the
  Executor error means the provider returned a response or confirmed
  rejection. Billing amount and billability require separate provider
  evidence. The 429/529 cases remain terminal without automatic retry.

The profile revision race depends on the setting-key alternate key and
exact readback. Live index activation and Dataverse round-trip behavior
remain outside the branch proof. The accepted L3 audit boundary remains
in force.

## Integrated verification

[VERIFIED via local commands] The final runtime source through `30d15803f`
and documentation through `c9cc329aa` passed **972 tests across 40 suites**.
Both PostgreSQL integration suites ran with their require flags enabled
against the disposable loopback PostgreSQL instance on port 55440. The
run used synthetic data and doubles for model and remote write adapters.

```sh
TEST_REQUEST_LEDGER_TEST_URL=postgresql://postgres@127.0.0.1:55440/executor_trial \
TEST_REQUEST_LEDGER_REQUIRE=1 \
PROMPT_JOB_PG_TEST_URL=postgresql://postgres@127.0.0.1:55440/executor_trial \
PROMPT_JOB_PG_TEST_REQUIRE=1 \
npx jest \
  tests/unit/execute-prompt- tests/unit/utils/ai-payload-boundary.test.js \
  tests/unit/prompt-jobs- tests/unit/llm-client.test.js \
  tests/unit/tool-prompt-parity tests/unit/tool-prompt-composer.test.js \
  tests/integration/prompt-jobs-executor.pg.test.js tests/integration/prompt-jobs.pg.test.js \
  tests/unit/prompts- tests/unit/admin-prompts- tests/unit/admin-prompt-profiles.test.js \
  tests/unit/prompt-profiles-service.test.js tests/unit/shared-task-publication.test.js \
  tests/unit/shared-prompt-editor.test.js tests/unit/prompt-templates- \
  tests/unit/dataverse-settings-service-odata-escape.test.js tests/unit/executor-budget-service.test.js \
  --runInBand --silent
npm run build
```

The application build exited zero and compiled in 9.6 seconds. It emitted
four existing DOCX filesystem-tracing warnings and the existing
`pages/_app` static-optimization warning. Scoped route security, Atlas,
canonical facts, status, DAL, GUID, and documentation checks passed with
their applicable self-tests. The browser fixture used the repository's
shared Button and Tailwind styles at desktop width and 390 px. The narrow
fixture's document scroll width was 390 px. The local fixture server was
stopped after verification.

The named changes are resolved for this synthetic slice. The orchestrator
closed this review round after the integrated checks. Live Dataverse
writes, provider inference, deployment, and production enablement were
outside this verification.
