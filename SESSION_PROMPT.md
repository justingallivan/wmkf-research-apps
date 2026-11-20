# Session 687 Prompt: Roster migration and retirement complete; backend work separate

## Session 686 Summary — 2026-11-19 (Codex roster stream)

[VERIFIED via production SQL/Dataverse, signed-in browser, GitHub and Vercel]

### What Was Completed

1. **Production roster migration and Admin editor.** Dataverse owns roster content;
   migrations 103/104 are applied. Imported 39 profiles from 40 source identities,
   preserving all 10 Contact links. Admin owns editing. Amy remains active and
   lead-PD eligible with her profile/future email preserved; no app access or sends.
2. **Standalone Expertise Finder retired.** PR #650 merged as `6ae809f98`.
   The old URL shows a notice linking to Admin; all six old APIs return 404.
   Shared roster, feedback and recipient consumers remain live.
3. **Authorized cleanup completed.** Deleted 344 obsolete matching-history rows and
   exactly one synthetic feedback entry. All seven original feedback entries remain.
   The acceptance profile stays inactive; identities/bindings and frozen Postgres
   roster remain. No schema drop or backend automation change.
4. **CI closed green.** At `09041225a`, Tests, CodeQL, Secret Scanning, Dependency
   Scan, Security Scan and Vercel passed. Full unit/Postgres integration and E2E
   passed on runtime merge `6ae809f98`; final docs-only commit did not rerun E2E.
   Latest CodeQL run `44660911502` completed successfully.
5. **Connor handoff saved.** Table/fields, active and lead-PD filters, Contact/email
   behavior and Amy's special case are documented. Actual flow-connection acceptance
   and backend implementation remain separate work.

### Commits

- `40588fca3` — roster/Admin implementation (subsequent production corrections in execution report).
- `665b652f0` — production Dataverse cutover.
- `1c746f1a3` — concise Connor handoff.
- `5d61c9041` — Admin roster view test coverage.
- `34da3ae89`, `d4da3c500` — standalone retirement and historical-pointer correction.
- `6ae809f98` — PR #650 merge.
- `09041225a` — production retirement/cleanup documentation.

Exact prior Session 684/685 handoffs and concurrent-stream detail remain retrievable
with `git show 09041225a:SESSION_PROMPT.md` (verified at close). Older Session 683
handoff: `git show 108cba441:SESSION_PROMPT.md`. These are historical records, not
fresh permissions or executable cleanup lists.

## Next Items

### Verified Open — External Follow-up

1. **Connor checks his actual production flow connection.** The table and Reader
   role exist; his broader pre-existing permissions were preserved. Do not describe
   effective permissions as read-only or remove unrelated roles.
   Evidence: `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md` and production
   execution report. No further migration/editor/retirement work remains.

### Owner Decision Needed / Blocked

1. **Proposal-list live PDF and two-level sections:** latest owning-plan/handoff
   boundary is blocked on Connor supplying a suitable J27 test request. Recheck
   that boundary before acting; do not test with a real Board recipient.
2. **Proposal-list email sending and sender scope:** owner deferred deciding all
   PDs versus CSO-only. If CSO-only is chosen, page and navigation guards must agree.
3. Confirm staff-version contents on a real J27 proposal after December 7.

### Parked

- **Backend expertise matching:** separate implementation in Connor's existing flow;
  no replacement flow or second matching call authorized by this closeout.
- Board-expert highlight prefill, staff missing-PDF overview, and staff notes on
  proposal lists remain parked per the prior handoff; recheck owner priority first.
- Earlier roster branches are reference material, not a pending migration.
- Backend prompt adoption/scheduling on the parked Executor lineage remains parked.

### Owner Decisions Preserved — Not Resolved This Session

- Recommendation to Chairs Production stages and paid automatic Integrity Screen:
  each needs its own owner go; do not enable `AUTOMATIC_INTEGRITY_SCREENING`.
- Intake prompt choices in the J27 workbook field map; Connor notification about v2
  prompts and missing-PI handling not confirmed sent.
- Feb 24 Grants Manager Phase II Status versus Request Status decision (D39).
- minimatch alert #144 / dependency-upgrade decision and optional Node-version pin:
  recheck current alerts before planning.

### Verify Before Acting

