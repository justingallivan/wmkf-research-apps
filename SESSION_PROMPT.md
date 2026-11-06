# Session 668 Prompt: Resume J27 Phase I after First Cut

## Session 667 Summary — Codex, 2026-11-05 Pacific

- **DONE [VERIFIED via PR #634, CI and sandbox browser rehearsal].** First Cut
  shipped in `71d4b6cf`. Justin owns the app. On the J27 Workbench Proposal
  tab, the request's lead PD or a superuser can save Yes → Scored
  (`100000004`) or No → Not Scored (`100000005`) when Phase I Status is blank,
  Pending Committee Review, Scored or Not Scored. Other statuses are read-only.
- **DONE [VERIFIED via PR #635, integrated tests and Production deployment].**
  The UI exploration chat removed the standalone Status tab in `dc3eb523`.
  Request status remains on Overview and First Cut stays on Proposal. The
  combined branch passed 58 focused tests. GitHub Production deployment
  `7592275420` for `dc3eb523` succeeded. No Production write smoke was run.
- **Sandbox proof.** Synthetic request 1000368 was created directly through the
  sandbox Dataverse API, outside the Test Request Factory. It is titled
  `TEST: J27 First Cut browser rehearsal 91d4c65f` and has no Factory marker or
  ledger run. Local Workbench saved Yes, rejected a stale No from a second tab,
  then saved No from the refreshed tab. Not Scored persisted after reload.
  The fixture remains in the sandbox. Preserve it unless the owner directs
  otherwise. Local app server was stopped after the rehearsal.
- **Review and CI.** Claude Opus identified the normalized `_etag` mismatch.
  `f2fa1b154` fixed both services and added adapter-shaped regression coverage.
  `5eb3e686b` corrected a stale resolver test projection after the first CI
  run. Full Jest passed before merge. The claim-evidence report could not read
  local state, so no pilot observation was added.

## Next Items

### Verified Open

1. **Semi-finalist.** The app behavior is planned. Yes writes Recommended Invite
   (`707510005`) and No writes Recommended Do Not Invite (`707510006`), both
   verified in Production choice metadata. These replace First Cut in the same
   `wmkf_phaseistatus` field. The existing First Cut guard locks both
   recommendations. Before implementing the Semi-finalist save, verify J27
   draft-email triggers and repeat-edit behavior. Historical workflow evidence
   lives in `lib/services/test-requests/status-transitions.js`.
2. **Intake display and staff field contract.** Connor owns intake AI Summary,
   Fit Flag (Fit, Not a fit, Unclear), Fit Rationale, and draft staff rationale.
   Justin owns the app. Agree on the fields and draft-to-edit handoff before
   staff saves. Initial Assessment defaults to Not yet assessed, with
   Recommend advancement and Recommend triage as staff choices. Disposition
   reason is editable free text and can be supplied later. Staff need to see
   which requests lack the disposition or reason and which have both.

### Owner Decision Needed

- Decide whether staff need to retain the original First Cut answer after a
  Semi-finalist recommendation replaces the status. Grants Manager owns final
  Invited and Not Invited outcomes.
- Confirm whether the AI fit flag affects Flagged for concerns, the remaining
  intake output formats and owners, staff queues, Chairs materials, and calendar
  changes. The November 15 target was for earlier scope and needs reconfirmation.

### Parked

- Phase II, bulk edits, queues and packet exports. See the cycle plan for the
  parked requirements and prior decisions.

### Verify Before Acting

- Historical retirement and cleanup items require live caller checks. Prior
  Production-read permissions remain scoped to their named lookups.
- Session 666 and the workbook reference are preserved at
  `git show e869e6c2c:SESSION_PROMPT.md`. For earlier packet and editing
  decisions see `git show 2f9e47cbd:SESSION_PROMPT.md`.

### Key Files

| File | Purpose |
|---|---|
| `docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md` | Phase I build order and remaining decisions |
| `shared/components/workbench/FirstCutCard.js` | Proposal-tab control |
| `lib/services/workbench/resolve-request-service.js` | J27 status and row version for the Proposal tab |
| `pages/api/workbench/first-cut.js` and `lib/services/workbench/first-cut-service.js` | Guarded, conditional First Cut save |

## Concurrent Streams and Preservation

These are dated inherited resume boundaries, not fresh deployment audits or
permissions. Preserve fixtures, artifacts and other worktrees.

| Owner / stream | Resume boundary and authority |
|---|---|
| Codex / J27 Factory | `docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md` and `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`; completed bounded rehearsal and owner-deferred broader workflow. Full historical evidence/ledger identities remain in the prior handoff and owning receipts. |
| Claude / Preview CSRF | PR #620 and closeout #621 merged; `docs/plans/PREVIEW_ALIAS_CSRF_ORIGIN_PLAN_2026-11-03.md`. No new test writes authorized. |
| Claude / per-reminder history | PR #625 runtime and #628 closeout merged; `docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md` and `docs/atlas/postgres-reviewer-reminder-events.md`. Staged proof owner-deferred; do not reuse or mutate preserved fixtures. |
| Claude / shared prompts | `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`; `phase-i.checkin` deprecation is resolved by owner decision 2026-11-04. Smoke/name-length uncertainty and parked catalog/group work need fresh verification before becoming tasks. |
| Codex / Integrity | Session 658 at `git show 9db614417:SESSION_PROMPT.md`; first Dec 1 monthly refresh is future at this stop. Preserve `.integrity-backups/2026-11-02-pre-refresh/`; no restore authorized. |
| Claude / reviewer outcomes and invitations | `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md` and `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; not re-audited here. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md`; preserve acceptance limits and local colleague brief. |
| Other worktrees/local artifacts | Prior handoff has dated locations; preserve unknown WIP and private rehearsal evidence. No worktree/artifact disposal authorized. |
