---
title: Independent Claude implementation review — scheduled grantee defaults
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth Claude review of 2095db013: NEEDS CHANGES for real Next GET parsing and missing planned hold tests; send-safety source trace passed. No release authorization."
owner: product-engineering
related:
  - docs/audits/SCHEDULED_GRANTEE_DEFAULTS_BUILD_2026-10-25.md
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
---

[VERIFIED via host Claude Code using ordinary Claude.ai OAuth/subscription.]
Target: `2095db01322869103540baecc7fe1c164d5e2a6c`.
Read/Grep/Glob only; no edits, tests, live operations, advisors or delegation.
The report is preserved verbatim below; root verification is separate evidence.

---

**Verdict: NEEDS CHANGES.** The send-safety work holds up under source review, but one defect makes the new defaults editor unusable in a real Next.js runtime. A verdict is not release authorization.

## Target and limitations
- **Target:** `2095db01322869103540baecc7fe1c164d5e2a6c` on `codex/scheduled-grantee-defaults`, against the plan reviewed at `990581a3c`. Worktree `/Users/gallivan/.codex/worktrees/session-start-2030/WMKF_Apps` only.
- **Method:** Read, Grep and Glob only. I made no edits, ran no shell commands or tests, touched no live systems, and used no advisor or delegation. I wrote no plan file: plan mode asks for one, but your instruction (no edits, including scratch plan) overrides that.
- **Not mine:** I did not run root's tests. I cite them only as root's separate evidence.
- **Coverage:** I read in full the personalization service, template validator, new route, attention helper, editor component, navigation hook and `[id].js` route. I read the logical regions of `deliverScheduledEmail` and its helpers, the store's due/claim/failure/reassign/activity SQL, the cron `processRow` and run loop, the generic `/api/user-preferences` key handling, and Next's `parse-body.js` / `api-resolver.js`.
- **Tests:** I read the substantive setups for the new route suite, the service "current PD hold" block, the cron "personal future wording" block, the Postgres due-order, held-row and frozen-row tests, and the e2e route interception. I did not read the auth suite or the editor suite bodies line by line.

## Findings

1. **HIGH, blocking: the editor's GET always gets 400 in real Next/Vercel, so the editor can never load.**
   - **Evidence:**
     - The client sends GET with no body and no Content-Type (`shared/utils/api-request.js:121-130`; a Content-Type is added only for plain-object bodies).
     - Next parses the body whenever `!req.body` (`node_modules/next/dist/server/api-utils/node/api-resolver.js:314-315`). With no Content-Type it treats the request as `text/plain` and returns the raw string, which for an empty body is `''` (`node_modules/next/dist/server/api-utils/node/parse-body.js:40, 68-76`).
     - The route rejects any GET body that is not null and not an object (`pages/api/scheduled-emails/email-preferences.js:20-23`), so `''` gets `400 validation`.
   - **Why tests missed it:** the route test's `call()` defaults to `body = {}` (`tests/unit/scheduled-grantee-reminder-preferences-route.test.js:14`). The e2e spec serves fake responses for `/api/scheduled-emails/email-preferences` (`tests/e2e/scheduled-grantee-defaults-navigation.spec.js:13-30, 74-76`), so the real handler and parser never run. Both would still pass with this defect in place.
   - **Effect:** the editor shows "could not be loaded". `data` stays null, so the inputs and Save/Clear stay disabled (`ScheduledGranteeReminderDefaults.js:109-118`). This fails closed: no wrong-owner access, and the cron and delivery paths are unaffected. But the feature cannot be used.
   - PUT is fine. DELETE is fine because the client sends `{}` as JSON, and Next parses an empty JSON body to `{}` (`parse-body.js:22-26`).
   - **Required fix:**
     - For GET, treat `undefined`, `''` and `{}` as empty. Still reject non-empty strings, arrays and objects with keys.
     - Add a route test with `body: ''`.
     - Add one check that cannot pass with fake responses: a handler test that runs Next's real body parser, or the e2e letting this GET reach the built server.

2. **MEDIUM: planned UI and digest tests for the hold are missing.**
   - **Evidence:**
     - A grep for `pd_handoff_held|Retry send|Held —` under `tests/` matches only the Postgres engine test, the routes test and the service test.
     - There is no page test for the held label (`pages/scheduled-emails.js:37`), the Retry-send button and its confirmation copy (`:430-437`), or the 409 `data.held` error path (`:219`).
     - There is no test placing a held row in the digest's Needs-attention group (`scheduled-email-service.js:784-785`).
   - Plan §5.2 asks for "exact route/UI parity tests". Plan §7.7 says the hold reason must appear in "projection/digest/page/routes".
   - Also not covered: a mismatch at the first guard on a row with a saved activity that Dynamics has not accepted and no send intent (plan §5.1, "held on PD mismatch"). Only the accepted saved-activity case and the late-mismatch case are tested (`tests/unit/scheduled-email-service.test.js:776-802`).
   - The source for all of these is correct as read. The digest uses the shared attention helper, so the risk is low, but these are named planned tests.
   - **Required fix:** add those page tests, one digest-grouping test, and the saved-unaccepted-activity mismatch service test.

