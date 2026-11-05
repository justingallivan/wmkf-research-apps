# Session 664 Prompt: Design the whole single-submission Workbench workflow

## Session 663 Summary — Codex, 2026-11-04 Pacific

[VERIFIED via owner discussion] Justin wants a holistic rethink of Workbench
function and form, using the single-submission process rather than incremental
applets. Begin with a process map, roles, decisions, information continuity and
connected cycle/proposal experiences before choosing tabs or implementing.

### What Was Completed

1. **Review DOCX calendar failure fixed.** Owner-approved read-only Production
   probes showed 112 matching Grant Cycle rows: the default 100-row page caused
   calendar_unavailable before review discovery. Prefer maxpagesize=500 now
   matches the existing top=500 bound; unexpected pagination still fails closed.
   Regression coverage and GET-only diagnostic were added. PR #631 merged as
   7e0df0195 after CI passed. No new filing/write smoke was run.
2. **Admin prompt improvements.** Power Automate flow usage choice: PR #632,
   merge 9267a1602. Built-in prompt output destinations (table/field, dynamic
   schemas and explicit unknowns): PR #633, merge af5d82dd8. Both merged after
   CI passed. Automatic main deployment was triggered; deployment outcomes were
   not independently checked in this session.
3. **Deprecated prompt decision resolved.** Owner says phase-i.checkin is
   deprecated. Recorded in the shared-library plan; no live Dataverse retirement
   or catalog edit was performed. Original 58750fcb7 is pushed on its branch;
   docs-only cherry-pick on main is 1607811ab.
4. **Connor's reusable child-flow instructions saved.** Proposed bounded first
   subset of the Executor, shared current prompt lookup, frozen row/version,
   validation, provider completion checks and audit lineage. No PA flow built.
5. **Package reprocessing plan retained and deferred.** App analyses/documents
   only, excluding Connor's assembly/AI flows. Owner expects Field Primer and
   Initial Assessment overhaul; settle workflows first. Plan branch is pushed.
   Initial stage list, retention periods and supported lifecycle stages remain
   provisional, not accepted decisions.
6. **Component/workflow investigation.** Reviewed Primer, Initial Assessment
   history, Board snapshot and Draft inputs. Draft does not reuse IA content or
   staff edits. Retrieved single-phase plans/memories/wiki/logs and saved a
   strategic discussion brief with superseded decisions identified.
7. **Status tab removal completed, not merged.** d0329dd1c removes navigation
   and rendering, retaining Overview status and shared badge code. Old status
   links fall back to Overview. 33 focused tests and relevant gates passed;
   lint had zero errors and five existing hook warnings. Feature branch pushed.

### Commits and remote destinations

| Commit | Work | Destination / state |
|---|---|---|
| e5b8ebc5f / 7e0df0195 | Calendar paging fix / PR #631 merge | main; merged |
| 9eca195bd / 9267a1602 | Power Automate usage / PR #632 merge | main; merged |
| 143efedbc / af5d82dd8 | Prompt output destinations / PR #633 merge | main; merged |
| 58750fcb7 / 1607811ab | Prompt deprecation decision / docs cherry-pick | Pushed original branch; main docs |
| 84da8eb2e, e5cc38eb3 | Reprocessing plan, then owner deferral | codex/proposal-package-reprocessing-plan; pushed, unmerged |
| d0329dd1c | Remove redundant Workbench Status tab | codex/remove-workbench-status-tab; pushed, unmerged |

The stop commit saves this handoff, discussion brief, child-flow guide and
milestone log. Owner explicitly approved docs on main with features separate.
No unmerged runtime feature is promoted by this stop.

## Next Items

### Owner Discussion — primary next session

1. **Whole-process Workbench design.** Read
   docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md.
   Map staff work from intake through Board decision, including offramps;
   define what analyses/documents support each decision and what staff edits
   carry forward; design cycle and proposal views together; then develop a few
   connected screen concepts. Current tabs are not fixed requirements.
2. **Field Primer and Initial Assessment.** Their purposes, content, overlap,
   placement and downstream reuse need owner decisions. Do not treat the D26
   pilot's format or old staged-pipeline design as the settled J27 workflow.
