# Session 638 Prompt: Await owner-selected work after Meeting Tracker release

## Session 637 Summary — Meeting Tracker released and ordinary requests enabled

### What Was Completed

1. **Meeting coordination workflow shipped.** [VERIFIED via source, reviews, tests and Production Ready deployment] Durable preparation survives navigation/process restarts, preserves successful steps and edited summaries, supports selective retry and fences unknown paid outcomes. Coordinator-approved retained presentation editions keep approved bytes available during corrections; replacement and immediate withdrawal govern both external readers. Video is required for approval.
2. **Before-meeting and staff workflow completed.** Coordinator-owned applicant collection emails, reviewed research-presentation invitations, consultant selection, explicitly empty recipient groups, keyboard agenda ordering, task navigation and writeup-first Workbench. Automatic applicant reminders remain retired/unscheduled. Explicit Send and strict sender/no-fallback checks remain.
3. **Manual media recovery verified.** Original audio plus MP4 correspondence is proven in the existing cut worker, with reusable proof, content/tail verification and bounded cleanup. Ordinary Claude Opus OAuth reviews were completed; verified findings were fixed. Hosted testing additionally found and fixed the bundled settings import and unsupported Blob client options.
4. **Rehearsal and migrations completed.** Isolated Neon/Blob and actual hosted Sandbox synthetic media passed. The sandbox's broken fixture creation was not repaired; the owner authorized dedicated Production test records instead. Test request 1003371 was used without applicant/payee/contact bindings or real email. Migrations 086–089 applied through the canonical runner: 4 applied, 84 skipped, 88 total; tables, columns and constraints physically verified.
5. **Controlled rollout then ordinary activation.** [VERIFIED via owner authorization, all green pre-activation checks, Production flag readback and real staff browser] Three new controls are now `on`: `MEETING_MATERIAL_PREPARATION_ACCESS`, `MEETING_MANUAL_VIDEO_PAIRING_ACCESS`, `MEETING_PRESENTATION_INVITATION_ACCESS`. Existing requests are not automatically enrolled/approved; Coordinator enrollment remains deliberate. Ordinary preparation, invitation and manual-pair availability were checked read-only while preserving an existing approved video.
6. **Validation and release state.** Runtime/test release `1c30f9b2a`: all ten checks succeeded, including CodeQL; 1,455 suites / 25,059 unit tests, 130 PostgreSQL integration tests and Playwright passed. All applicable checks also passed on documentation follow-up `d4f73e62a` before activation. Latest observed Production deployment `dpl_BMqGhtxGw7o2RtTWFoMuiRx2snUg` is Ready on `f66eee9e0`; it contains activation bookkeeping/operator documentation, with no additional runtime change. Its tests/Postgres/browser/security checks passed; its separate JavaScript CodeQL was still running at the stop checkpoint. Do not confuse that follow-up run with the completed pre-activation gate.

No real email was sent, no ordinary-request processing was started and no existing business record was edited during rehearsal/deployment checks. Actual Azure sign-in and scheduled empty-worker execution were verified in Production; a fresh genuine Zoom/ASR run and real mailbox delivery were outside the synthetic rehearsal proof.

### Key Commits

- `f96529e0d` — integrated feature and original-audio/video proof.
- `d72283c60`, `1f99d7635` — bundled Coordinator settings lookup and private upload SDK repairs.
- `064f4d9a8` — bounded cloud and dedicated Production-fixture evidence.
- `0b3c3e83a` — integrated current main, preserving concurrent Proposal Ranking/Grant Reporting work.
- `d54b8b008` — cohort-guarded first enrollment and canonical migration operator; runtime release.
- `6f418b54e`, `1c30f9b2a` — test mock/contract reconciliation; full hosted checks passed.
- `f4121312c`, `d4f73e62a` — controlled deployment and passing full-suite records.
- `f66eee9e0` — verified ordinary activation and current rollout documentation.

## Next Items

### Verified Open

