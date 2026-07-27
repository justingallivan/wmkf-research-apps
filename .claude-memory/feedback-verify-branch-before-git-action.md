---
name: feedback-verify-branch-before-git-action
description: Before any commit or branch-affecting git action in this repo, verify the active branch FIRST — the shared working directory's HEAD drifts when a concurrent Codex-app session checks out / deploys branches. Justin chose self-policing over git worktrees, explicitly contingent on Claude doing this every time.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-23 (S280) — Justin accepted self-policing "but you have to stick to it"
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
- Do NOT propose worktrees / new directories / changes to the two-machine sync as the
  fix — Justin declined that. The whole deal is consistent self-checking instead.
- Since S356 the `/start` and `/stop` skills encode this check themselves (branch
  verify before pull; re-verify before docs commit; push current branch, not
  hard-coded main). That covers session boundaries only — mid-session git actions
  still rely on this rule.
- Related: [[project-commit-directly-to-main]], [[project-workbench-consolidation-rollout]].
