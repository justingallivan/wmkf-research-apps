---
title: Reviewer deadline email defaults — build and review evidence
domain: reviewer-engagement
kind: audit
status: active
summary: Branch-only slice 2 build evidence and OAuth Opus review corrections; no deployment or live email verification.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_DEADLINE_DEFAULTS_PLAN_2026-10-24.md
---

# Reviewer deadline email defaults — build and review evidence

## Scope and invariants

Branch: `codex/reviewer-deadline-email-defaults`. Entry points are Workbench and
follow-up reviewer panels, the deadline operation route and own-user preference
route. Existing Dataverse preferences/settings and suggestion deadline fields
remain the only persistence; no schema, cron or durable draft was added.
Assigned PD only; every final operation has a fresh reviewed proof; empty bodies
remain explicit; Cc never persists as defaults and is prohibited on synthetic
requests; a saved date is never relabelled unsaved after notification failure.

## First candidate

[VERIFIED via local commands.] `a79003426` passed 1,460 Jest suites / 25,143 tests
and five snapshots, with 21 suites / 247 tests skipped. Start and end HEAD matched
in `/tmp/slice2-jest-candidate.log`. Production build, changed-file lint, required
scope gates and sequential self-tests passed. Desktop 1440px and mobile 390px
browser checks used the actual webpack-compiled editor, synthetic in-memory
responses and a localhost-only network fence: no browser errors or horizontal
overflow; From/To and Cc visible; empty-body preview, edit invalidation and PD-only
controls checked. These are component rehearsals, not authenticated live flows.
Reusable fixture: `scripts/rehearse-reviewer-deadline.js`.

## Opus build review and corrections

Review receipt: `SLICE2_OPUS_BUILD_REVIEW_2026_10_24`; Claude Opus 5.5 through verified
Claude.ai Team OAuth on the host, with API-key auth variables removed, safe mode,
Read/Grep/Glob only, no external tools or paid review product. Review returned
not ready. Parent verified reviewed HEAD and SHA256 of every changed file unchanged.

| Finding | Resolution in corrected candidate |
| --- | --- |
| P1-1: display annotations/date formatting and API property order invalidate post-write comparison | Fixed field-list row/request projection excludes annotations; canonical object ordering for digests; save and restore regressions change formatted annotations and reorder API keys while asserting actual dispatch |
| P2-1: Dataverse may represent an empty shared text value as null | Present null body is treated as empty; missing key/null subject still blocks; compatibility test added, live storage semantics remain unprobed |
| P2-2: saved-state error could also claim no date changed | Separate saved-state messages for read/config/identity/link failures; editor regression for post-write read failure |
| P3-1: seed replaces intentionally empty Admin body | Existing extension body is preserved on found=true, including empty/whitespace/null values; execute-mode tests assert no write |
| P3-2: post-write policy refusal incorrectly retryable | Preserve policy retryable=false; synthetic Cc post-write regression checks field |
| P3-3/4: non-PD error and request-mismatch messages | Route maps shared-helper 403 to assigned_pd_required; editor has explicit request_mismatch copy; reason/status test table expanded |
| P3-5: bad shared config prevents repairing own defaults | Preference GET exposes own-row repair with sharedUnavailable flag; default editor is reachable even when initial preview fails; Save/Clear remains independent |
| Test gap: defaults Save/Clear versus one-send edits | Deferred-save editor test locks conflicting edits and proves one-send draft survives Save and Clear |

Corrected focused run: 131 tests in seven suites passed. OAuth Opus recheck of
runtime candidate `26010e1b0` returned PASS, no P1/P2 remaining and no new
actionable regressions. Parent confirmed HEAD and all reviewed file hashes
unchanged. The first verdict remains historical, not an approval of a79003426.

Final verification of `26010e1b0`: 1,460 suites / 25,175 tests / five snapshots
passed; 21 suites / 247 tests skipped. Full run started and ended at that HEAD
(`/tmp/slice2-jest-final-isolated.log`, exit 0). One prior broad run collided with
an Atlas self-test temporary fixture and failed one repository-scanner test;
after the gates finished, the entire isolated rerun passed. Do not run fixture-
writing gates concurrently with repository-scanning unit tests. Jest reported an
ungraceful worker-exit warning; exit status was 0 and no teardown repair was made
outside this feature's scope.

Final production build (`/tmp/slice2-build-final.log`), changed-file lint,
api-routes, route-lifecycle-auth, route-service-boundary,
reviewer-engagement-boundary, dataverse-access-layer, trust-boundary-guid,
odata-escape, dynamics-context-boundary, status-enum-parity, Atlas,
fact-consistency, canonical-pointers, docs-catalog, doc-currency, doc-symbol-refs,
build-claim-freshness, secret-scan, scaffolding-tokens, harness-framing and types
passed; each applicable gate/self-test ran sequentially. Local browser confirmation
at 1440px/390px passed the same checks as the first round. Both owned localhost
rehearsal servers were stopped. Unrelated critique and output/ files remain
untouched. No push, merge or deployment was performed.

