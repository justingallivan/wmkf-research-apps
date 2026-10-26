---
title: Automatic reviewer thank-you defaults — independent implementation rereview
domain: reviewers
kind: audit
status: active
summary: "Claude PASS WITH NONBLOCKING NOTES on 2a882dac2; source corrections and test evidence inspected. No blocking findings; not released."
owner: product-engineering
related:
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_BUILD_2026-10-26.md
---

# Independent implementation rereview — 2026-10-26

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth, read-only
Read/Grep/Glob; hooks and MCP disabled. No provider keys, metered review products,
other checkout, database commands or live sends. Reviewer inspected source and tests;
root ran the tests separately. The following report is verbatim. No release authorized.

# Targeted rereview and test inspection: automatic reviewer thank-you defaults

**Verdict: PASS WITH NONBLOCKING NOTES.** I found no blocking issue and no missing test that undermines a safety claim. Five test-evidence gaps are listed below. This review does not authorize a release.

## Target, method, limits
- **Target:** `2a882dac2f55a6de19704d4839063a9e511f08e7` on `codex/reviewer-thankyou-defaults`, in the isolated worktree. Compared against the first review's target, `e4c55148f`.
- **Method:** contract-reconcile Mode A, scoped to the source delta plus the test evidence. I used Read, Grep and Glob only.
  - **Source read:** `ReviewerThankYouDefault.js`, its unsaved-changes hook, the route, `reviewer-thankyou-personalization.js`, `reviewer-thankyou-sweep.js`, the cron route, the `api-request` envelope, the `user-preference` adapter, and the guard sites in `profile-settings.js`.
  - **Tests read in full:** the six named unit suites, the e2e spec, the cron test, and the `sendOneThankYou` block of the integration test (`:395-415`).
- **Limits:**
  - I ran no tests, gates, build or shell commands. The pass counts in your brief are your evidence.
  - I could not check whether the e2e suite runs against a production build. That is set in the Playwright config and runner, which I didn't read.
  - I did not read `requireAuth` internals; the auth test's mocks show which seams it exercises.
  - Per your instruction, I wrote no plan or memory file and used no advisor, subagents or metered product. That instruction overrides this session's plan-mode workflow.

## First-review notes 1–2: closure
- **Note 1 is closed.**
  - The new branch is at `ReviewerThankYouDefault.js:106-116`. It applies only when the body says `ok === false` and the reason matches the status: 503 with `preference_unavailable` or `identity_unavailable`, or 403 with `identity_mismatch`.
  - **The "nothing was changed" wording is accurate.** I traced every place these three reasons can come from, and all of them happen before any write:
    - The route returns them at `:18`, `:29` and `:30`, all before the mutation.
    - The service returns them at `personalization.js:47`, `:51`, `:64` and `:68`, all before create, update or remove; the route passes them through at `:37`.
    - After a write, the only failures are `persistence_unconfirmed` (503) or a 200 with `refreshUnavailable` (`:36-44`). Neither can reach the new branch.
  - **Anything else is still treated as uncertain:**
    - mismatched status/reason pairs;
    - `ok: true` or a missing `ok` on a failure status;
    - 200 responses with `ok: false`.
  - **No new async gap.** The branch runs synchronously after `fresh(op)` and returns through `finally finish(op)`.
    - `setData(prev => ({...prev}))` cannot see a null `prev`. `write` requires `data`, and `confirmContextChange` bumps the epoch, so a stale response fails `fresh`.
  - **The draft stays and the page stays guarded.** `uncertain` is cleared, but the edit is still unsaved, so `guarding` holds and navigation shows the plain discard message (asserted at `editor.test.js:147-148`).
  - **Save and Clear stay off until Reload.** Both are set to `false`, and only a successful readable Reload re-enables them through `accept`.
- **Note 2 is closed.** Both headers now name "saved default or shared Admin wording": `sweep.js:6-7` and `cron/send-review-thankyous.js:6-7`.
- **Notes 3–5 are unchanged, as approved.** The "configuration" message wording at cron `:66` is also unchanged.

