# Shared Executor build review and disposition

Status: **READY WITH NAMED CHANGES — required findings addressed locally and verified.**

The owner switched reviews to Opus 5.5 on 2026-11-11. The read-only Claude Code OAuth command explicitly used `--model claude-opus-5-5`; it exited successfully with `is_error:false`. The CLI usage report contains both `claude-opus-5-5` and `claude-fable-5-2`; it does not explain the latter's role. Thus the primary model was explicitly selected, but the receipt does not establish that every internal CLI call used only Opus. No separate fallback review or provider-key authentication was launched.

Reviewed runtime baseline: `9d17f29a3`. The following response is preserved verbatim; line numbers refer to that baseline.

## Verbatim reviewer response

I'm returning **READY WITH NAMED CHANGES**. I found no defect that lets a stale worker publish, re-dispatches a paid call, refills a human-cleared field, sends an audit twice or leaks text. The changes needed fix cases where the fail-closed path never terminates, or records the wrong outcome.

Scope: read-only review of the committed build at `9d17f29a3`, using Read/Grep/Glob only. Nothing was edited and no tests were run; the pass counts in the brief were not re-run by me.

## Findings, by severity

### 1. Medium — A second initialize job on the same Request captures a stale ETag, gets a 412, and locks the field
- **Where:** `store.js:499` with `:95-102`, `:313-320`, `:362-389`, `:576-588`; `worker.js:144`.
- **What happens:** The lease only lasts one tick (`worker.js:144`). The claim blocks other jobs only while one holds a live lease or has an `unknown` task or publication (`store.js:313-320`).
- **Scenario:**
  1. Job A initializes `fixture_summary` and `fixture_methodology`. It captures ETag `W/"1"`.
  2. The summary task fails validation, so `markAttemptFailed` releases the summary slot straight away (`:499`).
  3. Job B is admitted for the summary under a new event. That is allowed (plan §7: "A new initialization after a proven validation failure is allowed").
  4. Ticks interleave. B captures the baseline `W/"1"` before A publishes.
  5. A publishes methodology, and the ETag becomes `W/"2"`.
  6. B pays for generation, freezes a publication with `W/"1"`, and gets a 412.
  7. `finishPublication` never releases a slot. B's summary slot is now permanently reserved while the field is still blank, and every later admission fails with `prompt_job_initialization_reserved`.
- **Same outcome without a validation failure:** two initialize jobs on one Request with different fields.
- **Why it isn't unsafe:** If-Match prevents a bad write. But the build doesn't keep §6's intent that parallel jobs on one Request don't dispatch or publish, and it breaks the retry the plan promises.
- **Minimal fix:** In `captureTarget`, refuse to capture (return null / `prompt_job_request_publication_pending`) while another `initialize` job on the same `(environment, request_id)` has `target_etag IS NOT NULL` and any task with `writeback_state = 'pending'`. That covers queued, response-saved, validated-but-unpublished and unknown tasks. Concurrent captures are already serialized by `idx_prompt_jobs_one_request_lease`.
- **Test (real PostgreSQL):** run the scenario above. Assert B's capture is refused until A's publication is applied. Then B captures `W/"2"`, publishes `applied`, and the writer sees If-Match `W/"2"`.

### 2. Medium — Repeatable errors after the response checkpoint loop forever and block sibling tasks
- **Where:** `execute-prompt.js:463` (model mismatch, no `code`), `:447-449` (checkpoint binding mismatch); `worker.js:89-98`, `:100-103`, `:58`.
- **What happens:**
  - Any post-checkpoint error without a validation code returns `response_saved` (`worker.js:98`).
  - The next tick picks the `response_saved` task first (`:58`) and fails the same way.
  - Errors from `safeAudit` or `saveValidated` at `:100-103` sit outside the try and throw on every tick.
- **Scenario:** the provider double returns `model: 'claude-sonnet-4-6-x'`.
  - The response is saved (paid). Every later tick throws "profiled response model mismatch" and returns `response_saved`.
  - The queued sibling is never dispatched, the publication barrier is never reached, no audit is written, and the initialization slots are held.
  - A deploy that changes the resolved `maxTokens`, which is part of the binding, does the same to every unvalidated checkpoint.
