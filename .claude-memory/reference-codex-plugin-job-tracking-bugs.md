---
name: reference-codex-plugin-job-tracking-bugs
description: "Historical incident record for Codex plugin v1.0.4/1.0.5 job-tracking failures; not current operational guidance"
metadata: 
  node_type: memory
  type: reference
  status: stale
  originSessionId: c18124b6-2252-442d-b924-73ea740f86cf
---

## Historical incident record — 2026-07-04 (S330)

This record documents failures observed with plugin versions 1.0.4/1.0.5. It is not a
current troubleshooting recipe and does not authorize changing or deleting plugin job
state. For a present incident, establish the installed version and consult current plugin
documentation and supported controls; these dated findings alone do not establish current
behavior.

The 2026-07-04 investigation followed repeated lost/zombie Codex jobs and attributed the
following causes to the then-installed plugin 1.0.5:

- **Backgrounded rescue run:** the investigation attributed jobs stuck at `running` or reported
  under nonexistent IDs to Claude Code reaping a backgrounded companion process at turn end
  (openai/codex-plugin-cc#432).
- **Concurrent job-state operations:** the investigation found that concurrent
  `status`/`result`/`cancel` operations could lose job entries and on-disk logs because the
  then-observed `state.json` had no locking (#428); a separate report described wedged jobs
  (#423). The original incident notes mentioned direct state-file deletion; that historical
  action is not a present instruction or supported remedy.
- **Session policy:** plugin #412 and upstream openai/codex#15310 were cited for resumed
  sessions retaining their original sandbox policy. The note extended
  [[reference-codex-rescue-plan-task-runs-readonly]].
- **Console visibility:** upstream openai/codex#24197 was cited for the desktop app indexing
  only sessions started by its own app-server. The observed re-index behavior and workaround
  were specific to the 2026-07-04 environment.
- Synchronous `codex exec --json` was recorded as a deterministic tracking option at that
  time. Its current suitability is not established by this incident record.
