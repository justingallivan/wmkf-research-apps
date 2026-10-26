---
title: Reviewer acceptance defaults — independent revised-plan review
domain: reviewers
kind: audit
status: active
summary: "Historical target1aef57b70: Claude READY WITH NAMED CHANGES; owner policies confirmed. Receipt adapter, retry arithmetic, terminal alert, settlement order and test-seam corrections incorporated afterward; closure review pending."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md
---

# Revised-plan review — 2026-10-26

[VERIFIED via host ordinary subscription OAuth Claude.] Exact target 1aef57b70,
Read/Grep/Glob only; no edits/scratch plan, shell/tests, secrets, other checkout,
live data, advisor/subagents or metered products. Report below is verbatim and
is historical evidence, not a review of subsequent corrections.

**Verdict: READY WITH NAMED CHANGES.** I re-reviewed the plan at HEAD `1aef57b70`, using contract-reconcile Mode A.

The core design holds against the source: prepare everything first, recheck, commit the claim under the lease token, then send the frozen message. Corrections R1–R8 are mostly in place, but I found one High and four Medium problems that need named changes before coding. As you instructed, I made no edits. That includes the plan-mode scratch file, so this reply is the deliverable.

## Step 0
- **Change surface:** one personal subject/body pair for automated acceptance confirmations, plus moving email preparation ahead of the claim.
- **Entry points:** Profile Settings, a new preference route, and the drain's `sendAcceptanceConfirmationOnce` step.
- **Persistence:** `wmkf_appuserpreferences`, `reviewer_acceptance_jobs.steps`, `system_alerts` and `operational_events`.
- **Consumers:** the drain cron and Maintenance runs, alerts and operational events, existing tests, and the security matrix, Atlas and counts.
- **Prior findings checked:** R1–R8, plus owner decisions O1 and O2.

## Findings

**1. HIGH — The real email transport never returns `{sent:true}`, so every real send would be recorded as uncertain.**
- Evidence:
  - The real Dynamics send returns `{ emailId }` (`lib/services/dynamics/email.js:331,368`).
  - Today the `sent:true` comes only from the wrapper, which ignores that return value (`reviewer-acceptance-email.js:168-184`).
  - Plan lines 150-154 require an explicit `{sent:true}` from the drain's transport, and describe the new `sendPreparedAcceptanceConfirmationEmail` as "transport-only".
- If someone builds that literally, every production confirmation gets no `sentAt` and raises an "uncertain" alert. Mocked tests that return `{sent:true}` would still pass.
- **Required change:**
  - Define the return value: `sendPreparedAcceptanceConfirmationEmail` awaits the Dynamics send and returns `{sent:true, emailId}` once it resolves.
  - Only an injected transport result is checked for an explicit `sent:true`.
  - Add one test that runs the real send-prepared function against a mocked Dynamics send resolving `{emailId}` and checks that `sentAt` is recorded.

**2. MEDIUM — The retry-window figure is too optimistic.**
- Evidence:
  - `attempts` starts at 0 (`setup-database.js:522`). The job is marked failed when `attempts+1 >= 8` (`job-service.js:291-292`). So eight attempts have **seven** retry gaps, not "eight 300-second retries" (plan line 234).
  - A job is only picked up once `next_attempt_at <= NOW()` (`job-service.js:210`), and the cron runs every two minutes (`vercel.json:120-121`).
  - Each 300 s delay therefore rounds up to 360 s, or 480 s if a pass takes more than about 60 s. Jobs drain at most 5 per run by default (`cron:29`, `job-service.js:212-213`), so a backlog delays further.
- **Required change:** replace "roughly 35–40 minutes" with: about 42 minutes nominal (7 × 6 min) from a refusal on the first attempt to exhaustion; longer under backlog or slow passes; shorter if earlier attempts were already used (for example 60 s retries at `drain:496,525`). 35 minutes (7 × 300 s) is only the theoretical floor if the cron ran continuously.

**3. MEDIUM — The plan doesn't say where the terminal "send by hand" alert fires.**
- Evidence:
  - Whether a job is now terminal is only known in the outer loop, after `recordReviewerAcceptanceJobFailure` returns `status === 'failed'` (`drain:945-960`).
  - `processReviewerAcceptanceJob` has no `maxAttempts` (`drain:948`), and the claimed `job` snapshot is stale by then. The fresh row comes back from the failure update (`RETURNING *`, `job-service.js:306-307`).
