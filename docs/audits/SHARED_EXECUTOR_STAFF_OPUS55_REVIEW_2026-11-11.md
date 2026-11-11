# Shared Executor staff workflow: Opus review and verification

**Final source-review verdict: READY.** Runtime closure commit: `5652c96dd`; scoped inspection/documentation: `f6356e8f1`. Both reviews ran through the owner-authorized Claude Code subscription OAuth session, with only Read/Grep/Glob enabled. Each successful result's `modelUsage` contains only `claude-opus-5-5`. No advisor, alternate model, model API-key authentication, or metered review product was used.

## Disposition

The first review required more time between job claim and provider dispatch. The staff lease is now 240 seconds, the provider deadline is five seconds before lease expiry, the route limit is 300 seconds, and the bounded local runner allows 305 seconds. These are coordination/platform limits; the existing provider timeout and admin-editable prompt output budget are preserved. This gives source/auth checks room without claiming any measured live-provider latency guarantee.

We also resolved known source-error reporting, pre-preparation source expiry, expiry during snapshot save, discovery's version-race retry, and terminal receipt reporting from a drain with no runnable candidate. A genuinely empty or disabled drain exits 2; only a verified completed receipt yields CLI exit 0. The browser keeps the original command key for both known failures and uncertain submissions.

The orchestrator accepts the named fail-closed limits: unexpected checker errors wait for another explicit drain; an abort after durable dispatch intent can remain unknown even if HTTP had not begun. Neither case permits automatic regeneration. Unscheduled preparation can exceed the lease and require another drain; its source-expiry check prevents repeated downloads after the source deadline. No further review iteration is required for this branch slice.

## Integrated verification

[VERIFIED via local commands after closure] **1,110 tests across 50 suites passed**, including the three real PostgreSQL suites on a disposable loopback PostgreSQL 16 database, canonical Executor tests, staff routes, source-adapter tests, Admin profile/task publication, and Workbench UI regressions. The real-SQL tests use fabricated source data and doubles for provider, source observations, identity and audit writes. They do not prove live inference or Dataverse write behavior.

The full `npm run build` exited zero after the fixes. Scoped ESLint passed; the separately linted existing `PromptTemplatesSection` retains its pre-existing effect warning. The application build retains four pre-existing DOCX tracing warnings and the `_app` static-optimization warning. The staff UI was inspected with actual Card/Button controls and mocked endpoints at desktop width and 390px; its document scroll width was 390px. The harness server was stopped. No screenshots were saved.

The security/contract gate set comprises API routes, Atlas, document currency, canonical facts, document symbols, DAL, Dynamics contexts, route/service boundaries, prompt injection, GUID boundaries, and secret scanning, each followed sequentially by its self-test; docs catalog, migration manifest, and type checking also pass. All 25 checks passed again after the final documentation reconciliation. The owned scratch PostgreSQL container was removed after testing; other agents' containers were left untouched.

The candidate profile/tasks passed the real Admin preview validator with fabricated material. This integrated local verification preceded publication and the live application trial. It made no deployment, Request field write or AI-run audit write.

## Authorized live-read boundary

