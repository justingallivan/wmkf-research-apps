# Session 665 Prompt: Answer the J27 cycle information plan's owner questions

## Session 664 Summary — Claude, 2026-11-04 Pacific

[VERIFIED via owner discussion and owner-approved read-only Production reads]
Reviewed the CSO's J27 review workbook (`J27_Review_Workbook_Mockup_v9.xlsx`,
owner's copy; applicant data, not stored in the repo) and turned it into a
staged plan. Owner deferred the plan's questions to this session.

### What Was Completed

1. **Repo hygiene.** The recurring "claude-config: local changes uncommitted"
   startup warning came from `~/.claude`, not this repo. Committed the
   Impeccable upgrade and settings there (claude-config 5cecdf1; stray
   installer `description` key removed; `skills/.trash/` ignored). In this repo,
   committed the matching hook files and the Oct 19 Board writeups critique and
   ignored `output/` (f835ca9ab).
2. **Owner decisions recorded as D50** in the alignment log (5e53f5a93): staff
   approve the post-review offramp with a written justification and no reason
   list; presentations are scheduled only after reviews; the workbook's
   proposed reason list is for triage only; Chairs and interested Board members
   weigh in on the ~50 in advance, staff narrow to ~25, the Chairs decide; the
   workbook is a spec, not a workspace. Rank came from Proposal Ranking.
3. **Field inventory and source analysis** in the Workbench strategy brief
   (a4df9324a). Six D26 requests (1002874, 1002835, 1003074, 1003024, 1002988,
   1002963) were read with owner approval, nothing written. The workbook's
   prose fields condense each request's final edited Word writeup; lay
   abstracts mostly come from the applicant's own text. The Draft generator
   writes AI sections to `wmkf_requestdocument` columns once; staff edits live
   only in the Word file, which the Final Writeup row shares. Marked as
   inference pending the CSO's confirmation (owner asked her).
4. **Draft plan** `docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md`
   (7f3ea0d40): field contract, intake generation, packet generation, decision
   records and outputs, staged by the J27 calendar. Linked from the brief.

### Commits

| Commit | Work | Destination |
|---|---|---|
| f835ca9ab | Impeccable hooks, critique, ignore output/ | main |
| 5e53f5a93 | D50 decision record | main |
| a4df9324a | Field inventory and source analysis | main |
| 7f3ea0d40 | J27 cycle information plan | main |
| claude-config 5cecdf1 | ~/.claude Impeccable upgrade and settings | justingallivan/claude-config |
| (this stop) | Handoff and pilot observation row | main |

All docs/config only. No runtime code, Dataverse write, prompt or flag change.

## Next Items

### Owner Decision Needed — primary next session

[VERIFIED via owner discussion, 2026-11-05; product decisions, not shipped behavior.]
The cycle information plan records:

1. **S1:** November 15 target for D41 staff state/bulk setting and intake fields
   visible as they arrive; delivery feasibility still needs verification.
2. **F1:** edit short fields in the app, backed by Dataverse. Generated Word
   versions retain the field baseline; later Word edits are flagged for human
   or machine-assisted reconciliation. Document composition and detailed
   reconciliation mechanics remain to design.
3. **F2:** freeze shared packets; app fields remain editable for later packets.
4. **F3 rank:** use existing Dataverse ranking records; no final rank on the
   request. Plan both within-program and combined ranks in leadership packets,
   subject to later owner revision; exact source/derivation remains to verify.
   **F3 amount:** overrides and "Do not approve" deferred until later
   in the cycle; retain existing invited/requested amount behavior for now.
5. **I1:** editable app fields are the intake working surface. Whether to
   assemble an Initial Assessment Word document from them is deferred.
6. **D1:** staff notes and offramp justification are single editable fields
   without a logged entry history; exact Dataverse provisioning remains to
   verify. Platform auditing was not changed or decided.
7. **O1:** plan both workbook delivery and a magic-link browser view of the
   same frozen leadership packet; detailed access/delivery design remains open.
8. **First Cut size:** "about 50" is a flexible planning target, with no
   app-enforced limit.
9. **Remaining owner/CSO questions:** CSO source inference and one-page
   writeup-shape confirmations. Core owner questions S1/F1/F2/F3-rank/I1/D1/O1
   are resolved; F3 amount and Initial Assessment Word output are deferred.

### Verified Open

1. **Connor items for intake (D37/D14):** target field for the lay abstract
   (none exists), confirmation of the short-title prompt, full keyword lists.
   Evidence: plan Part 2; brief inventory.
2. **Status-tab removal** remains on `codex/remove-workbench-status-tab`
   (d0329dd1c), pushed, not on main [VERIFIED via git merge-base at this stop].
   Promote only on owner request.

### Parked

- **Package reprocessing** on `codex/proposal-package-reprocessing-plan`
  (e5cc38eb3; not on main, verified at this stop). Resume after flows settle.
- Complementary reviewer-panel coverage (owner parked Oct 21); custom intake
  portal.

### Verify Before Acting

- Production-read approval this session covered only the six named requests and
  two user-name lookups. It is not standing permission.
- The workbook-source finding is text-similarity inference over 6 of 23
  requests; the CSO's answer is authoritative.
- Extracted request text from this session sits in the session scratchpad
  (`req*/texts.json`); it is temporary and not in the repo.
- Previous handoff carryovers (funding-history proof, phase-i.checkin
  deprecation is a decision not a live retirement, PR #631–633 deployment not
  probed) still hold; see `git show 5e6def44d:SESSION_PROMPT.md`.

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
| docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md | Staged plan and open owner questions — resume point |
| docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md | Workbook summary, field inventory, source analysis |
| docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md | D50 and the earlier J27 decisions (D13, D21, D36, D37, D41) |
| lib/services/pre-site-visit/proposal-core-service.js | Draft generator inputs (narrative + request context) |
| lib/services/pre-site-visit/artifact-model.js | Draft section → `wmkf_requestdocument` column map |

Startup ran all 72 check gates and self-tests sequentially: green. Doc gates
(docs-catalog, doc-currency, fact-consistency, doc-symbol-refs,
build-claim-freshness, secret-scan, scaffolding-tokens, harness-framing,
drain-table and prompt-storage mentions) passed after each docs commit.

Claim-evidence pilot: 1 advisory event this session; row added to
`docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`. No MEMORY.md router
edit. CLAUDE.md needed no change.

Milestone determination: **no entry required** — planning and decision
records only; nothing shipped.
