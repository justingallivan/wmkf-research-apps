# Session 633 Prompt: Continue owner-selected work after guidance cleanup

## Current session — guidance cleanup, 2026-10-22

[VERIFIED via local Git and file review] The owner authorized three bounded repair
batches: worktree/session/release procedures; deployment/local-environment guidance;
and review guidance/handoff compression. Historical owner decisions remain intact.
No application runtime, actual worktree, environment, installed tool or deployment
change is part of these repairs. No live data read, send or metered run is authorized.

### Local commits and verification

- `ec128cab2` — five memory evidence/recall fixes; owner review burden note unchanged.
- `88d818fd1` — worktree preservation and branch-aware session/release guidance.
- `a77db0d38` — deployment identity/waiting and historical local-environment guidance.
- Third batch: review cadence/model routing and this compression; locate its
  commit with `git log --oneline -- SESSION_PROMPT.md`.

These commits are local and have not been pushed. A main push triggers the project's
production release path; do not infer approval to push from this handoff. Relevant
gates/self-tests and independent review passed for the first two batches. Third-batch
verification is reported with its commit; no broader semantic-cleanliness claim.
No DEVELOPMENT_LOG milestone entry is required for this guidance-only work.

## Recorded workstreams — choose scope before resuming

These are the latest recorded dispositions, not fresh live-system checks or a
new actionable backlog. The owner selects the next workstream. Detailed decisions,
commands, test/deployment receipts and old checkout paths remain in the
[historical handoff snapshot](docs/archive/SESSION_HANDOFF_SNAPSHOT_2026-10-21.md).

| Workstream | Recorded disposition / resume boundary | Owning record |
|---|---|---|
| Meeting coordination | Design paused: no-video approval, revisions after approval, returning later, durable drafts and partial-failure recovery remain open. No runtime build authorized. Use latest standalone HTML; screenshots may predate controls. | [Design decisions and preview index](docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md) |
| Overlapping cycles / J27 | Proposed plan only. Calendar authority role, backup/escalation/date-change approval and Connor's external calendar contract remain owner decisions. Choose an implementation slice explicitly; do not assume full-plan authorization. | [Cycle plan](docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md), [bounded October 21 audit](docs/audits/cycle-foundations-2026-10-21.md) |
| Shared staffing roles | Program Coordinator and Systems Specialist released in PR #516; assignments were checked in the dated cycle audit. Read current assignments through their existing contract before wiring consumers; roles do not themselves grant permission. | [Role handoff](docs/archive/SESSION_HANDOFF_SNAPSHOT_2026-10-21.md), [cycle audit](docs/audits/cycle-foundations-2026-10-21.md) |
| Research Institution at Award / Stage B | Last handoff awaits Duncan's returned staff workbook and Part 5 fixes before the owner-run resolve. Preserve the shared workbook by key; do not rebuild over it. Group approvals, new-contact email policy, Connor's 2024 split confirmation and reviewed apply/verify/rollback remain prerequisites. Current workbook/live-data state is unknown. | [Backfill plan §3.2–4](docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md) |
| Reviewer panel coverage | Parked by Justin. One staff-assisted practice case would precede a six-case comparison; no case, pilot, implementation or metered run authorized. | [Parked pilot specification](docs/plans/REVIEWER_FINDER_PANEL_COVERAGE_PILOT_2026-10-21.md) |
| Refactoring / Expense Reporter | Refactoring merge `73c5fb36f` is in this checkout's ancestry; the October 21 handoff records release/CI evidence. Do not repeat the old unmerged-branch task. Further Expense Reporter work is parked at the owner's direction. | [Release and verification history](docs/archive/SESSION_HANDOFF_SNAPSHOT_2026-10-21.md) |
| Dormant-app direction / performance | Choose a currently used workflow before more performance work. Grant Reporting rework/integration and Literature Analyzer reassessment are future directions; destination, scope and capability reuse remain undecided/unverified. Expertise Finder is only an unmeasured candidate. | [Grant Reporting](.claude-memory/project-grant-reporting-rework.md), [Literature Analyzer](.claude-memory/project-literature-analyzer-rework.md) |

## Owner decisions and boundaries to preserve

- **Meetings:** approved vocabulary includes **Draft writeup**; see the
  [approved table](docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md).
  PD Workbench leads with writeup/review. Materials collection belongs to the
  Admin-assigned Program Coordinator, resolved at runtime rather than hardcoded.
  Keep speaker/presentation-end review checkboxes for now. The omitted provider/
  credit acknowledgement is a coordinated future-build requirement, not permission
  to remove live dependencies or alter the separate Admin pilot workflow.
- **Board materials:** preparation is not Board approval. Preserve presentation/
  internal-discussion separation, separate presentation draft save, versioned
  approval/revocation and recovery requirements. The holiday calendar source is
  still owed before deadline automation is implemented; exact agreed timing and
  recipients remain in the design plan and historical snapshot.
- **Cycles:** reviews close before the board meeting; post-board Awardees follow-up
  must coexist with next-cycle work. Do not reopen a hypothetical post-board late-review
  policy. GOApply remains the intake path. Connor's assumed J27 application setup
  ownership is not proof that calendar contracts or publication are settled.
- **Stage B:** owner judges strong-evidence groups; staff handles individual checks.
  Do not return those rows to the owner one by one. Replaced award-time PIs remain
  unrecorded. Do not rerun Stage A writes or the paid co-PI role check. The held
  Connor message stays unsent. Old read/write approvals are not renewed here.
- **Closed incidents:** the Admin startup/CSP fix was released and accepted in the
  prior handoff; see [incident record](docs/plans/ADMIN_CSP_STARTUP_FIX_2026-10-21.md).
  Reinvestigate only for new evidence. Old rollback targets are historical; code
  rollback does not undo business writes.

## Verification before any operational action

- Recheck source, intended branch/commit, ownership and live prerequisites for the
  selected task. Dated probes, snapshots and plans do not prove current state.
- Checkout paths, preview servers, retained worktrees and “safe to remove” statements
  in history are unverified-until-checked. Apply the
  [preservation preflight](docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md) before reuse or
  disposal. This session did not inspect or change those worktrees.
- No app retirement, data cleanup, schema migration, schedule change, notification,
  production read/write or paid processing is implied by these pointers.
- Main's preexisting untracked October 19 critique under `.impeccable/critique/`
  and `output/` belong to other work and remain untouched.
