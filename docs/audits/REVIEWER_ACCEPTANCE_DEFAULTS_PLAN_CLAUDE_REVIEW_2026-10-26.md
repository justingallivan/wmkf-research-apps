---
title: Reviewer acceptance defaults — independent plan review
domain: reviewers
kind: audit
status: active
summary: "Claude READY WITH NAMED CHANGES on fc3097adb. Recovery and combined navigation-guard corrections required; revised draft incorporates source-backed fixes, with two owner policy choices pending. No runtime implementation."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md
---

# Initial independent plan review — 2026-10-26

[VERIFIED via host Claude subscription OAuth CLI.] Read/Grep/Glob only, hooks/MCP
and session persistence disabled. No keys, metered product, edits/scratch plan,
other checkout, DB access or live sends. Target `fc3097adb`. Report verbatim below.
This is the initial review; it does not review the later revisions. No coding or
release authorized.

**Verdict: READY WITH NAMED CHANGES.** The core design holds up against the source. Preparing everything before the claim, then claiming under the lease token, then sending the frozen object, is compatible with the real drain and job store. But the plan has two High issues: an unsupported recovery claim after retries run out, and a discard-warning design that would break Back protection. It also needs five Medium corrections before coding.

## Step 0
- **Change surface:** one personal subject/body pair for automated acceptance confirmations, plus moving email preparation ahead of the claim.
- **Entry points:** Profile Settings, a new preference route, the acceptance drain.
- **Persistence:** Dataverse `wmkf_appuserpreferences` and Postgres `reviewer_acceptance_jobs.steps`.
- **Consumers:** the drain (`sendAcceptanceConfirmationOnce`), the cron's Maintenance run, alerts, tests and docs.
- **Prior findings:** none.

## Findings

**1. HIGH: "Existing staff repair/requeue" after the eight attempts run out does not exist.**
- Evidence:
  - Outside tests and docs, only these files reference `reviewer_acceptance_jobs`: the job service, the cron, `respond-service.js`, `setup-database.js` and `scripts/smoke-reviewer-binding.js`. There is no staff requeue route.
  - The only re-entry is a reviewer re-accept hitting `ON CONFLICT` (`reviewer-acceptance-job-service.js:117-139`). That resets status but not `attempts`, `payload` or `steps`. Because `attempts` is already at the cap, the next failure is immediately terminal (`:291-292`). So it gives one more try at most.
  - It also only collides when the repeat's `acceptedAt = wmkf_responsereceivedat` (`respond-service.js:382-384`) exactly equals the original `accepted_at`. Otherwise it creates a new `isAcceptRepeat` job, which never sends a confirmation (`drain:826`).
- **Correction:**
  - State plainly that once retries run out, the automatic confirmation is permanently lost unless someone intervenes manually.
  - The alert should tell staff to send the confirmation by hand.
  - State the actual window: eight attempts, 300 s apart, cron every 2 min (`vercel.json:120-121`). That is roughly 35–40 minutes, less if earlier 60 s retries (`drain:496,525`) already used attempts.
  - Remove the word "requeue", or ask the owner whether a runbook or tool is in scope.

**2. HIGH: A second discard hook on the same page would break the existing discard warnings.**
- Evidence:
  - Next's router has a single `beforePopState` slot (`node_modules/next/dist/shared/lib/router/router.js:1578-1580`, `this._bps = cb`).
  - The thank-you hook sets that slot and, when it cleans up, resets it to `() => true` (`useReviewerThankYouDefaultsUnsavedChanges.js:36-41,54`).
  - The thank-you controller calls this hook itself (`ReviewerThankYouDefault.js:48`).
  - Switch and Archive consult only `thankYouDefaults.confirmContextChange` (`pages/profile-settings.js:247,737`).
- With a cloned hook: whichever becomes clean first wipes the other's Back guard while that editor is still dirty. Users would also get two prompts on route change, and Switch/Archive would skip the new editor entirely.
- **Correction:**
  - Use one page-level guard that combines both controllers' dirty/pending/confirmed-reload state, with one owner for `beforePopState`, `beforeunload` and route events.
  - Add a combined `confirmContextChange` that prompts once, then resets both controllers.
  - Browser fixture tests: both editors dirty; one cleared while the other is dirty, then Back; a single prompt; Switch and Archive with only the acceptance editor dirty.

