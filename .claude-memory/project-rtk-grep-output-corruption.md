---
name: project-rtk-grep-output-corruption
description: "rtk UNINSTALLED + its Claude Code hook removed (S220, 2026-06-04). Do NOT call rtk; global RTK.md instructions are stale. History below — rtk's grep filter once fabricated tool output."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: dev-env
  last_verified: "S220 (2026-06-04) — rtk uninstalled, hook removed, verified absent from settings"
  originSessionId: c44e6faf-38c5-4788-a087-45be4643bd6d
---

## Recall Rule

Read this when: about to run `rtk` (don't — it's gone), the global `RTK.md` instructions tell you to use rtk, or grep/cat/Bash output looks fabricated.

Do:
- Run plain commands directly (`git`, `npm`, `grep`, `node`). There is NO rtk proxy/hook anymore — do not prefix anything with `rtk`.
- Treat the global `~/.claude/RTK.md` "always use rtk" instructions as STALE (rtk is uninstalled). If a command errors with "rtk: command not found", that's expected — run the bare command.

Do not:
- Call `rtk <anything>` — it's uninstalled.
- Re-add the rtk hook to `~/.claude/settings.json`.

Ground truth: live dev-env state as of S220. `~/.claude/settings.json` no longer has a `PreToolUse`/`Bash` → `rtk hook claude` hook; `.claude/settings.local.json` no longer has `Bash(rtk *)` allowlist entries. Related: [[feedback-grep-general-codebase-terms]], [[feedback-real-fix-not-design-note]].

**S220 (2026-06-04): Justin uninstalled rtk** and asked me to remove its Claude Code hook. Removed the `hooks` block (`PreToolUse` matcher `Bash` running `rtk hook claude`) from `~/.claude/settings.json`, and the 9 dead `Bash(rtk ...)` permission entries from this repo's `.claude/settings.local.json`. The trigger: rtk's wrapper was summarizing `npx jest` stdout down to `PASS (1) FAIL (0)`, hiding the console output of a diagnostic harness. The global `RTK.md` agent-instructions still describe rtk as present — that doc is now outdated (out of repo scope to edit here; ignore its "always use rtk" guidance).

**History — why rtk was distrusted (S201, 2026-05-30):** rtk's `grep` token-saving filter corrupted Bash output mid-session — fabricated "placeholder" lines, duplicated `diff --git` headers, backwards line numbers, stale echoes across calls. It nearly let a **wrong commit stand**: a `review-manager.js` Edit silently failed (string-not-found), the corrupted shell masked it, and I pushed `e38bf18` claiming a fix that hadn't applied. Caught via the Edit tool's exact-match guarantee + a `git diff` cross-check; corrected in `de6010c`. `git`, `node`, and the Read/Edit tools stayed reliable throughout. Justin disabled rtk grep at end of S201; fully uninstalled rtk at S220.