- **[ASSUMED]** I don't know whether Anthropic's response `model` always matches the reviewed ID exactly. The legacy path never compared them.
- **Minimal fix:**
  - Give the model mismatch a terminal code (e.g. `profile_response_model_mismatch`). Add it to `PROFILE_ERROR_CODES` and `VALIDATION_CODES`, and to the `safeAudit` notes regex at `worker.js:17`, so it becomes `failed_validation` with a deferred audit.
  - For any other post-checkpoint error, return `needs_attention` instead of `response_saved`.
  - Recovery should not starve queued siblings indefinitely.
- **Test:** a mismatched model gives `failed_validation`; the sibling still validates and publishes alone; the provider is called exactly twice.

### 3. Medium-low — Every audit exception is recorded as a definitive `failed`
- **Where:** `worker.js:118-119`.
- **What happens:** Any throw from `audit()` is recorded as `failed`. The integration test throws "audit transport uncertain" and asserts `audit_failed` (`prompt-jobs-executor.pg.test.js:129-130`).
- **Scenario:** the Dataverse create succeeds with the stable `audit_run_id`, but the response times out. The receipt then says not delivered.
  - Nothing is resent, so at-most-once still holds.
  - But the receipt is wrong. An operator reading it would reasonably re-create the run.
  - The store also treats `failed` as not blocking publication (`store.js:535`, `:568`), while the worker blocks on it (`worker.js:123`).
- **Minimal fix:** default the catch to `unknown`. Use `failed` only when the adapter signals a definitive rejection that was never accepted (e.g. `error.definitive === true`).
- **Test:** the adapter throws a timeout and the result is `audit_state: 'unknown'`; it throws a typed rejection and the result is `failed`. Delivery happens once in both cases.

### 4. Low — Configuration content expires with the source, but the audit and publication stages still need it
- **Where:** `store.js:256` (expiry = `source`); `worker.js:106-114`.
- **What happens:** Audit and result content live until `result_expires_at` (`store.js:453-454`). But a pending audit needs `config.promptRow`, and pending audits run before publication.
- **Scenario:** tasks validate, then the audit sink is unavailable until after source expiry (up to 7 days, while results are kept up to 30).
  - Every tick returns `audit_content_expired`.
  - The publication never happens and the slots stay held.
- **Minimal fix:** store configuration with `result_expires_at`. Dispatch stays fenced because `markDispatching` also requires the unexpired snapshot (`store.js:399-400`).
- **Test:** expire only source-dated content after validation; the audit is delivered and the publication is applied.

### 5. Low — Explicit provider rejections and late authorization denials are classified inconsistently
- **Where:** `execute-prompt.js:789` sets `maxRetries: 0`; `llm-client.js:316-318`, `:342-347` throw errors that carry an HTTP `status`; `worker.js:94-97`.
- **Explicit rejections:** a 400, 401, 429 or 529 response is a received rejection, but it is marked `unknown`. That fences the whole Request until an operator acts.
  - It is conservative, not unsafe.
  - Overload (529) responses are common in a real-provider run, and the plan says explicit rejections stay narrowly retryable within the deadline.
- **Late authorization or freshness denial:** inside `onDispatch` (`worker.js:83`) it becomes a terminal `failed_pre_dispatch` and releases the slot (`:88`). The same denial at `:60-61` is a retryable throw.
- **Fix before any real-provider trial:**
  - Map known non-2xx provider statuses to a terminal, revoked attempt. The store already allows `failed_pre_dispatch` from `dispatching`.
  - Make the two denial sites behave the same.
- **[ASSUMED]** that these rejections are not billed.

### 6. Low — The legacy path now parses `wmkf_ai_promptvariables` more strictly
- **Where:** `execute-prompt.js:204` runs `parseExecutionSpec` on every legacy row.
- **What changed:**
  - `profile.js:38-40` rejects whitespace-only values ("invalid JSON") and `[]` ("expected object").
  - Before, `parseJsonField` (`:1526-1530`) turned whitespace into `{}`, and `[].variables || []` worked.
