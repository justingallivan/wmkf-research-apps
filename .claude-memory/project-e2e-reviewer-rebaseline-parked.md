---
name: project-e2e-reviewer-rebaseline-parked
description: RESOLVED 2026-07-04 — reviewer E2E re-baselined to the landed accept flow, 23/23 green (S308 board-identity + no-email/low-confidence UX drift)
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: 6fc5f954-97c9-44ce-9593-d2aa5dce023e
---

RESOLVED 2026-07-04. Reviewer Playwright E2E (`.github/workflows/e2e.yml`) had been red for 2+ days (8/23), all in the reviewer invite/accept flow — accumulated UI drift, not the repo going private or the CodeQL/Semgrep CI change (see [[project-private-repo-ci-visibility]]). All fixes were **test-side re-baselines** (no app code changed); `npm run test:e2e` is now 23/23 green.

Three drift causes: (1) a case-insensitive `getByText('Invite reviewers (1)')` matched two `<p>` titles → `{ exact: true }`; (2) the **S308 board-identity gate** in `Stage2aView.handleAccept` blocks the `/respond` POST until academic rank / primary department / main institution are filled — the fixtures leave them blank, so added a `completeBoardIdentity(page)` helper before each Accept; (3) a **no-email candidate is now blocked** (disabled Select checkbox, "no email — can't invite") rather than selected-and-skipped, and low-confidence addresses need an in-modal confirm checkbox before send.

Lesson: the E2E specs mock `/context` + `/respond` at the browser, so they track the **client** accept UX — when that UI adds a required field/gate, the specs must be updated in lockstep. Full record: `../docs/E2E_REVIEWER_REBASELINE_HANDOFF.md`. Relates to [[feedback-first-time-correctness-over-rework]].
