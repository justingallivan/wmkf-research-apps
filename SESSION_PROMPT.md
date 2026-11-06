# Session 668 Prompt: Resume the J27 Workbench redesign when ready

## Session 667 Summary — Codex, 2026-11-05 Pacific

- [VERIFIED via GitHub and owner observation] PR #635 merged as `dc3eb5233`. The
  separate Workbench Status tab is gone in Production. Overview retains request
  status and old Status links fall back to Overview. First Cut remains on
  Proposal after PR #634 (`71d4b6cfb`). CI passed on #635.
- [VERIFIED via owner discussion] Reviewed cycle-level queues and request-level
  navigation in D26. The similar tab names and styling obscure the difference
  between managing a cycle and working on one request. The owner chose to offer
  both **My work** and **All requests** at the cycle level and parked the wider
  redesign for a future session.
- [VERIFIED via local browser] The isolated UI checkout used sandbox request
  #1000368 to verify Overview. Production request #1002852 was used as a
  read-only D26 design reference. No redesign was implemented.

## Next Items

### Parked — J27 Workbench design

Resume when Justin reopens the design discussion. Use the J27 cycle information
plan and current owner decisions to map the staff journey from one submitted
package through intake, staff assessment, First Cut, the Chairs decision, and
peer review if invited. Treat open workflow and ownership decisions as open.
Use D26 request #1002852 and the screenshots from this chat for density and
navigation evidence. The example omits J27 steps and includes D26-specific
features from the two-submission cycle.

Sketch the cycle queues and the request workspace together. Prototype First
Cut with synthetic J27 proposals, including one that advances and one that
stops. Test finding work, opening the relevant task, seeing the evidence and
next action, and returning to the same filtered queue. Keep stopped requests
findable in All requests. Classify D26-only tools before changing their
navigation. The per-request First Cut control has shipped. The proposed
queue-to-decision experience remains design work.

### J27 Phase I coordination

The Phase I decisions, workbook pointer, ownership questions for Connor, and
parked Phase II details are preserved in `git show e869e6c2c:SESSION_PROMPT.md`.
First Cut implementation has moved since that handoff. Use the current cycle
plan and source to check the rest before turning any item into an assignment.

## Key References

- `docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md` — J27 decisions and open
  workspace questions.
- `docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md` — historical
  design inventory.
- `pages/workbench/[requestId].js` — request navigation and First Cut entry point.
- Claim-evidence report could not read local state. No observation was added.

## Concurrent Streams and Preservation

These are dated inherited resume boundaries, not fresh deployment audits or
permissions. Preserve fixtures, artifacts and other worktrees.

| Owner / stream | Resume boundary and authority |
|---|---|
| Codex / J27 Factory | `docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md` and `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`; completed bounded rehearsal and owner-deferred broader workflow. Full historical evidence/ledger identities remain in the prior handoff and owning receipts. |
| Claude / Preview CSRF | PR #620 and closeout #621 merged; `docs/plans/PREVIEW_ALIAS_CSRF_ORIGIN_PLAN_2026-11-03.md`. No new test writes authorized. |
| Claude / per-reminder history | PR #625 runtime and #628 closeout merged; `docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md` and `docs/atlas/postgres-reviewer-reminder-events.md`. Staged proof owner-deferred; do not reuse or mutate preserved fixtures. |
| Claude / shared prompts | `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`; `phase-i.checkin` deprecation is resolved by owner decision 2026-11-04. Smoke/name-length uncertainty and parked catalog/group work need fresh verification before becoming tasks. |
| Codex / Integrity | Session 658 at `git show 9db614417:SESSION_PROMPT.md`; first Dec 1 monthly refresh is future at this stop. Preserve `.integrity-backups/2026-11-02-pre-refresh/`; no restore authorized. |
| Claude / reviewer outcomes and invitations | `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md` and `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; not re-audited here. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md`; preserve acceptance limits and local colleague brief. |
| Other worktrees/local artifacts | Prior handoff has dated locations; preserve unknown WIP and private rehearsal evidence. No worktree/artifact disposal authorized. |
