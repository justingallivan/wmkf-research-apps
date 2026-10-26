---
title: Reviewer acceptance defaults — targeted plan closure review
domain: reviewers
kind: audit
status: active
summary: "Historical target1a9ad691e: all previous corrections closed; Claude named one direct-wrapper test/refusal-contract correction N1, incorporated afterward. Planning only."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md
---

# Targeted closure review — 2026-10-26

[VERIFIED via host ordinary OAuth Claude output.] Read/Grep/Glob only; no edits,
secrets, live calls, other checkout, subagents/advisor or metered tools. Target
1a9ad691e. Verbatim report below is historical; subsequent N1 corrections are not
covered by this receipt. No runtime changes or release authorized.

**Verdict: READY WITH NAMED CHANGES.** There is one small named change. All five required corrections and both clarifications from the rereview are now in the plan text, and source supports each one. The remaining gap is the same kind of problem as rereview Finding 5, but in a different test file: one existing test suite would break or contradict owner decision O2 and isn't covered by the migration wording.

## Target and limits
- **Target:** `docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md` at current HEAD `1a9ad691e`. The prior rereview being checked targeted `1aef57b70`.
- **Method:** contract-reconcile Mode A, limited to this change. I used only Read, Grep and Glob. No edits (not even the plan-mode scratch file, as you instructed), shell, tests, network, secrets, subagents, advisor or metered tools.
- **What "verified" means here:** every item below is checked against source only. None of the planned tests exist yet, so nothing is test-verified.

## Rereview items: closure check

| Item | Where the plan addresses it | Source checked | Status |
|---|---|---|---|
| F1: the real transport receipt | Plan 155–165: the real helper waits for the Dynamics send and turns its `{emailId}` into `{sent:true, emailId}`. It must not pass the raw Dynamics result through. Only the drain's transport result needs the `sent:true` check. A test runs the real helper end to end. | `dynamics/email.js:333,368` returns `{ emailId }`; the existing wrapper ignores it (`reviewer-acceptance-email.js:168-184`) | **Closed** |
| F2: retry timing | Plan 257–261: 8 attempts mean 7 retry gaps. Floor is 35 min; about 42 min nominal; longer under backlog; shorter if attempts were already used. | Attempts are counted at `job-service.js:291-292`; jobs are picked up when `next_attempt_at <= NOW()` (`:210`); cron runs every 2 min (`vercel.json:121`); batch limit is 5 (`drain:37`); retry delay is 300 s (`drain:851`) | **Closed** |
| F3: where the terminal alert fires | Plan 287–294: in the outer catch, using the fresh row returned from the failure update. Conditions: `status==='failed'`, not a repeat acceptance, and neither `claimedAt` nor `sentAt` set. Covers both exhaustion and a sibling step failing terminally. No alert after a claim. | `drain:946-960`; the failure update returns `RETURNING *` (`job-service.js:307`) | **Closed** |
| F4: settling alerts and events | Plan 266–285: the preparation alert opts into `operationalEvent`. On cancellation, the outer loop's cancelled branch calls `markSuperseded` first and then `autoResolve`. Plan says plainly that cancellations from outside the drain leave a stale alert. | `autoResolve` → `markRecovered`, which only touches open events (`alert-service.js:294-313`, `op-event:340`); event opt-in at `notification-service.js:89-108`; every cancellation exit returns through `drain:922` with `job.id` available | **Closed** |
| F5: test migration | Plan 216–222 and 349–356: blank or missing shared defaults now retry. The trust-model test at `:1118` now expects a retry with real preparation and mocked lookups. All four seams are injected or derived. The `:1012`/`:1358` injections are no longer cited as coverage. | `pushup.test:1118-1131`; the grant-request and system-user adapters and email-signature are already mocked there (`:248-253`, `:236`) | **Closed for the files it names.** One more file is affected (N1 below). |
| F6: low-priority wording | Signature lookup residual (193–196); isolation equality only when isolation is on (175–177); a deleted PD that returns 404 now retries (211–213); multi-line shared subjects newly refuse (219–220) | `drain:603-605`; `getById` accepts `select` (`grant-request.js:91-97`) | **Closed** |
| F7: the combined navigation guard | Plan 121–136: one page-level guard; the thank-you controller's own guard call (`:48`) is removed; `resetWithoutPrompt`; the thank-you editor's clean-read warning is kept | `ReviewerThankYouDefault.js:47-48,138-145`; `profile-settings.js:247,737` | **Closed** |

