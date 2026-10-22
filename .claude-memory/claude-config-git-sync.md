---
name: claude-config-git-sync
description: Historical July 2026 snapshot of the owner's Claude config-sync setup; not proof of current machine state, and any authorized sync must preserve unowned files through explicit staging
metadata: 
  node_type: memory
  type: reference
  status: active
  originSessionId: 8ca2ceaf-bb48-4bb1-8208-f8bccc762ba8
  last_verified: 2026-07-27 via ~/.claude git metadata, tracked files, settings.json, sync-config.sh, and statusline.sh
---

## Recall Rule

Read this only when diagnosing cross-machine Claude configuration. Verify the
current `~/.claude` remote, tracked-file allowlist, hooks, and symlinks before
acting; this entry records the intended setup, not proof of current machine state.

[VERIFIED on 2026-07-27 via `git -C ~/.claude remote -v`, branch and
`ls-files`, plus direct reads of `settings.json`, `sync-config.sh`, and
`statusline.sh` for the behaviors below.]

The following is a **historical 2026-07-27 setup snapshot**, not proof of the current
`~/.claude` remote, tracked set, hooks, files, or machine state. The recorded setup
used a private GitHub repo (`justingallivan/claude-config`, branch `main`) to sync
selected configuration between home and office Macs.

- **Recorded tracked set (allowlist `.gitignore`):** `settings.json`, `statusline.sh`, `sync-config.sh`, `OFFICE_SETUP.md`, `.gitignore`. This is not a current allowlist. If an owner authorizes a sync, first establish current scope and ownership; stage only the explicit intended paths, inspect the staged diff, and preserve untracked/ignored and machine-local files. Never use blanket `git add -A` or `git reset --hard` based on this old snapshot.
- **Recorded auto-pull behavior:** `sync-config.sh` was described as running on launch via a global `SessionStart(startup)` hook and fast-forwarding only. Verify current configuration before relying on this behavior.
- **Pushing was manual in the recorded setup.** If specifically authorized, stage only the intended paths and review the staged diff before any commit or push.
- `settings.json` is machine-agnostic: paths use `$HOME`, the notification sound is `command -v afplay`-guarded.
- Office first-time setup was recorded in `~/.claude/OFFICE_SETUP.md`; the old in-place `git reset --hard origin/main` procedure is not current guidance and must not be applied without explicit owner authorization and a reviewed preservation plan.
- The 2026-07-27 snapshot said the statusline usage bar needed an OAuth token with `user:profile` scope. Treat that as a historical contract; verify current behavior and use the current authorized login flow if needed.

This is environment/harness config, not WMKF project state. Local `~/.claude` files are
outside the WMKF project by default; do not inspect or modify them as part of ordinary repo
work. Related: [[project-dev-environment]].
