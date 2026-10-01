---
title: Grantee-title generation deadline propagation
status: planned
domain: architecture
kind: plan
summary: Propagate the existing cron row deadline through the title wrapper into the Executor so timeout also cancels provider work and retry delays.
canonical: false
owner: product-engineering
---

# Grantee-title generation deadline propagation

[PLANNED] Root-authored plan for ordinary Fable OAuth review, then Luna implementation/validation, Sol review, root review, and final Fable adversarial review. Keep iterations bounded to substantive findings. PR #390 remains on hold and is not part of this change.

Base: `7a95313f49c95d5bdbbe7c906fbeabc2212e2627` (fetched main). Branch: `codex/grantee-title-timeout`. No implementation, production reproduction, merge, or deployment is claimed.

## Surface and verified baseline

- [VERIFIED via source/caller search] Entry is `pages/api/cron/generate-grantee-titles.js`: method/cron-secret/cycle validation and model warming precede trusted DAL context and `runGranteeTitleGeneration`. The only production caller of `generateGranteeTitle` is this cron service. No browser UI contract changes.
- [VERIFIED via `lib/services/cron/generate-grantee-titles-service.js`] The batch selects research requests in Invited status with an empty `wmkf_wmkfprojectdescription`, excluding test requests under the existing isolation policy. Four workers launch rows within a 70-second soft budget. Each valid row races `generateGranteeTitle` against a 40-second timer. Timeout increments failed and returns before the fresh read or title PATCH, but does not cancel the losing generation promise. Query-level errors remain 503; individual errors remain in the summary's failures.
- [VERIFIED via `lib/services/grantee-title-service.js`] The wrapper validates inputs, calls `executePrompt` with override variables/run source/forceOverwrite, cleans the returned objective, and returns metadata. It currently supplies neither deadline nor signal. It has no title write. The governed prompt is an override-only, `kind:none` producer; no prompt or model policy changes are proposed.
- [VERIFIED via `lib/services/execute-prompt.js:126-130,249-257,642-694,764-793`] Existing `deadlineMs` is an absolute epoch-millisecond deadline, validated by the Executor. Immediately before provider dispatch it refuses less than one second remaining; otherwise it clamps the per-attempt timeout and installs an abort signal spanning attempts and retry backoffs. The signal timer is cleared in finally. Default provider policy remains Anthropic; this task does not enable another provider.
- [VERIFIED via `lib/services/execute-prompt.js:149-257,268-348`] Prompt lookup/model/variable preparation precedes the dispatch check and is not cancelled by the provider deadline. Success/failure audit writes follow provider settlement and are also outside that deadline. Failure audit is attempted before rethrow. This fix must not describe the entire Executor/audit operation as cancelled or bounded to 40 seconds.
- [VERIFIED via cron write region and Atlas edited-title entry] After a timely generation, a fresh request read checks whether staff populated the field; a missing ETag fails; the write uses If-Match and classifies 412 as skippedConcurrent. These rules protect `akoya_request.wmkf_wmkfprojectdescription`, consumed as the board-summary objective. Executor audit rows use the existing `wmkf_ai_run` contract. No new persisted surface, status, enum, route, or migration.
- [VERIFIED via tests inspected] Existing Executor payload-boundary tests exercise expired deadlines, in-flight cancellation, and 429 retry-backoff cancellation with no second request. Existing title/cron tests characterize generation, selection, batch accounting, title cleanup, and conditional writes. Luna independently confirmed the transport cancellation path and ran eight mocked baseline suites: 137/137 tests passed (grantee-title-service, generate-grantee-titles-cron, cron-batch-services, execute-prompt-payload-boundary, execute-prompt-signal, execute-prompt-provider, llm-client, openai-client). No live services were exercised.

## Smallest proposed change