## Whole-flow / contract-reconcile

Source → persistence → consumer: authenticated app guard and session actor →
request authorization plus same-context PD/sender equality → optional shared/own
wording read → selected-state digest preview → final fresh state/proof check →
conditional suggestion write for save/restore only → post-write confirmation →
full-recipient safety check and Dynamics email/calendar → explicit saved/notified
result → current-generation editor state. Retry/resend performs no date write.

Partial success: one reviewer per operation, explicit saved/notified booleans;
post-write reread failures retain saved=true; uncertain sends have no retry proof.
Async: mounted/context/generation guards; identity/permission changes close/reset;
conflicting Save/Clear and send actions lock edits. Helper semantics: extension-only
validator allows optional/empty body, does not weaken sibling required tokens or
authorization. Durable surfaces: existing stores only, new route in security matrix,
namespace guard verified, both private/reserved preference key sets, canonical
route counts regenerated, service catalog updated. Symbol fan-out: raw key,
extension Admin keys, operation/result reasons and both UI mounting paths checked.
Documentation reconciliation uses branch-built labels, not production claims.

## Remaining verification boundaries

No Dataverse, email, configuration seed, production deployment or business-record
write was invoked by this task. Before promotion, authorize and perform the
non-overwriting subject seed and exact readback with candidate validation; verify
empty description acceptance in the chosen isolated delivery rehearsal. Actual
null/annotation storage behavior has source-based compatibility coverage, not a
fresh live observation. The suggestion ETag cannot atomically lock request fields;
a remaining cross-record race is documented, not described as owner-accepted.
Proofs expire after five minutes but are not single-use; manual resend/retry
replay outside the UI is an existing-pattern limitation. A transport timeout on
the date PATCH still has the baseline ambiguous-write limitation; this change does
not claim to solve it. No migration or PostgreSQL integration change is in scope.

## Final Opus recheck — verbatim receipt

The following is the read-only review result for `26010e1b0`, not an independent
execution of tests by Opus. Build/test results above were run by the parent.

# Slice 2 build recheck: SLICE2_OPUS_BUILD_RECHECK_2026_10_24

**Verdict: PASS.** All nine earlier findings are resolved in source, and each fix has a test that would have failed on the old code. No P1 or P2 remains. I found no new actionable regressions, only three small test and copy nits.

I used only Read/Grep/Glob and made no edits. I did not run tests, a build or git. The "131 tests in seven suites passed" figure is your report; I didn't reproduce it. I'm making no claim about the full suite, the production build or the gates on this HEAD.

## Earlier findings

**P1-1: the email never sent after a real save or restore — RESOLVED**
- **Fix:** `lib/services/reviewer-due-extension.js:233-235` adds `selectedSnapshot`, which keeps only the `SUGGESTION_SELECT` / `REQUEST_SELECT` fields plus `_etag`, in a fixed order. The binding uses it at `:283`, so `_formatted` annotations never enter the proof digest. `postWriteStableDigest` (`:341-344`) removes only the date override, the grant timestamp and the ETag. That is safe because `changeReviewDeadline` → `updateLifecycle` writes only those two fields (`change-review-deadline.js:25-31`; `reviewer-suggestion.js:1968-1993`).
- **Key order:** `deadlinePreviewDigest` (`reviewer-deadline-personalization.js:25-33`) now sorts the keys of plain objects at every level and leaves arrays in order, so Cc order still counts. Test: `reviewer-deadline-personalization.test.js:53-57`.
- **Tests that would fail on the old code:**
  - `reviewer-due-extension.test.js:182-194` covers both save and restore. After the write it adds `wmkf_reviewstatus_formatted`, changes or clears `wmkf_reviewduedateoverride_formatted`, adds a request annotation and reverses every key. It then asserts `notified:true` and exactly one dispatch. The old exclusion list didn't cover `wmkf_reviewstatus_formatted`, so the old code would have returned `preview_stale` here.
  - `:195-198` covers annotations that change between preview and send. Proof drift on real business data is still caught at `:111-118`.

**P2-1: an empty Admin body stored as null blocked every email — RESOLVED**
- **Fix:** `reviewer-deadline-personalization.js:20-21` accepts a found body with a null value and treats it as `''`. A missing key, or a subject that is null or not a string, still returns `misconfigured`.
- **Test:** `reviewer-deadline-personalization.test.js:48-52` covers a null body succeeding and a null subject blocking.
- **Consistency:** the Admin GET already shows null as `''` (`pages/api/admin/email-defaults.js:21`).

**P2-2: the saved-but-unsent message also said "No deadline was changed" — RESOLVED**
- **Fix:** `ReviewerDueDateEditor.js:158-167` uses separate saved-state wording for `read_failed`, `notification_unavailable`, `misconfigured` and `token_recovery_required`. I checked every other reason the post-write re-check can return: none contains "No deadline was changed".
- **Test:** `reviewer-due-date-editor.test.js:76-81` runs each of the three reachable reasons and asserts "No deadline was changed" is absent.

