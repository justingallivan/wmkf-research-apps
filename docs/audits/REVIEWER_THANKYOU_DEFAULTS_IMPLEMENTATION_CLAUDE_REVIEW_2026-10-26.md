---
title: Automatic reviewer thank-you defaults — independent code review
domain: reviewers
kind: audit
status: active
summary: "Historical code targete4c55148f: Claude PASS WITH NONBLOCKING NOTES, no blocking findings. Identity-refusal wording and two headers corrected for targeted rereview; test inspection requested separately. Not released."
owner: product-engineering
related:
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_BUILD_2026-10-26.md
---

# Independent code review — 2026-10-26

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth; Read/Grep/Glob
only, hooks/MCP disabled, no edits including scratch plan, shell/tests/live calls,
other checkout, advisors/delegation or metered review product. Exact target:
`e4c55148f7bd08f59b6011de6e7d9519dd159430`.

The reviewer explicitly did not inspect test files in this first pass. Root is
requesting a targeted source-fix rereview PLUS direct test inspection before
completion. Root's tests remain separate evidence. Report below is verbatim.
No release authorization.

## Verbatim report

# Independent Claude code review: automatic reviewer thank-you defaults

**Verdict: PASS WITH NONBLOCKING NOTES.** I found no new blocking issue. This review does not authorize a release.

## Target, method and limits
- **Target:** `e4c55148f` on `codex/reviewer-thankyou-defaults`, in the isolated worktree. I read the feature commit `e181e0681` against the accepted plan, including the §9 owner decision that the rendered safety holds apply to both shared and personal copy.
- **Method:** contract-reconcile Mode A, using Read, Grep and Glob only. I traced cron → sweep → adapter → claim → transport, and Profile Settings → route → service → adapter → response → controller.
- **Limits:**
  - I ran no tests, gates or shell commands. The test results in your brief are your evidence, not something I re-ran.
  - I did not read the test files, the internals of `requireAuth`, Origin or revocation handling, the internals of `resolveProfileToSystemUser`, or the corpus files you integrated.
  - I did not use the advisor, subagents, the plan file or memory, as you instructed. That overrides this session's plan-mode workflow.

## Findings, in priority order

**Blocking: none.**

**Nonblocking:**
1. **Some write failures lock the editor when nothing was written.** A mutation can be refused before any write: 503 `identity_unavailable` or 403 `identity_mismatch` (`pages/api/reviewer-thankyou-email-preferences.js:18,29-30`). The client treats both as unconfirmed (`ReviewerThankYouDefault.js:116,129`) and shows "may already be saved" until a strict Reload. This is safe but the wording overstates the risk. Optional fix: give these two reasons the same "nothing was changed" branch as `preference_unavailable`.
2. **Two header comments still describe only the seeded template.** Line 6 of both `lib/services/reviewer-thankyou-sweep.js` and `pages/api/cron/send-review-thankyous.js` says "using the seeded 'thankyou' template". The corrected paragraphs below them are accurate. Changing line 6 would be a comment-only fix.
3. **Missing ETag is not flagged in Maintenance.** It counts as `claimFailed` only (`sweep.js:62`), so the run status does not show failed. This matches plan §5 step 5 and the earlier behaviour; it is noted only so nobody reads a clean run as "no rows were blocked".
4. **One effect has incomplete hook dependencies.** In `ReviewerThankYouDefault.js:92-94`, the omitted `data` and `notice` are intentional and don't cause a loop: a failed read sets `notice`, and switching context closes the panel. These are likely the 3 new lint warnings you mentioned.
5. **Diagnostic grouping scans the error list on every refusal** (`sweep.js:66,70`). With at most 100 groups this costs nothing in practice.

