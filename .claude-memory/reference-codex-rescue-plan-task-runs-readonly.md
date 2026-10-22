---
name: reference-codex-rescue-plan-task-runs-readonly
description: S294/S313 documented rescue-agent failures; before any current resume or build, inspect the actual checkout and effective sandbox because request flags do not establish that a resumed session changed either.
metadata:
  type: reference
  status: active
  last_verified: 2026-10-22 via installed companion source review; effective resumed sandbox behavior not established
---

## Recall Rule

Read only when deliberately using the Claude Code `codex:codex-rescue` fallback.
For normal multi-agent work, use `docs/AGENT_COLLABORATION_PLAN.md` and the active
agent runtime instead. The 2026-07-22 verification is a historical citation, not proof
of current effective sandbox behavior.

Historical S294/S313 incidents below explain why rescue fallback needs care. The
installed companion source accepts `--cwd`, `--write`, and `--resume`, and passes cwd
and sandbox fields to its app-server resume request; that source review does not prove
the effective checkout or sandbox after a resume. Before any authorized work, inspect
the actual working directory and effective sandbox reported by the runtime. If either
is unclear or unsuitable, start a fresh, explicitly scoped task in the intended
checkout/runtime rather than assuming a resume or a fixed main-checkout root will work.

**Historical trap (S294):** I spawned a rescue agent with "Draft a PLAN — NO CODE, plan
only." The runtime launched it read-only. When I then resumed that SAME agent
(SendMessage / `--resume-last`) with "now implement," it kept its already-fixed read-only
sandbox and `apply_patch` was rejected: *"writing is blocked by read-only sandbox;
rejected by user approval settings."* Reads still worked, which masked the cause.

**Historical observation, not a universal runtime guarantee:** that resume retained its
read-only behavior. Do not infer from this incident that every current runtime permanently
fixes sandbox mode at launch; inspect the effective state for the current task.

**How to apply:** when authorized to build, use a fresh, scoped task in the intended
checkout and verify its effective sandbox before editing. A request's `--write` flag or
configuration alone is not proof of effective write access. Keep plan/review work
separate when useful, but do not assume a new task is rooted at the main checkout.

**Historical second trap — sibling worktree not writable (S313):** that rescue agent
could not write to the sibling worktree and appeared rooted in the main checkout. This
does not establish current topology for other tasks or runtimes. For each task, verify
the actual checkout and ownership before work; do not redirect work into an existing
owner checkout or assume the main checkout is the only writable root. See
[[reference-codex-rescue-pkill-overstep]] for the related "don't trust the rescue
wrapper's self-report" lesson.
