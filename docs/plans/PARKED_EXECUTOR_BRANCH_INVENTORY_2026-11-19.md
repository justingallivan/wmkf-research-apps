# Parked Executor branch: what it holds and what to keep

Date: 2026-11-19. Owner: Justin. Written by Claude (Session 685) from read-only git
inspection of `origin/codex/executive-summary-generation-2026-11-16`, tip
`d86870146`.

## Why the branch is not on main

On 2026-11-16 the owner stopped the backend prompt work: Connor's existing Power
Automate flows run the Dataverse prompts; this app does not run them through its own
job system. Merging the whole branch needs a new owner decision. See
[PA prompt delivery handoff](PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md).

The branch is large (111 commits, 2026-11-10 to 11-17; 219 files, about 25,000 added
lines) because each Codex session from November 10 to 17 started from the previous
branch, not from `main`. Everything after the shared Executor sits on top of it.

## What is on the branch

| Group | Key commits | Can it ship alone? | Disposition |
|---|---|---|---|
| Shared Executor: prompt profiles, job ledger and worker, migration `097_shared_prompt_jobs.sql`, `lib/services/prompt-jobs/` | `d69a0cc7f` design through `66a1671aa` | Foundation for everything below | Stopped by owner as over-engineered. Do not ship. |
| Admin "Shared document tasks" panel (`SharedPromptEditor.js`, `/api/admin/prompt-profiles`) | `f90eb997b`, `e67880529` | No: edits Executor profiles only the parked worker reads | Not needed. Production Admin already edits the `wmkf_ai_prompt` rows Connor's flows use [VERIFIED via `shared/components/admin/PromptTemplatesSection.js` header and branch diff]. |
| Staff proposal-draft trial panel (Workbench Proposal tab) | `5de871661`, `3220745dd`, trials `75a277dff`, `492cd38c9` | No | Trial only. |
| Expertise recommendations through the Executor (Sandbox trials on 1000339) | `7d0cf0392` through `65726e852` | No | Superseded by the Connor-reviewed expertise plan. The roster prompt `expertise-finder-roster-v2.js` is also on `codex/expertise-roster-import-2026-11-10`. |
| Power Automate submit/poll endpoints and machine sign-in | `9b1511b62`, `23f71d2b5`, `23d000af0` | No | Replaced by the owner's direction above. |
| Executive Summary generator (one Sandbox trial on 1000389) | `ac7cac093`, `6d6a7c724`, receipt `8e98afb03` | No | Parked. Trial content cleanup batch 2 is due after 2026-11-23 18:31:58 UTC (see the delivery handoff). |
| Editable lay abstract and Initial Assessment fields | `bfa4c7781`, `d8d100a65` | n/a | Already on `main` by another route: staff editor `1037d2dbd`; Initial Assessment PRs #644 to #646 [per the Session 684 handoff; not re-diffed]. |

One small generic change: creating a new prompt in Admin with explicit variables
(today they are derived from `{{placeholders}}` on create; editing already accepts
them). Rebuild in a few lines if wanted; do not port the branch code.

## Knowledge kept outside the branch

- Workbook prompt requirements and the November 10 owner decisions:
  [pre-flight prompts handoff](PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md), copied to
  `main` on 2026-11-19.
- Prompt texts in use (Short Title v2, Summary v2, Methodology v2, PD-match v1) are
  Production Dataverse rows, not branch code [per the delivery handoff's read-only
  Production prompt audit, 2026-11-16; not re-read here].

## Branch-only evidence (read with `git show <branch>:<path>`)

- Prompt trial candidates and inputs: `docs/plans/SHARED_EXECUTOR_PROPOSAL_METHODOLOGY_V3_CANDIDATE_2026-11-11.json`,
  `docs/plans/SHARED_EXECUTOR_PROPOSAL_RETRY_CANDIDATE_2026-11-11.json`,
  `docs/plans/SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json`.
- Trial receipts: `docs/plans/PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md`,
  `docs/plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md`,
  `docs/audits/SHARED_EXECUTOR_CONTROLLED_TRIAL*_2026-11-11.json`.
- Design and model reviews: `docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md`,
  `docs/audits/SHARED_EXECUTOR_*`.

## Preservation

- Keep `origin/codex/executive-summary-generation-2026-11-16` until the owner decides
  otherwise. It contains every commit of the ten local-only branches
  `codex/executor-*-2026111x` and `codex/staff-draft-*-20261111` (verified 2026-11-19:
  `git cherry` shows zero missing commits for each), so those local branches can be
  deleted.
- Its worktree `/private/tmp/wmkf-summary-generation-20261116` is volatile; the pushed
  branch preserves the code. Private trial files are not in Git.
