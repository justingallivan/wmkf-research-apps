---
name: feedback-one-session-runs-gates-per-worktree
description: "Gate self-tests write fixtures into scanned paths, so two sessions running check:* in the same worktree at once produce spurious reds; stage gate lists must include every gate that scans moved source (j27-register was missed at S5)."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a0f720d1-2f6f-4926-bf29-612e5e4647ae
  modified: 2026-09-19T10:17:10.615Z
status: active
scope: docs
last_verified: 2026-09-19 via Explorer extraction S9 full gate run (spurious reds re-run green alone) and j27-register fix 542b0892
---

Two lessons from the Dynamics Explorer chat-service extraction (branch `claude/explorer-chat-extraction`, 2026-09-19):

1. Only one session may run `check:*` gates in a given worktree at a time. When the orchestrator's full gate run overlapped an Opus reviewer's gate run in the same worktree, `check:doc-currency:self-test`, `check:fact-consistency`, and `check:model-override-warming:self-test` went red spuriously; each was green when re-run alone.
2. A per-stage "13 gate pairs" list is a blind spot if it omits a gate that scans moved source. `check:j27-register` went red at S5 (the `get_entity` select string moved to `tools/get-entity.js`) and surfaced only at the S9 full run.

**Why:** self-tests write synthetic fixtures into paths the main gates scan (CLAUDE.md rule 4 already forbids parallel gate+self-test; this extends it across sessions). Register-style gates anchor to file paths, so any move can break them.

**How to apply:** when delegating a review that will run gates, either wait for it before running your own, or tell the reviewer not to run gates. When writing a staged move plan, derive the per-stage gate list from `grep '"check:' package.json` filtered to gates that scan the moved paths, not from a fixed list. Related: [[feedback-red-gates-are-p0]], [[feedback-run-harness-framing-before-handoff-commit]].