- **Required change:** emit the `:terminal` alert in the outer loop when all of these hold:
  - `updated.status === 'failed'`;
  - the job is not a repeat acceptance;
  - `updated.steps.acceptance_confirmation` has no `claimedAt` or `sentAt`.

  This one hook covers both exhaustion and a terminal sibling failure. A test must cover both paths.

**4. MEDIUM — The alert and operational-event settlement as written would make untrue recovery claims.**
- Evidence:
  - `AlertService.autoResolve(key)` takes no note and always calls `markRecovered` (`alert-service.js:294-313`). Settling only touches events still `open` (`operational-event-service.js:340`).
  - So "auto-resolve with a superseded note" (plan lines 243-245) is impossible. Calling `autoResolve` on cancellation would mark the events *recovered*.
  - A durable operational event only exists if the alert is `error`/`critical` or opts in with `operationalEvent` (`notification-service.js:89-108`).
  - The drain cancels in many places: `drain:581` and `:610`, the cancellation branches inside `verifyAcceptedOrCancel` (`:491-536`), and the post-honorarium blocks at `:711` and `:730`. Only `:716` and `:737` settle anything today.
  - Outside the drain, `respond-service.js:341` and `terminal-transition.js:380,403` cancel unleased jobs, and the drain never sees those jobs again.
- **Required change:**
  - Opt the preparation alert into `operationalEvent`.
  - On cancellation, call `OperationalEventService.markSuperseded(key, {note})` **first**, then `AlertService.autoResolve(key)`.
  - Settle once in the outer loop whenever a job ends `cancelled` (`drain:922`).
  - Document that cancellations from outside the drain leave a stale preparation alert.
  - Optionally, settle the non-terminal preparation key when the claim commits, since preparation succeeded and the after-claim outcome has its own alert.

**5. MEDIUM — The test-migration list misses a real-sender test and an intended behavior change.**
- Evidence:
  - The notification trust-model test at `notification-trust-model-pushup.test.js:1118-1131` uses the **real** default sender with a blank shared subject and expects `status: 'completed'`. Under the plan, missing shared defaults become a retryable refusal, so this test changes. It isn't on the plan's list because it doesn't inject `sendAcceptanceEmail`.
  - The plan's justification for "undefined transport receipt" is wrong: both injections in that file (`:1012`, `:1358`) run repeat-acceptance jobs (`:1016`, `:1325`), so the transport is never called.
  - The drain tests have no `jest.mock` for the adapters (`drain.test:80-112`). Default preparation and request-reader seams would reach real modules.
- **Required change:**
  - State plainly that blank or missing Admin defaults stop completing jobs: they now retry and then fail. This also makes the existing alert copy true ("the email was not sent so the workflow can recover", `email-defaults.js:10`).
  - Update the trust-model test to expect `followup_retry_required`, with adapter mocks.
  - Inject all four new seams into every shared deps helper, or derive the suggestion reader from the injected `suggestions`.
  - Keep the "fail loudly" rule from breaking that intentionally real-path trust-model test.

**6. LOW — Some lookups and checks are narrower than the plan's wording.**
- Signature lookup re-reads the request and PD on its own and swallows every error (`email-signature.js:57-84`). It isn't tied to the frozen PD. Say this existing behavior is retained; no code change.
- The isolation-checked request ID exists only when isolation is on (`drain:603-605`). Make the equality check conditional on that.
- A record read throws on 404 rather than returning null (`read-ops.js:133-135`). Under O2, a deleted PD user now retries to exhaustion, where today the generic fallback sends. Document this residual.
- There is no CR/LF check on shared Admin subjects in `email-defaults.js`. Refusing an authored multi-line shared subject is therefore a new refusal of Admin copy; state it.

**7. LOW — The combined navigation guard needs one more definition.**
- The thank-you controller treats any in-flight operation, including a clean read, as guarded, and shows "pending… may already be saved" (`ReviewerThankYouDefault.js:47-48,66-68,79,140`).
- Its `confirmContextChange` prompts and resets in one step (`:138-144`). The combined guard needs a reset that doesn't prompt.
- Decide explicitly whether "a clean pending GET doesn't warn" also changes the released thank-you behavior, or applies only to the acceptance editor.

