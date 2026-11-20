# Session 688 Prompt: App-suite retirement; shared capabilities preserved

## Session 687 Summary — 2026-11-19 (Codex app-suite stream)

[VERIFIED via GitHub CI, Vercel deployment, signed-in Chrome and bounded release probes;
2026-11-19 Pacific / 2026-11-20 UTC]

### What Was Completed

1. **Ten standalone interfaces retired.** Retirement notices replace the pages;
   thirteen old API routes retain their method/access gates and return HTTP 410
   after authorization. PR #651, merge `ce4bc2618`.
2. **Capabilities and data preserved.** Original pages/routes/tests are archived;
   prompt modules, stored prompt versions, services, helpers and historical data
   remain. Grant Reporting assessment/editing logic is reusable; its old Word
   export is historical reference, not a future requirement.
3. **Surviving consumers protected.** Expense Reporter remains active; Workbench
   classification and scholarly-discovery dependencies remain. This change did
   not modify Expertise Finder runtime; that separate retirement is already
   recorded in the roster stream.
4. **Release evidence.** Final CI passed 1,567 suites / 28,277 tests (27 suites / 335 tests skipped); PostgreSQL integration passed 15 suites / 189 tests; all checks green. Production deployment
   `dpl_2KcHR8Gd5vEUE9hxFBmd92mtNDBx` at `ce4bc2618`: READY, aliased to `applications.wmkeck.org`.
   Signed-in Chrome verified Home (eight active apps), all ten notices, Expense Reporter upload controls, and loaded Workbench D26 request data. No receipt upload or model call ran; authenticated API 410 behavior is automated-test-proved only.

Anonymous GET and POST requests to all thirteen retired APIs each returned 307
sign-in redirects from the proxy; these are not live handler 401/405/410 results.
The deployment-specific ten-minute error-log query returned zero error entries,
which is a bounded observation, not proof of every consumer path. Last known-good
rollback deployment: `442f9018f` / `dpl_8eJC42giXbHvEbhJsLPGVMUckepj`.
PR #651 merged at 2026-11-20 03:24:12 UTC (November 19 Pacific).

### Commits

- `1bcbab278` — app-suite retirement with preserved capability code and data.
- `274bfb72f` — preserve prompt-retirement protection and regression coverage.
- `ce4bc2618` — PR #651 merge.

Exact prior Session 686 summary, roster receipts, and concurrent-stream boundaries
remain retrievable with `git show 442f9018f:SESSION_PROMPT.md` (retrievability verified at close).
Older handoffs remain at the Git references preserved below. These are history,
not fresh permissions or executable cleanup lists.

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
| App-suite cleanup | `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md`; PR #651 | DONE in Production; signed-in page/read checks passed; prompts/services/data preserved; future adaptation separate |

App-suite feature branch: `codex/app-suite-cleanup-2026-11-19`.
Receipt branch: `codex/app-suite-retirement-receipt-2026-11-19`; documentation
destination: `main` after the documentation checks.
Other worktrees are not authorized for disposal by this closeout. Earlier cleanup
recommendations require a fresh preservation preflight.

Production authorization for this app-suite change covers the approved source
release and verification, not prompt/data deletion or backend automation. Roster
permissions remain scoped to that separate authorized workstream. Never read root
`.env.local`; private roster sources/mappings/receipts remain in owner-managed
storage. Local containers use Colima. Recheck migration-number ownership before
new schema work.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md` | Ten-app/thirteen-route manifest, preservation, tests and release evidence |
| `docs/plans/EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md` | Separate roster migration acceptance and permission limits |
| `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md` | Separate Expertise Finder retirement and cleanup |
| `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md` | Backend roster table/field contract |
| `docs/plans/EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md` | Roster recovery and identity/FK reconciliation |
| `docs/atlas/dataverse-wmkf-expertiseprofile.md` | Roster source of truth and preserved consumers |

## Testing and Session Close

Release checks and limitations belong in the retirement manifest; avoid running
archived interface tests as if they still described active behavior. Future
capability adaptation requires fresh caller, authorization and persistence review.

Milestone determination: **required and recorded**;
added “Ten standalone apps retired; shared capabilities preserved” to DEVELOPMENT_LOG.md. No duplicate roster milestone is needed. CLAUDE.md's
canonical pointers remain applicable. No memory-router edits or new debt in this
app-suite closeout.
