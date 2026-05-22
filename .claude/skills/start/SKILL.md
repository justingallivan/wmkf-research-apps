---
name: start
description: Start a new session by reviewing SESSION_PROMPT.md and CLAUDE.md
allowed-tools: Read, Bash(git status, git fetch:*, git pull:*, git rev-parse:*, git log:*, npm run check\:*, readlink:*, ls:*, pwd)
---

# Session Start

Start a new coding session with proper git sync and context loading.

## Step 1: Git Housekeeping

Before reading any files, ensure the repository is in sync:

1. **Verify repo health** - Quick sanity check:
   ```bash
   git rev-parse HEAD
   ```
   If this fails, the repo may be corrupted (see CLAUDE.md for recovery steps).

2. **Fetch remote changes** - Check if other machines pushed updates:
   ```bash
   git fetch origin
   git status
   ```

3. **Pull if behind** - If local is behind remote, pull first:
   ```bash
   git pull origin main
   ```
   Do NOT proceed with work if there are merge conflicts - alert the user.

4. **Check for stale changes** - If there are uncommitted changes, warn the user:
   - These may be leftover from a previous session
   - Ask if they should be committed, stashed, or discarded

## Step 1.5: Verify the memory store is consolidated

Durable memory lives in the git-tracked `.claude-memory/` directory. The harness
auto-memory feature writes to `~/.claude/projects/<slug>/memory/`, where `<slug>`
is the repo's absolute path with `/` and `_` replaced by `-`. That path MUST be a
symlink into `.claude-memory/`, or memory silently diverges per-machine (see the
`memory-store-propagation` memory entry).

Check it:
```bash
SLUG=$(pwd | sed 's#/#-#g; s#_#-#g')
readlink "$HOME/.claude/projects/$SLUG/memory"
```

- If `readlink` prints a path ending in `/.claude-memory` → consolidated, good.
- If it prints nothing AND `~/.claude/projects/$SLUG/memory` is a **regular
  directory** → memory is diverging. STOP and report: the symlink must be
  (re)created before any memory is written this session. Recreate with:
  `ln -s "<repo>/.claude-memory" "$HOME/.claude/projects/$SLUG/memory"` (move any
  unique entries out of the regular dir first).
- If neither path exists yet → first session at this path; create the symlink.

This is per-machine and breaks whenever the repo moves (the slug changes).
Never put `.git` or the working tree in a cloud-synced folder (iCloud / OneDrive
Folder Backup / Google Drive mirror) — it offloads `.git` objects to placeholders
and hangs `git fsck`/`gc`.

## Step 2: Run rubric-enforcement gates

Before reading any session context, run the project's CI gates to surface rubric violations *before* doing other work. A red gate is a violation of the ground-truth rule (`docs/CLAUDE_REMEDIATION_PLAN.md` + CLAUDE.md "Ground-truth requirement"), regardless of which session caused it.

If the project has these scripts (check `package.json`), run them:
```bash
npm run check:atlas             # Application State Atlas coverage
npm run check:atlas:self-test   # Coverage-tool self-test
npm run check:api-routes        # API route security matrix coverage
```

Skip silently if any of those scripts isn't defined — not every project has them. Do not skip when they are defined.

**If any gate is red:** report it as the FIRST thing in the Step 4 summary, before recapping the previous session. A red gate is a P0 blocker for any new feature work in the affected area (data layer for `check:atlas`, API routes for `check:api-routes`). Treat fixing it as a candidate first task, not a side-note.

## Step 3: Load Context

Read the following files to get context for this session:

1. **SESSION_PROMPT.md** - Previous session summary and potential next steps
2. **CLAUDE.md** - Project documentation and conventions

## Step 4: Present Summary

After completing the above:
- **First, report any red CI gate from Step 2** as a P0 blocker — name the gate, what it's complaining about, and propose fixing it before other work.
- Report git sync status (up to date, pulled N commits, or any issues)
- Summarize what was accomplished in the previous session
- List the potential next steps from SESSION_PROMPT.md
- Note any uncommitted changes that need attention
- Ask what the user would like to work on this session

## Step 5: Treat destructive carryover items as unverified

When summarizing "next steps" or "pivot to" sections from SESSION_PROMPT.md, flag any item that says **drop**, **remove**, **retire**, **archive**, **delete**, or **deprecate** infrastructure as **unverified-until-checked**, NOT as a green-lit task. These items have inherited from prior sessions and may have gone stale.

If the user asks to act on one, do a pre-flight verification first:
1. Grep for live callers of the thing being removed.
2. Read the most likely callers to confirm they're not load-bearing.
3. If anything looks live, stop and report back before touching anything.

This rule exists because on 2026-05-03 a "drop dormant Postgres reviewer tables" carryover item was about to be acted on; the tables were actually load-bearing for the live Reviewer Finder app. The rule does NOT apply to additive work.
