# Session 669 Prompt: Independent reviews of the J27 Workbench cycle

## Session 668 Summary · Codex, 2026-11-08 Pacific

- **Preview only [VERIFIED via Vercel inspect and signed-in browser].** The
  development branch is `codex/j27-workbench-reports`. The latest rehearsal
  Preview runs code at `559a9b786` and the shared alias resolved at closeout to
  `dpl_5wQcfshKGG4z8cyeTueXkt9L4sve`. The rollout plan is preparation only.
  Keep production activation and any merge separate from this evaluation.
- **Request workflow [VERIFIED via signed-in rehearsal and source].** Preview
  has Overview, Initial Assessment, Peer Review, Deliberations, and Final
  Assessment. Reports saves the staff interpretation separately from generated
  reviewer facts and carries both forward. Deliberations leads with presentation
  and staff discussion. Final Assessment leads with the Board recommendation
  and can open the authorized Word draft. The initial and intermediate Word
  assessment steps are retired from the redesigned request flow.
- **June 2027 Research [VERIFIED via sandbox Dataverse readback and signed-in
  browser].** #1000372 (intake), #1000370 (peer review), and #1000369 (Board)
  already linked to J27. To make them visible from the cycle picker and list,
  the rehearsal set their Research program, staff readiness, lead PD assignment
  to Justin, and legacy triage to Advancing. Reviewer reminders were disabled
  on the three fixtures. Existing phase choices were preserved. These existing
  synthetic rows were set up directly in sandbox Dataverse, outside the Factory.
  They have no Factory run or ledger entry. Leave the fixtures in place for review.
- **Landing page gaps [VERIFIED via signed-in browser and source].** All three
  requests appear under Assigned to me. Each row opens Peer Review → Panel,
  including the intake example. Back to Workbench returned to June 2027 in this
  rehearsal. J27 hides the Advancing dropdown and badge, while the cycle and list
  still depend on the stored triage value for these fixtures. The list still shows
  Invite for completed-review examples such as #1000370, even though the
  invitation queue itself shows zero and says “No reviewers awaiting invitation.”
- **Integrity [VERIFIED via earlier isolated Preview rehearsal].** A saved
  Semi-finalist Yes queued a simulated screen, No skipped it, and the lead PD
  received a Workbench alert. #1000376 is the simulated finding linked from the
  landing page. The dropdown and simulator are scoped to designated fixtures.
  Reuse the evidence and inspect the alert without rerunning the Workflow.

### Commits and preservation

The full 30-commit branch series is retrievable with
`git log --oneline 53066edc1..559a9b786`. Key checkpoints:

- `5a1d98b40` through `b6a043167` · Reports, visit assessment, roster, and phase tabs.
- `e37089975`, `685ff0ad5`, `f2e12cc0e` · rationale, proposal access, and First Cut autosave.
- `84199d437`, `27970b8fc` · authorized Word link and production rollout preparation.
- `43f552754`, `dd42e8269` · Semi-finalist and isolated background screening rehearsal.
- `0df2c17c7`, `9ac3fd21f`, `0c8ded450`, `8734af1c8`, `5bc7a0dc2` · Panel,
  AI Review Panel, handoffs, Overview, and consistent reviewer navigation.
- `8c678f5bd`, `604daf62a`, `bcc06aeed`, `559a9b786` · invitation filtering,
  cycle-picker copy, invitation empty state, and J27 legacy control removal.

The prior handoff is retrievable at `git show 53066edc1:SESSION_PROMPT.md`.
The local Impeccable critique artifact under `.impeccable/critique/` remains
untracked in the rehearsal worktree. Preserve it and other local work.
The claim-evidence pilot report could not read local state.

## Next Items

### Verified Open · Two independent evaluations

Run Claude Fable and Codex independently with the same brief and Preview access.
Keep their findings separate until both have submitted. Use ordinary interactive
OAuth sessions and the project rules for any delegated CLI. The task is evaluation
and design proposals. Implementation comes after comparing the two outputs.