## Findings and missing test evidence (all nonblocking), in priority order
1. **The cron test never runs the preference-refusal path.**
   - The test title says "attachment or configuration failures", but its fixture has `skippedMisconfigured: 0` and only `attachmentFailed: 1` (`send-review-thankyous-cron.test.js:75-87`).
   - So the claim that "a paused PD makes the Maintenance run fail" rests only on reading source (cron `:56-61`). No test sets `skippedMisconfigured > 0` and checks for `'failed'` plus a "configuration error" message. Note 3 (`claimFailed` alone leaves the run completed) is also untested.
   - The source is correct. This gap is about evidence only.
2. **No test exercises the complete exact-owner listing (`listByOwnerAndKey`) itself.**
   - Grep shows no test calls the adapter at `user-preference.js:67-74`, which applies the owner/key filter and throws on a capped result.
   - The personalization suite's "foreign rows actually present" test (`:49-55`) uses a mock that does its own filtering. It proves only that the service deletes what the listing returns, not that the real filter excludes foreign rows. The "capped" case (`:60-61`) is just a mocked rejection.
   - This adapter predates the feature and is shared with three earlier personalization services. Earlier reviews verified it by reading source; this suite does not.
3. **Route tests don't pin the reason strings the client relies on.**
   - The mismatch and mapping-throw tests (`route.test.js:23-27`) and the missing-identity test (`:22`) check status codes only. They never assert `ok: false` or `identity_mismatch` / `identity_unavailable`. No route test passes the service's `preference_unavailable` through on a mutation.
   - If these drift, failures become "uncertain", which is the safe direction. That is why this is nonblocking.
   - Related: the DTO identity test (`:54`) has the mocked service return the same `ownerSystemId` as the session. It therefore cannot show that the session identity overrides the service's (`route.js:42`).
4. **A few sweep assertions are weaker than their test names suggest.**
   - **Overlap test (`sweep.test.js:428-437`):** The two-arrival barrier on DOCX rendering does prove both runs prepare before either claims. The single winner is simulated with a boolean, not the real `ifMatch` value.
     - The "unmixed pair" check (`:436`) would also pass a shared subject paired with Body B. It should pin `subject ∈ {Subject A, Subject B}` with the matching body.
     - Mixing is structurally impossible anyway, because each run sends one prepared object (`sweep.js:116`).
   - **maxBatch test (`:442`):** `ownReviewerThankYouTemplate` being called once can't tell anything apart, because all 120 rows share one PD and the lookup is cached. The real evidence that the batch-limit check precedes the lookup is `eligible: 1`, since `eligible++` runs immediately before the lookup (`sweep.js:203-206`).
   - **Integration test (`engagement-contract.test.js:409`):** checks the claim body and the claim-before-send ordering (`:397`), but not the claim's `If-Match` header.
5. **Smaller gaps in the editor and e2e suites.**
   - **Dialog handlers in the e2e spec (`:58`, `:77`)** call `expect` inside async `page.on('dialog')` handlers. If a message didn't match, the dialog would never be resolved, so the test fails by timeout or unhandled rejection instead of a clear assertion. The selectors do discriminate: URL equality, the exact field value, exactly one prompt, and an empty writes log.
     - Back is covered only for cancel. Pending-write is covered only for cancel; confirm-leave during a pending write is untested in both suites.
   - **`preference_unavailable` test (`editor.test.js:74-77`)** doesn't assert that the draft is kept or what the guard message says. The identity cases at `:143-149` do, and they share the same branch.
   - **Current-profile Archive** is tested directly only with a string ID (`:123-128`). The guard compares `String(profile.id) === String(currentProfile?.id)` (`profile-settings.js:247`), so the numeric case is equivalent. The test at `:99-106` covers non-current Archive (no discard prompt) and Switch cancellation.

