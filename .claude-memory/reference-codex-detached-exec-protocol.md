---
name: reference-codex-detached-exec-protocol
description: "Reliable protocol for running codex exec reviews — detached nohup launch, stdin redirect, prompt files, session-file stall watchdog"
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

Protocol for delegating reviews to Codex without hangs or kills (established S331, used ~8 times S331–S332 without a failure):

1. **Never host `codex exec` inside a harness background Bash task** — the harness pair-kills the shell and codex together (observed twice S331). Launch DETACHED instead:
   `nohup /opt/homebrew/bin/bash -c "codex exec --sandbox read-only \"\$(cat <promptfile>)\" < /dev/null" > <outfile> 2>&1 & disown`
2. **Always `< /dev/null`** — `codex exec` in any non-interactive shell otherwise blocks forever on "Reading additional input from stdin...".
3. **Prompt-file pattern** (`"\$(cat file)"`) — avoids shell-quoting failures from apostrophes/backticks in review prompts.
4. **Disposable poller** as a separate background task: every 30s check `pgrep -f "codex exec"`; liveness = the newest `~/.codex/sessions/<date>/*.jsonl` file's mtime/size. **Frozen ≥8 min = stall** (kill + relaunch); wall-clock alone is not a stall signal — long reviews legitimately run 10–30+ min while the session file keeps growing.
5. **Read the verdict** from the outfile: the final message follows the LAST line equal to `codex` (`awk '/^codex$/{n=NR} END{print n}'`), duplicated after "tokens used".
6. Codex read-only sandbox cannot run jest or fixture-writing self-tests (EPERM on temp writes) — expect static review of tests; local greens must come from the orchestrator's own runs.
7. The plugin companion path (`/codex:*` jobs) can hang with 0 commands logged — kill the pid and delete the job JSON/log under `~/.claude/plugins/data/codex-openai-codex/state/.../jobs/`; never `/codex:cancel` (see [[reference-codex-plugin-job-tracking-bugs]]).
