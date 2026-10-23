# Session 635 Prompt: Await owner-selected work after release

## Session 634 Summary — reviewer safeguards and documentation cleanup released

### What Was Completed

1. **Released completed work.** [VERIFIED via Git push and Vercel deployment status]
   `187f27f16` merged candidate `405d17bb8` with current main `c09a4f9a7` and was
   pushed to main with explicit owner authorization. Production deployment
   `dpl_55owR5tGAZkLi1fTfwt7399JgDDK` reported Ready and the application domains
   were assigned. Other session's personal email defaults were preserved.
2. **Guidance and reviewer safeguards.** Earlier commits in the released branch
   reconcile active memories/instructions and implement owner-decided identity
   continuity, request mutation, stale invitation/PD authority, Find exclusion,
   and first-manual-invitation conflict protections. Detailed evidence remains in
   `docs/audits/release-candidate-checklist-2026-10-22.md` and linked records.
3. **Focused local walkthrough.** On `a713ded8b`, synthetic invitation capture,
   acceptance/reload, staff acceptance, materials preview/send, draft/reload,
   required answers, submission and post-reload read-only state were exercised.
   Receipt: `/private/tmp/wmkf-reviewer-rehearsal-receipts/2026-10-23T17-28-11-142Z-7b3ba4d6-fcb8-4883-9436-98158a95262e.json`.
   It records 90 mocked API calls, no blocked requests, and no human scenario pass.
   The owned browser/server/temp candidate were closed and cleaned up. The mock
   does not propagate submission into the staff roster; this is no evidence of a
   production defect and is not a release blocker.
4. **Owner-approved confirmation copy.** `405d17bb8` uses “Thank you for submitting
   your review. If you need to correct or add anything, please contact your Program
   Director.” The assigned PD's name is a mailto link on both immediate and return
   screens. Receipt date remains below. 29 focused tests and scoped lint passed.
5. **Release checks.** [VERIFIED via GitHub check-runs for `187f27f16`] Jest,
   PostgreSQL integration, CodeQL's three language jobs, Semgrep, Trivy and Gitleaks
   succeeded. Playwright was cancelled, not passed; no optional rerun was started.
   Prior Linux and exact pinned FFmpeg evidence retain their documented scope.

### Commits

- `e86e5f80d`, `4720980ed` — reviewer safety/authorization repairs.
- `81b8a063b`, `9b2ec0060` — guarded rehearsal and fixture follow-ups.
- `a713ded8b` — verified pinned FFmpeg archive / bounded Linux media evidence.
- `405d17bb8` — owner-approved confirmation and named PD email link.
- `187f27f16` — integrated release, including all preceding documentation repairs.
- This docs-only handoff follows the release on main.

## Next Items

### Do Not Reopen Without New Evidence or Owner Direction

- Release is completed. No concrete unresolved application blocker was identified.
- Owner explicitly stopped broad audits, optional testing, mock fixes and generic
  release-readiness investigations. Do not turn an unverified detail into a defect
  or another release gate. No further work is selected by this handoff.
- Private-store work stays separate; first-time external usability remains untested.
  Neither is an established blocker. Earlier bounded read/write/cost approvals are
  historical and do not authorize unrelated operations.
- Preserve the owner review-burden memory note and unrelated critique / `output/`.

### Verify Before Acting

- Original checkout remains on `codex/memory-audit-followups` at `405d17bb8` with
  the preexisting untracked critique and `output/` untouched. It predates the
  merged release. Do not push it to main or overwrite newer main with it.
- Isolated checkout `/private/tmp/wmkf-release-memory-reviewer-cleanup` is on main
  for this handoff. No other worktree was switched, reset or removed.
- Pre-release rollback reference: `dpl_ET59rCfoBxuSjBK6KScCmArPehg6`,
  `wmkfresearchapps-fhwelay0k-justin-gallivans-projects.vercel.app`. It is a dated
  reference, not a rollback instruction; code rollback does not undo business writes.

## Concurrent Workstreams — historical resume index

Exact previous handoff: `git show 187f27f16:SESSION_PROMPT.md`; earlier guidance
handoff: `git show 405d17bb8:SESSION_PROMPT.md`. Both are retrievable. These are
recorded owner boundaries, not newly verified actionable tasks:

- Personal email defaults: slice 3 shipped in PR #517; next slice 2 is plan-first.
  Owning record: `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`.
  Prior owner production-check / queue-drift suggestions are retained in the exact
  handoff above, not selected or promoted into current tasks.
- Meeting coordination: design parked, no runtime build authorization.
  `docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md`.
- J27 / overlapping cycles: proposed; calendar authority, backup/escalation,
  date-change approval and Connor's external calendar contract remain owner decisions.
  `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`.
- Shared roles: PR #516 released; read assignment through config, never hardcode.
- Stage B: awaiting staff workbook / owner decisions in the prior handoff. Preserve
  workbook keys, do not record replaced award-time PIs, rerun Stage A writes or the
  paid co-PI check, or send the held Connor message.
  `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Reviewer panel coverage pilot parked; Expense Reporter leave as is; Grant Reporting
  and Literature Analyzer directions await scope. No new work or metered run implied.

## Key Files and Evidence

- `shared/components/external/MaterialsView.js`, `ReviewAuthoringForm.js`,
  `ProgramDirectorContact.js` — confirmation copy / contact rendering.
- `docs/audits/release-candidate-checklist-2026-10-22.md` — release evidence index.
- `docs/audits/linux-ci-verification-2026-10-23.md` — historical Linux run scope.
- `docs/audits/pinned-ffmpeg-linux-evidence-2026-10-23.json` — pinned media result.

Milestone determination: production reviewer safeguard release merits a
DEVELOPMENT_LOG entry. CLAUDE.md requires no change. Claim-evidence pilot report
was unavailable because local state could not be read; no observation row invented.