## Named change

**N1 (Medium): the direct tests for the old send wrapper aren't in the migration list, and one of them contradicts O2.**
- The plan (line 149) keeps `sendAcceptanceConfirmationEmail` "for its current direct contract tests," and the wrapper now prepares the email before sending. Source shows those tests can't keep passing unchanged:
  - `reviewer-acceptance-email.test.js:157-167` expects a thrown PD lookup to fall back to the generic sender and return `{sent:true}`. Owner decision O2 makes that case a retryable refusal.
  - The golden-path fixtures (`:52-75`, `:161`, `:177`) use the non-GUID `'pd-guid'` and a mismatched `systemuserid:'su-1'`. Plan lines 204–205 and 214 now refuse both.
  - Those tests don't mock the personal-preference reader that preparation will call on the PD branch.
  - The plan never says what the wrapper returns when preparation is refused. Today it returns `{skipped:true, reason:'defaults_unavailable'}` (`:154`).
- **Minimal fix (plan wording only):**
  - Add `reviewer-acceptance-email.test.js` to the test-migration list.
  - Invert the `:157` case to "refused, no send" under O2.
  - Switch the fixtures to valid, matching GUIDs and mock the personal-preference reader.
  - State the wrapper's refusal return: either throw the typed refusal or return `{skipped:true, reason}`.
  - Its only production caller is the drain's default (`drain:551`), which the plan replaces, so this affects tests only.

## Optional notes (not blocking)
- At the outer catch, read `isAcceptRepeat` through `parsePayload(updated.payload)`, the same way `drain:566` does. Also check that `updated` isn't null first: a null return means the lease was lost (`drain:951`).
- The terminal-alert condition also fires when a job is exhausted because Dataverse never showed the acceptance (`drain:535`). The "send by hand" alert should tell staff to confirm the reviewer is still accepted before sending.
- The migrated trust-model test needs a `request_id` on the job and `_wmkf_request_value` on the fresh suggestion in `makeAcceptanceDrainDeps` (`:429-489`). Otherwise preparation refuses on identity before it reaches the shared-defaults check that test asserts. The test would fail loudly rather than pass silently.

## Seven audits (this change only)
1. **Whole flow:** prepare → recheck → claim under the lease → frozen send → convert the receipt → record `sentAt`, traced through `drain:417-489,826-836`. Sound.
2. **Partial success:** sent, skipped and uncertain outcomes stay separate. The terminal alert is limited to jobs that were never claimed. Sound.
3. **Stale async:** the terminal alert uses the fresh row, and lease checks guard every step write (`job-service:252`). Sound.
4. **Helper extraction:** the receipt adapter is defined. The wrapper's refusal return is not defined (N1).
5. **Durable surfaces:** the new rows in `system_alerts` and `operational_events` both come through the `notify` opt-in, with recovery keyed to the job. No schema change.
6. **Docs:** timing, settlement and limitation wording are now accurate. The plan's frontmatter and line 408 still say "review pending," which is expected for the next reconcile.
7. **Symbol fan-out:** the `sendAcceptanceEmail` injection is enumerated in 3 test files plus the drain; N1 covers the remaining direct callers of the wrapper.

## Files read
- **In full:** the plan and the rereview.
- **In part:** `reviewer-acceptance-drain.js` (255–290, 400–969), `reviewer-acceptance-job-service.js` (195–310), `reviewer-acceptance-email.js` (95–185), `alert-service.js` (285–324), `operational-event-service.js` (300–359), `notification-service.js` (40–129), `notification-trust-model-pushup.test.js` (1080–1139, plus the fixture helpers), `reviewer-acceptance-email.test.js` (51–75, 150–219).
- **Grep only:** `dynamics/email.js`, `ReviewerThankYouDefault.js`, `profile-settings.js`, `grant-request.js`, `setup-database.js`, `vercel.json`, the cron route, and the drain test helpers.
- **Not read:** `respond-service.js` and `terminal-transition.js` bodies (I relied on the earlier reviews), and the alert copy in `email-defaults.js`.

This review covers planning only. It does not authorize coding or a release. Owner decisions O1 and O2 are treated as binding and are not reopened.