3. **LOW, non-blocking: cancelling Back can restore a stale URL.**
   - **Evidence:** `useScheduledDefaultsUnsavedChanges.js:28-33` records the current URL once, when the guard starts (the effect depends only on `[dirty, pending, router]`).
   - If the user selects other messages while the editor is dirty, then presses Back and cancels, `pushState` restores the old `?message=` URL while the page still shows the newer selection.
   - Edits and selection are kept; only the URL drifts.
   - **Suggested fix:** refresh the recorded URL and history state on `routeChangeComplete`.

4. **LOW: Save reports "unconfirmed" when nothing was written.**
   - **Evidence:** `scheduled-grantee-reminder-personalization.js:49-58`. If the first enumeration throws, Save returns `persistence_unconfirmed` even though no write was attempted, which locks the editor until Reload.
   - This errs on the safe side; the label is just imprecise.

5. **LOW: an accepted-transport persistence failure gets labelled as an ownership hold.**
   - **Evidence:** `scheduled-email-service.js:476-481`, then `:657-661`.
   - In the mismatch branch where Dynamics has already accepted the email, a failed `recordEmailActivity` or `recordSent` throws the hold error. The outer catch then stores `PD_HANDOFF_HELD`.
   - It is safe: the next run reads the activity back and records the receipt without sending. But the stored reason is imprecise.

6. **LOW, docs: two source headers named in plan §8 were not updated.**
   - The store's due-query header (`scheduled-email-store.js:97-103`) does not mention that held rows stay due but sort after ordinary rows.
   - The attention helper's JSDoc (`shared/utils/scheduled-email-attention.js:53-56`) still lists only three reasons.
   - The cron header, the delivery comments, the attention action-helper comment, the route comment and the digest copy were all updated.

7. **LOW, copy: a confirmed save with a failed refresh reuses the "unconfirmed" lock.**
   - **Evidence:** `ScheduledGranteeReminderDefaults.js:81-85` sets `uncertain = true`, so the navigation prompt says the change is "pending or unconfirmed" even though it was confirmed.
   - The on-screen notice is correctly different.

## Disconfirming checks that passed (each traced to source)
- **Owner identity and privacy:**
  - The route refuses bypass and applicant sessions before any lookup (`email-preferences.js:14`).
  - It requires a GUID session actor and a numeric profile (`:15-17`).
  - It catches profile-mapping errors as 503 and treats a mismatch as 403 (`:27-29`).
  - The service only ever receives the session actor (`:33, 38`).
  - The generic `/api/user-preferences` route blocks the key for single reads (`user-preferences.js:114`), strips it from list reads (`:135`), and refuses it for single and batch POST/DELETE (`:24-37, 157-160, 211-215`).
- **Validator:**
  - Exactly two keys; subject is a single line of at most 300 characters with no braces; body is 10–20,000 characters and must contain the three required tokens.
  - Removing the four allowed tokens and then finding any leftover brace rejects the template. So triple braces, case variants and inner whitespace are rejected (`scheduledGranteeReminderEmail.js:6-16`).
  - The four legacy bracket placeholders are rejected.
  - Shared Admin copy is never run through this validator (`personalization.js:26-33`).
  - The cron checks the rendered length before writing a draft (`grantee-deliverable-reminders-service.js:450`).
- **Strict reads:** empty, duplicate, encrypted, unparseable and capped results map to distinct statuses (`personalization.js:11-24`; the adapter throws on a capped result at `user-preference.js:72`).
  - Save checks for duplicates, writes, then reads back and compares to the normalized pair (`:44-58`).
  - Clear deletes every listed row, then confirms absence (`:61-70`).
  - The route maps validation, duplicates and uncertain writes to 400, 409 and 503. A confirmed write whose refresh then fails returns `refreshUnavailable` (`email-preferences.js:35-42`).
- **Per-run cron cache:**
  - The promise is stored before awaiting and failures are normalized (`grantee-deliverable-reminders-service.js:429-434`).
  - The map is created fresh each run (`:228`).
  - Wording failures are grouped per PD and status, with up to 100 request numbers (`:435-445`).
  - The four-worker test waits for all four upstream reads and drains microtasks before asserting a single reader call (`cron test :713-716`). Root reports that a resolved-value cache made this test fail.
  - Different PDs are kept separate (`:736-744`).
- **Frozen rows:**
  - Repeat creates use `ON CONFLICT DO NOTHING` (`store:54`).
  - A wording failure returns before any create or reassign (`cron :445`).
  - The Postgres test asserts the row is byte-identical after a repeat create (`pg :705-709`).
- **Delivery guard:**
  - The first current-PD check sits after the claim and source-eligibility check and before Part B (`service:534-541`).
  - The second sits just before the send-intent write, after all activity awaits (`:618-619`).
  - It applies to both cron and forced sends; `force` only relaxes the claim SQL.
  - An unknown, invalid or failed PD read counts as a mismatch (`:454-460`).
  - The claim SQL refuses rows that already have send intent (`store:302`), so the hold can never overwrite an unconfirmed marker or reopen transport.
