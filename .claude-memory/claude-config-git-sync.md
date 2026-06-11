---
name: claude-config-git-sync
description: ~/.claude is a git repo synced across home/office machines; auto-pulls portable config on session start
metadata: 
  node_type: memory
  type: reference
  status: active
  originSessionId: 8ca2ceaf-bb48-4bb1-8208-f8bccc762ba8
---

`~/.claude` is version-controlled and synced between Justin's home and office Macs via a private GitHub repo (`justingallivan/claude-config`, branch `main`).

- **Tracked (allowlist `.gitignore`):** `settings.json`, `statusline.sh`, `sync-config.sh`, `OFFICE_SETUP.md`, `.gitignore`. Everything else — credentials, `projects/` transcripts, caches — is ignored and stays machine-local. Never commit anything not on the allowlist; verify with `git ls-files` before pushing.
- **Auto-pull:** `sync-config.sh` runs on every launch via a global `SessionStart(startup)` hook in `settings.json`. It fast-forwards only, skips on a dirty tree, never auto-merges, and never pushes.
- **Pushing is manual:** after changing a setting/statusline, `cd ~/.claude && git add -A && git commit && git push`.
- `settings.json` is machine-agnostic: paths use `$HOME`, the notification sound is `command -v afplay`-guarded.
- Office first-time setup steps live in `~/.claude/OFFICE_SETUP.md` (in-place attach: `git init` + remote + `git reset --hard origin/main`).
- Statusline usage bar needs an OAuth token with `user:profile` scope; if missing it renders red `usage: re-login` → run `/login`.

This is environment/harness config, not WMKF project state. Related: [[project-dev-environment]].
