---
title: Reviewer acceptance defaults — independent implementation review
domain: reviewers
kind: audit
status: active
summary: "Claude PASS WITH NONBLOCKING NOTES at2ff4e861e, no blocking defects. Planned N1 coverage gaps and a header corrected afterward for targeted rereview; no runtime behavior change. Not released."
owner: product-engineering
related:
  - docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_BUILD_2026-10-26.md
---

# Initial independent implementation review — 2026-10-26

[VERIFIED via host ordinary OAuth Claude CLI output.] Read/Grep/Glob only; no
edits/scratch plan, shell/tests, live data, keys/secrets, other checkout, advisors,
subagents or metered products. Exact code target 2ff4e861e42c5225e2def34ca85d38fc9c6e6060.
Report below is verbatim. Root-run tests are separate evidence. Final browser/
build rerun on that target passed after the prompt was submitted, so the report's
build-timing limitation is historical. N1's six missing cases plus stronger
receipt ordering/uncertainty assertions and N5's header are corrected afterward.
No blocking finding; targeted test/header rereview pending. Not released.

## Verdict: PASS WITH NONBLOCKING NOTES

I found no blocking defect at `2ff4e861e`. The required safety properties hold in the source and the tests catch the important ways they could break. I did not run any tests; every pass/fail count below is the root session's evidence, not mine. This review does not authorize release.

### Ranked findings (all nonblocking)

**N1 – Some planned test cases are missing (Medium, tests only).** The code handles each of these correctly, but no test would catch a regression:
- **Repeat acceptances and the terminal alert:** `drain.js:1042` correctly skips the manual-send alert for repeat-acceptance rows. Test `drain.test.js:879` only checks the claimed-row exclusion, not the repeat-row one.
- **Request identity checks:** `drain.js:525-528` refuses when the timestamp changed at the fresh read, when the payload request id differs, or when the isolation-checked request id differs. Only the fresh-request mismatch is tested (`:846`).
- **Invalid PD GUID:** a malformed `_wmkf_programdirector_value` should refuse before any lookup (`email.js:101`). This is untested.
- **No-PD fallback with a personal row present:** plan item 4 asks for a test that the personal reader is never called when there is no assigned PD. Only the disabled and no-mailbox cases assert that (`email.test.js:243`).
- **Real-helper drain test:** the plan asks it to show claimedAt before sentAt and no uncertain alert. Test `drain.test.js:896` only asserts the sentAt result.
- **Undefined receipt:** test `:872` proves there is no resend, but not that the alert is labelled uncertain. The code does label it uncertain (`email-send-outcome.js:51-55`).

**N2 – The O1 body test is indirect (Low).** `email.test.js:256` checks the HTML output (`'First\r<br>Second'`) rather than the plain body text. The source itself is right: separate maps, with only subject values normalized (`email.js:77-80`).

**N3 – The preparation alert stays open after a terminal failure (Low, behavior).** When a job fails terminally, the new `:terminal` alert fires but the nonterminal `acceptance-confirmation-preparation:<jobId>` alert is never settled (`drain.js:1040-1044`). Admins would see two open alerts for the same job. The plan doesn't require settling it; optionally supersede it at the same point.

**N4 – The context-change guard can prompt twice (Low, UI).** `resetWithoutPrompt` keeps `uncertain` and `confirmedReload` set (`ReviewerAcceptanceDefault.js:136-139`). So after a user confirms Switch during a pending write, the guard stays armed and the next navigation prompts again with the "pending" message. That is truthful and matches the thank-you controller.

**N5 – Wrong header comment (Trivial).** `reviewer-acceptance-personalization.js:1` says "automatic reviewer thank-you defaults". It should say acceptance.

**N6 – Things I noted but left alone:**
- Placeholder substitution can cascade, e.g. a title containing `{{withdrawUrl}}` would expand (`email-placeholders.js:6-13`). This predates the feature.
- Only CR/LF are normalized in subject values, not U+2028/U+0085. That matches O1 as written.
- The test at `drain.test.js:911` is close to vacuous (zero claims, so nothing to settle). It documents the plan's stale-alert scope limit rather than testing anything.

