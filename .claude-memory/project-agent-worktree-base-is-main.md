---
name: project-agent-worktree-base-is-main
description: "Agent tool `isolation: worktree` branches from main, not the current feature branch; builders must fast-forward to the stated base commit first"
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: fa2abe28-0431-4a5a-bddf-f68ca3111d9c
  modified: 2026-10-05T15:39:05.999Z
---

## Recall Rule
Read before spawning builders with the Agent tool's `isolation: "worktree"` while on a feature branch, or before merging work a worktree builder produced.

Do: name the exact base commit in every builder brief and make `git merge --ff-only <sha>` step zero; check each worktree's merge-base with the feature branch before merging.
Do not: tell a builder it is branched from the feature branch; assume an unmerged contract commit is visible in its worktree.
Ground truth: `git merge-base <worktree-branch> <feature-branch>` on the produced branch; observed behavior recorded below (S575).

The Claude Code Agent tool's `isolation: "worktree"` creates the subagent's worktree from `main`
(observed 2026-10-05, Session 575: all three Stage 1 builders started at `a8474e16e` while the
orchestrator was on `feature/site-visit-presentation-boundary` at `9bd10764a`). Two builders
fast-forwarded themselves; one built blind against a contract it could not read.

**Why:** a brief that says "you are branched from <feature branch>" is false, and a builder that
depends on an unmerged contract commit will fail or re-implement it.

**How to apply:** in every parallel-builder brief, name the exact base commit and instruct
`git merge --ff-only <sha>` as step zero; verify each worktree's merge-base with the feature
branch before merging its work. Related: [[feedback-orchestrator-checks-builds-before-review]].
