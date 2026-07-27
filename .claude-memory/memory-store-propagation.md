---
name: memory-store-propagation
description: Memory must live in the git-tracked .claude-memory/ store; the per-machine harness store is symlinked into it. The symlink is keyed to the repo's path-derived slug, so it must be re-created per machine and whenever the repo moves.
metadata:
  type: project
  status: active
  scope: dev-env
  last_verified: 2026-07-27 via /start readlink check for the current repo path
---

## Recall Rule

Read this when: memory seems to have stopped propagating between Macs, a cited memory entry is "missing," setting up a new machine, or after the repo moves to a new path.

Do:
- Keep `.claude-memory/` (git-tracked, kebab-case) as the single source of truth; index is `.claude-memory/MEMORY.md`.
- On each machine once, symlink `~/.claude/projects/<slug>/memory` → `<repo>/.claude-memory`; re-create when the repo path changes.
- If `~/.claude/projects/<slug>/memory` is a regular directory (not a symlink into the repo), stop and reconsolidate before writing.

Do not:
- Put `.git` or the working tree inside any cloud-synced folder (iCloud/OneDrive/Google Drive) — it offloads loose objects and corrupts git ops.
- Assume moving the repo into iCloud makes memory propagate (the harness store lives under `~/.claude`, outside the repo).

Ground truth: `.claude-memory/`; `~/.claude/projects/<slug>/memory` symlink. Supersedes: `memory-propagation-icloud-misfix`, `project_memory_two_stores_propagation`. Related: [[env-broken-git-autogc]].

[VERIFIED on 2026-07-27 via `/start`'s `readlink` checks for the current repo
path.] This proves the current machine/path only; repeat after a move or on
another machine.

**There is ONE canonical memory store: `.claude-memory/` in the repo, git-tracked.**
Everything durable lives there, propagates between Macs via normal `git push`/`pull`,
and is committed at session boundaries. Naming convention: **kebab-case**
(`feedback-*`, `project-*`, `user-*`, plus reference/decision entries). Index is
`.claude-memory/MEMORY.md`.

**The harness writes to a per-machine path — so we symlink that path into the repo.**
The Claude Code harness auto-memory feature writes to
`~/.claude/projects/<slug>/memory/`, where `<slug>` is derived from the repo's
**absolute path** (e.g. `~/Code/WMKF_Apps` → `-Users-gallivan-Code-WMKF-Apps`).
`~/.claude` is plain local disk, never synced. The fix is a symlink:

```
~/.claude/projects/<slug>/memory   →   <repo>/.claude-memory
```

With the symlink in place, every memory the harness writes lands inside the
repo, git tracks it, and the session-boundary `pull`/`push` carries it between
machines along with the code. One physical store.

**⚠️ The symlink is keyed to the path-derived `<slug>` — it does NOT survive a repo move, and is per-machine.** This is the root cause of the whole
propagation saga (S165–S175):

- A symlink was first created S168 — but for the iCloud-path slug
  (`...-Library-Mobile-Documents-com-apple-CloudDocs-...`).
- When the repo later moved back to `~/Documents/...`, the slug changed, the
  old symlink no longer matched, and the harness silently created a *fresh
  regular directory* at the new slug → memory diverged again (kebab harness
  store with ~11 entries vs the git-tracked snake_case `.claude-memory/`).
- That divergence is what made "memories stopped propagating" and the
  multi-session "phantom memory" belief (a cited memory was invisible because
  it lived in the *other* store).

**Earlier wrong turns (do not repeat):** the repo was once moved into an iCloud
shared folder to "make memories propagate" — it cannot (the harness store is
under `~/.claude`, outside the repo) and it caused a separate, serious failure:
the cloud File Provider offloaded `.git` loose objects to `dataless`
placeholders, hanging every `git fsck`/`gc`/`repack`/`prune` (see
[[env-broken-git-autogc]]). **Never put `.git` or the working tree inside any
cloud-synced folder** (iCloud, OneDrive Folder Backup, Google Drive mirror).

**How to apply:**
- The repo lives at a plain local path off any cloud sync (`~/Code/WMKF_Apps`).
- Memory of record = `.claude-memory/`, kebab-case, committed by `/stop`.
- On **each machine, once**: create the symlink from the harness slug path to
  `<repo>/.claude-memory`. If the repo path ever changes, re-create it for the
  new slug. `/start` should detect drift: if `~/.claude/projects/<slug>/memory`
  is a regular directory (not a symlink into the repo), memory is diverging —
  stop and reconsolidate before writing anything new.
- Reconciliation done S175 (2026-05-22): the divergent kebab harness store was
  merged into `.claude-memory/`, all 70+ entries renamed snake→kebab, this
  entry written to supersede the obsolete `memory-propagation-icloud-misfix`
  and `project_memory_two_stores_propagation` entries.
