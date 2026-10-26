---
title: Automated reviewer thank-you defaults — independent plan rereview
domain: reviewers
kind: audit
status: active
summary: "Claude READY TO IMPLEMENT at 8af5b8381; R1–R5 closed. Owner subsequently approved shared-path rendered-copy safety holds on 2026-10-26. Plan-only; no implementation or release authorization."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_THANKYOU_DEFAULTS_PLAN_2026-10-26.md
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-26.md
---

# Independent Claude plan rereview — 2026-10-26

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth, read-only
Read/Grep/Glob, hooks/MCP disabled, no edits/scratch plan/shell/tests/live data,
other checkout, advisors/delegation or metered review product. Target `8af5b8381`.
Root ran baseline tests separately. The initial N1 correction was confirmed.
Post-review mechanical clarification pins render refusals to skipped plus
skippedMisconfigured and makes the missing-ETag preparation rule identical in
real/dry runs. These are the report's nonblocking note2 dispositions, not a claim
that Claude reviewed a later fingerprint. The shared-path rendered-copy refusal was pending at review time. Justin
subsequently confirmed on 2026-10-26: hold it before claiming and report the problem.
The current plan records that decision; the historical report below is unchanged.
No code is built.

## Verbatim report

# Delta re-review: automated reviewer thank-you defaults plan

**Target:** `docs/plans/PERSONAL_EMAIL_REVIEWER_THANKYOU_DEFAULTS_PLAN_2026-10-26.md` at `8af5b8381` on `codex/reviewer-thankyou-defaults-plan`. Runtime baseline is `448ed17d1`. This updates the initial review at `dc9e65a5c`.

**Method:** I read the whole plan and the initial report. I checked them against the source each revision cites, using contract-reconcile Mode A by hand. I used only Read/Grep. I made no edits (including no plan or scratch file), ran no shell commands or tests, used no advisor or subagents, and touched no live systems.

**Verdict: READY TO IMPLEMENT.** This does not authorize implementation or release; the owner still has to authorize both.

## Closure table

| # | Status | Evidence checked |
|---|---|---|
| R1 | **Closed** | Plan lines 109–119 drop the new shared-copy grammar check. Its alias list matches the renderer exactly: subject `{{proposalTitle}}` and `[proposal title]` (`reviewer-reminder-email.js:197-200`); body tokens plus the `{{honorariumNote}}` strip (`:178-186`). Today's presence check (`email-defaults.js:34`, nonblank via `trim()`) stays batch-wide. The plan adds no owner decision and no live dryRun. Personal-copy validation is a separate rule set (lines 91–105). |
| R2 | **Closed** (see note 1) | Final subject: nonempty, at most 2000 code units, no CR/LF. Rendered body: nonempty, at most 100000. Both are stated as app safety limits, not Dataverse limits. Trim is used only to test blankness, and the original output is sent. The plan defines two refusal reasons, `rendered_context_invalid` and `rendered_copy_invalid`, with no truncation, and lists the own-copy limits (300/20000), the literal-URL rule and the exact bracket aliases. |
| R3 | **Closed** | The route moves to `/api/reviewer-thankyou-email-preferences`. `check-api-route-security-matrix.js:12-27,98-110` matches guard names in source and checks matrix rows by route string; it does not infer anything from the directory. The plan's described auth matches the exact-owner precedent `scheduled-emails/email-preferences.js:12-29` (bypass/applicant 403, profile-to-system-user match). The asymmetry with the reminder routes is stated as deliberate. The matrix row is added only once the route is built. |
| R4 | **Closed** (see note 2) | Eligible is counted before the own lookup, which matches today's placement (`reviewer-thankyou-sweep.js:192`). Pure render checks run before the dryRun early return (`:193`). No new counter; diagnostics are grouped by PD and reason, capped at 10 samples per group and 100 groups. The maxBatch check stays at the top of the loop (`:177`), and dryRun still never counts toward the batch limit (`:193-195`). The plan acknowledges that dryRun writes its Maintenance run record and may alert on missing shared copy (`send-review-thankyous.js:42,58`; `email-defaults.js:44`). Both paths use one preparation function. |
| R5 | **Closed** | The GET response echoes `authenticatedProfileId` and `ownerSystemId`; the client compares both with the session and with `currentProfile`. The `isLoading` early return at `profile-settings.js:351` is confirmed, so the controller hook runs before it. Switch (`:732`) and Archive (`:239-245`, `:755`) are the only context-changing actions; there is no `createProfile` or `router.push`. All four help/comment sites are named. |
| N1 | **Correction confirmed** | `send-emails-service.js:123,1172-1184` calls `recordDeliveredEmail` for non-invitation sends. `record-email-outcome.js:28-33,80-90` maps thankyou to `thankYouSentAt` with If-Match. `reviewer-suggestion.js:1952` maps that to `wmkf_thankyousentat`. This is bookkeeping after the send, not a claim before it. The initial N1 was wrong. A manual write changes the ETag, so a later sweep claim on that row gets a 412; the manual-send-versus-cron race itself is correctly left as existing behavior. The incorrect claim in the cron header (`:9-11`, "can never double-thank") is in the planned header edits. |

