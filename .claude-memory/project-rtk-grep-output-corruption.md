---
name: project-rtk-grep-output-corruption
description: "rtk UNINSTALLED + its Claude Code hook removed (S220, 2026-06-04). Do NOT call rtk; global RTK.md instructions are stale. History below — rtk's grep filter once fabricated tool output."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: dev-env
  last_verified: "S221 (2026-06-04) — home-machine local allowlist + settings.bak also cleaned (per-machine; see S221 note)"
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

Ground truth: live dev-env state as of S221. `~/.claude/settings.json` no longer has a `PreToolUse`/`Bash` → `rtk hook claude` hook (S221: its `~/.claude/settings.json.bak` was also refreshed so a restore can't reintroduce the hook). `.claude/settings.local.json` is **gitignored / per-machine**, so its `Bash(rtk *)` allowlist entries do NOT sync — they must be cleared on EACH machine separately (office S220, home S221). Related: [[feedback-grep-general-codebase-terms]], [[feedback-real-fix-not-design-note]].

**S220 (2026-06-04): Justin uninstalled rtk** and asked me to remove its Claude Code hook. Removed the `hooks` block (`PreToolUse` matcher `Bash` running `rtk hook claude`) from `~/.claude/settings.json`, and the 9 dead `Bash(rtk ...)` permission entries from this repo's `.claude/settings.local.json`. The trigger: rtk's wrapper was summarizing `npx jest` stdout down to `PASS (1) FAIL (0)`, hiding the console output of a diagnostic harness. The global `RTK.md` agent-instructions still describe rtk as present — that doc is now outdated (out of repo scope to edit here; ignore its "always use rtk" guidance).

**S221 (2026-06-04): per-machine cleanup completed on home.** S220's local-allowlist cleanup ran on the *office* machine; because `.claude/settings.local.json` is gitignored it never synced, so the *home* machine still carried **20** dead `Bash(rtk ...)` allowlist entries (vs the 9 the S220 note recorded for office) — removed them here. Also refreshed `~/.claude/settings.json.bak` (it still held the old `rtk hook claude` block; the live `settings.json` was already clean) and fixed a stray `rtk proxy npx jest` invocation in `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`. Takeaway: rtk lives in TWO per-machine surfaces that don't travel with git — `~/.claude/settings.json`(+`.bak`) and `.claude/settings.local.json` — so each new machine needs its own sweep.

**History — why rtk was distrusted (S201, 2026-05-30):** rtk's `grep` token-saving filter corrupted Bash output mid-session — fabricated "placeholder" lines, duplicated `diff --git` headers, backwards line numbers, stale echoes across calls. It nearly let a **wrong commit stand**: a `review-manager.js` Edit silently failed (string-not-found), the corrupted shell masked it, and I pushed `e38bf18` claiming a fix that hadn't applied. Caught via the Edit tool's exact-match guarantee + a `git diff` cross-check; corrected in `de6010c`. `git`, `node`, and the Read/Edit tools stayed reliable throughout. Justin disabled rtk grep at end of S201; fully uninstalled rtk at S220.
