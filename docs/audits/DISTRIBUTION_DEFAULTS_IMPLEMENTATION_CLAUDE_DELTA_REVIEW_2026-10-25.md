---
title: Claude lifecycle delta review of distribution defaults
domain: workbench
kind: audit
status: active
summary: "Historical OAuth delta check of 7ec440049 found D1. The central fresh-init guard and exact-sequence regression subsequently passed the final independent check at 1215cfd7d."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
  - docs/audits/DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_REREVIEW_2026-10-25.md
---

# Independent lifecycle delta review — 2026-10-25

[VERIFIED via ordinary host Claude CLI, Claude.ai OAuth/subscription.]
Exact clean target `7ec4400495e0f76bbbf9425f3e83a8ee6b31b93b`.
Full report follows verbatim. No live operations, other checkout/database work,
delegation or metered review product.

D1 disposition: the fresh-init function itself now refuses to reset any issued
recovery envelope and only dismisses the prompt. The exact sequence (dirty
preview → retained-open prompt → Send → network uncertainty → discard/start
fresh → retry original operation/hash) is covered. Root ran that new regression
against 7ec440049: it failed; with the guard it passed. Added the remaining
coverage-only cases: busy reopen discard, open queued during preference mutation,
and open queued during accepted versus uncertain Send. No other runtime change.
The required independent recheck subsequently passed at 1215cfd7d; see
`docs/audits/DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_FINAL_REVIEW_2026-10-25.md`.
This checkpoint report remains historical and does not authorize release.

## Verbatim delta review

**NEEDS CHANGES.** I reviewed exact HEAD `7ec4400495e0f76bbbf9425f3e83a8ee6b31b93b`, which is clean, for the delta `80826ff16..7ec440049` (the panel, the unsaved-changes hook, tests and the rereview receipt). I edited nothing, ran nothing live and delegated nothing. Most of the delta holds. One new defect in the new "start fresh" discard path breaks the unchanged-envelope contract.

## Introduced defect

**D1 (Medium): "Discard edits and start fresh" ignores send recovery and removes the only Retry button.**
- **Where:** `shared/components/workbench/PreSiteDistributionPanel.js:567`, which calls `startFreshCompose` at `:501–511`.
- **Cause:** The existing close path only resets the form and preview when no send recovery is pending (`:570`). The new reopen path skips that check: `startFreshCompose` always clears the preview, the send-outcome message and the form (`:507`). The effect checks for recovery only before it shows the prompt (`:517`). Nothing stops recovery from starting while the prompt is on screen: the confirm checkbox and Send button (`:1057`, `:1065`) don't depend on the prompt.
- **Reproduction (traced from source, not run, since I couldn't add a test):**
  1. Edit the email so it's dirty, create a preview and tick the review checkbox.
  2. The parent bumps `composeOpenVersion`, and the "Discard retained edits and start a fresh email?" prompt appears.
  3. Without answering the prompt, click Send email. The outcome comes back uncertain (network failure, in-progress or malformed response), so the frozen envelope is kept and sending ends.
  4. The prompt buttons are enabled again. Click "Discard edits and start fresh".
- **Result:**
  - The preview is cleared, so the preview block (`:1045–1073`) and its Send/Retry button disappear.
  - Create preview stays blocked by the recovery check (`:609`).
  - The "Reconcile the original email…" notice (`:848`) stays on screen, but there's no way to act on it.
  - The only way out is a page reload. That loses the envelope, which is held only in memory, and lands the user in the accepted cross-page duplicate gap.
  - The uncertainty latch itself still holds (the recovery ref is never cleared), so this can't cause a duplicate send inside the page. It's the retry path that's lost.
- **Fix (one line):** in the reopen branch, do nothing but dismiss the prompt when recovery is pending (`if (recoveryRef.current) { setDiscarding(false); return; }`), or disable that button while recovery is set. Then add a test for the steps above.

## N1–N3 / T1–T4 dispositions
- **N1: fixed.**
  - `discardAndClose` now returns early while busy (`:566`), and both prompt buttons are disabled (`:854–855`).
  - The direct Reload button is disabled while a preference change is in flight (`DistributionWordingDefault.js:16`), so the Reload race is also closed when the editor is clean.
  - The open-version effect returns while busy before marking the open as seen, and the busy flags are in its dependencies (`:514`).
  - Tests at `:268` cover the close and reload prompts, and `:319` covers a fresh open queued during prepare.
- **N2: fixed.** The pending-change warning now always names lost email edits (`useDistributionUnsavedChanges.js:16`). It over-warns when the draft is clean, which errs on the safe side. Test at `:286`.
- **N3: fixed** as a feature (start fresh inside the same dialog, test at `:313`), but D1 above applies.
- **T1: fixed** by the panel-to-router test at `:280`.
- **T2: fixed.** The Reload hint now covers both `refreshUnavailable` and an unavailable own status (`:540`), tested at `:293`.
- **T3: fixed.** Test at `:299` covers the overlong resolved subject.
- **T4: fixed.** Test at `:307` covers the combined duplicate and shared-outage notices.

## Contract checks
- **Prepare:** unmount now advances the prepare and reissue counters and aborts only the prepare request (`:384–392`).
  - A late lock is fenced at `:626` (test `:254`).
  - The catch ignores aborts and stale runs, and the finally block skips its state updates after unmount (`:713–721`).
- **Send is not aborted:**
  - It passes no abort signal and uses its own `sendSequence`, which unmount doesn't touch.
  - `active()` requires the component to be mounted.
  - The finally block always resets `sendInFlight` and guards `setSending` on mounted (`:827`).
  - The send code itself is unchanged in this delta.
- **Reissue and history:**
  - Reissue uses its own abort controller and never aborts it, but its response is ignored after unmount or a newer request (`:740`), so it can't refresh history or notify the old parent (test `:259`).
  - `loadHistory` checks mounted both before and after its fetch.
- **Busy close/reload:** blocked through `closeComposer` (`:560`), the discard handler, the disabled prompt buttons and the disabled Reload button.
- **Fresh open queued after busy work:** confirmed. One side effect: a fresh open queued during a clean-draft prepare clears the preview once prepare finishes. That matches "fresh init" and isn't a defect.
- **Future-only editor/state and the permanent uncertainty latch:** the delta doesn't change them. D1 is the one exception to the envelope display.

## Coverage-only gaps (Low)
- The busy-guard test at `:268` doesn't cover the reopen prompt. It uses the same guard line.
- Waiting for busy work before a fresh open is tested only for prepare, not for a pending default change or a send.

## Tests I ran
`npx jest` on `distribution-defaults-panel`, `distribution-unsaved-changes`, `pre-site-distribution-panel`, `pre-site-distribution-panel-t5-matrix`, `staff-deliberations-tab` and `distribution-sender-panel`: **6 suites, 230/230 passed.** I didn't run a build, browser test, lint, type check or any gate. I also didn't reproduce the claim that the three new tests fail against 80826ff16.

## Accepted memory-only limits (unchanged, not defects)
- If a refusal comes back after the Dynamics activity was created but before send intent was recorded, the envelope is kept until page reload.
- After a reload, the cross-page duplicate-send gap is unchanged and the envelope isn't restored.
- The browser may suppress `beforeunload`, and a crash loses local state.
- After leaving the page with a default change unconfirmed, the user must reload defaults before saving again.

This check does not authorize a release.