- **[ASSUMED]** that no live prompt row has such a value; I didn't probe live data.
- **Fix:** have `parseExecutionSpec` return `null` for trimmed-empty values and for parsed values that aren't objects. An array can't carry an `execution` marker, so this opens nothing unsafe.
- **Test:** legacy `executePrompt` with `'  '` and `'[]'` behaves as before.

### 7. Low — Storage limits don't match the profile and token limits
- **Snapshot:** it stores the document text twice: in `documents[].text` and again, escaped, in `protectedDocumentBlock` (`context.js:52-53`). It is capped at 4,194,304 bytes (`store.js:22`, migration `:40`), but profiles allow 4,000,000 bytes of documents (`profile.js:32`).
  - Above roughly 2 MB, `saveSnapshot` returns 400 on every tick (`worker.js:46`). The job never ends and holds its slots.
- **Response checkpoint:** text is stored in both `text` and `content`, capped at 262,144 bytes (`store.js:23`). Admission doesn't bound `wmkf_ai_maxtokens`.
  - A runaway output makes `saveResponse` fail, and a fully received paid response is recorded as `unknown`.
- **Fix:** cap profile document bytes at about half the snapshot limit, and bound `maxtokens` at admission or in `validateSyntheticTask` so the worst-case checkpoint fits.

## Checked and sound
Each item is from reading the cited code, unless marked otherwise.

- **Lease fencing:** every mutation goes through `withLease` (`FOR UPDATE` plus a database-clock expiry check). `SKIP LOCKED` combined with the "blocked" re-query means an in-flight stale transaction can't be cleared under it. The partial unique lease index is a second guard. Late responses, audits and PATCHes after expiry return null (`store.js:212-223`, `:296-320`).
- **Unknown outcomes:** expired dispatching attempts, audits and publications become `unknown` (`store.js:115-136`). An unknown task cannot be failed or released (`store.js:474-499`). Other jobs' unknowns block claims.
- **Dispatch intent and checkpoint order:** intent is committed before `client.complete` (`execute-prompt.js:813-816`). The response is saved before parsing (`:461`). Recovery never calls the provider (`:446-451`).
  - The real normalizer's output can be serialized by `canonical()`, because all fields are JSON-derived or explicitly null (`llm-client.js:445-469`, `execute-prompt.js:838-861`).
- **Initialize-once:** one active slot per `(environment, request_id, field)`, independent of event or prompt. Losing admissions roll back. Protected staff content is never released. Applied, conflict and unknown publications are never released, so a human-cleared field stays protected.
- **Audit at-most-once:** the audit moves `pending → dispatching → terminal`, with no transition back.
- **Publication barrier:** one frozen operation per job, using the original ETag (`store.js:529-558`, `worker.js:126-142`).
- **Task maps:** `FIXTURE_FIELDS` (`store.js:16`), `OUTPUTS` (`worker.js:4`) and `TASKS` together with the `environment === 'test'` check (`capabilities.js:4-12`, called at `execute-prompt.js:419`) each reject anything outside their own entries. A mismatch between them stops the job without dispatching, so no shared abstraction is needed.
- **Reachability:** only `execute-prompt.js` and `worker.js` reference the profiled options or `prompt-jobs/`. No caller spreads request input into `executePrompt`.
  - **Limit:** `environment: 'test'` is a label the caller supplies, not tied to the deployment. Having no route is the real barrier.
- **Fresh-install parity:** `setup-database.js` bootstraps from the manifest (`:2146-2158`). `apply-migrations.js` skips migrations already tracked and applies the rest in lexicographic order, so a later 096 still applies. The Atlas page exists.
- **Privacy:** the status view returns only rows and hashes, with the lease token stripped (`store.js:72-85`). The audit payload is whitelisted (`worker.js:9-20`).
- **Tests:** the real-PostgreSQL suites exercise actual constraints, locks and expiry. The worker unit test's fake store does not enforce fences; it only proves call ordering.
  - The default-preamble unit test (`execute-prompt-profile.test.js:126-130`) is tautological.
  - The exact default preamble bytes are pinned by the golden tool-prompt fixtures. Those were not in the cited 14-suite command, so run them before claiming that invariant.