1. [PLANNED] For each valid row, capture `deadlineMs = Date.now() + ROW_TIMEOUT_MS` immediately before launching generation, and pass that exact value to `generateGranteeTitle`. Keep the existing outer Promise.race and its cleared timer. It remains a caller wait bound for slow preflight or audit work and a defense against a noncooperative dependency; it is not the provider cancellation mechanism.
2. [PLANNED] Add optional server-owned `deadlineMs` to the title wrapper and forward it unchanged to `executePrompt` when supplied. Omission/null preserves the existing no-deadline wrapper contract. Leave value validation and cancellation mechanics in the Executor; do not duplicate timers, introduce a second signal API, or edit shared Executor/provider runtime without demonstrated necessity and plan reconsideration.
3. [PLANNED] Preserve the 40-second row budget, 70-second launch budget, four-worker limit, summary shape/counting, runSource, prompt variables, cleanup, authority and write sequence. Do not turn the 40-second generation timeout into a deadline for the later Dataverse title write. A timeout still leaves the title empty for a future cron run. The losing generation promise cannot resume `processRow` after its catch returned, so no late title write occurs.
4. [PLANNED] Update the two source comments/contracts to distinguish caller timeout from provider cancellation. Keep documentation narrow: this plan and any directly contradicted live deadline claims found by bounded sweep. PR #390 and historical scan text stay untouched at the owner's request.

## Verification invariants

| Invariant | Required evidence |
|---|---|
| A cron row's fixed deadline reaches the real Executor | Wrapper forwarding assertion plus an isolated integrated cron → wrapper → Executor → real LLMClient path, with only external prompt/model/Dataverse/fetch seams mocked |
| A hanging provider request is cancelled at the row deadline | Fake-timer integrated regression captures the real fetch signal, proves it aborts, observes one failed row and no title PATCH; must fail if either forwarding hop is removed |
| A retry cannot outlive the row deadline | Return 429 with a retry delay crossing the deadline; advance time and assert no second provider attempt, failed row, no title PATCH |
| Slow preflight cannot start paid work after timeout | Defer prompt lookup beyond the outer timer, then release it; real Executor rejects expired deadline before provider fetch and attempts existing audit handling; title remains unwritten |
| Late completion and slow audit cannot block the batch indefinitely or write a title after timeout | Deferred generation success after outer timeout and deferred audit completion; batch returns failed at the outer bound; release deferred work and assert no title write and no unhandled rejection |
| Success and other failures preserve behavior | Timely generation persists once with fresh ETag; staff-populated and 412 cases skip; empty/malformed source and refusal/error remain isolated; other rows proceed; omission of deadline keeps wrapper behavior |
| Timers are cleaned | Settled fast generation leaves no cron timer; integrated provider deadline clears after completion/abort; restore fake timers/mocks after tests |

[PLANNED] Use production-shaped synthetic prompt/row fixtures, no live provider/Dataverse calls or production frequency tests. Reuse existing Executor/transport tests rather than broadening their runtime. Prefer a focused integrated test file over repeating mock-only plumbing assertions. Delayed tests must populate the event they exclude, attach rejection handlers before advancing timers, and await the actual terminal assertions. Assertions must not pass on a pre-settlement intermediate render/result.

[PLANNED] Run focused title/cron/Executor/LLM regression suites; types, lint, canonical build; relevant gates and available self-tests serially (api-routes, atlas, route-service-boundary, dynamics-context-boundary, dataverse-access-layer, model-override-warming, prompt-injection-tagging, secret-scan, doc-currency, doc-symbol-refs, build-claim-freshness, docs-catalog). Discover exact scripts from package.json. Run full Jest once the reviewed behavior is stable. A sandbox Turbopack process/port failure gets the documented host retry, not an application-code workaround.

## Limits, review and release

[ASSUMED risk] Cancellation signals stop this application's cooperative fetch/retry activity; they do not prove the remote provider stopped computing or stopped billing. No savings, live incidence, or live audit-completion guarantee is claimed. Preflight/audit I/O can settle after the outer timeout, as today. This fix is not a general background-job, audit durability, concurrency, or cron-deadline redesign. Provider transport is expected to cooperate with its existing abort contract; ignored aborts remain bounded only at the caller and cannot cause a title PATCH.

[PLANNED] Conservative Tier 2 because this is background work adjacent to Dataverse writes. Use the existing isolated Mode A approach to rehearse timeout/partial-success behavior. Open a reviewed PR after green validation. Production promotion is a later explicit owner decision; record the then-current successful production rollback deployment at that point. Source rollback is reverting this PR, with no schema or data repair. No milestone has shipped during planning.

[VERIFIED via GitHub open-PR file lists] No open PR changes the two title runtime files or shared Executor/LLMClient. PRs #332/#328 touch separate catalog entries; PR #390 is the held assessment. Recheck overlap before publication/promotion.

Review record: plan Fable verdict pending; baseline 8 suites / 137 tests passed; implementation and final review pending.
