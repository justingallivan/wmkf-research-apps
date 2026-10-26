---
title: Reviewer acceptance defaults — independent code rereview
domain: reviewers
kind: audit
status: active
summary: "Claude PASS on0ac9ce254: all N1 coverage gaps and N5 header closed; direct auth, Maintenance and browser assertion inspection. Initial nonblocking limits retained; not released."
owner: product-engineering
related:
  - docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_BUILD_2026-10-26.md
  - docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-26.md
---

# Final targeted implementation review — 2026-10-26

[VERIFIED via host ordinary subscription OAuth Claude CLI.] Exact target
`0ac9ce254e859cb1f005395a66c264a59703896f`, independently confirmed by root git.
Read/Grep/Glob only; no edits/scratch plan, shell/tests, live calls, database,
other checkout, provider keys, advisors/subagents or metered products. Initial
whole-flow review passed with nonblocking notes; this follow-up closes N1/N5
and directly inspects test assertions omitted by the first pass. Report below
is verbatim. Root ran CI=1 with an unused ephemeral port, so no stale web-server
reuse occurred in its reported browser results. This is separate root evidence.
No release authorized.

# Targeted rereview: PASS

**Target:** HEAD `0ac9ce254` on `codex/reviewer-acceptance-defaults` [VERIFIED via the session-start git snapshot only; I could not run `git rev-parse`]. Baseline is the initial review at `2ff4e861e`.

I used Read/Grep/Glob only. I made no edits (no plan file, no memory) and ran no tests or shell commands. I used no advisor, subagents or metered products.

## N1: all six bullets closed with discriminating fixtures

For each test I checked that removing or breaking the guarded line would make it fail.

1. **Repeat acceptance excluded from the terminal alert** (`drain.test.js:922-928`): closed.
   - The job has `isAcceptRepeat: true` and a sibling step fails terminally. The fresh row has its payload serialized as a string and no claim or sent steps.
   - `parsePayload` handles string payloads (`drain.js:46-52`), so the `isAcceptRepeat !== true` check at `drain.js:1042` is the only thing stopping the `:terminal` alert.
   - `failed === 1` proves the failure path actually ran.
   - The claimed-row exclusion is still covered at `:885-886`.

2. **Request identity binding** (`drain.test.js:929-941`): closed. Each case passes every other check, so each one isolates a single condition at `drain.js:525-528`:
   - **Fresh timestamp:** the third suggestion read is the fresh read, as the fourth is the recheck (`:851`). It returns a timestamp a day off, and the default fixture has no `wmkf_responsereceivedat`.
   - **Payload request:** only `payload.request.akoya_requestid` differs.
   - **Isolation request:** `isolationEnabled` is on and the first suggestion read returns the other request id, so `isolationRequestId` differs (`drain.js:720`). Later reads match `job.request_id` and the payload.

   Every case asserts no fresh request read, no preparation, no send and no `claimedAt` write. The reason string reaches the aggregated message (`drain.js:936`), so the `toThrow` reason check is meaningful. The isolation case also asserts `resolveTestState` was called with the other request id.

3. **Invalid PD GUID refuses before any lookup** (`email.test.js:291-294`): closed.
   - It expects exactly `sender_identity_invalid` (`email.js:101`), with neither the lookup spy nor the personal reader called.
   - The spy is a real tripwire. The adapter's `getByIdWithSelect` calls `DynamicsService.getRecord` directly (`system-user.js:56-57`), and the golden-path test at `:74` proves that route.

4. **No PD with a configured personal row present** (`email.test.js:295-300`): closed.
   - The personal row is configured with "Private" wording.
   - The test asserts the generic sender, `actingUserSystemId: undefined`, no "Private" text in subject or body, and neither the lookup nor the reader called. This matches `email.js:99-100,114-115,132`.

5. **Real helper: claim, then send, then sent, with no failure alert** (`drain.test.js:897-909`): closed.
   - It uses the real `sendPreparedAcceptanceConfirmationEmail` with a spy on `DynamicsService.createAndSendEmail`.
   - Call order checks: claim index before sent index, claim before send, send before the sent write.
   - It asserts the result `{sent:true, emailId}` and no `reviewer_acceptance_confirmation_failed` notice.