### Required fixes
None blocking. I recommend adding the N1 tests before release. N3 and N5 are optional.

### Trace verification (source lines)
- **Staff identity:**
  - The route uses `requireAuth`, refuses bypass and applicant sessions, requires a positive scalar profile id, runs inside `withDalContext`, and requires the profile map to match the session actor (`route:12-30`).
  - It accepts no caller-selected owner: any query is refused, GET must be empty, PUT must be exactly `{template}`, DELETE exactly `{}` (`:21-25`).
  - A confirmed mutation followed by a failed refresh returns `refreshUnavailable` (`:41,44`). An ambiguous write returns `persistence_unconfirmed`, and a definite pre-write failure returns the distinct `preference_unavailable` (`personalization:51,58-60`).
- **Strict preference read:**
  - Enumeration is exact owner and key, and a capped result throws (`user-preference.js:67-73`).
  - Duplicate, encrypted, invalid, unavailable and identity-unavailable rows each get their own status (`personalization:11-24`).
  - Save confirms by reading the row back; Clear confirms absence afterwards (`:57-58,71`).
- **Privacy:** the new key is in all three reserved/private/canonical sets (`user-preferences.js:38,54,62`). Case and whitespace aliases are tested against list, keyed, single, batch and delete (`reserved-keys.test.js:255-265`).
- **Page guard:** a single `useUnsavedChanges` owner lives in `useReviewerEmailDefaultsGuard.js:8`. The thank-you controller no longer installs its own guard (grep confirms). Both controllers are created above the `isLoading` return (`profile-settings.js:102-104` vs `:359`). Switch and current-profile Archive go through the combined confirmation (`:251,742`). The acceptance editor's guard excludes `busy`, so a clean pending GET doesn't warn; the thank-you editor keeps `busy` (`:46` in each file).
- **Fresh context through claim:**
  1. Fresh suggestion read; a null or failed read refuses, never cancels (`drain.js:516-522`).
  2. The existing cancellation blocks are reused (`:523,542`).
  3. Timestamp and request GUID are bound to the job, the payload and the isolation check (`:525-528`).
  4. Fresh request read with the explicit field list, with an equality check (`:530-531`).
  5. Token: if no encrypted token, no link; if decrypt returns null, refuse; if decrypt throws, refuse as `preparation_unavailable` (`:532-536`, `encryption.js:99`).
  6. Preparation result (`:537`).
  7. The suggestion is re-read and seven fields are compared (`:539-544`).
  8. The lease-guarded `claimedAt` write; a no-op throws lease-lost before any send (`:545-551`).
- **Preparation (O2):**
  - An invalid PD GUID refuses before lookup; a lookup that throws or returns null gives `sender_unavailable` (retried); an identity mismatch or non-boolean `isdisabled` refuses (`email.js:101-108`).
  - The shared generic fallback is used only for no PD, a confirmed-disabled PD or a confirmed PD with no mailbox, and the personal default is never read in that case (`:109-115,132`).
  - Shared copy is still required (`:130`). Only a confirmed-absent personal row inherits shared copy; any unknown status pauses (`:134-135`).
  - Final rendered checks run on business text before the appended withdrawal paragraph (`:140-143`), and the result is frozen (`:147-150`).
- **Transport and receipt:**
  - The real helper adapts Dynamics' `{emailId}` to `{sent:true, emailId}` (`email.js:155-158`).
  - The drain requires `sent === true`; anything else is treated as uncertain (`drain.js:556`, `email-send-outcome.js:51-55`).
  - After the claim, no path clears `claimedAt` or schedules a resend (`:557-591`). A lost success write becomes lease-lost, and the next pass skips because `claimedAt` exists (`:504`).
- **Retry, exhaustion and alerts:**
  - A refusal records the failure under the lease with no claim, sends a job-bound warning, and retries after 300 s (`:507-513,929-936`).
  - Preparation alerts are resolved after the claim, and both keys after a confirmed send (`:552,600`).
  - On cancellation, the outer loop marks events superseded before resolving alerts (`:1008`, `:484-485`).
  - The terminal alert uses the fresh returned row (not null, failed, not a repeat, no claim/sent) (`:1032-1044`).