## Verified as sound
- **R2 (single page-level guard):** both of the page's call sites go through the thank-you controller (`profile-settings.js:247,737`), and the hook owns the router's single Back-handler slot (`hook:36-54`). The single combined guard is correct.
- **R8:** all three preference sets contain the thank-you key (`user-preferences.js:37,52,59`). Naming follows the precedent (`reviewerFinderPreferences.js:39`). `decrypt` is called even on a null token (`drain:440`), so checking for a missing token first is correct.
- **O1:** the renderer uses one replacement map for subject and body (`email.js:57-75`), so separate maps are needed. Three test files and the `respond.js:36,45` re-export pin the public renderer.
- **O2:** today a thrown PD lookup falls back silently (`email.js:105-113`), confirming the change is needed.
- **Fire-once:** each claim mints a new lease token, and step writes require it (`job-service.js:204,252`). Preparation metadata without `claimedAt` doesn't trigger the skip check (`drain:427-429`).
- **R1:** the reviewer re-accept path doesn't reset `attempts` (`job-service.js:117-139`). A run with only retried jobs still completes (`cron:41`).

## Recommendation Evidence (all NOT TESTED)

| Recommendation | Current prerequisite | Available at execution point | Disconfirming check | Status |
|---|---|---|---|---|
| Send-prepared returns `{sent:true, emailId}` | `dynamics/email.js:368` | yes | Real function with mocked Dynamics send `{emailId}` → expect `sentAt` | VERIFIED (source) |
| ~42-minute window | `job-service:210,291`, `vercel.json:121` | n/a (docs) | Scratch-DB clock simulation | VERIFIED (arithmetic) |
| Terminal alert in outer loop | `drain:946-955`, `job-service:307` | yes | Sibling failure marked non-retryable plus refusal → one terminal alert | VERIFIED (source) |
| `markSuperseded` before `autoResolve` | `alert-service:309`, `op-event:340` | yes | Wrong order → event ends `recovered` | VERIFIED (source) |
| Migrate trust-model test at `:1118` | `pushup:1118-1131` | yes | Build, then run the suite unchanged → expected to fail | ASSUMED (unbuilt) |

## Seven audits
1. **Whole-flow:** server hops traced end to end. The route and UI aren't built, so for those I checked the plan against the thank-you precedent.
2. **Partial-success:** sent, skipped and uncertain stay separate. The transport receipt (Finding 1) and terminal accounting (Finding 3) need the fixes.
3. **Stale async:** the lease token plus the pre-claim recheck hold. The signature read is outside the snapshot (Finding 6). Client epochs follow the precedent, and the guard needs the Finding 7 decision.
4. **Helper extraction:** the preserved items match `email.js:125-183`. The send-prepared return value was undefined (Finding 1).
5. **Durable surfaces:** no schema change. Step JSON plus the alert and event rows; route and key catalogue and count updates are noted in the plan.
6. **Docs:** fix the window figure (Finding 2), the "superseded note" claim (Finding 4), and the R3 rationale (Finding 5).
7. **Symbol fan-out:** the new key belongs in all three sets. The new alert keys must reach every cancellation exit (Finding 4).

**Required named changes:** Findings 1–5. Findings 6 and 7 are wording or decision clarifications and don't add scope.

## What I read
- **In full:** the plan, the initial review, `contract-reconcile/SKILL.md`, `reviewer-acceptance-drain.js`, `reviewer-acceptance-job-service.js`, `reviewer-acceptance-email.js`, the drain cron route, `email-defaults.js`, and the thank-you unsaved-changes hook.
- **In part:**
  - Services and adapters: `reviewer-suggestion.js` 1300-1344, `alert-service.js` 10-99 and 285-324, `operational-event-service.js` 310-349, `notification-service.js` 40-129, `dynamics/email.js` 320-369, `read-ops.js` 110-139, `email-signature.js` 20-94, `reviewer-thankyou-sweep.js` 40-149, `ReviewerThankYouDefault.js` 15-145, `profile-settings.js` 236-265.
  - Tests: `drain.test` 1-185, trust-model test 990-1029, 1085-1134 and 1305-1367.
  - Grep only: the rest of the trust-model test, `system-user.js`, `grant-request.js`, `vercel.json`, `setup-database.js`, `user-preferences.js`, `reviewerFinderPreferences.js`.
- **Not read:** `respond-service.js` internals (I relied on the initial review's citations), `terminal-transition.js` bodies, `applyTemplatePlaceholders`, the thank-you route, and the Admin settings UI.
- **Limits:** I used only Read, Grep and Glob. No shell, tests, edits, network, secrets, subagents, advisor or metered tools. The earlier 63-test baseline only describes the current code.