## Recommendation: evidence and checks that could have disproven it
- **Personalization:**
  - Validation boundaries are exercised: 300/301 and 20000/20001 characters, trimming, CR/LF, every optional token, exact-token violations (`{{{signature}}}`, `{{ greeting }}`, stray braces, `{{honorariumNote}}`, `{{externalLink}}`), all three legacy bracket forms, case-sensitive `[Greeting]` prose, and URLs.
  - Strict readback covers lost, different and duplicate results. Create and update failures are unconfirmed. A partial Clear and a failed post-Clear listing are not success. A failed first listing returns `preference_unavailable` with zero mutations. Duplicates block Save without calling `update`.
- **Route and auth:**
  - Real `requireAuth` is exercised for the Origin check on PUT and DELETE (refused before session or identity access), for missing or disabled profiles, and for a 401 with no session.
  - Next's real `parseBody` turns a bodyless GET into `''`, which is accepted.
  - Also covered:
    - bypass and applicant sessions are refused, including in production;
    - non-scalar profile IDs are refused;
    - the owner query, scalar or array bodies, and extra fields are rejected;
    - unsupported methods get 405;
    - the service is called with the session owner;
    - mapping errors are sanitized;
    - both refresh-failure variants return `refreshUnavailable`.
- **Reserved keys:** The new key is tested in exact, uppercase and whitespace/mixed-case forms. Each form is blocked across keyed GET, list leakage with a real alias row, POST single and batch, and DELETE single and batch, with no persistence calls. The scheduled-reminder alias and normal-key tests are unchanged.
- **Sweep (actual service):**
  - Covered:
    - shared fallback when no personal default is saved;
    - personal sends with the exact sender, `actingUserSystemId` and `noFallback`;
    - five refusal statuses held before DOCX or claim;
    - the shared-empty case in both real and dry runs, with recovery on the next run;
    - title newline, long subject and long body, all refused as `rendered_context_invalid`;
    - inclusive limits through `prepareReviewerThankYou`;
    - `'*'` ETag taking precedence over bad copy in both modes;
    - shared `{{future}}` and legacy tokens still compatible, personal unknown tokens refused;
    - same-PD case-insensitive grouping while another PD proceeds;
    - a stable per-run snapshot that is fresh on the next run;
    - the 10-sample and 100-group caps with full counts.
  - Existing tests for claim-before-send ordering, DOCX before claim, no retry after an unconfirmed send, the maxBatch claim bound, and test-request isolation are still present.
- **Editor:**
  - **Actual Profile Settings page:**
    - the `isLoading` early return keeps the draft;
    - a save pending across a loading cycle stays disabled;
    - Switch cancellation works;
    - current Archive (string ID) cancels;
    - non-current Archive shows no discard prompt.
  - **Controller (test harness):**
    - foreign owner, foreign profile and malformed GET and write responses;
    - the latch after an unknown write, which an unavailable Reload can't release but a readable Reload does;
    - separate wording for a confirmed save whose refresh failed;
    - Clear confirmation with `{}`;
    - collapse retains edits, and a cancelled dirty Reload doesn't fetch;
    - duplicate pending writes are prevented;
    - same-actor pause, actor change and unmount;
    - Back restores the latest URL, and `beforeunload` warns;
    - the three new pre-write and contradictory-receipt tests.
- **E2E:** six cases (load, collapse, cancel, confirm, Back, pending). All traffic is same-origin or fixture-only, and unexpected or write requests are recorded and asserted empty.

## Seven-audit delta
1. **Caller → storage → consumer:** No new path. The client branch reads only status and reason codes that, by source trace, come from before any write.
2. **Partial success:** Unchanged. A pre-write refusal really did change nothing; a contradictory receipt is still uncertain.
3. **Stale async state:** No new await. The branch sits after `fresh(op)`, and `finish` is unchanged.
4. **Helper semantics:** Unchanged.
5. **Durable surfaces:** Header comments only.
6. **Enum/status fan-out:** The client's pre-write list (three reasons) matches every pre-write source in the route and service. `persistence_unconfirmed` is correctly excluded.
7. **Documentation:** Notes 1 and 2 are closed. I found no remaining mismatch between source and doc wording.

**Result: PASS WITH NONBLOCKING NOTES.** Target `2a882dac2f55a6de19704d4839063a9e511f08e7`. This review is not release authorization.