- Worktrees held back from the Session 685 cleanup because Codex processes had
  files open: `WMKF_Apps-claude-2026-11-18`, `WMKF_Apps-claude-j27-read-model`,
  `WMKF_Apps-claude-production-admission`; also `/private/tmp/wmkf-coordinated-start-20261119`
  (created that day). All merged; remove after rechecking open files,
  dirty state and the runbook preservation preflight.
- **Dated: Executive Summary Sandbox trial cleanup batch 2,** due after 2026-11-23
  18:31:58 UTC, from the parked worktree `/private/tmp/wmkf-summary-generation-20261116`
  (volatile). Steps in `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`.
- Initial Assessment (Session 683, PRs #644–#646) is Production-live but an
  authenticated save rehearsal was not run (deferred by owner 2026-11-19).
- Request 1003528's status in older handoffs is stale; do not infer it or reset it.
- Owner explicitly requested discarding untracked `commit-times-exact.txt` during November 19 startup; discarded. No preservation action remains.
- Older carryover (Chairs Stage 1, trial batch-2 expiry, real-proposal prompt
  review, Dependabot/branch hygiene) is at `git show 8f5c23fc8:SESSION_PROMPT.md`.

### Do Not Reopen Without New Decision

- Proposal lists, owner decisions of 2026-11-18: one link per person; everyone can
  open every proposal; sections collapsed with no per-chair personalization;
  highlights only at the top; own institution flagged; links last until the Board
  meeting; the list is a frozen snapshot; staff version only. 2026-11-19: no roster
  chair marker; list-type picker not remembered.
- Do not merge `codex/executive-summary-generation-2026-11-16`; it is the only copy
  of the parked Executor lineage. See `docs/plans/PARKED_EXECUTOR_BRANCH_INVENTORY_2026-11-19.md`.
- Do not replace Connor's proposal-processing flow or add a second Claude matching
  call; do not migrate all Postgres data as a consequence of that discussion.
- Preserve the owner's simplified roster cutover decision if that stream resumes.
- Factory auto-prepare target remains Invited plus Phase II Pending Committee Review.

## Concurrent Workstreams and Preservation

| Stream | Owning reference | Latest recorded resume boundary |
|---|---|---|
| Roster/Admin/retirement | `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md` | DONE in production; only Connor connection check and backend work remain separate |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Live with Share Proposals navigation; PDF/sections acceptance blocked on Connor; email deferred |
| Initial Assessment | PRs #644–#646 | Last handoff: production-live, authenticated save rehearsal owner-deferred; verify before resuming |
| Chairs production stages | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Unchanged; separate owner approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`; `docs/plans/PARKED_EXECUTOR_BRANCH_INVENTORY_2026-11-19.md` | Backend adoption parked; do not merge parked lineage |
| App-suite cleanup | `codex/app-suite-cleanup-2026-11-19` | Separate worktree observed at close; no edits or disposal by this roster session |

Retirement feature branch: `codex/expertise-finder-retirement-2026-11-19` (merged).
Stop documentation destination: `main`. This checkout had no uncommitted WIP at
closeout start. Other worktrees/branches were not modified or deleted. Their old
cleanup recommendations above require a fresh preservation preflight, not automatic action.

Production permissions remain scoped to the authorized roster work; do not infer
permission for unrelated work. Never read root `.env.local`. Private roster source,
mappings and receipts remain in owner-managed storage; never commit them.
Local containers use Colima. Recheck migration-number ownership before new schema work.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md` | Migration acceptance, private evidence and permission limits |
| `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md` | Retirement deployment, cleanup and CI evidence |
| `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md` | Backend roster table/field contract |
| `docs/plans/EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md` | Recovery requires saved pre-retirement build and identity/FK reconciliation |
| `docs/atlas/dataverse-wmkf-expertiseprofile.md` | Current source of truth and preserved consumers |

## Testing and Session Close

Focused runtime checks if future roster changes require them:

```bash
npx jest --runInBand --silent --testPathPatterns='(admin-expertise-roster|expertise-roster|expertise-finder-retirement|roster-contact)'
```

Milestone determination: **required and already recorded** in DEVELOPMENT_LOG.md:
“Expertise roster migrated to Dataverse and Admin” and “Standalone Expertise Finder
retired”. No duplicate entry added at stop. CLAUDE.md requires no change; its canonical
pointers already cover the modified surfaces. No memory-router edits or new debt.
Claim-evidence pilot `--current` returned local-state unavailable; no observation
row was fabricated. This is an advisory-report limitation, not a runtime blocker.
