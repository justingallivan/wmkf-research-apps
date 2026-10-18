---
name: feedback-codex-worktree-owner-runs-it
description: "For parallel Codex builds, dispatch is supported when requested; if the owner is running it themselves, provide the worktree and prompt."
metadata:
  type: feedback
  status: active
  scope: agent-collaboration
  last_verified: 2026-09-12 (S510)
---

## Recall Rule
Read before setting up Codex work on a branch.

Prepare the requested worktree, branch, and committed brief. Dispatch through
the Codex rescue companion is supported when it is pointed at that worktree with
`-C <worktree>`; without it, the sandbox may be rooted at the main checkout and
refuse worktree writes. When the owner says they are running parallel work
themselves, provide the worktree path, brief path, and prompt, then stop. Resume
with a read-only review when the owner says the build is ready. A prior S509
dispatch failed because of workspace-rooting; S510 traced and corrected that
cause, so do not carry forward the obsolete dispatch prohibition.

For review-finding rescue work, S536 showed the companion may edit and test but
fail to commit because of worktree Git metadata permissions; have the owner-side
agent review and commit the resulting diff. Preserve the review handoff format:
`CODEX RESCUE HANDOFF`, an `[INTENTIONAL-RESCUE: …]` tag when the brief mentions
review findings, and traced file/line evidence for find/check requests.

Ground truth: `.claude/skills/parallel-agent-worktree/SKILL.md` and
`docs/AGENT_COLLABORATION_PLAN.md`. Model choice: [[feedback-codex-model-gpt56-sol]].
