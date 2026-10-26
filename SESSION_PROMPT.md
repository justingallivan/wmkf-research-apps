# Session 643 Prompt: Email defaults released; await Duncan and Connor

## Session 642 Summary

[VERIFIED via merged PRs, release receipts and deployment checks, 2026-10-25–26.]
Released reviewer exclusion recovery and four personal email-default families,
after independent ordinary OAuth Claude reviews and CI. Justin ended the session
rather than selecting another small reliability task. No new implementation is queued.

### What Was Completed

1. **Reviewer exclusion recovery:** PR #527 / `3e53510ff` restored failed
   exclusions without overwriting concurrent selection/roster changes.
2. **Deliberation-distribution defaults:** PR #529 / `7f2a6e9c8`; nonempty message,
   fresh ordinary reopen, discard warnings and frozen uncertain-send recovery.
3. **Scheduled grantee reminder defaults and recovery:** PR #531 / `6a37ea105`;
   reassignment holds, current-PD checks and preserved transport correlation.
4. **Automatic reviewer thank-you defaults:** PR #533 / `a9e9b4de6`; separate
   exact-owner wording and rendered-copy/DOCX preparation before the send claim.
5. **Acceptance-confirmation defaults:** PR #534 / `8b02e8467`; personal PD wording,
   shared non-PD fallback, one combined discard guard and recoverable preclaim
   preparation. Owner policies: normalize CR/LF only in subject placeholder values,
   preserve body text; retry assigned-PD lookup failures before claiming.

### Release evidence and boundaries

- Final acceptance implementation review: Claude PASS at `0ac9ce254`;421 focused
  tests,3 isolated PostgreSQL cases and15 fixture browser cases passed. All CI
  passed before merge. Types, lint and scoped gates passed.
- Release closeout `ed6d91630`: production deployment
  `dpl_FfRgyPV3hwgQ7SewRuAMNy2fCECL` READY and active on production aliases.
  Read-only probe verified public acceptance settings/discard assets and signed-out
  protection; error scan returned zero records in its bounded window. No live
  preference write or real confirmation send was tested.
- Claude's committed corpus/database/report work was integrated unchanged.
  Its other checkout, pre-existing database, migrations and environment were not
  operated. Only an owned disposable PostgreSQL fixture was used and removed.
- Retain family-specific sender/recipient authority, strict Save/Clear readback,
  uncertain-write Reload barriers and postclaim at-most-once behavior. Acceptance
  retries are finite; no staff requeue tool is claimed. Signature lookup remains
  independent; cancellations outside the drain may leave stale preparation alerts.

### Key commits / destinations

- `b3ec15085`, `3e53510ff` — exclusion recovery and release.
- `7f2a6e9c8`, `6a37ea105`, `a9e9b4de6`, `8b02e8467` — reviewed email releases.
- `2ff4e861e` — acceptance implementation; `0ac9ce254` — review coverage corrections.
- `ed6d91630` — acceptance production verification/probe and release-status records.
- Feature branch `codex/reviewer-acceptance-defaults` is preserved; handoff prepared
  separately on `codex/session-642-final-handoff` from current origin/main for a
  docs-only landing on main, following the recorded cross-machine preference.
- Prior Session 641 handoff is retrievable with
  `git show ed6d91630:SESSION_PROMPT.md` (verified). Older context remains at
  `git show efb633f9c:SESSION_PROMPT.md`; historical checkout paths are not authority.

## Next Items

### Owner Decision Needed

- **Duncan scheduling walkthrough — blocked awaiting discussion.** No calendar
  implementation authorized. Use the checklist in
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`. Confirm organizer/edit
  access, event linkage, audience, notifications and recovery before planning an
  implementation. The app-managed Agenda section remains a proposal.
- **Connor/J27 answers — awaiting colleagues.** Current authority is
  `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`, re-read at closeout. D1–D6 are
  recorded owner decisions, not unresolved questions; remaining A/B/C/R/X/F items
  need meeting answers. T3 filing-switch ownership/date is unassigned; T5 timeline
  labels await a reply. Do not activate a filing switch, automatic reminder schedule,
  central campaign settings or intake AI pass merely from this handoff.
- **Next substantive project — owner to choose.** Justin called the proposed
  reviewer-save recovery follow-up “small ball” and chose to wrap up. Do not
  auto-resume it or substitute another minor hardening task as the next priority.

### Verify Before Acting / Parked

- Reviewer-save recovery is an unconfirmed potential issue. Source inspection and
  the follow-up note motivated investigation, but no current failure was reproduced.
  No fix or investigation was selected/authorized. Do not present it as a confirmed
  defect. Search cancellation and acceptance-alert consolidation were alternatives,
  not assignments.
- Recheck source, current receipts and new owner answers before using older queue
  entries as actionable work. Completed email releases above are DONE; no additional
  personal-default family is selected here. Do not reopen calendar/J27 decisions,
  Grant Reporting sunset, reviewer panel coverage or the Research Institution
  confirmation campaign without a new owner direction.
- Do not reset, stash, archive or clean another checkout/branch, its untracked
  output/critique files or retained synthetic data based on historical handoffs.
  No cleanup operation is authorized.

## Concurrent Workstreams / Key Files

| Workstream | Owner / resume boundary |
| --- | --- |
| Acceptance defaults | Released; `docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_RELEASE_2026-10-26.md`; implementation limits in its build receipt |
| Thank-you defaults | Released; `docs/audits/REVIEWER_THANKYOU_DEFAULTS_RELEASE_2026-10-26.md` |
| Distribution / scheduled reminders | Released; `docs/audits/DISTRIBUTION_DEFAULTS_RELEASE_2026-10-25.md`, `docs/audits/SCHEDULED_GRANTEE_DEFAULTS_RELEASE_2026-10-25.md` |
| Exclusion recovery | Released; F2 in `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md` |
| Duncan calendar workflow | Owner + Duncan walkthrough first; personal-email TODO checklist |
| J27 / overlapping cycles | Await answers; alignment log, rollover plan and `docs/J27_TRANSITION_REGISTER.md` |
| Claude corpus/database work | Claude-owned; `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md`; inspect its current committed state, never assume permission for DB operations |

## Verification and Closeout

Milestone determination: production capabilities shipped; added **Personal email
defaults and reviewer recovery released (Session 642)** to DEVELOPMENT_LOG.md.
No CLAUDE.md, memory, instruction or skill changes needed: route, service and
script details already live in their canonical catalogs/receipts, not the root
instruction file. No memory-router advisory received. Claim-evidence report was
unavailable because local state could not be read; no observation row invented.
Final documentation gates/self-tests and push are completed as part of stop.
No live emails, preference mutations or business-record writes authorized by stop.
