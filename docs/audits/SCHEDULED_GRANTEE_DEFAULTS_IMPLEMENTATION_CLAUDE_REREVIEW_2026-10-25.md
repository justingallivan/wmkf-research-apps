---
title: Scheduled grantee defaults — independent implementation rereview
domain: workbench
kind: audit
status: active
summary: "Ordinary OAuth Claude rereview: PASS WITH NONBLOCKING NOTES at 7a84a274a. Initial findings 1–7 closed; pre-existing correlation-only acceptance recovery risk retained explicitly. Not release authorization."
owner: product-engineering
related:
  - docs/audits/SCHEDULED_GRANTEE_DEFAULTS_BUILD_2026-10-25.md
  - docs/audits/SCHEDULED_GRANTEE_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-25.md
---

# Independent implementation rereview — 2026-10-25

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth review, with
Read/Grep/Glob only, hooks and MCP disabled, no edits or test execution, and no
metered review product. Target: `7a84a274ab33cb8033248c9c6466ed80e125f6ad`.
Root separately ran the verification recorded in the build receipt. Claude's
other checkout and database work were untouched. Report below is verbatim;
line references describe the reviewed fingerprint. No release is authorized.

## Verbatim report

**Verdict: PASS WITH NONBLOCKING NOTES.** All seven findings from the initial review are closed in source and tests. The fixes and the two small additions introduce no blocking issue. This review does not authorize a release.

## Target and limitations
- **Target:** `7a84a274ab33cb8033248c9c6466ed80e125f6ad` on `codex/scheduled-grantee-defaults`, in worktree `/Users/gallivan/.codex/worktrees/session-start-2030/WMKF_Apps`.
- **Scope:** only whether findings 1–7 from `docs/audits/SCHEDULED_GRANTEE_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-25.md` are closed, any regressions the fixes introduced, and the two additions (the key-alias guard and the shared-wording notice).
- **Method:** Read, Grep and Glob only. I made no edits and wrote no plan file: plan mode asks for one, but your no-scratch-plan instruction overrides it. I ran no shell commands, tests or gates, touched no live systems, and used no advisor or delegation.
- **Not mine:** I did not run any tests. Root's results (17 suites / 383 tests, 33 Postgres tests, 6 Chromium tests, build, types, ESLint and gates) are root's separate evidence.

## Closure table
| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | GET always got 400 in real Next | **Closed** | `email-preferences.js:20-22`: a GET passes when the body is `undefined`, `null`, `''` or `{}`. It still rejects a non-empty string, an array, an object with keys, or any query. In installed Next, `api-resolver.js:314-315` calls `parseBody`, which treats a missing Content-Type as `text/plain` and returns `''` (`parse-body.js:40, 68-76`). The new route test (`route.test.js:39-47`) runs that real `parseBody` on an empty `Readable` with no headers. It asserts the body is `''`, then calls the handler and asserts 200 and an owner-service call. It no longer relies on mocks. `:48-51` covers `undefined`, `''` and `{}`; `:30` covers a query and the scalar `'x'`. |
| 2 | Missing held-row tests | **Closed** | **Page** (`scheduled-emails-page.test.js:355-370`): asserts the held label, the disabled Looks-good button and message field, enabled Stop and "Retry send", and confirmation copy containing "approves this send". If confirmed, the 409 `held` error text appears. If cancelled, no PATCH is sent (the page uses PATCH at `scheduled-emails.js:203`). In both cases there is no `sent` or `uncertain` feedback. **Projection/digest** (`scheduled-email-service.test.js:847-852`): the held row lands only in Needs attention. **Saved but unaccepted activity at the first mismatch** (`:829-835`): the row is held, keeps its activity and generation, and nothing records, creates, sends, writes intent or reads recipients. |
| 3 | Cancelling Back restored a stale URL | **Closed** | `useScheduledDefaultsUnsavedChanges.js:33-39`: the hook re-records the URL and history state in a microtask after `beforeHistoryChange`, and again on `routeChangeComplete`. Subscriptions depend on the stable `router.events` (`:60`); `beforePopState` goes through a ref. Unit tests cover the update before route completion (`editor.test.js:204-212`) and after completion (`:179-185`). The new browser test (`navigation.spec.js:87-96`) selects m2, presses Back, cancels, and asserts the `?message=m2` URL, the retained default edit and row 2. A microtask that fires after cleanup only updates local variables, so there is no unmount hazard. |
| 4 | Save said "unconfirmed" when nothing was written | **Closed** | `personalization.js:49-51, 66-68`: if the first listing throws, Save and Clear return `preference_unavailable` before any write. Later write or read-back failures still return `persistence_unconfirmed` (`:53-60, 69-73`). The route returns 503 with that reason (`:35`). The editor (`ScheduledGranteeReminderDefaults.js:77-82`) clears the uncertainty lock, disables Save/Clear and says "Nothing was changed… Reload". Tests: `personalization.test.js:77-81` and `editor.test.js:192-197`. |
| 5 | Accepted-email receipt failure was mislabelled as an ownership hold | **Closed** (see note N1) | `scheduled-email-service.js:485-490`: the thrown error now carries `acceptanceProven: true`. The outer catch handles that case first (`:652-656`), before the send-intent and generic branches. It marks the outcome uncertain and not retryable, and stores the held code only through the lease-fenced write. If `recordSent` already succeeded, the lease is cleared (`store:494`), so that fallback write does nothing and cannot overwrite a sent row. The route returns 202 with "Dynamics accepted… delivery record could not be completed" (`[id].js:135-136`). Tests: unit `:836-843`, route `:204-206`, and the Postgres test `pg:727-735` (receipt write fails once; the held code and message are stored; the next run records the receipt; no send or create). The cron just logs the failure (`grantee-deliverable-reminders-service.js:275-277`). |
| 6 | Two source headers not updated | **Closed** | The store's due-query header now says held rows stay due behind ordinary rows (`scheduled-email-store.js:101-103`). The attention helper's JSDoc now lists `pd_handoff_held` (`scheduled-email-attention.js:53-56`). |
| 7 | Confirmed save with failed refresh used the "unconfirmed" wording | **Closed** | A separate `confirmedReload` flag (`ScheduledGranteeReminderDefaults.js:20, 93`) selects distinct navigation wording (`hook:18-19`). Ordinary uncertain or pending writes keep "may already be saved" (`hook:20-21`). Tests: `editor.test.js:186-191` and the existing browser test at `spec:71-85`. |
| + | Key-alias guard on `/api/user-preferences` | **Pass** | `user-preferences.js:55-58` maps only casing or whitespace variants of `scheduled_grantee_reminder_template` to the real key; every other key passes through unchanged. The guard is applied to keyed GET (`:121`), the list strip (`:143`), POST (`:167`) and DELETE (`:221`). Tests at `reserved-keys.test.js:221-240` cover all of these, including tab/newline padding. |
| + | Shared-wording notice | **Pass** | `ScheduledGranteeReminderDefaults.js:117` shows the notice whenever the shared wording is unavailable, even when the user has their own wording saved. That matches the cron, which requires the shared wording on every run before using personal wording (`grantee-deliverable-reminders-service.js:157, 446`). Test: `editor.test.js:198-202`. |

