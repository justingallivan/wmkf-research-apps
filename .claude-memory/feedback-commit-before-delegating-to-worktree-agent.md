---
name: feedback-commit-before-delegating-to-worktree-agent
description: "Determine the delegation topology first; if the agent runs in an isolated worktree, commit the dependency or provide a patch because uncommitted edits do not cross that boundary."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  originSessionId: 18a40c8c-da47-4655-ba9e-3d072d2ea04d
  last_verified: 2026-07-27 as a historical S233 isolated-worktree incident; determine current agent topology per task
---

## Recall Rule

Before delegating across an isolated worktree boundary, establish whether the
agent sees the current working tree or committed `HEAD`. If it sees only commits,
commit the dependency or provide a patch; do not assume uncommitted files cross.

[VERIFIED historically via the S233 worktree path and `HEAD` inspection.] In that
incident, Codex driven from the app ran in a **separate git worktree**
(`~/.codex/worktrees/<id>/WMKF_Apps`) detached at the last commit. This is not a
universal claim about current subagents: establish the topology for each delegation.
When an agent is worktree-isolated, uncommitted modified and untracked files do not
cross that boundary, so the agent sees the committed base rather than in-progress edits.

**Why:** S233 — I delegated Fix C with a prompt saying "the uncommitted working tree already
contains fixes 1/2/A/B." True of my main dir, false of Codex's worktree (base `45c179f`). Codex
saw the original code (no honorific strip, `>25` topTopics, no spec doc/untracked files), partially
re-derived some fixes from the prompt text, missed others, and built on a divergent base →
overlapping edits to openalex/discovery/dedup that needed a hand-merge, plus 2 regressions
(deleted the verified-name dedup; dropped my Fix 1 honorific strip).

**How to apply:** Before handing work to a worktree-isolated agent, **commit your in-progress
changes** (or `git add -A && git diff --cached > patch` and give it the patch) so both sides share
a real base. If you can't commit, at least tell the agent its base will be pristine HEAD and to
expect your changes absent. Silver lining when it happens anyway: if the agent's worktree is at the
SAME commit as yours, both change sets are diffs against that commit → reconcile is mechanical
(take-mine / take-theirs / hand-merge the both-touched files). See [[feedback-share-codex-verbatim]],
[[project-codex-recurring-review]], [[project-codex-design-pre-impl-iteration]].
