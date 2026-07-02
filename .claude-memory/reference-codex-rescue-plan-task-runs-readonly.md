---
name: reference-codex-rescue-plan-task-runs-readonly
description: A codex:codex-rescue agent launched for a plan/review/read-only task runs in a READ-ONLY sandbox; resuming it to "now implement" can't flip the sandbox — launch a FRESH agent framed as a build task to get --write.
metadata:
  type: reference
  status: active
---

The `codex:codex-rescue` runtime (`codex-cli-runtime/SKILL.md:24,39`) adds `--write` to
make Codex write-capable **unless the task reads as "review, diagnosis, or research
without edits."** The sandbox mode is fixed **at session launch**, not per-message.

**The trap (hit S294):** I spawned a rescue agent with "Draft a PLAN — NO CODE, plan
only." The runtime correctly launched it read-only. When I then resumed that SAME agent
(SendMessage / `--resume-last`) with "now implement," it kept its already-fixed read-only
sandbox and `apply_patch` was rejected: *"writing is blocked by read-only sandbox;
rejected by user approval settings."* Reads still worked, which masked the cause.

**Why:** a resume reuses the same codex session + sandbox. You cannot upgrade a read-only
session to write-capable by sending it a new instruction.

**How to apply:** when you want Codex to BUILD, launch a **FRESH** `codex:codex-rescue`
agent whose prompt is unambiguously an implementation/fix task ("Implement and APPLY —
write the files…"), NOT a resume of a plan-only agent. Don't lead a build prompt with
"plan only / no code / review." If you deliberately want a plan first, expect to spawn a
second fresh agent for the build. Verified config is fine for writes
(`~/.codex/config.toml`: `sandbox_mode = "workspace-write"`, `approval_policy = "never"`) —
the read-only state came from the task framing, not a broken config.

**Second trap — sibling worktree not writable (hit S313):** even a fresh build-framed
rescue agent has its writable root fixed to the MAIN repo checkout. It CANNOT write to a
sibling git worktree dir (e.g. `../WMKF_Apps-codex`) — `touch` there returns "Operation
not permitted" and no edits/commits are possible, though reads and gates still run. So
the `parallel-agent-worktree` skill pattern does NOT work through `codex:codex-rescue`: to run
Codex in a worktree, launch the Codex CLI natively in that directory; otherwise do the
worktree edits in-checkout (Claude) or work on a branch in the main checkout. See
[[reference-codex-rescue-pkill-overstep]] for the related "don't trust the rescue
wrapper's self-report" lesson.
