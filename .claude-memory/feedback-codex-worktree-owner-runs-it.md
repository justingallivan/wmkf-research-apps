---
name: feedback-codex-worktree-owner-runs-it
description: For parallel Codex work, Claude prepares the worktree, branch, and committed brief; the OWNER launches Codex in another app. Never dispatch it from Claude's shell via codex:rescue — the companion's sandbox is pinned to the main checkout and cannot write into a worktree.
metadata:
  type: feedback
  status: active
  scope: agent-collaboration
  last_verified: 2026-09-12 (S509)
---
## Recall Rule
Read before any "set Codex up on a branch" request. The deliverable is a ready
worktree plus a committed brief and a one-line launch instruction for the owner,
not a running Codex job.

**What happened (S509, 2026-09-12):** after setting up `../WMKF_Apps-codex` on
`codex/email-templates-configurable` with a brief, I dispatched the build through the
`codex:codex-rescue` agent. The companion's sandbox writable root was pinned to
`/Users/gallivan/Code/WMKF_Apps`, so every write into the worktree was refused as
"writing outside of the project"; 13 minutes later it returned with zero commits.
Owner: "I don't know why you launched it in a shell and set it off in the first
place. Usually you set up a tree and a prompt and I run it myself in another app."

**Why:** the owner runs Codex interactively elsewhere (own auth, own sandbox rooted
at the worktree, visible progress). `codex:rescue` is for rescue/diagnosis runs on
the main checkout, not for parallel branch builds. See [[feedback-codex-delegation-review-vs-rescue-routing]].

**How to apply:**
- Follow `parallel-agent-worktree` Steps 1–3 only: verify disjoint surfaces,
  bootstrap/reuse the worktree, commit the brief, push the branch.
- Hand the owner: worktree path, branch, brief path, and the `/start` reminder.
  Stop there.
- Resume at Step 5 (read-only review, verify, merge on the owner's go) when the
  owner says Codex is done.
