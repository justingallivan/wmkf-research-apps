---
title: "E2E Reviewer Suite Re-baseline — Completed"
domain: testing
kind: history
status: historical
summary: "RESOLVED 2026-07-04: reviewer E2E re-baselined to the landed accept flow — 23/23 green. Cause: S308 board-identity + no-email/low-confidence UX drift."
canonical: false
cataloged: 2026-07-04
owner: product-engineering
related:
  - tests/e2e/program-director-invite.spec.js
  - tests/e2e/reviewer-accept.spec.js
  - tests/e2e/reviewer-captured-invite.spec.js
  - tests/e2e/helpers/reviewer-portal.js
  - shared/components/external/Stage2aView.js
  - shared/components/reviewers/InviteEmailModal.js
  - shared/components/reviewers/ReviewerInvitePanel.js
---

# E2E Reviewer Suite Re-baseline — Completed

**Status:** ✅ RESOLVED 2026-07-04. `npm run test:e2e` is green (23/23)
[VERIFIED via local run against `next build --webpack && next start -p 3100`].
Kept as the record of the drift and the fixes.

## Background

The Playwright E2E job (`.github/workflows/e2e.yml`) had failed on every run for
2+ days — 8 of 23 tests, all in the reviewer invite/accept flow. It was accumulated
UI drift vs. the "rehearsal" specs, **not** caused by the repo going private or the
CodeQL/Semgrep CI change. Because 6 of the 8 sat in the accept flow Codex was
rewriting, the fixes were parked until that work landed (commit `a3103b3c`), then
completed in the same session.

## Root causes and fixes

All fixes were **test-side re-baselines** to match current app behavior; no app
code changed.

1. **Strict-mode selector (1 test)** — `program-director-invite.spec.js`
   `getByText('Invite reviewers (1)')` matched two case-variant titles (modal
   `InviteEmailModal.js:304` lowercase + panel header `ReviewerInvitePanel.js:249`
   capital R). Fixed with `{ exact: true }` (commit `d0f02b58`).

2. **S308 board identity gate (5 accept tests + 1 captured-invite)** —
   `reviewer-accept.spec.js` + `reviewer-captured-invite.spec.js`.
   `Stage2aView.handleAccept` [VERIFIED via `shared/components/external/Stage2aView.js:206`]
   now blocks the `/respond` POST until academic rank / primary department / main
   institution are filled. The fixtures leave these blank (rank starts blank in
   prod), so the POST never fired → `respondCalls` empty. Added a
   `completeBoardIdentity(page)` helper (fills the three `getByLabel` fields) called
   before each Accept.

3. **No-email row now blocked, not skipped (1 test)** —
   `program-director-invite.spec.js` "batch preview ... no-email rows".
   `ReviewerInvitePanel.js:292` now **disables** the Select checkbox for a no-email
   candidate (shows "no email — can't invite") instead of accepting the row and
   marking it "Skipped" in the batch preview. Re-baselined to assert the disabled
   checkbox + inline note; select only the invitable low-confidence candidate.
   Also: the low-confidence address must now be acknowledged via an in-modal
   confirm checkbox [VERIFIED via `InviteEmailModal.js:471` gate] before "Confirm &
   send" enables, and the final confirm dialog is the generic
   "Send 1 invitation now via Dynamics?" (the per-address verification warning moved
   to the checkbox). Updated the test to check the confirm box and match the new
   dialog.

## Notes for the future

- The specs mock `/context` and `/respond` at the browser
  (`tests/e2e/helpers/reviewer-portal.js`), so they exercise the client UX, not the
  server `respond.js`. When the accept **client** UI adds a required field or gate,
  these specs must be updated in lockstep — that is exactly the drift fixed here.
- E2E is still not an effective merge gate today (see `docs/CI_GATES_REFERENCE.md`);
  decide separately whether to make it required now that it is green.
