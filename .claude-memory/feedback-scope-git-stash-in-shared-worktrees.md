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

**How to apply:** before any path-scoped mutation check, inspect ownership and preserve
the exact pre-mutation bytes/preimage. Restore a path from `HEAD` only when it was proven
clean before the edit; otherwise restore the saved preimage, not a presumed base version.
Do not assume `git stash push -- <path>` safely scopes a shared tree or that the next
`stash pop` belongs to this operation. Preserve existing stash ownership and checkout
topology. Related: [[feedback-verify-branch-before-git-action]].

**S528 (2026-09-20) hazard:** `git stash push -- <path>` when that path has NO uncommitted changes stashes nothing and prints no error; the following `git stash pop` then applies whatever OLD stash is on top (here `codex-startup-reconciliation-report`), leaving an unrelated conflict. This historical incident reinforces checking path state and stash ownership; it does not make `git checkout -- <path>` safe when pre-existing edits may exist.
