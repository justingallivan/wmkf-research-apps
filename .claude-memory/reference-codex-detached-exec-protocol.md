---
name: reference-codex-detached-exec-protocol
description: "Historical S331 detached codex exec observations; current reviews should use managed runtime and exact-job cancellation"
status: active
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1547b988-36b8-49bc-aae5-7f8e624e8043
---

## Recall Rule

Use this only when a user explicitly chooses the native Codex CLI fallback.
The normal path is the current in-app/subagent runtime plus
`docs/AGENT_COLLABORATION_PLAN.md`; do not prefer this historical shell protocol
over an available managed agent surface.

Historical S331–S332 procedure and observations (used about eight times without a
failure at that time); this is not the current review or cancellation protocol:

1. **Historical S331 observation:** a harness background Bash task pair-killed the shell and Codex. Do not infer that every current managed runtime has this behavior. Prefer the current managed review/runtime surface; use native CLI only when explicitly chosen and authorized. The old detached launch example below is retained as incident-era evidence, not a current command to copy.
   `nohup /opt/homebrew/bin/bash -c "codex exec --sandbox read-only \"\$(cat <promptfile>)\" < /dev/null" > <outfile> 2>&1 & disown`
2. **Historical stdin observation:** the S331 shell runs blocked on "Reading additional input from stdin..." without `< /dev/null`; this does not establish behavior for all current runtimes.
3. **Historical prompt-file pattern** (`"\$(cat file)"`) avoided shell-quoting failures from apostrophes/backticks in those review prompts.
4. **Historical S331–S332 polling observation only:** those runs sampled process/session-file growth. A frozen interval or elapsed time alone does not authorize killing or relaunching work. Use the managed runtime's status and cancellation controls. If native execution is explicitly authorized, identify and stop only the exact authorized job through its owning runtime; preserve job/session evidence.
5. **Historical S331–S332 output convention:** those verdicts followed the last line equal to `codex` and were duplicated after "tokens used". Do not assume this format for current runtimes.
6. **Historical sandbox limitation:** those read-only runs could not run Jest or fixture-writing self-tests (EPERM on temp writes); review the current runtime's actual permissions rather than relying on this old observation.
7. **Historical S331 companion-job incident:** a `/codex:*` job was observed with no commands logged. The installed companion includes an exact-job cancellation path; its existence is not proof of absence of bugs. If cancellation is authorized, identify the exact job and use its owning runtime's exact-job control. Never broad-kill processes, choose the newest session blindly, or delete job JSON/log evidence. Preserve this incident record; it does not prohibit the current managed cancellation path (see [[reference-codex-plugin-job-tracking-bugs]]).
