# Session 667 Prompt: Recap J27 Phase I and agree ownership with Connor

## Session 666 Summary — Codex, 2026-11-05 Pacific

[VERIFIED via owner discussion, local workbook inspection, and startup gates.]
Planning discussion only. The group-notes workbook was read locally and
compared with the prior mockup. All 72 startup checks and self-tests passed.
The five unverifiable J27 register entries were advisory. No implementation,
schema or prompt changes, or live Dataverse reads or writes occurred.

### Phase I decisions to recap

| Item | Agreed behavior | Owner or dependency |
|---|---|---|
| AI Summary | Generated on intake by Power Automate | Connor creates prompts, flows and necessary Dataverse structures |
| AI Fit Flag | Dataverse choice: Fit, Not a fit, Unclear | Connor |
| AI Fit Rationale | Generated text explaining the choice in all three cases | Connor |
| Initial Assessment | Staff set Not yet assessed (default), Recommend advancement, or Recommend triage in the app | App workstream; confirm exact storage and ownership with Connor |
| Disposition reason | Staff use free text and may add it later. Show which requests lack a disposition, which lack a reason, and which have both | App workstream; confirm which field records disposition at each step |
| Rationale | Connor's flow drafts it. Staff edit it in the app. It includes impact and the basis for staff interest or concern | Connor for generation; app workstream for editing |
| First Cut | Staff set Yes or No in the app. Write Phase I Scored or Not scored, respectively | App workstream; verify existing choice values and transitions |
| Semi-finalist | Staff set Yes or No in the app. Write Phase I Recommended Invite or Recommended Do not invite, respectively | App workstream; verify existing choice values and transitions |

The workbook's Lists tab proposes Phase I codes Proposal submitted, Flagged
for concerns, Triaged, Under Consideration and Recommend Program Chairs (25),
and Phase II codes Invited to Peer Review and Not Invited. Treat those labels
as discussion evidence. The link between the AI fit result and Flagged for
concerns, the full lifecycle/workspace model, and any fixed counts remain open.

### Verified open — next session

1. Justin requested a recap and a concise shared summary for Connor and Justin
   that distinguishes agreed decisions from open items and assigns who creates
   what. Begin with the Phase I table above and the updated workbook. Confirm
   ownership of app work, shared field contracts, and any remaining intake
   outputs before assigning them. The summary is a review draft for the two
   owners. No request to send it was made.
2. Reconcile the accepted decisions into the cycle plan after the recap.
   Its earlier producer split and staff-state assumptions predate this
   discussion. Use the group-notes workbook as evidence, including the
   differences from the earlier workbook. Verify Dataverse field and option
   mappings before implementation. The November 15 target is carried forward
   from the prior plan, with exact scope and feasibility still open.
3. Keep open the formats and ownership for other intake content (short title,
   lay abstract, methods, key personnel and keywords), the role of the staff
   workspace queues, and the exact Chairs materials and calendar revisions.

### Parked — Phase II

After Program Chairs approve, staff move approved requests into internal
Phase II in AkoyaGO. Reviewer finding and reviews should broadly follow D26.
Connor still needs to identify the existing Dataverse mapping for staff
recommendation. One staff-written offramp justification is the working
direction for reason and note. The workbook still shows a dropdown and Chairs
approval copy that differ from D50. Review Phase II changes later.

### Evidence and continuity

- Workbook: `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Keck Foundation/Templates/J27_Review_Workbook_Mockup_v9 Group Notes 11-5.xlsx`.
  Read locally. Start with staff master columns E–N and the Lists tab.
- Current plan: `docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md`.
  Prior handoff, including settled packet and editing decisions and remaining
  guardrails: `git show 2f9e47cbd:SESSION_PROMPT.md`.
- Historical retirement and cleanup items remain unverified before action.
  Prior Production-read permissions remain limited to their named lookups.
- Claim-evidence report could not read local state. No observation was added.
- No DEVELOPMENT_LOG.md entry required. This session settled planning
  decisions and shipped no capability.

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
