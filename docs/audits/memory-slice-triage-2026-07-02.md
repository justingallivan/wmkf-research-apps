# Memory Slice Triage - 2026-07-02

Status: complete for filename-level slice memories.

## Scope

Inspected the four `.claude-memory/` files with `slice` in the filename:

- `project-slice0-role-probe.md`
- `project-slice0-scope.md`
- `project-slice0-timeline-posture.md`
- `slice0-deactivate-not-delete-recalc.md`

## Classification

| Memory | Classification | Action |
|---|---|---|
| `project-slice0-role-probe.md` | `CLOSE_HISTORICAL` | Already closed and archived; no hierarchy change. |
| `project-slice0-scope.md` | `CLOSE_HISTORICAL` | Already closed and archived; no hierarchy change. |
| `project-slice0-timeline-posture.md` | `CLOSE_HISTORICAL` | Already closed and archived as a forward posture lesson; no hierarchy change. |
| `slice0-deactivate-not-delete-recalc.md` | `CLOSE_HISTORICAL` | Demoted from active to closed. Live invariant moved to the intake wiki and schema comments. |

## Current Invariant

The current, non-historical rule is: intake budget/roster drain reconciliation deactivates obsolete child rows (`statecode`) and recomputes over active children only; it does not hard-delete removed lines. Current pointers are `docs/agent-wiki/topics/intake-portal.md`, `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`, and `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`.

## Verification Notes

- All four filename-level slice memories were read in full.
- Direct references were grepped before demotion.
- No memory files were deleted.