**Brief to give both reviewers**

Map the next Research cycle in four phases:
**Initial Assessment → Peer Review → Deliberations → Final Assessment**.
Awardee work follows the funding decision. For each phase, identify what staff
read, edit, and decide, where the work starts, what is saved, and what the next
phase receives. Evaluate whether the cycle landing page helps staff see where
each proposal stands and find the work that needs attention.

Start at [June 2027 Research Preview](https://wmkfresearchapps-preview.vercel.app/workbench?cycleCode=J27).
Find each example in the Request list, open it, and return to the cycle between examples.

1. **#1000372 · Intake.** Locate the proposal, AI findings, and staff rationale.
   Trace First Cut and the Semi-finalist decision, including how a saved Yes can
   queue background screening and how relevant findings reach the lead PD. Use
   the existing simulated alert on #1000376 for that part of the walkthrough.
2. **#1000370 · Peer Review.** Check the roster, invitations, reports, comparison,
   and saved summary. Compare the cycle queues with the request and evaluate how
   staff can tell that this proposal has stopped after peer review. Treat any
   permanent offramp status as an open decision.
3. **#1000369 · Board path.** Trace the Reports handoff through the presentation,
   staff discussion, and attendance to Final Assessment. Check that the existing
   Word draft is accessible. Stop before starting group review.

Use read-only checks and existing rehearsal evidence. Distinguish browser-observed
behavior from source-verified behavior and unverified assumptions. Keep PD email
out of the Semi-finalist step. Keep Word for the Board recommendation. Avoid
changing statuses, sending messages, or triggering new screening runs.

**Each reviewer returns**

1. A workflow map covering staff tasks, saved outputs, and handoffs.
2. An infrastructure assessment tracing cycle eligibility, queue membership,
   saved fields, and handoff contracts. Identify consumers of the Advancing field
   and the effects of retiring it.
3. A UI assessment with request numbers and screenshots or source references.
   Check if the Request list gives a useful cross-phase view and whether each
   existing queue serves a current task. Verify what Initial assessments,
   Reviewer follow-up, Staff deliberations, Final writeups, and Awardees actually
   contain before proposing new labels.
4. A coherent landing-page and navigation proposal. For each tab or queue,
   recommend keeping, moving, combining, or retiring it and explain why.
   Separate UI changes from changes to eligibility, persistence, or automation.
   Include acceptance checks for the same three requests.

**After both reviews**

Compare the two proposals side by side. Separate differences in evidence from
differences in design judgment. Recommend the first coherent set of changes to
prototype on the development branch and the Preview checks that would validate it.

### Owner Decision Needed

- Formal offramp outcome and its durable Dataverse location remain open pending
  Sarah and Connor's input. Staff rationale is a separate narrative.
- Production rollout requires a separate owner decision. Recheck source and
  deployment configuration against the earlier
  [rollout plan](docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md)
  before using it for a release. No development-log milestone entry was needed for this Preview rehearsal.

### Parked

- Zoom attendance suggestions. Current rehearsal uses the confirmed manual
  roster and copyable attendance sentence.
- Changing live eligibility rules or retiring the legacy triage field. Trace
  consumers first and preserve historical-cycle behavior in the proposal.

## Key Files

| File | Purpose |
|---|---|
| `shared/components/workbench/WorkbenchShell.js` and `WorkbenchViewsNav.js` in the same directory | Cycle workspace and queues |
| `shared/components/workbench/RequestListPanel.js` | Landing rows, routing, reviewer status cues, and legacy triage controls |
| `lib/services/workbench/dashboard-service.js` | Cycle and request membership, stage rollups |
| `shared/config/workbenchVisibility.js` and `shared/config/requestReadiness.js` | Legacy triage eligibility and linked-cycle readiness |
| `pages/workbench/[requestId].js` | Request phases and handoff navigation |

## Concurrent Streams and Preservation

The following are inherited resume boundaries. Use the owning plans or prior
handoff to recheck status and authority.
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