**3. MEDIUM: The test seam and compatibility with existing tests are not specified.**
- Evidence: the drain injects `deps.sendAcceptanceEmail` (`drain:551`). Existing assertions depend on it at `reviewer-acceptance-drain.test.js:98,146,162,180,279…570,718`, `notification-trust-model-pushup.test.js:1012,1358` and `reviewer-acceptance-drain-operational-events.test.js:93`.
- **Correction:**
  - Name the new seams (prepare, send-prepared, request reader, pre-claim re-read).
  - Migrate every `sendAcceptanceEmail` assertion to the transport seam, and make leftover legacy injection fail loudly. Otherwise the `not.toHaveBeenCalled` assertions pass without testing anything, while the default preparation reaches real modules.
  - Decide how a transport result of `undefined` is classified (the pushup test mock at `:1358`). Under the new rule it is not `sent:true`, so it gets no `sentAt`.

**4. MEDIUM: The plan doesn't say which suggestion read supplies the request ID and recipient.**
- Evidence:
  - The test-request isolation check uses the first read (`drain:604`).
  - The recipient and due-date override come from the merged first read (`drain:595`, `email.js:125,144-146`).
  - There is a later read after the honorarium step (`drain:708`).
  - The existing withdrawal cancellation also runs `deleteLateHonorarium` (`drain:728-748`).
