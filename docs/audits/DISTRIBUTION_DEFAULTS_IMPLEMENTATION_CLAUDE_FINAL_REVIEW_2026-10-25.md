---
title: Final Claude check of distribution-defaults implementation
domain: workbench
kind: audit
status: active
summary: "Ordinary OAuth final check of 1215cfd7d: PASS for D1, no introduced safety regression. Earlier full reviews and their findings are preserved separately. Not release authorization."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
  - docs/audits/DISTRIBUTION_DEFAULTS_BUILD_2026-10-25.md
  - docs/audits/DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_DELTA_REVIEW_2026-10-25.md
---

# Final independent implementation check — 2026-10-25

[VERIFIED via host Claude CLI using ordinary Claude.ai OAuth/subscription.]
Exact clean runtime target `1215cfd7d4151f5df628e0795b16c178b8a6af37`.
The two broad reviews and intermediate lifecycle review are preserved in their
separate receipts. This final bounded recheck closes D1, the last required
finding. Root separately verified 12 suites / 426 tests, Production-mode build,
four fixture-backed real-router browser cases, types and relevant gates.
The final non-blocking nit was addressed afterward with one test assertion that
the prompt disappears; no runtime code changed after this reviewed fingerprint.
No live operations, other checkout/database work, metered product or release.

## Verbatim final check

**PASS for D1.** The delta `7ec440049..1215cfd7d` introduces no safety regression. I reviewed HEAD `1215cfd7d4151f5df628e0795b16c178b8a6af37` with a clean tree and edited nothing. I ran no live operations and delegated nothing; I only used ordinary OAuth.

**The guard (`PreSiteDistributionPanel.js:501`)**
- When a recovery envelope exists, `if (recoveryRef.current) { setDiscarding(false); return; }` returns before any reset. The only thing it changes is `discarding`. Form, preview, the confirmation checkbox, error, notice, send feedback, editor, the baseline and `recoveryRef`/`recovery` are all left as they were, and it skips `readDefaults`. So it cannot clear or hide an envelope.
- `startFreshCompose` has exactly two callers:
  - The open-version effect (`:520`) was already fenced by `:518`, so nothing changes there.
  - The reopen branch of `discardAndClose` (`:568`) is the D1 path, and the guard closes it.
  - The guard adds no new blocking anywhere else.
- Ordinary fresh init still works. When `recoveryRef` is null, the guard is skipped and the function body is unchanged.
  - After an accepted Send, `:798` sets `recoveryRef` to null before `sending` ends. The queued open then reruns the effect and fresh init happens. The accepted case of the new `test.each([true, false])` checks this with a second defaults GET.
  - After an uncertain Send, the envelope stays and there is no defaults GET. The uncertain case checks this: the preview heading and the disabled Subject field remain.

**The D1 test discriminates.** After the rejected Send, `sending` is false, so "Discard edits and start fresh" is enabled. The click reaches `:568`, so the test is not a disabled-button no-op. Without the new line, `:508` would clear the preview and `:507` would reset the form, so the preview-heading and Message assertions would fail. The test also asserts there is no extra defaults GET. It checks that both `/send` calls posted the same `{requestId, operationId: 'op1', previewHash: 'hash1'}` and that the retry was accepted. Root reports that this test failed against 7ec440049 and passes with the guard; I did not re-run it against the old commit here.

**The coverage gaps I named last time map one-to-one onto the new tests:**
- busy reopen discard → `'reopen'` added to the busy-Save `test.each`
- open queued during a pending default save → new test
- open queued during Send → accepted/uncertain pair

**Tests I ran at 1215cfd7d**
- `npx jest tests/unit/distribution-defaults-panel.test.js`: 54/54 passed.
- The same file with `-t` filtered to the new and changed tests: 7 passed, 47 skipped. That is 3 busy-Save modes, the D1 test, the pending-mutation test and the 2 Send cases.
- 9 related suites: 272/272 passed. They were `distribution-defaults-panel`, `distribution-email-preferences-route`, `distribution-personalization`, `distribution-sender-panel`, `distribution-unsaved-changes`, `pre-site-distribution-panel-t5-matrix`, `pre-site-distribution-panel`, `pre-site-distribution-service` and `workbench-pre-site-visit-distribution-send-route`.
- I did not run types, lint, the build or the browser check. The 12-suite/426-test result is root's figure, not mine.

**Nit (doesn't block):** the D1 test never checks that the prompt actually goes away, which is the guard's one visible effect.

**Accepted memory-only recovery limitations (unchanged, not defects):**
- An open signal that arrives while an envelope is active is consumed at `:517` before the `:518` check. Fresh init then doesn't happen until a later open signal after the envelope resolves.
- If a refusal arrives after the Dynamics activity was created but before send intent was recorded, the envelope stays until the page is reloaded.
- After a reload, the envelope is not restored and the cross-page duplicate-send gap remains.
- The browser may suppress `beforeunload`, and a crash loses local state.
- If the user leaves with a default change unconfirmed, they must reload defaults before saving again.

The audit receipt's new section accurately describes this as root-run and still requires this recheck. This check does not authorize a release.
