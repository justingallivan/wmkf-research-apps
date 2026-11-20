# Session 689 Prompt: Retirement closeout complete; preserved capabilities retained

## Session 688 Summary — 2026-11-19 Pacific / 2026-11-20 UTC

### What Was Completed

1. **Standalone transcription pilot retired.** Main PR #653 (`b869fdf85`) removed
   its Admin entry and replaced the page with a notice. The separate isolated
   deployment was retired from its own older source, preserving its two cron
   schedules and operational APIs. Shared transcription and Meeting Tracker remain.
   Exact deployments, rollback and bounded signed-in checks are in
   `docs/plans/evidence/TRANSCRIPTION_PILOT_RETIREMENT_2026-11-19.md`.
2. **Expired pilot recording cleanup completed.** Owner-authorized, guarded repair
   cleared a stale cleanup pointer on the isolated job after the dedicated Blob
   store was verified empty. The audit row remains; no infrastructure deletion or
   provider-erasure claim. Receipt PR #656 (`573834100`). Do not repeat cleanup.
3. **Admin preserved capabilities organized.** PR #657 (`b3717edfe`) sends old
   Final writeups Admin bookmarks to Staffing, removes redundant navigation,
   groups retained model/prompt editors under Preserved capabilities, and corrects
   the Admin Review Panel heading. Deployment `dpl_FVdr3wYzHZNCKadLrdkTuhWntGei`
   was READY on the production alias; initial error query returned zero records.
4. **Remaining presentation cleanup.** PR #660 removes the empty Concepts filter,
   groups dormant Reviewers/Email Personalization model controls, corrects remaining
   Review Panel labels, and updates the Guide. Merged as `331df9f39` after every CI check passed. Production
   `dpl_ChjL5kWehJjfZDwUwfBkT98Bsikm` was READY on `applications.wmkeck.org`;
   Admin returned the expected sign-in redirect, and a five-minute deployment-specific
   error query returned zero records (bounded observation).

[VERIFIED via source diff and focused tests] These display changes do not alter
model keys/defaults, stored overrides, prompt publication, authorization or backend
execution. Expense Reporter, Grant Reporting's preserved assessment/editing logic,
shared transcription and Meeting Tracker remain. Expertise Finder/roster work belongs
to the other stream; this closeout does not authorize changes there.

### Commits and Verification

- `09ca17298` — Admin preservation/navigation; PR #657 merge `b3717edfe`.
- `93acf5164` — four follow-up display cleanup items; PR #660.
- PR #657 focused checks: 141 tests; type check and prompt-injection gate/self-test.
- PR #660 focused checks: 62 tests; type check and API-route gate/self-test. Existing
  external-materials guard-recognition warnings were advisory, not gate failures.
- Both releases passed all exact-head GitHub checks before the authorized merges.
- Production smoke for Admin cleanup checks deployment readiness, production alias,
  anonymous sign-in redirect and bounded errors; no fresh transcription, receipt
  upload, model invocation or authenticated settings save was performed.

The complete prior Session 687 handoff is retrievable at
`git show b3717edfe:SESSION_PROMPT.md` (verified at close). Earlier retirement
milestones and constraints remain in that reference; it is historical, not new
permission to delete capabilities, data or worktrees.

## Next Items

### Verified Open

- No additional retirement implementation is queued. Reusable capabilities stay
  preserved until the owner chooses a new source/workflow and authorizes adaptation.
- Connor's actual production roster connection still needs a read check according
  to `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`; backend automation is
  separate work. Do not change effective permissions or remove unrelated roles.

### Parked / Owner Decisions Preserved

- Backend expertise matching stays in Connor's existing flow; no replacement flow
  or second matching call authorized.
- Parked Executor lineage: do not merge `codex/executive-summary-generation-2026-11-16`.
  Owning inventory: `docs/plans/PARKED_EXECUTOR_BRANCH_INVENTORY_2026-11-19.md`.
- Recommendation to Chairs Production stages and paid automatic Integrity Screen
  each require separate owner approval; do not enable `AUTOMATIC_INTEGRITY_SCREENING`.
- Intake prompt choices, Connor notification, missing-PI handling, Feb 24 D39 status
  choice and dependency/Node decisions remain earlier owner boundaries, not new tasks.

### Verify Before Acting

- Proposal-list stream advanced independently through PR #658: J27+ membership uses
  Grant program. Its owning plan now records advisor picks/scored-only membership
  live and CSO manually pasting links; do not carry the old blanket “email scope
  decision” or “advisor prefill parked” as a fresh task. Recheck live PDF/sections
  and real-J27 staff-version acceptance with its owner before any rehearsal.
- Initial Assessment authenticated save rehearsal was owner-deferred in the prior
  handoff. Recheck that decision before any write rehearsal.
- Dated Executive Summary trial batch-2 cleanup after November 23 remains a carryover
  requiring fresh expiry/owner preflight, not authorization to delete now. See
  `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`.
- Worktree disposal remains outside this closeout. Check open processes, dirtiness,
  unique commits and the runbook preservation preflight before removing anything.
- Dependency alert #144 and old request statuses require fresh probes, not inference
  from prior handoffs.

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| App-suite retirement | `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md` | PR #651 DONE; interfaces retired, backend capabilities/data retained |
| Pilot retirement | `docs/plans/evidence/TRANSCRIPTION_PILOT_RETIREMENT_2026-11-19.md` | DONE; cleanup receipt recorded, shared engine and infrastructure retained |
| Admin cleanup | PRs #657 and #660 | DONE after release verification; display-only preservation |
| Expertise roster | `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md`; Connor handoff | Other owner; connection check/backend adoption separate |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Other owner; current plan supersedes earlier parked-feature list |
| Chairs | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Separate approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Parked lineage retained; no merge |

## Key Files and Closeout

- `shared/config/adminPreservedCapabilities.js`: display placement only; never use
  it to gate execution or delete settings/prompts.
- `shared/components/admin/AdminWorkspaceNavigation.js`: bookmark compatibility.
- `shared/components/admin/ModelConfigSection.js` and `PromptTemplatesSection.js`:
  preserved editors remain mounted; saving uses existing contracts.
- `pages/index.js`, `pages/review-panel.js`, `shared/config/guideContent.js`: follow-up
  navigation and wording changes.

Documentation destination is `main`, prepared on isolated docs branch
`codex/retirement-session-close`; runtime branch is `codex/admin-retirement-followup`.
Other worktrees were not switched or disposed. No unrelated WIP was staged.
Milestone determination: pilot retirement requires and receives a DEVELOPMENT_LOG.md
entry; Admin display tidying does not require a separate milestone. CLAUDE.md and
memory router need no changes. Claim-evidence report was attempted but local state
was unavailable; no observation row was fabricated.

Never read root `.env.local`; do not delete retained data, grants, settings, prompt
versions, pilot infrastructure or shared services as a consequence of retirement.