6. **Undefined receipt is labelled uncertain and never resent** (`drain.test.js:872-879`): closed.
   - An undefined receipt fails `result?.sent !== true` (`drain.js:556`). The thrown error has no `dispatched:false`, so it classifies as `uncertain` (`shared/utils/email-send-outcome.js:51-55`).
   - The test asserts `metadata.outcome: 'uncertain'` on the failure notice. The title isn't asserted, but it comes from the same classification.
   - The second pass still sends exactly once in total.

**N5 is closed:** `reviewer-acceptance-personalization.js:1` now reads "acceptance-confirmation defaults".

## The three files read in full, checked against source

- **`tests/unit/reviewer-acceptance-preferences-auth.test.js`** is consistent with source. It uses the real `requireAuth` (`lib/utils/auth.js:153-205`) and covers three cases:
  - **Foreign Origin on PUT/DELETE:** returns 403 before the session lookup and the identity lookup (`:160-163`).
  - **Missing or disabled profile:** returns 403 from the `is_active` check (`:193-195`). Bare `requireAuth` has no app-access gate and the identity fixture matches the session owner, so without this check the GET would reach the preference reader. The `get` not-called assertion is therefore meaningful.
  - **No session:** returns 401.
  - The tests assert status codes only, not response bodies. That's fine.
- **`tests/unit/reviewer-acceptance-cron-accounting.test.js`** is consistent with `pages/api/cron/drain-reviewer-acceptances.js:41-53`.
  - Retried-only maps to `completed`; failed or lease-lost maps to `failed`. The details and response body carry the drain result.
  - The `configurationPaused` branch is not covered here. That is out of scope for the N1 delta.
- **`tests/e2e/reviewer-acceptance-defaults-navigation.spec.js`** has 9 cases. Every label, button and message it uses exists in source:
  - `ReviewerAcceptanceDefault.js:100,131,148,156,159,165-167`
  - "may already be saved" / "unsaved default wording" in `useReviewerThankYouDefaultsUnsavedChanges.js:63-64`
  - The assertions match the reviewed behaviour: no writes in the dirty, cancel and back cases; one prompt; draft kept on cancel; pending-save warning; no prompt during a clean pending GET (the guard ignores `busy`).
  - Requests outside the fixture origin are aborted, and unexpected API paths are recorded and asserted empty in the first case. Non-GET calls are blocked except those routed per-test.
- **`playwright.config.js:46-56`** runs a production `next build && next start` (Turbopack). However, `reuseExistingServer: !process.env.CI` means a local run can reuse a stale server on port 3100 without rebuilding. A fresh build is root evidence, not something the config guarantees.

## Required findings

None.

## Test evidence limitations

- I ran nothing. The 421 focused tests, 3 PG16 cases and 15 browser cases with a fresh production build are root-reported counts only. I didn't enumerate the 15 browser cases; this spec accounts for 9.
- I didn't diff `2ff4e861e..HEAD`. "Only the N5 runtime change" comes from your prompt, and I can only confirm the line-1 header text.
- N2, N3, N4 and N6 remain as the nonblocking limits recorded in the initial review.

**Files read:**
- **In full:** `reviewer-acceptance-email.test.js`, `reviewer-acceptance-preferences-auth.test.js`, `reviewer-acceptance-cron-accounting.test.js`, `reviewer-acceptance-defaults-navigation.spec.js`, `pages/api/reviewer-acceptance-email-preferences.js`, `pages/api/cron/drain-reviewer-acceptances.js`, the initial review doc.
- **Partially:**
  - `reviewer-acceptance-drain.test.js` 1-122 and 830-941 (end of file)
  - `reviewer-acceptance-drain.js` 128-152, 495-602, 700-749, 895-939, 1020-1054
  - `reviewer-acceptance-email.js` 95-158
  - `reviewer-acceptance-personalization.js` 1-5
  - `shared/utils/email-send-outcome.js` 35-63
  - `lib/utils/auth.js` 153-205
  - `playwright.config.js` 10-59
- **Grep only:** `system-user.js` `getByIdWithSelect`, drain `parsePayload` and dependency wiring, UI string locations.

This does not authorize a release.