## New blocking findings

None.

## Non-blocking clarifications (fold into implementation and tests)

1. **R2 checks also run on the shared Admin copy, which is a small new refusal.** "For BOTH sources" (line 122) means three cases that send today will now pause the row and mark the Maintenance run failed:
   - a shared subject containing CR/LF, or over 2000 code units once the title is filled in;
   - a request title containing a newline;
   - a shared body that renders empty (for example, only `{{honorariumNote}}`).

   The risk is low. The seed subject is one line (`reviewer-templates.js:87`), and the Admin field is `multiline: false` (`editableTextDefaults.js:237`). But this sits in tension with R1's "no new refusal for shared copy" framing. When the owner authorizes implementation, record that this refusal is deliberate.
2. **Steps 5 and 6 leave two counting details open.**
   - Does a render or copy refusal also increment `skipped`? The plan says so for own-preference failures (step 4), but step 6 only says `skippedMisconfigured`.
   - In the non-dry path, `sendOneThankYou` checks the ETag before preparing. So a row with no ETag and bad copy counts as `claimFailed` in a real run but `skippedMisconfigured` in dryRun, which contradicts "counts them identically".

   Pin both in tests. The plan's budget rule ("preparation failures may consume the run's budget as today") implies non-dry preparation runs inside the helper, after `attempted++`. Say so in one line.
3. **Archive scope.** Archive appears on every profile row, but only archiving the current profile changes context. The plan's "current-profile Archive" wording is right; the test should cover archiving a non-current profile without a warning.

## Contract-reconcile Mode A (delta only)

1. **Caller → persistence → consumer:** The chain is unchanged and still traces correctly: cron → `withDalContext` → sweep → context → own read once per PD → pure preparation → DOCX → If-Match claim → send. The manual bookkeeping writer is now described correctly.
2. **Partial success:** Refusals before the claim leave the marker null. Title or context refusals stay paused until data or wording is fixed and are reported under a distinct reason (R2), so they do not look like a clean run.
3. **Stale async state:** On the client, the controller lives above the loading return and is scoped to the actor and profile; late responses are ignored. On the server, each run keeps its own per-PD promise cache.
4. **Helper semantics:** The shared renderer is untouched; the stricter grammar applies only to personal copy. One preparation function serves both dryRun and real sends.
5. **Durable surfaces:** No schema change. One new key. The matrix row is added after build. Two counters are reused and errors are grouped. Four copy sites and three header corrections are listed.
6. **Deduplication / fan-out:** Unchanged. Duplicate own rows block only that PD. Diagnostics are capped at 100 groups.
7. **Docs:** "Planned, not built" labels hold. The N1 correction is recorded rather than deleted.

## Checks that could overturn this

- Live shared thank-you subject and body: whether they contain CR/LF or render empty (note 1).
- Maximum length of `akoya_title` and whether it can contain newlines.
- Whether the session exposes `profileId` to the client. I did not check `useSession`.
- What `archiveProfile` does to `currentProfile` in the profile context.

## Remaining product decisions

Only one: the owner should acknowledge the R2 shared-path refusal (note 1) when authorizing implementation. Nothing else is open.

## Limits

Live tenant state, delivery and saved values are UNKNOWN. I did not read `ScheduledGranteeReminderDefaults.js` or check how the installed Next version handles a bodyless GET. The test and gate results are root's, not mine.
