---
name: project-agent-worktree-base-is-main
description: "Worktree builders may start from a different base than the orchestrator; inspect the actual base, ownership, and working tree before integrating"
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: fa2abe28-0431-4a5a-bddf-f68ca3111d9c
  modified: 2026-10-05T15:39:05.999Z
---

## Recall Rule
Read before spawning builders with the Agent tool's `isolation: "worktree"` while on a feature branch, or before merging work a worktree builder produced.

Do: inspect and name the actual base commit in each builder brief; check the produced worktree's merge-base and ownership before integration. If required context is absent, coordinate an explicit base transfer with the owner.
Do not: assume an unmerged contract commit is visible in its worktree, or automatically merge/redirect a builder's existing checkout.
Ground truth: inspect the produced branch and its worktree state; the S575 observation below is historical, not a guarantee about current agent topology.

Historical observation (2026-10-05, Session 575): all three Stage 1 builders started at
`a8474e16e` while the orchestrator was on `feature/site-visit-presentation-boundary` at
`9bd10764a`. Two builders fast-forwarded themselves; one built blind against a contract
it could not read. This records that session's topology only.

**Why:** an unverified brief saying "you are branched from <feature branch>"
can be false; a builder missing a required unmerged contract commit can fail or
re-implement it. Verify the actual base rather than inheriting the S575 topology.

**How to apply:** in each parallel-builder brief, identify the intended base and verify
the actual checkout before work. Integrate only after checking its diff, ownership, and
current working-tree state with the relevant owner. Related: [[feedback-orchestrator-checks-builds-before-review]].
