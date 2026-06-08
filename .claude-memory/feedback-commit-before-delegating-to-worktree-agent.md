---
name: feedback-commit-before-delegating-to-worktree-agent
description: "Commit (or hand a patch) before delegating to a Codex/app session — it runs in an isolated git worktree that only inherits committed state, not your uncommitted edits."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  originSessionId: 18a40c8c-da47-4655-ba9e-3d072d2ea04d
---

When you delegate implementation to Codex driven "from the app" (or any worktree-isolated
agent), it runs in a **separate git worktree** (observed: `~/.codex/worktrees/<id>/WMKF_Apps`,
detached at the last commit). Git worktrees share commit history + the object store, but each
has its **own** working tree and index — uncommitted modified files AND untracked files do NOT
cross worktree boundaries. So an agent there sees only the committed base, never your in-progress edits.

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
