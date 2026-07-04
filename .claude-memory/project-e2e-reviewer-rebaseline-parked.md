---
name: project-e2e-reviewer-rebaseline-parked
description: "Parked — Playwright E2E is red (8/23) in reviewer invite/accept; re-baseline after Codex's accept-flow rewrite lands"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6fc5f954-97c9-44ce-9593-d2aa5dce023e
---

Playwright E2E (`.github/workflows/e2e.yml`) has been red for 2+ days: **8 of 23 tests fail**, all in the reviewer invite/accept flow. Unrelated to the repo going private or the CodeQL/Semgrep CI change (see [[project-private-repo-ci-visibility]]).

**Fixed 2026-07-04:** one safe test-selector bug — `tests/e2e/program-director-invite.spec.js:351` `getByText('Invite reviewers (1)')` matched two case-variant `<p>` titles (modal `InviteEmailModal.js:304` lowercase + Workbench tab `ReviewerInvitePanel.js:249` capital R); added `{ exact: true }`.

**Parked (7 remaining):** 5 in `tests/e2e/reviewer-accept.spec.js`, 1 in `tests/e2e/reviewer-captured-invite.spec.js`, 1 in `program-director-invite.spec.js:384` (no-email checkbox). **6 of 8 are the reviewer-accept surface Codex was rewriting** (`pages/api/external/review/[token]/respond.js` + new `lib/services/reviewer-acceptance-*`), so re-baseline only AFTER Codex's acceptance work lands on main.

**Full handoff with per-test symptoms, hypotheses, and local-run steps:** `../docs/E2E_REVIEWER_REBASELINE_HANDOFF.md`. Relates to [[feedback-first-time-correctness-over-rework]] (why the accept tests were parked, not fixed mid-churn).
