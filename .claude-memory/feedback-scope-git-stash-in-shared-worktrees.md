---
name: feedback-scope-git-stash-in-shared-worktrees
description: When multiple agents edit one worktree concurrently, an unscoped `git stash`/`git stash pop` (e.g. for a mutation check) momentarily reverts EVERY agent's uncommitted work, risking lost edits if any process writes during the window. Scope reverts to the single owned file instead.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-08-15 (S431) — observed during the revocation-hardening build
---

## Recall Rule

Read this before running `git stash`, `git checkout -- <path>`, or any
working-tree revert in a worktree where concurrent agents (builders,
Codex, subagents) hold uncommitted edits — including inside delegation
briefs that ask a builder to run a mutation check.

## The fact (S431)

During the disabled-account revocation-hardening build, builder A ran an
unscoped `git stash` + `git stash pop` to mutation-check its test against
pre-fix code. The stash briefly reverted builders B's and C's in-flight
uncommitted edits (`lib/utils/auth.js`, `pages/api/auth/link-profile.js`)
for ~1s. No work was lost (verified by post-pop diff review), but any
concurrent write during that window would have been clobbered or landed in
the stash.

**Why:** `git stash` operates on the whole working tree; in a multi-agent
worktree the tree is shared mutable state.

**How to apply:** for mutation checks, revert only the owned file —
`git show <base>:<file> > <file>` (restore after) or `git stash push -- <file>`
— and say so explicitly in builder briefs. Related: [[feedback-verify-branch-before-git-action]].