### Seven audits
1. **Whole flow:** traced end to end, as listed above.
2. **Partial success:** skipped, sent, uncertain and exhausted are kept separate; `claimedAt` is never cleared. A failed or uncertain send still lets the job complete, which is intended; dispatch status is carried by the step and its alert.
3. **Stale async:** the client uses epoch, operation and mounted checks, and an actor change clears private state. The server re-checks before claiming, and the scratch-PG test proves the lease token with an expired-then-replaced worker. The cross-system reassignment race and the independent signature read remain, as the plan intends.
4. **Helpers:** preparation does no claim and no transport; transport does no reads. The public renderer still returns exactly `{subject, body}` (`email.js:93-96`). The wrapper returns `{skipped, reason}` on refusal and still throws on input errors.
5. **Durable state:** only the preference row and job step JSON change. No SQL changes; the PG test applies migration 024 unchanged.
6. **Docs:** not reviewed beyond the plan. N5 is the only comment-level issue.
7. **Fan-out:** the key reaches the strict reader, route, UI, privacy sets and sender. An unknown own-status refuses (`email.test.js:236`, `new_status`). No new job status was added.

### Tests: checks that would catch real breakage
- Outer-cancellation ordering uses a state machine, so reversing the order would fail (`drain.test.js:903-910`).
- Post-claim no-resend is checked for throw, undefined receipt and lost recording (`:872-878`).
- The preclaim recheck has a case for each compared field (`:851`).
- The PG tests cover refusal then repair with a single send, an old lease token unable to claim, and eight-attempt exhaustion with exactly one terminal alert (`pg.test.js:41-63`).
- The trust-model test at `:1120-1133` actually reaches the missing-default gate (the misconfigured-default notify must fire).
- Clear-only-own-rows uses a real owner/key filter fixture (`personalization.test.js:49-55`).

### Evidence gaps
- All of N1.
- The PG and cron/Maintenance results are root-supplied. I did not read `reviewer-acceptance-cron-accounting.test.js`, `reviewer-acceptance-preferences-auth.test.js`'s body or `reviewer-acceptance-job-service.test.js`.
- I only saw the e2e spec's titles and route mocks, not its assertions.
- The browser build predates the decrypt-null backend change; that change is backend-only and is unit-tested at `drain.test.js:892`.

### Files read
**In full:**
- the plan
- `reviewer-acceptance-personalization.js`
- `reviewer-acceptance-email.js`
- `shared/config/reviewerAcceptanceEmail.js`
- `pages/api/reviewer-acceptance-email-preferences.js`
- `ReviewerAcceptanceDefault.js`
- `useReviewerEmailDefaultsGuard.js`
- `useReviewerThankYouDefaultsUnsavedChanges.js`
- `email-send-outcome.js`
- `reviewer-acceptance-email.test.js`
- `reviewer-acceptance-defaults.pg.test.js`
- `user-preference-exact-enumeration.test.js`

**Partially:**
- `reviewer-acceptance-drain.js`: 60-119, 270-294, 418-1062
- `ReviewerThankYouDefault.js`: 40-141
- `user-preferences.js`: 25-84
- `reviewer-acceptance-drain.test.js`: 1-122, 560-639, 830-914
- `reviewer-acceptance-personalization.test.js`: 1-69
- `reviewer-acceptance-defaults-editor.test.js`: 1-30, 150-177
- `user-preferences-reserved-keys.test.js`: 250-266
- `notification-trust-model-pushup.test.js`: 1090-1139
- `reviewer-acceptance-job-service.js`: 70-119

**Grep only:**
- test titles in the route, auth, editor and drain suites
- `profile-settings.js` wiring
- `email-placeholders.js`
- `readRequiredEmailDefaults`
- `listByOwnerAndKey`
- `ACCEPTANCE_DRAIN_SELECT`
- `grant-request.getById`
- encryption `decrypt`
- migration 024 `request_id`
- the e2e spec

I used only Read, Grep and Glob, and edited no files (including the plan scratch file). I ran no shell commands or tests, read no `.env` or secrets, and used no subagents, advisor or paid tools.