- **Correction:**
  - Prepare from the post-honorarium read or a fresh one.
  - Require the request ID to equal the one checked for isolation, plus `job.request_id` (this can be null per `job-service:96`; refuse in that case and say so).
  - At the pre-claim re-read, compare request ID, `wmkf_revieweremail`, `wmkf_reviewduedateoverride` and the accepted/declined/review-status/timestamp fields against the prepared snapshot. Any difference means retry, not send.
  - Reuse the exact existing release and withdrawal blocks, including the honorarium cleanup, rather than a partial copy.
  - Clarify test line 220: does "request reassignment" mean a PD change on the same request (use the new PD's wording), or the suggestion moving to a different request (refuse)?

**5. MEDIUM: New rendered-output checks would newly refuse mail that sends today, including shared copy and refusals caused by request data.**
- Evidence:
  - The thank-you precedent refuses a CR/LF subject or a blank body (`reviewer-thankyou-sweep.js:55-56`).
  - The acceptance renderer returns only HTML (`reviewer-acceptance-email.js:84`). The "before the withdrawal paragraph" length check therefore needs an internal plain-text render step.
  - The public renderer shape is pinned by `respond.js:36,45` and three test files.
- A proposal title containing a newline, inserted via `{{proposalTitle}}`, can't be fixed by changing configuration. It would burn all eight retries and then fail.
- **Correction:** for subject placeholders, either normalize the substituted values to a single line or treat data-caused refusals as immediately terminal with an explicit alert. Ask the owner which. Add an internal plain-text render and keep `renderAcceptanceConfirmationEmail` returning `{subject, body}` unchanged.

**6. MEDIUM: A transient PD lookup failure silently downgrades to shared wording from the generic mailbox.**
- Evidence: a thrown lookup falls back to `NOTIFICATION_EMAIL_FROM` (`reviewer-acceptance-email.js:105-113`). The plan keeps this (plan lines 150-151).
- For a request that has a PD assigned, a lookup error is not the owner's "non-PD fallback". Now that a retry path exists, treat a thrown lookup as a retryable preparation refusal. Keep the fallback for no PD, a disabled PD, or a PD with no mailbox. This needs an owner decision.

**7. MEDIUM: Interaction with terminal sibling failures, and the alert lifecycle, are not specified.**
- Evidence:
  - Any `retryable:false` reason throws immediately (`drain:845-846`). Today the confirmation still goes out in that pass. Under the plan, a refused preparation in the same pass means it never goes out.
  - On completion, recovery settling covers only the honorarium and contact keys (`drain:276-279`).
- **Correction:** document the terminal-sibling case and make the alert say "confirmation not sent". Define how the new PD/reason-keyed alert resolves or is superseded.

**8. LOW: Fan-out and wording nits.**
- The new key must be added to all three sets in `pages/api/user-preferences.js`: reserved (`:20-38`), private (`:43-53`), and the canonical alias set (`:57-60`). The plan names only two.
- Follow the naming precedent `REVIEWER_AUTOMATIC_THANKYOU_TEMPLATE` (`reviewerFinderPreferences.js:39`).
- Today `decrypt` is called even when the encrypted token is null (`drain:440`). The "missing token" check must happen before calling `decrypt`.
- A personal body containing `{{withdrawUrl}}` renders an empty link when no token exists (`email.js:70,76-77`). Say so in the editor help.

**Verified as sound (no change needed):**
- **Fire-once:** each claim mints a new lease token (`job-service:204,218`), and step merges require a matching token (`:252`). An overlapping worker's claim therefore fails, and it sends nothing (`drain:108-110,431-437`). Note that mutations never check `locked_until`, so this guarantee comes from the token check, not from a `claimedAt IS NULL` condition. The skip check uses the step snapshot taken at claim time (`drain:427-429`).
- **Cron:** a run where jobs were only retried still completes (`cron:41`). The plan's statement is correct.
- **Current skipped handling:** missing shared defaults currently return `skipped` (`email.js:153-155`), and the drain still records `sentAt` (`drain:480-487`).

## Recommendation evidence (all NOT TESTED; no code was run)
| Recommendation | Current prerequisite | Available at execution point | Evidence | Disconfirming check | Status |
|---|---|---|---|---|---|
| Single page-level discard guard | `router.js:1578`; hook `:36-54` | yes, page owns both controllers (`profile-settings.js:100`) | NOT TESTED | Browser fixture: two hooks, clean one, press Back. If the guard still fires, downgrade | VERIFIED (source) |
| Correct the recovery-after-exhaustion claim | `job-service:117-139,291` | n/a (docs) | grep enumeration | Find any staff route that resets status/attempts | VERIFIED |
| Prepare from post-honorarium/fresh read and compare at recheck | `drain:595,604,708` | yes | NOT TESTED | Unit test: email changed between reads must not send | ASSUMED-safe |
| PD lookup throw → retry | `email.js:105-107` | yes (retry path `drain:851`) | NOT TESTED | Owner rejects; keep historical fallback | Owner decision |
| Normalize or terminal-classify data-caused render refusals | thank-you sweep `:55-56` | yes | NOT TESTED | Title with CR/LF fixture | Owner decision |
| Explicit test seams | `drain:551`; tests listed | yes | NOT TESTED | Delete the seam and see whether old tests still pass | VERIFIED (source) |

## Seven audits
1. **Whole-flow:** traced except the new route and UI, which aren't built. The gap is which suggestion read feeds preparation (Finding 4).
2. **Partial-success:** sent / skipped / uncertain are kept separate correctly. Exhaustion and terminal-sibling outcomes are missing (Findings 1, 7).
3. **Stale async:** server side is fine under the lease token (pre-claim recheck needs field comparison, Finding 4). Client epoch guards follow the thank-you precedent (`ReviewerThankYouDefault.js:31-74`), but the shared router slot breaks the guards (Finding 2).
4. **Helper extraction:** the preserved items listed (recipient, sender, ICS, signature, regarding, `noFallback`) match `email.js:125-183`. The plain-text render step and the test seam are missing (Findings 3, 5).
5. **Durable surfaces:** no schema change; the step JSON only. Route and key require matrix, Atlas, catalogue and count updates.
6. **Docs:** planning only. The recovery wording must be corrected (Finding 1).
7. **Symbol fan-out:** three preference sets (Finding 8). The new alert key is not in the recovery settle (Finding 7). Unknown preference statuses refuse, which is correct.

**Required named changes:** Findings 1–7 as written. Findings 5 and 6 need the owner to choose; Finding 8 is optional polish.

**What I read and the limits:**
- In full: the plan, `contract-reconcile/SKILL.md`, `reviewer-acceptance-drain.js`, `reviewer-acceptance-job-service.js`, `reviewer-acceptance-email.js`, the drain cron route, and `useReviewerThankYouDefaultsUnsavedChanges.js`.
- In part: `respond-service.js` (165-194, 370-484), `reviewer-suggestion.js` (1308-1335), `grant-request.js` getById, `notification-service.js` (66-125), thank-you personalization and sweep (grep), `ReviewerThankYouDefault.js` (1-50, 134-146), `profile-settings.js` (95-114, 236-265 and the Switch line), `user-preferences.js` (28-67), `reviewerFinderPreferences.js` (20-49), the drain tests (60-184), the pushup test (1330-1367), Next `router.js` (grep), and `vercel.json` (grep).
- Not read: `DynamicsService` 404 semantics, `encryption.decrypt(null)` behavior, `AlertService` dedupe internals, `readRequiredEmailDefaults` internals, and the thank-you route.
- I used only Read, Grep and Glob. I ran no tests, edited no files (including the plan-mode scratch file, per your instruction), and made no network calls.