**P3-1: the seed overwrote an intentionally empty Admin body — RESOLVED**
- **Fix:** `scripts/seed-email-defaults.mjs:161` skips the extension body whenever `current.found` is true.
- **Test:** `seed-email-defaults.test.js:206-213` runs `--execute` with `''`, `'   '` and `null`, and asserts nothing is written.

**P3-2: the post-write failure branch always said `retryable: true` — RESOLVED**
- **Fix:** `reviewer-due-extension.js:366` is now `retryable: current.ok || current.retryable !== false`.
- **Test:** `reviewer-due-extension.test.js:99-104` asserts `retryable:false` for `cc_not_allowed_for_test_request` after the write.

**P3-3: a non-PD got a 403 without `assigned_pd_required` — RESOLVED**
- **Fix:** `pages/api/review-manager/review-due-extension.js:96` maps a 403 `ServiceHttpError` to `{ok:false, reason:'assigned_pd_required'}`.
- **Scope:** the only 403 the shared helper throws is the lead-PD denial (`reviewer-request-authorization.js:130-133`). Its 400 and 404 errors pass through unchanged, so the mapping is exact.
- **Test:** `reviewer-due-extension-route.test.js:39-44`.

**P3-4: `request_mismatch` had no editor message — RESOLVED**
- **Fix:** editor message at `ReviewerDueDateEditor.js:39`.
- **Test:** route mapping (409) at `reviewer-due-extension-route.test.js:35`.

**P3-5: a broken shared config blocked repairing personal wording — RESOLVED**
- **Route:** the preferences GET (`deadline-email-preferences.js:37-53`) now always reads the personal row.
  - A damaged personal row returns 409 with `sharedUnavailable`.
  - A good row returns 200 with `sharedUnavailable` and `shared:null`.
  - A failed personal read still returns 503.
- **UI:** `DeadlineWordingDefault` sits outside the `template &&` block (`ReviewerDueDateEditor.js:211`), so it stays reachable when the first preview fails. Its messages are at `DeadlineWordingDefault.js:65,73`.
- **Tests:** `deadline-email-preferences-route.test.js:109-115` and `reviewer-due-date-editor.test.js:95-102`.

**Test gap: defaults Save/Clear during a one-send edit — RESOLVED**
- `reviewer-due-date-editor.test.js:82-93` holds a Save open, asserts the one-send message field is locked, then asserts its text survives both Save and Clear.

## New findings (all non-blocking)

1. **Route test is one reason short.** The reason-to-status table at `reviewer-due-extension-route.test.js:35` has 21 entries, but `REASON_STATUS` has 22: `send_failed` (502) is missing. "All reason statuses" is really all but one.
2. **A test name overclaims.** `reviewer-due-extension.test.js:195` says "selected business data still does" invalidate a preview, but it only checks the annotation half. The business-data half is covered at `:111-118`, so this is a naming issue, not a coverage gap.
3. **One saved-state message can't be reached.** The `token_recovery_required` message at `ReviewerDueDateEditor.js:163` can't appear after a save. The post-write re-check runs as a retry, which skips the token check at `reviewer-due-extension.js:250`. The copy is harmless; it just isn't evidence of a reachable path.

I found no regressions in these areas:
- Assigned-PD-only gating.
- Proof binding (operation, actor, Cc, template, ETag).
- Synthetic-request Cc refusal, before the write and at dispatch.
- Empty or whitespace body passthrough.
- Retry and resend never writing a date.
- No retry proof after an uncertain send.
- Exact own-user Save/Clear.
- The personal-read fallback notice.

## Unchanged baseline limits (not introduced by this change)

- Retry and resend proofs can be reused within their five minutes.
- The race between the request and suggestion records remains; the suggestion ETag doesn't lock the request.
- A timed-out date PATCH is still reported as `save_failed` even if it may have been written.
- Dynamics accepting an empty email description hasn't been checked live.
- Errors from the shared helper other than 403 still return the raw message as `reason`, so the editor shows its generic text.

## Review limits

- I re-read only the changed files and their direct callees. For unchanged files (`dynamics/{http,annotations}.js` and most of `reviewer-request-authorization.js`) I relied on the earlier review.
- I read only the relevant parts of the plan doc and the security matrix, and only the extension-body block of `seed-email-defaults.test.js`.
- I didn't confirm that `getRequestById` returns `_etag`. If it doesn't, post-write change detection on the request rests on its four selected fields. That was already true before this change.
- Whether Dataverse stores an empty body as null, and whether it emits formatted annotations on these date columns, still isn't observed live. Both are covered only by source reasoning and mocks.
- HEAD, the changed-file SHA256s and the full suite, build and gate results are yours to verify.
