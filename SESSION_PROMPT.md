# Session 639 Prompt: Await owner-selected work after Meeting Tracker UI release

## Current session update — personal email defaults slice 2

[VERIFIED via source, local tests and OAuth Opus review 2026-10-24.] Built on
`codex/reviewer-deadline-email-defaults` (`a79003426`, then reviewed fixes
`26010e1b0`). Assigned-PD-only deadline changes/restores/notifications; saved
subject/body defaults including empty bodies; exact preview; optional one-send
Cc barred on synthetic requests; truthful post-write email failure and retry.
Opus's first review found an annotation-comparison defect and smaller issues;
fixes passed fresh OAuth Opus re-review with no P1/P2 remaining. Final isolated
run: 25,175 tests / five snapshots passed, 247 skipped; production build, scoped
gates and desktop/mobile synthetic UI confirmation passed. Local proof servers
stopped. Main was not merged/pushed; runtime remains undeployed.
Owner authorized Production subject seeding and one standalone test email. The
subject was created and validated with the existing body unchanged. Empty-body
SendEmail succeeded and attachment readback matched; final status Sent (3),
senton 2026-10-25T00:08:17Z, activity cf454711-08d0-f111-a05b-000d3a361c1f.
Owner confirmed inbox receipt with blank body and calendar invitation for Monday,
October 26, 2026. Selected release prerequisites passed; runtime promotion remains a separate step. Evidence and residuals:
`docs/audits/REVIEWER_DEADLINE_EMAIL_BUILD_2026-10-24.md`. The two original
untracked items were preserved untouched.


## Session 638 Summary — approved UI and compact contacts shipped

[VERIFIED via source, OAuth Opus review, actual built Next-page screenshots, candidate checks and authenticated Production browser] PR #519 completed the approved compact cycle schedule, separate global Sessions view/agenda preview, search/status controls, responsive task workspace and visible materials counts. PR #520 then removed the People and share status disclosure: PD and PI appear directly on one compact line, while the existing Pre-Site lifecycle label appears as Share status in the request detail header.

### Completed and verified

- Initial UI release `3170781e0` passed 25,062 unit tests, 130 PostgreSQL tests and CodeQL; 16 actual built screens at 1440px/390px were compared with the saved mockups. The empty Sessions startup crash found after visual review was fixed and re-reviewed.
- Final follow-up `951c4383a` (PR #520, candidate `730c2fad1`) passed all candidate checks, including full Jest, PostgreSQL integration, CodeQL, security scans, OAuth Claude review and Vercel build. Local proof: 109 focused tests, types, production-mode build, status parity gate/self-test; lint zero errors with one existing editor hook warning. The 16-screen read-only browser rehearsal passed with no horizontal overflow or automated main-content axe violations.
- Production deployment `7302334669` is successful on `951c4383a`: `https://wmkfresearchapps-337v7k55i-justin-gallivans-projects.vercel.app`. Authenticated production readback confirmed inline PD/PI on request 1002912, zero disclosure labels, and Share status in dedicated synthetic request 1003371's detail header. No email, preparation job, upload, migration/configuration change or business-record edit was invoked.
- Ordinary Claude Opus subscription OAuth reviews passed. No direct model API or Ultrareview was used. Original and follow-up evidence: `docs/audits/MEETING_UI_COMPLETION_2026-10-24.md`.

### Commits

- `3170781e0` — approved landing and workspace design (#519).
- `a01032ebb` — verified initial UI production release record.
- `951c4383a` — inline contacts and detail share status (#520).

## Next Items

### Verified Open

- No remaining implementation item in the selected Meeting Tracker UI scope. Await the next owner-selected task. Do not replay completed migrations, activation, paid rehearsals or visual-review loops.

### Verify Before Acting

- Retained synthetic fixture/resources are owned test assets, not cleanup instructions: request 1003371, its own SharePoint folder, isolated rehearsal database and Preview/private Blob store. Preserve the release receipts' resource and rollback constraints. No new resource deletion is authorized.
- All owned local UI proof servers are stopped. Main is on the final shipped runtime source. The retained isolated checkout `/Users/gallivan/.codex/worktrees/session-start-7630/WMKF_Apps` is clean on `codex/meeting-people-line` at `730c2fad1`, merged through PR #520. Recheck ownership/state before reuse; do not treat this recorded path as current permission authority.
- Main's unrelated untracked `.impeccable/critique/2026-10-19T02-04-42Z__shared-components-board-writeups-boardwriteups-js.md` and `output/` were preserved untouched. No session-owned runtime WIP remains.

### Do Not Reopen Without New Decision

- Video required; Coordinator approval and collection-email ownership; approved materials retained during corrections with separate immediate withdrawal; no provider-confirmation step; rare matching manual audio/video fallback. These owner decisions remain settled.
- Ordinary admission was already activated. UI rollback must preserve edition-aware readers, approval references and withdrawal tombstones. No real sends, metered processing, sandbox repairs, broad audits or existing-business-record writes are authorized by this handoff.

## Concurrent Workstreams — historical resume index

Exact prior handoff: `git show f66eee9e0:SESSION_PROMPT.md` (verified retrievable). It retains the full Session 636 D26 correction history, optional suggestions, private-folder and rollback constraints. These are recorded boundaries, not newly selected work:

- Proposal Ranking D26 invited-amount correction is DONE; no re-ranking or new write authorized. Rollback requires the correction script's unchanged-state checks and a fresh owner instruction. Owning plan: `docs/plans/PROPOSAL_RANKING_D26_INVITED_AMOUNT_CORRECTION_2026-10-23.md`.
- Personal email defaults: slice 3 shipped (PR #517); slice 2 built on `codex/reviewer-deadline-email-defaults`, runtime candidate `26010e1b0`; OAuth Opus build recheck PASS, not merged/deployed. `docs/plans/PERSONAL_EMAIL_REVIEWER_DEADLINE_DEFAULTS_PLAN_2026-10-24.md`.
- J27 / overlapping cycles: proposed; calendar authority and related owner decisions remain open in `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`.
- Research Institution at Award: Stages A/B applied and verified; confirm-your-details campaign tabled 2026-10-24, Connor confirmation/message retired. Preserve sensitive owner folders and conditional rollback rules. `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Grant Reporting sunset is parked; any successor investigator list should use `lib/services/proposal-participants.js` `fetchCoPIs`. Shared roles shipped in PR #516. Reviewer panel coverage remains parked; Expense Reporter unchanged; Literature Analyzer has no selected task.

## Key Files and Evidence

- `docs/audits/MEETING_UI_COMPLETION_2026-10-24.md` — actual screenshots, review, contract and production release proof.
- `docs/audits/MEETING_ORDINARY_ACTIVATION_2026-10-24.md` and `MEETING_CONTROLLED_DEPLOYMENT_2026-10-24.md` — prior functional activation, migrations and rollback floor.
- `docs/plans/MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md` — settled implementation design.
- Exact previous handoff: `git show a01032ebb:SESSION_PROMPT.md` (verified retrievable); historical functional release and safety inventory remain there.

Milestone determination: no new DEVELOPMENT_LOG entry required for the UI composition/refinement; the underlying production capability is recorded in the Session 637 milestone. CLAUDE.md requires no change. Claim-evidence report was unavailable because local state could not be read; no observation row was invented. No memory-router advisory was received.
