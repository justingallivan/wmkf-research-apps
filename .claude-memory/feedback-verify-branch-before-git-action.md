---
name: feedback-verify-branch-before-git-action
description: Before any commit, branch-affecting git action, background test run or delegated review in this repo, verify the active branch FIRST — the shared working directory's HEAD drifts when a concurrent Codex session checks out branches. Self-policing since S280; since S487 (2026-09-05) Codex sessions run in the sibling worktree ../WMKF_Apps-codex instead of the main checkout.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-09-05 (S487) — recurrence; Justin then adopted the Codex worktree
---

## Recall Rule

Read this before EVERY `git commit`, `git checkout`, or any action that assumes
"I am on branch X" in WMKF_Apps.

[VERIFIED historically via the S280 branch-drift incident and owner decision.]
The current branch must still be checked immediately before each git action.

## The fact (Justin, S280)

This repo is worked by Claude AND a separate **Codex app session** (Justin sees the
jobs in the Codex GUI) in the SAME working directory. A working dir has ONE HEAD, so
when the Codex session checks out / deploys / splits branches, HEAD moves out from
under Claude. In S280 this caused Claude's commits to land on the wrong branch
(`codex-portal-work`) before the branches were untangled.

Justin is NOT git-fluent for multi-dev workflows and works across TWO machines
(home + work), and is leery of added complexity — so he REJECTED the git-worktree
isolation fix and chose **self-policing**: Claude verifies the branch itself. He was
explicit: this only works "if you stick to it."

**Why:** the `/start` branch snapshot is point-in-time and goes stale mid-session; a
silent drift means commits land on the wrong branch and create a costly untangling.

**How to apply (every time):**
- Before any commit or branch-affecting op, run `git status --short --branch` (or
  `git rev-parse --abbrev-ref HEAD`) and confirm the active branch is the intended one.
- If HEAD has drifted: STOP, report it, switch back to the intended branch, THEN act.
  Never commit assuming a branch.
- Don't run Claude git/branch operations while a Codex-app session is actively doing
  branch work / deploys on the same checkout — one driver on the repo at a time. If
  drift is detected mid-task, pause and flag.
- **Update, S487 (2026-09-05):** the drift recurred. Justin opened a separate Codex
  session in the main checkout while Claude orchestrated Stage 6B2; its `git checkout
  main` landed 24 seconds after a Claude commit and silently swapped the tree under a
  running full-suite job and a fresh-context reviewer. Both were voided and rerun. Justin
  then accepted the worktree approach: Codex now runs in `../WMKF_Apps-codex` on
  `codex/ui-features` (created with `scripts/bootstrap-machine.sh --worktree`). When a
  parallel Codex session is mentioned, first ask whether it is in that worktree; if it is
  in the main checkout, hand Justin the reorientation prompt from
  `.claude/skills/parallel-agent-worktree/SKILL.md` before running anything.
- Drift voids more than commits: a background test run, build, gate or delegated review
  reads whatever tree is on disk. Record `git rev-parse HEAD` at the start AND end of any
  background verification log and treat the totals as void if they differ; give every
  reviewer subagent an explicit "verify HEAD and blob md5 before running" instruction.
- Since S356 the `/start` and `/stop` skills encode this check themselves (branch
  verify before pull; re-verify before docs commit; push current branch, not
  hard-coded main). That covers session boundaries only — mid-session git actions
  still rely on this rule.
- Related: [[project-commit-directly-to-main]], [[project-workbench-consolidation-rollout]].