3. **Status-tab feature promotion.** Completed branch is available if the owner
   wants a PR. No PR or merge was requested for this change before stop; do not
   infer runtime promotion from the instruction to put everything in Git.

### Parked — retain, do not start automatically

- **Package reprocessing.** Resume only after new flows, sources, outputs,
  dependencies and staff-edit/lifecycle boundaries are decided. Retrieve
  codex/proposal-package-reprocessing-plan at e5cc38eb3; its sole plan file is
  docs/plans/ADMIN_PROPOSAL_PACKAGE_REPROCESSING_PLAN_2026-11-04.md and is not
  on main. Preserve the feature; revise the dated stage inventory before build.
- **Complementary reviewer-panel coverage.** Owner parked October 21; no pilot
  has run. See .claude-memory/project-reviewer-panel-coverage-pilot.md.
- Custom intake portal remains parked; J27 intake uses GOApply. No historical
  pipeline, expanded extraction schema or proposed screening criterion is
  approved by the discussion brief.

### Verify Before Acting / observation boundaries

- Prior Production-read approval applied only to the specific calendar probes.
  It is not standing permission for other Production reads or any write.
- Funding-history Word generation and first natural per-reminder history
  observation were not revisited. Prior owner deferral of staged proof remains;
  do not regenerate staff documents or send test emails merely to create proof.
- phase-i.checkin deprecation is a resolved owner decision, not proof of live
  retirement. Do not revive the old question for Connor or publish that draft.
- Historical J27 notes proposing front-end request-status advancement are
  superseded by October decisions: staff recommend in the app; Grants Manager
  records Chairs outcomes in Dataverse. Full new triage UI is not already built.
- PR #631–633 are merged, freshly confirmed with gh pr view at stop. Their
  deployment outcomes were not probed; no new release smoke is asserted.

## Concurrent Streams and Preservation

Previous Session 662 handoff is retrievable with
`git show dc268a6b2:SESSION_PROMPT.md` (verified readable at this stop).
Earlier detailed concurrent boundaries remain at
`git show 2cba25544:SESSION_PROMPT.md`; shared-prompt history at
`git show a66e09091:SESSION_PROMPT.md`. These are historical context, not current
permissions. This session did not change Factory fixtures, test ledgers,
provider credentials, environment flags or live prompt rows.

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


Other local branches/worktrees were preserved. Only this session's three
outstanding branches were newly pushed; no unrelated WIP was staged, stashed,
reset or deleted. Another session identified itself as read-only during the
planning work. Recheck worktree ownership and branch/status before acting.

## Key Files and Validation

| File | Purpose |
|---|---|
| docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md | Planning inventory and holistic design resume point |
| docs/plans/POWER_AUTOMATE_SHARED_PROMPT_CHILD_FLOW_GUIDE_2026-11-04.md | Saved proposed instructions for Connor; not implemented |
| docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md | Deprecated check-in decision |
| shared/config/adminPromptDestinations.js | Admin output destination catalog |
| scripts/probe-review-docx-calendar.mjs | GET-only calendar diagnostic; fresh approval required for Production |

Validation before stop: calendar fix 160 focused tests; usage choice 83;
prompt destinations 61; Status removal 33. Runtime PR checks passed before
merges. Reprocessing plan received a fresh read-only review; fixed review-mode
email side effects and source-drift cancellation/lease concerns. It remains
provisional/deferred. Stop-time document currency, fact consistency, canonical pointers, symbol
references, build-claim freshness, catalog, memory router and J27 register
gates passed with their paired self-tests where present. These checks do not
mean every historical runtime suite reran.

Claim-evidence pilot report: local state could not be read; no observation row
invented. No MEMORY.md router edit or growth advisory occurred this session.
CLAUDE.md needed no change: root instructions are unaffected.

Milestone determination: **entry added** to DEVELOPMENT_LOG.md for the calendar
incident fix and shipped Admin prompt improvements, with the strategic design
pivot distinguished from unmerged/deferred work.
