# Final Claude Opus build review — 2026-10-16

[VERIFIED via subscription OAuth Claude CLI, read-only tools.] Reviewed runtime commit `f98ecf16ec9ea296dc8f978e7df8dc13aeb1152e`; focused closure verified `423dbb9c6`. No deployment or external writes. Some reviewer line references below refer to patch positions, not current source lines.

## Independent verdict

**Verdict: BUILD REVIEW PASSED WITH NAMED ACTIVATION GATES.** This is conditional on two build checks the builder is still rerunning: the real-PostgreSQL integration suite (including the new N1 test) and the webpack final build. I couldn't run either from a read-only review, so the pass only stands if both come back green.

This was a read-only review using Read, Grep and Glob. I made no changes, ran no subprocesses and used no metered products.

## N1: fixed
- **The fix:** both places that compare the saved settings now use the shared order-independent comparison (`config.js:130` and `config.js:167`).
- **No residual mismatch:** the settings validation is a fixed point, so its output doesn't change on a second pass (`model.js:33-44`). IDs are lowercased, dates must already be exact `YYYY-MM-DD`, extra keys are rejected and arrays keep their order. A value read back from Dataverse therefore matches the validated pending save once keys are sorted.
- **The test has teeth:** `tests/integration/board-writeup-postgres.test.js` saves through the real `mutateCycle` path. The settings are built in form order, starting `version, cycle`, and PostgreSQL's JSONB storage puts `cycle` first. Reverting to the old plain-text comparison would fail this test.
- **No other comparison has the same problem:** I checked every remaining `JSON.stringify(...) ===` comparison in `board-writeups/`.
  - `recovery.js:45` and `archive.js:73` compare two values that both come from the database.
  - `notifications.js:114` compares an object built explicitly in `{to, cc}` order whose values are plain email strings.
  - `config.js:91` compares arrays.

## N2: fixed
- **Refusal is recorded from one place only:** `uploadRefusal` is set only in the catch around the single upload PUT (`service.js:119-121`, `archive.js:146-148`), and stored only when there is no destination (`service.js:148`, `archive.js:156`).
- **The status is real in production, not just in mocks:** `putUploadSessionChunk` makes one call with no retry and throws `buildServiceError`, which sets `e.status` (`upload-session.js:137-146`, `service-error.js:41`). Timeouts and aborts carry no status, so they stay unknown.
- **Only definite refusals count:** the allowed list is 400/401/403/409/412/413/415/422 (`model.js:222-225`). 404, 408, 410, 429 and 5xx are excluded, and the parameterized test covers 404/410/429/500/503.
- **A retry can't overwrite or duplicate a file:** both upload paths create the file with "fail on name conflict" (`graph/board-writeups.js:63`, `archive.js:137`). So a retry after a 409 refuses again rather than replacing or doubling a copy.
- **Recovery behaves as intended:** recovery clears the upload marker only for a proven refusal on cancel, retry or refreeze. The prior upload details are kept in the audit entry, and stale-state fencing is still in place (`recovery.js:42-56`). A cancelled release can then be selected again by the CSO (`service.js:74-76`).

## N4, N6 and the regression fixes: correct
- **Archive exclusion (N4):** an admin can exclude an entry only when no copy was committed, or when the upload has a proven refusal (`recovery.js:319`). Excluding an entry can complete the archive manifest (`:348`). The worker skips excluded entries (`archive.js:119`).
- **Admin notices (N4):** admin control notices now keep running when a request has left the cycle, and labels are hidden unless the request is confirmed ordinary (`notifications.js:270-272`). Beth's release reminders still stop, which the Atlas operator exception documents.
- **Early-draft preview (N6):** both early-draft gates now use `boardWorkEnabled()` (`config.js:60`, `service.js:407`). No direct `BOARD_WRITEUPS_ENABLED` checks remain outside `mode.js`.
- **Pre-site POST:** every call to `canChangeDraftWriteup` now matches its two-argument signature (`writeup-visibility.js:72`), so the undefined `status` reference is gone.
- **Legacy digest:** in Board modes, only the Research program is dropped from the old digest; other programs keep it. The program list is read synchronously (`leadership-digest-service.js:389`), so the `.filter()` call is safe.
- **Pagination:** the folder listing is limited to one folder path, and `request()` independently rejects any host other than Microsoft Graph (`graph/board-writeups.js:19,48`).

