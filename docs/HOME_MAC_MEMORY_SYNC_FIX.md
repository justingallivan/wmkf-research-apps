---
title: "iCloud Migration + Home Mac Setup"
domain: docs-governance
kind: history
status: historical
summary: "Written 2026-05-14. One-time procedure to move the project into iCloud Drive so it syncs automatically between Macs, including .env.local and..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# iCloud Migration + Home Mac Setup

**Written 2026-05-14.** One-time procedure to move the project into iCloud Drive so it syncs automatically between Macs, including `.env.local` and Claude Code memory.

---

## Work Mac — Before Leaving Today

### Step 1: Git push

```bash
cd ~/Programming/WMKF_Apps/Phase-II-Summaries
git push origin main
```

### Step 2: Move the project into iCloud Drive

```bash
mkdir -p ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/Programming/WMKF_Apps

mv ~/Programming/WMKF_Apps/Phase-II-Summaries \
   ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/Programming/WMKF_Apps/

cd ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/Programming/WMKF_Apps/Phase-II-Summaries
```

Adjust the destination path if you want a different folder structure inside iCloud Drive.

### Step 3: Exclude node_modules and .next from iCloud sync

iCloud syncing `node_modules` causes terminal slowness — hundreds of thousands of small files. The `.nosync` suffix tells iCloud to skip a folder. Node and Next.js follow the symlinks transparently.

```bash
mv node_modules node_modules.nosync
ln -s node_modules.nosync node_modules

# .next may not exist yet — that's fine
mv .next .next.nosync 2>/dev/null || true
ln -s .next.nosync .next
```

### Step 4: Update the memory symlink

Moving the project changed its path, which broke the old symlink. Recreate it from the new location:

```bash
PROJECT_PATH=$(pwd)
# Claude Code encodes /, spaces, ~, and _ all as hyphens in the project slug
PROJECT_SLUG=$(echo "$PROJECT_PATH" | sed 's|[/ ~_]|-|g')
mkdir -p ~/.claude/projects/$PROJECT_SLUG
rm -rf ~/.claude/projects/$PROJECT_SLUG/memory
ln -s "$(pwd)/.claude-memory" ~/.claude/projects/$PROJECT_SLUG/memory

# Verify
ls -la ~/.claude/projects/$PROJECT_SLUG/memory
# Should show: memory -> /Users/.../iCloud Drive/.../Phase-II-Summaries/.claude-memory
```

### Step 5: Sanity check

```bash
git status      # should be clean
git remote -v   # should show origin on GitHub
```

Done. iCloud will begin syncing. You can leave.

---

## Home Mac — After iCloud Syncs

### Step 1: Wait for the sync to finish

Open Finder → iCloud Drive and find the project folder. Files still downloading show a cloud icon — wait until they're all local. For a project this size it may take a few minutes.

### Step 2: Open a terminal in the project

```bash
cd ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/Programming/WMKF_Apps/Phase-II-Summaries
```

**Note on iCloud paths:** On some Macs (especially with iCloud "Desktop & Documents" enabled), Finder surfaces iCloud Drive content under `~/Documents/...` instead of the `~/Library/Mobile Documents/com~apple~CloudDocs/...` form. If the `Mobile Documents` path doesn't exist, look in `~/Documents/Programming/...` — it's the same iCloud-synced content via a different mountpoint. Either path works; just be consistent about which one you `cd` into, since the project slug derived from `pwd` depends on it.

### Step 3: Reinstall dependencies

iCloud syncs symlinks unreliably — `node_modules.nosync` may not have transferred cleanly. Do a fresh install:

```bash
rm -rf node_modules.nosync
mkdir node_modules.nosync
npm install
```

If `.next.nosync` didn't sync (it's build output, iCloud may have skipped it):

```bash
mkdir -p .next.nosync
```

### Step 4: Set up the memory symlink

The project is now at the same iCloud path on both Macs, so this command is identical to what you ran at work:

```bash
PROJECT_PATH=$(pwd)
# Claude Code encodes /, spaces, ~, and _ all as hyphens in the project slug
PROJECT_SLUG=$(echo "$PROJECT_PATH" | sed 's|[/ ~_]|-|g')
mkdir -p ~/.claude/projects/$PROJECT_SLUG
rm -rf ~/.claude/projects/$PROJECT_SLUG/memory
ln -s "$(pwd)/.claude-memory" ~/.claude/projects/$PROJECT_SLUG/memory

# Verify
ls -la ~/.claude/projects/$PROJECT_SLUG/memory
```

### Step 5: Handle the old local clone

The old clone (wherever it was on the home Mac) is no longer needed. Check it has nothing uncommitted first, then delete it:

```bash
cd ~/old/path/to/Phase-II-Summaries
git status   # should be clean

cd ~
rm -rf ~/old/path/to/Phase-II-Summaries
```

### Step 6: Open Claude Code and run /start

Everything should be in sync. Memory, skills, `.env.local`, and project files all come from the same iCloud-synced directory.

---

## Going Forward

- **`.env.local`** syncs automatically via iCloud — no separate handling needed.
- **Claude Code memory** (`.claude-memory/`) syncs via both iCloud and git. Either path keeps it consistent.
- **Always run `/stop` before switching Macs.** The skill commits `.claude-memory/` and pushes so the git history stays current alongside iCloud.
- **`node_modules` and `.next`** are local-only on each Mac. Run `npm install` after any `package.json` changes pulled from the other machine.