- No new owner-selected implementation task. Meeting Tracker is released and enabled for ordinary eligible requests. Do not replay migrations, activation or paid rehearsals as startup work.
- If checking the bookkeeping follow-up's pending CodeQL, inspect `f66eee9e0` check-runs; do not infer it failed or reopen the already-passed release gate. This is a status lookup, not a new audit or release blocker.

### Verify Before Acting

- Retained synthetic fixture/resources are owned test assets, not a cleanup instruction: request 1003371, its own SharePoint folder, isolated `meeting_coord_rehearsal_20261023` database and `meeting-coord-rehearsal-20261023` Preview/private Blob store. Rehearsal compute was cleaned, local candidate stopped, isolated reader links revoked and final approved edition withdrawn. Sensitive local journals and credentials remain outside Git. Do not rerun one-release operators or delete other agents' resources.
- Rollback: turn off new-work controls while retaining sticky edition-aware readers, approval references and withdrawal tombstones. Never roll enrolled requests back to a pre-edition reader; code rollback does not undo files, provider calls or mail. Exact floor and migration evidence are in the release receipts.
- Main was fast-forwarded to the shipped source before this handoff. Feature worktree `codex/session-start-20261023` is preserved. Unrelated untracked `.impeccable/critique/2026-10-19T02-04-42Z__…boardwriteups-js.md` and `output/` remain untouched in the main checkout.

### Do Not Reopen Without New Decision

- Required video, Coordinator approval/sending ownership, retained approved materials during corrections, immediate withdrawal, deliberate confirmation removal and rare matching manual audio/video recovery are settled owner decisions.
- No new real sends, metered processing, sandbox repairs, broad audits or resource deletion are authorized by this handoff. Existing D26/Stage B repair and rollback work is not selected.

## Concurrent Workstreams — historical resume index

Exact prior handoff: `git show f66eee9e0:SESSION_PROMPT.md` (verified retrievable). It retains the full Session 636 D26 correction history, optional suggestions, private-folder and rollback constraints. These are recorded boundaries, not newly selected work:

- Proposal Ranking D26 invited-amount correction is DONE; no re-ranking or new write authorized. Rollback requires the correction script's unchanged-state checks and a fresh owner instruction. Owning plan: `docs/plans/PROPOSAL_RANKING_D26_INVITED_AMOUNT_CORRECTION_2026-10-23.md`.
- Personal email defaults: slice 3 shipped (PR #517); slice 2 remains plan-first. `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`.
- J27 / overlapping cycles: proposed; calendar authority and related owner decisions remain open in `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`.
- Research Institution at Award: Stages A/B applied and verified; confirm-your-details campaign tabled 2026-10-24, Connor confirmation/message retired. Preserve sensitive owner folders and conditional rollback rules. `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Grant Reporting sunset is parked; any successor investigator list should use `lib/services/proposal-participants.js` `fetchCoPIs`. Shared roles shipped in PR #516. Reviewer panel coverage remains parked; Expense Reporter unchanged; Literature Analyzer has no selected task.

## Key Files and Evidence

- `docs/audits/MEETING_ORDINARY_ACTIVATION_2026-10-24.md` — effective ordinary access and read-only proof.
- `docs/audits/MEETING_CONTROLLED_DEPLOYMENT_2026-10-24.md` — migrations, controlled checks and rollback floor.
- `docs/audits/MEETING_HOSTED_REHEARSAL_2026-10-23.md` — full synthetic workflow, safety inventory and proof limits.
- `docs/plans/MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md` and `MEETING_COORDINATION_RELEASE_CHECKLIST_2026-10-23.md` in the same directory — settled design and release sequence.
- `docs/atlas/postgres-meeting-material-preparations.md`, `postgres-meeting-presentation-editions.md`, `postgres-meeting-presentation-invitations.md` and `postgres-manual-presentation-video-pairs.md` in the same directory — live durable contracts.

Milestone determination: Production Meeting Tracker capability and ordinary activation merit a DEVELOPMENT_LOG entry (Session 637). CLAUDE.md remains the canonical compact instruction file; its existing pointers suffice. Claim-evidence report was unavailable because local observation state could not be read; no observation row was invented. No memory-router advisory was received.