## Verdict: READY WITH NAMED CHANGES
- **Required before the synthetic trial:** findings 1, 2 and 3. Finding 4 is a one-line change and worth including.
- **Can wait:** findings 5–7 can be fixed before any real-provider or real-document trial.
- **Limits of readiness:**
  - This covers a synthetic, test-labelled, server-internal foundation only, with injected provider, source, authorization, audit and writer doubles.
  - It is not evidence of real provider cache hits, provider model-ID behaviour, Dataverse ETag or client-ID audit semantics, Entra admission, real extraction, or capacity and scheduler behaviour.
  - Jobs stuck in a non-terminal state still need the operator resolution commands that are deferred to later work.

## Orchestrator disposition

| Finding | Disposition and verification |
|---|---|
| 1: Competing Request baselines | Accepted. `captureTarget` rejects a second baseline while a prior initialized job has pending writeback; the worker returns `waiting`. Real PostgreSQL tests cover released-slot and disjoint-field interleavings, then successful capture/publication with W/2. |
| 2: Nonterminating checkpoint failures | Accepted. Model mismatch is typed `profile_response_model_mismatch`, audited as failed validation, and releases the failed task's eligible slot. The real worker/Executor/SQL test publishes the successful sibling with exactly two provider calls. Unexpected saved-response or result/audit-payload checkpoint problems report `needs_attention`; explicit recovery may still reuse retained bytes. No claim of automatic operator resolution is made. |
| 3: Ambiguous audit delivery | Accepted. Exceptions default to `unknown`; only `error.definitive === true` records `failed`. Both states block publication in the worker and SQL store; neither is resent. Unit and real SQL/vertical tests cover these branches. |
| 4: Configuration retention | Accepted. Configuration uses result expiry, so delayed audits retain pinned prompt identity. Dispatch still requires an unexpired source snapshot. Real PostgreSQL tests verify both properties. |
| 5: Rejections and late authorization denial | Deferred as the reviewer permits, before any real-provider trial. Current conservative fencing is safe in this synthetic-only foundation; real adapters need explicit rejection/billing semantics and consistent permission-denial recovery. |
| 6: Legacy variables parsing | Accepted now. Whitespace-only and array metadata retain legacy behavior without an execution marker. Regression tests execute both legacy cases. Golden tool-prompt tests additionally verify the unchanged default preamble bytes. |
| 7: Encoded content limits | Deferred as the reviewer permits, before any real-document/provider trial. Real admission must relate encoded snapshot duplication and worst-case response size to storage limits. Current synthetic fixtures use small bounded content and budgets; this build does not authorize arbitrary-size real inputs. |

No architectural redesign or further full review round is warranted for these narrowly specified fixes. The required changes have targeted counterexample tests. This is the orchestrator's disposition of a conditional review, not a claim that the reviewer re-reviewed the amended code. Production enablement, live adapters, operational recovery and the two deferred findings remain outside synthetic acceptance.


## Final local verification

[VERIFIED 2026-11-11 via local commands] The combined Executor, payload-boundary, LLMClient, prompt-job and golden tool-prompt suites plus both PostgreSQL suites passed: **22 suites / 663 tests**, including **22 real PostgreSQL tests**. `npm run build` passed. Scoped ESLint, types, prompt-injection tagging, Atlas, status-enum parity, doc-symbol references, docs catalog and build-claim checks passed; each invoked gate/self-test pair ran sequentially. No schema change was needed for these fixes. No provider inference, live data write, push or deployment occurred.

The combined Jest argv was `npx jest tests/unit/execute-prompt- tests/unit/utils/ai-payload-boundary.test.js tests/unit/prompt-jobs- tests/unit/llm-client.test.js tests/unit/tool-prompt-parity tests/unit/tool-prompt-composer.test.js tests/integration/prompt-jobs-executor.pg.test.js tests/integration/prompt-jobs.pg.test.js --runInBand --silent`, with both required PostgreSQL scratch-URL environments set to the disposable loopback service. The runtime fixes are limited to the review dispositions above; the schema and production exposure are unchanged.