The initial owner-authorized inspection of Request 1003384 found a populated Project Leader and eight Submission-Documents files. The nominal narrative was a placeholder test application and the larger packet combined that application with assorted attachments. The owner later uploaded `ProposalNarrative_1003384.pdf` to AI Materials. A second owner-authorized read-only probe used the default adapter to verify the unique accepted alias, stable version and bounded preparation with the directly sourced PI record. The source policy stayed the same. Neither probe made a provider call or wrote data. See the [staff trial source receipt](../plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#verified-owner-uploaded-trial-source).

These source probes preceded the separately approved live application trial and did not measure provider latency, cache use or audit attribution.

## Live operation review and disposition

The separate live operation review returned NEEDS NAMED CHANGES. Its primary
model was Claude Opus 5.5. The JSON receipt also recorded a Claude Fable 5.2
advisor inherited from the review configuration. This receipt is distinct
from the two Opus-only development reviews quoted below and from the Sonnet
4.6 application calls.

| Finding | Disposition |
|---|---|
| Compare exact migration filenames and confirm the application database before applying 097 | Verified the exact pending set against the configured application Postgres target, rehearsed the DDL in a transaction and rolled it back, then applied only 097 through the canonical runner. The fresh-install concern is resolved by existing source. `scripts/setup-database.js` delegates to the manifest-backed fresh bootstrap. |
| Scope local production Dataverse writes | Used the DAL and target interlocks with a short-lived process-only grant for collection POSTs to settings, prompts and AI runs. Verified Request PATCH was denied. The runner checks AI-run identity, Request and caller impersonation. |
| Prove the exact reviewed document reaches dispatch | Verified the owner-approved file SHA-256 before admission. The runner compared the persisted canonical snapshot hash with the pre-admission value before dispatch. |
| Complete and fence publication inputs | Used fixed task catalog titles, the verified profile ID and persisted publication UUIDs plus a stable admission key. The SQL-over-HTTP guard permits expected reads and the existing scoped publication and usage writes. |
| Recover audit uncertainty and preserve retention scope | Reuse the stable audit ID for readback if delivery is uncertain. Content expiry operates on the exact cohort and leaves receipts intact. No automatic replay of uncertain provider or audit outcomes. |

The operation review and the preflight did not themselves authorize application
spend. The owner explicitly approved the bounded live trial separately.

## Final live outcome review

The targeted receipt review used Claude Opus 5.5 alone according to the
review JSON's `modelUsage`. It confirmed **PARTIAL / `needs_attention`**,
two approved provider calls, the cache hit, the truncation, and both
audit attributions. The qualitative PI-attribution finding remains a
quality failure. The reviewer assessed the receipt and candidate
configuration without reading the PDF or draft text.

| Finding | Disposition |
|---|---|
| The reviewer saw an older audit receipt without the content checks | The final read-only inspection confirmed absent raw output and prompt override on both rows and the bounded audit notes. The earlier receipt was read while inspection was completing. |
| A conditional snapshot-hash check could skip an empty value | The first worker tick prepares and returns. Migration 097 requires the snapshot ID and hash to be populated together, and `saveSnapshot` freezes them. The live stored hash matched the approved hash before dispatch. The runner now requires and records the matching pair after preparation. |
| The HTTP fetch guard does not govern the job store's database connection | Recorded the distinct boundaries. The fetch guard covers HTTP writes, and the scoped ledger uses its own Postgres transactions. |
| The one-shot runner cannot publish the retry candidate | Intentional. The runner is bound to the original profile and v1 task creates for this cohort. A future versioned update and another cohort would require separate approval and a reviewed operation. |
| Scoped expiry should confirm the exact persisted job | Cleanup checks the stored job ID under the full cohort scope and remains available after actor revocation. Codex or the operator owns the two dated manual cleanup steps in the [retention receipt](../plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#scoped-retention-follow-up). |
| Consider removing the PI name placeholder | The actual preview rejected the candidate without the required frozen-record placeholder. It was restored as context-only with output restrictions. Both unpublished candidate inputs passed offline validation. The 400-word ceiling is a planned buffer, and live generation behavior remains unverified. |

## First Opus review — verbatim

# Verdict: READY WITH NAMED CHANGES

I found no safety, authorization, spend-cap or receipt defects in what I read. One timing problem should be fixed before anyone runs the live drain, because one timeout can use up the whole one-time trial. I used exactly 20 Read/Grep calls. Nothing was run, executed or written, and no live system was touched.

## Required before a live drain

**1. A 55-second deadline can use up the one-time trial and still bill a call.**
- **Where:** `/private/tmp/wmkf-coordinated-start-2026-11-10-b/lib/services/prompt-jobs/staff-worker.js:39`, `/private/tmp/wmkf-coordinated-start-2026-11-10-b/lib/services/prompt-jobs/worker.js:112-113`, `/private/tmp/wmkf-coordinated-start-2026-11-10-b/lib/services/execute-prompt.js:822,840`, `/private/tmp/wmkf-coordinated-start-2026-11-10-b/pages/api/cron/drain-prompt-jobs.js:5`
- **The setup:** the lease is 60s and the deadline is the lease minus 5s. The deadline timer starts before `onDispatch`.
- **What eats the window before the model call starts:**
  - one staff check (`authorize`, which calls `eligibleStaff`);
  - a full source re-check at `worker.js:102`. It reads the Request and the contact, runs a buckets lookup, then does about three Graph metadata reads (`proposal-source.js:169-177`, `:259-262`);
  - the same check again inside `onDispatch` at `worker.js:118`;
  - `markDispatching`.
- **How it fails:** the model call then gets whatever time is left. The input can be up to about 256 KiB of extracted text plus 1,536 output tokens, and the first task has an uncached prefix.
  - If the deadline hits after `markDispatching`, the task is marked `unknown` / `provider_outcome_unknown` (`worker.js:136`), and a call may already have been billed.
  - Jobs with an `unknown` task are never picked again (`store.js:368-371`).
  - The cohort check rules out a second job under the same trialId (`store.js:266-268`).
- **Caveat:** I can't confirm real model latency, so this is a risk rather than a measured failure. But a single timeout costs the whole trial.
- **Fix:** raise `leaseMs` (the store allows up to 300000, `store.js:384`) to about 240000 and the cron `maxDuration` to 300. The alternative is measured evidence that the end-to-end call reliably fits in under 45s.

## Recommended before the trial (cheap)

**2. Predictable admission failures look like "maybe accepted".**
- **Where:** `/private/tmp/wmkf-coordinated-start-2026-11-10-b/lib/services/prompt-jobs/proposal-source.js:32-38`, `staff-service.js:95,100-107`, `pages/api/workbench/prompt-jobs/index.js:19-21`, `shared/components/workbench/ProposalDrafts.js:146`
- **The problem:** these are plain Errors, not `ServiceHttpError`, so the route returns a 500 for them:
  - `proposal_source_missing`, `proposal_source_ambiguous` and `proposal_source_pi_missing`;
  - prompt/capability mismatches thrown by `validateTaskCapability` (`capabilities.js:40-46`).
- **Effect:** the UI then says "The request may have been accepted. Retry…" and keeps the stored idempotency key. These are the most likely first-run failures (for example, a missing or ambiguous AI Materials PDF). Staff can't tell them apart from a transient error, and every retry repeats the Dataverse and Graph reads.
- **Fix:** map the source and contract codes to `trialError(code, 409)`, and add them to a safe list the UI can show.

## Worthwhile later items (not blockers)

**3. The source-preparation step can retry indefinitely.**
- **Every read error counts as transient.** All non-404 errors, including 401/403, become `isTransient` (`proposal-source.js:76-83`). The worker rethrows them (`worker.js:72`), so the job stays queued and each tick 500s.
- **Expired source has no terminal path.** After 24h (`staff-service.js:113`), `saveSnapshot` fails with `prompt_job_source_expired` (`store.js:438`). That code is not in the terminal list at `worker.js:72`, so every tick downloads up to 20 MiB again until the configuration expires at 7 days. Meanwhile the UI shows "queued".
- **The lease can expire mid-step.** Two inspections, a 20 MiB download and PDF extraction can run past the 60s lease. The fenced save then throws, causing the same loop.
- **Fix:** check `job.source_expires_at` before reading the source, and treat the expired code as terminal.

**4. Errors from the pre-dispatch check become "waiting" forever.**
- **Where:** `worker.js:33-35,40`.
- **The problem:** every error counts as "unavailable", including permanent `isCurrent` manifest errors. Nothing is spent, but the job never reaches a final state.

**5. An abort before the provider call is recorded as `unknown`.**
- **Where:** `execute-prompt.js:858-861`.
- **The problem:** if the deadline fires during `markDispatching`, the abort happens before `client.complete`. `worker.js:136` still records `unknown`. That is fail-safe, but it uses up the trial without any model spend.
- **Fix:** pass a "not called" signal back to the worker.

**6. A version race can hide the drafts panel.**
- **Where:** `staff-service.js:52-55,62` and `ProposalDrafts.js:80,84`.
- **The problem:** `listJobs` and `readValidatedResults` run in separate transactions. If the worker bumps the version in between, the whole list returns 409. The UI then sets `enabled=false` with no retry, so the panel vanishes mid-run until remount.

**7. The trial script exits 0 on `idle` even when the job needs attention.**
- **Where:** `scripts/run-prompt-job-trial.mjs:31`.
- **The problem:** jobs with `unknown` tasks or `failed`/`unknown` audits are not picked (`store.js:368-371`), so the tick returns `idle`. The message does say idle isn't success, but a wrapper checking the exit code would read it as success.

## Claims I checked in source
- **Proposal tasks enabled only in closed environments:** `capabilities.js:17-25`; `store.js:152-167`; `worker.js:59`; `execute-prompt.js:419`.
- **Environment = deployment × actual Dataverse target:** `trial-policy.js:16`. Read paths use `DYNAMICS_URL` (`read-ops.js:70` etc.). An unlisted host classifies as `unknown`, which fails with a 503. A Production deployment can't match the allowed list.
- **Explicit trial gate:** exact keys, lowercase GUIDs, impersonation and nonce-secret length (`trial-policy.js:18-25`). Then the actor/Request match plus the `eligibleStaff` superuser and profile check, re-checked before admission (`staff-service.js:15-16,111`) and at every worker stage (`staff-worker.js:24-30`).
- **One job per cohort, across principals and environments:** cohort advisory lock plus an unscoped `authorization_scope` check (`store.js:252-268`). The limit holds within a trialId; a new trialId starts a new cohort.
- **At most 2 calls, no retries:** the profiled `userContent` (`context.js:92`) turns on `maxRetries:0` (`execute-prompt.js:833`). Dispatch only moves a task out of `queued` when no other task is dispatching or `unknown` (`store.js:499-500`). `clearLease` marks interrupted work `unknown`, with no retry path.
- **Replay before reading mutable inputs:** `staff-service.js:89-93`. The payload hash leaves out the configuration (`store.js:247`).
- **Source freshness and PI:** the manifest, including the PI-name hash, is checked before and after download and at dispatch. The shared prefix is `context.js:92`.
- **Result availability reflects retained content:** `store.js:349-354`, `staff-service.js:38`.
- **Expiry keeps receipts:** it deletes only content rows (`store.js:695-709`). There is no foreign key on `snapshot_content_id` (`097_shared_prompt_jobs.sql:14`).
- **Audit:** the run ID is stable, it requires impersonation with `noFallback` (`staff-worker.js:11-14`), and `unknown` outcomes are not retried.
- **Disabled policy and cleanup:** a disabled policy returns before any DB access (`staff-worker.js:17-18`), and cleanup is scoped to the cohort.
- **UI:** 401/403 resets the panel (`ProposalDrafts.js:68,75,94`), and the stored key is kept when a submission's outcome is uncertain.

## Not inspected
- `prompt-profiles-service.js`, `SharedPromptEditor`, `PromptTemplatesSection`.
- The bodies of the `[jobId]` routes beyond their auth lines.
- The 256 KiB extracted-text cap in `context.js`.
- Whether `acceptedProposalNarrativeFilenames` allows only PDFs.
- How Graph `downloadFile` enforces `maxBytes`.
- Whether `LLMClient` honours `maxRetries:0`.
- The `ai-run` adapter and the `eligibleStaff` implementation.
- Any tests or docs.

## What only a live run can prove
Everything above comes from reading code. These need a live run:
- real model latency against the deadline;
- how the interlock treats the trial's Dataverse reads;
- Graph and SharePoint behaviour, including eTag stability across the download;
- whether impersonated audit writes succeed;
- whether the Request's AI Materials folder has exactly one PDF.

## Targeted Opus follow-up — verbatim

I've finished the source reads and am writing up the verdict now.

# Verdict: READY

The required deadline fix is closed in source, and so are the cheap fixes you named. I found no new regressions in what I read. I made 10 read-only Read/Grep calls and called no advisor, other model or live system.

## Required finding #1 (the 55-second deadline): closed

- **Longer lease:** `staff-worker.js:44` now passes `leaseMs:240000`, which is under the store's cap at `store.js:384`.
- **Deadline follows the lease:** `worker.js:118-120` sets the deadline to the claimed lease end minus 5s, about 235s from the claim. `onDispatch` re-checks that deadline after the dispatch check and before `markDispatching` (`worker.js:124`).
- **Model timeout is still capped:** `execute-prompt.js:978-989` uses the smaller of the default timeout and the time remaining. The deadline can only shorten the model timeout, never lengthen it.
  - I did not read the `DEFAULT_TIMEOUT_MS` constant itself, so the 120s value is [ASSUMED].
  - I also did not read the admin output-budget code. That the budgets are unchanged is [ASSUMED] from your statement.
- **Time limits stack up correctly:**
  - Cron `maxDuration` is 300 (`pages/api/cron/drain-prompt-jobs.js:5`).
  - The local runner's `AbortSignal.timeout(305000)` is at `scripts/run-prompt-job-trial.mjs:23`.
  - So the order is: deadline (~235s) < lease (240s) < function limit (300s) < local runner (305s). A healthy model call can no longer use up the trial.
- **Coordination fence:** I didn't find anything new under that name. The live-lease checks I did see in `store.js:397-404` and `:417` are consistent with it.

## Named cheap fixes: all closed

**Expired source (later item #3, partly):**
- `worker.js:64-67` checks `source_expires_at` before the prepare authorization, before reading the configuration and before any source I/O. An expired source fails each queued task as `expired` / `content_expired`.
- `prompt_job_source_expired` is now in the terminal list and maps to `expired` (`worker.js:76-77`).
- `isTransient` is still checked first and rethrown, so transient errors stay queued for a later explicit drain. That matches your intent.

**Admission errors (#2):**
- `staff-service.js:98` maps the missing, ambiguous, PI-missing and invalid-metadata source errors through `trialError(code)`.
- A failed `validateTaskCapability` maps to `prompt_job_source_contract` (`staff-service.js:105`).
- `trialError` defaults to 409 (`trial-policy.js:8`).
- `ProposalDrafts.js:12-20` lists the exact codes, and `:158` shows the message without clearing the stored recovery key.
- [ASSUMED] that the route turns `trialError` into its HTTP status. I didn't re-read `pages/api/workbench/prompt-jobs/index.js`.

**Panel discovery (#6):**
- A 409 `prompt_job_changed` retries after `POLL_MS` (`ProposalDrafts.js:88-90`), and a 401/403 resets the panel (`:87`).
- Discovery only runs while the page is visible (`:79`). Its cleanup clears the retry timer and aborts the request (`:99`).
- Status and result polling are also visibility-gated (`:102`, `:120`), so a hidden page doesn't poll.

**No-candidate tick (#7):**
- With no runnable job, the tick now reads the scoped receipt with `listJobs` and reports `complete`, `needs_attention` or `expired`. Anything else becomes `unavailable`, and `idle` is returned only when no job exists (`staff-worker.js:32-37`).
- Passing `null` results is safe because of `results?.results` (`staff-service.js:38`).
- CLI exit codes: `complete` exits 0, `idle`/`disabled` exit 2, and every other stop or error exits 1 (`run-prompt-job-trial.mjs:31,34,36`).

## Remaining limits, accepted as you described

- **#4:** any error from the pre-dispatch check still returns `waiting` (`worker.js:33-35,40`). Nothing is spent.
- **#5:** an abort after `markDispatching` but before the provider call is still recorded as `unknown` (`worker.js:142`). This is fail-safe and leaves no automatic retry.
- **Discovery errors other than `prompt_job_changed`** still hide the panel until it remounts (`ProposalDrafts.js:95`). That was already true and isn't a regression.
- **Source preparation has no deadline.** If it runs past the 240s lease, the fenced save throws and the job stays queued for a later drain. Nothing is spent, and you already treat this as a later item.

## Not checked

- The unit and real-Postgres test files, and the final regression results.
- The `DEFAULT_TIMEOUT_MS` value.
- The route's mapping of trial errors to HTTP status.
- The 1003384 source finding. I agree it doesn't change the code readiness above.

## Handoff

Owner: Codex orchestrator. Branch: `codex/coordinated-start-2026-11-10-b`, isolated at `/private/tmp/wmkf-coordinated-start-2026-11-10-b`.

Status: staff workflow, source adapter, controlled runner, Admin capability extension and scoped SQL reads/quota/expiry are committed and verified locally. Runtime closure is `5652c96dd`; follow-up evidence is this receipt. No push, merge, deployment, live generation, or Request write occurred. Documentation is committed with the receipt; the final worktree check must be clean.

The owner-approved service-level trial used the verified narrative and process-scoped activation. It exercised two application calls and cache reuse. The Executive Summary passed format validation and requires PI-attribution review. The Methodology hit the output-token limit and failed validation. See the [live trial outcome](../plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#live-generation-outcome).
