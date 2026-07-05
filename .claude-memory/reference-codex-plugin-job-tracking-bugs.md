---
name: reference-codex-plugin-job-tracking-bugs
description: "Confirmed codex plugin (v1.0.4/1.0.5) bugs — background reaping kills jobs, state.json races drop/zombify job records, console invisibility is upstream; operating rules to avoid them"
metadata: 
  node_type: memory
  type: reference
  status: active
  originSessionId: c18124b6-2252-442d-b924-73ea740f86cf
---

Researched 2026-07-04 (S330) after repeated lost/zombie Codex jobs. Confirmed causes, all present in plugin 1.0.5 (upgrading does not help):

- **Never background a codex-rescue run.** The rescue subagent backgrounding the companion lets Claude Code reap the process tree at turn end, killing the broker mid-flight → jobs stuck `running` forever or reported under IDs that never existed (openai/codex-plugin-cc#432). Run rescue agents synchronously and tell them: foreground only.
- **Never call `status`/`result`/`cancel` while a job is live.** `state.json` has no locking; concurrent read-modify-writes DROP job entries and delete their on-disk logs ("No job found" for real IDs) (#428). Wedged jobs: delete the entry under `~/.claude/plugins/data/codex-openai-codex/state/<repo-hash>/jobs/` rather than trusting `/codex:cancel` (#423).
- **Write tasks need a fresh session** (`--fresh`), never `--resume-last` — resume pins the original sandbox policy (plugin #412, upstream openai/codex#15310). Extends [[reference-codex-rescue-plan-task-runs-readonly]].
- **Owner's Codex console won't show plugin-launched runs** — upstream: the desktop app only indexes sessions its own app-server started (openai/codex#24197). Restarting the app re-indexes `~/.codex/sessions`. When the owner wants console visibility, hand them a paste-ready prompt instead of launching via the plugin.
- Deterministic alternative when tracking matters: synchronous `codex exec --json` (no daemon state at all).