## How I checked the recommendation, including checks that could have found a problem
- **Sweep ordering (`sweep.js:77-111`):** preparation runs first (ETag → personal revalidation → render → blank/length/CR-LF checks), then the DOCX, then the If-Match claim. Nothing reads settings or preferences, renders or rebuilds after the claim. The send uses the prepared `subject`/`html` (`:115-118`), with the same `nowIso` for the DOCX and the claim, and the existing sender/recipient/`noFallback`. A failure after the claim does not roll back the marker (`:128-135`).
- **Real and dry runs prepare identically:** both use `prepareReviewerThankYou` (`:215`, `:81`), and the ETag check comes first (`:46`). Refusals in a dry run are counted the same way as in a real run.
- **Shared copy is held when it renders empty:** `buildThankYouBodyText` replaces `{{honorariumNote}}` with an empty string (`reviewer-reminder-email.js:183`). A body that is only that token now fails with `rendered_copy_invalid` before the claim (`sweep.js:54`), which is the regression you reported. Shared token grammar itself is unchanged; there is no shared validator call (`personalization.js:30`).
- **Counts and per-run cache:** `eligible` increments after the GUID/sender/reviewer checks and before the own-default lookup (`:201-205`). The promise is cached per lowercase PD before awaiting, including failed results. Failed own-default reads become `preference_<status>` → skipped + `skippedMisconfigured`, which marks the Maintenance run failed (cron `:55-60`). `attempted++` happens only in real mode, before `sendOneThankYou`, and the `maxBatch` check still comes before any lookup (`:186`).
- **Exact-owner enumeration:** `listByOwnerAndKey` uses `queryAllRecords` and throws on `capped` (`user-preference.js:67-73`; `read-ops.js:266-326` returns `capped`). So a partial listing is "unavailable", never a misleading "absent".
- **Save and Clear:**
  - If the first listing fails, the result is `preference_unavailable`. Duplicates return 409 before any write.
  - Save checks that the readback matches the submitted pair exactly. Clear lists again to confirm the key is gone.
  - Any exception after that point is `persistence_unconfirmed` (`personalization.js:49-73`).
- **Route:**
  - Rejects unsupported methods (405) before auth.
  - Rejects bypass and applicant sessions.
  - Requires a session GUID and a positive profile number.
  - Rejects any query, and a GET body unless it is null, `''` or `{}`.
  - Requires PUT to be exactly `{template}` and DELETE to be exactly `{}`.
  - Requires the server's profile map to equal the session actor (case-insensitive) inside `withDalContext`.
  - The response identity comes only from the session.
  - A confirmed mutation followed by a failed refresh returns `refreshUnavailable: true`.
- **Generic preference paths:** the new key is in both the reserved and private sets. The canonicalizer covers only the two keys (`user-preferences.js:57-64`) and is applied to keyed GET, list filtering, POST single/batch and DELETE single/batch (`:127,149,173,227`). The other callers of `getUserPreferences` read only their own fixed keys (prompt-override `:76`, email-automation `:32`), so nothing else exposes the new key.
- **Client:**
  - The controller runs before the page's `isLoading` early return (`profile-settings.js:100` vs `:355`).
  - Epoch, `inFlight` and the `fresh()` check drop late responses, including after a pause and resume.
  - A response is accepted only if it matches the session/profile/DTO identity and is internally consistent (`:49-60`).
  - An unknown mutation result leaves `uncertain` set until a successful Reload.
  - Switch and current-profile Archive go through `confirmContextChange` (`:247,737`); Archive of another profile is unchanged.
  - No other component on Profile Settings registers `beforePopState`, so the new guard does not overwrite one. The only other user is on `scheduled-emails.js`.
- **Route matrix:** the new route has a row in `docs/API_ROUTE_SECURITY_MATRIX.md`.

## Seven audits
1. **Caller → storage → consumer:** consistent from end to end, in both directions; nothing reads defaults after the claim.
2. **Partial success:** a partial Clear, readback mismatch or exception is unconfirmed. A failed first listing is "nothing changed". Confirmed-but-not-refreshed is reported separately. After the claim, the marker is kept and nothing is retried.
3. **Stale async state:** server reads are snapshotted per run per PD and fresh on each run. On the client, the epoch/sequence/`inFlight`/mounted checks cover reads, writes and the `finally` branches.
4. **Helper semantics:** one pure preparation function is used by both real and dry runs. The validator is applied only to personal copy. `buildThankYouBodyText` runs once for the preflight and once inside `renderThankYou` with identical inputs, and it is deterministic.
5. **Durable surfaces:** no schema change and no new persisted state beyond the one preference key. Existing transport, the DOCX builder, the shared renderer and the legacy manual-send marker writer are untouched. The headers now say claims fence only overlapping automatic sweeps.
6. **Enum/key fan-out:** the new statuses are covered in the service, sweep reasons, the client's `validResponse` and the Maintenance count. The key is registered in config and both generic-route sets, with alias handling.
7. **Documentation:** the plan, the route matrix row and the corrected headers match source, except for nonblocking note 2.

**Result: PASS WITH NONBLOCKING NOTES.**