## Non-blocking findings (low)
1. **Completion email can stall.** The new loop over removed roster IDs in the completion email (`notifications.js:276-279`) doesn't guard `getRequest`, unlike `:270`. If a removed request can't be read, the completion email throws on every worker run. It isn't silent, because the worker raises an alert (`worker.js:59-60`), but the email never sends. Fix: wrap it the same way as `:270`.
2. **Wrong recovery text in exactly the N2 case.** For a release with a proven refusal, recovery inspection returns no retry option and no candidate files. The screen therefore shows "No verified copy or definite refusal was found…" right under the "Cancel release with no committed copy" button (`BoardWriteups.js`, patch line 576; `recovery.js:366`).
3. **One new path is untested.** Excluding an archive entry that has a recorded 409 refusal is allowed by `recovery.js:319` and the code reads correctly, but no test exercises it.
4. **Pagination check is strict.** Comparing exact URL paths could reject a valid Graph next-page link that encodes the drive ID differently. It fails safe, and D26's 23 files fit in one 200-item page.
5. **Cosmetic:** in `config.js:1-3` the `mode.js` import sits above the file's header comment.

## Three separate buckets
- **Build-evidence conditions for this verdict:** the PostgreSQL integration run and the webpack build, both green.
- **Activation gates (not build defects):**
  - Registered test destination and a synthetic DOCX round-trip
  - Option `100000014` and migration 085 applied and read back
  - Roles, dates and the confirmed roster of 23
  - Hosted staff rehearsal
  - Old-digest drain and recipient re-check
  - Timing of Graph's `fail` name conflict, and whether `~$` lock files appear in the D26 folder
- **Accepted operator exceptions, documented in the Atlas with no blind replay:**
  - N3: an ambiguous first setup save, or a settings conflict made outside the app
  - N5: an ambiguous email create or send
  - N2 unknown outcomes: a timeout or 5xx where no file ever appears still has no way to resolve it in the app. That stays an investigation and binding exception, as previously accepted.

## Focused follow-up verdict

**Verdict: these changes keep BUILD REVIEW PASSED WITH NAMED ACTIVATION GATES.** Your report that the real PostgreSQL run passed (all 4) and the webpack build passed meets the two conditions I put on the earlier pass. I didn't rerun either.

I read only `/tmp/board-opus-small-followup.patch`. The three low follow-ups are closed and the patch adds no new problems.

1. **Completion email with a missing removed request:** fixed. `notifications.js:68-69` now catches the failed lookup the same way as `:270`. When the record can't be read, `request` stays undefined, so `ordinary()` returns false and that label is left out. The completion email then shows "Proposal details unavailable; see setup history" instead of throwing. The new test proves the email is created, sent once and marked accepted, with the redacted text in its body.
2. **Contradictory recovery text:** fixed. The fallback paragraph now also needs `!recovery.canCancel`. `canCancel` is set only for a release that never started uploading or has a recorded refusal (`recovery.js:363-366`). In both cases the cancel button is the right action, so hiding the "no definite refusal" text is correct. When the outcome is genuinely unknown, there's no cancel option and the text still shows.
3. **Untested exclusion after a 409:** now covered. The new test runs a held archive entry with a recorded 409 refusal and no copy, and checks three things: exclusion succeeds, the archive completes, and the audit entry keeps `priorUpload.uploadRefusal.status === 409`. Together with the existing "unknown upload is refused" test, both sides of `recovery.js:319` are now tested.
4. **Header comment:** moved back above the imports in `config.js`. This is cosmetic only.

The patch makes one runtime change, the `try/catch` around the historical lookup, plus a one-condition change to the recovery screen. Everything else is tests and the comment move.

The activation gates and accepted operator exceptions from my previous verdict still apply unchanged. Deployment is still not approved.

## Builder verification and handoff

[VERIFIED via local commands.] Final scoped suite: 9 suites, 228 tests pass. Real localhost PostgreSQL: 4 tests pass (concurrent writers, rollback, archive/release lock, JSONB configuration reconciliation); isolated test container stopped. Webpack production build passed; ESLint and type check passed. Relevant route, request-document writer, Dataverse boundary, OData, context, lifecycle, enum, migration-manifest, Atlas, fact-consistency, document currency and secret gates passed; gate self-tests were run sequentially. No synthetic SharePoint upload/archive round-trip or hosted browser rehearsal has been performed.

The reviewed build is on `codex/research-board-workflow`; do not merge the superseded `codex/sarah-board-writeups` branch. No push, merge, deployment, schema application, mail send or real file copy was performed. The exact-path pagination check intentionally remains fail-closed and needs provider pagination verification before a larger cycle. N3/N5 and unknown-upload operator procedures remain in `docs/atlas/postgres-board-writeup-runs.md`.

**OPEN until Justin explicitly reports done:** enter D26 Allison materials deadline and Board meeting end date in Admin. Staff must also confirm the 23 expected request identities. Build completion does not close these items.