- **Hold branch:**
  - Missing/forbidden activity reads are re-thrown with their existing codes (`service:472`).
  - Other read failures go to the hold.
  - Only proven-accepted activities are recorded and finalized (`:475-484`).
  - An unaccepted activity found only by correlation is not attached (`:485-486`), which keeps the reassignment rebuild possible.
  - The hold write is fenced on the lease (`store:543`).
  - A thrown or null hold write throws with code `PD_HANDOFF_HELD`; the outer catch's fallback write keeps that code (`service:488-490, 657-661`).
  - Test `:813-817` confirms both writes use the held code and nothing is sent.
- **Due ordering:** the CASE ordering puts NULL codes first (`store:114`). The Postgres test uses 101 older held rows and checks the ordinary row comes first (`pg :681-686`).
- **Retry parity:**
  - The shared helper allows only `sendNow` for the ownership hold; edit and approve stay blocked (`attention.js:72-74`).
  - The route checks `held` before the missing-message branch and returns 409 with the projected row (`[id].js:114-115`).
  - The page shows the held copy and does not show "sent" feedback (`pages/scheduled-emails.js:219`).
- **Editor request handling:**
  - Every success, error and finally path checks the shared generation counter and a mounted flag; the actor check covers success and error (`ScheduledGranteeReminderDefaults.js:44-55, 67-96`).
  - The editor is keyed by session profile and system user, so it remounts only when the actor actually changes, not while identity is loading (`:128-137`).
  - The uncertainty lock clears only after a definitive read (`:39`).
  - The shallow same-path exemption applies to both route changes and Back/Forward (`useScheduledDefaultsUnsavedChanges.js:12, 30-32`).
- **Accepted limits:** the race after the final PD read is tested and documented (`service test :822-827`). Manual recovery and terminal Stop are documented in the hold copy (`attention.js:32`).

## Recommendation evidence
| Recommendation | Prerequisite | Where it applies | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Accept `''` as an empty GET body | Next `parseBody` returns the raw string when there is no Content-Type (`parse-body.js:40, 68-76`) | `email-preferences.js:20-23`, before `withDalContext` | Source trace only; I did not run it | If `requestEnvelope` or a deployment proxy adds a JSON Content-Type to GET, the body would be `{}` and this is not a defect. `api-request.js:123-128` shows it is added only for plain-object bodies | VERIFIED (source), not run |
| Add page and digest held tests | Held label, Retry button and digest grouping exist (`scheduled-emails.js:37, 430-437`; `service:784`) | The `scheduled-emails-page` and service suites | Grep shows no held assertions in those suites | A held-row test hidden under another name. Grepping the held code, label and button text found none | VERIFIED |
| Refresh the recorded URL after route changes | URL is recorded once (`hook:28-29`) | `beforePopState` cancel branch | NOT TESTED | The e2e may already cover select-then-Back-then-cancel; I did not read its assertions | ASSUMED |

## Seven-audit summary
1. **Whole-flow:** every step traced: editor → API → strict preferences → cron reader → render → frozen ledger → delivery guard → hold DTO → route → page. The GET defect (finding 1) breaks the first step.
2. **Partial success:**
   - Save is whole-pair, and both Save and Clear are confirmed by a read-back.
   - A partial Clear is not reported as success.
   - Cron failures keep their request numbers.
   - Hold writes and receipt writes never report success after a lost lease.
   - Pass.
3. **Async / stale state:**
   - Editor generation, mounted and actor checks hold on every path.
   - The cron caches the promise, not the value.
   - The delivery guard re-reads after every intervening await.
   - Pass, apart from the minor URL drift in finding 3.
4. **Helper semantics:** the new family service is separate and the generic profile reader and remap are not reused. The attention helper's one deliberate exception (Retry send for the ownership hold only) is limited to that reason. Pass.
5. **Durable surface:**
   - No schema or migration changes.
   - The new error code and attention reason are consistent across the store, the helper, the DTO and the page.
   - I did not check the route matrix, Atlas or canonical counts myself; root reports those gates passed.
   - Header gaps are in finding 6.
6. **Doc reconcile:** plan status text matches "branch-built, not released". Header gaps in finding 6. No `/sweep` run, since this was a read-only review.
7. **Symbol fan-out:**
   - Every reader of `scheduled_email_pd_handoff_held` / `pd_handoff_held` handles it: store constant, due ordering, attention map and copy, action helper, DTO, page label and Retry, digest copy, route, cron outcome.
   - Reconciliation candidates exclude it, as intended.
   - Reassignment clears it (`store:642`).
   - The new preference key is reserved and private in the generic route.
   - Pass. The missing tests are in finding 2.

## Final verdict
**NEEDS CHANGES.**
- **Blocking:** finding 1. Fix the empty GET body and add a test that runs Next's real body parser.
- **Should fix before release:** finding 2 (the missing planned UI, digest and saved-activity hold tests).
- **Non-blocking notes:** findings 3–7.
