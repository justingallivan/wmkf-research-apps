---
title: Claude re-review of distribution-defaults implementation
domain: workbench
kind: audit
status: active
summary: "Historical OAuth checkpoint 80826ff16 passed with no blockers; remaining findings were subsequently fixed and independently rechecked. See the build audit for current branch verification."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
  - docs/audits/DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-25.md
---

# Independent revised implementation review — 2026-10-25

[VERIFIED via host Claude CLI with ordinary Claude.ai OAuth/subscription.]
Exact target `80826ff1601275cbffefbbbe5343cd7da5d9aee4`; worktree remained
clean during this review. Full report follows verbatim. No live operations or
metered review product, no other checkout or database work.

## Final-delta disposition

- N1: handler-level busy guard and disabled inline discard controls; deferred
  Save tests prove no Close or Reload while pending. Open versions wait for
  mutation completion before being consumed.
- N2: the pending/unconfirmed-default warning also explicitly names lost email edits.
- N3: a retained dirty open offers Discard edits and start fresh inside the same
  dialog, using the ordinary fresh-init path, with Keep editing/Escape preserved.
- T1–T4: added real panel-to-router pending-warning/retention checks, exact Reload
  hint assertions (including an unavailable own-status DTO), raw editor repair
  after overlong resolved subject, and composed duplicate/shared-outage notices.
- Root teardown audit: actual unmount invalidates prepare/reissue lanes and
  aborts only prepare. Late lock cannot start prepare; late reissue cannot fetch
  history or notify the old parent. Issued Send remains un-aborted and uses its
  existing mounted/envelope fence. Three new busy-discard/teardown tests fail
  against 80826ff16 and pass with the final delta (root regression experiment).

These changes subsequently received the delta review below the review chain;
the last required D1 finding was fixed and independently passed at 1215cfd7d.
See `docs/audits/DISTRIBUTION_DEFAULTS_BUILD_2026-10-25.md` for current
branch verification. This historical receipt does not authorize release.

## Verbatim re-review

# Re-review of `80826ff16`: **PASS** (no blocking findings)

**Reviewed commit:** HEAD `80826ff1601275cbffefbbbe5343cd7da5d9aee4` (worktree clean), delta `a5f3b6548..80826ff16`, checked against `docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md`. I edited nothing, ran no live operations or metered products, and delegated nothing. This review doesn't authorize a release.

## F1 and L1–L5, one by one

- **F1 — fixed.**
  - `sameDistributionId` (`PreSiteDistributionPanel.js:21`) requires both values to be strings and compares them exactly after lowercasing. It is used at both sites: the acceptance check (`:769`) and the no-transport proof row (`:797`).
  - Foreign IDs still fail closed: the `requestId: 'other'` case at test `:147` is still there.
  - The new test (`distribution-defaults-panel.test.js`, "uppercase request URL…") passes an uppercase alphabetic GUID prop and returns lowercase rows. It covers both the accepted path and the 409 + proof path.
  - The test discriminates. With strict `===`, the accepted case becomes uncertain and the proof never finds its row, so `Subject` stays disabled and the `waitFor` fails.
- **L1 — fixed.**
  - The parent `test.each` covers draftDirty, recoveryPending and mutationPending. In each case it checks that a closed composer stays mounted (same mount list) when source eligibility drops, with `sourceUnavailable` set, and that the panel unmounts after a clean release.
  - Teardown sends the all-false signal (test `:245–250`).
  - Reopening with an envelope resumes the frozen envelope rather than seeding a new compose (test `:70–75`, two identical `/send` bodies).
- **L2 — fixed.**
  - If the source changed before acceptance arrives, the panel clears the old preview, sets `sendFeedback: 'sent'` (a valid `EMAIL_SEND_OUTCOME.SENT`) and shows the notice to create a new preview.
  - It does not reload history. The parent's sent flag still comes only from server history.
- **L3 — fixed at the hook.**
  - `preferenceBusy || preferenceUncertain` now feeds the dirty signal, the wording flag and the `mutationPending` retention flag.
  - Gap: the panel→hook wiring isn't tested (T1 below).
- **L4 — fixed.**
  - The `try` around the mutation now returns `503 persistence_unconfirmed`, and the code exits before the refresh. Only the refresh's own `catch` can return `{ok:true, refreshUnavailable:true}`.
  - The PUT and DELETE throw tests assert 503 and that `getDistributionPreferences` is never called.
  - Known refusals return before any write in the service (`:49`, `:53`), so the route sends them as 400/409.