## Introduced blocking issues
None.

## Nonblocking notes
- **N1 — a possible duplicate-send path in finding 5's branch (not a regression, and not tested).**
  - **Trigger:** the hold finds an email Dynamics has already accepted, located only by correlation key, and the write of its activity ID (`recordEmailActivity`) then fails. The row is left with no saved activity ID and no send intent.
  - **What happens next:** the row is eligible for PD reassignment (`store:652-653`), and recipient re-addressing bumps the generation (`store:435`). Either one changes the correlation key, so a later run would create and send a new email.
  - **Why it is not a regression:** the same exposure already existed before these fixes. The 2095db013 code took the same branch. Baseline reassignment also never checks for an accepted email that exists only by correlation key. Reaching this state needs both an unusual Dynamics state and a database write failure.
  - **Test gap:** the "no blind retry" claim is proven only for the stored-activity-ID case (`:836-843`, `pg:727-735`).
  - **Suggested follow-up:** a correlation-case test, or a manual-recovery code that reassignment excludes.
- **N2 — copy:** a row held with "Dynamics accepted…" still shows the generic held label. Its Retry confirmation says "this sends immediately", but Retry would only record the receipt. This is safe; the wording is just imprecise.
- **N3 — coverage:** GET with an array or a non-empty object body is rejected in source but has no test. The browser test still stubs the GET; the real-parser evidence is the unit test only.
- **N4 — docs:** neither the plan nor `SCHEDULED_GRANTEE_DEFAULTS_BUILD_2026-10-25.md` mentions the new `preference_unavailable` status, the `acceptanceProven` path or the alias guard. Reconcile at the next record update.

## Recommendation evidence
| Recommendation | Prerequisite | Where it applies | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Close finding 1 | Next returns `''` for a bodyless GET with no Content-Type | `email-preferences.js:20-22` | Real `parseBody` test `:39-47` (root ran it; I did not) | A deployment adding a JSON Content-Type would give `{}`, which is also accepted | VERIFIED (source) |
| N1 follow-up | Correlation-only accepted email plus a failed ID write | `service:476-480`; `store:619-654` | Not tested | Reassignment WHERE requires no activity ID and no intent (`:652-653`), so the row qualifies | VERIFIED (source trace), not run |

## Seven-audit summary (Mode A, delta only)
1. **Whole-flow:** traced each fix from client to route to service to store to consumer. The GET now reaches the owner service. The held row flows through store, helper, DTO, digest, route and page. Pass.
2. **Partial success:** failures before any write and failures after a write are now distinct. Proven acceptance is never reported as a transport failure. The fenced fallback write cannot overwrite a sent row. Pass, with N1.
3. **Async / stale state:** history is captured by microtask and on route completion; subscriptions stay stable; cleanup is safe after unmount. Editor generation and mount checks are unchanged. Pass.
4. **Helper semantics:** the alias mapping is limited to one key, and `canonicalScheduledReminderKey` returns every other key unchanged. Pass.
5. **Durable surface:** no schema, migration or new route. The new `preference_unavailable` reason and `acceptanceProven` flag are consistent across service, route and UI. Pass.
6. **Doc reconcile:** finding 6's headers are fixed. Build and plan records lag (N4).
7. **Symbol fan-out:** `acceptanceProven` is consumed in the service catch, the `[id].js` route and tests; the cron handles it through its generic catch. `preference_unavailable` is consumed by the route status mapping and the editor. `confirmedReload` is consumed only by the hook. Pass.

## Final verdict
**PASS WITH NONBLOCKING NOTES** at `7a84a274ab33cb8033248c9c6466ed80e125f6ad`. Findings 1–7 are closed, there are no blocking regressions, and N1–N4 are nonblocking.
