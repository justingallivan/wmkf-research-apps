---
name: feedback-codex-worktree-owner-runs-it
description: "For a Codex worktree build, Claude prepares the worktree, branch, and committed brief. Dispatch via codex:rescue is fine WHEN the companion is pointed at the worktree with -C <worktree> (owner 2026-09-12 S510); without -C the sandbox roots at the main checkout and every worktree write is refused. The owner asks for a paste-able prompt instead when they are running parallel work themselves."
metadata:
  type: feedback
  status: active
  scope: agent-collaboration
  last_verified: 2026-09-12 (S510)
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

**Update (S510, 2026-09-12):** the owner reversed the default: "You can use codex rescue for
this task. I usually request prompts when I'm working on parallel work." The S509 failure was
not the tool but the root: the companion resolves its workspace with `git rev-parse
--show-toplevel` on its cwd (the plugin's own workspace and git helper modules under `~/.claude/plugins/cache/openai-codex/codex/`, not repo files) and starts the
Codex thread there, so `codex-companion.mjs task -C /path/to/WMKF_Apps-codex --write
--background --model gpt-5.6-sol …` roots the sandbox in the worktree (job state dir became
`WMKF_Apps-codex-…`, S510). Rule: always pass `-C <worktree>`; still pass `--model
gpt-5.6-sol` ([[feedback-codex-model-gpt56-sol]]); when the owner says they will run
Codex themselves, hand over the prompt instead.

**Update (S536, 2026-09-23):** owner pattern this session was "Codex rescue fixes, Claude reviews" for adversarial-review findings. In the `~/.codex/worktrees/...` Factory worktree, Codex rescue could edit and test but its sandbox could NOT commit (`index.lock: Operation not permitted` on the main repo's `.git/worktrees/...` metadata); Claude reviewed the uncommitted diff and committed it. Always pass `--model gpt-5.6-sol` (default `gpt-6-sol` fails on ChatGPT auth). The review-delegation hook requires the `CODEX RESCUE HANDOFF` preface, an `[INTENTIONAL-RESCUE: …]` tag when the brief mentions review findings, and TRACED file:line evidence for any find/check ask.