- **L5 — fixed.**
  - A confirmed write with a failed refresh now adds a Reload hint, sets `defaultsData` to null (Save and Clear disabled, Reload enabled) and leaves the latch clear.
  - Reload now uses the inline prompt. Escape and Keep editing keep the edits (tested).
  - Validation and duplicate refusals are no longer treated as uncertain. A duplicate refusal leaves only Clear enabled (tested).

## Other contract checks
- **Async success, error and finally:** every mutation and read path checks the generation and that the component is still mounted. The early return for known refusals still runs `finally`, so busy is cleared.
- **Send:** the send has no abort signal, the uncertainty latch is permanent, and the call counter goes down on both the success and the throw paths.
- **Actor scope:** unchanged. The panel is keyed by request and actor, and `active()` requires it to be mounted.
- **Future-only writes:** Save, Clear and Reload never touch the form, preview or confirmation (tests `:38`, `:153`).
- **Shared and personal fallback notices:** these now compose instead of replacing each other. When the resolved subject is invalid, the panel keeps the built-in seed and the raw editor stays editable for repair.

## Non-blocking findings

**N1 (Low) — the inline discard confirm has no busy guard** (`PreSiteDistributionPanel.js:551–556`). `closeComposer` (`:544`) returns early when busy, but `discardAndClose` doesn't. Save doesn't check whether the discard prompt is showing.
- **Reload path (introduced in this delta):**
  1. Make the default editor dirty and click Reload; the prompt appears.
  2. Click Save, then "Discard default edits and reload" while the PUT is still in flight.
  3. `readDefaults` captures `mutationVersion` after the generation was bumped. If its GET settles after an uncertain PUT outcome, it calls `setPreferenceUncertain(false)` (`:461`).
  4. Result: a read issued before the write settled clears the "strict reload before next write" latch, without any unmount.
- **Close path (the gap predates this delta; the swallowed reopen is new):**
  1. Make the email dirty and click Close; the prompt appears.
  2. Click Save, then "Discard edits and close". The composer hides while the mutation is in flight, which breaks the §4D rule that a busy preference blocks close.
  3. Reopen before the mutation settles. The new `|| preferenceBusy` early return (`:494`) has already consumed `seenOpen`, so the dialog opens with no reseed and no fresh defaults fetch. That breaks fresh ordinary reopen.
- **Fix:**
  - Add `if (preparing || sending || preferenceBusy) return;` at the top of `discardAndClose`, or disable both prompt buttons while busy.
  - Optionally, don't consume `seenOpen` on the busy early return.
  - Add a test: with a deferred PUT, click discard and assert the composer stays open and no GET is issued.

**N2 (Low) — navigation wording hides the email discard** (`useDistributionUnsavedChanges.js:16`). If the draft is dirty and a default mutation is also pending, the prompt only mentions the default change. It never says the unsaved email edits will be lost, which weakens the owner's discard-warning requirement. Fix: combine both messages, or include the email-edits sentence whenever the draft or editor is dirty.

**N3 (Low, UX) — the dirty-open guard closes the dialog the user just opened** (`:497`). When a new open finds retained edits, it shows the "close" prompt, so "Discard edits and close" shuts the dialog and the user has to open it again for fresh defaults. Nothing is lost silently, but the button label doesn't fit an open action.

## Test gaps (Low; each would let a regression through)
- **T1:** No panel-level test checks that the hook receives the pending-mutation flag, or that an uncertain mutation reports `mutationPending: true`. Dropping the third argument still passes.
- **T2:** No test checks the refresh-unavailable Reload hint text. The regex at test `:167` matches with or without the hint.
- **T3:** The early return for an invalid resolved subject (`:473`) is untested: nothing checks that the editor is populated, Save is enabled and the form keeps the built-in seed.
- **T4:** Composed notices (duplicates + shared fallback) are untested.

**Missing gates (not run by me):** production build, the Playwright browser spec, ESLint, type check. The render-time ref ESLint warnings existed before this delta.

## Accepted memory-only recovery limits (not defects)
- After a refusal where the Dynamics activity was created but send intent wasn't recorded, the envelope stays until page reload.
- After a reload, the cross-page duplicate-send gap is unchanged, and the envelope isn't rehydrated.
- `beforeunload` may be suppressed by the browser, and a crash loses local state; nothing is stored persistently.
- After navigating away from an unconfirmed default change, the user must reload defaults before writing again.

## Tests I ran
`npx jest` on 9 suites: distribution-defaults-panel, distribution-email-preferences-route, distribution-personalization, distribution-sender-panel, distribution-unsaved-changes, pre-site-distribution-panel-t5-matrix, pre-site-distribution-panel, staff-deliberations-tab and user-preferences-reserved-keys. **292/292 passed.** I didn't run a build, browser test, Playwright, lint or any gate, so I make no browser or build claim.
