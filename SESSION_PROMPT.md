# Session 641 Prompt: Duncan calendar walkthrough and J27 readiness

## Session 640 Summary

[VERIFIED via release receipts and committed follow-up.] Email-interface
consistency is released and Production-smoke verified. Existing pre-discussion
invitation updates were investigated read-only; the owner wants to walk through
Duncan's scheduling process before deciding the design. No calendar changes made.

### What Was Completed

1. **Email consistency release:** PR #523 / `5de197918` reached Production READY
   (`dpl_2bfVxUMoqRQKdXpA9nmUHx19dKtD`). Signed-in Profile/defaults, agenda,
   materials and scheduled-addressing checks passed. Hosted tests: Jest 25,227,
   PostgreSQL 130, Playwright 51. Native 200% zoom and narrow-window checks closed.
   Evidence: `docs/audits/EMAIL_INTERFACE_CONSISTENCY_BUILD_2026-10-24.md`.
2. **Calendar feasibility and Duncan follow-up:** Microsoft supports updating an
   existing event body with appropriate access. The inspected accepted attendee
   copy showed Shared Calendar / Research Staff and existing Zoom information,
   notes and a manual proposal list. Actual organizer account/type, edit rights
   and recurrence remain unverified. Meeting Tracker has no event binding;
   existing agenda transport is Dynamics email. Questions about linkage, first
   manual-list conversion, audience, notifications and recovery are logged in
   `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.
3. **Milestone record:** DEVELOPMENT_LOG.md records the released personal deadline
   and agenda defaults plus desktop email consistency. CLAUDE.md needed no change.

### Commits and destinations

- `5de197918` — email consistency runtime release (#523, main).
- `67f1fce4a` — Production release and smoke documentation (main).
- `ca07940f2` — Duncan follow-up on retained, pushed
  `codex/email-consistency-release-record`; documentation-only copy `a56fe8d4f`
  on `codex/session-640-handoff`, prepared from origin/main for landing on main.
- Final handoff/milestone commit follows this summary. Only documentation is
  being promoted; the original checkout and local main are preserved.

Prior detailed handoff, including Session 639 J27 context and slice 6 evidence:
`git show ca07940f2:SESSION_PROMPT.md` (retrievability checked at session close).

## Next Items

### Owner Decision Needed

- **Duncan walkthrough — awaiting discussion, no implementation authorized.**
  Use the findings and five question groups in the personal-email TODO. No date
  set. A marked app-managed Agenda section is a proposal, not an adopted design.
  Confirm organizer access and synthetic-event behavior before any real update.
- **J27 meeting answers — awaiting colleagues.** The alignment log still records
  B1/C1–C5/R2 for Connor and A1–A5/R1/X1/F1–F3 for the meeting expected Oct 28.
  D1 cycle-date authority is distinct from Outlook invitation ownership.
  Evidence: `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`, read at session close.

### Verify Before Acting

- J27 automatic AI pass and November central reviewer settings remain planning
  work in the alignment log (R-3, D4). Check new answers and source/Atlas before
  resuming; earlier readiness code checks date to Oct 24, not this session.
- J27 filing switch T3 remains unassigned in that log; timeline correction T5
  awaits a reply. Neither is an instruction to change Production now.
- Local main contains two old unpushed slice 2 planning commits (`e9f981e32`,
  `c597aad55`); do not reset or silently promote them. The original checkout
  remains on `codex/email-consistency-release-record`.
- Preserve owner/Codex untracked `.impeccable/critique/2026-10-19T02-04-42Z__shared-components-board-writeups-boardwriteups-js.md`
  and `output/`. Retained synthetic fixtures are not cleanup instructions.

### Parked / Do Not Reopen Without New Decision

- Calendar implementation is on hold pending the Duncan walkthrough. No calendar
  edits, permission changes, new live sends or business-record writes authorized.
- Email consistency and personal defaults slices 2, 3 and 6 are shipped (#523,
  #521, #517, #522); retain family-specific authorization and desktop density.
- J27 D1–D6 remain owner decisions; see the alignment log. Grant Reporting sunset,
  reviewer panel coverage and Research Institution confirmation campaign remain
  parked per the prior handoff; reverify before reopening.

## Concurrent Workstreams / Key Files

| Workstream | Resume boundary / source |
|---|---|
| Calendar agenda update | Owner + Duncan walkthrough first; `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md` |
| Email consistency | Released; `docs/audits/EMAIL_INTERFACE_CONSISTENCY_BUILD_2026-10-24.md` |
| Personal defaults | Remaining families tracked in the personal-email TODO; slices 2/6 receipts linked there |
| J27 / overlapping cycles | Await meeting answers; `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`, `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`, `docs/J27_TRANSITION_REGISTER.md` |
| Institution at Award | Prior boundary in `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`; not reverified this session |

## Verification and Closeout

Follow-up documentation passed doc-currency, fact-consistency, doc-symbol-refs,
their sequential self-tests, docs-catalog and diff whitespace checks. Run those
again for the final handoff. The claim-evidence pilot report was unavailable
because local state could not be read; no observation row was invented.
No memory-router advisory received. No memory/instruction/skill changes.
Milestone determination: entry required and added for the Production email releases.
